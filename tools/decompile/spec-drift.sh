#!/usr/bin/env bash
# spec-drift.sh — 仕様典拠クラスのドリフト検知 (issue #25)
#
# docs/research/02 の典拠クラス (watched-classes.txt) について、デコンパイル結果の
# 正規化ハッシュを fingerprints.json のベースラインと比較し、新バージョンで
# 仕様が変わった可能性を検知する。
#
# 使い方:
#   ./spec-drift.sh --update <version>          # <version> をベースラインとして再生成
#   ./spec-drift.sh --check [<version>|latest]  # ベースラインと比較 (既定: latest release)
#
# --check の出力 (stdout, "DRIFT:" / "RESULT:" 行を機械可読とする):
#   RESULT: no-new-version | no-drift | drift | baseline-selfcheck-ok
#   DRIFT: <class-path>    (変化したクラスごとに 1 行)
#
# 法務境界: デコンパイル産物はローカル/CI runner 内で使い捨てる。コミット・
# artifact 化するのは fingerprints.json (パスとハッシュ = 事実の指紋) のみ。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FINGERPRINTS="$SCRIPT_DIR/fingerprints.json"
WATCHED="$SCRIPT_DIR/watched-classes.txt"
MODE="${1:?usage: spec-drift.sh --update <version> | --check [<version>|latest]}"
ARG="${2:-latest}"

# 監視クラス一覧 (コメント・空行除去)
watched_classes() {
  grep -vE '^\s*(#|$)' "$WATCHED"
}

# 正規化: CRLF 除去 → 行末空白除去 → 空行除去 → sha256
norm_hash() {
  sed -e 's/\r$//' -e 's/[[:space:]]*$//' "$1" | grep -v '^$' | sha256sum | cut -d' ' -f1
}

resolve_latest() {
  curl -fsSL "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json" \
    | python3 -c "import json,sys; print(json.load(sys.stdin)['latest']['release'])"
}

decompile() {
  local version="$1"
  if [[ -d "$SCRIPT_DIR/out/$version/net" ]]; then
    echo "==> out/$version は既存のものを再利用" >&2
  else
    "$SCRIPT_DIR/fetch-and-decompile.sh" "$version" >&2
  fi
  # smoke: クラス数の下限チェック
  local count
  count=$(find "$SCRIPT_DIR/out/$version" -name '*.java' | wc -l)
  echo "==> smoke: out/$version に $count .java" >&2
  if (( count < 3000 )); then
    echo "ERROR: デコンパイル結果が少なすぎる ($count < 3000)" >&2
    exit 1
  fi
}

hash_watched() {
  local version="$1"
  local out="$SCRIPT_DIR/out/$version"
  watched_classes | while read -r cls; do
    if [[ -f "$out/$cls" ]]; then
      echo "$cls $(norm_hash "$out/$cls")"
    else
      echo "$cls MISSING"
    fi
  done
}

case "$MODE" in
  --update)
    VERSION="$ARG"
    [[ "$VERSION" == "latest" ]] && VERSION="$(resolve_latest)"
    decompile "$VERSION"
    HASHES_TMP="$(mktemp)"
    trap 'rm -f "$HASHES_TMP"' EXIT
    hash_watched "$VERSION" > "$HASHES_TMP"
    python3 - "$FINGERPRINTS" "$VERSION" "$HASHES_TMP" <<'PY'
import json, sys
entries = {}
for line in open(sys.argv[3]):
    cls, h = line.rsplit(None, 1)
    if h == "MISSING":
        sys.exit(f"ERROR: 監視クラスが見つからない: {cls} (watched-classes.txt を確認)")
    entries[cls] = h
json.dump({"version": sys.argv[2], "normalization": "strip-crlf-trailing-ws-blank-lines/sha256",
           "classes": entries}, open(sys.argv[1], "w"), indent=2, ensure_ascii=False)
open(sys.argv[1], "a").write("\n")
print(f"==> fingerprints.json を {sys.argv[2]} で更新 ({len(entries)} クラス)")
PY
    ;;

  --check)
    TARGET="$ARG"
    [[ "$TARGET" == "latest" ]] && TARGET="$(resolve_latest)"
    BASE_VERSION="$(python3 -c "import json; print(json.load(open('$FINGERPRINTS'))['version'])")"
    echo "==> baseline=$BASE_VERSION target=$TARGET"

    decompile "$TARGET"
    DRIFT=0
    while read -r cls h; do
      base=$(python3 -c "import json; print(json.load(open('$FINGERPRINTS'))['classes'].get('$cls','NONE'))")
      if [[ "$h" == "MISSING" ]]; then
        echo "DRIFT: $cls (クラスが見つからない — 移動/リネームの可能性)"
        DRIFT=1
      elif [[ "$base" == "NONE" ]]; then
        echo "DRIFT: $cls (ベースラインに未登録 — watched-classes.txt 追加後は --update を実行)"
        DRIFT=1
      elif [[ "$h" != "$base" ]]; then
        echo "DRIFT: $cls"
        DRIFT=1
      fi
    done < <(hash_watched "$TARGET")

    if [[ "$TARGET" == "$BASE_VERSION" ]]; then
      # 同一バージョンの自己照合 = デコンパイル決定性の確認
      if (( DRIFT )); then
        echo "ERROR: 同一バージョン ($TARGET) で不一致 — Vineflower のバージョン差か環境差" >&2
        echo "RESULT: baseline-selfcheck-failed"
        exit 1
      fi
      echo "RESULT: baseline-selfcheck-ok"
    elif (( DRIFT )); then
      echo "RESULT: drift"
    else
      echo "RESULT: no-drift"
    fi
    ;;

  *)
    echo "usage: spec-drift.sh --update <version> | --check [<version>|latest]" >&2
    exit 1
    ;;
esac
