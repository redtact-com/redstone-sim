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
function comparator(
  facing: 'north'|'south'|'east'|'west',
  mode: 'compare'|'subtract' = 'compare',
): BlockState {
  return { type: 'comparator', facing, mode, powered: false, outputPower: 0 }
}
function container(signal: number): BlockState {
  return { type: 'container', signal }
}
function button(powered = false): BlockState {
  return { type: 'button_stone', facing: 'up', powered }
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

    // ランプ消灯は 4gt の tile tick 遅延 (02 §6 lamp [確定])。直後はまだ点灯。
    expect(world.getBlock(1, Y, 0)).toMatchObject({ type: 'lamp', lit: true })
    world.flush()
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
    // solid(0,0,0) の上に torch(0,1,0)。solid に取り付けたレバーで強充電する。
    // (G13/02 §5.2: レバーの strong は取り付け面 OPPOSITE[facing] のブロックのみ。
    //  床置き facing='up' では横の solid を充電しないため、solid の東面に取り付ける)
    place3d(world, 0, 0, 0, { type: 'solid', powered: false })
    place3d(world, 0, 1, 0, torch(true))   // 土台=solid(0,0,0)
    place3d(world, 1, 0, 0, { type: 'lever', facing: 'east', powered: true })  // 取り付け先=solid(0,0,0)

    world.initialize()
    // initialize() は消灯を予約するだけなので ST 実行まで安定化させる
    // (トーチ遅延 = 1rt = 2gt。実機 fixture の game tick 規約に合わせる)
    world.flush()

    // lever → solid 充電 → torch 土台 powered → torch 消灯
    expect(world.getBlock(0, 1, 0)).toMatchObject({ type: 'torch', lit: false })
  })
})

// ─────────────────────────────────────────────────────────────

