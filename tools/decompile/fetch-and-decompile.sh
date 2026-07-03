#!/usr/bin/env bash
# fetch-and-decompile.sh — Minecraft server.jar のローカルデコンパイル一括スクリプト
#
# 使い方:
#   JAVA_HOME=~/bluemap/jdk25 ./fetch-and-decompile.sh <version>
#   例: ./fetch-and-decompile.sh 1.21.1
#       ./fetch-and-decompile.sh 26.2
#
# 処理内容 (docs/research/03_legal-decompile.md §7 の推奨ワークフローを自動化):
#   1. piston-meta の version manifest から対象バージョンの JSON を取得
#   2. server.jar (+ 難読化版なら server mappings = server.txt) をダウンロード
#   3. bundler 形式 (1.18+) なら META-INF/versions/ から本体 jar を抽出
#   4. mappings がある場合: Reconstruct で公式 mappings を適用して再マップ
#      mappings がない場合 (26.x, 2025-10 の難読化廃止以降): そのまま次へ
#   5. Vineflower でデコンパイルし out/<version>/ に Java ソースを展開
#
# 生成物は全て git 管理外 (jars/ work/ out/ は .gitignore 済)。
# ★ デコンパイル産物・jar・mappings は絶対にコミットしないこと (03 §6 参照)。
#
# 必要環境: bash, curl, python3, unzip, sha1sum, Java 17+ (Java 21+ 推奨)
set -euo pipefail

VERSION="${1:?usage: fetch-and-decompile.sh <minecraft-version> (e.g. 1.21.1, 26.2)}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
JARS_DIR="$SCRIPT_DIR/jars/$VERSION"
WORK_DIR="$SCRIPT_DIR/work"
OUT_DIR="$SCRIPT_DIR/out/$VERSION"

# ツール (いずれも Mojang 非依存の OSS)
VINEFLOWER_VERSION="${VINEFLOWER_VERSION:-1.12.0}"   # Apache-2.0
RECONSTRUCT_VERSION="${RECONSTRUCT_VERSION:-1.3.27}" # Apache-2.0
VINEFLOWER_JAR="$WORK_DIR/vineflower-$VINEFLOWER_VERSION.jar"
RECONSTRUCT_JAR="$WORK_DIR/reconstruct-cli-$RECONSTRUCT_VERSION.jar"

# Java: JAVA_HOME 優先 (このリポジトリの開発環境では JAVA_HOME=~/bluemap/jdk25)
if [[ -n "${JAVA_HOME:-}" && -x "$JAVA_HOME/bin/java" ]]; then
  JAVA="$JAVA_HOME/bin/java"
else
  JAVA="java"
fi
echo "==> java: $("$JAVA" -version 2>&1 | head -1)"

mkdir -p "$JARS_DIR" "$WORK_DIR" "$OUT_DIR"

# --- 1. version manifest → version JSON -------------------------------------
MANIFEST_JSON="$WORK_DIR/version_manifest_v2.json"
echo "==> fetching version manifest"
curl -fsSL "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json" -o "$MANIFEST_JSON"

VERSION_URL="$(python3 - "$MANIFEST_JSON" "$VERSION" <<'PY'
import json, sys
manifest = json.load(open(sys.argv[1]))
for v in manifest["versions"]:
    if v["id"] == sys.argv[2]:
        print(v["url"]); break
else:
    sys.exit(f"version {sys.argv[2]!r} not found in manifest")
PY
)"

VERSION_JSON="$JARS_DIR/version.json"
echo "==> fetching version json: $VERSION_URL"
curl -fsSL "$VERSION_URL" -o "$VERSION_JSON"

# --- 2. server.jar + server mappings (あれば) --------------------------------
read -r SERVER_URL SERVER_SHA1 MAPPINGS_URL MAPPINGS_SHA1 <<<"$(python3 - "$VERSION_JSON" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))["downloads"]
server = d["server"]
mappings = d.get("server_mappings", {})
print(server["url"], server["sha1"], mappings.get("url", "-"), mappings.get("sha1", "-"))
PY
)"

