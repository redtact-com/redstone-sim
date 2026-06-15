import { describe, it, expect } from 'vitest'
import { SimWorld } from '../src/world.js'
import type { BlockState } from '../src/types.js'

// ── ヘルパー ──────────────────────────────────────────────────

const Y = 0  // 2D平面テスト用の固定Y座標

/** 3DのsetBlockをXZ平面で使う用ショートカット */
function place(world: SimWorld, x: number, z: number, block: BlockState) {
  world.setBlock(x, Y, z, block)
}

/** Y座標を指定してsetBlock */
function place3d(world: SimWorld, x: number, y: number, z: number, block: BlockState) {
  world.setBlock(x, y, z, block)
}

function lever(powered = false): BlockState {
  return { type: 'lever', facing: 'up', powered }
}
function wire(power = 0): BlockState {
  return {
    type: 'wire',
    connections: { north: true, south: true, east: true, west: true },
    power,
  }
}
function lamp(lit = false): BlockState {
  return { type: 'lamp', lit }
}
function torch(lit = true): BlockState {
  return { type: 'torch', facing: 'up', lit }
}
function wallTorch(facing: 'north'|'south'|'east'|'west', lit = true): BlockState {
  return { type: 'wall_torch', facing, lit }
}
function repeater(
  facing: 'north'|'south'|'east'|'west',
  delay: 1|2|3|4 = 1,
  powered = false,
): BlockState {
  return { type: 'repeater', facing, delay, powered, locked: false }
}

// ─────────────────────────────────────────────────────────────

describe('SimWorld: レバー → ランプ（直接隣接）', () => {
  it('レバーONでランプが点灯する', () => {
    const world = new SimWorld()
    place(world, 0, 0, lever(false))
    place(world, 1, 0, lamp(false))

    world.activateBlock(0, Y, 0)

    expect(world.getBlock(1, Y, 0)).toMatchObject({ type: 'lamp', lit: true })
  })

  it('レバーOFF後にランプが消灯する', () => {
    const world = new SimWorld()
    place(world, 0, 0, lever(true))
    place(world, 1, 0, lamp(true))

    world.activateBlock(0, Y, 0)

    expect(world.getBlock(1, Y, 0)).toMatchObject({ type: 'lamp', lit: false })
  })
})

// ─────────────────────────────────────────────────────────────

describe('SimWorld: レバー → ワイヤー → ランプ', () => {
  it('ワイヤー1本経由でランプが点灯する', () => {
    const world = new SimWorld()
    //  lever(0,0) - wire(1,0) - lamp(2,0)
    place(world, 0, 0, lever(false))
    place(world, 1, 0, wire())
    place(world, 2, 0, lamp(false))

    world.activateBlock(0, Y, 0)

    expect(world.getBlock(1, Y, 0)).toMatchObject({ type: 'wire', power: 15 })
    expect(world.getBlock(2, Y, 0)).toMatchObject({ type: 'lamp', lit: true })
  })

  it('ワイヤー15本: 末端のワイヤーのpowerは1（減衰する）', () => {
    const world = new SimWorld()
    place(world, 0, 0, lever(false))
    for (let x = 1; x <= 15; x++) place(world, x, 0, wire())
    place(world, 16, 0, lamp(false))

    world.activateBlock(0, Y, 0)

    // 15本目のワイヤーの強度は1
    expect(world.getBlock(15, Y, 0)).toMatchObject({ type: 'wire', power: 1 })
    // ワイヤーは隣接ランプを強度1でも点灯させる（0でなければ点灯）
    expect(world.getBlock(16, Y, 0)).toMatchObject({ type: 'lamp', lit: true })
  })

  it('ワイヤーの信号が届かない距離のランプは消灯のまま', () => {
    const world = new SimWorld()
    place(world, 0, 0, lever(false))
    for (let x = 1; x <= 15; x++) place(world, x, 0, wire())
    // 16本目ワイヤー（power=0になる）
    place(world, 16, 0, wire())
    place(world, 17, 0, lamp(false))

    world.activateBlock(0, Y, 0)

    expect(world.getBlock(16, Y, 0)).toMatchObject({ type: 'wire', power: 0 })
    expect(world.getBlock(17, Y, 0)).toMatchObject({ type: 'lamp', lit: false })
  })
})

// ─────────────────────────────────────────────────────────────

describe('SimWorld: トーチ → ランプ（initialize()で初期化）', () => {
  it('床置きトーチの上(Y+1)のランプが initialize() 後に点灯する', () => {
    const world = new SimWorld()
    place3d(world, 0, 0, 0, torch(true))
    place3d(world, 0, 1, 0, lamp(false))

    world.initialize()

    expect(world.getBlock(0, 1, 0)).toMatchObject({ type: 'lamp', lit: true })
  })

  it('壁トーチ(east向き)は west 側のランプを照らす', () => {
    const world = new SimWorld()
    // wall_torch at (1,0) facing=east: 出力方向=west → (0,0) を照らす
    place(world, 1, 0, wallTorch('east', true))
    place(world, 0, 0, lamp(false))

    world.initialize()

    expect(world.getBlock(0, Y, 0)).toMatchObject({ type: 'lamp', lit: true })
  })

  it('壁トーチ → ワイヤー3本 → ランプ が initialize() 後に点灯する', () => {
    const world = new SimWorld()
    // wall_torch(0,0) facing=west (出力=east) → wire(1,0) → wire(2,0) → lamp(3,0)
    place(world, 0, 0, wallTorch('west', true))
    place(world, 1, 0, wire())
    place(world, 2, 0, wire())
    place(world, 3, 0, lamp(false))

    world.initialize()

    expect(world.getBlock(1, Y, 0)).toMatchObject({ type: 'wire', power: 15 })
    expect(world.getBlock(2, Y, 0)).toMatchObject({ type: 'wire', power: 14 })
    expect(world.getBlock(3, Y, 0)).toMatchObject({ type: 'lamp', lit: true })
  })

  it('土台が最初からレバーONのトーチは initialize() で消灯する', () => {
    const world = new SimWorld()
    // solid(0,0,0) の上に torch(0,1,0)。solid を lever(1,0,0) で充電
    place3d(world, 0, 0, 0, { type: 'solid', powered: false })
    place3d(world, 0, 1, 0, torch(true))   // 土台=solid(0,0,0)
    place3d(world, 1, 0, 0, lever(true))   // 最初からON

    world.initialize()

    // lever → solid 充電 → torch 土台 powered → torch 消灯
    expect(world.getBlock(0, 1, 0)).toMatchObject({ type: 'torch', lit: false })
  })
})

