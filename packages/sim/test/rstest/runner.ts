// ============================================================
// .rstest ランナー (#71)
//
// ParsedRstest → Fixture (expect は空) を組み、fixture-runner に載せる:
//   - state 断言 … runFixtureOnSim(fx) の tick 系列と照合
//   - trace 断言 … trace (部分一致=順序保存部分列, verbose=true) /
//                  trace strict (完全一致, verbose=false) を traceFixtureOnSim で照合
//
// tick 規約は fixture-runner と同一: state[t] = 「tick t の ST 完了 + inputs[t] 適用後」。
// trace の gt は traceFixtureOnSim が出力する実 gt (settle 分のオフセットを含む) を
// そのまま用いる。期待行は実際に流して得た行から書き写す (捏造しない)。
// ============================================================

import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { canonicalize, posKey } from '@redstone/sim'
import type { Pos3D } from '@redstone/sim'
import {
  runFixtureOnSim,
  traceFixtureOnSim,
  type Fixture,
} from '../fixture-runner.js'
import type { ParsedRstest } from './parse.js'

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures')

type RBlock = { pos: Pos3D; block: string; items?: number }

/** ParsedRstest を fixture-runner が食える Fixture へ組み立てる */
export function buildFixture(parsed: ParsedRstest): Fixture {
  // 1) fixture 参照があれば blocks/inputs/ticks の土台を取り込む
  let base: Fixture | undefined
  if (parsed.fixture) {
    const path = join(fixturesDir, `${parsed.fixture}.json`)
    try {
      base = JSON.parse(readFileSync(path, 'utf-8')) as Fixture
    } catch (e) {
      throw new Error(`fixture "${parsed.fixture}" を読めません (${path}): ${(e as Error).message}`)
    }
  }

  // 2) circuit を position で追加/上書き (範囲 fill は直方体展開)
  const blockMap = new Map<string, RBlock>()
  for (const b of base?.blocks ?? []) {
    blockMap.set(posKey(b.pos), { pos: b.pos, block: b.block, items: b.items })
  }
  for (const c of parsed.circuit) {
    const [x0, x1] = [Math.min(c.from[0], c.to[0]), Math.max(c.from[0], c.to[0])]
    const [y0, y1] = [Math.min(c.from[1], c.to[1]), Math.max(c.from[1], c.to[1])]
    const [z0, z1] = [Math.min(c.from[2], c.to[2]), Math.max(c.from[2], c.to[2])]
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) {
      blockMap.set(posKey([x, y, z]), { pos: [x, y, z], block: c.block, items: c.items })
    }
  }
  const blocks = [...blockMap.values()]

  // 3) inputs は fixture のものに rstest 側を追記
  const inputs = [
    ...(base?.inputs ?? []),
    ...parsed.inputs.map(i => ({ tick: i.tick, action: i.action, pos: i.pos })),
  ]

  // 4) ticks: rstest 明示 > fixture > max(input tick)+8
  const maxInputTick = inputs.reduce((m, i) => Math.max(m, i.tick), 0)
  const ticks = parsed.ticks ?? base?.ticks ?? maxInputTick + 8

  // 5) region: fixture region ∪ 全 block bbox ∪ state 断言位置 を包含する
  const region = computeRegion(base?.region, blocks, parsed)

  return {
    name: parsed.meta.name,
    description: parsed.meta.ref,
    mcVersion: base?.mcVersion ?? '1.21.1',
    ticks,
    region,
    blocks,
    inputs,
    expect: [],
  }
}

