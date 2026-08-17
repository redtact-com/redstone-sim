import { describe, it, expect } from 'vitest'
import type { BlockState } from '@redstone/sim'
import {
  translateBlocks, normalizeToOrigin, clipToBoard, countOutside,
  requiredBoardSize, offsetToFitBoard, growthProposal,
} from './transform.js'
import {
  normalizeBoardSize, isInsideBoard, blocksExtent, boundsWithBlocks,
  DEFAULT_BOARD, BOARD_MAX,
} from './board.js'

const wire = (): BlockState => ({
  type: 'wire', power: 0,
  connections: { north: false, south: false, east: false, west: false },
})
const solid = (): BlockState => ({ type: 'solid', powered: false })

/** "x,y,z" のリストからブロック集合を作る */
const mk = (...keys: string[]): Map<string, BlockState> =>
  new Map(keys.map((k, i) => [k, i % 2 === 0 ? wire() : solid()]))

const keys = (m: Map<string, BlockState>): string[] => [...m.keys()].sort()

describe('translateBlocks', () => {
  it('全ブロックが同じ量だけ動く', () => {
    expect(keys(translateBlocks(mk('0,0,0', '1,0,2'), 3, 1, -1))).toEqual(['3,1,-1', '4,1,1'])
  })

  it('**盤面の外に出ても捨てない** (行き過ぎたら戻せるようにするため)', () => {
    const moved = translateBlocks(mk('0,0,0'), -5, -5, -5)
    expect(keys(moved)).toEqual(['-5,-5,-5'])
    expect(moved.size).toBe(1)
  })

  it('ブロックの中身は保たれる', () => {
    const src = new Map<string, BlockState>([['2,3,4', { type: 'repeater', facing: 'east', delay: 3, powered: true, locked: false }]])
    expect(translateBlocks(src, 1, 0, 0).get('3,3,4')).toEqual(src.get('2,3,4'))
  })

  it('0 移動は同じ配置 (別インスタンス)', () => {
    const src = mk('1,2,3')
    const out = translateBlocks(src, 0, 0, 0)
    expect(keys(out)).toEqual(keys(src))
    expect(out).not.toBe(src)
  })

  it('空でも壊れない', () => {
    expect(translateBlocks(new Map(), 5, 5, 5).size).toBe(0)
  })

  it('相対位置は必ず保たれる (回路が壊れない)', () => {
    const src = mk('0,0,0', '0,0,1', '5,3,2')
    const out = translateBlocks(src, -7, 2, 11)
    const rel = (m: Map<string, BlockState>) => {
      const ks = [...m.keys()].map(k => k.split(',').map(Number))
      const [bx, by, bz] = ks[0]
      return ks.map(([x, y, z]) => `${x - bx},${y - by},${z - bz}`).sort()
    }
    expect(rel(out)).toEqual(rel(src))
  })
})

describe('normalizeToOrigin — 原点寄せ (判断 D)', () => {
  it('最小座標が原点に来る', () => {
    expect(keys(normalizeToOrigin(mk('5,2,7', '8,2,9')))).toEqual(['0,0,0', '3,0,2'])
  })

  it('負の座標も原点に寄る', () => {
    expect(keys(normalizeToOrigin(mk('-3,-1,-4', '-1,0,-4')))).toEqual(['0,0,0', '2,1,0'])
  })

  it('既に原点にあるなら動かない', () => {
    expect(keys(normalizeToOrigin(mk('0,0,0', '2,1,3')))).toEqual(['0,0,0', '2,1,3'])
  })

  it('軸ごとに独立して寄る (一番小さい軸だけ動くのではない)', () => {
    expect(keys(normalizeToOrigin(mk('4,0,9')))).toEqual(['0,0,0'])
  })

  it('空でも壊れない', () => {
    expect(normalizeToOrigin(new Map()).size).toBe(0)
  })
})

describe('clipToBoard — 確定時の切り捨て', () => {
  const board = { x: 4, y: 4, z: 4 }

  it('中と外を分ける', () => {
    const r = clipToBoard(mk('0,0,0', '3,3,3', '4,0,0', '0,0,-1'), board)
    expect(keys(r.kept)).toEqual(['0,0,0', '3,3,3'])
    expect(keys(r.dropped)).toEqual(['0,0,-1', '4,0,0'])
  })

  it('境界はちょうど含む / 1 つ外は落ちる', () => {
    expect(clipToBoard(mk('3,3,3'), board).dropped.size).toBe(0)
    expect(clipToBoard(mk('4,3,3'), board).kept.size).toBe(0)
    expect(clipToBoard(mk('3,4,3'), board).kept.size).toBe(0)
    expect(clipToBoard(mk('3,3,4'), board).kept.size).toBe(0)
  })

  it('中身は失われない (kept + dropped = 元の数)', () => {
    const src = mk('0,0,0', '9,9,9', '2,2,2', '-1,0,0')
    const r = clipToBoard(src, board)
    expect(r.kept.size + r.dropped.size).toBe(src.size)
  })
})

