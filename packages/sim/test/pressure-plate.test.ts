import { describe, it, expect } from 'vitest'
import { SimWorld } from '../src/world.js'
import { mcToSim, simToMc, canonicalize } from '../src/mcstate.js'
import { getSignal, getDirectSignal, getStrongPower, relative } from '../src/power.js'
import { ALL_DIRS, OPPOSITE } from '../src/types.js'
import type { BlockState } from '../src/types.js'

// ============================================================
// 感圧板 3 種 (I13 / issue #37): 手動入力モデル
//
// [確定: 26.2 デコンパイル] BasePressurePlateBlock / PressurePlateBlock /
//   WeightedPressurePlateBlock:
//   - 木/石 (PressurePlateBlock): getSignalForState = POWERED ? 15 : 0 /
//     getPressedTime = 20gt (BasePressurePlateBlock 既定、非 override)。
//   - 重量 light=金 (maxWeight 15) / heavy=鉄 (maxWeight 150)
//     (WeightedPressurePlateBlock): POWER 0-15 / getPressedTime = 10gt /
//     signal = count>0 ? ceil(min(count,maxWeight)/maxWeight*15) : 0。
//     手動モデルはエンティティ計数を持たないため設定値 pressedPower を直接出力する。
//   - 給電: 全方向 weak (ownSignal=getSignalForState) / 直下のみ strong
//     (getDirectSignal = direction==UP ? signal : 0)。
//   - NC 送信: updateNeighborsAt(pos) + updateNeighborsAt(pos.below())。
//
// 手動モデル: activateBlock で踏まれ ON、getPressedTime の tile tick で自動 OFF
// (ボタンの自動 OFF パターン)。
// ============================================================

const Y = 1  // 板は support (Y-1) の上に置く

function wire(power = 0): BlockState {
  return { type: 'wire', connections: { north: true, south: true, east: true, west: true }, power }
}
function lamp(lit = false): BlockState {
  return { type: 'lamp', lit }
}
function solid(): BlockState {
  return { type: 'solid', powered: false }
}
function plateWood(): BlockState {
  return { type: 'pressure_plate_wood', powered: false }
}
function plateStone(): BlockState {
  return { type: 'pressure_plate_stone', powered: false }
}
function weightedLight(pressedPower = 15): BlockState {
  return { type: 'weighted_pressure_plate_light', pressedPower, powered: false }
}
function weightedHeavy(pressedPower = 15): BlockState {
  return { type: 'weighted_pressure_plate_heavy', pressedPower, powered: false }
}

// ─────────────────────────────────────────────────────────────
// 木/石 感圧板: 踏まれ 15 → 20gt 持続 → 自動 OFF
// ─────────────────────────────────────────────────────────────

describe('木/石 感圧板: 手動トリガ (15) → 20gt 持続 → 消灯', () => {
  it('初期は powered=false (無給電)', () => {
    const world = new SimWorld()
    world.setBlock(0, Y - 1, 0, solid())
    world.setBlock(0, Y, 0, plateWood())
    world.setBlock(1, Y, 0, wire())
    world.initialize()
    world.flush(64)
    expect(world.getBlock(0, Y, 0)).toMatchObject({ type: 'pressure_plate_wood', powered: false })
    expect(world.getBlock(1, Y, 0)).toMatchObject({ power: 0 })
  })

  it('踏むと隣接ダスト/ランプを駆動し、20gt (getPressedTime) 後に自動 OFF', () => {
    const world = new SimWorld()
    world.setBlock(0, Y - 1, 0, solid())
    world.setBlock(0, Y, 0, plateWood())
    world.setBlock(1, Y, 0, wire())
    world.setBlock(2, Y, 0, lamp())
    world.initialize()
    world.flush(64)

    world.activateBlock(0, Y, 0)
    expect(world.getBlock(0, Y, 0)).toMatchObject({ powered: true })
    expect(world.getBlock(1, Y, 0)).toMatchObject({ power: 15 })
    expect(world.getBlock(2, Y, 0)).toMatchObject({ lit: true })

    // 19gt 目までは踏まれ継続 [確定: 26.2 getPressedTime=20]
    for (let i = 0; i < 19; i++) world.tick()
    expect(world.getBlock(0, Y, 0)).toMatchObject({ powered: true })

    // 20gt 目で板 OFF・ワイヤー 0。ランプは消灯 4gt 遅延 (I12) で残る
    world.tick()
    expect(world.getBlock(0, Y, 0)).toMatchObject({ powered: false })
    expect(world.getBlock(1, Y, 0)).toMatchObject({ power: 0 })
    expect(world.getBlock(2, Y, 0)).toMatchObject({ lit: true })

    for (let i = 0; i < 4; i++) world.tick()
    expect(world.getBlock(2, Y, 0)).toMatchObject({ lit: false })
  })

  it('石板も 20gt (PressurePlateBlock は getPressedTime を override しない)', () => {
    const world = new SimWorld()
    world.setBlock(0, Y - 1, 0, solid())
    world.setBlock(0, Y, 0, plateStone())
    world.setBlock(1, Y, 0, wire())
    world.initialize()
    world.flush(64)
    world.activateBlock(0, Y, 0)
    for (let i = 0; i < 19; i++) world.tick()
    expect(world.getBlock(0, Y, 0)).toMatchObject({ powered: true })
    world.tick()
    expect(world.getBlock(0, Y, 0)).toMatchObject({ powered: false })
  })

  it('踏まれ中の再トリガは無視される (持続を延長しない)', () => {
    const world = new SimWorld()
    world.setBlock(0, Y - 1, 0, solid())
    world.setBlock(0, Y, 0, plateWood())
    world.initialize()
    world.flush(64)

    world.activateBlock(0, Y, 0)
    for (let i = 0; i < 10; i++) world.tick()
    world.activateBlock(0, Y, 0)  // 再トリガ (無視)
    for (let i = 0; i < 9; i++) world.tick()
    expect(world.getBlock(0, Y, 0)).toMatchObject({ powered: true })
    world.tick()  // 通算 20gt
    expect(world.getBlock(0, Y, 0)).toMatchObject({ powered: false })
  })

  it('全 6 方向に weak 15 を出す (ownSignal=getSignalForState)', () => {
    const world = new SimWorld()
    world.setBlock(0, Y - 1, 0, solid())
    world.setBlock(0, Y, 0, { type: 'pressure_plate_wood', powered: true })
    for (const dir of ALL_DIRS) {
      const nb = relative([0, Y, 0], dir)
      expect(getSignal(world, nb, OPPOSITE[dir])).toBe(15)
    }
  })
})

