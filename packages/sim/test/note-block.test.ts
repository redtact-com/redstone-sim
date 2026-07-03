import { describe, it, expect } from 'vitest'
import { SimWorld } from '../src/world.js'
import type { NotePlayEvent } from '../src/world.js'
import type { BlockState } from '../src/types.js'
import { isSolidPowered, getStrongPower } from '../src/power.js'

// ── ヘルパー ──────────────────────────────────────────────────

function place(world: SimWorld, x: number, y: number, z: number, block: BlockState) {
  world.setBlock(x, y, z, block)
}
function lever(powered = false): BlockState {
  return { type: 'lever', facing: 'up', powered }
}
function noteBlock(powered = false, note = 0): BlockState {
  return { type: 'note_block', powered, note }
}
/** dot ワイヤー: 全方向 none。power は初期値 */
function dot(power = 0): BlockState {
  return { type: 'wire', connections: { north: false, south: false, east: false, west: false }, power }
}
/** cross ワイヤー: 全方向 side */
function cross(power = 0): BlockState {
  return { type: 'wire', connections: { north: true, south: true, east: true, west: true }, power }
}

// ─────────────────────────────────────────────────────────────
// C5: note block — 立ち上がり検出 + BE 発音 (#38)
// ─────────────────────────────────────────────────────────────

