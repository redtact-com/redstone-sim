// ============================================================
// capture.ts の「一部のブロックだけ置く」(keep) の回帰。実機は呼ばない。
//
// region はキャプチャの**観測範囲であると同時に掃除範囲**なので、
// keep で縮めたときにここがズレると
//   - 観測できない座標が出る (実機側だけ 'air' に見えて偽の食い違いになる)
//   - 掃除が足りず前回のブロックが残る (実機側だけ動く)
// のどちらかが起きる。最小化ループが真っ先に踏む場所なので固定しておく。
// ============================================================

import { describe, it, expect } from 'vitest'
import { selectPlacedBlocks } from './capture.js'

/** 3x2x3 の塊 + 離れたところに 1 個 */
const BLOCKS: { pos: [number, number, number]; name: string }[] = [
  { pos: [0, 0, 0], name: 'stone' },
  { pos: [1, 0, 0], name: 'stone' },
  { pos: [2, 0, 0], name: 'stone' },
  { pos: [0, 1, 0], name: 'lever' },
  { pos: [1, 1, 0], name: 'redstone_wire' },
  { pos: [2, 1, 0], name: 'redstone_lamp' },
  { pos: [9, 0, 5], name: 'stone' },
]

describe('selectPlacedBlocks — keep 無し (従来どおり)', () => {
  it('全ブロックを置き、region は回路全体 + pad。**下端 y は 0 のまま**', () => {
    const r = selectPlacedBlocks(BLOCKS, 1)
    expect(r.blocks).toHaveLength(BLOCKS.length)
    // 原点寄せ済みの回路は min=(0,0,0) なので from = [-pad, 0, -pad] という従来の式と一致する
    expect(r.region).toEqual({ from: [-1, 0, -1], to: [10, 2, 6] })
    expect(r.missing).toEqual([])
  })

  it('pad を変えると x/z は両側に、y は上だけ広がる', () => {
    expect(selectPlacedBlocks(BLOCKS, 3).region).toEqual({ from: [-3, 0, -3], to: [12, 4, 8] })
  })
})

describe('selectPlacedBlocks — keep 指定', () => {
  it('keep の座標だけを置く', () => {
    const r = selectPlacedBlocks(BLOCKS, 1, ['1,1,0', '1,0,0'])
    expect(r.blocks.map(b => b.pos.join(','))).toEqual(['1,0,0', '1,1,0'])
  })

  it('region が keep の bbox + pad に縮む (離れた 1 個を捨てれば範囲も縮む)', () => {
    const r = selectPlacedBlocks(BLOCKS, 1, ['1,1,0', '1,0,0'])
    expect(r.region).toEqual({ from: [0, 0, -1], to: [2, 2, 1] })
    // keep 無しのときより明確に小さい (縮んでいることの確認)
    const full = selectPlacedBlocks(BLOCKS, 1)
    expect(r.region.to[0]).toBeLessThan(full.region.to[0])
    expect(r.region.to[2]).toBeLessThan(full.region.to[2])
  })

  it('下端 y は 0 より下げない (void superflat に掃除範囲を伸ばさない)', () => {
    const r = selectPlacedBlocks(BLOCKS, 2, ['1,0,0'])
    expect(r.region.from[1]).toBe(0)
  })

  it('1 個だけ残しても pad ぶんの立方体になる', () => {
    const r = selectPlacedBlocks(BLOCKS, 1, ['9,0,5'])
    expect(r.region).toEqual({ from: [8, 0, 4], to: [10, 1, 6] })
  })

  it('ブロックの無い座標を keep に書くと region だけ広がり missing に載る', () => {
    // 入力の当たり先 (setblock で空中に置く等) を region に含めるための挙動
    const r = selectPlacedBlocks(BLOCKS, 1, ['1,1,0', '5,3,0'])
    expect(r.blocks.map(b => b.pos.join(','))).toEqual(['1,1,0'])
    expect(r.missing).toEqual(['5,3,0'])
    expect(r.region).toEqual({ from: [0, 0, -1], to: [6, 4, 1] })
  })

  it('壊れた座標キーは黙って捨てず投げる', () => {
    expect(() => selectPlacedBlocks(BLOCKS, 1, ['1,1'])).toThrow(/keep の座標キーが不正/)
    expect(() => selectPlacedBlocks(BLOCKS, 1, ['1,1,x'])).toThrow(/keep の座標キーが不正/)
    expect(() => selectPlacedBlocks(BLOCKS, 1, ['1,1,0.5'])).toThrow(/keep の座標キーが不正/)
  })

  it('keep が空なら投げる (region が作れない)', () => {
    expect(() => selectPlacedBlocks(BLOCKS, 1, [])).toThrow(/1 つも無い/)
  })

  it('負の座標でも bbox を素直に取る', () => {
    const blocks = [{ pos: [-4, 2, -7] as [number, number, number], name: 'stone' }]
    expect(selectPlacedBlocks(blocks, 1, ['-4,2,-7']).region)
      .toEqual({ from: [-5, 1, -8], to: [-3, 3, -6] })
  })
})
