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
 * 上限を 64 にできるのは `SimWorld` (Map) も deepslate の `Structure`
 * (blocks 配列 + blocksMap) も**疎で、体積に比例した確保をしていない**ため。
 * 広げるコストはブロック数とグリッド線の本数に比例する。
 */
export const BOARD_MIN = 1
export const BOARD_MAX = 64

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
