import { describe, it, expect } from 'vitest'
import { SimWorld } from '../src/world'
import type { Pos3D, WireState } from '../src/types'

/**
 * #104 強さの違う直結源が同一のダスト連結成分にある場合の定常値。
 *
 * propagateWireBFS の Phase2 が「シード走査中に >0 になったセル」を visited で凍結していたため、
 * 弱い直結源から先に走ると低い値のまま固定され、後から届く強い spread で昇圧されなかった。
 * 症状は走査起点 (= 最後に変化したブロック) に依存する locational な誤りになる。
 *
 * 期待値は vanilla の減衰則そのもの: 各セルの power = max(源の強さ − 距離)。
 * 実機突合は fixture dust-weak-source-mix (レバー15 + コンパレータ12) が担う。
 */

const LEN = 6            // ダストの本数
const LEVER_POWER = 15   // 強い直結源 (レバーは全方向 15)

/** ダスト列 + 端のレバー + weakAt の隣に重量板 (pressedPower=weakPower) を組む */
function build(weakAt: number, weakPower: number): SimWorld {
  const w = new SimWorld()
  for (let x = -1; x <= LEN; x++) w.setBlockAt([x, -1, 0], { type: 'solid', powered: false })
  w.setBlockAt([-1, 0, 0], { type: 'lever', facing: 'up', powered: false } as never)
  for (let x = 0; x < LEN; x++) {
    w.setBlockAt([x, 0, 0], {
      type: 'wire',
      connections: { north: false, south: false, east: true, west: true },
      power: 0,
    } as never)
  }
  // 弱い直結源は列の横 (z=1) に置く。ダストと直交するので列の連結は変えない
  w.setBlockAt([weakAt, -1, 1], { type: 'solid', powered: false })
  w.setBlockAt([weakAt, 0, 1], {
    type: 'weighted_pressure_plate_light', powered: false, pressedPower: weakPower,
  } as never)
  w.initialize()
  return w
}

const powers = (w: SimWorld): number[] =>
  Array.from({ length: LEN }, (_, x) => (w.getBlockAt([x, 0, 0] as Pos3D) as WireState | null)?.power ?? -1)

/** vanilla の減衰則: 各源から (強さ − 距離) を取り、その最大 */
function expected(weakAt: number, weakPower: number): number[] {
  return Array.from({ length: LEN }, (_, x) =>
    Math.max(0, LEVER_POWER - (x + 1) + 1, weakPower - Math.abs(x - weakAt)))
}

describe('#104 複数の直結源が同一ダスト網にある場合', () => {
  const WEAK_POWERS = [1, 5, 8, 12, 14]
  const WEAK_POSITIONS = [0, 2, LEN - 1]

  for (const weakPower of WEAK_POWERS) {
    for (const weakAt of WEAK_POSITIONS) {
      const want = expected(weakAt, weakPower)

      it(`強い源→弱い源の順: 弱=${weakPower} @${weakAt} → ${want.join(',')}`, () => {
        const w = build(weakAt, weakPower)
        w.activateBlock(-1, 0, 0)          // レバー ON
        w.flush(16)
        w.activateBlock(weakAt, 0, 1)      // 板を踏む (弱い源が後)
        w.tick()
        expect(powers(w)).toEqual(want)
      })

      it(`弱い源→強い源の順: 弱=${weakPower} @${weakAt} → ${want.join(',')}`, () => {
        const w = build(weakAt, weakPower)
        w.activateBlock(weakAt, 0, 1)      // 板を踏む (弱い源が先)
        w.tick()
        w.activateBlock(-1, 0, 0)          // レバー ON
        w.tick()
        expect(powers(w)).toEqual(want)
      })
    }
  }

  it('走査起点に依存しない (どちら側から触っても同じ定常値になる)', () => {
    const [weakAt, weakPower] = [4, 9]
    const fromStrong = build(weakAt, weakPower)
    fromStrong.activateBlock(-1, 0, 0); fromStrong.flush(16)
    fromStrong.activateBlock(weakAt, 0, 1); fromStrong.tick()

    const fromWeak = build(weakAt, weakPower)
    fromWeak.activateBlock(weakAt, 0, 1); fromWeak.tick()
    fromWeak.activateBlock(-1, 0, 0); fromWeak.tick()

    expect(powers(fromWeak)).toEqual(powers(fromStrong))
  })

  it('弱い源が消えても強い源の値へ戻る', () => {
    const w = build(3, 10)
    w.activateBlock(-1, 0, 0); w.flush(16)
    w.activateBlock(3, 0, 1)
    w.tick()
    w.flush(32)                            // 重量板は 10gt で自動 OFF
    expect(powers(w)).toEqual(expected(3, 0))
  })
})
