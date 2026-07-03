import { describe, it, expect } from 'vitest'
import { SimWorld } from '../src/world.js'
import type { BlockState, WireState, WireConnections } from '../src/types.js'

/**
 * 電力モデル (weak/strong) のテスト。issue #10 / I2。
 * docs/research/02 §5 の意味論に基づく手書き期待値:
 *   - dust は「足元 + 接続方向」のブロックを弱充電する
 *   - 弱充電された固体は隣接機構を作動させるが dust には給電しない
 *   - 強充電された固体は dust にも給電する
 *   - トーチは取り付け面以外の 5 方向へ weak 15、直上のみ strong 15
 *   - レバー/ボタンの strong は取り付け面のみ、weak は全方向
 */

const cross: WireConnections = { north: true, south: true, east: true, west: true }

function wire(connections: Partial<WireConnections> = {}): WireState {
  return { type: 'wire', connections: { ...cross, ...connections }, power: 0 }
}
function lever(powered = false, facing: 'up' | 'north' | 'south' | 'east' | 'west' = 'up'): BlockState {
  return { type: 'lever', facing, powered }
}
function solid(): BlockState {
  return { type: 'solid', powered: false }
}
function lamp(): BlockState {
  return { type: 'lamp', lit: false }
}
function torch(lit = true): BlockState {
  return { type: 'torch', facing: 'up', lit }
}
function repeater(facing: 'north'|'south'|'east'|'west', delay: 1|2|3|4 = 1): BlockState {
  return { type: 'repeater', facing, delay, powered: false, locked: false }
}
function comparator(facing: 'north'|'south'|'east'|'west'): BlockState {
  return { type: 'comparator', facing, mode: 'compare', powered: false, outputPower: 0 }
}

// ─────────────────────────────────────────────────────────────
// 系統1: dust → solid (弱充電) → 機構
// ─────────────────────────────────────────────────────────────

describe('弱充電された固体: 隣接機構は作動するが dust には給電しない', () => {
  it('dust → solid → repeater → lamp が作動する (G4)', () => {
    const world = new SimWorld()
    world.setBlock(0, 0, 0, lever(false))
    world.setBlock(1, 0, 0, wire())
    world.setBlock(2, 0, 0, solid())
    world.setBlock(3, 0, 0, repeater('east'))
    world.setBlock(4, 0, 0, lamp())

    world.activateBlock(0, 0, 0)
    world.flush()

    expect(world.getBlock(3, 0, 0)).toMatchObject({ type: 'repeater', powered: true })
    expect(world.getBlock(4, 0, 0)).toMatchObject({ type: 'lamp', lit: true })
  })

  it('dust → solid → comparator → lamp が作動する (G4, 背面の固体読み取り)', () => {
    const world = new SimWorld()
    world.setBlock(0, 0, 0, lever(false))
    world.setBlock(1, 0, 0, wire())
    world.setBlock(2, 0, 0, solid())
    world.setBlock(3, 0, 0, comparator('east'))
    world.setBlock(4, 0, 0, lamp())

    world.activateBlock(0, 0, 0)
    world.flush()

    expect(world.getBlock(3, 0, 0)).toMatchObject({ type: 'comparator', powered: true, outputPower: 15 })
    expect(world.getBlock(4, 0, 0)).toMatchObject({ type: 'lamp', lit: true })
  })

  it('dust → solid → lamp が点灯する (G4)', () => {
    const world = new SimWorld()
    world.setBlock(0, 0, 0, lever(false))
    world.setBlock(1, 0, 0, wire())
    world.setBlock(2, 0, 0, solid())
    world.setBlock(3, 0, 0, lamp())

    world.activateBlock(0, 0, 0)

    expect(world.getBlock(3, 0, 0)).toMatchObject({ type: 'lamp', lit: true })

    world.activateBlock(0, 0, 0)  // OFF
    // ランプ消灯は 4gt の tile tick 遅延 (02 §6 lamp [確定])
    expect(world.getBlock(3, 0, 0)).toMatchObject({ type: 'lamp', lit: true })
    world.flush()
    expect(world.getBlock(3, 0, 0)).toMatchObject({ type: 'lamp', lit: false })
  })

  it('dust → solid → torch がブロック越しで消灯する (G4)', () => {
    const world = new SimWorld()
    // wire(1,0,0) が solid(2,0,0) を弱充電 → 上のトーチ(2,1,0) が消灯
    world.setBlock(0, 0, 0, lever(false))
    world.setBlock(1, 0, 0, wire())
    world.setBlock(2, 0, 0, solid())
    world.setBlock(2, 1, 0, torch(true))

    world.activateBlock(0, 0, 0)
    world.flush()

    expect(world.getBlock(2, 1, 0)).toMatchObject({ type: 'torch', lit: false })
  })

  it('dust → solid → dust は給電しない (弱充電は dust に見えない)', () => {
    const world = new SimWorld()
    world.setBlock(0, 0, 0, lever(false))
    world.setBlock(1, 0, 0, wire())
    world.setBlock(2, 0, 0, solid())
    world.setBlock(3, 0, 0, wire())

    world.activateBlock(0, 0, 0)
    world.flush()

    expect(world.getBlock(1, 0, 0)).toMatchObject({ type: 'wire', power: 15 })
    expect(world.getBlock(3, 0, 0)).toMatchObject({ type: 'wire', power: 0 })
  })

  it('dust が接続方向を向いていない solid は充電しない (G14)', () => {
    const world = new SimWorld()
    // wire(1,0,0) は north/south のみ接続 → 西の solid(0,0,0) を充電しない。
    // 直線 NS は実接続 (南北の wire) で作る (#51: 横に lever を置くと接続が
    // 生えて直線 EW に張り替わるため、給電は直下の redstone_block から行う)
    world.setBlock(0, 0, 0, solid())
    world.setBlock(0, 1, 0, torch(true))
    world.setBlock(1, 0, -1, wire({ east: false, west: false }))
    world.setBlock(1, 0, 0, wire({ east: false, west: false }))
    world.setBlock(1, 0, 1, wire({ east: false, west: false }))
    world.setBlock(1, -1, 0, { type: 'redstone_block' })
    world.initialize()
    world.flush()

    expect(world.getBlock(1, 0, 0)).toMatchObject({ type: 'wire', power: 15 })
    expect(world.getBlock(0, 1, 0)).toMatchObject({ type: 'torch', lit: true })
  })
})

