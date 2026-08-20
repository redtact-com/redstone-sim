import { describe, it, expect } from 'vitest'
import { fitDistance, maxZoomOut, VIEWER_FOV_DEG, VIEWER_FAR } from '../src/camera.js'

/**
 * カメラの寄りが回路の大きさに追従するか (#238)。
 *
 * 従来は `max(幅, 高さ, 奥行) * 1.5` で、147 段の回路が画面の高さの 3 割しか使わない
 * 糸のような柱になっていた (実測)。ここでは**画面に映る大きさ**で確かめる。
 */

/** 距離 d のとき、画面の縦いっぱいに見える長さ (ブロック数) */
const visibleHeight = (d: number, fovDeg = VIEWER_FOV_DEG): number =>
  2 * d * Math.tan((fovDeg * Math.PI) / 180 / 2)

/** 外接球が画面の縦に対して占める割合 */
const fillRatio = (size: [number, number, number], aspect = 1): number => {
  const d = fitDistance(size, { aspect })
  return Math.hypot(...size) / visibleHeight(d)
}

describe('fitDistance — 回路が画面に収まる距離 (#238)', () => {
  it('147 段の細長い回路が画面の 7 割以上を使う (旧実装は 3 割)', () => {
    const size: [number, number, number] = [7, 147, 17]
    const r = fillRatio(size)
    expect(r).toBeGreaterThan(0.7)
    expect(r, '画面からはみ出している').toBeLessThanOrEqual(1)

    // 旧実装 (max(幅,高さ,奥行) * 1.5) との比較。**2 倍以上**大きく映ること
    const oldD = Math.max(...size) * 1.5
    const oldRatio = Math.hypot(...size) / visibleHeight(oldD)
    expect(r / oldRatio).toBeGreaterThan(1.5)
  })

  it('小さい回路でも同じ割合になる (大きさに比例する)', () => {
    expect(fillRatio([3, 3, 3])).toBeCloseTo(fillRatio([30, 30, 30]), 5)
  })

  it('**旧実装より確実に寄る** (147 段で 1.5 倍以上)', () => {
    const old = Math.max(7, 147, 17) * 1.5
    expect(fitDistance([7, 147, 17])).toBeLessThan(old / 1.5)
  })

  it('縦長の画面 (スマホ) では横が狭くなるぶん引く', () => {
    const wide = fitDistance([40, 5, 40], { aspect: 16 / 9 })
    const tall = fitDistance([40, 5, 40], { aspect: 9 / 16 })
    expect(tall, 'スマホの縦画面なのに寄りすぎている').toBeGreaterThan(wide)
  })

  it('回路が 0 なら 1 を返す (0 除算しない)', () => {
    expect(fitDistance([0, 0, 0])).toBe(1)
  })

  it('far クリップ面 (500) の外へは出ない', () => {
    // 盤面上限 256 の立方体でも切れないこと
    const d = fitDistance([256, 256, 256])
    const radius = Math.hypot(256, 256, 256) / 2
    expect(d + radius).toBeLessThan(VIEWER_FAR)
  })
})

describe('maxZoomOut — 引ける上限 (#238)', () => {
  it('小さい回路では従来どおり 200 まで引ける', () => {
    expect(maxZoomOut([16, 16, 16])).toBe(200)
  })

  it('大きい回路では 200 より引ける (固定値だと引ききれない)', () => {
    expect(maxZoomOut([7, 147, 17])).toBeGreaterThan(200)
  })

  it('far クリップ面の内側に収まる', () => {
    const size: [number, number, number] = [256, 256, 256]
    const radius = Math.hypot(...size) / 2
    expect(maxZoomOut(size) + radius).toBeLessThan(VIEWER_FAR)
  })
})