describe('countOutside — 確定前の警告用', () => {
  it('盤面の外の個数を数える', () => {
    expect(countOutside(mk('0,0,0', '20,0,0', '0,20,0', '0,0,20'), DEFAULT_BOARD)).toBe(3)
  })

  it('全部中なら 0', () => {
    expect(countOutside(mk('0,0,0', '15,15,15'), DEFAULT_BOARD)).toBe(0)
  })

  it('盤面を広げれば減る (サイズ変更の preview がこれで動く)', () => {
    const b = mk('0,0,0', '20,0,0', '0,0,30')
    expect(countOutside(b, { x: 16, y: 16, z: 16 })).toBe(2)
    expect(countOutside(b, { x: 32, y: 16, z: 32 })).toBe(0)
  })
})

describe('requiredBoardSize — 「広げますか」の提案値', () => {
  it('原点から数えた必要サイズ', () => {
    expect(requiredBoardSize(mk('0,0,0', '19,3,9'))).toEqual({ x: 20, y: 4, z: 10 })
  })

  it('負の座標があっても過小に出さない', () => {
    // 原点寄せ前に呼ばれても、占有幅ぶんは確保する
    expect(requiredBoardSize(mk('-5,0,0', '2,0,0')).x).toBe(8)
  })

  it('空なら 1×1×1', () => {
    expect(requiredBoardSize(new Map())).toEqual({ x: 1, y: 1, z: 1 })
  })
})

describe('offsetToFitBoard — はみ出しを中へ入れる', () => {
  const board = { x: 8, y: 8, z: 8 }

  it('手前に出ていれば押し戻す', () => {
    expect(offsetToFitBoard(mk('-2,0,0'), board)).toMatchObject({ dx: 2 })
  })

  it('奥に出ていれば引き戻す', () => {
    expect(offsetToFitBoard(mk('9,0,0', '10,0,0'), board)).toMatchObject({ dx: -3 })
  })

  it('入れた結果が本当に盤面の中に収まる', () => {
    const src = mk('12,9,11', '14,10,13')
    const { dx, dy, dz } = offsetToFitBoard(src, board)
    expect(countOutside(translateBlocks(src, dx, dy, dz), board)).toBe(0)
  })

  it('盤面より大きい回路は 0 側に寄せる (収まりきらないので端で止まる)', () => {
    const src = mk('0,0,0', '20,0,0')
    const { dx } = offsetToFitBoard(src, board)
    expect(dx).toBe(0)
    // 収まりきらないことは countOutside 側で警告する
    expect(countOutside(translateBlocks(src, dx, 0, 0), board)).toBeGreaterThan(0)
  })

  it('既に収まっていれば動かさない', () => {
    expect(offsetToFitBoard(mk('1,1,1', '6,6,6'), board)).toEqual({ dx: 0, dy: 0, dz: 0 })
  })
})

describe('normalizeBoardSize', () => {
  it('省略・null は既定', () => {
    expect(normalizeBoardSize(null)).toEqual(DEFAULT_BOARD)
    expect(normalizeBoardSize(undefined)).toEqual(DEFAULT_BOARD)
  })

  it('欠けた軸だけ既定で補う (旧保存データの互換)', () => {
    expect(normalizeBoardSize({ x: 32 })).toEqual({ x: 32, y: 16, z: 16 })
  })

  it('上限・下限で丸める', () => {
    expect(normalizeBoardSize({ x: 999, y: 0, z: -5 })).toEqual({ x: BOARD_MAX, y: 1, z: 1 })
  })

  it('小数は切り捨て / NaN は既定', () => {
    expect(normalizeBoardSize({ x: 20.9, y: NaN, z: 16 })).toEqual({ x: 20, y: 16, z: 16 })
  })
})

