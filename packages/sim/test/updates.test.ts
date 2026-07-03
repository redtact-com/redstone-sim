import { describe, it, expect } from 'vitest'
import {
  javaBlockPosHash, javaHashSetOrder, dustUpdateOrigins,
  NC_UPDATE_ORDER, PP_UPDATE_ORDER, CU_UPDATE_ORDER,
} from '../src/updates.js'
import type { Pos3D } from '../src/types.js'

describe('updates: 方向順定数 (02 §4.2 [確定])', () => {
  it('NC = 西東下上北南 / PP = 西東北南下上 / CU = 北東南西', () => {
    expect(NC_UPDATE_ORDER).toEqual(['west', 'east', 'down', 'up', 'north', 'south'])
    expect(PP_UPDATE_ORDER).toEqual(['west', 'east', 'north', 'south', 'down', 'up'])
    expect(CU_UPDATE_ORDER).toEqual(['north', 'east', 'south', 'west'])
  })
})

describe('updates: BlockPos.hashCode の int32 再現', () => {
  it('(y + z*31)*31 + x を int32 で計算する', () => {
    expect(javaBlockPosHash([2, 1, 0])).toBe(33)
    expect(javaBlockPosHash([2, 0, 0])).toBe(2)
    expect(javaBlockPosHash([2, 1, -1])).toBe(-928)
    expect(javaBlockPosHash([2, 1, 1])).toBe(994)
  })
})

describe('updates: Java HashSet イテレーション順のエミュレート (locational の核)', () => {
  it('dustUpdateOrigins(2,1,0): 手計算した Java の bucket 順と一致する', () => {
    // 挿入順: self(2,1,0), D(2,0,0), U(2,2,0), N(2,1,-1), S(2,1,1), W(1,1,0), E(3,1,0)
    // hash&15: self=1, D=2, U=0, N=15 (spread 後), S=2, W=0, E=2
    // バケット順 (同バケット内は挿入順): [U, W] [self] [D, S, E] ... [N]
    expect(dustUpdateOrigins([2, 1, 0])).toEqual([
      [2, 2, 0],   // U  (bucket 0)
      [1, 1, 0],   // W  (bucket 0)
      [2, 1, 0],   // 自身 (bucket 1)
      [2, 0, 0],   // D  (bucket 2)
      [2, 1, 1],   // S  (bucket 2)
      [3, 1, 0],   // E  (bucket 2)
      [2, 1, -1],  // N  (bucket 15)
    ] satisfies Pos3D[])
  })

  it('座標が変わると相対順が変わる (= locational)', () => {
    // 同じ回路を平行移動したときの「自身・6方向の相対順パターン」を比較する。
    // 特定の 1 移動では順序が保存されることもあるため、x オフセット 16 通りで
    // パターンが複数現れることを確認する (バケット index が座標で回るため)
    const patternAt = (base: Pos3D): string =>
      dustUpdateOrigins(base)
        .map(([x, y, z]) => `${x - base[0]},${y - base[1]},${z - base[2]}`)
        .join('|')
    const patterns = new Set(
      Array.from({ length: 16 }, (_, i) => patternAt([2 + i, 1, 0])),
    )
    expect(patterns.size).toBeGreaterThan(1)
  })

  it('重複挿入は無視される (Set 意味論)', () => {
    expect(javaHashSetOrder([[0, 0, 0], [0, 0, 0], [1, 0, 0]])).toHaveLength(2)
  })

  it('13 要素以上 (リサイズ域) はエラー', () => {
    const many: Pos3D[] = Array.from({ length: 13 }, (_, i) => [i, 0, 0])
    expect(() => javaHashSetOrder(many)).toThrow()
  })
})