// ─────────────────────────────────────────────────────────────

describe('SimWorld: リピーター遅延', () => {
  it('delay=1のリピーターは1tick後に出力する', () => {
    const world = new SimWorld()
    //  lever(0,0) - repeater(1,0 facing=east delay=1) - lamp(2,0)
    place(world, 0, 0, lever(false))
    place(world, 1, 0, repeater('east', 1))
    place(world, 2, 0, lamp(false))

    world.activateBlock(0, Y, 0)

    // 即座にはランプが点灯しない
    expect(world.getBlock(2, Y, 0)).toMatchObject({ type: 'lamp', lit: false })

    world.tick()

    expect(world.getBlock(2, Y, 0)).toMatchObject({ type: 'lamp', lit: true })
  })

  it('delay=2のリピーターは2tick後に出力する', () => {
    const world = new SimWorld()
    place(world, 0, 0, lever(false))
    place(world, 1, 0, repeater('east', 2))
    place(world, 2, 0, lamp(false))

    world.activateBlock(0, Y, 0)
    world.tick()
    expect(world.getBlock(2, Y, 0)).toMatchObject({ type: 'lamp', lit: false })

    world.tick()
    expect(world.getBlock(2, Y, 0)).toMatchObject({ type: 'lamp', lit: true })
  })

  it('delay=4のリピーターは4tick後に出力する', () => {
    const world = new SimWorld()
    place(world, 0, 0, lever(false))
    place(world, 1, 0, repeater('east', 4))
    place(world, 2, 0, lamp(false))

    world.activateBlock(0, Y, 0)
    for (let i = 0; i < 3; i++) world.tick()
    expect(world.getBlock(2, Y, 0)).toMatchObject({ type: 'lamp', lit: false })

    world.tick()
    expect(world.getBlock(2, Y, 0)).toMatchObject({ type: 'lamp', lit: true })
  })
})

// ─────────────────────────────────────────────────────────────

describe('SimWorld: ボタン（自動オフ）', () => {
  it('石ボタンは5tick後に自動でオフになる', () => {
    const world = new SimWorld()
    place(world, 0, 0, { type: 'button_stone', facing: 'up', powered: false })
    place(world, 1, 0, lamp(false))

    world.activateBlock(0, Y, 0)
    expect(world.getBlock(1, Y, 0)).toMatchObject({ type: 'lamp', lit: true })

    for (let i = 0; i < 5; i++) world.tick()

    expect(world.getBlock(0, Y, 0)).toMatchObject({ type: 'button_stone', powered: false })
    expect(world.getBlock(1, Y, 0)).toMatchObject({ type: 'lamp', lit: false })
  })

  it('木ボタンは10tick後に自動でオフになる', () => {
    const world = new SimWorld()
    place(world, 0, 0, { type: 'button_wood', facing: 'up', powered: false })
    place(world, 1, 0, lamp(false))

    world.activateBlock(0, Y, 0)
    for (let i = 0; i < 9; i++) world.tick()
    expect(world.getBlock(1, Y, 0)).toMatchObject({ type: 'lamp', lit: true })

    world.tick()  // 10tick目でオフ
    expect(world.getBlock(1, Y, 0)).toMatchObject({ type: 'lamp', lit: false })
  })
})

// ─────────────────────────────────────────────────────────────

describe('SimWorld: clone', () => {
  it('clone後にオリジナルを変更してもクローンに影響しない', () => {
    const world = new SimWorld()
    place(world, 0, 0, lever(false))
    place(world, 1, 0, lamp(false))

    const clone = world.clone()
    world.activateBlock(0, Y, 0)

    expect(clone.getBlock(0, Y, 0)).toMatchObject({ type: 'lever', powered: false })
    expect(clone.getBlock(1, Y, 0)).toMatchObject({ type: 'lamp', lit: false })
  })

  it('cloneはオリジナルと独立してticksを進められる', () => {
    const world = new SimWorld()
    place(world, 0, 0, lever(false))
    place(world, 1, 0, repeater('east', 2))
    place(world, 2, 0, lamp(false))
    world.activateBlock(0, Y, 0)

    const clone = world.clone()
    clone.tick()
    clone.tick()  // clone側: 2tick進めてランプ点灯

    world.tick()  // original: 1tickだけ

    expect(clone.getBlock(2, Y, 0)).toMatchObject({ type: 'lamp', lit: true })
    expect(world.getBlock(2, Y, 0)).toMatchObject({ type: 'lamp', lit: false })
  })
})
