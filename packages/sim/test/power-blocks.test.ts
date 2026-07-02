import { describe, it, expect } from 'vitest'
import { SimWorld } from '../src/world.js'
import { mcToSim, simToMc, canonicalize } from '../src/mcstate.js'
import { getSignal, getDirectSignal, getStrongPower, relative } from '../src/power.js'
import { ALL_DIRS, OPPOSITE } from '../src/types.js'
import type { BlockState } from '../src/types.js'

// ============================================================
// 電源系ブロック (I11 / issue #35): redstone block + target block
// docs/research/10 §1 §6 / 02 §6 の確定値に基づく手書き期待値。
// ============================================================

const Y = 0

function wire(power = 0): BlockState {
  return { type: 'wire', connections: { north: true, south: true, east: true, west: true }, power }
}
function lamp(lit = false): BlockState {
  return { type: 'lamp', lit }
}
function solid(): BlockState {
  return { type: 'solid', powered: false }
}
function redstoneBlock(): BlockState {
  return { type: 'redstone_block' }
}
function target(outputPower = 0): BlockState {
  return { type: 'target', outputPower }
}

// ─────────────────────────────────────────────────────────────
// redstone block: 常時 weak 15 を全 6 方向 / 固体は強充電しない
// ─────────────────────────────────────────────────────────────

describe('redstone block: 定数の弱動力源 (全 6 方向 weak 15)', () => {
  it('全 6 方向に weak 15 を出し、強充電は 0', () => {
    const world = new SimWorld()
    world.setBlock(0, 0, 0, redstoneBlock())
    for (const dir of ALL_DIRS) {
      // 各隣接セルから中心ブロックを見る = getSignal(隣接, OPPOSITE[dir])
      const nb = relative([0, 0, 0], dir)
      expect(getSignal(world, nb, OPPOSITE[dir])).toBe(15)
      expect(getDirectSignal(world, nb, OPPOSITE[dir])).toBe(0)
    }
  })

  it('隣接ダストを 15 に給電し、ランプを点灯させる', () => {
    const world = new SimWorld()
    world.setBlock(0, Y, 0, redstoneBlock())
    world.setBlock(1, Y, 0, wire())
    world.setBlock(2, Y, 0, lamp())
    world.initialize()
    world.flush(64)
    expect(world.getBlock(1, Y, 0)).toMatchObject({ type: 'wire', power: 15 })
    expect(world.getBlock(2, Y, 0)).toMatchObject({ type: 'lamp', lit: true })
  })

  it('ダスト15本の減衰: レッドストーンブロックから 15,14,...', () => {
    const world = new SimWorld()
    world.setBlock(0, Y, 0, redstoneBlock())
    for (let x = 1; x <= 15; x++) world.setBlock(x, Y, 0, wire())
    world.setBlock(16, Y, 0, wire())
    world.initialize()
    world.flush(64)
    expect(world.getBlock(1, Y, 0)).toMatchObject({ power: 15 })
    expect(world.getBlock(15, Y, 0)).toMatchObject({ power: 1 })
    expect(world.getBlock(16, Y, 0)).toMatchObject({ power: 0 })
  })

  it('固体を強充電しないため、固体越しのダストは点かない', () => {
    // redstone_block → solid → wire。redstone_block は weak のみで固体を
    // 強充電しないので、固体はダストに給電せず wire=0 のまま
    const world = new SimWorld()
    world.setBlock(0, Y, 0, redstoneBlock())
    world.setBlock(1, Y, 0, solid())
    world.setBlock(2, Y, 0, wire())
    world.setBlock(3, Y, 0, lamp())
    world.initialize()
    world.flush(64)
    expect(getStrongPower(world, [1, Y, 0])).toBe(0)
    expect(world.getBlock(2, Y, 0)).toMatchObject({ power: 0 })
    expect(world.getBlock(3, Y, 0)).toMatchObject({ type: 'lamp', lit: false })
  })

  it('getPowerLevel は常に 15 を返す', () => {
    const world = new SimWorld()
    world.setBlock(0, 0, 0, redstoneBlock())
    expect(world.getPowerLevel(0, 0, 0)).toBe(15)
  })
})

// ─────────────────────────────────────────────────────────────
// target block: 手動トリガ + 20gt 持続 + tile tick 消灯
// ─────────────────────────────────────────────────────────────

