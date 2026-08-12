import { describe, it, expect } from 'vitest'
import { CircuitEditor } from '../src/editor.js'
import { PLACEABLE_TYPES } from '../src/placeable.js'

/**
 * #127 エディタでパワードレールを敷いたときの形状自動接続。
 *
 * レールは他の素子と違い「置いた向き」がそのまま残らない — 隣にレールがあると
 * 向きが繋がるように張り替わり、相手の形状も書き換わる
 * [確定: 26.2 BaseRailBlock.updateDir → RailState.place]。
 * その張り替えは 1 操作として履歴に積むので、undo 1 回で全部戻る。
 */

const shapeAt = (editor: CircuitEditor, x: number, z: number): string | null => {
  const b = editor.getBlock(x, z)
  return b?.type === 'powered_rail' ? b.shape : null
}

describe('CircuitEditor: パワードレールの形状', () => {
  it('パレットに並ぶ置けるブロックに含まれる', () => {
    expect(PLACEABLE_TYPES).toContain('powered_rail')
  })

  it('孤立して置くと「置いた向き」の形状になる', () => {
    const editor = new CircuitEditor(0)
    editor.placeBlock(5, 5, 'powered_rail', { facing: 'north' })
    expect(shapeAt(editor, 5, 5)).toBe('north_south')

    editor.placeBlock(8, 5, 'powered_rail', { facing: 'east' })
    expect(shapeAt(editor, 8, 5)).toBe('east_west')
  })

  it('隣に置くと向きが繋がる (置いた向きより接続が優先される)', () => {
    const editor = new CircuitEditor(0)
    editor.placeBlock(5, 5, 'powered_rail', { facing: 'east' })
    // north 向きで置いても、西隣のレールに引かれて east_west になる
    editor.placeBlock(6, 5, 'powered_rail', { facing: 'north' })
    expect(shapeAt(editor, 6, 5)).toBe('east_west')
    expect(shapeAt(editor, 5, 5)).toBe('east_west')
  })

  it('先に置いた側の形状も張り替わる', () => {
    const editor = new CircuitEditor(0)
    // 南北向きで 1 本置いてから、東隣に置く
    editor.placeBlock(5, 5, 'powered_rail', { facing: 'north' })
    expect(shapeAt(editor, 5, 5)).toBe('north_south')
    editor.placeBlock(6, 5, 'powered_rail', { facing: 'east' })
    // 2 本が繋がるので先に置いた方も east_west になる
    expect(shapeAt(editor, 5, 5)).toBe('east_west')
    expect(shapeAt(editor, 6, 5)).toBe('east_west')
  })

  it('張り替えを含めて undo 1 回で戻る', () => {
    const editor = new CircuitEditor(0)
    editor.placeBlock(5, 5, 'powered_rail', { facing: 'north' })
    editor.placeBlock(6, 5, 'powered_rail', { facing: 'east' })
    expect(shapeAt(editor, 5, 5)).toBe('east_west')

    editor.undo()
    expect(shapeAt(editor, 6, 5)).toBe(null)          // 置いたレールが消え
    expect(shapeAt(editor, 5, 5)).toBe('north_south') // 相手の形状も戻る
  })

  it('壊しても隣の形状は戻らない (vanilla と同じ)', () => {
    const editor = new CircuitEditor(0)
    editor.placeBlock(5, 5, 'powered_rail', { facing: 'north' })
    editor.placeBlock(6, 5, 'powered_rail', { facing: 'east' })
    editor.removeBlock(6, 5)
    // 26.2 の BaseRailBlock は設置時にしか形状を決めない
    expect(shapeAt(editor, 5, 5)).toBe('east_west')
  })
})
