import { describe, it, expect } from 'vitest'
import { SimWorld } from '../src/world'
import { slotsForSignal, fillSignal, effectiveContainerSignal, CONTAINER_SLOTS } from '../src/blocks/container'
import type { BlockState, Pos3D } from '../src/types'

/**
 * #236 シミュレーション中にコンテナ (樽) を触って入力にする。
 *
 * 検証の主眼は「**触っても何も起きない**方」。中身は BlockEntity の情報なので
 * blockstate は変わらず、飛ぶのは水平 4 方向のコンパレーター更新 (CU) だけ
 * [確定: 26.2 BlockEntity.setChanged → Level.updateNeighbourForOutputSignal]:
 *
 * ```java
 * for (Direction direction : Direction.Plane.HORIZONTAL) {   // 水平だけ
 *    if (state.is(Blocks.COMPARATOR)) { this.neighborChanged(...); }
 *    else if (state.isRedstoneConductor(...)) { ... 1 個越しのコンパレーターだけ }
 * }
 * ```
 *
 * ∴ 真上のコンパレーターも、隣のオブザーバーも動かない。
 */

const solid = (): BlockState => ({ type: 'solid', powered: false })
const container = (signal: number): BlockState => ({ type: 'container', signal })
const comparator = (facing: 'north' | 'south' | 'east' | 'west' | 'up' | 'down'): BlockState =>
  ({ type: 'comparator', facing, mode: 'compare', powered: false, outputPower: 0 } as BlockState)

const outputAt = (w: SimWorld, pos: Pos3D): number => {
  const b = w.getBlockAt(pos)
  return b?.type === 'comparator' ? b.outputPower : -1
}

describe('slotsForSignal — fillSignal の逆写像', () => {
  it('0-15 すべてで指定どおりの信号になる', () => {
    for (let s = 0; s <= 15; s++) {
      expect(fillSignal(slotsForSignal('container', s), CONTAINER_SLOTS), `signal=${s}`).toBe(s)
    }
  })

  it('スタック上限が違っても成り立つ (64 / 16 / 1)', () => {
    for (const stack of [64, 16, 1] as const) {
      for (let s = 0; s <= 15; s++) {
        expect(fillSignal(slotsForSignal('container', s, stack), CONTAINER_SLOTS),
          `stack=${stack} signal=${s}`).toBe(s)
      }
    }
  })

  it('15 は容量いっぱい、1 は 1 個だけ (両端は式どおりにならない)', () => {
    const full = slotsForSignal('container', 15)
    expect(full.every(x => x !== null && x.count === x.stack)).toBe(true)
    const one = slotsForSignal('container', 1)
    expect(one.filter(x => x !== null)).toHaveLength(1)
    expect(one[0]!.count).toBe(1)
  })

  it('ホッパー (5 スロット) でも成り立つ', () => {
    for (let s = 0; s <= 15; s++) {
      expect(fillSignal(slotsForSignal('hopper', s), 5), `signal=${s}`).toBe(s)
    }
  })

  it('容量が 14 個未満だと刻めない信号がある (スタック不可 × ホッパー)', () => {
    // 5 個しか入らないので 1 個 = 信号 3。1 と 2 は**作れない**
    expect(fillSignal(slotsForSignal('hopper', 1, 1), 5)).toBe(3)
    expect(fillSignal(slotsForSignal('hopper', 2, 1), 5)).toBe(3)
    expect(fillSignal(slotsForSignal('hopper', 3, 1), 5)).toBe(3)
    // 樽 (27 スロット) は 27 個入るのでこの穴は無い
    for (let s = 0; s <= 15; s++) {
      expect(fillSignal(slotsForSignal('container', s, 1), CONTAINER_SLOTS), `signal=${s}`).toBe(s)
    }
  })
})