// ─────────────────────────────────────────────────────────────
// 給電形状: 直下 strong 充電 / 上・側面は strong 0
// ─────────────────────────────────────────────────────────────

describe('感圧板の給電形状: 直下のみ strong 充電', () => {
  it('直下ブロックを strong 15 で充電し、上/側面は 0', () => {
    const world = new SimWorld()
    world.setBlock(0, Y - 1, 0, solid())  // 直下 = 取り付け面
    world.setBlock(0, Y, 0, { type: 'pressure_plate_wood', powered: true })
    world.setBlock(0, Y + 1, 0, solid())  // 上
    world.setBlock(1, Y, 0, solid())      // 側面
    // 直下は up 面から strong 15
    expect(getDirectSignal(world, [0, Y - 1, 0], 'up')).toBe(15)
    expect(getStrongPower(world, [0, Y - 1, 0])).toBe(15)
    // 上・側面は strong を受けない
    expect(getStrongPower(world, [0, Y + 1, 0])).toBe(0)
    expect(getStrongPower(world, [1, Y, 0])).toBe(0)
  })

  it('踏むと直下 support が強充電され、support 取り付けトーチが消灯する', () => {
    const world = new SimWorld()
    world.setBlock(0, Y - 1, 0, solid())   // support
    world.setBlock(0, Y, 0, plateWood())   // support の上に板
    // support の東面に壁トーチ (facing='west' → 土台 = support)
    world.setBlock(1, Y - 1, 0, { type: 'wall_torch', facing: 'west', lit: true })
    world.initialize()
    world.flush(64)
    expect(world.getBlock(1, Y - 1, 0)).toMatchObject({ lit: true })

    world.activateBlock(0, Y, 0)
    world.tick(); world.tick()  // トーチ消灯 2gt
    expect(world.getBlock(0, Y, 0)).toMatchObject({ powered: true })
    expect(world.getBlock(1, Y - 1, 0)).toMatchObject({ lit: false })

    // 板が 20gt で自動 OFF → support 開放 → トーチ復帰
    world.flush(64)
    expect(world.getBlock(0, Y, 0)).toMatchObject({ powered: false })
    expect(world.getBlock(1, Y - 1, 0)).toMatchObject({ lit: true })
  })
})

// ─────────────────────────────────────────────────────────────
// 重量感圧板: 設定信号値をそのまま出力 / 10gt 持続
// ─────────────────────────────────────────────────────────────

