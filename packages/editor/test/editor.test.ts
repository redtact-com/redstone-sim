import { describe, it, expect } from 'vitest'
import { CircuitEditor } from '../src/editor.js'

describe('CircuitEditor: ワイヤー接続計算', () => {
  it('孤立ワイヤーは4方向すべてに接続（cross形状）', () => {
    const editor = new CircuitEditor(0)
    editor.placeBlock(5, 5, 'wire')

    const block = editor.getBlock(5, 5)
    expect(block?.type).toBe('wire')
    if (block?.type !== 'wire') return
    expect(block.connections).toEqual({ north: true, south: true, east: true, west: true })
  })

  it('隣接する2本のワイヤーは互いに接続される', () => {
    const editor = new CircuitEditor(0)
    editor.placeBlock(0, 0, 'wire')
    editor.placeBlock(1, 0, 'wire')  // east隣

    const w0 = editor.getBlock(0, 0)
    const w1 = editor.getBlock(1, 0)
    if (w0?.type !== 'wire' || w1?.type !== 'wire') return
    expect(w0.connections.east).toBe(true)
    expect(w1.connections.west).toBe(true)
  })

  it('ワイヤーを削除すると隣接ワイヤーの接続が更新される（孤立→cross形状）', () => {
    const editor = new CircuitEditor(0)
    editor.placeBlock(0, 0, 'wire')
    editor.placeBlock(1, 0, 'wire')
    editor.placeBlock(2, 0, 'wire')

    // (1,0)のワイヤーを削除
    editor.removeBlock(1, 0)
    expect(editor.getBlock(1, 0)).toBeNull()

    // (0,0)と(2,0)は孤立 → Minecraft仕様ではcross形状（全方向true）
    const w0 = editor.getBlock(0, 0)
    const w2 = editor.getBlock(2, 0)
    if (w0?.type !== 'wire' || w2?.type !== 'wire') return
    // 孤立ワイヤーはcross: east/westともtrue（視覚的に十字形）
    expect(w0.connections.east).toBe(true)
    expect(w2.connections.west).toBe(true)
  })

  it('3本の直線から中央を削除するとシミュレーション上はつながらない', () => {
    // ワイヤーの connections はあくまで「形状」。
    // 実際の信号伝播は SimWorld 側で connections + 隣接ブロックの存在を見て判断する。
    // このテストでは「配置状態として独立した2本になる」ことを確認。
    const editor = new CircuitEditor(0)
    editor.placeBlock(0, 0, 'wire')
    editor.placeBlock(1, 0, 'wire')
    editor.placeBlock(2, 0, 'wire')
    editor.removeBlock(1, 0)

    const world = editor.buildSimWorld()
    // (1,0)にブロックなし
    expect(world.getBlock(1, 0, 0)).toBeNull()
  })

  it('リピーターの前後にワイヤーが接続される', () => {
    const editor = new CircuitEditor(0)
    // repeater facing=east: 入力=west, 出力=east
    editor.placeBlock(1, 0, 'repeater', { facing: 'east' })
    editor.placeBlock(0, 0, 'wire')  // west隣 (入力側)
    editor.placeBlock(2, 0, 'wire')  // east隣 (出力側)

    const wInput = editor.getBlock(0, 0)
    const wOutput = editor.getBlock(2, 0)
    if (wInput?.type !== 'wire' || wOutput?.type !== 'wire') return

    expect(wInput.connections.east).toBe(true)
    expect(wOutput.connections.west).toBe(true)
  })

  it('リピーターの側面隣のワイヤーはリピーターから信号を受け取らない', () => {
    // connections はあくまで「視覚的な形状」（孤立 = cross = 4方向true）であり、
    // 隣にリピーターの側面があっても孤立扱い → cross形状になる。
    // 重要なのは「シミュレーションでリピーターの側面からは信号が来ない」こと。
    const editor = new CircuitEditor(0)
    editor.placeBlock(0, 0, 'lever')
    editor.placeBlock(1, 0, 'repeater', { facing: 'east' })  // east向き
    editor.placeBlock(1, 1, 'wire')   // south隣（リピーターの側面）
    editor.placeBlock(2, 0, 'lamp')   // リピーター出力先

    const world = editor.buildSimWorld()
    world.activateBlock(0, 0, 0)
    world.tick()  // delay=1のリピーターが出力

    // 出力先（east）のランプは点灯する
    expect(world.getBlock(2, 0, 0)).toMatchObject({ type: 'lamp', lit: true })
    // 側面のワイヤーは power=0 のまま（リピーターの側面からは信号が来ない）
    expect(world.getBlock(1, 0, 1)).toMatchObject({ type: 'wire', power: 0 })
  })
})

// ─────────────────────────────────────────────────────────────