describe('コンテナを手で触る (#236)', () => {
  /**
   * ```
   *        [Ob]                     y=1: 樽の上にコンパレーター
   *   [Co] [樽] [Co]                y=0: 東西にコンパレーター
   * ```
   * 西のコンパレーターは樽を背面 (東) から読む = facing west。
   */
  function world(signal = 0): SimWorld {
    const w = new SimWorld()
    for (const x of [-1, 0, 1]) w.setBlockAt([x, -1, 0], solid())
    w.setBlockAt([0, 0, 0], container(signal))
    w.setBlockAt([-1, 0, 0], comparator('west'))   // 背面 = 東 = 樽
    w.setBlockAt([0, 1, 0], comparator('up'))      // 真上 (背面 = 下 = 樽)
    w.initialize()
    return w
  }

  it('クリックで 1 段上がり、15 の次は 0 に戻る', () => {
    const w = world(14)
    w.activateBlock(0, 0, 0)
    expect(effectiveContainerSignal(w.getBlockAt([0, 0, 0]))).toBe(15)
    w.activateBlock(0, 0, 0)
    expect(effectiveContainerSignal(w.getBlockAt([0, 0, 0]))).toBe(0)
    w.activateBlock(0, 0, 0)
    expect(effectiveContainerSignal(w.getBlockAt([0, 0, 0]))).toBe(1)
  })

  it('水平のコンパレーターは 2gt 後に出力する', () => {
    const w = world(0)
    w.setContainerSignal(0, 0, 0, 7)
    expect(outputAt(w, [-1, 0, 0]), '同 tick では出ない (2gt の tile tick)').toBe(0)
    w.settle(8)
    expect(outputAt(w, [-1, 0, 0])).toBe(7)
  })

  it('真上のコンパレーターは反応しない (CU は水平だけ)', () => {
    const w = world(0)
    w.setContainerSignal(0, 0, 0, 9)
    w.settle(8)
    expect(outputAt(w, [0, 1, 0]), 'updateNeighbourForOutputSignal は HORIZONTAL のみ').toBe(0)
  })

  it('導体 1 個越しのコンパレーターには届く', () => {
    const w = new SimWorld()
    for (const x of [-2, -1, 0]) w.setBlockAt([x, -1, 0], solid())
    w.setBlockAt([0, 0, 0], container(0))
    w.setBlockAt([-1, 0, 0], solid())            // 導体 1 個
    w.setBlockAt([-2, 0, 0], comparator('west')) // その先
    w.initialize()
    w.setContainerSignal(0, 0, 0, 5)
    w.settle(8)
    expect(outputAt(w, [-2, 0, 0])).toBe(5)
  })

  it('導体 2 個越しには届かない', () => {
    const w = new SimWorld()
    for (const x of [-3, -2, -1, 0]) w.setBlockAt([x, -1, 0], solid())
    w.setBlockAt([0, 0, 0], container(0))
    w.setBlockAt([-1, 0, 0], solid())
    w.setBlockAt([-2, 0, 0], solid())
    w.setBlockAt([-3, 0, 0], comparator('west'))
    w.initialize()
    w.setContainerSignal(0, 0, 0, 5)
    w.settle(8)
    expect(outputAt(w, [-3, 0, 0])).toBe(0)
  })

  it('隣のオブザーバーは発火しない (blockstate が変わらないため)', () => {
    const w = new SimWorld()
    w.setBlockAt([0, -1, 0], solid())
    w.setBlockAt([0, 0, 0], container(0))
    // 樽を向いたオブザーバー (西から東を見る)
    w.setBlockAt([-1, 0, 0], { type: 'observer', facing: 'east', powered: false } as BlockState)
    w.initialize()
    w.setContainerSignal(0, 0, 0, 15)
    // **1 tick ずつ見る**。オブザーバーのパルスは 2gt で消えるので、
    // settle してから powered を見るだけでは発火を取りこぼす (最初そう書いて
    // 変異テストが素通りした)
    const fired: number[] = []
    for (let i = 0; i < 8; i++) {
      w.tick()
      const ob = w.getBlockAt([-1, 0, 0])
      if (ob?.type === 'observer' && ob.powered) fired.push(i)
    }
    expect(fired, '中身の変化でオブザーバーが鳴っている').toEqual([])
  })

  it('比較のため: 同じ位置のトラップドアを手で開ければオブザーバーは鳴る', () => {
    // 上のテストが「配置のせいで鳴らないだけ」でないことを示す対照。
    // 樽を、手で触ると blockstate が変わるトラップドアに差し替えただけ
    const w = new SimWorld()
    w.setBlockAt([0, -1, 0], solid())
    w.setBlockAt([0, 0, 0], { type: 'trapdoor_wood', facing: 'north', half: 'bottom', open: false, powered: false } as BlockState)
    w.setBlockAt([-1, 0, 0], { type: 'observer', facing: 'east', powered: false } as BlockState)
    w.initialize()
    w.activateBlock(0, 0, 0)
    const fired: number[] = []
    for (let i = 0; i < 8; i++) {
      w.tick()
      const ob = w.getBlockAt([-1, 0, 0])
      if (ob?.type === 'observer' && ob.powered) fired.push(i)
    }
    expect(fired.length, 'この配置ではそもそもオブザーバーが鳴らない = 上のテストが無意味')
      .toBeGreaterThan(0)
  })

  it('物流モード (slots 定義済み) でも指定の信号になる', () => {
    const w = new SimWorld()
    w.setBlockAt([0, -1, 0], solid())
    w.setBlockAt([0, 0, 0], { type: 'container', signal: 0, slots: slotsForSignal('container', 0) })
    w.setBlockAt([-1, 0, 0], comparator('west'))
    w.initialize()
    w.setContainerSignal(0, 0, 0, 12)
    const b = w.getBlockAt([0, 0, 0])
    expect(b?.type === 'container' && b.slots !== undefined, 'slots が消えている').toBe(true)
    expect(effectiveContainerSignal(b)).toBe(12)
    w.settle(8)
    expect(outputAt(w, [-1, 0, 0])).toBe(12)
  })

  it('同じ値を入れ直してもコンパレーターの出力は動かない', () => {
    // vanilla の setChanged は中身が動けば無条件に CU を出す (強度が同じでも)。
    // コンパレーター側が出力差分でしか予約しないので、結果は変わらない
    const w = world(7)
    w.settle(8)
    const before = w.getBlockAt([-1, 0, 0])
    w.setContainerSignal(0, 0, 0, 7)
    w.settle(8)
    expect(w.getBlockAt([-1, 0, 0])).toEqual(before)
  })

  it('コンテナ以外の座標を指定しても壊れない', () => {
    const w = world(0)
    expect(() => w.setContainerSignal(-1, 0, 0, 5)).not.toThrow()
    expect(() => w.setContainerSignal(99, 99, 99, 5)).not.toThrow()
  })
})
