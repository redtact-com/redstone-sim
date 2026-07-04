// ============================================================
// fixture を SimWorld に流す共通ドライバ。
//
// tick 規約 (tools/mc-harness/README.md「tick 規約」/ fixture-runner.ts と一致):
//   state[t] = 「tick t の ScheduledTick フェーズ完了後、inputs[tick==t] を
//   適用した直後」の状態。
//
// packages/sim/test/fixture-runner.ts (CI 回帰) と app のデモページ (?demo=)
// の両方がこのモジュールを唯一の真実として使い、tick 意味論の二重実装を防ぐ。
// ============================================================

import { SimWorld, posKey, keyToPos } from './world.js'
import type { NotePlayEvent } from './world.js'
import { mcToSim, simToMc, canonicalize } from './mcstate.js'
import type { Pos3D, BlockState, WorldSnapshot } from './types.js'

// ── fixture の形 ──────────────────────────────────────────────────────────────

export interface FixtureInput {
  tick: number
  pos: Pos3D
  /**
   * 'use'  … 右クリック相当 (レバー/ボタン/ターゲット)。
   * 'step' … 感圧板を踏む相当。sim の手動モデルでは activateBlock で 'use' と同一に扱う。
   */
  action: 'use' | 'step'
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
  /**
   * blocks: 各ブロックの blockstate 文字列。コンテナ (hopper/dropper/container) は
   * items で初期個数を与えられる (アイテムは blockstate に現れないため item 数で初期化)。
   */
  blocks: { pos: Pos3D; block: string; items?: number }[]
  inputs: FixtureInput[]
  expect: FixtureExpectEntry[]
  generated?: { at: string; mc: string; carpet: string }
}

/** 'x,y,z' → 正規化 blockstate 文字列 のスナップショット */
export type StateMap = Map<string, string>

// ── world 構築 / tick 前進 / 観測 ──────────────────────────────────────────────

/**
 * fixture の authored blocks から SimWorld を組み立て、initialize() + flush(64) で
 * 初期安定化する (実機側の fx_settle + settle step に相当)。
 * 戻り値 authored は各座標の authored blockstate 文字列 (simToMc の復元ヒント用)。
 */
export function buildFixtureWorld(fx: Fixture): { world: SimWorld; authored: Map<string, string> } {
  const world = new SimWorld()
  const authored = new Map<string, string>()
  for (const b of fx.blocks) {
    authored.set(posKey(b.pos), b.block)
    const sim = mcToSim(b.block)
    if (sim) {
      // コンテナは items で初期個数を与える (blockstate に現れない BE 内容)
      if (b.items !== undefined && (sim.type === 'hopper' || sim.type === 'dropper' || sim.type === 'container')) {
        (sim as { count?: number }).count = b.items
      }
      world.setBlockAt(b.pos, sim)
    }
  }
  world.initialize()
  world.flush(64)
  return { world, authored }
}

/** その tick に発火する入力を返す */
export function fixtureInputsAt(fx: Fixture, t: number): FixtureInput[] {
  return fx.inputs.filter(i => i.tick === t)
}

/** その tick の入力を world へ適用する (activateBlock。'use'/'step' 共通) */
export function applyFixtureInputsAt(world: SimWorld, fx: Fixture, t: number): FixtureInput[] {
  const inputs = fixtureInputsAt(fx, t)
  for (const input of inputs) {
    world.activateBlock(input.pos[0], input.pos[1], input.pos[2])
  }
  return inputs
}

/**
 * region 全域を走査して StateMap を作る。
 * ピストン移動で authored 外の座標にもブロックが現れるため region 全域を見る。
 */
export function snapshotFixtureRegion(
  world: SimWorld,
  fx: Fixture,
  authored: Map<string, string>,
): StateMap {
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

/** fixture を sim で実行し、tick 0..ticks の StateMap 系列を返す */
export function runFixtureOnSim(fx: Fixture): StateMap[] {
  const { world, authored } = buildFixtureWorld(fx)
  const states: StateMap[] = []
  for (let t = 0; t <= fx.ticks; t++) {
    if (t > 0) world.tick()
    applyFixtureInputsAt(world, fx, t)
    states.push(snapshotFixtureRegion(world, fx, authored))
  }
  return states
}

// ── ステートフルな再生ドライバ (デモページ用) ──────────────────────────────────

export interface FixtureRunnerOptions {
  /** 音符ブロックの発音フック (settle 由来のイベントは発火しない)。 */
  onNotePlay?: (e: NotePlayEvent) => void
}

/**
 * fixture を 1 tick ずつ再生するステートフルドライバ。
 *
 * 構築時に buildFixtureWorld で settle し、tick 0 の入力まで適用した「起点状態」
 * (= runFixtureOnSim の states[0]) を持つ。以降 step() 毎に world.tick() →
 * その tick の入力適用、という runFixtureOnSim と同一の系列をたどる。
 */
export class FixtureRunner {
  readonly fixture: Fixture
  private world: SimWorld
  private authored: Map<string, string>
  private _tick = 0

  constructor(fx: Fixture, opts: FixtureRunnerOptions = {}) {
    this.fixture = fx
    const { world, authored } = buildFixtureWorld(fx)
    this.world = world
    this.authored = authored
    // settle 完了後にフックを付けてから tick 0 の入力を適用する。
    // (settle 中の発音は「起点前」の雑音として捨てる)
    if (opts.onNotePlay) this.world.onNotePlay(opts.onNotePlay)
    applyFixtureInputsAt(this.world, this.fixture, 0)
  }

  get tick(): number { return this._tick }
  get maxTicks(): number { return this.fixture.ticks }
  get done(): boolean { return this._tick >= this.fixture.ticks }

  /** 1 tick 進めてその tick の入力を適用する。末尾では no-op。 */
  step(): { tick: number; inputs: FixtureInput[] } {
    if (this._tick >= this.fixture.ticks) return { tick: this._tick, inputs: [] }
    this._tick++
    this.world.tick()
    const inputs = applyFixtureInputsAt(this.world, this.fixture, this._tick)
    return { tick: this._tick, inputs }
  }

  /** 現在 tick の region スナップショット (mc 正規化文字列) */
  stateMap(): StateMap {
    return snapshotFixtureRegion(this.world, this.fixture, this.authored)
  }

  /** 単一座標の正規化 blockstate 文字列 (無ければ 'air') */
  getStateAt(x: number, y: number, z: number): string {
    const sim = this.world.getBlock(x, y, z)
    if (!sim) return 'air'
    return canonicalize(simToMc(sim, this.authored.get(posKey([x, y, z]))))
  }

  /** viewer 用スナップショット。bounds は fixture.region に固定 (カメラフィット用)。 */
  worldSnapshot(): WorldSnapshot {
    const full = this.world.snapshot()
    const [x0, y0, z0] = this.fixture.region.from
    const [x1, y1, z1] = this.fixture.region.to
    const blocks = new Map<`${number},${number},${number}`, BlockState>()
    for (const [key, b] of full.blocks) {
      const [x, y, z] = keyToPos(key)
      if (x < x0 || x > x1 || y < y0 || y > y1 || z < z0 || z > z1) continue
      blocks.set(key as `${number},${number},${number}`, b)
    }
    return { blocks, bounds: { x: [x0, x1], y: [y0, y1], z: [z0, z1] } }
  }
}