function computeRegion(
  fixtureRegion: { from: Pos3D; to: Pos3D } | undefined,
  blocks: RBlock[],
  parsed: ParsedRstest,
): { from: Pos3D; to: Pos3D } {
  const pts: Pos3D[] = []
  if (fixtureRegion) { pts.push(fixtureRegion.from, fixtureRegion.to) }
  for (const b of blocks) pts.push(b.pos)
  for (const s of parsed.state) pts.push(s.pos)
  if (pts.length === 0) {
    throw new Error('circuit も fixture も無いため region を決定できません')
  }
  const from: Pos3D = [Infinity, Infinity, Infinity]
  const to: Pos3D = [-Infinity, -Infinity, -Infinity]
  for (const p of pts) for (let a = 0; a < 3; a++) {
    from[a] = Math.min(from[a], p[a])
    to[a] = Math.max(to[a], p[a])
  }
  return { from, to }
}

/** 実行 + 断言。失敗はすべて集めて 1 つの Error にまとめて投げる */
export function runRstest(parsed: ParsedRstest): void {
  const fx = buildFixture(parsed)
  const failures: string[] = []

  // --- state 断言 ---
  if (parsed.state.length > 0) {
    const states = runFixtureOnSim(fx)
    for (const s of parsed.state) {
      if (s.tick < 0 || s.tick >= states.length) {
        failures.push(
          `state[t${s.tick}] は範囲外です (ticks=${fx.ticks}, 有効 t=0..${states.length - 1})`,
        )
        continue
      }
      const expected = canonicalize(s.block)
      const actual = states[s.tick].get(posKey(s.pos)) ?? 'air'
      if (actual !== expected) {
        failures.push(
          `state[t${s.tick}] (${s.pos.join(',')}) 不一致:\n` +
          `    expected: ${expected}\n` +
          `    actual:   ${actual}`,
        )
      }
    }
  }

  // --- trace 断言 ---
  if (parsed.trace) {
    if (parsed.trace.strict) {
      const actual = traceFixtureOnSim(fx, { verbose: false })
      const expected = parsed.trace.lines
      if (!arrayEq(actual, expected)) {
        failures.push(formatStrictFailure(expected, actual))
      }
    } else {
      const actual = traceFixtureOnSim(fx, { verbose: true })
      const err = matchSubsequence(parsed.trace.lines, actual)
      if (err) failures.push(err)
    }
  }

  if (failures.length > 0) {
    throw new Error(`[${parsed.meta.name}] ${failures.length} 件の不一致:\n\n` + failures.join('\n\n'))
  }
}

function arrayEq(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i])
}

/** 順序保存部分列マッチ。失敗時は整形メッセージ、成功時は null */
function matchSubsequence(expected: string[], actual: string[]): string | null {
  let i = 0
  for (const line of expected) {
    let found = -1
    for (let j = i; j < actual.length; j++) {
      if (actual[j] === line) { found = j; break }
    }
    if (found < 0) {
      const gtm = /^(\d+)gt\[/.exec(line)
      let context: string
      if (gtm) {
        const gt = gtm[1]
        const same = actual.filter(l => l.startsWith(`${gt}gt[`))
        context = same.length > 0
          ? same.map(l => `    ${l}`).join('\n')
          : `    (${gt}gt の実トレース行なし)`
      } else {
        context = actual.slice(i, i + 6).map(l => `    ${l}`).join('\n') || '    (残りの実トレースなし)'
      }
      return (
        `トレース (部分一致) が見つかりません:\n` +
        `  期待行: ${line}\n` +
        `  検索再開位置: index ${i} / 全 ${actual.length} 行\n` +
        `  該当 gt の実トレース:\n${context}`
      )
    }
    i = found + 1
  }
  return null
}

function formatStrictFailure(expected: string[], actual: string[]): string {
  const n = Math.max(expected.length, actual.length)
  const rows: string[] = []
  for (let k = 0; k < n; k++) {
    const e = expected[k] ?? '(なし)'
    const a = actual[k] ?? '(なし)'
    const mark = e === a ? '  ' : '✗ '
    rows.push(`  ${mark}[${k}] expected: ${e}\n       actual:   ${a}`)
  }
  return `トレース (strict) が完全一致しません:\n` + rows.join('\n')
}
