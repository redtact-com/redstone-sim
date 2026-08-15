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

/**
 * #129 形状決定の優先度。期待値は実機 (fixture powered-rail-priority) が正。
 *   - 南北と東西の両方に接続があれば「置いた向き」(defaultShape) が勝つ
 *   - 坂の判定は north→south / east→west の順に上書きするので **後勝ち**
 *     (南北の取り合いは ascending_south、東西の取り合いは ascending_west)
 * [確定: 26.2 RailState.place]
 */
describe('CircuitEditor: 形状決定の優先度 (#129)', () => {
  const place = (e: CircuitEditor, x: number, y: number, z: number, facing: 'north' | 'east') => {
    const prev = e.activeLayer
    e.setActiveLayer(y)
    e.placeBlock(x, z, 'powered_rail', { facing })
    e.setActiveLayer(prev)
  }
  const shapeAt3 = (e: CircuitEditor, x: number, y: number, z: number): string | null => {
    const b = e.getBlock3(x, y, z)
    return b?.type === 'powered_rail' ? b.shape : null
  }

  it('南北と東西の両方に接続があれば「置いた向き」が勝つ', () => {
    const e = new CircuitEditor(1)
    place(e, 2, 1, 3, 'east'); place(e, 4, 1, 3, 'east')
    place(e, 3, 1, 2, 'north'); place(e, 3, 1, 4, 'north')
    place(e, 3, 1, 3, 'north')          // 中心を最後に、南北向きで置く
    expect(shapeAt3(e, 3, 1, 3)).toBe('north_south')
  })

  it('南北の坂が取り合うと ascending_south (後勝ち)', () => {
    const e = new CircuitEditor(2)
    place(e, 8, 2, 2, 'north'); place(e, 8, 2, 4, 'north')
    place(e, 8, 1, 3, 'north')          // 北隣の 1 段上・南隣の 1 段上 の両方にレール
    expect(shapeAt3(e, 8, 1, 3)).toBe('ascending_south')
  })

  it('東西の坂が取り合うと ascending_west (後勝ち)', () => {
    const e = new CircuitEditor(2)
    place(e, 12, 2, 3, 'east'); place(e, 14, 2, 3, 'east')
    place(e, 13, 1, 3, 'east')
    expect(shapeAt3(e, 13, 1, 3)).toBe('ascending_west')
  })
})
