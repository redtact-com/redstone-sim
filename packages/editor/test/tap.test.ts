import { describe, it, expect } from 'vitest'
import type { BlockState } from '@redstone/sim'
import { decideCellTap, decideTap, nextFacing } from '../src/tap'

// ============================================================
// editorTap: 左クリック動作の決定 (#99)
// 「別ツールで既存ブロックのマスをタップしたら置き換える」の中核ロジック
// ============================================================

const wire = { type: 'wire', connections: {}, power: 0 } as unknown as BlockState
const repeater = { type: 'repeater', facing: 'north', delay: 1, powered: false, locked: false } as unknown as BlockState
const lamp = { type: 'lamp', lit: false } as unknown as BlockState

describe('decideCellTap', () => {
  it('空セルは常に place', () => {
    expect(decideCellTap(null, 'wire')).toBe('place')
    expect(decideCellTap(null, 'repeater')).toBe('place')
  })

  it('別種ツール × 既存ブロック → place (置き換え)', () => {
    // ダストを持って既存リピーターのマスをタップ → 置き換え (本 issue の主眼)
    expect(decideCellTap(repeater, 'wire')).toBe('place')
    expect(decideCellTap(lamp, 'wire')).toBe('place')
    expect(decideCellTap(repeater, 'lamp')).toBe('place')
  })

  it('同種ツール × 既存ブロック → select (編集)', () => {
    expect(decideCellTap(repeater, 'repeater')).toBe('select')
    expect(decideCellTap(lamp, 'lamp')).toBe('select')
  })

  it('wire ツール × 既存 wire → wire-toggle (dot/cross)', () => {
    expect(decideCellTap(wire, 'wire')).toBe('wire-toggle')
  })

  it('別種ツール × 既存 wire → place (wire の上に別ブロックを置換)', () => {
    expect(decideCellTap(wire, 'repeater')).toBe('place')
  })

  it('air は既存扱いせず place', () => {
    const air = { type: 'air' } as unknown as BlockState
    expect(decideCellTap(air, 'wire')).toBe('place')
  })
})

// ============================================================
// #117 方針のパラメータ化 (本体 = select / 下流 = rotate)
// ============================================================
describe('#117 decideTap — 同種タップの方針', () => {
  const lever = (facing = 'up'): BlockState => ({ type: 'lever', facing, powered: false } as BlockState)
  const repeater = (facing = 'north'): BlockState =>
    ({ type: 'repeater', facing, delay: 1, powered: false, locked: false } as BlockState)

  it('既定は select (本体アプリの操作系)', () => {
    expect(decideTap(repeater(), 'repeater')).toEqual({ kind: 'select' })
  })

  it('rotate 方針では次の向きへ回す', () => {
    expect(decideTap(repeater('north'), 'repeater', { sameType: 'rotate' }))
      .toEqual({ kind: 'rotate', facing: 'east' })
    expect(decideTap(repeater('west'), 'repeater', { sameType: 'rotate' }))
      .toEqual({ kind: 'rotate', facing: 'north' })   // 一周して戻る
  })

  it('rotate 方針でも取付面つき素子は 6 方向を巡る', () => {
    expect(decideTap(lever('west'), 'lever', { sameType: 'rotate' }))
      .toEqual({ kind: 'rotate', facing: 'up' })
    expect(decideTap(lever('up'), 'lever', { sameType: 'rotate' }))
      .toEqual({ kind: 'rotate', facing: 'down' })
  })

  it('向きを持たない素子は rotate 方針でも何も起きない', () => {
    const lamp: BlockState = { type: 'lamp', lit: false } as BlockState
    expect(decideTap(lamp, 'lamp', { sameType: 'rotate' })).toEqual({ kind: 'none' })
  })

  it('ドラッグ中は同種セルを飛ばす (誤操作防止)', () => {
    expect(decideTap(repeater(), 'repeater', { phase: 'drag' })).toEqual({ kind: 'none' })
    expect(decideTap(repeater(), 'repeater', { phase: 'drag', sameType: 'rotate' })).toEqual({ kind: 'none' })
  })

  it('ドラッグ中でも空セル・別種には置ける (塗り操作)', () => {
    expect(decideTap(null, 'wire', { phase: 'drag' })).toEqual({ kind: 'place' })
    expect(decideTap(repeater(), 'wire', { phase: 'drag' })).toEqual({ kind: 'place' })
  })

  it('wire × wire は方針によらず形状トグル', () => {
    const wire: BlockState = { type: 'wire', power: 0, connections: { north: false, south: false, east: true, west: true } } as BlockState
    expect(decideTap(wire, 'wire')).toEqual({ kind: 'wire-toggle' })
    expect(decideTap(wire, 'wire', { sameType: 'rotate' })).toEqual({ kind: 'wire-toggle' })
    expect(decideTap(wire, 'wire', { phase: 'drag' })).toEqual({ kind: 'none' })
  })

  it('nextFacing は素子ごとの許容向きの中を巡る', () => {
    expect(nextFacing('repeater', 'north')).toBe('east')
    expect(nextFacing('repeater', 'west')).toBe('north')
    expect(nextFacing('lever', 'west')).toBe('up')
    expect(nextFacing('lamp', undefined)).toBeUndefined()
  })
})