SERVER_JAR="$JARS_DIR/server.jar"
if [[ ! -f "$SERVER_JAR" ]]; then
  echo "==> downloading server.jar"
  curl -fL "$SERVER_URL" -o "$SERVER_JAR"
fi
echo "$SERVER_SHA1  $SERVER_JAR" | sha1sum -c - >/dev/null && echo "==> server.jar sha1 OK"

MAPPINGS_TXT=""
if [[ "$MAPPINGS_URL" != "-" ]]; then
  MAPPINGS_TXT="$JARS_DIR/server.txt"
  if [[ ! -f "$MAPPINGS_TXT" ]]; then
    echo "==> downloading server mappings (server.txt)"
    curl -fL "$MAPPINGS_URL" -o "$MAPPINGS_TXT"
  fi
  echo "$MAPPINGS_SHA1  $MAPPINGS_TXT" | sha1sum -c - >/dev/null && echo "==> server.txt sha1 OK"
else
  echo "==> no server_mappings in version json (unobfuscated build, 26.x+): skipping remap"
fi

# --- 3. bundler 形式 (1.18+) から本体 jar を抽出 ------------------------------
INNER_JAR="$SERVER_JAR"
BUNDLED_PATH="$(unzip -Z1 "$SERVER_JAR" 'META-INF/versions/*/server-*.jar' 2>/dev/null | head -1 || true)"
if [[ -n "$BUNDLED_PATH" ]]; then
  echo "==> bundler format detected, extracting: $BUNDLED_PATH"
  unzip -oq "$SERVER_JAR" "$BUNDLED_PATH" -d "$JARS_DIR/bundle"
  INNER_JAR="$JARS_DIR/bundle/$BUNDLED_PATH"
fi

# --- 4. mappings 適用の再マップ (Reconstruct) ---------------------------------
DECOMPILE_INPUT="$INNER_JAR"
if [[ -n "$MAPPINGS_TXT" ]]; then
  if [[ ! -f "$RECONSTRUCT_JAR" ]]; then
    echo "==> downloading Reconstruct $RECONSTRUCT_VERSION"
    curl -fL "https://github.com/LXGaming/Reconstruct/releases/download/v$RECONSTRUCT_VERSION/reconstruct-cli-$RECONSTRUCT_VERSION.jar" \
      -o "$RECONSTRUCT_JAR"
  fi
  REMAPPED_JAR="$WORK_DIR/server-$VERSION-remapped.jar"
  if [[ ! -f "$REMAPPED_JAR" ]]; then
    echo "==> remapping with Mojang official mappings (Reconstruct)"
    # Reconstruct は CWD に logs/ を作るため work/ 内で実行する
    (cd "$WORK_DIR" && "$JAVA" -jar "$RECONSTRUCT_JAR" \
      --jar "$INNER_JAR" \
      --mapping "$MAPPINGS_TXT" \
      --output "$REMAPPED_JAR" \
      --exclude "com.google.,com.mojang.blaze3d.,io.netty.,it.unimi.dsi.fastutil.,javax.,joptsimple.,org.apache." \
      --agree)
  fi
  DECOMPILE_INPUT="$REMAPPED_JAR"
fi

# --- 5. Vineflower デコンパイル ----------------------------------------------
if [[ ! -f "$VINEFLOWER_JAR" ]]; then
  echo "==> downloading Vineflower $VINEFLOWER_VERSION"
  curl -fL "https://github.com/Vineflower/vineflower/releases/download/$VINEFLOWER_VERSION/vineflower-$VINEFLOWER_VERSION.jar" \
    -o "$VINEFLOWER_JAR"
fi

echo "==> decompiling with Vineflower (this can take several minutes)"
# --folder: jar → ディレクトリ展開 / net/minecraft と com/mojang のみ対象 (--only)
"$JAVA" -jar "$VINEFLOWER_JAR" \
  --folder \
  --only=net/minecraft/ \
  --only=com/mojang/ \
  "$DECOMPILE_INPUT" "$OUT_DIR"

CLASS_COUNT="$(find "$OUT_DIR" -name '*.java' | wc -l)"
echo "==> done: $CLASS_COUNT .java files in $OUT_DIR"
echo "    (このディレクトリは .gitignore 済み。産物をコミットしないこと)"
