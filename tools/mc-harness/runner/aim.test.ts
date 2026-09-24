// ============================================================
// `use` の狙点 (#378) の回帰。実機は呼ばない。
//
// ハーネスはずっとセル中心を狙っていたため `face=wall` のボタン/レバーに
// 射線が入らず、**押せないまま黙って何も起きなかった**。
// ここで固定しておくのは 2 点:
//   - 従来の狙点 (セル中心 / 定義の lookAt) が**必ず先頭**であること
//     (既存のキャプチャを動かさないため)
//   - 空振りの判定が「押す前から powered=true」を誤検出しないこと
// ============================================================

import { describe, it, expect } from 'vitest'
import {
  aimCandidates, shapeAim, didRespond, isVerifiable, pressBlock, standCandidates,
  WALL_OFFSET, FLOOR_Y, CEILING_Y, type Pos3,
} from './aim.js'

const POS: Pos3 = [1, 59, 8]

describe('狙点', () => {
  it('壁付けは facing の反対へ寄せる', () => {
    // facing=north の当たり判定は z が 0.875〜1.0 = セル中心より +z 側
    expect(shapeAim(POS, 'oak_button[face=wall,facing=north,powered=false]'))
      .toEqual([1.5, 59.5, 8.5 + WALL_OFFSET])
    expect(shapeAim(POS, 'oak_button[face=wall,facing=south,powered=false]'))
      .toEqual([1.5, 59.5, 8.5 - WALL_OFFSET])
    expect(shapeAim(POS, 'lever[face=wall,facing=east,powered=false]'))
      .toEqual([1.5 - WALL_OFFSET, 59.5, 8.5])
    expect(shapeAim(POS, 'lever[face=wall,facing=west,powered=false]'))
      .toEqual([1.5 + WALL_OFFSET, 59.5, 8.5])
  })

  it('床と天井は高さで寄せる', () => {
    expect(shapeAim(POS, 'stone_button[face=floor,facing=north,powered=false]'))
      .toEqual([1.5, 59 + FLOOR_Y.button, 8.5])
    expect(shapeAim(POS, 'lever[face=floor,facing=north,powered=false]'))
      .toEqual([1.5, 59 + FLOOR_Y.lever, 8.5])
    expect(shapeAim(POS, 'stone_button[face=ceiling,facing=north,powered=false]'))
      .toEqual([1.5, 59 + CEILING_Y, 8.5])
  })

  it('ボタン・レバー以外は形状を決めない', () => {
    expect(shapeAim(POS, 'oak_door[facing=north,half=lower,open=false]')).toBeNull()
    expect(shapeAim(POS, 'redstone_wire[power=0]')).toBeNull()
    expect(shapeAim(POS, 'lectern[facing=north,has_book=true,powered=false]')).toBeNull()
  })

  it('候補の先頭は必ず従来の狙点 (既存キャプチャを動かさない)', () => {
    const c = aimCandidates(POS, 'oak_button[face=wall,facing=north,powered=false]')
    expect(c[0]).toEqual([1.5, 59.5, 8.5])
    expect(c).toHaveLength(2)

    // 定義の lookAt を渡したときもそれが先頭
    const withFirst = aimCandidates(POS, 'lever[face=floor,facing=north,powered=false]', [1.5, 59.35, 8.5])
    expect(withFirst[0]).toEqual([1.5, 59.35, 8.5])
  })

  it('状態が読めないときはセル中心だけ', () => {
    expect(aimCandidates(POS, undefined)).toEqual([[1.5, 59.5, 8.5]])
  })

  it('従来の狙点が形状の点と同じなら候補は 1 つ', () => {
    const c = aimCandidates(POS, 'lever[face=floor,facing=north,powered=false]',
      [1.5, 59 + FLOOR_Y.lever, 8.5])
    expect(c).toHaveLength(1)
  })
})

