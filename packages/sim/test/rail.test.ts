import { describe, it, expect } from 'vitest'
import { SimWorld } from '../src/world'
import { planRailPlacement, railConnections, shouldRailBePowered } from '../src/rail'
import type { BlockState, RailShape, Pos3D } from '../src/types'

/**
 * #127 パワードレール。
 *
 * 検証の要点は 2 つ:
 *   1. 形状の自動接続 (RailState) — 隣にレールがあると向きが繋がる
 *   2. 動力の連鎖伝播 (findPoweredRailSignal) — 繋がったレールを **最大 8 個**
 *      たどり、その先で受電していれば powered になる
 * ダストと違って強度は持たず、8 本先までは減衰なしで届き 9 本目で切れる。
 */

const rail = (shape: RailShape = 'north_south', powered = false): BlockState =>
  ({ type: 'powered_rail', shape, powered })
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
  return b?.type === 'powered_rail' ? b.shape : `(${b?.type ?? 'air'})`
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
