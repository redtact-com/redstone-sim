/**
 * 3D グリッド — エディターが管理するブロック配置の内部状態。
 * ブロックは 3D キー "x,y,z" で保持し、2D API (getBlock/placeBlock 等) は
 * activeLayer に対する操作として扱う。
 */

import type { BlockState, HDir, WireConnections, WorldSnapshot } from '@redstone/sim'
import { posKey } from '@redstone/sim'
import { computeWireConnections, collectWireConnectionUpdates } from './wire-connect.js'
import type { GridPos } from './wire-connect.js'

export type Pos2D = [number, number]  // [x, z]

/** undo/redo 用の操作履歴 */
export interface EditAction {
  pos: GridPos
  before: BlockState | null
  after: BlockState | null
}

function sameConnections(a: WireConnections, b: WireConnections): boolean {
  return a.north === b.north && a.south === b.south && a.east === b.east && a.west === b.west
}

export class EditorGrid {
  private blocks = new Map<string, BlockState>()  // key: "x,y,z"
  private history: EditAction[][] = []  // 各要素は1操作（wire更新を含む場合は複数変更）
  private future: EditAction[][] = []
  /** 現在編集対象の Y レイヤー。2D API はこのレイヤーに対して操作する */
  activeLayer: number

  constructor(layer: number) {
    this.activeLayer = layer
  }

  /** 後方互換: 現在の編集レイヤー */
  get layer(): number { return this.activeLayer }

  // ── ブロックアクセス ─────────────────────────────────────

  getBlock(x: number, z: number): BlockState | null {
    return this.getBlock3(x, this.activeLayer, z)
  }

  getBlock3(x: number, y: number, z: number): BlockState | null {
    return this.blocks.get(`${x},${y},${z}`) ?? null
  }

  private setRaw(x: number, y: number, z: number, block: BlockState | null): void {
    const key = `${x},${y},${z}`
    if (!block || block.type === 'air') {
      this.blocks.delete(key)
    } else {
      this.blocks.set(key, block)
    }
  }

  // ── 配置・削除 ────────────────────────────────────────────

  placeBlock(x: number, z: number, block: BlockState): void {
    this.placeBlock3(x, this.activeLayer, z, block)
  }

  placeBlock3(x: number, y: number, z: number, block: BlockState): void {
    const before = this.getBlock3(x, y, z)
    const changes: EditAction[] = [{ pos: [x, y, z], before, after: block }]

    this.setRaw(x, y, z, block)

    // ワイヤーを配置した場合: 自分の接続を計算
    if (block.type === 'wire') {
      const conn = computeWireConnections(x, y, z, this)
      const updatedSelf: BlockState = { ...block, connections: conn }
      this.setRaw(x, y, z, updatedSelf)
      changes[0].after = updatedSelf
    }

    // 周辺ワイヤー（同レイヤー・上下ステップ範囲）の接続を更新
    this.applyNeighborWireUpdates(x, y, z, changes)

    this.pushHistory(changes)
  }

  removeBlock(x: number, z: number): void {
    this.removeBlock3(x, this.activeLayer, z)
  }

  removeBlock3(x: number, y: number, z: number): void {
    const before = this.getBlock3(x, y, z)
    if (!before) return

    const changes: EditAction[] = [{ pos: [x, y, z], before, after: null }]
    this.setRaw(x, y, z, null)

    this.applyNeighborWireUpdates(x, y, z, changes)

    this.pushHistory(changes)
  }

  rotateBlock(x: number, z: number, dir: HDir): void {
    const y = this.activeLayer
    const block = this.getBlock3(x, y, z)
    if (!block) return
    if (!('facing' in block)) return

    const before = block
    const after: BlockState = { ...block, facing: dir } as BlockState
    this.setRaw(x, y, z, after)

    const changes: EditAction[] = [{ pos: [x, y, z], before, after }]

    // リピーター・コンパレーター・壁トーチの向き変更 → 隣接ワイヤー更新
    if (block.type === 'repeater' || block.type === 'comparator' || block.type === 'wall_torch') {
      this.applyNeighborWireUpdates(x, y, z, changes)
    }

    this.pushHistory(changes)
  }

  /** 全ブロック（3D キー "x,y,z"） */
  getAllBlocks(): Map<string, BlockState> {
    return new Map(this.blocks)
  }

  /** 3D キー "x,y,z" のブロックマップで全体を差し替える。履歴はリセットされる。 */
  resetToBlocks(blocks: Map<string, BlockState>): void {
    this.blocks = new Map(blocks)
    this.history = []
    this.future = []
    this.recomputeAllWires()
  }

  /** 全ワイヤーの接続形状を現在のグリッド状態から再計算する（インポート後等に使用） */
  recomputeAllWires(): void {
    for (const [key, block] of this.blocks) {
      if (block.type !== 'wire') continue
      const [x, y, z] = key.split(',').map(Number)
      const conn = computeWireConnections(x, y, z, this)
      this.setRaw(x, y, z, { ...block, connections: conn })
    }
  }

  // ── undo / redo ──────────────────────────────────────────

  undo(): boolean {
    const group = this.history.pop()
    if (!group) return false
    // 逆順に適用
    for (let i = group.length - 1; i >= 0; i--) {
      const { pos: [x, y, z], before } = group[i]
      this.setRaw(x, y, z, before)
    }
    this.future.push(group)
    return true
  }

  redo(): boolean {
    const group = this.future.pop()
    if (!group) return false
    for (const { pos: [x, y, z], after } of group) {
      this.setRaw(x, y, z, after)
    }
    this.history.push(group)
    return true
  }

  canUndo(): boolean { return this.history.length > 0 }
  canRedo(): boolean { return this.future.length > 0 }

  // ── WorldSnapshot への変換 ─────────────────────────────

  toSnapshot(): WorldSnapshot {
    const map = new Map<`${number},${number},${number}`, BlockState>()
    let minX = Infinity, maxX = -Infinity
    let minY = Infinity, maxY = -Infinity
    let minZ = Infinity, maxZ = -Infinity

    for (const [key, block] of this.blocks) {
      const [x, y, z] = key.split(',').map(Number)
      map.set(posKey([x, y, z]), block)
      if (x < minX) minX = x; if (x > maxX) maxX = x
      if (y < minY) minY = y; if (y > maxY) maxY = y
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z
    }

    if (!isFinite(minX)) {
      minX = 0; maxX = 0
      minY = this.activeLayer; maxY = this.activeLayer
      minZ = 0; maxZ = 0
    }

    return {
      blocks: map,
      bounds: { x: [minX, maxX], y: [minY, maxY], z: [minZ, maxZ] },
    }
  }

  // ── 内部 ─────────────────────────────────────────────────

  private applyNeighborWireUpdates(x: number, y: number, z: number, changes: EditAction[]): void {
    for (const { pos, connections } of collectWireConnectionUpdates(x, y, z, this)) {
      const [nx, ny, nz] = pos
      const nb = this.getBlock3(nx, ny, nz)
      if (nb?.type !== 'wire') continue
      if (sameConnections(nb.connections, connections)) continue
      const updated: BlockState = { ...nb, connections }
      changes.push({ pos, before: nb, after: updated })
      this.setRaw(nx, ny, nz, updated)
    }
  }

  private pushHistory(changes: EditAction[]): void {
    this.history.push(changes)
    this.future = []  // undo後に新操作したらredoを消す
  }
}
