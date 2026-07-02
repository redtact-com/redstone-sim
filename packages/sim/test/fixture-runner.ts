// ============================================================
// fixture を @redstone/sim に流して tick 状態系列を得る共通ロジック。
// - packages/sim/test/fixtures.test.ts (CI 回帰)
// - tools/mc-harness/runner/run.ts (手元 diff CLI)
// の両方から使う。
//
// tick 規約 (tools/mc-harness/README.md「tick 規約」と一致させること):
//   state[t] = 「tick t の ScheduledTick フェーズ完了後、inputs[tick==t] を
//   適用した直後」の状態。実機側は tick freeze 境界で fake player 入力を
//   適用してから dump するので同じ意味論になる。
// ============================================================

import { SimWorld, mcToSim, simToMc, canonicalize, posKey } from '@redstone/sim'
import type { Pos3D } from '@redstone/sim'

export interface FixtureInput {
  tick: number
  pos: Pos3D
  action: 'use'
}

export interface FixtureChange {
  pos: Pos3D
  block: string
}

export interface FixtureExpectEntry {
  tick: number
  changes: FixtureChange[]
}

export interface Fixture {
  name: string
  description?: string
  mcVersion: string
  skipUntil?: string
  skipReason?: string
  ticks: number
  region: { from: Pos3D; to: Pos3D }
  blocks: { pos: Pos3D; block: string }[]
  inputs: FixtureInput[]
  expect: FixtureExpectEntry[]
  generated?: { at: string; mc: string; carpet: string }
}

/** 'x,y,z' → 正規化 blockstate 文字列 のスナップショット */
export type StateMap = Map<string, string>

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

/** fixture を sim で実行し、tick 0..ticks の StateMap 系列を返す */
export function runFixtureOnSim(fx: Fixture): StateMap[] {
  const world = new SimWorld()
  const authored = new Map<string, string>()
  for (const b of fx.blocks) {
    authored.set(posKey(b.pos), b.block)
    const sim = mcToSim(b.block)
    if (sim) world.setBlockAt(b.pos, sim)
  }

  // 初期安定化 (実機側の fx_settle + settle step に相当)
  world.initialize()
  world.flush(64)

  const inputsAt = (t: number) => fx.inputs.filter(i => i.tick === t)
  // ピストン移動で authored 外の座標にもブロックが現れるため region 全域を走査する
  const snapshot = (): StateMap => {
    const m: StateMap = new Map()
    const [x0, y0, z0] = fx.region.from
    const [x1, y1, z1] = fx.region.to
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) {
      const key = posKey([x, y, z])
      const sim = world.getBlock(x, y, z)
      if (!sim) continue
      const s = simToMc(sim, authored.get(key))
      if (s !== 'air') m.set(key, canonicalize(s))
    }
    return m
  }

  const states: StateMap[] = []
  for (let t = 0; t <= fx.ticks; t++) {
    if (t > 0) world.tick()
    for (const input of inputsAt(t)) {
      if (input.action === 'use') {
        world.activateBlock(input.pos[0], input.pos[1], input.pos[2])
      }
    }
    states.push(snapshot())
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
  const world = new SimWorld()
  for (const b of fx.blocks) {
    const sim = mcToSim(b.block)
    if (sim) world.setBlockAt(b.pos, sim)
  }
  world.initialize()
  world.flush(64)
  // settle 由来のイベントを捨て、入力駆動分だけを起点 0 から集める
  world.enableTrace({ verbose: opts.verbose })
  world.clearTrace()

  const inputsAt = (t: number) => fx.inputs.filter(i => i.tick === t)
  for (let t = 0; t <= fx.ticks; t++) {
    if (t > 0) world.tick()
    for (const input of inputsAt(t)) {
      if (input.action === 'use') {
        world.activateBlock(input.pos[0], input.pos[1], input.pos[2])
      }
    }
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
