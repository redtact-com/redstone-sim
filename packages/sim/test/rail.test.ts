import { describe, it, expect } from 'vitest'
import { SimWorld } from '../src/world'
import { planRailPlacement, railConnections, shouldRailBePowered } from '../src/rail'
import { isRailSlope, isCurvedRailShape } from '../src/types'
import type { BlockState, RailShape, StraightRailShape, Pos3D } from '../src/types'

/**
 * #127 パワードレール。
 *
 * 検証の要点は 2 つ:
 *   1. 形状の自動接続 (RailState) — 隣にレールがあると向きが繋がる
 *   2. 動力の連鎖伝播 (findPoweredRailSignal) — 繋がったレールを **最大 8 個**
 *      たどり、その先で受電していれば powered になる
 * ダストと違って強度は持たず、8 本先までは減衰なしで届き 9 本目で切れる。
 */

const rail = (shape: StraightRailShape = 'north_south', powered = false): BlockState =>
  ({ type: 'powered_rail', shape, powered })
/** 通常レール (曲線を取れる) */
const prail = (shape: RailShape = 'north_south'): BlockState => ({ type: 'rail', shape })
const solid = (): BlockState => ({ type: 'solid', powered: false })

/** x 方向へ n 本のレールを敷き、西端にレバーを置いた世界 */
function railLine(n: number): SimWorld {
  const w = new SimWorld()
  for (let x = -1; x <= n; x++) w.setBlockAt([x, -1, 0], solid())
  // 実機で敷いたときと同じ形状 (east_west) を authored に持たせる
  for (let x = 0; x < n; x++) w.setBlockAt([x, 0, 0], rail('east_west'))
  w.setBlockAt([-1, 0, 0], { type: 'lever', facing: 'up', powered: false } as BlockState)
  w.initialize()
  return w
}

const shapeAt = (w: SimWorld, pos: Pos3D): string => {
  const b = w.getBlockAt(pos)
  if (b?.type === 'powered_rail' || b?.type === 'activator_rail' || b?.type === 'rail') return b.shape
  return `(${b?.type ?? 'air'})`
}
const poweredAt = (w: SimWorld, pos: Pos3D): boolean => {
  const b = w.getBlockAt(pos)
  return b?.type === 'powered_rail' && b.powered
}

describe('powered_rail の形状 (RailState)', () => {
  it('繋がる 2 マスは形状で決まる (坂は登った先が 1 段上)', () => {
    expect(railConnections([0, 0, 0], 'north_south')).toEqual([[0, 0, -1], [0, 0, 1]])
    expect(railConnections([0, 0, 0], 'east_west')).toEqual([[-1, 0, 0], [1, 0, 0]])
    // ascending_east は西へ平地、東へ 1 段上がる
    expect(railConnections([0, 0, 0], 'ascending_east')).toEqual([[-1, 0, 0], [1, 1, 0]])
    expect(railConnections([0, 0, 0], 'ascending_north')).toEqual([[0, 1, -1], [0, 0, 1]])
  })

  it('隣にレールがあると向きが繋がる (north_south で置いても east_west になる)', () => {
    const w = new SimWorld()
    w.setBlockAt([0, 0, 0], rail('east_west'))
    // 既定形状 north_south で東隣に置く → 西隣のレールに引かれて east_west になる
    w.setBlockAt([1, 0, 0], rail('north_south'))
    const changes = planRailPlacement(w, [1, 0, 0], 'north_south')
    const self = changes.find(c => c.pos[0] === 1)
    expect(self?.shape).toBe('east_west')
  })

  it('隣の 1 段上にレールがあると坂になる', () => {
    const w = new SimWorld()
    w.setBlockAt([1, 1, 0], rail('east_west'))   // 東隣の 1 段上
    w.setBlockAt([0, 0, 0], rail('east_west'))
    const changes = planRailPlacement(w, [0, 0, 0], 'east_west')
    expect(changes.find(c => c.pos[0] === 0 && c.pos[1] === 0)?.shape).toBe('ascending_east')
  })

  it('孤立して置くと既定形状 (置いた向き) のまま', () => {
    const w = new SimWorld()
    w.setBlockAt([0, 0, 0], rail('north_south'))
    const changes = planRailPlacement(w, [0, 0, 0], 'north_south')
    // 変化なし = pending に何も積まれないか、同じ形状
    expect(changes.every(c => c.shape === 'north_south')).toBe(true)
  })
})

