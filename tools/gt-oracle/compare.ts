// ============================================================
// 26.3 で撮った結果を比べる (#439)。
//
// 使い方:
//   npx tsx tools/gt-oracle/compare.ts --run <作業フォルダ>
//     … <作業フォルダ>/fixtures/<名前>.json (26.3) を、1.21.1 の生成済み
//       (packages/sim/test/fixtures/<名前>.json) の expect と比べる。差は「tick・座標・期待・実際」で出し、
//       無ければ「無い」と出す。<作業フォルダ>/compare.md にも書く。
//       差は版差の手がかりで、失敗ではない (仕分けは O3。docs/research/18 §8)。終了コードは 0
//   npx tsx tools/gt-oracle/compare.ts --same <作業フォルダ A> <作業フォルダ B>
//     … 同じ定義を 2 回撮った結果 (results/<名前>.json) が、tick ごとのブロックと入力の効き方まで一致するかを見る。
//       一致しなければ終了コード 1
//
// 比べ方は sim の回帰 (fixtures.test.ts) と同じで、expect を tick ごとの盤面に広げて
// (expandExpect)、盤面どうしを比べる (diffStateSeries)。材質の違いは畳んで比べる。
// ============================================================

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { diffStateSeries, expandExpect, type Fixture } from '../../packages/sim/test/fixture-runner.js'
import { gtDir } from './fetch-jar.js'
import { readRun, type OracleResult } from './to-fixture.js'

export const baselineDir = join(gtDir, '..', '..', 'packages', 'sim', 'test', 'fixtures')

export interface DiffRow {
  tick: number
  pos: string
  /** 1.21.1 の expect の盤面 (canonicalize 済み) */
  expected: string
  /** 26.3 の盤面 (canonicalize 済み) */
  actual: string
}

/** 1.21.1 の fixture と 26.3 の fixture を tick ごとの盤面で比べる。長さが違えば長い方まで見る */
export function diffAgainstBaseline(baseline: Fixture, oracle: Fixture): DiffRow[] {
  return diffStateSeries(expandExpect(baseline), expandExpect(oracle))
    .flatMap(d => d.diffs.map(x => ({ tick: d.tick, pos: x.pos, expected: x.expected, actual: x.actual })))
}

/** 比べる前に確かめること。回路や tick 数が違えば、差は版差ではない */
export function baselineMismatch(baseline: Fixture, oracle: Fixture): string[] {
  const out: string[] = []
  if (baseline.ticks !== oracle.ticks) out.push(`ticks が違う (1.21.1: ${baseline.ticks} / 26.3: ${oracle.ticks})`)
  const key = (f: Fixture) => JSON.stringify({ region: f.region, blocks: f.blocks, inputs: f.inputs })
  if (key(baseline) !== key(oracle)) out.push('region・blocks・inputs のどれかが違う (同じ回路を比べていない)')
  return out
}

export function formatBaselineReport(name: string, baselineMc: string, oracleMc: string, rows: readonly DiffRow[], notes: readonly string[] = []): string {
  const lines = [`### ${name}`, '']
  for (const n of notes) lines.push(`- 注意: ${n}`)
  if (notes.length > 0) lines.push('')
  if (rows.length === 0) {
    lines.push(`${baselineMc} の expect との差は無い。`)
  } else {
    lines.push(`${baselineMc} の expect との差が ${rows.length} 件ある。`, '')
    lines.push(`| tick | 座標 | 期待 (${baselineMc}) | 実際 (${oracleMc}) |`, '|---|---|---|---|')
    for (const r of rows) lines.push(`| ${r.tick} | ${r.pos} | ${r.expected} | ${r.actual} |`)
  }
  return lines.join('\n')
}

export interface RunDiffRow {
  name: string
  tick: number | null
  what: string
  a: string
  b: string
}

