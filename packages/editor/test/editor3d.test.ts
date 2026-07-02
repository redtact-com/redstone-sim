import { describe, it, expect } from 'vitest'
import { CircuitEditor } from '../src/editor.js'

describe('CircuitEditor: レイヤー切替 (3D 編集)', () => {
  it('setActiveLayer で配置・取得対象のレイヤーが切り替わる', () => {
    const editor = new CircuitEditor(0)
    editor.placeBlock(0, 0, 'lamp')

    editor.setActiveLayer(1)
    expect(editor.getBlock(0, 0)).toBeNull()          // Y=1 には何もない
    editor.placeBlock(0, 0, 'wire')
    expect(editor.getBlock(0, 0)?.type).toBe('wire')  // Y=1

    editor.setActiveLayer(0)
    expect(editor.getBlock(0, 0)?.type).toBe('lamp')  // Y=0 はそのまま

    expect(editor.getBlock3(0, 0, 0)?.type).toBe('lamp')
    expect(editor.getBlock3(0, 1, 0)?.type).toBe('wire')
  })

  it('getAllBlocks は 3D キー "x,y,z" を返す', () => {
    const editor = new CircuitEditor(0)
    editor.placeBlock(1, 2, 'lamp')
    editor.setActiveLayer(3)
    editor.placeBlock(4, 5, 'solid')

    const blocks = editor.getAllBlocks()
    expect(blocks.get('1,0,2')?.type).toBe('lamp')
    expect(blocks.get('4,3,5')?.type).toBe('solid')
  })

  it('buildSimWorld は各ブロックを実レイヤーに配置する', () => {
    const editor = new CircuitEditor(0)
    editor.placeBlock(0, 0, 'lamp')
    editor.setActiveLayer(2)
    editor.placeBlock(1, 0, 'solid')

    const world = editor.buildSimWorld()
    expect(world.getBlock(0, 0, 0)?.type).toBe('lamp')
    expect(world.getBlock(1, 2, 0)?.type).toBe('solid')
  })

  it('toSnapshot の bounds が実レイヤー範囲を反映する', () => {
    const editor = new CircuitEditor(0)
    editor.placeBlock(0, 0, 'lamp')
    editor.setActiveLayer(4)
    editor.placeBlock(2, 3, 'solid')

    const snap = editor.getSnapshot()
    expect(snap.bounds.y).toEqual([0, 4])
  })
})

describe('CircuitEditor: 上りステップ接続形状', () => {
  it('固体を挟んで1段上のワイヤーに \'up\' 接続が立つ', () => {
    const editor = new CircuitEditor(0)
    editor.placeBlock(0, 0, 'wire')   // A (0,0,0)
    editor.placeBlock(1, 0, 'solid')  // 登る対象 (1,0,0)
    editor.setActiveLayer(1)
    editor.placeBlock(1, 0, 'wire')   // B (1,1,0)

    const a = editor.getBlock3(0, 0, 0)
    expect(a?.type).toBe('wire')
    if (a?.type !== 'wire') return
    expect(a.connections.east).toBe('up')

    // B 側は下りステップ（side = true）
    const b = editor.getBlock3(1, 1, 0)
    if (b?.type !== 'wire') return
    expect(b.connections.west).toBe(true)
  })

  it('下側ワイヤーの直上に固体を置くと \'up\' 接続が消える', () => {
    const editor = new CircuitEditor(0)
    editor.placeBlock(0, 0, 'wire')   // A (0,0,0)
    editor.placeBlock(1, 0, 'solid')
    editor.setActiveLayer(1)
    editor.placeBlock(1, 0, 'wire')   // B (1,1,0)
    editor.placeBlock(0, 0, 'solid')  // A の直上 (0,1,0) → カット

    const a = editor.getBlock3(0, 0, 0)
    if (a?.type !== 'wire') return
    expect(a.connections.east).not.toBe('up')

    // カットブロックを undo すると 'up' が復活する
    editor.undo()
    const a2 = editor.getBlock3(0, 0, 0)
    if (a2?.type !== 'wire') return
    expect(a2.connections.east).toBe('up')
  })

  it('レイヤーをまたぐ回路が buildSimWorld で通電する', () => {
    const editor = new CircuitEditor(0)
    editor.placeBlock(0, 0, 'lever')
    editor.placeBlock(1, 0, 'wire')
    editor.placeBlock(2, 0, 'solid')
    editor.setActiveLayer(1)
    editor.placeBlock(2, 0, 'wire')   // 上りステップ先 (2,1,0)
    editor.placeBlock(3, 0, 'lamp')   // (3,1,0)

    const world = editor.buildSimWorld()
    world.initialize()
    world.activateBlock(0, 0, 0)  // レバー ON

    expect(world.getBlock(1, 0, 0)).toMatchObject({ type: 'wire', power: 15 })
    expect(world.getBlock(2, 1, 0)).toMatchObject({ type: 'wire', power: 14 })
    expect(world.getBlock(3, 1, 0)).toMatchObject({ type: 'lamp', lit: true })
  })
})
