import { describe, it, expect } from 'vitest'
import { SimWorld } from '../src/world.js'
import {
  fillSignal, slotsFromCount, takeOne, putOne, emptySlots, effectiveContainerSignal,
} from '../src/blocks/container.js'
import { stackSizeOf } from '../src/blocks/itemStacks.js'
import type { HopperState, ItemStack, ContainerSlots } from '../src/types.js'

/**
 * コンテナのスロットモデル (#194)。
 *
 * **数値はすべて実機 (MC 1.21.1) で測ったもの。** ホッパー (5 スロット) の中身を
 * 変えてコンパレーターの OutputSignal を読んだ:
 *
 * | 中身                          | 実機 |
 * |-------------------------------|------|
 * | snowball 14 (16 スタック)     | 3    |
 * | player_head 14 (64 スタック)  | 1    |
 * | 混載 player_head 11 + snowball 3 | 2 |
 * | iron_axe 1 (スタック不可)     | 3    |
 * | snowball 1 (16)               | 1    |
 * | gold_ingot 1 (64)             | 1    |
 * | iron_axe ×5 スロット          | 15   |
 *
 * **同じ 14 個でも 1 / 2 / 3 に割れる**のがこの issue の核心で、個数 1 本の
 * モデル (スタック上限 64 固定) では 1 しか出せなかった。
 */

const item = (id: string, count: number): ItemStack => {
  const { stack } = stackSizeOf(id)
  return { id, stack, count }
}
const hopperWith = (...items: (ItemStack | null)[]): ContainerSlots => {
  const s = emptySlots('hopper').slice()
  items.forEach((it, i) => { s[i] = it })
  return s
}

describe('コンパレーター強度: 実機実測との一致 (#194)', () => {
  it.each([
    ['snowball 14 (16 スタック)',        hopperWith(item('snowball', 14)),      3],
    ['player_head 14 (64 スタック)',     hopperWith(item('player_head', 14)),   1],
    ['混載 player_head 11 + snowball 3', hopperWith(item('player_head', 11), item('snowball', 3)), 2],
    ['iron_axe 1 (スタック不可)',        hopperWith(item('iron_axe', 1)),       3],
    ['snowball 1 (16)',                  hopperWith(item('snowball', 1)),       1],
    ['gold_ingot 1 (64)',                hopperWith(item('gold_ingot', 1)),     1],
    ['iron_axe ×5 スロット', hopperWith(...Array.from({ length: 5 }, () => item('iron_axe', 1))), 15],
    ['空',                               hopperWith(),                          0],
  ] as [string, ContainerSlots, number][])('%s → %i', (_label, slots, expected) => {
    expect(fillSignal(slots, 5)).toBe(expected)
  })

  it('**同じ 14 個でも強度が 1 / 2 / 3 に割れる** (個数だけでは決まらない)', () => {
    const total = (s: ContainerSlots) => s.reduce((a, x) => a + (x?.count ?? 0), 0)
    const cases = [
      hopperWith(item('player_head', 14)),
      hopperWith(item('player_head', 11), item('snowball', 3)),
      hopperWith(item('snowball', 14)),
    ]
    for (const c of cases) expect(total(c)).toBe(14)
    expect(cases.map(c => fillSignal(c, 5))).toEqual([1, 2, 3])
  })
})

describe('スタック上限の判定 (#194)', () => {
  it.each([
    ['iron_axe', 1], ['diamond_pickaxe', 1], ['water_bucket', 1], ['oak_boat', 1],
    ['snowball', 16], ['ender_pearl', 16], ['bucket', 16], ['oak_sign', 16],
    ['cobblestone', 64], ['player_head', 64], ['redstone', 64],
  ] as [string, number][])('%s → 上限 %i', (id, stack) => {
    expect(stackSizeOf(id).stack).toBe(stack)
  })

  it('minecraft: 接頭辞つきでも同じ', () => {
    expect(stackSizeOf('minecraft:snowball').stack).toBe(16)
  })

  it('表に無いアイテムは 64 だが known=false になる (呼び出し側が警告を出す)', () => {
    expect(stackSizeOf('some_unknown_item')).toEqual({ stack: 64, known: false })
    expect(stackSizeOf('cobblestone').known).toBe(true)
  })
})