describe('note block: 立ち上がり検出と BE 発音', () => {
  /** lever(0,0,0) 隣の note_block(1,0,0)。直上は空気 (発音可) */
  function buildRig(): { world: SimWorld; plays: NotePlayEvent[] } {
    const world = new SimWorld()
    place(world, 0, 0, 0, lever(false))
    place(world, 1, 0, 0, noteBlock(false, 5))
    world.initialize()
    const plays: NotePlayEvent[] = []
    world.onNotePlay(e => plays.push(e))
    return { world, plays }
  }

  it('立ち上がり (OFF→ON) で発音 BE が予約され、tick の BE フェーズで 1 回鳴る', () => {
    const { world, plays } = buildRig()

    world.activateBlock(0, 0, 0)  // lever ON
    // NC で立ち上がり検出 → play BE をキュー (この時点では未実行)
    expect(world.getBlockEvents().map(e => e.param)).toEqual(['play'])
    expect(plays).toHaveLength(0)
    // note block の POWERED は即時 true になる
    expect(world.getBlockAt([1, 0, 0])).toMatchObject({ type: 'note_block', powered: true })

    world.tick()  // BE フェーズで発音
    expect(plays).toEqual([{ pos: [1, 0, 0], note: 5 }])
  })

  it('ON を維持したまま tick を重ねても再発音しない (立ち上がりのみ)', () => {
    const { world, plays } = buildRig()
    world.activateBlock(0, 0, 0)
    world.tick()
    expect(plays).toHaveLength(1)

    world.tick()
    world.tick()
    expect(plays).toHaveLength(1)  // 増えない
  })

  it('OFF→ON を繰り返すと毎回の立ち上がりで再発音する', () => {
    const { world, plays } = buildRig()

    world.activateBlock(0, 0, 0)  // ON (1回目)
    world.tick()
    expect(plays).toHaveLength(1)

    world.activateBlock(0, 0, 0)  // OFF (立ち下がり → 発音しない)
    world.tick()
    expect(plays).toHaveLength(1)
    expect(world.getBlockAt([1, 0, 0])).toMatchObject({ powered: false })

    world.activateBlock(0, 0, 0)  // ON (2回目)
    world.tick()
    expect(plays).toHaveLength(2)  // 再発音
  })

  it('立ち下がり (ON→OFF) では発音しない', () => {
    const { world, plays } = buildRig()
    world.activateBlock(0, 0, 0)  // ON
    world.tick()
    plays.length = 0             // 立ち上がり分をリセット

    world.activateBlock(0, 0, 0)  // OFF
    expect(world.getBlockEvents()).toHaveLength(0)  // play BE は予約されない
    world.tick()
    expect(plays).toHaveLength(0)
  })

  it('直上が塞がれた note block は発音しない (被覆条件)。POWERED は変化する', () => {
    const world = new SimWorld()
    place(world, 0, 0, 0, lever(false))
    place(world, 1, 0, 0, noteBlock(false))
    place(world, 1, 1, 0, { type: 'solid', powered: false })  // 直上を塞ぐ
    world.initialize()
    const plays: NotePlayEvent[] = []
    world.onNotePlay(e => plays.push(e))

    world.activateBlock(0, 0, 0)  // ON
    expect(world.getBlockEvents()).toHaveLength(0)  // 塞がれ → play BE 予約なし
    world.tick()
    expect(plays).toHaveLength(0)
    // POWERED 自体は更新される (発音有無に依らず)
    expect(world.getBlockAt([1, 0, 0])).toMatchObject({ powered: true })
  })

  it('発音 BE は trace に BE[Nb{n}] として現れる', () => {
    const { world } = buildRig()
    world.enableTrace()
    world.activateBlock(0, 0, 0)
    world.tick()
    const lines = world.getTrace()
    // 予約 (Nb(n.s)) と実行 (Nb{n.0}) の両方が出る
    expect(lines.some(l => /\[BE\]: Nb\(n/.test(l))).toBe(true)
    expect(lines.some(l => /\[BE\]: Nb\{n/.test(l))).toBe(true)
  })

  it('note block は導体で、直接充電された隣接 note block を鳴らせる (solid 同等)', () => {
    // lever → solid → note_block: solid が強充電され、その隣の note block が反応する
    const world = new SimWorld()
    place(world, 0, 0, 0, { type: 'lever', facing: 'north', powered: false }) // 取り付け面=south(solid)
    place(world, 0, 0, 1, { type: 'solid', powered: false })
    place(world, 0, 0, 2, noteBlock(false))
    world.initialize()
    const plays: NotePlayEvent[] = []
    world.onNotePlay(e => plays.push(e))

    world.activateBlock(0, 0, 0)  // lever ON → solid 強充電 → note block hasNeighborSignal
    world.tick()
    expect(plays).toHaveLength(1)
  })
})

// ─────────────────────────────────────────────────────────────
// C8: dust dot 形状 — 給電挙動 (#38)
// ─────────────────────────────────────────────────────────────

describe('dust dot: 給電挙動', () => {
  it('dot は横 (水平) に給電しない (cross は給電する)', () => {
    // redstone_block(0) → dot(1) → lamp(2)。dot は east=none なので lamp は点かない
    const buildRow = (mkWire: () => BlockState) => {
      const world = new SimWorld()
      place(world, 0, 0, 0, { type: 'redstone_block' })
      place(world, 1, 0, 0, mkWire())
      place(world, 2, 0, 0, { type: 'lamp', lit: false })
      world.initialize()
      return world
    }

    const dotWorld = buildRow(dot)
    expect(dotWorld.getBlockAt([1, 0, 0])).toMatchObject({ type: 'wire', power: 15 })
    expect(dotWorld.getBlockAt([2, 0, 0])).toMatchObject({ type: 'lamp', lit: false })

    const crossWorld = buildRow(cross)
    expect(crossWorld.getBlockAt([2, 0, 0])).toMatchObject({ type: 'lamp', lit: true })
  })

  it('dot は直下のブロックを弱充電する (down は給電する)', () => {
    // dot(1,1,0) の直下 solid(1,0,0)。東の redstone_block(2,1,0) が dot を 15 に
    const world = new SimWorld()
    place(world, 1, 1, 0, dot())
    place(world, 1, 0, 0, { type: 'solid', powered: false })
    place(world, 2, 1, 0, { type: 'redstone_block' })
    world.initialize()

    expect(world.getBlockAt([1, 1, 0])).toMatchObject({ type: 'wire', power: 15 })
    // 直下 solid は弱充電される (dot の down 出力)
    expect(isSolidPowered(world, [1, 0, 0])).toBe(true)
    // ただし強充電ではない (ダスト由来は弱充電のみ)
    expect(getStrongPower(world, [1, 0, 0])).toBe(0)
  })

  it('dot は直上のブロックに給電しない (up は出さない)', () => {
    // dot(1,0,0) の直上 lamp(1,1,0)。west の redstone_block(0,0,0) が dot を 15 に
    const world = new SimWorld()
    place(world, 0, 0, 0, { type: 'redstone_block' })
    place(world, 1, 0, 0, dot())
    place(world, 1, 1, 0, { type: 'lamp', lit: false })
    world.initialize()

    expect(world.getBlockAt([1, 0, 0])).toMatchObject({ type: 'wire', power: 15 })
    expect(world.getBlockAt([1, 1, 0])).toMatchObject({ type: 'lamp', lit: false })
  })
})