describe('powered_rail の動力伝播 (findPoweredRailSignal)', () => {
  it('レバーに触れた 1 本が powered になる', () => {
    const w = railLine(1)
    w.activateBlock(-1, 0, 0)
    expect(poweredAt(w, [0, 0, 0])).toBe(true)
  })

  it('繋がったレールを 8 本先までたどって powered になる', () => {
    const w = railLine(9)
    w.activateBlock(-1, 0, 0)
    // レバーに接している 0 番から数えて 8 本先 (= index 8) までが上限
    for (let x = 0; x <= 8; x++) {
      expect(poweredAt(w, [x, 0, 0]), `x=${x} は powered のはず`).toBe(true)
    }
  })

  it('9 本目 (深さ 9) には届かない', () => {
    const w = railLine(10)
    w.activateBlock(-1, 0, 0)
    expect(poweredAt(w, [8, 0, 0])).toBe(true)
    expect(poweredAt(w, [9, 0, 0])).toBe(false)
  })

  it('レバーを切ると全部消える', () => {
    const w = railLine(5)
    w.activateBlock(-1, 0, 0)
    expect(poweredAt(w, [4, 0, 0])).toBe(true)
    w.activateBlock(-1, 0, 0)
    for (let x = 0; x < 5; x++) expect(poweredAt(w, [x, 0, 0])).toBe(false)
  })

  it('向きが直交するレールへは伝播しない', () => {
    const w = new SimWorld()
    for (let x = -1; x <= 2; x++) w.setBlockAt([x, -1, 0], solid())
    w.setBlockAt([0, -1, 1], solid())
    w.setBlockAt([-1, 0, 0], { type: 'lever', facing: 'up', powered: false } as BlockState)
    w.setBlockAt([0, 0, 0], rail('east_west'))
    w.setBlockAt([1, 0, 0], rail('north_south'))   // 進行軸に直交
    w.initialize()
    w.activateBlock(-1, 0, 0)
    expect(poweredAt(w, [0, 0, 0])).toBe(true)
    expect(poweredAt(w, [1, 0, 0])).toBe(false)
  })

  it('初期化時点でも連鎖は成立する (authored の powered には依存しない)', () => {
    const w = new SimWorld()
    for (let x = -1; x <= 5; x++) w.setBlockAt([x, -1, 0], solid())
    w.setBlockAt([-1, 0, 0], { type: 'redstone_block' } as BlockState)
    // authored は powered=false でも、初期化の収束で連鎖が組み上がる
    for (let x = 0; x < 5; x++) w.setBlockAt([x, 0, 0], rail('east_west'))
    w.initialize()
    for (let x = 0; x < 5; x++) expect(poweredAt(w, [x, 0, 0])).toBe(true)
  })

  it('authored の根拠なき powered は初期化で落ちる', () => {
    const w = new SimWorld()
    w.setBlockAt([0, -1, 0], solid())
    w.setBlockAt([0, 0, 0], rail('east_west', true))   // 動力源が無いのに powered
    w.initialize()
    expect(poweredAt(w, [0, 0, 0])).toBe(false)
  })

  it('shouldRailBePowered は自身6面の受電を直接見る', () => {
    const w = new SimWorld()
    w.setBlockAt([0, -1, 0], solid())
    w.setBlockAt([0, 0, 0], rail('east_west'))
    w.setBlockAt([1, 0, 0], { type: 'redstone_block' } as BlockState)
    w.initialize()
    expect(shouldRailBePowered(w, [0, 0, 0], 'east_west')).toBe(true)
  })
})