/** 2 回撮った結果を比べる。時刻・所要時間・gameTime は比べない (チャンクの待ちで変わる) */
export function diffRuns(name: string, a: OracleResult | undefined, b: OracleResult | undefined): RunDiffRow[] {
  if (!a || !b) return [{ name, tick: null, what: '結果', a: a ? 'あり' : 'なし', b: b ? 'あり' : 'なし' }]
  const rows: RunDiffRow[] = []
  if ((a.error ?? '') !== (b.error ?? '')) rows.push({ name, tick: null, what: '失敗', a: a.error ?? 'なし', b: b.error ?? 'なし' })
  const ticks = new Set([...a.ticks.map(t => t.tick), ...b.ticks.map(t => t.tick)])
  for (const t of [...ticks].sort((x, y) => x - y)) {
    const ea = a.ticks.find(s => s.tick === t)?.blocks ?? {}
    const eb = b.ticks.find(s => s.tick === t)?.blocks ?? {}
    for (const k of [...new Set([...Object.keys(ea), ...Object.keys(eb)])].sort()) {
      if (ea[k] !== eb[k]) rows.push({ name, tick: t, what: k, a: ea[k] ?? 'air', b: eb[k] ?? 'air' })
    }
  }
  const inputKey = (r: OracleResult) => JSON.stringify(r.inputs.map(({ gameTime: _g, ...rest }) => rest))
  if (inputKey(a) !== inputKey(b)) rows.push({ name, tick: null, what: '入力の効き方', a: inputKey(a), b: inputKey(b) })
  return rows
}

function compareWithBaseline(runDir: string): void {
  const { plan } = readRun(runDir)
  const sections: string[] = [`## 26.3 と 1.21.1 の expect の差 (${runDir.split('/').pop()})`, '']
  for (const def of plan.fixtures) {
    const oraclePath = join(runDir, 'fixtures', `${def.name}.json`)
    const basePath = join(baselineDir, `${def.name}.json`)
    if (!existsSync(oraclePath)) {
      sections.push(`### ${def.name}`, '', '26.3 の fixture が無い (撮れていないか、settle 照合が合わなかった)。', '')
      continue
    }
    if (!existsSync(basePath)) {
      sections.push(`### ${def.name}`, '', '1.21.1 の生成済みの fixture が無い。', '')
      continue
    }
    const oracle = JSON.parse(readFileSync(oraclePath, 'utf-8')) as Fixture
    const baseline = JSON.parse(readFileSync(basePath, 'utf-8')) as Fixture
    const rows = diffAgainstBaseline(baseline, oracle)
    sections.push(formatBaselineReport(def.name, baseline.generated?.mc ?? baseline.mcVersion, oracle.mcVersion, rows, baselineMismatch(baseline, oracle)), '')
  }
  const text = sections.join('\n')
  writeFileSync(join(runDir, 'compare.md'), text + '\n')
  console.log(text)
}

function compareRuns(dirA: string, dirB: string): boolean {
  const a = readRun(dirA)
  const b = readRun(dirB)
  const names = [...new Set([...a.plan.fixtures.map(f => f.name), ...b.plan.fixtures.map(f => f.name)])]
  const rows = names.flatMap(n => diffRuns(n, a.results.get(n), b.results.get(n)))
  if (rows.length === 0) {
    console.log(`2 回の結果は一致した (${names.length} 本${names.length <= 10 ? `: ${names.join(', ')}` : ''})`)
    return true
  }
  console.log(`2 回の結果が ${rows.length} か所で違う:`)
  console.log('| fixture | tick | 座標・項目 | 1 回目 | 2 回目 |\n|---|---|---|---|---|')
  for (const r of rows) console.log(`| ${r.name} | ${r.tick ?? '-'} | ${r.what} | ${r.a} | ${r.b} |`)
  return false
}

function main(): void {
  const args = process.argv.slice(2)
  if (args[0] === '--run' && args[1]) {
    compareWithBaseline(args[1])
  } else if (args[0] === '--same' && args[1] && args[2]) {
    if (!compareRuns(args[1], args[2])) process.exit(1)
  } else {
    console.error('使い方: npx tsx tools/gt-oracle/compare.ts --run <作業フォルダ> | --same <作業フォルダ A> <作業フォルダ B>')
    process.exit(1)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
