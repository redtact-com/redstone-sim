import { describe, it, expect } from 'vitest'
import { SimWorld } from '../src/world.js'
import { mcToSim } from '../src/mcstate.js'
import type { BlockState, Pos3D } from '../src/types.js'

/**
 * 泡柱 = **縦の無遅延バス** (#234)。
 *
 * [確定: 26.2 BubbleColumnBlock]
 * - `updateColumn` は起点から**上へ while ループで同期的に setBlock(flag 2)**。
 *   140 段でも 1 tick で全段が変わる (これが「無遅延」の正体)
 * - flag 2 は近隣更新を出さないが**形状更新は配る**ので、隣のオブザーバーは検知する
 * - 乱されたときは `updateShape` が `scheduleTick(pos, this, 5)` を積む
 *
 * 実機で採った挙動 (rcon で直接測定):
 * - ソウルサンドの上に水を置くと柱ができる (ソウルサンドの 20gt 予約経由)
 * - 柱を途中で断ち切ると、**切った位置より上が同じ tick でまとめて水に戻る**
 */
const col = (h: number): { w: SimWorld; top: Pos3D } => {
  const w = new SimWorld()
  w.setBlockAt([1, 0, 1], mcToSim('soul_sand')!)
  for (let y = 1; y <= h; y++) w.setBlockAt([1, y, 1], mcToSim('bubble_column[drag=false]')!)
  w.initialize()
  w.flush(64)
  return { w, top: [1, h, 1] }
}

const typeAt = (w: SimWorld, y: number): string | undefined => w.getBlock(1, y, 1)?.type

describe('泡柱', () => {
  it('取り込める (drag を保持する)', () => {
    expect(mcToSim('bubble_column[drag=false]')).toEqual({ type: 'bubble_column', drag: false })
    expect(mcToSim('bubble_column[drag=true]')).toEqual({ type: 'bubble_column', drag: true })
  })

  it('ソウルサンドの上なら柱のまま安定する', () => {
    const { w } = col(6)
    for (let i = 0; i < 20; i++) w.tick()
    for (let y = 1; y <= 6; y++) expect(typeAt(w, y), `y=${y}`).toBe('bubble_column')
  })

  it('**断ち切ると、切った位置より上が同じ tick でまとめて水に戻る**', () => {
    const { w } = col(8)
    // 途中を塞ぐ (/setblock 相当 = 近隣更新あり)
    w.setBlockCommand([1, 4, 1], { type: 'solid', powered: false } as BlockState)
    // updateShape の 5gt 予約が明けるまでは変わらない
    let collapsedAt = -1
    for (let t = 1; t <= 12; t++) {
      w.tick()
      if (typeAt(w, 5) === 'water' && collapsedAt < 0) collapsedAt = t
    }
    expect(collapsedAt, '崩れない').toBeGreaterThan(0)
    // 上の段が**同じ tick で全部**水になっている (1 段ずつ遅れない)
    for (let y = 5; y <= 8; y++) expect(typeAt(w, y), `y=${y} が残っている`).toBe('water')
    // 切った位置より下は柱のまま
    for (let y = 1; y <= 3; y++) expect(typeAt(w, y), `y=${y} まで崩れた`).toBe('bubble_column')
  })

  it('高い柱でも 1 tick で全段が変わる (140 段)', () => {
    const { w } = col(140)
    w.setBlockCommand([1, 70, 1], { type: 'solid', powered: false } as BlockState)
    let changedTick = -1
    for (let t = 1; t <= 12; t++) {
      w.tick()
      if (typeAt(w, 71) === 'water' && changedTick < 0) changedTick = t
    }
    expect(changedTick, '崩れない').toBeGreaterThan(0)
    // **最上段まで同じ tick で届いている**
    expect(typeAt(w, 140), '最上段が遅れている').toBe('water')
  })

  it('隣のオブザーバーが柱の変化を検知する', () => {
    const { w } = col(8)
    w.setBlockAt([2, 6, 1], { type: 'observer', facing: 'west', powered: false } as BlockState)
    w.flush(64)
    expect(w.getBlock(2, 6, 1)).toMatchObject({ powered: false })

    w.setBlockCommand([1, 4, 1], { type: 'solid', powered: false } as BlockState)
    let fired = false
    for (let t = 1; t <= 16; t++) {
      w.tick()
      if ((w.getBlock(2, 6, 1) as { powered?: boolean })?.powered) fired = true
    }
    expect(fired, '柱が変わったのにオブザーバーが発火しない').toBe(true)
  })
})
