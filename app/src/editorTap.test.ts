import { describe, it, expect } from 'vitest'
import type { BlockState } from '@redstone/sim'
import { decideCellTap } from './editorTap'

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
