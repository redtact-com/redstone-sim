/**
 * ビューアの枠の計算 (#434)。React にも DOM にも触らない (単体テストで見る)。
 */

import { fitDistance, VIEWER_FOV_DEG } from '@redstone/viewer'
import type { BlockState, Fixture, WorldSnapshot } from '@redstone/sim'

/** ビューアが最初に置くカメラ。fixture の領域が枠に収まる距離と、見る中心 */
export interface FixtureFrame {
  /** 領域の大きさ (ブロック数。x・y・z) */
  size: [number, number, number]
  /** 領域の中心 (ブロックの中心の座標) */
  center: [number, number, number]
  /** `fitDistance` が返す距離 (3D で領域の全体が収まる) */
  distance: number
  /** 層の範囲 (y の下端と上端。両端を含む) */
  layers: [number, number]
}

/** fixture の領域 (from〜to。両端を含む) から最初のカメラを決める */
export function fixtureFrame(region: Fixture['region'], aspect = 1): FixtureFrame {
  const size: [number, number, number] = [0, 0, 0]
  const center: [number, number, number] = [0, 0, 0]
  const lo: [number, number, number] = [0, 0, 0]
  for (let i = 0; i < 3; i++) {
    lo[i] = Math.min(region.from[i], region.to[i])
    const hi = Math.max(region.from[i], region.to[i])
    size[i] = hi - lo[i] + 1
    center[i] = (lo[i] + hi + 1) / 2
  }
  return { size, center, distance: fitDistance(size, { aspect }), layers: [lo[1], lo[1] + size[1] - 1] }
}

/**
 * 2D (真上から) で、層 `layer` の上の面が枠に収まるカメラの距離。
 *
 * viewer のカメラは領域の**中心**から `distance` だけ離れる。真上から見ると、層の上の面までの
 * 奥行きは `distance - (層の上の面 - 領域の中心の高さ)` になるので、その分を足して返す。
 * 画面の縦に z、横に x が並ぶ (rotY = 0)
 */
export function topDownDistance(frame: FixtureFrame, layer: number, aspect = 1, margin = 1.15): number {
  const [sx, sy, sz] = frame.size
  const tan = Math.tan((VIEWER_FOV_DEG * Math.PI) / 360)
  const depth = Math.max(sz / 2 / tan, sx / 2 / (tan * Math.max(aspect, 0.01))) * margin
  const top = layer - frame.layers[0] + 1
  return Math.max(3, depth + (top - sy / 2))
}

/**
 * 2D で見せる snapshot: y が `layer` 以下のブロックだけを残す (上の層を外して、その層を真上から見る)。
 * 領域 (bounds) は変えないので、層を変えてもカメラは動かない。
 * 全部が残る時 (層が上端) は同じ snapshot をそのまま返す
 */
export function sliceSnapshot(snapshot: WorldSnapshot, layer: number): WorldSnapshot {
  if (layer >= snapshot.bounds.y[1]) return snapshot
  const blocks = new Map<`${number},${number},${number}`, BlockState>()
  for (const [key, b] of snapshot.blocks) {
    const y = Number(key.split(',')[1])
    if (y <= layer) blocks.set(key, b)
  }
  return { blocks, bounds: snapshot.bounds }
}

/** 層を範囲の中に収める */
export function clampLayer(frame: FixtureFrame, layer: number): number {
  return Math.max(frame.layers[0], Math.min(frame.layers[1], Math.round(layer)))
}

/**
 * 2D で最初に見せる層: ブロックのある一番上の層。
 * 領域の上の方は、動いた先のために空けてあることが多い (空の層から始めると、下げても絵が変わらない)
 */
export function topLayer(snapshot: WorldSnapshot, frame: FixtureFrame): number {
  let top = frame.layers[0]
  for (const key of snapshot.blocks.keys()) top = Math.max(top, Number(key.split(',')[1]))
  return clampLayer(frame, top)
}