/**
 * パワードレールの唯一の「出力」= powered が変わったときに **真下のブロック**へ
 * 配られる近隣更新 [確定: 26.2 PoweredRailBlock.updateState の updateNeighborsAt(pos.below())]。
 *
 * ピストンは「動力判定は quasi 位置を含む live read だが、活性化は近隣更新でしか
 * 走らない」ので、更新が届いていなければ動かない (= BUD)。そこへレールが更新を
 * 配ると初めて伸びる。レールを外した対照も置いて、更新源がレールであることを示す。
 */
describe('powered_rail は真下のブロックへ更新を配る (BUD の更新源)', () => {
  /** レバー → レール → (真下の石) → 西隣のピストン。quasi セルは空のまま初期化する */
  function budWorld(withRail: boolean): SimWorld {
    const w = new SimWorld()
    w.setBlockAt([5, 0, 3], solid())
    w.setBlockAt([6, 1, 3], solid())          // レールの真下
    w.setBlockAt([7, 1, 3], solid())          // レバーの支持
    w.setBlockAt([5, 1, 3], { type: 'piston', facing: 'east', extended: false } as BlockState)
    if (withRail) w.setBlockAt([6, 2, 3], rail('east_west'))
    w.setBlockAt([7, 2, 3], { type: 'lever', facing: 'up', powered: false } as BlockState)
    w.initialize()
    return w
  }

  const extended = (w: SimWorld): boolean => {
    const b = w.getBlockAt([5, 1, 3])
    return b?.type === 'piston' && b.extended
  }

  it('更新を受けていないピストンは quasi が通電しても伸びない (BUD 状態を作る)', () => {
    const w = budWorld(true)
    // setBlockAt は近隣更新を出さない = 「置いたことをピストンが知らない」状態
    w.setBlockAt([5, 2, 3], { type: 'redstone_block' } as BlockState)
    w.settle(64)
    expect(extended(w)).toBe(false)
  })

  it('レールが powered になると真下経由で更新が届きピストンが伸びる', () => {
    const w = budWorld(true)
    w.setBlockAt([5, 2, 3], { type: 'redstone_block' } as BlockState)
    w.settle(64)
    expect(extended(w)).toBe(false)

    w.activateBlock(7, 2, 3)            // レバー ON → レール powered
    expect(poweredAt(w, [6, 2, 3])).toBe(true)
    w.settle(64)
    expect(extended(w)).toBe(true)
  })

  it('対照: レールが無いと同じレバー操作でもピストンは伸びない', () => {
    const w = budWorld(false)
    w.setBlockAt([5, 2, 3], { type: 'redstone_block' } as BlockState)
    w.settle(64)
    w.activateBlock(7, 2, 3)
    w.settle(64)
    expect(extended(w)).toBe(false)
  })
})

/**
 * 形状を張り替えたレールは、置いた本人でなくても更新源になる (#132)
 * [確定: 26.2 RailState.place / connectTo はどちらも setBlock(pos, state, 3) — flag 1 で
 *  周囲 6 方向へ近隣更新、flag 16 が無いので updateNeighbourShapes も走る]。
 * 実機 fixture rail-shape-update / rail-shape-chain-join が典拠。
 */
