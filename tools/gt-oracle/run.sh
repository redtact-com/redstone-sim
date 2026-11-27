#!/usr/bin/env bash
# run.sh — 26.3 のオラクルを 1 コマンドで回す (docs/research/18 §4・#439)
#
# 使い方:
#   GT_ORACLE_ACCEPT_EULA=true tools/gt-oracle/run.sh [--twice] [fixture名 ...]
#     fixture 名を省くと、縦切りの 2 本 (lever-wire-lamp・lamp-off-delay) を撮る。
#     --twice は同じものを 2 回撮り、結果が一致するかも確かめる。
#
# 流れ: jar の取得 (fetch-jar.ts) → データパックと計画 (gen-datapack.ts) → Docker の中で javac と起動
#       → fixture の形に写す (to-fixture.ts) → 1.21.1 の expect と比べる (compare.ts)
#
# 決まり:
#   - Minecraft の EULA (https://aka.ms/MinecraftEULA) に同意したうえで GT_ORACLE_ACCEPT_EULA=true を付ける。
#     付いていなければ何も取らずに止まる。CI では動かさない
#   - Java 25 はシステムに入れず、公開イメージ (既定 eclipse-temurin:25-jdk) の中でビルドして動かす。
#     コンテナはネットワークなし。ワールドはコンテナの tmpfs に作って捨てる
#   - jar・展開した物・class・結果は tools/gt-oracle/work/ (gitignore) に置く。コミットしない
#
# 環境変数:
#   GT_ORACLE_MC_VERSION  撮る版 (既定 26.3)。起動コードは版ごとに確かめてから使う (R18 §4.5)
#   GT_ORACLE_IMAGE       Java 25 のイメージ (既定 eclipse-temurin:25-jdk)
#   GT_ORACLE_SERVER_JAR  手元にあるサーバ jar。sha1 が合えば落とさずに写す
set -euo pipefail

usage() {
  sed -n '2,8p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

if [[ "${GT_ORACLE_ACCEPT_EULA:-}" != "true" ]]; then
  echo "Minecraft の EULA (https://aka.ms/MinecraftEULA) への同意が要る。" >&2
  echo "同意したうえで GT_ORACLE_ACCEPT_EULA=true を付けて実行すること。" >&2
  exit 2
fi

GT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$GT_DIR/../.." && pwd)"
VERSION="${GT_ORACLE_MC_VERSION:-26.3}"
IMAGE="${GT_ORACLE_IMAGE:-eclipse-temurin:25-jdk}"

TWICE=0
NAMES=()
for a in "$@"; do
  case "$a" in
    --twice) TWICE=1 ;;
    -h|--help) usage 0 ;;
    -*) echo "知らない引数: $a" >&2; usage 1 ;;
    *) NAMES+=("$a") ;;
  esac
done
if [[ ${#NAMES[@]} -eq 0 ]]; then
  NAMES=(lever-wire-lamp lamp-off-delay)
fi

cd "$REPO_ROOT"
TSX=(npx --no-install tsx)
now_ms() { date +%s%3N; }
T_START="$(now_ms)"

# --- 1. jar --------------------------------------------------------------
"${TSX[@]}" "$GT_DIR/fetch-jar.ts" --version "$VERSION"

# --- 2. Java 25 のイメージ ------------------------------------------------
if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  # WSL の docker は credsStore のせいで公開イメージの pull に失敗することがある。空の設定で取る
  echo "==> $IMAGE を取る"
  DOCKER_CONFIG="$(mktemp -d)" docker pull "$IMAGE"
fi

# コンテナの共通の引数。ネットワークなし (起動にも撮るのにも要らない)。hostname を localhost にするのは、
# ネットワークなしで自分のホスト名を引けずに起動ログへ例外が出るのを避けるため。ワールドは tmpfs に置く
# (bind mount の上だと終了時のチャンクの保存に 10 秒かかった)
DOCKER_ARGS=(--rm --network none --hostname localhost
  --tmpfs "/universe:size=1g,uid=$(id -u),gid=$(id -g)"
  --user "$(id -u):$(id -g)" -e GT_ORACLE_ACCEPT_EULA=true -e HOME=/tmp
  -v "$GT_DIR:/gt")
CP="/gt/work/classes/$VERSION:/gt/work/jars/$VERSION/server-$VERSION.jar:/gt/work/jars/$VERSION/libs/*"

# --- 3. 起動コードのビルド ---------------------------------------------------
echo "==> 起動コードをビルドする (javac --release 25)"
rm -rf "${GT_DIR:?}/work/classes/$VERSION"
mkdir -p "$GT_DIR/work/classes/$VERSION"
T_BUILD="$(now_ms)"
docker run "${DOCKER_ARGS[@]}" -w /gt "$IMAGE" \
  sh -c "javac --release 25 -encoding UTF-8 -cp '$CP' -d 'work/classes/$VERSION' java/gtoracle/*.java"
echo "    $(( $(now_ms) - T_BUILD )) ms"

STAMP="$(date +%Y%m%d-%H%M%S)"
FAILED=0

# --- 4〜6. 撮る → 写す → 比べる ----------------------------------------------
run_once() {
  local label="$1"
  local rel="work/runs/$STAMP-$label"
  local dir="$GT_DIR/$rel"
  echo "==> 撮る ($label): ${NAMES[*]}"
  mkdir -p "$dir/server"
  "${TSX[@]}" "$GT_DIR/gen-datapack.ts" --run "$dir" --version "$VERSION" "${NAMES[@]}"
  local t0 code
  t0="$(now_ms)"
  set +e
  docker run "${DOCKER_ARGS[@]}" -w "/gt/$rel/server" "$IMAGE" \
    java -Xmx2G -cp "$CP" gtoracle.OracleMain \
      --plan ../plan.json --out ../results --universe /universe/world --packs ../packs \
      --expect-version "$VERSION" > "$dir/server.log" 2>&1
  code=$?
  set -e
  local wall=$(( $(now_ms) - t0 ))
  grep -o '\[gt-oracle\].*' "$dir/server.log" || true
  if [[ $code -ne 0 ]]; then
    echo "    起動コードの終了コード $code (ログ: tools/gt-oracle/$rel/server.log)" >&2
    grep -E 'ERROR|Exception' "$dir/server.log" | head -20 >&2 || true
    FAILED=1
  fi
  if [[ -f "$dir/results/_run.json" ]]; then
    node -e '
      const r = require(process.argv[1]);
      console.log(`    起動 ${r.bootMs} ms・撮る ${r.driveMs} ms・コンテナ全体 ${process.argv[2]} ms・機能フラグ ${r.enabledFeatures.join(" ")}`);
    ' "$dir/results/_run.json" "$wall"
  fi
  "${TSX[@]}" "$GT_DIR/to-fixture.ts" --run "$dir" || FAILED=1
  "${TSX[@]}" "$GT_DIR/compare.ts" --run "$dir"
  LAST_RUN="$dir"
}

run_once a
FIRST_RUN="$LAST_RUN"
if [[ $TWICE -eq 1 ]]; then
  run_once b
  echo "==> 2 回の結果を比べる"
  "${TSX[@]}" "$GT_DIR/compare.ts" --same "$FIRST_RUN" "$LAST_RUN" || FAILED=1
fi

echo "==> 全体 $(( $(now_ms) - T_START )) ms。結果は tools/gt-oracle/work/runs/$STAMP-* (コミットしない)"
exit "$FAILED"
