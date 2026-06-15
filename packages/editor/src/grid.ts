/**
 * 2D グリッド — エディターが管理するブロック配置の内部状態。
 * Y座標は layer で固定。
 */

import type { BlockState, HDir, WorldSnapshot } from '@redstone/sim'
import { posKey } from '@redstone/sim'
import { computeWireConnections, computeWireDeletionUpdates } from './wire-connect.js'

export type Pos2D = [number, number]  // [x, z]

/** undo/redo 用の操作履歴 */
export interface EditAction {
  pos: Pos2D
  before: BlockState | null
  after: BlockState | null
}

export class EditorGrid {
  private blocks = new Map<string, BlockState>()
  private history: EditAction[][] = []  // 各要素は1操作（wire更新を含む場合は複数変更）
  private future: EditAction[][] = []
  readonly layer: number

  constructor(layer: number) {
    this.layer = layer
  }

  // ── ブロックアクセス ─────────────────────────────────────

  getBlock(x: number, z: number): BlockState | null {
    return this.blocks.get(`${x},${z}`) ?? null
  }

  private setRaw(x: number, z: number, block: BlockState | null): void {
    const key = `${x},${z}`
    if (!block || block.type === 'air') {
      this.blocks.delete(key)
    } else {
      this.blocks.set(key, block)
    }
  }

  // ── 配置・削除 ────────────────────────────────────────────

  placeBlock(x: number, z: number, block: BlockState): void {
    const before = this.getBlock(x, z)
    const changes: EditAction[] = [{ pos: [x, z], before, after: block }]

    this.setRaw(x, z, block)

    // ワイヤーを配置した場合: 自分の接続 + 隣接ワイヤーの接続を更新
    if (block.type === 'wire') {
      const conn = computeWireConnections(x, z, this)
      const updatedSelf: BlockState = { ...block, connections: conn }
      this.setRaw(x, z, updatedSelf)
      changes[0].after = updatedSelf

      // 隣接ワイヤーの接続も更新
      this.updateAdjacentWires(x, z, changes)
    }

    // 非ワイヤーを配置した場合: 隣接ワイヤーの接続を更新
    if (block.type !== 'wire') {
      this.updateAdjacentWires(x, z, changes)
    }

    this.pushHistory(changes)
  }

  removeBlock(x: number, z: number): void {
    const before = this.getBlock(x, z)
    if (!before) return

    const changes: EditAction[] = [{ pos: [x, z], before, after: null }]
    this.setRaw(x, z, null)

    // 隣接ワイヤーの接続を更新
    const updates = computeWireDeletionUpdates(x, z, this)
    for (const { pos: [nx, nz], connections } of updates) {
      const nb = this.getBlock(nx, nz)
      if (nb?.type !== 'wire') continue
      const updated: BlockState = { ...nb, connections }
      changes.push({ pos: [nx, nz], before: nb, after: updated })
      this.setRaw(nx, nz, updated)
    }

    this.pushHistory(changes)
  }

  rotateBlock(x: number, z: number, dir: HDir): void {
    const block = this.getBlock(x, z)
    if (!block) return
    if (!('facing' in block)) return

    const before = block
    const after: BlockState = { ...block, facing: dir } as BlockState
    this.setRaw(x, z, after)

    const changes: EditAction[] = [{ pos: [x, z], before, after }]

    // リピーター・コンパレーター・壁トーチの向き変更 → 隣接ワイヤー更新
    if (block.type === 'repeater' || block.type === 'comparator' || block.type === 'wall_torch') {
      this.updateAdjacentWires(x, z, changes)
    }

    this.pushHistory(changes)
  }

  getAllBlocks(): Map<string, BlockState> {
    return new Map(this.blocks)
  }

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
      const [x, z] = key.split(',').map(Number)
      const conn = computeWireConnections(x, z, this)
      this.setRaw(x, z, { ...block, connections: conn })
    }
  }

  // ── undo / redo ──────────────────────────────────────────

  undo(): boolean {
    const group = this.history.pop()
    if (!group) return false
    // 逆順に適用
    for (let i = group.length - 1; i >= 0; i--) {
      const { pos: [x, z], before } = group[i]
      this.setRaw(x, z, before)
    }
    this.future.push(group)
    return true
  }

  redo(): boolean {
    const group = this.future.pop()
    if (!group) return false
    for (const { pos: [x, z], after } of group) {
      this.setRaw(x, z, after)
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
    let minZ = Infinity, maxZ = -Infinity
    const y = this.layer

    for (const [key, block] of this.blocks) {
      const [x, z] = key.split(',').map(Number)
      const pos3Key = posKey([x, y, z])
      map.set(pos3Key, block)
      if (x < minX) minX = x; if (x > maxX) maxX = x
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z
    }

    if (!isFinite(minX)) { minX = 0; maxX = 0; minZ = 0; maxZ = 0 }

    return {
      blocks: map,
      bounds: { x: [minX, maxX], y: [y, y], z: [minZ, maxZ] },
    }
  }

  // ── 内部 ─────────────────────────────────────────────────

  private updateAdjacentWires(x: number, z: number, changes: EditAction[]): void {
    const dirs: Array<[number, number]> = [[0, -1], [0, 1], [1, 0], [-1, 0]]
    for (const [dx, dz] of dirs) {
      const nx = x + dx
      const nz = z + dz
      const nb = this.getBlock(nx, nz)
      if (nb?.type !== 'wire') continue
      const newConn = computeWireConnections(nx, nz, this)
      const updated: BlockState = { ...nb, connections: newConn }
      changes.push({ pos: [nx, nz], before: nb, after: updated })
      this.setRaw(nx, nz, updated)
    }
  }

  private pushHistory(changes: EditAction[]): void {
    this.history.push(changes)
    this.future = []  // undo後に新操作したらredoを消す
  }
}