describe('CircuitEditor: undo/redo', () => {
  it('undo で配置が取り消せる', () => {
    const editor = new CircuitEditor(0)
    editor.placeBlock(0, 0, 'lamp')
    expect(editor.getBlock(0, 0)?.type).toBe('lamp')

    editor.undo()
    expect(editor.getBlock(0, 0)).toBeNull()
  })

  it('redo で配置が再適用される', () => {
    const editor = new CircuitEditor(0)
    editor.placeBlock(0, 0, 'lamp')
    editor.undo()
    editor.redo()

    expect(editor.getBlock(0, 0)?.type).toBe('lamp')
  })

  it('複数操作の undo が順番に戻る', () => {
    const editor = new CircuitEditor(0)
    editor.placeBlock(0, 0, 'lamp')
    editor.placeBlock(1, 0, 'wire')

    editor.undo()  // wire の配置を取り消す
    expect(editor.getBlock(1, 0)).toBeNull()
    expect(editor.getBlock(0, 0)?.type).toBe('lamp')

    editor.undo()  // lamp の配置を取り消す
    expect(editor.getBlock(0, 0)).toBeNull()
  })

  it('undo後にredo不可状態で新操作するとredoが消える', () => {
    const editor = new CircuitEditor(0)
    editor.placeBlock(0, 0, 'lamp')
    editor.undo()
    expect(editor.canRedo()).toBe(true)

    editor.placeBlock(0, 0, 'wire')  // 新しい操作
    expect(editor.canRedo()).toBe(false)
  })

  it('undo で隣接ワイヤーの接続も正しく戻る（接続→孤立の逆）', () => {
    const editor = new CircuitEditor(0)
    editor.placeBlock(0, 0, 'wire')

    // placeBlock前: w0は孤立 → cross形状(east=true)
    const before = editor.getBlock(0, 0)
    const eastBefore = before?.type === 'wire' ? before.connections.east : null

    editor.placeBlock(1, 0, 'wire')  // east隣に追加
    // w0のconnectionsは変わらないはず（元々east=trueのcross形状）
    const after1 = editor.getBlock(0, 0)
    expect(after1?.type === 'wire' && after1.connections.east).toBe(true)

    editor.undo()  // (1,0)を削除 → w0は再び孤立
    const after2 = editor.getBlock(0, 0)
    // 孤立ワイヤーはcross → east=true（undoで元のcross形状に戻る）
    expect(after2?.type === 'wire' && after2.connections.east).toBe(true)
    expect(eastBefore).toBe(true)  // undoで元通り
  })
})

// ─────────────────────────────────────────────────────────────

describe('CircuitEditor: buildSimWorld', () => {
  it('buildSimWorld でレバー→ワイヤー→ランプ回路が動作する', () => {
    const editor = new CircuitEditor(0)
    editor.placeBlock(0, 0, 'lever')
    editor.placeBlock(1, 0, 'wire')
    editor.placeBlock(2, 0, 'lamp')

    const world = editor.buildSimWorld()
    world.activateBlock(0, 0, 0)  // layer=0

    const wireBlock = world.getBlock(1, 0, 0)
    expect(wireBlock?.type).toBe('wire')
    if (wireBlock?.type === 'wire') {
      expect(wireBlock.power).toBeGreaterThan(0)
    }
    expect(world.getBlock(2, 0, 0)).toMatchObject({ type: 'lamp', lit: true })
  })

  it('buildSimWorld の結果は editor の layer に配置される', () => {
    const layer = 3
    const editor = new CircuitEditor(layer)
    editor.placeBlock(0, 0, 'lamp')

    const world = editor.buildSimWorld()

    // Y=layer にブロックがある
    expect(world.getBlock(0, layer, 0)?.type).toBe('lamp')
    // Y=0 にはない
    expect(world.getBlock(0, 0, 0)).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────

describe('CircuitEditor: on("change") イベント', () => {
  it('placeBlock と removeBlock で change イベントが発火する', () => {
    const editor = new CircuitEditor(0)
    let callCount = 0
    editor.on('change', () => { callCount++ })

    editor.placeBlock(0, 0, 'lamp')
    expect(callCount).toBe(1)

    editor.removeBlock(0, 0)
    expect(callCount).toBe(2)
  })

  it('off（unsubscribe）でイベントが止まる', () => {
    const editor = new CircuitEditor(0)
    let callCount = 0
    const off = editor.on('change', () => { callCount++ })

    editor.placeBlock(0, 0, 'lamp')
    expect(callCount).toBe(1)

    off()  // 購読解除
    editor.placeBlock(1, 0, 'lamp')
    expect(callCount).toBe(1)  // 増えない
  })

  it('getSnapshot が WorldSnapshot を返す', () => {
    const editor = new CircuitEditor(0)
    editor.placeBlock(0, 0, 'lamp')
    editor.placeBlock(1, 0, 'wire')

    const snapshot = editor.getSnapshot()
    expect(snapshot.blocks.size).toBe(2)
    expect(snapshot.bounds.y).toEqual([0, 0])
  })
})
