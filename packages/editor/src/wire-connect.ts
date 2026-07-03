/**
 * ワイヤー接続形状の計算（配置・削除時に実行）。
 *
 * 導出ロジックの本体は #51 で @redstone/sim の wire-shape.ts へ一本化した
 * (シミュレーション中のトポロジー変化にも同じ規則で追随させるため)。
 * 本ファイルは editor 向けの薄いラッパー:
 *   - computeWireConnections: 新規配置時の導出 (prev 無し = dot ガード無し)
 *   - collectWireConnectionUpdates: 近傍変化時の再導出 (prev 付き = dot 維持)
 */

import type { WireConnections, WireState } from '@redstone/sim'
import {
  computeRawWireConnections as simComputeRaw,
  deriveWireConnections,
  wireShapeCandidates,
} from '@redstone/sim'
import type { BlockGrid3D } from '@redstone/sim'

export type GridPos = [number, number, number]  // [x, y, z]
export type { BlockGrid3D }

/** 生の接続形状 (自動拡張なし)。後方互換のため再エクスポート */
export const computeRawWireConnections = simComputeRaw

/**
 * 指定座標にあるワイヤーの接続形状を現在のグリッド状態から計算する。
 * 新規配置用 (prev 無し): 生の接続に自動整形 (孤立→cross / 1本→直線) を適用する。
 */
export function computeWireConnections(
  x: number,
  y: number,
  z: number,
  grid: BlockGrid3D,
): WireConnections {
  return deriveWireConnections(x, y, z, grid)
}

/**
 * (x, y, z) のブロックが変化した後に、接続形状の再計算が必要な周辺ワイヤーの
 * 更新一覧を返す。既存ワイヤーの現在形状を prev として渡すため、dot は
 * vanilla の保持ガード (wasDot && isDot) どおり維持される (#38/#51)。
 */
export function collectWireConnectionUpdates(
  x: number,
  y: number,
  z: number,
  grid: BlockGrid3D,
): Array<{ pos: GridPos; connections: WireConnections }> {
  const updates: Array<{ pos: GridPos; connections: WireConnections }> = []

  for (const [nx, ny, nz] of wireShapeCandidates([x, y, z])) {
    if (nx === x && ny === y && nz === z) continue  // 自身は配置側で導出済み
    const nb = grid.getBlock3(nx, ny, nz)
    if (nb?.type !== 'wire') continue
    updates.push({
      pos: [nx, ny, nz],
      connections: deriveWireConnections(nx, ny, nz, grid, (nb as WireState).connections),
    })
  }

  return updates
}