describe('target block: 手動トリガ (15) → 20gt 持続 → 消灯', () => {
  it('初期は outputPower 0 (無給電)', () => {
    const world = new SimWorld()
    world.setBlock(0, Y, 0, target())
    world.setBlock(1, Y, 0, wire())
    world.initialize()
    world.flush(64)
    expect(world.getBlock(0, Y, 0)).toMatchObject({ type: 'target', outputPower: 0 })
    expect(world.getBlock(1, Y, 0)).toMatchObject({ power: 0 })
  })

  it('activateBlock で 15 を出し隣接ダスト/ランプを駆動、20gt 後に消灯', () => {
    const world = new SimWorld()
    world.setBlock(0, Y, 0, target())
    world.setBlock(1, Y, 0, wire())
    world.setBlock(2, Y, 0, lamp())
    world.initialize()
    world.flush(64)

    world.activateBlock(0, Y, 0)
    expect(world.getBlock(0, Y, 0)).toMatchObject({ outputPower: 15 })
    expect(world.getBlock(1, Y, 0)).toMatchObject({ power: 15 })
    expect(world.getBlock(2, Y, 0)).toMatchObject({ lit: true })

    // 19gt 目までは点灯継続
    for (let i = 0; i < 19; i++) world.tick()
    expect(world.getBlock(0, Y, 0)).toMatchObject({ outputPower: 15 })
    expect(world.getBlock(2, Y, 0)).toMatchObject({ lit: true })

    // 20gt 目 (ACTIVATION_TICKS_ARROWS) で target 消灯・ワイヤー 0。
    // ランプは I12 の消灯 4gt 遅延 (02 §6 [確定]) によりまだ点灯している
    world.tick()
    expect(world.getBlock(0, Y, 0)).toMatchObject({ outputPower: 0 })
    expect(world.getBlock(1, Y, 0)).toMatchObject({ power: 0 })
    expect(world.getBlock(2, Y, 0)).toMatchObject({ lit: true })

    // +4gt でランプ消灯
    for (let i = 0; i < 4; i++) world.tick()
    expect(world.getBlock(2, Y, 0)).toMatchObject({ lit: false })
  })

  it('持続中の再トリガは無視される (既存 tick を延長しない)', () => {
    const world = new SimWorld()
    world.setBlock(0, Y, 0, target())
    world.initialize()
    world.flush(64)

    world.activateBlock(0, Y, 0)
    for (let i = 0; i < 10; i++) world.tick()  // 10gt 経過
    world.activateBlock(0, Y, 0)                // 再トリガ (無視される)
    // 元の予約どおり残り 10gt (=通算 20gt) で消灯する
    for (let i = 0; i < 9; i++) world.tick()
    expect(world.getBlock(0, Y, 0)).toMatchObject({ outputPower: 15 })
    world.tick()
    expect(world.getBlock(0, Y, 0)).toMatchObject({ outputPower: 0 })
  })

  it('固体を強充電しない (weak のみ)', () => {
    const world = new SimWorld()
    world.setBlock(0, Y, 0, target())
    world.setBlock(1, Y, 0, solid())
    world.setBlock(2, Y, 0, wire())
    world.initialize()
    world.flush(64)
    world.activateBlock(0, Y, 0)
    expect(getStrongPower(world, [1, Y, 0])).toBe(0)
    expect(world.getBlock(2, Y, 0)).toMatchObject({ power: 0 })
  })

  it('initialize は POWER>0 の target を 0 に戻す (vanilla onPlace)', () => {
    const world = new SimWorld()
    world.setBlock(0, Y, 0, target(15))
    world.setBlock(1, Y, 0, wire())
    world.initialize()
    world.flush(64)
    expect(world.getBlock(0, Y, 0)).toMatchObject({ outputPower: 0 })
    expect(world.getBlock(1, Y, 0)).toMatchObject({ power: 0 })
  })
})

// ─────────────────────────────────────────────────────────────
// redstone block: コンパレーター側面入力 (#35 実機バグ報告 1)
// [確定: 1.21.1 SignalGetter.getControlInputSignal(diodesOnly=false) —
//  REDSTONE_BLOCK は定数 15。比較・減算どちらのモードにも効く]
// ─────────────────────────────────────────────────────────────

