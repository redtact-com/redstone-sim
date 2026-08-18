// ============================================================
// 盤面 (グリッド) のサイズ (#226)
//
// **EditorPage と EmbedPage に同じ 16 の定数が別々に置かれていた**。
// 変換器の二重管理で #189 (facing) と #214 (ブロック名) を 2 回踏んでいるので、
// ここを唯一の置き場にする。
// ============================================================

import type { BlockState } from '@redstone/sim'

/** 盤面の寸法。x=幅 / y=高さ (レイヤー数) / z=奥行 */
export interface BoardSize {
  x: number
  y: number
  z: number
}

/** 既定の盤面。従来の固定値と同じ (#179 で高さを 8 → 16 にした) */
export const DEFAULT_BOARD: BoardSize = { x: 16, y: 16, z: 16 }

/**
 * 盤面の下限・上限。
 *
 * 上限を大きく取れるのは `SimWorld` (Map) も deepslate の `Structure`
 * (blocks 配列 + blocksMap) も**疎で、体積に比例した確保をしていない**ため。
 * 広げるコストはブロック数とグリッド線の本数に比例する。
 *
 * 256 はバニラの建築高さ相当 (#234)。146 段のガラスエレベーターを入れるのに
 * 64 では足りなかった。
 */
export const BOARD_MIN = 1
export const BOARD_MAX = 256

const clampAxis = (v: number): number => {
  if (!Number.isFinite(v)) return DEFAULT_BOARD.x
  return Math.min(BOARD_MAX, Math.max(BOARD_MIN, Math.floor(v)))
}

/** 入力を盤面サイズとして使える値に整える。壊れた値は既定に落とす */
export function normalizeBoardSize(size: Partial<BoardSize> | null | undefined): BoardSize {
  if (!size) return { ...DEFAULT_BOARD }
  return {
    x: clampAxis(size.x ?? DEFAULT_BOARD.x),
    y: clampAxis(size.y ?? DEFAULT_BOARD.y),
    z: clampAxis(size.z ?? DEFAULT_BOARD.z),
  }
}

/** 座標が盤面の中か */
export function isInsideBoard(x: number, y: number, z: number, board: BoardSize): boolean {
  return x >= 0 && x < board.x && y >= 0 && y < board.y && z >= 0 && z < board.z
}

const parseKey = (key: string): [number, number, number] => {
  const [x, y, z] = key.split(',').map(Number)
  return [x, y, z]
}

/** ブロック集合の実際の占有範囲。空なら null */
export function blocksExtent(blocks: Map<string, BlockState>): {
  min: BoardSize
  max: BoardSize
  size: BoardSize
} | null {
  if (blocks.size === 0) return null
  let minX = Infinity, minY = Infinity, minZ = Infinity
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
  for (const key of blocks.keys()) {
    const [x, y, z] = parseKey(key)
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (z < minZ) minZ = z
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
    if (z > maxZ) maxZ = z
  }
  return {
    min: { x: minX, y: minY, z: minZ },
    max: { x: maxX, y: maxY, z: maxZ },
    size: { x: maxX - minX + 1, y: maxY - minY + 1, z: maxZ - minZ + 1 },
  }
}

/** WorldSnapshot の bounds と同じ形 */
export interface SnapshotBoundsLike {
  x: [number, number]
  y: [number, number]
  z: [number, number]
}

/**
 * 盤面と実際の占有範囲の和を bounds にする。
 *
 * プレビュー中は盤面の外にもブロックが居る。viewer の座標は**構造ローカル**
 * (bounds の min が原点) なので、bounds を盤面に固定すると外のブロックが描けない。
 * 逆に bounds を広げると viewer の原点が動くため、**グリッド枠の描画も
 * この bounds を基準に置き直す必要がある** (盤面基準のままだとブロックとずれる)。
 */
export function boundsWithBlocks(
  board: BoardSize, blocks: ReadonlyMap<string, BlockState>,
): SnapshotBoundsLike {
  let minX = 0, minY = 0, minZ = 0
  let maxX = board.x - 1, maxY = board.y - 1, maxZ = board.z - 1
  for (const key of blocks.keys()) {
    const [x, y, z] = key.split(',').map(Number)
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (z < minZ) minZ = z
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
    if (z > maxZ) maxZ = z
  }
  return { x: [minX, maxX], y: [minY, maxY], z: [minZ, maxZ] }
}
