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
  /** 重量感圧板が踏まれたとき出力する信号強度 (1-15)。既定 15 */
  pressedPower?: number
  /** コンテナがコンパレーター背面から読まれる実効出力 (0-15)。既定 0 */
  signal?: number
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

  /**
   * ワイヤーの dot ⇄ cross 形状をトグルする（C8 #38）。
   * トグルが起きたら true を返し change を発火する。
   */
  toggleWireDot(x: number, z: number): boolean {
    const changed = this.grid.toggleWireDot(x, z)
    if (changed) this.emit()
    return changed
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
    case 'pressure_plate_wood':
      return { type: 'pressure_plate_wood', powered: false }
    case 'pressure_plate_stone':
      return { type: 'pressure_plate_stone', powered: false }
    case 'weighted_pressure_plate_light':
      return { type: 'weighted_pressure_plate_light', pressedPower: opts.pressedPower ?? 15, powered: false }
    case 'weighted_pressure_plate_heavy':
      return { type: 'weighted_pressure_plate_heavy', pressedPower: opts.pressedPower ?? 15, powered: false }
    case 'lamp':
      return { type: 'lamp', lit: false }
    case 'note_block':
      // 発音は BE フック経由 (音自体はスコープ外)。初期は消灯・note=0
      return { type: 'note_block', powered: false, note: 0 }
    case 'piston':
    case 'sticky_piston':
      return { type, facing, extended: false }
    case 'piston_head':
    case 'moving_piston':
      return null  // head / 移動中ブロックは sim が管理する (直接配置不可)
    case 'redstone_block':
      // 定数動力源。石と同列にパレットへ追加 (常時通電)
      return { type: 'redstone_block' }
    case 'target':
      // 手動トリガの折衷モデル。初期は消灯 (outputPower=0)
      return { type: 'target', outputPower: 0 }
    case 'observer':
      // facing = 観測方向 (顔のある面)。出力は背面。初期は消灯
      return { type: 'observer', facing, powered: false }
    case 'solid':
      return { type: 'solid', powered: false }
    case 'container':
      // コンパレーター背面から読まれる実効出力 (0-15) を editor で設定する (#54)。
      return { type: 'container', signal: opts.signal ?? 0 }
    default:
      return null
  }
}