// トーチ焼き切れ (burnout) — 02 §6 torch [確定: RedstoneTorchBlock]。
// 60gt 窓で 8 回の消灯 (MAX_RECENT_TOGGLES) に達すると焼き切れて消灯固定になり、
// 160gt (RESTART_DELAY) 後の tile tick で復帰を試みる。
describe('SimWorld: トーチ焼き切れ (burnout)', () => {
  // 土台 solid(0,0,0) + 床トーチ(0,1,0) + 土台東面のレバー(1,0,0)。
  // レバー ON→OFF を高速に繰り返して土台を給電/開放し、トーチを高速トグルさせる。
  function makeTorchOnLever() {
    const world = new SimWorld()
    world.setBlock(0, 0, 0, { type: 'solid', powered: false })
    world.setBlock(0, 1, 0, { type: 'torch', facing: 'up', lit: true })
    world.setBlock(1, 0, 0, { type: 'lever', facing: 'east', powered: false })
    world.initialize()
    world.flush(64)
    return world
  }
  const torchAt = (w: SimWorld) => w.getBlock(0, 1, 0) as Extract<BlockState, { type: 'torch' }>

  it('8 回目の消灯で焼き切れ、消灯固定になる', () => {
    const world = makeTorchOnLever()
    // 1 サイクル = レバー ON (土台給電→2gt でトーチ消灯・記録+1) + レバー OFF (2gt で点灯)
    for (let i = 0; i < 7; i++) {
      world.activateBlock(1, 0, 0)          // ON
      world.tick(); world.tick()            // 消灯 (記録 i+1)
      expect(torchAt(world).burnedOut ?? false).toBe(false)
      world.activateBlock(1, 0, 0)          // OFF
      world.tick(); world.tick()            // 点灯
      expect(torchAt(world).lit).toBe(true)
    }
    // 8 回目の消灯 → 焼き切れ
    world.activateBlock(1, 0, 0)            // ON (8 回目)
    world.tick(); world.tick()
    expect(torchAt(world)).toMatchObject({ lit: false, burnedOut: true })
    expect(torchAt(world).recentToggles).toHaveLength(8)
  })

  it('焼き切れ中は土台開放しても点灯せず、160gt 後に復帰する', () => {
    const world = makeTorchOnLever()
    for (let i = 0; i < 8; i++) {
      world.activateBlock(1, 0, 0)          // ON
      world.tick(); world.tick()            // 消灯
      if (torchAt(world).burnedOut) break
      world.activateBlock(1, 0, 0)          // OFF
      world.tick(); world.tick()            // 点灯
    }
    expect(torchAt(world).burnedOut).toBe(true)
    // レバーを OFF (土台開放) にしても焼き切れ中は点灯しない
    if ((world.getBlock(1, 0, 0) as { powered: boolean }).powered) world.activateBlock(1, 0, 0)
    for (let i = 0; i < 100; i++) world.tick()   // 100gt 経過してもまだ復帰しない
    expect(torchAt(world)).toMatchObject({ lit: false, burnedOut: true })
    // 残りを進めると 160gt (RESTART_DELAY) の tile tick で復帰
    world.flush(200)
    expect(torchAt(world)).toMatchObject({ lit: true, burnedOut: false })
  })

  it('閾値未満 (7 回) の消灯では焼き切れない', () => {
    const world = makeTorchOnLever()
    for (let i = 0; i < 7; i++) {
      world.activateBlock(1, 0, 0)
      world.tick(); world.tick()
      world.activateBlock(1, 0, 0)
      world.tick(); world.tick()
    }
    expect(torchAt(world).burnedOut ?? false).toBe(false)
    expect(torchAt(world).lit).toBe(true)
  })

  it('60gt 窓を外れた古い記録は破棄され焼き切れない', () => {
    const world = makeTorchOnLever()
    // 4 回消灯 → 十分な間隔 (窓 60gt 超) を空けて → さらに 4 回消灯。
    // 古い 4 件が破棄されるので合計 8 回でも焼き切れない。
    const burst = () => {
      for (let i = 0; i < 4; i++) {
        world.activateBlock(1, 0, 0); world.tick(); world.tick()
        world.activateBlock(1, 0, 0); world.tick(); world.tick()
      }
    }
    burst()
    for (let i = 0; i < 70; i++) world.tick()   // 窓 (60gt) を超えて待つ
    burst()
    expect(torchAt(world).burnedOut ?? false).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────

// ランプ消灯 4gt 遅延 — 02 §6 lamp [確定: RedstoneLampBlock]。
// 点灯は NC 即時、消灯は 4gt の tile tick + 実行時再評価。
describe('SimWorld: ランプ消灯 4gt 遅延', () => {
  it('点灯は即時・消灯は 4gt 後', () => {
    const world = new SimWorld()
    place(world, 0, 0, lever(false))
    place(world, 1, 0, lamp(false))
    world.initialize()

    world.activateBlock(0, Y, 0)            // ON
    expect(world.getBlock(1, Y, 0)).toMatchObject({ type: 'lamp', lit: true })   // 即時点灯

    world.activateBlock(0, Y, 0)            // OFF → 4gt の消灯予約
    world.tick(); world.tick(); world.tick()  // 3gt: まだ点灯
    expect(world.getBlock(1, Y, 0)).toMatchObject({ type: 'lamp', lit: true })
    world.tick()                            // 4gt 目で消灯
    expect(world.getBlock(1, Y, 0)).toMatchObject({ type: 'lamp', lit: false })
  })

  it('4gt 未満の入力断では消灯しない (tick 時再評価)', () => {
    const world = new SimWorld()
    place(world, 0, 0, lever(false))
    place(world, 1, 0, lamp(false))
    world.initialize()

    world.activateBlock(0, Y, 0)            // ON → lit
    world.activateBlock(0, Y, 0)            // OFF → 消灯予約 (due +4)
    world.tick(); world.tick()              // 2gt 経過 (まだ消灯予約は未実行)
    world.activateBlock(0, Y, 0)            // 再 ON (4gt 未満で再点灯)
    world.tick(); world.tick(); world.tick()  // 予約 tick が到来しても再評価で no-op
    expect(world.getBlock(1, Y, 0)).toMatchObject({ type: 'lamp', lit: true })
  })
})

// ─────────────────────────────────────────────────────────────

// リピーター遅延 = delay (rt) × 2 game tick。
// docs/research/02 §1.1 (内部単位は gt) と実機 fixture repeater-delay-1〜4 に一致させる。
describe('SimWorld: リピーター遅延', () => {
  it('delay=1のリピーターは2gt後に出力する', () => {
    const world = new SimWorld()
    //  lever(0,0) - repeater(1,0 facing=east delay=1) - lamp(2,0)
    place(world, 0, 0, lever(false))
    place(world, 1, 0, repeater('east', 1))
    place(world, 2, 0, lamp(false))

    world.activateBlock(0, Y, 0)

    // 即座にはランプが点灯しない
    expect(world.getBlock(2, Y, 0)).toMatchObject({ type: 'lamp', lit: false })

    world.tick()
    expect(world.getBlock(2, Y, 0)).toMatchObject({ type: 'lamp', lit: false })

    world.tick()
    expect(world.getBlock(2, Y, 0)).toMatchObject({ type: 'lamp', lit: true })
  })

  it('delay=2のリピーターは4gt後に出力する', () => {
    const world = new SimWorld()
    place(world, 0, 0, lever(false))
    place(world, 1, 0, repeater('east', 2))
    place(world, 2, 0, lamp(false))

    world.activateBlock(0, Y, 0)
    for (let i = 0; i < 3; i++) world.tick()
    expect(world.getBlock(2, Y, 0)).toMatchObject({ type: 'lamp', lit: false })

    world.tick()
    expect(world.getBlock(2, Y, 0)).toMatchObject({ type: 'lamp', lit: true })
  })

  it('delay=4のリピーターは8gt後に出力する', () => {
    const world = new SimWorld()
    place(world, 0, 0, lever(false))
    place(world, 1, 0, repeater('east', 4))
    place(world, 2, 0, lamp(false))

    world.activateBlock(0, Y, 0)
    for (let i = 0; i < 7; i++) world.tick()
    expect(world.getBlock(2, Y, 0)).toMatchObject({ type: 'lamp', lit: false })

    world.tick()
    expect(world.getBlock(2, Y, 0)).toMatchObject({ type: 'lamp', lit: true })
  })
})

// ─────────────────────────────────────────────────────────────

describe('SimWorld: ボタン（自動オフ）', () => {
  // 持続時間は game tick 基準の確定値: 石系 20 gt / 木系 30 gt
  // [確定: docs/research/02 §6 lever/button — 1.21.1 の Blocks.java ticksToStayPressed]
  it('石ボタンは20gt後に自動でオフになる', () => {
    const world = new SimWorld()
    place(world, 0, 0, { type: 'button_stone', facing: 'up', powered: false })
    place(world, 1, 0, lamp(false))

    world.activateBlock(0, Y, 0)
    expect(world.getBlock(1, Y, 0)).toMatchObject({ type: 'lamp', lit: true })

    for (let i = 0; i < 19; i++) world.tick()  // 19gt までは押されたまま
    expect(world.getBlock(0, Y, 0)).toMatchObject({ type: 'button_stone', powered: true })
    expect(world.getBlock(1, Y, 0)).toMatchObject({ type: 'lamp', lit: true })

    world.tick()  // 20gt目でオフ
    expect(world.getBlock(0, Y, 0)).toMatchObject({ type: 'button_stone', powered: false })
    // ランプ消灯は 4gt 遅延 (02 §6 lamp [確定])。ボタン off の直後はまだ点灯。
    expect(world.getBlock(1, Y, 0)).toMatchObject({ type: 'lamp', lit: true })
    for (let i = 0; i < 4; i++) world.tick()
    expect(world.getBlock(1, Y, 0)).toMatchObject({ type: 'lamp', lit: false })
  })

  it('木ボタンは30gt後に自動でオフになる', () => {
    const world = new SimWorld()
    place(world, 0, 0, { type: 'button_wood', facing: 'up', powered: false })
    place(world, 1, 0, lamp(false))

    world.activateBlock(0, Y, 0)
    for (let i = 0; i < 29; i++) world.tick()  // 29gt までは押されたまま
    expect(world.getBlock(1, Y, 0)).toMatchObject({ type: 'lamp', lit: true })

    world.tick()  // 30gt目でオフ
    expect(world.getBlock(0, Y, 0)).toMatchObject({ type: 'button_wood', powered: false })
    // ランプ消灯は 4gt 遅延 (02 §6 lamp [確定])。ボタン off の直後はまだ点灯。
    expect(world.getBlock(1, Y, 0)).toMatchObject({ type: 'lamp', lit: true })
    for (let i = 0; i < 4; i++) world.tick()
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
    for (let i = 0; i < 4; i++) clone.tick()  // clone側: delay2 = 4gt進めてランプ点灯

    world.tick()  // original: 1tickだけ

    expect(clone.getBlock(2, Y, 0)).toMatchObject({ type: 'lamp', lit: true })
    expect(world.getBlock(2, Y, 0)).toMatchObject({ type: 'lamp', lit: false })
  })
})

// ─────────────────────────────────────────────────────────────
// コンパレーター側面入力の受理範囲 (G8, 02 §6 [確定])
// 側面はワイヤ/レッドストーンブロック/diode(の direct 出力)のみ受理。
// レバー・ボタン・トーチは水平方向へ direct signal を出さないため無効。
// ─────────────────────────────────────────────────────────────

describe('SimWorld: コンパレーター側面入力 (G8)', () => {
  // 配置: 背面(西)にレバー15、東出力。subtract で out = back(15) - side。
  // side が無効なら 15、有効なら 15 - side が出る。
  function build(sideBlock: BlockState | null): SimWorld {
    const world = new SimWorld()
    place(world, 0, 0, comparator('east', 'subtract'))
    place(world, -1, 0, lever(true))        // 背面(西) = 15
    if (sideBlock) place3d(world, 0, Y, -1, sideBlock)  // 北側面
    world.initialize()
    world.flush(64)
    return world
  }

  it('側面のレバーは無効 (out = 15 のまま)', () => {
    const world = build(lever(true))
    expect(world.getBlock(0, Y, 0)).toMatchObject({ outputPower: 15, powered: true })
  })

  it('側面のボタンは無効', () => {
    const world = build(button(true))
    expect(world.getBlock(0, Y, 0)).toMatchObject({ outputPower: 15 })
  })

  it('側面の床トーチは無効', () => {
    const world = build(torch(true))
    expect(world.getBlock(0, Y, 0)).toMatchObject({ outputPower: 15 })
  })

  it('側面のワイヤは有効 (side 信号で減算される)', () => {
    // 北に lever→wire を作り side=15 にする
    const world = new SimWorld()
    place(world, 0, 0, comparator('east', 'subtract'))
    place(world, -1, 0, lever(true))          // 背面(西) = 15
    place3d(world, 0, Y, -1, wire(0))          // 北側面 = ワイヤ
    place3d(world, 0, Y, -2, lever(true))      // ワイヤの電源
    world.initialize()
    world.flush(64)
    expect(world.getBlock(0, Y, -1)).toMatchObject({ type: 'wire', power: 15 })
    expect(world.getBlock(0, Y, 0)).toMatchObject({ outputPower: 0 })  // 15 - 15
  })

  it('側面の diode(出力を向けたリピーター)は有効', () => {
    // 北に repeater(south 出力=コンパレーター向き) を powered で駆動する
    const world = new SimWorld()
    place(world, 0, 0, comparator('east', 'subtract'))
    place(world, -1, 0, lever(true))          // 背面(西) = 15
    place3d(world, 0, Y, -1, repeater('south')) // 北側面 → 南出力(コンパレーター向き)
    place3d(world, 0, Y, -2, lever(true))      // リピーターの入力
    world.initialize()
    world.flush(64)
    expect(world.getBlock(0, Y, -1)).toMatchObject({ type: 'repeater', powered: true })
    expect(world.getBlock(0, Y, 0)).toMatchObject({ outputPower: 0 })  // 15 - 15
  })
})

// ─────────────────────────────────────────────────────────────
// コンパレーター背面のコンテナ読み (02 §6 [確定])
// ─────────────────────────────────────────────────────────────

describe('SimWorld: コンパレーター背面コンテナ', () => {
  it('背面直後のコンテナ signal を読む (compare)', () => {
    const world = new SimWorld()
    place(world, 0, 0, comparator('east', 'compare'))
    place(world, -1, 0, container(7))   // 背面(西)
    world.initialize()
    world.flush(64)
    expect(world.getBlock(0, Y, 0)).toMatchObject({ outputPower: 7, powered: true })
  })

  it('コンテナ(back) − side(wire) が subtract で出る', () => {
    const world = new SimWorld()
    place(world, 0, 0, comparator('east', 'subtract'))
    place(world, -1, 0, container(10))       // 背面 = 10
    place3d(world, 0, Y, -1, wire(0))         // 北側面
    place3d(world, 0, Y, -5, lever(true))     // 側面ワイヤの電源(減衰させる)
    // 側面ワイヤ列を伸ばす: (0,-2)(0,-3)(0,-4)
    place3d(world, 0, Y, -2, wire(0))
    place3d(world, 0, Y, -3, wire(0))
    place3d(world, 0, Y, -4, wire(0))
    world.initialize()
    world.flush(64)
    const side = world.getBlock(0, Y, -1) as { power: number }
    const out = world.getBlock(0, Y, 0) as { outputPower: number }
    expect(out.outputPower).toBe(Math.max(0, 10 - side.power))
  })

  it('固体 1 個越しのコンテナを読む', () => {
    const world = new SimWorld()
    place(world, 0, 0, comparator('east', 'compare'))
    place(world, -1, 0, { type: 'solid', powered: false }) // 背面 = 導体
    place(world, -2, 0, container(5))                        // 1 マス先 = コンテナ
    world.initialize()
    world.flush(64)
    expect(world.getBlock(0, Y, 0)).toMatchObject({ outputPower: 5, powered: true })
  })

  it('空コンテナ(signal 0)は出力 0', () => {
    const world = new SimWorld()
    place(world, 0, 0, comparator('east', 'compare'))
    place(world, -1, 0, container(0))
    world.initialize()
    world.flush(64)
    expect(world.getBlock(0, Y, 0)).toMatchObject({ outputPower: 0, powered: false })
  })
})

// ─────────────────────────────────────────────────────────────
// リピーターロック (G9, 02 §6 [確定])
// ─────────────────────────────────────────────────────────────

describe('SimWorld: リピーターロック', () => {
  /**
   * 配置 (XZ平面):
   *   MI(lever,-1,0) → M(repeater east,0,0) → lamp(1,0)
   *   LL(lever,0,-2) → L(repeater south,0,-1) が M の北側面に出力しロックする
   */
  function buildLockRig(): SimWorld {
    const world = new SimWorld()
    place(world, 0, 0, repeater('east', 1))     // M: 本体
    place(world, 1, 0, lamp(false))             // M の出力先
    place(world, -1, 0, lever(false))           // MI: M の入力(西)
    place3d(world, 0, Y, -1, repeater('south')) // L: M の北側面 → 南出力(M向き)
    place3d(world, 0, Y, -2, lever(true))        // LL: L の入力(北) → L を ON にする
    world.initialize()
    world.flush(64)
    return world
  }

  it('側面リピーターの出力で locked=true になり入力を凍結する', () => {
    const world = buildLockRig()
    // L は ON、M はロックされ OFF
    expect(world.getBlock(0, Y, -1)).toMatchObject({ type: 'repeater', powered: true })
    expect(world.getBlock(0, Y, 0)).toMatchObject({ type: 'repeater', locked: true, powered: false })

    // M の入力をオンにしてもロック中は反応しない
    world.activateBlock(-1, Y, 0)
    for (let i = 0; i < 8; i++) world.tick()
    expect(world.getBlock(0, Y, 0)).toMatchObject({ locked: true, powered: false })
    expect(world.getBlock(1, Y, 0)).toMatchObject({ type: 'lamp', lit: false })
  })

  it('ロック解除時に入力と出力が食い違っていれば出力する', () => {
    const world = buildLockRig()
    world.activateBlock(-1, Y, 0)               // M 入力 ON (ロック中は無視される)
    for (let i = 0; i < 8; i++) world.tick()
    expect(world.getBlock(0, Y, 0)).toMatchObject({ locked: true, powered: false })

    // L の電源を切ってロック解除
    world.activateBlock(0, Y, -2)               // LL OFF
    for (let i = 0; i < 12; i++) world.tick()
    expect(world.getBlock(0, Y, -1)).toMatchObject({ powered: false })      // L OFF
    expect(world.getBlock(0, Y, 0)).toMatchObject({ locked: false, powered: true })  // M 解除→ON
    expect(world.getBlock(1, Y, 0)).toMatchObject({ type: 'lamp', lit: true })
  })

  it('側面のワイヤ・レッドストーンではロックされない (diodesOnly)', () => {
    const world = new SimWorld()
    place(world, 0, 0, repeater('east', 1))     // M
    place(world, 1, 0, lamp(false))
    place(world, -1, 0, lever(true))            // M 入力 ON
    place3d(world, 0, Y, -1, wire(0))            // 北側面 = ワイヤ(diode でない)
    place3d(world, 0, Y, -2, lever(true))        // 側面ワイヤに給電
    world.initialize()
    world.flush(64)
    expect(world.getBlock(0, Y, -1)).toMatchObject({ type: 'wire', power: 15 })
    // ワイヤはロックしないので M は通常どおり ON
    expect(world.getBlock(0, Y, 0)).toMatchObject({ locked: false, powered: true })
    expect(world.getBlock(1, Y, 0)).toMatchObject({ type: 'lamp', lit: true })
  })
})

describe('SimWorld: BE 投入順 locational (#46)', () => {
  // 対称 2 ピストン回路 (piston W|dust|lever|dust|piston E)。
  // 実機 microTiming 観測 (2026-07-03) で BE 投入順 = 西(1,1,0)→東(5,1,0) を確認
  // (docs/research/09_snapshots/two-piston-locational.md)。更新元の NC 送信順
  // (W,E,D,U,N,S) 由来で、collectAdjacentWires の走査順がこれを再現する。
  function buildTwoPistonRig(): SimWorld {
    const world = new SimWorld()
    for (let x = 0; x <= 6; x++) {
      place3d(world, x, 0, 0, { type: 'solid' })
    }
    place3d(world, 1, 1, 0, { type: 'piston', facing: 'west', extended: false })
    place3d(world, 2, 1, 0, {
      type: 'wire',
      connections: { north: false, south: false, east: true, west: true },
      power: 0,
    })
    place3d(world, 3, 1, 0, lever(false))
    place3d(world, 4, 1, 0, {
      type: 'wire',
      connections: { north: false, south: false, east: true, west: true },
      power: 0,
    })
    place3d(world, 5, 1, 0, { type: 'piston', facing: 'east', extended: false })
    world.initialize()
    world.flush(64)
    return world
  }

  it('レバー ON 直後の BE キューが 西→東 (実機順)', () => {
    const world = buildTwoPistonRig()
    world.activateBlock(3, 1, 0)
    const events = world.getBlockEvents()
    expect(events.map(e => ({ pos: e.pos, param: e.param }))).toEqual([
      { pos: [1, 1, 0], param: 'extend' },
      { pos: [5, 1, 0], param: 'extend' },
    ])
  })

  it('レバー OFF (retract) も同順で 西→東', () => {
    const world = buildTwoPistonRig()
    world.activateBlock(3, 1, 0)
    // flush() は BE キューを見ない (scheduledTicks のみ) ため、
    // 手動 tick で伸長完了 (BE 実行 + 2gt 確定) まで進める
    for (let i = 0; i < 8; i++) world.tick()
    world.activateBlock(3, 1, 0)
    const events = world.getBlockEvents()
    expect(events.map(e => ({ pos: e.pos, param: e.param }))).toEqual([
      { pos: [1, 1, 0], param: 'retract' },
      { pos: [5, 1, 0], param: 'retract' },
    ])
  })
})
