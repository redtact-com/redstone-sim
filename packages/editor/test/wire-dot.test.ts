import { describe, it, expect } from 'vitest'
import { CircuitEditor } from '../src/editor.js'
import type { WireConnections } from '@redstone/sim'

function conns(editor: CircuitEditor, x: number, z: number): WireConnections | null {
  const b = editor.getBlock(x, z)
  return b?.type === 'wire' ? b.connections : null
}
const allFalse: WireConnections = { north: false, south: false, east: false, west: false }
const allTrue: WireConnections = { north: true, south: true, east: true, west: true }

// ─────────────────────────────────────────────────────────────
// C8: editor の dot ⇄ cross トグル (#38)
// ─────────────────────────────────────────────────────────────

describe('CircuitEditor: dot ⇄ cross トグル', () => {
  it('孤立ワイヤー (cross) を dot にトグルできる', () => {
    const editor = new CircuitEditor(0)
    editor.placeBlock(5, 5, 'wire')
    expect(conns(editor, 5, 5)).toEqual(allTrue)  // 孤立 = cross

    expect(editor.toggleWireDot(5, 5)).toBe(true)
    expect(conns(editor, 5, 5)).toEqual(allFalse)  // dot
  })

  it('dot を cross に戻せる (往復トグル)', () => {
    const editor = new CircuitEditor(0)
    editor.placeBlock(5, 5, 'wire')
    editor.toggleWireDot(5, 5)  // → dot
    expect(editor.toggleWireDot(5, 5)).toBe(true)
    expect(conns(editor, 5, 5)).toEqual(allTrue)  // 孤立なので cross に戻る
  })

  it('実隣接があるワイヤーは dot にできない (no-op)。vanilla は再結線される', () => {
    const editor = new CircuitEditor(0)
    editor.placeBlock(0, 0, 'wire')
    editor.placeBlock(1, 0, 'wire')  // east 隣接 → 直線 (east+west)
    const before = conns(editor, 0, 0)

    expect(editor.toggleWireDot(0, 0)).toBe(false)  // 隣接あり → dot 化しない
    expect(conns(editor, 0, 0)).toEqual(before)     // 形状不変
  })

  it('ワイヤー以外は false を返す', () => {
    const editor = new CircuitEditor(0)
    editor.placeBlock(0, 0, 'lamp')
    expect(editor.toggleWireDot(0, 0)).toBe(false)
    expect(editor.toggleWireDot(9, 9)).toBe(false)  // 空セル
  })

  it('トグルは undo で戻せる', () => {
    const editor = new CircuitEditor(0)
    editor.placeBlock(5, 5, 'wire')
    editor.toggleWireDot(5, 5)  // → dot
    expect(conns(editor, 5, 5)).toEqual(allFalse)

    editor.undo()
    expect(conns(editor, 5, 5)).toEqual(allTrue)  // cross に戻る
  })

  it('トグルで change イベントが発火する', () => {
    const editor = new CircuitEditor(0)
    editor.placeBlock(5, 5, 'wire')
    let count = 0
    editor.on('change', () => { count++ })
    editor.toggleWireDot(5, 5)
    expect(count).toBe(1)
  })

  it('dot ワイヤーは buildSimWorld で全方向 none のまま渡る', () => {
    const editor = new CircuitEditor(0)
    editor.placeBlock(5, 5, 'wire')
    editor.toggleWireDot(5, 5)
    const world = editor.buildSimWorld()
    expect(world.getBlock(5, 0, 5)).toMatchObject({ type: 'wire', connections: allFalse })
  })
})