describe('形状の張り替えが更新源になる (#132)', () => {
  /** A=(2,1,3) を east_west で孤立させ、南隣に置くと north_south へ張り替わる世界 */
  function shapeFlipWorld(): SimWorld {
    const w = new SimWorld()
    w.setBlockAt([2, 0, 3], solid())
    w.setBlockAt([2, 0, 4], solid())
    w.setBlockAt([2, 1, 3], rail('east_west'))
    w.initialize()
    return w
  }

  it('南隣に置くと孤立していたレールが north_south に張り替わる', () => {
    const w = shapeFlipWorld()
    w.setBlockCommand([2, 1, 4], rail('north_south'))
    expect(shapeAt(w, [2, 1, 3])).toBe('north_south')
  })

  it('張り替わったレールに面したオブザーバーが発火する', () => {
    const w = new SimWorld()
    w.setBlockAt([2, 0, 3], solid())
    w.setBlockAt([2, 0, 4], solid())
    w.setBlockAt([2, 1, 3], rail('east_west'))
    w.setBlockAt([2, 2, 3], { type: 'observer', facing: 'down', powered: false } as BlockState)
    w.initialize()

    w.setBlockCommand([2, 1, 4], rail('north_south'))
    // startSignal は 2gt の tile tick なので 2 tick 進めると powered になる
    let fired = false
    for (let t = 0; t < 4; t++) {
      w.tick()
      const o = w.getBlockAt([2, 2, 3])
      if (o?.type === 'observer' && o.powered) fired = true
    }
    expect(fired).toBe(true)
  })

  it('張り替わったレールが近隣更新を配る (更新を待っていたピストンが伸びる)', () => {
    const w = new SimWorld()
    w.setBlockAt([2, 0, 3], solid())
    w.setBlockAt([2, 0, 4], solid())
    w.setBlockAt([2, 1, 3], rail('east_west'))
    // A の北隣のピストン。quasi セル (2,2,2) を通電させておくが更新は届いていない
    w.setBlockAt([2, 1, 2], { type: 'piston', facing: 'north', extended: false } as BlockState)
    w.setBlockAt([2, 2, 2], solid())
    w.initialize()
    w.setBlockAt([3, 2, 2], { type: 'redstone_block' } as BlockState)  // 更新を出さない
    w.settle(16)
    const before = w.getBlockAt([2, 1, 2])
    expect(before?.type === 'piston' && before.extended, 'まだ更新が届いていない').toBe(false)

    // 南隣にレールを置く → A が張り替わり、その近隣更新がピストンに届く
    w.setBlockCommand([2, 1, 4], rail('north_south'))
    w.settle(16)
    const after = w.getBlockAt([2, 1, 2])
    expect(after?.type === 'piston' && after.extended).toBe(true)
  })

  it('対照: 形状が張り替わらない置き方ではピストンは伸びない', () => {
    const w = new SimWorld()
    w.setBlockAt([2, 0, 3], solid())
    w.setBlockAt([2, 1, 3], rail('east_west'))
    w.setBlockAt([2, 1, 2], { type: 'piston', facing: 'north', extended: false } as BlockState)
    w.setBlockAt([2, 2, 2], solid())
    w.initialize()
    w.setBlockAt([3, 2, 2], { type: 'redstone_block' } as BlockState)
    w.settle(16)

    // A から 2 マス離れた位置に置く → A の形状は変わらず更新も出ない
    w.setBlockAt([5, 0, 3], solid())
    w.setBlockCommand([5, 1, 3], rail('east_west'))
    w.settle(16)
    const after = w.getBlockAt([2, 1, 2])
    expect(after?.type === 'piston' && after.extended).toBe(false)
  })
})

describe('powered_rail は信号を出さない', () => {
  it('powered でも隣のランプは点かない', () => {
    const w = new SimWorld()
    for (let x = -1; x <= 2; x++) w.setBlockAt([x, -1, 0], solid())
    w.setBlockAt([-1, 0, 0], { type: 'redstone_block' } as BlockState)
    w.setBlockAt([0, 0, 0], rail('east_west'))
    w.setBlockAt([1, 0, 0], { type: 'lamp', lit: false } as BlockState)
    w.initialize()
    expect(poweredAt(w, [0, 0, 0])).toBe(true)
    const lamp = w.getBlockAt([1, 0, 0])
    expect(lamp?.type === 'lamp' && lamp.lit).toBe(false)
  })

  it('形状は authored のまま初期化される (実機の設置順の結果を尊重する)', () => {
    const w = new SimWorld()
    w.setBlockAt([0, -1, 0], solid())
    w.setBlockAt([0, 0, 0], rail('ascending_east'))
    w.initialize()
    expect(shapeAt(w, [0, 0, 0])).toBe('ascending_east')
  })
})