describe('redstone block: コンパレーター側面入力 = 15', () => {
  function lever(powered: boolean): BlockState {
    return { type: 'lever', facing: 'up', powered }
  }
  function comparator(mode: 'compare' | 'subtract'): BlockState {
    return { type: 'comparator', facing: 'east', mode, powered: false, outputPower: 0 }
  }

  it('compare: back=13 < side=15 → 出力 0 (側面が背面を棄却)', () => {
    const world = new SimWorld()
    world.setBlock(0, Y, 0, lever(true))
    world.setBlock(1, Y, 0, wire())
    world.setBlock(2, Y, 0, wire())
    world.setBlock(3, Y, 0, wire())
    world.setBlock(4, Y, 0, comparator('compare'))   // back = west の wire(13)
    world.setBlock(4, Y, 1, redstoneBlock())          // side (south)
    world.setBlock(5, Y, 0, wire())
    world.initialize()
    world.flush(64)
    expect(world.getBlock(3, Y, 0)).toMatchObject({ power: 13 })
    expect(world.getBlock(4, Y, 0)).toMatchObject({ powered: false, outputPower: 0 })
    expect(world.getBlock(5, Y, 0)).toMatchObject({ power: 0 })
  })

  it('compare: back=15 >= side=15 → 15 を通す (等号は通過)', () => {
    const world = new SimWorld()
    world.setBlock(0, Y, 0, lever(true))
    world.setBlock(1, Y, 0, wire())
    world.setBlock(2, Y, 0, comparator('compare'))
    world.setBlock(2, Y, 1, redstoneBlock())
    world.setBlock(3, Y, 0, wire())
    world.initialize()
    world.flush(64)
    expect(world.getBlock(2, Y, 0)).toMatchObject({ powered: true, outputPower: 15 })
    expect(world.getBlock(3, Y, 0)).toMatchObject({ power: 15 })
  })

  it('subtract: back=15 - side=15 → 出力 0', () => {
    const world = new SimWorld()
    world.setBlock(0, Y, 0, lever(true))
    world.setBlock(1, Y, 0, wire())
    world.setBlock(2, Y, 0, comparator('subtract'))
    world.setBlock(2, Y, 1, redstoneBlock())
    world.setBlock(3, Y, 0, wire())
    world.initialize()
    world.flush(64)
    expect(world.getBlock(2, Y, 0)).toMatchObject({ powered: false, outputPower: 0 })
    expect(world.getBlock(3, Y, 0)).toMatchObject({ power: 0 })
  })
})

// ─────────────────────────────────────────────────────────────
// target: 導体としての伝導 (#35 実機バグ報告 2)
// [確定: 1.21.1 Blocks.TARGET は isRedstoneConductor 非 override (導体) /
//  RedStoneWireBlock.getDirectSignal = shouldSignal ? getSignal : 0 →
//  ダストが指す target は機構・ダイオード読みには充電として見えるが、
//  他のダストの強度計算には見えない (shouldSignal=false)]
// ─────────────────────────────────────────────────────────────

