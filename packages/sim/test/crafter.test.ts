import { describe, it, expect } from 'vitest'
import { SimWorld } from '../src/world'
import type { BlockState, Pos3D } from '../src/types'

/**
 * #163 クラフター。**受電部分のみ実装しレシピは非対応**。
 *
 * 要点は 2 つ:
 *   1. **疑似接続を持たない** (ディスペンサーとの対比)
 *   2. コンパレーターは「埋まっているスロット数」0-9 を読む (充填率ではない)
 * [確定: 26.2 CrafterBlock.java:73-88 / CrafterBlockEntity.getRedstoneSignal
 *  / 実機 fixture crafter-trigger]
 */

const solid = (): BlockState => ({ type: 'solid', powered: false })
const crafter = (occupiedSlots = 0): BlockState =>
  ({ type: 'crafter', facing: 'north', triggered: false, occupiedSlots })

const triggeredAt = (w: SimWorld, pos: Pos3D): boolean => {
  const b = w.getBlockAt(pos)
  return (b?.type === 'crafter' || b?.type === 'dispenser') && b.triggered
}

describe('クラフターの受電 (#163)', () => {
  /** レバー(0) → クラフター(1) */
  function world(): SimWorld {
    const w = new SimWorld()
    w.setBlockAt([0, -1, 0], solid())
    w.setBlockAt([1, -1, 0], solid())
    w.setBlockAt([0, 0, 0], { type: 'lever', facing: 'up', powered: false } as BlockState)
    w.setBlockAt([1, 0, 0], crafter(3))
    w.initialize()
    return w
  }

  it('直接受電の立ち上がりで triggered が立つ', () => {
    const w = world()
    expect(triggeredAt(w, [1, 0, 0])).toBe(false)
    w.activateBlock(0, 0, 0)
    expect(triggeredAt(w, [1, 0, 0])).toBe(true)
  })

  it('立ち下がりで triggered が落ちる', () => {
    const w = world()
    w.activateBlock(0, 0, 0)
    w.activateBlock(0, 0, 0)
    expect(triggeredAt(w, [1, 0, 0])).toBe(false)
  })

  it('レシピ非対応なので 4gt 後も何も起きない', () => {
    const w = world()
    w.activateBlock(0, 0, 0)
    const before = w.getBlockAt([1, 0, 0])
    w.settle(32)
    const after = w.getBlockAt([1, 0, 0])
    expect(after).toEqual(before)   // triggered=true のまま。中身も減らない
  })

  /** 疑似接続の配置: 対象の 1 段上の**隣**にレッドストーンブロックを置く */
  function qcWorld(kind: 'crafter' | 'dispenser'): SimWorld {
    const w = new SimWorld()
    w.setBlockAt([1, -1, 0], solid())
    w.setBlockAt([1, 0, 0], kind === 'crafter'
      ? crafter(3)
      : { type: 'dispenser', facing: 'east', count: 3, triggered: false } as BlockState)
    w.setBlockAt([2, 1, 0], { type: 'redstone_block' } as BlockState)  // 1 段上の隣
    w.initialize()
    return w
  }

  it('クラフターは疑似接続では起動しない', () => {
    const w = qcWorld('crafter')
    // 更新を送っても起動しない (自分の位置しか見ないため)
    w.setBlockCommand([1, 0, 1], solid())
    w.settle(32)
    expect(triggeredAt(w, [1, 0, 0])).toBe(false)
  })

  it('対照: ディスペンサーは同じ配置で起動する', () => {
    const w = qcWorld('dispenser')
    w.setBlockCommand([1, 0, 1], solid())
    w.settle(32)
    expect(triggeredAt(w, [1, 0, 0])).toBe(true)
  })
})

describe('クラフターのコンパレーター読み (#163)', () => {
  it('埋まっているスロット数を読む (充填率ではない)', () => {
    const w = new SimWorld()
    for (let x = 0; x <= 2; x++) w.setBlockAt([x, -1, 0], solid())
    w.setBlockAt([1, 0, 0], crafter(4))
    // sim の facing は出力方向。西のクラフターを読んで東へ出す
    w.setBlockAt([2, 0, 0], {
      type: 'comparator', facing: 'east', mode: 'compare', powered: false, outputPower: 0,
    } as BlockState)
    w.initialize()
    w.settle(8)          // コンパレーターは 2gt の tile tick で確定する
    const c = w.getBlockAt([2, 0, 0])
    expect(c?.type === 'comparator' && c.outputPower, '占有 4 スロット → 4').toBe(4)
  })

  it('空なら 0', () => {
    const w = new SimWorld()
    for (let x = 0; x <= 2; x++) w.setBlockAt([x, -1, 0], solid())
    w.setBlockAt([1, 0, 0], crafter(0))
    w.setBlockAt([2, 0, 0], {
      type: 'comparator', facing: 'east', mode: 'compare', powered: false, outputPower: 0,
    } as BlockState)
    w.initialize()
    w.settle(8)
    const c = w.getBlockAt([2, 0, 0])
    expect(c?.type === 'comparator' && c.outputPower).toBe(0)
  })
})