// ─────────────────────────────────────────────────────────────
// 系統2: トーチの給電方向 (G3)
// ─────────────────────────────────────────────────────────────

describe('トーチの給電方向 (G3)', () => {
  it('床置きトーチの横のワイヤーが 15 になる (横取り出し)', () => {
    const world = new SimWorld()
    world.setBlock(0, 0, 0, torch(true))
    world.setBlock(1, 0, 0, wire())
    world.initialize()

    expect(world.getBlock(1, 0, 0)).toMatchObject({ type: 'wire', power: 15 })
  })

  it('床置きトーチは直上の solid のみ強充電し、隣の dust へ 15 を渡す', () => {
    const world = new SimWorld()
    // torch(0,0,0) → solid(0,1,0) 強充電 → wire(1,1,0) が 15
    world.setBlock(0, 0, 0, torch(true))
    world.setBlock(0, 1, 0, solid())
    world.setBlock(1, 1, 0, wire())
    world.initialize()

    expect(world.getBlock(0, 1, 0)).toMatchObject({ type: 'solid', powered: true })
    expect(world.getBlock(1, 1, 0)).toMatchObject({ type: 'wire', power: 15 })
  })

  it('床置きトーチの横の solid は充電されない (weak は固体を充電しない)', () => {
    const world = new SimWorld()
    // torch(0,0,0) の横の solid(1,0,0) → その先の wire(2,0,0) は 0 のまま
    world.setBlock(0, 0, 0, torch(true))
    world.setBlock(1, 0, 0, solid())
    world.setBlock(2, 0, 0, wire())
    world.initialize()

    expect(world.getBlock(1, 0, 0)).toMatchObject({ type: 'solid', powered: false })
    expect(world.getBlock(2, 0, 0)).toMatchObject({ type: 'wire', power: 0 })
  })

  it('壁トーチも直上の solid のみ強充電する', () => {
    const world = new SimWorld()
    // wall_torch(0,0,0) facing=east (土台は東) → solid(0,1,0) 強充電 → wire(-1,1,0) が 15
    world.setBlock(1, 0, 0, solid())  // 土台
    world.setBlock(0, 0, 0, { type: 'wall_torch', facing: 'east', lit: true })
    world.setBlock(0, 1, 0, solid())
    world.setBlock(-1, 1, 0, wire())
    world.initialize()

    expect(world.getBlock(0, 1, 0)).toMatchObject({ type: 'solid', powered: true })
    expect(world.getBlock(-1, 1, 0)).toMatchObject({ type: 'wire', power: 15 })
  })

  it('トーチは取り付け面 (土台方向) へは給電しない', () => {
    const world = new SimWorld()
    // wall_torch(1,0,0) facing=east: 土台は solid(2,0,0)。土台側のランプ相当は作動しない
    // → 土台 solid は充電されず、その先の wire(3,0,0) も 0
    world.setBlock(2, 0, 0, solid())
    world.setBlock(1, 0, 0, { type: 'wall_torch', facing: 'east', lit: true })
    world.setBlock(3, 0, 0, wire())
    world.initialize()

    expect(world.getBlock(2, 0, 0)).toMatchObject({ type: 'solid', powered: false })
    expect(world.getBlock(3, 0, 0)).toMatchObject({ type: 'wire', power: 0 })
  })
})