describe('空振りの判定', () => {
  it('ボタンとレバーだけ判定できる', () => {
    expect(isVerifiable('oak_button[face=wall,facing=north,powered=false]')).toBe(true)
    expect(isVerifiable('lever[face=wall,facing=north,powered=false]')).toBe(true)
    expect(isVerifiable('oak_door[facing=north,open=false]')).toBe(false)
    expect(isVerifiable('redstone_wire[power=0]')).toBe(false)
  })

  it('powered が変われば当たり、変わらなければ空振り', () => {
    const off = 'oak_button[face=wall,facing=north,powered=false]'
    expect(didRespond(off, 'oak_button[face=wall,facing=north,powered=true]')).toBe(true)
    expect(didRespond(off, off)).toBe(false)
  })

  it('**押す前から powered=true のボタンは判定しない** (連打で毎回警告が出る)', () => {
    const on = 'oak_button[face=wall,facing=north,powered=true]'
    expect(didRespond(on, on)).toBeNull()
  })

  it('ボタン・レバー以外は判定しない', () => {
    expect(didRespond('oak_door[facing=north,open=false]', 'oak_door[facing=north,open=true]'))
      .toBeNull()
    expect(didRespond(undefined, 'stone')).toBeNull()
  })
})

describe('pressBlock', () => {
  const wall = (p: string): string => `oak_button[face=wall,facing=north,powered=${p}]`

  it('セル中心で当たれば狙い直さない', async () => {
    const aims: Pos3[] = []
    let state = wall('false')
    const r = await pressBlock(POS, state, {
      use: async aim => { aims.push(aim); state = wall('true') },
      read: () => state,
    })
    expect(aims).toEqual([[1.5, 59.5, 8.5]])
    expect(r.retried).toBe(false)
    expect(r.responded).toBe(true)
  })

  it('外したら形状に合わせて狙い直す', async () => {
    const aims: Pos3[] = []
    let state = wall('false')
    const r = await pressBlock(POS, state, {
      // 1 回目 (セル中心) は当たらず、2 回目だけ反応する実機を模す
      use: async aim => {
        aims.push(aim)
        if (aim[2] > 8.5) state = wall('true')
      },
      read: () => state,
    })
    expect(aims).toEqual([[1.5, 59.5, 8.5], [1.5, 59.5, 8.5 + WALL_OFFSET]])
    expect(r.retried).toBe(true)
    expect(r.responded).toBe(true)
    expect(r.aim).toEqual([1.5, 59.5, 8.5 + WALL_OFFSET])
  })

  it('どちらでも当たらなければ警告して responded=false を返す', async () => {
    const logs: string[] = []
    const r = await pressBlock(POS, wall('false'), {
      use: async () => {},
      read: () => wall('false'),
      log: m => logs.push(m),
    })
    expect(r.responded).toBe(false)
    expect(logs.some(m => m.includes('⚠'))).toBe(true)
  })

  it('判定できないブロックは 1 回で終える (レバーを 2 回倒さない)', async () => {
    let n = 0
    const r = await pressBlock(POS, 'lectern[facing=north,has_book=true,powered=false]', {
      use: async () => { n++ },
      read: () => 'lectern[facing=north,has_book=true,powered=false]',
    })
    expect(n).toBe(1)
    expect(r.responded).toBeNull()
  })

  it('warnOnFail: false なら外しても警告しない (呼び元が立ち位置を変える)', async () => {
    const logs: string[] = []
    const r = await pressBlock(POS, wall('false'), {
      use: async () => {},
      read: () => wall('false'),
      log: m => logs.push(m),
    }, { warnOnFail: false })
    expect(r.responded).toBe(false)
    expect(logs.some(m => m.includes('⚠'))).toBe(false)
  })
})

describe('立ち位置の候補', () => {
  it('壁付けは facing 側に立つ', () => {
    const c = standCandidates(POS, 'oak_button[face=wall,facing=north,powered=false]')
    // facing=north なので -z 側
    expect(c[0]).toEqual([1.5, 58, 7.5])
    expect(c.every(p => p[2] < 8.5)).toBe(true)
    // **セル中心に立たせる**。セル境界にまたがると同じ狙点でも押せない
    expect(c.every(p => Math.abs(p[0] % 1) === 0.5 && Math.abs(p[2] % 1) === 0.5)).toBe(true)
    // 足元は 1 つ下から試す (目の高さがボタンより少し上になる)
    expect(c[0][1]).toBe(POS[1] - 1)
  })

  it('床置きはその場に立って見下ろす', () => {
    expect(standCandidates(POS, 'stone_button[face=floor,facing=north,powered=false]')[0])
      .toEqual([1.5, 59, 8.5])
  })

  it('ボタン・レバー以外と状態不明は候補を出さない', () => {
    expect(standCandidates(POS, 'oak_door[facing=north,open=false]')).toEqual([])
    expect(standCandidates(POS, undefined)).toEqual([])
  })
})
