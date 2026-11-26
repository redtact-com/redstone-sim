/**
 * @redstone/docs-kit/viewer
 *
 * fixture を記事の中で再生するビューアの入口 (#434)。`FixtureViewer` は次の PR で足す。
 * 今あるのは枠の計算だけで、viewer と sim を docs-kit から import できること
 * (alias・tsconfig の references・Vite のチャンク分け) を 3 つの道具で確かめる足場を兼ねる。
 */

import { fitDistance } from '@redstone/viewer'
import type { Fixture } from '@redstone/sim'

/** ビューアが最初に置くカメラ。fixture の領域が枠に収まる距離と、見る中心 */
export interface FixtureFrame {
  /** 領域の大きさ (ブロック数。x・y・z) */
  size: [number, number, number]
  /** 領域の中心 (ブロックの中心の座標) */
  center: [number, number, number]
  /** `fitDistance` が返す距離 */
  distance: number
}

/** fixture の領域 (from〜to。両端を含む) から最初のカメラを決める */
export function fixtureFrame(region: Fixture['region'], aspect = 1): FixtureFrame {
  const size: [number, number, number] = [0, 0, 0]
  const center: [number, number, number] = [0, 0, 0]
  for (let i = 0; i < 3; i++) {
    const lo = Math.min(region.from[i], region.to[i])
    const hi = Math.max(region.from[i], region.to[i])
    size[i] = hi - lo + 1
    center[i] = (lo + hi + 1) / 2
  }
  return { size, center, distance: fitDistance(size, { aspect }) }
}
