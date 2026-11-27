// ============================================================
// オラクルの結果 (results/<名前>.json) を、今の fixture の形式に写す (docs/research/18 §4.1 の 5・§7)。
//
// 使い方: npx tsx tools/gt-oracle/to-fixture.ts --run <作業フォルダ>
//   <作業フォルダ>/fixtures/<名前>.json に書く。**手元に出すだけで、コミットしない** (置き場は O3 で決める)
//
// 写し方は今のハーネスの generate.ts の後半と同じで、関数もそのまま使う:
//   - 実機の文字列を書く形にそろえる (名前空間を外してキーを並べる。材質は畳まない)
//   - settle 照合: 定義の blocks と tick -1 を、両側を canonicalize して比べる
//   - expect: tick 0 の基準を定義の blocks にして、tick ごとの差分を並べる
// 版と採取系 (R18 §7.1):
//   - mcVersion と generated.mc に、jar から読んだ版 (26.3) を書く
//   - generated.carpet は "none"。generated.oracle に採取系の名前と起動コードのコミットを書く
//   - startGameTime (R18 §7.2) に、tick -1 を撮った時点の gameTime を書く
// ============================================================

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  buildExpect, fixtureBlocks, normalizeState, settleMismatches, type SettleMismatch,
} from '../mc-harness/runner/generate.js'
import type { Fixture } from '../../packages/sim/test/fixture-runner.js'
import { gtDir } from './fetch-jar.js'
import type { Plan, PlanFixture } from './gen-datapack.js'

/** Driver.java が書く 1 tick 分 */
export interface OracleSnapshot {
  tick: number
  gameTime: number
  /** 'x,y,z' → 名前空間つきの blockstate (空気は持たない) */
  blocks: Record<string, string>
}

/** Driver.java が書く 1 本分 (results/<名前>.json) */
export interface OracleResult {
  name: string
  oracle: string
  mc: string
  dataVersion: number
  placedGameTime: number
  startGameTime: number
  chunkWaitTicks: number
  chunkWaitMs: number
  wallMs: number
  inputs: Record<string, unknown>[]
  ticks: OracleSnapshot[]
  error?: string
}

/** Driver.java が書く 1 回分 (results/_run.json) */
export interface OracleRunSummary {
  oracle: string
  mc: string
  dataVersion: number
  bootMs: number
  driveMs: number
  enabledFeatures: string[]
  gameRules: Record<string, boolean | number>
  fixtures: { name: string; ok: boolean; wallMs: number; chunkWaitTicks: number; chunkWaitMs: number; error?: string }[]
  error?: string
}

/** 26.3 の fixture。今の Fixture に、採取系の欄と startGameTime を足したもの */
export type OracleFixture = Omit<Fixture, 'generated'> & {
  startGameTime: number
  generated: {
    at: string
    mc: string
    carpet: 'none'
    oracle: { name: string; commit: string; dataVersion: number }
  }
}

export interface ToFixtureResult {
  fixture: OracleFixture
  /** settle 照合で食い違った座標 (空なら一致) */
  settle: SettleMismatch[]
}

/** 結果の文字列を書く形にそろえる (名前空間を外してキーを並べる) */
export function normalizeSnapshots(ticks: readonly OracleSnapshot[]): { tick: number; blocks: Record<string, string> }[] {
  return ticks.map(t => ({
    tick: t.tick,
    blocks: Object.fromEntries(Object.entries(t.blocks).map(([k, v]) => [k, normalizeState(v)])),
  }))
}

export function resultToFixture(
  def: PlanFixture, result: OracleResult, meta: { at: string; commit: string },
): ToFixtureResult {
  if (result.error) throw new Error(`${result.name}: オラクルが失敗している: ${result.error}`)
  if (result.name !== def.name) throw new Error(`結果の name が ${result.name} で、定義の ${def.name} と違う`)
  const ticks = normalizeSnapshots(result.ticks)
  const settled = ticks.find(t => t.tick === -1)
  if (!settled) throw new Error(`${def.name}: tick -1 (settle 後) が結果に無い`)
  const settle = settleMismatches(def.blocks, settled.blocks)
  const expect = buildExpect(def.blocks, ticks, def.ticks)
  const { source: _source, ...rest } = def
  const fixture: OracleFixture = {
    ...rest,
    mcVersion: result.mc,
    blocks: fixtureBlocks(def.blocks),
    expect,
    startGameTime: result.startGameTime,
    generated: {
      at: meta.at,
      mc: result.mc,
      carpet: 'none',
      oracle: { name: result.oracle, commit: meta.commit, dataVersion: result.dataVersion },
    },
  }
  return { fixture, settle }
}

/** 起動コードのコミット。java/ に未コミットの変更があれば -dirty を付ける */
export function oracleCommit(): string {
  try {
    const head = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: gtDir, encoding: 'utf-8' }).trim()
    const dirty = execFileSync('git', ['status', '--porcelain', '--', 'java'], { cwd: gtDir, encoding: 'utf-8' }).trim()
    return dirty ? `${head}-dirty` : head
  } catch {
    return 'unknown'
  }
}

export function readRun(runDir: string): { plan: Plan; summary: OracleRunSummary | null; results: Map<string, OracleResult> } {
  const plan = JSON.parse(readFileSync(join(runDir, 'plan.json'), 'utf-8')) as Plan
  const summaryPath = join(runDir, 'results', '_run.json')
  const summary = existsSync(summaryPath) ? JSON.parse(readFileSync(summaryPath, 'utf-8')) as OracleRunSummary : null
  const results = new Map<string, OracleResult>()
  for (const f of plan.fixtures) {
    const p = join(runDir, 'results', `${f.name}.json`)
    if (existsSync(p)) results.set(f.name, JSON.parse(readFileSync(p, 'utf-8')) as OracleResult)
  }
  return { plan, summary, results }
}

function main(): void {
  const args = process.argv.slice(2)
  const i = args.indexOf('--run')
  const runDir = i >= 0 ? args[i + 1] : undefined
  if (!runDir) {
    console.error('使い方: npx tsx tools/gt-oracle/to-fixture.ts --run <作業フォルダ>')
    process.exit(1)
  }
  const { plan, summary, results } = readRun(runDir)
  if (summary?.error) console.error(`オラクル全体の失敗: ${summary.error}`)
  const outDir = join(runDir, 'fixtures')
  mkdirSync(outDir, { recursive: true })
  const meta = { at: new Date().toISOString(), commit: oracleCommit() }
  let failed = 0
  for (const def of plan.fixtures) {
    const result = results.get(def.name)
    if (!result) {
      console.error(`${def.name}: 結果が無い`)
      failed++
      continue
    }
    try {
      const { fixture, settle } = resultToFixture(def, result, meta)
      if (settle.length > 0) {
        console.error(`${def.name}: settle 照合が合わない (定義を直すか、版差として仕分ける):`)
        for (const d of settle) console.error(`  ${d.pos}: 定義=${d.authored} → 実機=${d.settled}`)
        failed++
        continue
      }
      writeFileSync(join(outDir, `${def.name}.json`), JSON.stringify(fixture, null, 2) + '\n')
      console.log(`${def.name}: fixture を書いた (変化のあった tick: ${fixture.expect.map(e => e.tick).join(', ') || 'なし'})`)
    } catch (e) {
      console.error(e instanceof Error ? e.message : e)
      failed++
    }
  }
  if (failed > 0 || summary?.error) process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