describe('重量感圧板 (light/heavy): 設定値出力 + 10gt 持続', () => {
  it('light: pressedPower=7 を出力し、10gt (getPressedTime) 後に OFF', () => {
    const world = new SimWorld()
    world.setBlock(0, Y - 1, 0, solid())
    world.setBlock(0, Y, 0, weightedLight(7))
    world.setBlock(1, Y, 0, wire())
    world.initialize()
    world.flush(64)

    world.activateBlock(0, Y, 0)
    expect(world.getBlock(0, Y, 0)).toMatchObject({ powered: true, pressedPower: 7 })
    expect(world.getBlock(1, Y, 0)).toMatchObject({ power: 7 })  // 7 から減衰なしの起点
    expect(world.getPowerLevel(0, Y, 0)).toBe(7)

    for (let i = 0; i < 9; i++) world.tick()
    expect(world.getBlock(0, Y, 0)).toMatchObject({ powered: true })
    world.tick()  // 10gt 目で OFF
    expect(world.getBlock(0, Y, 0)).toMatchObject({ powered: false })
    expect(world.getBlock(1, Y, 0)).toMatchObject({ power: 0 })
  })

  it('heavy: pressedPower=15 全出力、10gt 持続', () => {
    const world = new SimWorld()
    world.setBlock(0, Y - 1, 0, solid())
    world.setBlock(0, Y, 0, weightedHeavy(15))
    world.setBlock(1, Y, 0, wire())
    world.initialize()
    world.flush(64)
    world.activateBlock(0, Y, 0)
    expect(world.getBlock(1, Y, 0)).toMatchObject({ power: 15 })
    for (let i = 0; i < 9; i++) world.tick()
    expect(world.getBlock(0, Y, 0)).toMatchObject({ powered: true })
    world.tick()
    expect(world.getBlock(0, Y, 0)).toMatchObject({ powered: false })
  })

  it('pressedPower=0 の重量板を踏んでも no-op (vanilla count==0 相当)', () => {
    const world = new SimWorld()
    world.setBlock(0, Y - 1, 0, solid())
    world.setBlock(0, Y, 0, weightedLight(0))
    world.initialize()
    world.flush(64)
    world.activateBlock(0, Y, 0)
    expect(world.getBlock(0, Y, 0)).toMatchObject({ powered: false })
    // 予約もされない
    expect(world.getScheduledTicks().length).toBe(0)
  })

  it('信号強度 8 の light 板から 8 本ダスト減衰: 8,7,...,1', () => {
    const world = new SimWorld()
    world.setBlock(0, Y - 1, 0, solid())
    world.setBlock(0, Y, 0, weightedLight(8))
    for (let x = 1; x <= 8; x++) world.setBlock(x, Y, 0, wire())
    world.initialize()
    world.flush(64)
    world.activateBlock(0, Y, 0)
    expect(world.getBlock(1, Y, 0)).toMatchObject({ power: 8 })
    expect(world.getBlock(8, Y, 0)).toMatchObject({ power: 1 })
  })
})

// ─────────────────────────────────────────────────────────────
// initialize: authored の踏まれ状態はリセットする (entity 不在)
// ─────────────────────────────────────────────────────────────

describe('initialize: authored の踏まれ板を OFF に戻す', () => {
  it('木板 powered=true / 重量板 power>0 は初期化で OFF', () => {
    const world = new SimWorld()
    world.setBlock(0, Y - 1, 0, solid())
    world.setBlock(0, Y, 0, { type: 'pressure_plate_wood', powered: true })
    world.setBlock(2, Y - 1, 0, solid())
    world.setBlock(2, Y, 0, { type: 'weighted_pressure_plate_heavy', pressedPower: 9, powered: true })
    world.initialize()
    world.flush(64)
    expect(world.getBlock(0, Y, 0)).toMatchObject({ powered: false })
    expect(world.getBlock(2, Y, 0)).toMatchObject({ powered: false, pressedPower: 9 })
  })
})

// ─────────────────────────────────────────────────────────────
// mcstate 変換 (nbtIO / fixture 用)
// ─────────────────────────────────────────────────────────────

describe('mcstate: 感圧板 4 種の相互変換', () => {
  it('oak/stone pressure_plate の往復', () => {
    expect(mcToSim('minecraft:oak_pressure_plate[powered=false]'))
      .toEqual({ type: 'pressure_plate_wood', powered: false })
    expect(mcToSim('minecraft:stone_pressure_plate[powered=true]'))
      .toEqual({ type: 'pressure_plate_stone', powered: true })
    expect(canonicalize(simToMc(
      { type: 'pressure_plate_wood', powered: true }, 'oak_pressure_plate[powered=false]')))
      .toBe('oak_pressure_plate[powered=true]')
  })

  it('light/heavy weighted の往復 (POWER=pressedPower)', () => {
    expect(mcToSim('minecraft:light_weighted_pressure_plate[power=3]'))
      .toEqual({ type: 'weighted_pressure_plate_light', pressedPower: 3, powered: true })
    // rest (power=0) は pressedPower 既定 15
    expect(mcToSim('minecraft:heavy_weighted_pressure_plate[power=0]'))
      .toEqual({ type: 'weighted_pressure_plate_heavy', pressedPower: 15, powered: false })
    // 踏まれ状態を書き戻すと power=pressedPower
    expect(canonicalize(simToMc(
      { type: 'weighted_pressure_plate_light', pressedPower: 6, powered: true },
      'light_weighted_pressure_plate[power=0]')))
      .toBe('light_weighted_pressure_plate[power=6]')
    // 非踏まれは power=0
    expect(canonicalize(simToMc(
      { type: 'weighted_pressure_plate_heavy', pressedPower: 6, powered: false },
      'heavy_weighted_pressure_plate[power=0]')))
      .toBe('heavy_weighted_pressure_plate[power=0]')
  })

  it('authored 無しでも合成できる (viewer/nbt 合成パス)', () => {
    expect(canonicalize(simToMc({ type: 'pressure_plate_stone', powered: false })))
      .toBe('stone_pressure_plate[powered=false]')
    expect(canonicalize(simToMc(
      { type: 'weighted_pressure_plate_heavy', pressedPower: 4, powered: true })))
      .toBe('heavy_weighted_pressure_plate[power=4]')
  })
})