describe('isInsideBoard / blocksExtent', () => {
  it('境界の内外', () => {
    const b = { x: 2, y: 2, z: 2 }
    expect(isInsideBoard(0, 0, 0, b)).toBe(true)
    expect(isInsideBoard(1, 1, 1, b)).toBe(true)
    expect(isInsideBoard(2, 0, 0, b)).toBe(false)
    expect(isInsideBoard(-1, 0, 0, b)).toBe(false)
  })

  it('占有範囲', () => {
    expect(blocksExtent(mk('2,1,3', '5,1,9'))).toEqual({
      min: { x: 2, y: 1, z: 3 }, max: { x: 5, y: 1, z: 9 }, size: { x: 4, y: 1, z: 7 },
    })
  })

  it('空なら null', () => {
    expect(blocksExtent(new Map())).toBeNull()
  })
})

describe('座標キーの -0 混入', () => {
  it('移動量に -0 を返さない (同じ位置が別キー扱いになる)', () => {
    // 盤面より大きい回路: max 側の引き戻し量が -0 になり得る
    const { dx, dy, dz } = offsetToFitBoard(mk('0,0,0', '20,20,20'), { x: 8, y: 8, z: 8 })
    expect(Object.is(dx, -0)).toBe(false)
    expect(Object.is(dy, -0)).toBe(false)
    expect(Object.is(dz, -0)).toBe(false)
  })

  it('移動後のキーに "-0" が現れない', () => {
    const moved = translateBlocks(mk('0,0,0', '3,1,2'), -0, -0, -0)
    for (const k of moved.keys()) expect(k).not.toContain('-0')
  })
})

describe('growthProposal — 「広げますか」を出すかどうか (判断 C)', () => {
  it('収まっているなら提案しない', () => {
    expect(growthProposal({ x: 16, y: 16, z: 16 }, { x: 10, y: 10, z: 10 })).toBeNull()
    expect(growthProposal({ x: 16, y: 16, z: 16 }, { x: 16, y: 16, z: 16 })).toBeNull()
  })

  it('足りない軸だけ広げる (他は今の値を保つ)', () => {
    expect(growthProposal({ x: 16, y: 16, z: 16 }, { x: 32, y: 10, z: 20 }))
      .toEqual({ x: 32, y: 16, z: 20 })
  })

  it('**広げても今と同じなら提案しない** (上限で頭打ち)', () => {
    // 268 段の回路。上限 64 なのでこれ以上広げられない
    expect(growthProposal({ x: 32, y: BOARD_MAX, z: 32 }, { x: 19, y: 268, z: 7 })).toBeNull()
  })

  it('上限に届かない軸があるならそこは広げる', () => {
    const p = growthProposal({ x: 16, y: BOARD_MAX, z: 16 }, { x: 20, y: 268, z: 7 })
    expect(p).toEqual({ x: 20, y: BOARD_MAX, z: 16 })
  })

  it('提案値は必ず盤面の上限内', () => {
    const p = growthProposal({ x: 16, y: 16, z: 16 }, { x: 999, y: 999, z: 999 })
    expect(p).toEqual({ x: BOARD_MAX, y: BOARD_MAX, z: BOARD_MAX })
  })
})

describe('boundsWithBlocks — プレビューで盤面外も描くための bounds', () => {
  const board = { x: 16, y: 16, z: 16 }

  it('盤面に収まっていれば盤面ぴったり', () => {
    expect(boundsWithBlocks(board, mk('0,0,0', '15,15,15')))
      .toEqual({ x: [0, 15], y: [0, 15], z: [0, 15] })
  })

  it('空でも盤面ぴったり', () => {
    expect(boundsWithBlocks(board, new Map())).toEqual({ x: [0, 15], y: [0, 15], z: [0, 15] })
  })

  it('**盤面の外へ出たブロックを含むまで広がる** (含まないと描けない)', () => {
    expect(boundsWithBlocks(board, mk('-3,0,0', '20,0,0')))
      .toEqual({ x: [-3, 20], y: [0, 15], z: [0, 15] })
  })

  it('下や奥へ出ても広がる', () => {
    expect(boundsWithBlocks(board, mk('0,-2,0', '0,0,30')))
      .toEqual({ x: [0, 15], y: [-2, 15], z: [0, 30] })
  })

  it('盤面より小さい回路でも盤面は必ず入る (枠を描くため)', () => {
    expect(boundsWithBlocks({ x: 32, y: 8, z: 32 }, mk('1,1,1')))
      .toEqual({ x: [0, 31], y: [0, 7], z: [0, 31] })
  })
})