/**
 * activator_rail は powered_rail と同じ PoweredRailBlock の別インスタンス (#138)
 * [確定: 26.2 Blocks.java:690 / :2893 — どちらも PoweredRailBlock::new]。
 * 挙動の差は連鎖探索の `state.is(this)` ガードだけで、**動力の連鎖は同種間でしか
 * 繋がらない** [確定: 26.2 PoweredRailBlock.isSameRailWithPower]
 * [実機 fixture activator-rail-mixed-chain / activator-rail-chain]。
 */
describe('activator_rail (#138)', () => {
  const arail = (shape: RailShape = 'east_west', powered = false): BlockState =>
    ({ type: 'activator_rail', shape, powered })

  /** x 方向に types[] の順でレールを敷き、西端にレバーを置いた世界 */
  function mixedLine(types: ('powered_rail' | 'activator_rail')[]): SimWorld {
    const w = new SimWorld()
    for (let x = -1; x <= types.length; x++) w.setBlockAt([x, -1, 0], solid())
    types.forEach((t, i) => {
      w.setBlockAt([i, 0, 0], t === 'powered_rail' ? rail('east_west') : arail('east_west'))
    })
    w.setBlockAt([-1, 0, 0], { type: 'lever', facing: 'up', powered: false } as BlockState)
    w.initialize()
    return w
  }
  const on = (w: SimWorld, x: number): boolean => {
    const b = w.getBlockAt([x, 0, 0])
    return (b?.type === 'powered_rail' || b?.type === 'activator_rail') && b.powered
  }

  it('activator_rail 単体でもレバーで on になる', () => {
    const w = mixedLine(['activator_rail'])
    w.activateBlock(-1, 0, 0)
    expect(on(w, 0)).toBe(true)
  })

  it('activator_rail 同士なら 8 本先まで連鎖する', () => {
    const w = mixedLine(Array(10).fill('activator_rail'))
    w.activateBlock(-1, 0, 0)
    for (let x = 0; x <= 8; x++) expect(on(w, x), `x=${x}`).toBe(true)
    expect(on(w, 9)).toBe(false)
  })

  it('powered_rail → activator_rail へは連鎖が渡らない', () => {
    const w = mixedLine(['powered_rail', 'powered_rail', 'activator_rail', 'activator_rail'])
    w.activateBlock(-1, 0, 0)
    expect(on(w, 0)).toBe(true)
    expect(on(w, 1)).toBe(true)
    expect(on(w, 2), '異種の境目で切れる').toBe(false)
    expect(on(w, 3)).toBe(false)
  })

  it('activator_rail → powered_rail へも連鎖が渡らない (逆向きも同じ)', () => {
    const w = mixedLine(['activator_rail', 'activator_rail', 'powered_rail', 'powered_rail'])
    w.activateBlock(-1, 0, 0)
    expect(on(w, 0)).toBe(true)
    expect(on(w, 1)).toBe(true)
    expect(on(w, 2)).toBe(false)
    expect(on(w, 3)).toBe(false)
  })

  it('形状の自動接続は種別をまたぐ (BlockTags.RAILS)', () => {
    const w = new SimWorld()
    w.setBlockAt([0, 0, 0], arail('east_west'))
    // 既定形状 north_south で東隣に powered_rail を置く → 異種でも向きは繋がる
    w.setBlockAt([1, 0, 0], rail('north_south'))
    const changes = planRailPlacement(w, [1, 0, 0], 'north_south')
    expect(changes.find(c => c.pos[0] === 1)?.shape).toBe('east_west')
  })
})

/**
 * レールはピストンで押せる (PushReaction NORMAL) (#134)
 * [確定: 26.2 Blocks.java:689,692,2892 — レール 4 種とも pushReaction 未指定 = 既定 NORMAL]。
 * 着地時は onPlace が movedByPiston でも走るので、形状の決め直しと powered の
 * 再計算がその場で起きる [確定: 26.2 BaseRailBlock.java:64-77]。
 * 実機 fixture rail-piston-push / -connect / -powered が典拠。
 */
