/**
 * 更新伝播の順序定義 (02 §4.2 [確定: 1.21.1/26.2 デコンパイル])。
 *
 * - NC 送信順  = NeighborUpdater.UPDATE_ORDER      : 西→東→下→上→北→南
 * - PP 送信順  = BlockBehaviour.UPDATE_SHAPE_ORDER : 西→東→北→南→下→上
 * - CU 送信順  = Direction.Plane.HORIZONTAL        : 北→東→南→西
 * - ダスト多段送信の起点順 = Java HashSet<BlockPos> のイテレーション順 (locational,
 *   MC-11193 の直接根拠)。javaHashSetOrder() で忠実にエミュレートする。
 */

import type { Pos3D, Dir6 } from './types.js'

/** NC (neighborChanged) の送信方向順 */
export const NC_UPDATE_ORDER: Dir6[] = ['west', 'east', 'down', 'up', 'north', 'south']

/** PP (updateShape) の送信方向順 */
export const PP_UPDATE_ORDER: Dir6[] = ['west', 'east', 'north', 'south', 'down', 'up']

/** CU (comparatorUpdate) の水平送信順 */
export const CU_UPDATE_ORDER: Dir6[] = ['north', 'east', 'south', 'west']

/** Java の Direction.values() 順 (ダストの HashSet 構築 = 挿入順に使われる) */
export const JAVA_DIRECTION_VALUES: Dir6[] = ['down', 'up', 'north', 'south', 'west', 'east']

/** 更新の 3 分類 (+将来の自己更新)。トレース (08 記法) の bu/su/cu に対応 */
export type UpdateKind = 'nc' | 'pp' | 'cu'

// ── Java HashSet<BlockPos> イテレーション順のエミュレート ──────────────

/** BlockPos.hashCode(): (y + z*31)*31 + x を int32 で */
export function javaBlockPosHash(pos: Pos3D): number {
  const [x, y, z] = pos
  return (Math.imul(y + Math.imul(z, 31), 31) + x) | 0
}

/** HashMap.hash(): h ^ (h >>> 16) (int32) */
function spreadHash(h: number): number {
  return (h ^ (h >>> 16)) | 0
}

/**
 * Java HashSet に positions を挿入順どおり add したときのイテレーション順を返す。
 * - 初期容量 16 想定 (要素 12 個以下でリサイズなし。ダストの用途は 7 個)
 * - バケット index = spread(hash) & 15、走査はバケット昇順・同バケット内は挿入順
 *   (Java 8+ は衝突時に末尾追加)
 * - 要素 13 個以上は容量前提が崩れるためエラーにする
 */
export function javaHashSetOrder(positions: Pos3D[]): Pos3D[] {
  if (positions.length > 12) {
    throw new Error(`javaHashSetOrder: 13 要素以上はリサイズ未対応 (${positions.length})`)
  }
  const CAP = 16
  const buckets: Pos3D[][] = Array.from({ length: CAP }, () => [])
  const seen = new Set<string>()
  for (const p of positions) {
    const key = `${p[0]},${p[1]},${p[2]}`
    if (seen.has(key)) continue
    seen.add(key)
    const idx = spreadHash(javaBlockPosHash(p)) & (CAP - 1)
    buckets[idx].push(p)
  }
  return buckets.flat()
}

/**
 * ダストの多段送信の起点一覧: HashSet{自身 + 隣接6 (Direction.values() 挿入順)} の
 * イテレーション順 (02 §4.2 [確定]: RedStoneWireBlock.updatePowerStrength)
 */
export function dustUpdateOrigins(pos: Pos3D): Pos3D[] {
  const [x, y, z] = pos
  const rel: Record<Dir6, Pos3D> = {
    down: [x, y - 1, z], up: [x, y + 1, z],
    north: [x, y, z - 1], south: [x, y, z + 1],
    west: [x - 1, y, z], east: [x + 1, y, z],
  }
  return javaHashSetOrder([pos, ...JAVA_DIRECTION_VALUES.map(d => rel[d])])
}