describe('スロット操作 (#194)', () => {
  it('takeOne は**先頭の非空スロット**から 1 個取る (実機の転送順)', () => {
    const slots = hopperWith(item('player_head', 3), item('snowball', 2))
    const r = takeOne(slots)!
    expect(r.item.id).toBe('player_head')
    expect(r.slots[0]).toMatchObject({ count: 2 })
    expect(r.slots[1]).toMatchObject({ id: 'snowball', count: 2 })
  })

  it('スロットが尽きたら次のスロットへ移る', () => {
    let slots = hopperWith(item('player_head', 1), item('snowball', 2))
    slots = takeOne(slots)!.slots
    expect(slots[0]).toBeNull()
    expect(takeOne(slots)!.item.id).toBe('snowball')
  })

  it('putOne は**同じ ID の空きスタックへマージ**する', () => {
    const slots = hopperWith(item('snowball', 5))
    const next = putOne(slots, item('snowball', 1))!
    expect(next[0]).toMatchObject({ id: 'snowball', count: 6 })
    expect(next[1]).toBeNull()
  })

  it('**ID が違えば同じ上限でも別スロット**を使う (統合しない)', () => {
    // #194 の判断 1: ID を捨てると統合されてしまい、スロットの埋まり方が実機とずれる
    const slots = hopperWith(item('cobblestone', 5))
    const next = putOne(slots, item('dirt', 1))!
    expect(next[0]).toMatchObject({ id: 'cobblestone', count: 5 })
    expect(next[1]).toMatchObject({ id: 'dirt', count: 1 })
  })

  it('スタック上限に達したスタックにはマージせず別スロットへ', () => {
    const slots = hopperWith(item('snowball', 16))
    const next = putOne(slots, item('snowball', 1))!
    expect(next[0]).toMatchObject({ count: 16 })
    expect(next[1]).toMatchObject({ id: 'snowball', count: 1 })
  })

  it('全スロットが埋まっていれば入らない', () => {
    const full = hopperWith(...Array.from({ length: 5 }, () => item('iron_axe', 1)))
    expect(putOne(full, item('snowball', 1))).toBeNull()
    // 同じ ID なら空きスタックにマージできる
    const heads = hopperWith(...Array.from({ length: 5 }, () => item('player_head', 1)))
    expect(putOne(heads, item('player_head', 1))![0]).toMatchObject({ count: 2 })
  })
})

describe('転送: 混載ホッパーはスロット順に流れる (#194)', () => {
  it('slot0 が尽きてから slot1 が動く', () => {
    const w = new SimWorld()
    // 上段 (混載) → 下段。下段の facing 先は塞がず、下段は溜める側にする
    w.setBlockAt([0, 1, 0], {
      type: 'hopper', facing: 'down', enabled: true,
      slots: hopperWith(item('player_head', 2), item('snowball', 2)),
    } as HopperState)
    w.setBlockAt([0, 0, 0], {
      type: 'hopper', facing: 'north', enabled: true, slots: emptySlots('hopper'),
    } as HopperState)
    w.initialize()

    const lower = () => (w.getBlock(0, 0, 0) as HopperState).slots
      .filter(Boolean).map(s => `${s!.id}x${s!.count}`)

    for (let i = 0; i < 40; i++) w.tick()
    // 先に player_head が届き、あとから snowball が届く
    expect(lower()).toEqual(['player_headx2', 'snowballx2'])
    expect((w.getBlock(0, 1, 0) as HopperState).slots.every(s => s === null)).toBe(true)
  })

  it('コンパレーターは転送で変わる充填率に追従する', () => {
    const w = new SimWorld()
    w.setBlockAt([0, 0, 0], {
      type: 'hopper', facing: 'north', enabled: true,
      slots: hopperWith(item('snowball', 3)),
    } as HopperState)
    w.initialize()
    const h = w.getBlock(0, 0, 0) as HopperState
    // snowball 3 個 = (3/16)/5 → floor(0.525)+1 = 1
    expect(effectiveContainerSignal(h)).toBe(1)
  })
})

describe('旧 count からの読み替え (#194)', () => {
  it('slotsFromCount は 64 スタックを slot0 から詰める (既存 fixture と同じ意味)', () => {
    const s = slotsFromCount('hopper', 100)
    expect(s[0]).toMatchObject({ count: 64, stack: 64 })
    expect(s[1]).toMatchObject({ count: 36 })
    expect(s[2]).toBeNull()
    // 旧モデルの f = count/(5*64) と一致する
    expect(fillSignal(s, 5)).toBe(Math.floor((100 / 320) * 14) + 1)
  })

  it('容量を超える分は切り捨てる', () => {
    const s = slotsFromCount('hopper', 1000)
    expect(s.reduce((a, x) => a + (x?.count ?? 0), 0)).toBe(320)
  })
})
