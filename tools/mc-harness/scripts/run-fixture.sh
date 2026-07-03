#!/usr/bin/env bash
# fixture 生成 → sim との diff を 1 コマンドで回す
#
# 前提: cd tools/mc-harness && docker compose up -d 済み (初回起動は数分かかる)
# 使い方:
#   npm run ground-truth -- <fixture名>       … 1 本生成 + diff
#   npm run ground-truth -- --all             … fixtures/ 全定義を生成 + diff
#   npm run ground-truth -- --diff-only <名>  … 生成せず既存 fixture と sim の diff のみ
set -euo pipefail

cd "$(dirname "$0")/../../.."  # repo root

if [ $# -eq 0 ]; then
  echo "使い方: run-fixture.sh <fixture名>|--all|--diff-only <fixture名...>" >&2
  exit 1
fi

if [ "$1" = "--diff-only" ]; then
  shift
  exec npx tsx tools/mc-harness/runner/run.ts "$@"
fi

if [ "$1" = "--all" ]; then
  names=()
  for f in tools/mc-harness/fixtures/*.json; do
    names+=("$(basename "$f" .json)")
  done
else
  names=("$@")
fi

npx tsx tools/mc-harness/runner/generate.ts "${names[@]}"
npx tsx tools/mc-harness/runner/run.ts "${names[@]}"
