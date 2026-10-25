// vitest --coverage が書いた coverage/coverage-summary.json を、領域ごとの表 (Markdown) にする。
// CI では出力を $GITHUB_STEP_SUMMARY に足す (#420)。
// 実行: node tools/coverage-summary.mjs [coverage-summary.json のパス]
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// 表の行の順。上から順に前方一致で振り分ける
export const AREAS = [
  'packages/sim/',
  'packages/editor/',
  'packages/viewer/',
  'app/',
  'tools/mc-harness/',
]
const KEYS = ['lines', 'branches', 'functions']

const zero = () => Object.fromEntries(KEYS.map((k) => [k, { covered: 0, total: 0 }]))

const pct = ({ covered, total }) =>
  total === 0 ? '-' : `${((covered / total) * 100).toFixed(1)}% (${covered}/${total})`

/** coverage-summary.json の中身 (キーは絶対パス) から表の行 (文字列の配列) を作る */
export function summarize(summary, root) {
  const totals = new Map(AREAS.map((a) => [a, { files: 0, ...zero() }]))
  for (const [abs, entry] of Object.entries(summary)) {
    if (abs === 'total') continue
    const rel = path.relative(root, abs).split(path.sep).join('/')
    const area = AREAS.find((a) => rel.startsWith(a))
    if (!area) continue
    const t = totals.get(area)
    t.files++
    for (const k of KEYS) {
      t[k].covered += entry[k].covered
      t[k].total += entry[k].total
    }
  }

  const rows = [...totals].map(([area, t]) => [area, t.files, ...KEYS.map((k) => pct(t[k]))])
  rows.push(['合計', rows.reduce((n, r) => n + r[1], 0), ...KEYS.map((k) => pct(summary.total[k]))])
  return [
    '### カバレッジ (vitest)',
    '',
    '| 領域 | ファイル | 行 | 分岐 | 関数 |',
    '|---|---:|---:|---:|---:|',
    ...rows.map((r) => `| ${r.join(' | ')} |`),
  ]
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = process.argv[2] ?? 'coverage/coverage-summary.json'
  const summary = JSON.parse(readFileSync(file, 'utf8'))
  for (const line of summarize(summary, process.cwd())) console.log(line)
}
