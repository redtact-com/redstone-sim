import { describe, it, expect } from 'vitest'
import { SimWorld } from '../src/world'
import { slotsFromCount } from '../src/blocks/container.js'
import type { BlockState, Pos3D } from '../src/types'

/**
 * #161 ディスペンサー。26.2 で DropperBlock extends DispenserBlock なので
 * **レッドストーン側は完全に共通**で、差は dispenseFrom だけ:
 * **ドロッパーだけが前方コンテナへ挿入する**。
 * [確定: 26.2 DispenserBlock.java:128-144 / DropperBlock.java:23,48
 *  / 実機 fixture dispenser-no-insert]
 */

const solid = (): BlockState => ({ type: 'solid', powered: false })
const barrel = (count = 0): BlockState =>
  ({ type: 'container', signal: 0, slots: slotsFromCount('container', count) } as BlockState)

/** レバー(0) → ドロッパー/ディスペンサー(1) → バレル(2) を東向きに並べる */
function world(kind: 'dropper' | 'dispenser', count = 3): SimWorld {
  const w = new SimWorld()
  for (let x = 0; x <= 2; x++) w.setBlockAt([x, -1, 0], solid())
  w.setBlockAt([0, 0, 0], { type: 'lever', facing: 'up', powered: false } as BlockState)
  w.setBlockAt([1, 0, 0], { type: kind, facing: 'east', slots: slotsFromCount(kind, count), triggered: false } as BlockState)
  w.setBlockAt([2, 0, 0], barrel(0))
  w.initialize()
  return w
}
const countAt = (w: SimWorld, pos: Pos3D): number => {
  const b = w.getBlockAt(pos)
  const slots = (b as { slots?: readonly ({ count: number } | null)[] })?.slots
  return slots ? slots.reduce((a, x) => a + (x?.count ?? 0), 0) : -1
}

describe('ディスペンサー (#161)', () => {
  it('レッドストーン側の挙動はドロッパーと同じ (立ち上がりで triggered)', () => {
    for (const kind of ['dropper', 'dispenser'] as const) {
      const w = world(kind)
      w.activateBlock(0, 0, 0)
      const b = w.getBlockAt([1, 0, 0])
      expect(b?.type === kind && b.triggered, kind).toBe(true)
    }
  })

  it('ドロッパーは前方コンテナへ 1 個入れる', () => {
    const w = world('dropper')
    w.activateBlock(0, 0, 0)
    w.settle(32)
    expect(countAt(w, [1, 0, 0]), 'ドロッパーの中身が減る').toBe(2)
    expect(countAt(w, [2, 0, 0]), 'バレルに入る').toBe(1)
  })

  it('ディスペンサーは前方コンテナへ入れない (射出扱いで 1 個消える)', () => {
    const w = world('dispenser')
    w.activateBlock(0, 0, 0)
    w.settle(32)
    expect(countAt(w, [1, 0, 0]), '中身は減る').toBe(2)
    expect(countAt(w, [2, 0, 0]), 'バレルには入らない').toBe(0)
  })

  it('空なら何も起きない', () => {
    const w = world('dispenser', 0)
    w.activateBlock(0, 0, 0)
    w.settle(32)
    expect(countAt(w, [1, 0, 0])).toBe(0)
    expect(countAt(w, [2, 0, 0])).toBe(0)
  })

  it('疑似接続 (直上からの受電) でも起動する', () => {
    const w = new SimWorld()
    for (let x = 0; x <= 2; x++) w.setBlockAt([x, -1, 0], solid())
    w.setBlockAt([1, 0, 0], { type: 'dispenser', facing: 'east', slots: slotsFromCount('dispenser', 3), triggered: false } as BlockState)
    w.setBlockAt([2, 0, 0], barrel(0))
    w.setBlockAt([1, 1, 0], solid())          // 直上の導体
    w.setBlockAt([0, 1, 0], { type: 'lever', facing: 'up', powered: false } as BlockState)
    w.setBlockAt([0, 0, 0], solid())
    w.initialize()

    w.activateBlock(0, 1, 0)                  // 直上のブロックを強充電する
    w.settle(32)
    expect(countAt(w, [1, 0, 0]), 'QC で起動して 1 個減る').toBe(2)
  })
})