describe('target block: 導体伝導 (dust が指す target 越しの読み)', () => {
  function lever(powered: boolean): BlockState {
    return { type: 'lever', facing: 'up', powered }
  }
  function torch(lit = true): BlockState {
    return { type: 'torch', facing: 'up', lit }
  }
  function comparator(mode: 'compare' | 'subtract'): BlockState {
    return { type: 'comparator', facing: 'east', mode, powered: false, outputPower: 0 }
  }

  it('dust → target で隣接ランプ点灯・直上トーチ消灯・背面コンパレーター出力 (報告回路 B)', () => {
    // lever(0) → wire(1) → target(2) の東西列。
    // lamp は target の北 (2,0,-1)、torch は直上 (2,1,0)、comparator は東隣 (3,0,0)
    const world = new SimWorld()
    world.setBlock(0, Y, 0, lever(true))
    world.setBlock(1, Y, 0, wire())
    world.setBlock(2, Y, 0, target())
    world.setBlock(2, Y, -1, lamp())
    world.setBlock(2, 1, 0, torch())
    world.setBlock(3, Y, 0, comparator('compare')) // back = west = target
    world.setBlock(4, Y, 0, wire())
    world.initialize()
    world.flush(64)

    expect(world.getBlock(1, Y, 0)).toMatchObject({ power: 15 })
    expect(world.getBlock(2, Y, -1)).toMatchObject({ type: 'lamp', lit: true })
    expect(world.getBlock(2, 1, 0)).toMatchObject({ type: 'torch', lit: false })
    // 充電レベル 15 をアナログのまま背面読み (減衰なし)
    expect(world.getBlock(3, Y, 0)).toMatchObject({ powered: true, outputPower: 15 })
    expect(world.getBlock(4, Y, 0)).toMatchObject({ power: 15 })
  })

  it('dust に弱充電された target は他の dust に給電しない (solid と同じ)', () => {
    const world = new SimWorld()
    world.setBlock(0, Y, 0, lever(true))
    world.setBlock(1, Y, 0, wire())
    world.setBlock(2, Y, 0, target())
    world.setBlock(3, Y, 0, wire()) // 反対側のプローブ dust
    world.initialize()
    world.flush(64)
    expect(world.getBlock(1, Y, 0)).toMatchObject({ power: 15 })
    expect(world.getBlock(3, Y, 0)).toMatchObject({ power: 0 })
  })

  it('強充電された target (repeater 前方) は隣接 dust にも給電する', () => {
    const world = new SimWorld()
    world.setBlock(0, Y, 0, lever(true))
    world.setBlock(1, Y, 0, {
      type: 'repeater', facing: 'east', delay: 1, powered: false, locked: false,
    })
    world.setBlock(2, Y, 0, target())
    world.setBlock(3, Y, 0, wire())
    world.initialize()
    world.flush(64)
    expect(world.getBlock(1, Y, 0)).toMatchObject({ powered: true })
    expect(world.getBlock(3, Y, 0)).toMatchObject({ power: 15 })
  })

  it('レバー OFF に戻すと導体越しの機構も消える', () => {
    const world = new SimWorld()
    world.setBlock(0, Y, 0, lever(false))
    world.setBlock(1, Y, 0, wire())
    world.setBlock(2, Y, 0, target())
    world.setBlock(2, Y, -1, lamp())
    world.setBlock(3, Y, 0, comparator('compare'))
    world.initialize()
    world.flush(64)
    expect(world.getBlock(2, Y, -1)).toMatchObject({ lit: false })

    world.activateBlock(0, Y, 0) // ON
    world.flush(64)
    expect(world.getBlock(2, Y, -1)).toMatchObject({ lit: true })
    expect(world.getBlock(3, Y, 0)).toMatchObject({ powered: true })

    world.activateBlock(0, Y, 0) // OFF
    world.flush(64)
    expect(world.getBlock(2, Y, -1)).toMatchObject({ lit: false })
    expect(world.getBlock(3, Y, 0)).toMatchObject({ powered: false, outputPower: 0 })
  })

  it('発火中の target (outputPower>0) が側面にあってもコンパレーター側面入力にはならない', () => {
    // [確定: 1.21.1 TargetBlock は getDirectSignal 非 override → 側面 0]
    // back=14 < 発火 target の 15 なので、もし側面に数えると出力 0 になるはず
    const world = new SimWorld()
    world.setBlock(0, Y, 0, lever(true))
    world.setBlock(1, Y, 0, wire())
    world.setBlock(2, Y, 0, wire())
    world.setBlock(3, Y, 0, comparator('compare')) // back = wire(14)
    world.setBlock(3, Y, 1, target())              // side (south)
    world.initialize()
    world.flush(64)
    expect(world.getBlock(3, Y, 0)).toMatchObject({ powered: true, outputPower: 14 })

    world.activateBlock(3, Y, 1) // target 発火 15 (持続 20gt)
    world.tick()
    world.tick() // コンパレーター遅延 2gt 分を消化
    // side=0 扱いなので back=14 がそのまま通り続ける
    expect(world.getBlock(3, Y, 1)).toMatchObject({ outputPower: 15 })
    expect(world.getBlock(3, Y, 0)).toMatchObject({ powered: true, outputPower: 14 })
  })
})

// ─────────────────────────────────────────────────────────────
// mcstate 変換 (nbtIO / fixture 用)
// ─────────────────────────────────────────────────────────────

describe('mcstate: redstone block / target の相互変換', () => {
  it('redstone_block の往復', () => {
    const sim = mcToSim('minecraft:redstone_block')
    expect(sim).toEqual({ type: 'redstone_block' })
    expect(canonicalize(simToMc(sim, 'minecraft:redstone_block'))).toBe('redstone_block')
  })

  it('target[power=N] を outputPower に読み、書き戻す', () => {
    const sim = mcToSim('minecraft:target[power=9]')
    expect(sim).toEqual({ type: 'target', outputPower: 9 })
    expect(canonicalize(simToMc(sim, 'target[power=0]'))).toBe('target[power=9]')
  })

  it('power 省略時は 0', () => {
    expect(mcToSim('minecraft:target')).toEqual({ type: 'target', outputPower: 0 })
  })
})