// ─────────────────────────────────────────────────────────────
// 系統3: ワイヤーの足元弱充電 (G5) と下方向配線
// ─────────────────────────────────────────────────────────────

describe('ワイヤーの足元弱充電 (G5)', () => {
  it('通電ワイヤー直下のランプが点灯する', () => {
    const world = new SimWorld()
    // lamp(1,0,0) の上に wire(1,1,0)。lever(0,1,0) で通電
    world.setBlock(0, 1, 0, lever(false))
    world.setBlock(1, 0, 0, lamp())
    world.setBlock(1, 1, 0, wire())

    world.activateBlock(0, 1, 0)

    expect(world.getBlock(1, 1, 0)).toMatchObject({ type: 'wire', power: 15 })
    expect(world.getBlock(1, 0, 0)).toMatchObject({ type: 'lamp', lit: true })

    world.activateBlock(0, 1, 0)  // OFF
    // ランプ消灯は 4gt の tile tick 遅延 (02 §6 lamp [確定])
    expect(world.getBlock(1, 0, 0)).toMatchObject({ type: 'lamp', lit: true })
    world.flush()
    expect(world.getBlock(1, 0, 0)).toMatchObject({ type: 'lamp', lit: false })
  })

  it('通電ワイヤー直上のランプは点灯しない (上方向へは給電しない)', () => {
    const world = new SimWorld()
    world.setBlock(0, 0, 0, lever(false))
    world.setBlock(1, 0, 0, wire())
    world.setBlock(1, 1, 0, lamp())

    world.activateBlock(0, 0, 0)

    expect(world.getBlock(1, 0, 0)).toMatchObject({ type: 'wire', power: 15 })
    expect(world.getBlock(1, 1, 0)).toMatchObject({ type: 'lamp', lit: false })
  })

  it('通電ワイヤーの足元の solid 越しにトーチが消灯する', () => {
    const world = new SimWorld()
    // wire(0,1,0) が solid(0,0,0) を足元弱充電 → 横に取り付いた torch は…
    // solid の上は wire なので床置きトーチは置けない。横の wall_torch で確認
    world.setBlock(1, 1, 0, lever(false))
    world.setBlock(0, 1, 0, wire())
    world.setBlock(0, 0, 0, solid())
    world.setBlock(-1, 0, 0, { type: 'wall_torch', facing: 'east', lit: true })  // 土台=solid(0,0,0)

    world.activateBlock(1, 1, 0)
    world.flush()

    expect(world.getBlock(-1, 0, 0)).toMatchObject({ type: 'wall_torch', lit: false })
  })
})

// ─────────────────────────────────────────────────────────────
// 系統4: 強充電された固体は dust に給電する
// ─────────────────────────────────────────────────────────────

