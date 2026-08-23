import { describe, it, expect } from 'vitest'
import { CircuitEditor } from './editor.js'
import { mcToSim } from '@redstone/sim'

/**
 * 属性バーの操作で**取り込み由来の素性が消えない**こと (#343)。
 *
 * `placeBlock` は `buildBlockState` で状態を作り直すため、パレットが知らない値
 * (元のブロック名・コンテナの導通) が落ちる。実測でトラップチェストの signal を
 * 触ると `{fullCube:true}` になり、**非導体が導体に変わっていた**。
 */
describe('属性更新で取り込み由来の素性を保つ (#343)', () => {
  it('トラップチェストの signal を変えても名前と非導体が残る', () => {
    const ed = new CircuitEditor(0)
    ed.resetToBlocks(new Map([['3,0,3', mcToSim('trapped_chest')!]]))
    ed.updateBlock(3, 3, 'container', { signal: 5 })
    expect(ed.getBlock3(3, 0, 3)).toMatchObject({
      type: 'container', name: 'trapped_chest', fullCube: false, signal: 5,
    })
  })

  it('シュルカーボックスは導体のまま残る', () => {
    const ed = new CircuitEditor(0)
    ed.resetToBlocks(new Map([['0,0,0', mcToSim('lime_shulker_box')!]]))
    ed.updateBlock(0, 0, 'container', { signal: 9 })
    expect(ed.getBlock3(0, 0, 0)).toMatchObject({
      name: 'lime_shulker_box', fullCube: true, signal: 9,
    })
  })

  it('パレットから置いた樽は従来どおり (名前を持たない)', () => {
    const ed = new CircuitEditor(0)
    ed.placeBlock(1, 1, 'container', { signal: 1 })
    ed.updateBlock(1, 1, 'container', { signal: 7 })
    const b = ed.getBlock3(1, 0, 1) as { name?: string; fullCube?: boolean; signal?: number }
    expect(b.name).toBeUndefined()
    expect(b.fullCube).toBe(true)
    expect(b.signal).toBe(7)
  })

  it('**別の型を置いたときは引き継がない**', () => {
    const ed = new CircuitEditor(0)
    ed.resetToBlocks(new Map([['2,0,2', mcToSim('trapped_chest')!]]))
    ed.updateBlock(2, 2, 'repeater', { delay: 2 })
    const b = ed.getBlock3(2, 0, 2) as { type: string; name?: string }
    expect(b.type).toBe('repeater')
    expect(b.name).toBeUndefined()
  })
})
