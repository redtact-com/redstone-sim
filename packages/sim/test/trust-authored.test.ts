import { describe, it, expect } from 'vitest'
import { buildFixtureWorld, type Fixture } from '../src/fixture-driver.js'
import type { ComparatorState } from '../src/types.js'

// 実機のスナップショットを出発点にする (trustAuthored) ときの、
// **blockstate に出ない値**の扱い。
//
// コンパレーターの出力強度は BlockEntity の OutputSignal で、blockstate は
// powered (0 か否か) しか持たない。読めなければ今の入力から計算し直すしかないが、
// **それが正しいのは止まっている回路だけ** (#249)。

/**
 * 樽 (中身なし) → コンパレーター → ダスト。
 * 中身が無いので「今の入力から計算し直す」と出力は 0 になる。
 * 実機がそこで別の値を保持していた場合に、それを持ち込めるかを見る
 */
function fixture(comparators?: { pos: [number, number, number]; output: number }[]): Fixture {
  return {
    name: 'trust-authored-comparator', mcVersion: '1.21.1', ticks: 1,
    region: { from: [0, 0, 0], to: [3, 1, 0] },
    trustAuthored: true,
    ...(comparators ? { comparators } : {}),
    blocks: [
      { pos: [0, 0, 0], block: 'stone' },
      { pos: [1, 0, 0], block: 'stone' },
      { pos: [2, 0, 0], block: 'stone' },
      { pos: [0, 1, 0], block: 'barrel[facing=north,open=false]' },
      { pos: [1, 1, 0], block: 'comparator[facing=west,mode=compare,powered=true]' },
      { pos: [2, 1, 0], block: 'redstone_wire[east=none,north=none,power=7,south=none,west=side]' },
    ],
    inputs: [], expect: [],
  }
}

const comparatorAt = (fx: Fixture, pos: [number, number, number]): ComparatorState => {
  const { world } = buildFixtureWorld(fx)
  const b = world.getBlockAt(pos)
  if (b?.type !== 'comparator') throw new Error(`コンパレーターが無い: ${pos.join(',')}`)
  return b
}

describe('trustAuthored — コンパレーターの保持出力 (#249)', () => {
  it('実機から読めた値をそのまま出発点にする', () => {
    // **計算し直すと 0 になる** (樽が空) 状況で 7 を持ち込めること。
    // 周回しながら減衰する機械では、コンパレーターは「まだ書き換わっていない
    // 古い値」を保持していて、予約 tick の発火でようやく新しい値へ落ちる。
    // 計算し直すと最初から新しい値になり、発火しても何も変わらず機械が止まる
    expect(comparatorAt(fixture([{ pos: [1, 1, 0], output: 7 }]), [1, 1, 0]).outputPower).toBe(7)
  })

  it('読めなかった座標は従来どおり今の入力から計算する', () => {
    // 上のテストが「常に 7 になる」だけの空振りでない証拠でもある
    expect(comparatorAt(fixture(), [1, 1, 0]).outputPower).toBe(0)
    expect(comparatorAt(fixture([]), [1, 1, 0]).outputPower).toBe(0)
  })

  it('別の座標の値を取り違えない', () => {
    expect(comparatorAt(fixture([{ pos: [0, 1, 0], output: 7 }]), [1, 1, 0]).outputPower).toBe(0)
  })
})
