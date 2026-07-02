import type {
  BlockState, BlockType, HDir, WorldSnapshot,
} from '@redstone/sim'
import { SimWorld } from '@redstone/sim'
import { EditorGrid } from './grid.js'

export type PlaceableType = Exclude<BlockType, 'air'>

export interface PlaceOptions {
  facing?: HDir
  delay?: 1 | 2 | 3 | 4
  mode?: 'compare' | 'subtract'
}

type ChangeHandler = (snapshot: WorldSnapshot) => void

export class CircuitEditor {
  private grid: EditorGrid
  private listeners = new Set<ChangeHandler>()

  constructor(layer: number) {
    this.grid = new EditorGrid(layer)
  }

  get layer(): number { return this.grid.layer }

  /** 現在編集対象の Y レイヤー */
  get activeLayer(): number { return this.grid.activeLayer }

  /** 編集対象の Y レイヤーを切り替える（配置・削除・選択の対象になる） */
  setActiveLayer(y: number): void {
    this.grid.activeLayer = y
  }

  // ── ブロック操作 ──────────────────────────────────────────

  placeBlock(x: number, z: number, type: PlaceableType, opts: PlaceOptions = {}): void {
    const block = buildBlockState(type, opts)
    if (!block) return
    this.grid.placeBlock(x, z, block)
    this.emit()
  }

  removeBlock(x: number, z: number): void {
    this.grid.removeBlock(x, z)
    this.emit()
  }

  /** レイヤー指定の削除（クリア等、activeLayer 外の操作に使用） */
  removeBlock3(x: number, y: number, z: number): void {
    this.grid.removeBlock3(x, y, z)
    this.emit()
  }

  /** インポート等でグリッド全体を差し替える。履歴はリセットされる。 */
  resetToBlocks(blocks: Map<string, BlockState>): void {
    this.grid.resetToBlocks(blocks)
    this.emit()
  }

  getAllBlocks(): Map<string, BlockState> {
    return this.grid.getAllBlocks()
  }

  rotateBlock(x: number, z: number, dir: HDir): void {
    this.grid.rotateBlock(x, z, dir)
    this.emit()
  }

  getBlock(x: number, z: number): BlockState | null {
    return this.grid.getBlock(x, z)
  }

  getBlock3(x: number, y: number, z: number): BlockState | null {
    return this.grid.getBlock3(x, y, z)
  }

  // ── undo/redo ─────────────────────────────────────────────

  undo(): boolean {
    const result = this.grid.undo()
    if (result) this.emit()
    return result
  }

  redo(): boolean {
    const result = this.grid.redo()
    if (result) this.emit()
    return result
  }

  canUndo(): boolean { return this.grid.canUndo() }
  canRedo(): boolean { return this.grid.canRedo() }

  // ── スナップショット / SimWorld ───────────────────────────

  getSnapshot(): WorldSnapshot {
    return this.grid.toSnapshot()
  }

  /**
   * 編集内容から SimWorld（3D）を構築して返す。
   * シミュレーション開始時に呼ぶ。
   */
  buildSimWorld(): SimWorld {
    const world = new SimWorld()
    const snapshot = this.grid.toSnapshot()

    for (const [key, block] of snapshot.blocks) {
      const [x, y, z] = key.split(',').map(Number)
      world.setBlock(x, y, z, block)
    }

    return world
  }

  // ── イベント ─────────────────────────────────────────────

  on(event: 'change', handler: ChangeHandler): () => void {
    if (event === 'change') {
      this.listeners.add(handler)
      return () => this.listeners.delete(handler)
    }
    return () => {}
  }

  private emit(): void {
    const snapshot = this.getSnapshot()
    for (const handler of this.listeners) handler(snapshot)
  }
}

// ── ブロック状態の初期値を生成 ──────────────────────────────

function buildBlockState(type: PlaceableType, opts: PlaceOptions): BlockState | null {
  const facing: HDir = opts.facing ?? 'north'

  switch (type) {
    case 'wire':
      return { type: 'wire', connections: { north: true, south: true, east: true, west: true }, power: 0 }
    case 'torch':
      return { type: 'torch', facing: 'up', lit: true }
    case 'wall_torch':
      return { type: 'wall_torch', facing, lit: true }
    case 'repeater':
      return { type: 'repeater', facing, delay: opts.delay ?? 1, powered: false, locked: false }
    case 'comparator':
      return { type: 'comparator', facing, mode: opts.mode ?? 'compare', powered: false, outputPower: 0 }
    case 'lever':
      return { type: 'lever', facing: 'up', powered: false }
    case 'button_stone':
      return { type: 'button_stone', facing: 'up', powered: false }
    case 'button_wood':
      return { type: 'button_wood', facing: 'up', powered: false }
    case 'lamp':
      return { type: 'lamp', lit: false }
    case 'solid':
      return { type: 'solid', powered: false }
    default:
      return null
  }
}