describe('強充電された固体 (docs/research/02 §5.2)', () => {
  it('repeater → solid (strong) → dust が 15 になる', () => {
    const world = new SimWorld()
    world.setBlock(0, 0, 0, lever(false))
    world.setBlock(1, 0, 0, repeater('east'))
    world.setBlock(2, 0, 0, solid())
    world.setBlock(3, 0, 0, wire())

    world.activateBlock(0, 0, 0)
    world.flush()

    expect(world.getBlock(2, 0, 0)).toMatchObject({ type: 'solid', powered: true })
    expect(world.getBlock(3, 0, 0)).toMatchObject({ type: 'wire', power: 15 })
  })

  it('repeater → solid → torch がブロック越しで消灯する (G4)', () => {
    const world = new SimWorld()
    world.setBlock(0, 0, 0, lever(false))
    world.setBlock(1, 0, 0, repeater('east'))
    world.setBlock(2, 0, 0, solid())
    world.setBlock(2, 1, 0, torch(true))

    world.activateBlock(0, 0, 0)
    world.flush()

    expect(world.getBlock(2, 1, 0)).toMatchObject({ type: 'torch', lit: false })
  })

  it('repeater OFF で solid 経由の dust も 0 に戻る', () => {
    const world = new SimWorld()
    world.setBlock(0, 0, 0, lever(false))
    world.setBlock(1, 0, 0, repeater('east'))
    world.setBlock(2, 0, 0, solid())
    world.setBlock(3, 0, 0, wire())

    world.activateBlock(0, 0, 0)
    world.flush()
    expect(world.getBlock(3, 0, 0)).toMatchObject({ type: 'wire', power: 15 })

    world.activateBlock(0, 0, 0)  // lever OFF
    world.flush()
    expect(world.getBlock(2, 0, 0)).toMatchObject({ type: 'solid', powered: false })
    expect(world.getBlock(3, 0, 0)).toMatchObject({ type: 'wire', power: 0 })
  })
})

// ─────────────────────────────────────────────────────────────
// 系統5: レバーの取り付け面限定強充電 (G13)
// ─────────────────────────────────────────────────────────────

describe('レバー/ボタンの強充電は取り付け面のみ (G13)', () => {
  it('取り付け面の solid はブロック越しに dust へ給電する', () => {
    const world = new SimWorld()
    // lever(1,0,0) facing=east → 取り付け面は west = solid(0,0,0)
    world.setBlock(0, 0, 0, solid())
    world.setBlock(1, 0, 0, lever(true, 'east'))
    world.setBlock(0, 1, 0, wire())  // solid の上の dust
    world.initialize()

    expect(world.getBlock(0, 0, 0)).toMatchObject({ type: 'solid', powered: true })
    expect(world.getBlock(0, 1, 0)).toMatchObject({ type: 'wire', power: 15 })
  })

  it('取り付け面でない solid は充電されない (ブロック越し給電しない)', () => {
    const world = new SimWorld()
    // lever(0,0,0) facing=up → 取り付け面は down。横の solid(1,0,0) は充電されない
    world.setBlock(0, 0, 0, lever(true, 'up'))
    world.setBlock(1, 0, 0, solid())
    world.setBlock(1, 1, 0, wire())   // solid の上の dust → 0
    world.setBlock(2, 0, 0, lamp())   // solid 越しのランプ → 消灯のまま
    world.initialize()

    expect(world.getBlock(1, 0, 0)).toMatchObject({ type: 'solid', powered: false })
    expect(world.getBlock(1, 1, 0)).toMatchObject({ type: 'wire', power: 0 })
    expect(world.getBlock(2, 0, 0)).toMatchObject({ type: 'lamp', lit: false })
  })

  it('weak は全方向: レバーに直接隣接するランプ・ワイヤーは作動する', () => {
    const world = new SimWorld()
    world.setBlock(0, 0, 0, lever(false, 'up'))
    world.setBlock(1, 0, 0, lamp())
    world.setBlock(-1, 0, 0, wire())

    world.activateBlock(0, 0, 0)

    expect(world.getBlock(1, 0, 0)).toMatchObject({ type: 'lamp', lit: true })
    expect(world.getBlock(-1, 0, 0)).toMatchObject({ type: 'wire', power: 15 })
  })
})
