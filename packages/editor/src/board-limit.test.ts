import { describe, it, expect } from 'vitest'
import { BOARD_MAX, normalizeBoardSize, requiredBoardSize, growthProposal, DEFAULT_BOARD } from './index.js'
import type { BlockState } from '@redstone/sim'

/**
 * 盤面の高さ上限 (#234)。
 *
 * 64 では 146 段のガラスエレベーター (7×146×17) が入らなかった。
 * 上限は 256 (バニラの建築高さ相当)。疎データなので体積は確保コストにならない。
 */
describe('盤面の上限', () => {
  it('146 段のエレベーターが盤面に入る (#234)', () => {
  // 7×146×17 の占有を模した 2 点
  const blocks = new Map<string, BlockState>([
    ['0,0,0', { type: 'solid', powered: false }],
    ['6,145,16', { type: 'solid', powered: false }],
  ])
  const need = requiredBoardSize(blocks)
  expect(need).toEqual({ x: 7, y: 146, z: 17 })
  // 既定 16³ からの提案が必要サイズを満たす (上限で頭打ちにならない)
  const grown = growthProposal(DEFAULT_BOARD, need)
  expect(grown, '広げる提案が出ない').not.toBeNull()
  expect(grown!.y, `高さ ${need.y} が上限 ${BOARD_MAX} で切られている`).toBe(146)
  expect(normalizeBoardSize(need)).toEqual(need)
})

  it('上限そのものも指定できる', () => {
    expect(normalizeBoardSize({ x: BOARD_MAX, y: BOARD_MAX, z: BOARD_MAX }))
      .toEqual({ x: BOARD_MAX, y: BOARD_MAX, z: BOARD_MAX })
  })

  it('上限を超える指定は丸める', () => {
    expect(normalizeBoardSize({ x: BOARD_MAX + 1, y: 1, z: 1 }).x).toBe(BOARD_MAX)
  })
})
