// ============================================================
// fixture を @redstone/sim に流して tick 状態系列を得る回帰ロジック。
// - packages/sim/test/fixtures.test.ts (CI 回帰)
// - tools/mc-harness/runner/run.ts (手元 diff CLI)
// の両方から使う。
//
// tick 前進・world 構築・region 観測は packages/sim の fixture-driver に集約し
// (デモページ ?demo= と共通)、ここでは expect (実機 ground truth) との突き合わせ
// (expandExpect / diff) とトレース収集だけを担う。
//
// tick 規約 (tools/mc-harness/README.md「tick 規約」と一致):
//   state[t] = 「tick t の ScheduledTick フェーズ完了後、inputs[tick==t] を
//   適用した直後」の状態。実機側は tick freeze 境界で fake player 入力を
//   適用してから dump するので同じ意味論になる。
// ============================================================

import {
  canonicalize, posKey,
  buildFixtureWorld, applyFixtureInputsAt, runFixtureOnSim,
} from '@redstone/sim'
import type { Fixture, FixtureInput, FixtureChange, FixtureExpectEntry, StateMap } from '@redstone/sim'

// fixture 型・world ドライバは @redstone/sim (fixture-driver) が正。ここで再輸出して
// 既存 import 元 (fixtures.test / trace.test / tools/mc-harness) の参照を保つ。
export type { Fixture, FixtureInput, FixtureChange, FixtureExpectEntry, StateMap }
export { runFixtureOnSim }

/** fixture の authored blocks から初期 StateMap を作る */
export function authoredStateMap(fx: Fixture): StateMap {
  const m: StateMap = new Map()
  for (const b of fx.blocks) {
    m.set(posKey(b.pos), canonicalize(b.block))
  }
  return m
}

/** expect (tick 毎差分) を適用して各 tick の完全な StateMap 系列に展開する */
export function expandExpect(fx: Fixture): StateMap[] {
  const states: StateMap[] = []
  let cur = authoredStateMap(fx)
  const byTick = new Map<number, FixtureChange[]>()
  for (const e of fx.expect) byTick.set(e.tick, e.changes)
  for (let t = 0; t <= fx.ticks; t++) {
    cur = new Map(cur)
    for (const c of byTick.get(t) ?? []) {
      if (c.block === 'air') cur.delete(posKey(c.pos))
      else cur.set(posKey(c.pos), c.block)
    }
    states.push(cur)
  }
  return states
}

/**
 * fixture を sim で実行し、トレース (docs/research/08 記法) を 1 行 1 イベントの
 * 文字列配列で返す。初期 settle は clearTrace で捨て、入力起点 (tick 0..) からの
 * トレースだけを集める。verbose で updateFormula (bu 発行内訳) 行も出力する。
 * トレース発行はイベント発行点に副作用を入れないため、状態系列は
 * runFixtureOnSim と完全に一致する (回帰は fixtures.test.ts が担保)。
 */
export function traceFixtureOnSim(fx: Fixture, opts: { verbose?: boolean } = {}): string[] {
  const { world } = buildFixtureWorld(fx)
  // settle 由来のイベントを捨て、入力駆動分だけを起点 0 から集める
  world.enableTrace({ verbose: opts.verbose })
  world.clearTrace()

  for (let t = 0; t <= fx.ticks; t++) {
    if (t > 0) world.tick()
    applyFixtureInputsAt(world, fx, t)
  }
  return world.getTrace()
}

export interface TickDiff {
  tick: number
  diffs: { pos: string; expected: string; actual: string }[]
}

/** 2 つの StateMap 系列を比較し、不一致のみ返す */
export function diffStateSeries(expected: StateMap[], actual: StateMap[]): TickDiff[] {
  const result: TickDiff[] = []
  const n = Math.max(expected.length, actual.length)
  for (let t = 0; t < n; t++) {
    const e = expected[t] ?? new Map()
    const a = actual[t] ?? new Map()
    const keys = new Set([...e.keys(), ...a.keys()])
    const diffs: TickDiff['diffs'] = []
    for (const k of [...keys].sort()) {
      const ev = e.get(k) ?? 'air'
      const av = a.get(k) ?? 'air'
      if (ev !== av) diffs.push({ pos: k, expected: ev, actual: av })
    }
    if (diffs.length > 0) result.push({ tick: t, diffs })
  }
  return result
}

/** fixture の expect (実機 ground truth) と sim 実行結果の diff を取る */
export function diffFixtureAgainstSim(fx: Fixture): TickDiff[] {
  return diffStateSeries(expandExpect(fx), runFixtureOnSim(fx))
}
