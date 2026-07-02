// ============================================================
// diff ランナー: fixture (実機 ground truth) vs @redstone/sim
//
// 使い方: npx tsx tools/mc-harness/runner/run.ts <fixture名|パス> [...] [--trace] [--verbose]
//
//   --trace   … diff の代わりに sim のトレース (docs/research/08 記法) を出力する
//               (diff 失敗時のデバッグ用)。--verbose で updateFormula (bu) 行も出す。
//
// 終了コード:
//   0 … 全 fixture 一致 (skipUntil 付きの不一致は「既知ギャップ」として許容) / --trace 時は常に 0
//   1 … skipUntil なし fixture に不一致あり
// ============================================================

import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  diffFixtureAgainstSim,
  traceFixtureOnSim,
  type Fixture,
} from '../../../packages/sim/test/fixture-runner.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const fixturesDir = join(repoRoot, 'packages', 'sim', 'test', 'fixtures')

function resolveFixturePath(nameOrPath: string): string {
  if (existsSync(nameOrPath)) return nameOrPath
  const p = join(fixturesDir, `${nameOrPath.replace(/\.json$/, '')}.json`)
  if (existsSync(p)) return p
  throw new Error(`fixture が見つからない: ${nameOrPath}`)
}

const args = process.argv.slice(2)
const traceMode = args.includes('--trace')
const verbose = args.includes('--verbose') || args.includes('-v')
const names = args.filter(a => !a.startsWith('-'))
if (names.length === 0) {
  console.error('使い方: npx tsx tools/mc-harness/runner/run.ts <fixture名|パス> [...] [--trace] [--verbose]')
  process.exit(1)
}

// --trace: diff の代わりに sim トレースを出力 (08 記法)。デバッグ用途なので diff はしない
if (traceMode) {
  for (const n of names) {
    const fx = JSON.parse(readFileSync(resolveFixturePath(n), 'utf-8')) as Fixture
    console.log(`# trace: ${fx.name}${verbose ? ' (verbose)' : ''}`)
    for (const line of traceFixtureOnSim(fx, { verbose })) console.log(line)
    console.log('')
  }
  process.exit(0)
}

let hardFailures = 0
for (const n of names) {
  const fx = JSON.parse(readFileSync(resolveFixturePath(n), 'utf-8')) as Fixture
  const diffs = diffFixtureAgainstSim(fx)
  if (diffs.length === 0) {
    console.log(`✔ ${fx.name}: 一致 (${fx.ticks + 1} tick 分)`)
    if (fx.skipUntil) {
      console.log(`  注意: skipUntil=${fx.skipUntil} が付いているが一致している。解消済みなら外すこと`)
    }
    continue
  }
  const mark = fx.skipUntil ? `△ (既知ギャップ skipUntil=${fx.skipUntil})` : '✘'
  console.log(`${mark} ${fx.name}: ${diffs.length} tick で不一致`)
  if (fx.skipReason) console.log(`  理由: ${fx.skipReason}`)
  for (const d of diffs) {
    console.log(`  tick ${d.tick}:`)
    for (const x of d.diffs) {
      console.log(`    ${x.pos}: 実機=${x.expected}`)
      console.log(`    ${' '.repeat(x.pos.length)}  sim =${x.actual}`)
    }
  }
  if (!fx.skipUntil) hardFailures++
}

process.exit(hardFailures > 0 ? 1 : 0)