describe('レールはピストンで押される (#134)', () => {
  /** レバー(1) → ピストン(2, 東向き) → レール(3) → 着地先(4) を y=1 に並べた世界 */
  function pushWorld(floorAt3: BlockState = solid()): SimWorld {
    const w = new SimWorld()
    for (let x = 1; x <= 4; x++) w.setBlockAt([x, 0, 3], solid())
    w.setBlockAt([3, 0, 3], floorAt3)
    w.setBlockAt([1, 1, 3], { type: 'lever', facing: 'up', powered: false } as BlockState)
    w.setBlockAt([2, 1, 3], { type: 'piston', facing: 'east', extended: false } as BlockState)
    return w
  }

  it('レールは障害物ではなく 1 マス押される (形状は保持)', () => {
    const w = pushWorld()
    w.setBlockAt([3, 1, 3], rail('east_west'))
    w.initialize()

    w.activateBlock(1, 1, 3)
    w.settle(32)
    expect(shapeAt(w, [4, 1, 3])).toBe('east_west')
    expect(w.getBlockAt([3, 1, 3])?.type).not.toBe('powered_rail')
  })

  it('着地先の隣にレールがあると繋がって形状を決め直す', () => {
    const w = pushWorld()
    w.setBlockAt([4, 0, 4], solid())
    w.setBlockAt([3, 1, 3], rail('east_west'))
    w.setBlockAt([4, 1, 4], rail('north_south'))   // 着地先の南隣
    w.initialize()

    w.activateBlock(1, 1, 3)
    w.settle(32)
    // east_west のまま飛んでいくが、着地時の onPlace で north_south に張り替わる
    expect(shapeAt(w, [4, 1, 3])).toBe('north_south')
  })

  it('電源から押し離されると着地の時点で powered が落ちる', () => {
    // レールの真下だけレッドストーンブロック。移動先 (4,0,3) は石なので受電が切れる
    const w = pushWorld({ type: 'redstone_block' } as BlockState)
    w.setBlockAt([3, 1, 3], rail('east_west'))
    w.initialize()
    expect(poweredAt(w, [3, 1, 3]), '押す前は真下から受電している').toBe(true)

    w.activateBlock(1, 1, 3)
    w.settle(32)
    // 「動かなかったから off」で通ってしまわないよう、移動したことも見る
    expect(shapeAt(w, [4, 1, 3]), 'レールが移動していること').toBe('east_west')
    expect(poweredAt(w, [4, 1, 3])).toBe(false)
  })
})

/**
 * 通常レール `rail` の曲線 4 形状 (#140)
 * [確定: 26.2 RailState.place — 第二段の排他条件 4 つ + 第三段の hasSignal 依存]。
 * 実機 fixture rail-curve-priority / rail-junction-place / rail-curve-no-slope が典拠。
 */
describe('通常レールの曲線 (#140)', () => {
  /** 中心 (0,0,0) に指定方向の隣接レールを置いた世界 */
  function neighbors(dirs: { n?: boolean; s?: boolean; w?: boolean; e?: boolean }): SimWorld {
    const w = new SimWorld()
    w.setBlockAt([0, 0, 0], prail('north_south'))
    if (dirs.n) w.setBlockAt([0, 0, -1], prail('north_south'))
    if (dirs.s) w.setBlockAt([0, 0, 1], prail('north_south'))
    if (dirs.w) w.setBlockAt([-1, 0, 0], prail('east_west'))
    if (dirs.e) w.setBlockAt([1, 0, 0], prail('east_west'))
    return w
  }
  const planned = (w: SimWorld, hasSignal = false): string | undefined =>
    planRailPlacement(w, [0, 0, 0], 'north_south', hasSignal)
      .find(c => c.pos[0] === 0 && c.pos[2] === 0)?.shape

  it('直交する 2 方向の隣接で曲線が決まる (排他条件)', () => {
    expect(planned(neighbors({ s: true, e: true }))).toBe('south_east')
    expect(planned(neighbors({ s: true, w: true }))).toBe('south_west')
    expect(planned(neighbors({ n: true, w: true }))).toBe('north_west')
    expect(planned(neighbors({ n: true, e: true }))).toBe('north_east')
  })

  it('片軸だけの隣接なら直線のまま (曲線分岐に入らない)', () => {
    expect(planned(neighbors({ n: true, s: true }))).toBe('north_south')
    expect(planned(neighbors({ w: true, e: true }))).toBe('east_west')
  })

  it('3 方向ジャンクションは給電の有無で曲がる先が反転する', () => {
    // n,s,e の 3 方向。southAndEast と northAndEast の両方が真になり後勝ちで決まる
    expect(planned(neighbors({ n: true, s: true, e: true }), false)).toBe('south_east')
    expect(planned(neighbors({ n: true, s: true, e: true }), true)).toBe('north_east')
  })

  it('直線レール (powered_rail) は同じ配置でも曲線にならない', () => {
    const w = new SimWorld()
    w.setBlockAt([0, 0, 0], rail('north_south'))
    w.setBlockAt([0, 0, -1], prail('north_south'))
    w.setBlockAt([0, 0, 1], prail('north_south'))
    w.setBlockAt([1, 0, 0], prail('east_west'))
    // 両軸に隣接があるので defaultShape が残る (曲線分岐は isStraight で塞がれる)
    const shape = planRailPlacement(w, [0, 0, 0], 'north_south', true)
      .find(c => c.pos[0] === 0 && c.pos[2] === 0)?.shape
    expect(shape).toBe('north_south')
  })

  it('曲線に決まった後は坂昇格が適用されない', () => {
    const w = new SimWorld()
    w.setBlockAt([0, 0, 0], prail('north_south'))
    w.setBlockAt([0, 0, 1], prail('north_south'))   // 南: 同じ高さ
    w.setBlockAt([1, 1, 0], prail('east_west'))     // 東: 1 段上
    expect(planned(w)).toBe('south_east')
  })

  it('対照: 東の 1 段上だけなら east_west 経由で坂になる', () => {
    const w = new SimWorld()
    w.setBlockAt([0, 0, 0], prail('east_west'))
    w.setBlockAt([1, 1, 0], prail('east_west'))
    const shape = planRailPlacement(w, [0, 0, 0], 'east_west')
      .find(c => c.pos[0] === 0 && c.pos[1] === 0)?.shape
    expect(shape).toBe('ascending_east')
  })

  it('曲線の繋がる 2 マスは名前どおり', () => {
    expect(railConnections([0, 0, 0], 'south_east')).toEqual([[1, 0, 0], [0, 0, 1]])
    expect(railConnections([0, 0, 0], 'north_west')).toEqual([[-1, 0, 0], [0, 0, -1]])
  })

  it('曲線は坂ではない (isRailSlope が誤判定しない)', () => {
    for (const s of ['south_east', 'south_west', 'north_west', 'north_east'] as RailShape[]) {
      expect(isRailSlope(s), s).toBe(false)
      expect(isCurvedRailShape(s), s).toBe(true)
    }
    expect(isRailSlope('ascending_east')).toBe(true)
    expect(isCurvedRailShape('ascending_east')).toBe(false)
  })

  it('形状の接続は種別をまたぐ (通常レール ↔ パワードレール)', () => {
    const w = new SimWorld()
    w.setBlockAt([0, 0, 0], rail('east_west'))          // powered_rail
    w.setBlockAt([1, 0, 0], prail('north_south'))       // 通常レールを東隣に
    const shape = planRailPlacement(w, [1, 0, 0], 'north_south')
      .find(c => c.pos[0] === 1)?.shape
    expect(shape).toBe('east_west')
  })
})
