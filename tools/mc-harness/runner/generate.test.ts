import { describe, it, expect } from 'vitest'
import { settleMismatches, buildExpect, fixtureBlocks, stateMapDiff } from './generate.js'

/**
 * generate.ts の照合と書き出し (#242)。**実機は要らない**。
 *
 * 実機の dump (dump.sc の `_canon`) は名前空間を外してキーを並べるだけなので、
 * 材質は生のまま返ってくる。照合は両側を canonicalize してから行い、
 * fixture には畳まない形を書く。
 */

const b = (pos: [number, number, number], block: string) => ({ pos, block })

describe('settleMismatches', () => {
  it('代表名に畳まれる材質を置いても通る (羊毛・色付きガラス・グロウストーンなど)', () => {
    const blocks = [
      b([0, 1, 0], 'light_blue_wool'),
      b([1, 1, 0], 'white_stained_glass'),
      b([2, 1, 0], 'glowstone'),
      b([3, 1, 0], 'packed_ice'),
      b([4, 1, 0], 'smooth_quartz'),
    ]
    const settled = {
      '0,1,0': 'light_blue_wool',
      '1,1,0': 'white_stained_glass',
      '2,1,0': 'glowstone',
      '3,1,0': 'packed_ice',
      '4,1,0': 'smooth_quartz',
    }
    expect(settleMismatches(blocks, settled)).toEqual([])
  })

  it('ハーフは waterlogged を書かなくても通る (実機は必ず付けて返す)', () => {
    expect(settleMismatches(
      [b([0, 1, 0], 'smooth_stone_slab[type=top]'), b([1, 1, 0], 'smooth_stone_slab[type=double]')],
      {
        '0,1,0': 'smooth_stone_slab[type=top,waterlogged=false]',
        '1,1,0': 'smooth_stone_slab[type=double,waterlogged=false]',
      },
    )).toEqual([])
  })

  it('名前空間とキーの順は見ない', () => {
    expect(settleMismatches(
      [b([0, 1, 0], 'minecraft:repeater[powered=false,facing=west,locked=false,delay=1]')],
      { '0,1,0': 'repeater[delay=1,facing=west,locked=false,powered=false]' },
    )).toEqual([])
  })

  it('状態が違えば落とし、定義の文字列と実機の生の文字列を並べる (ワイヤーの power)', () => {
    expect(settleMismatches(
      [b([0, 1, 0], 'redstone_wire[east=side,north=none,power=15,south=none,west=side]')],
      { '0,1,0': 'redstone_wire[east=side,north=none,power=14,south=none,west=side]' },
    )).toEqual([{
      pos: '0,1,0',
      authored: 'redstone_wire[east=side,north=none,power=15,south=none,west=side]',
      settled: 'redstone_wire[east=side,north=none,power=14,south=none,west=side]',
    }])
  })

  it('畳んだ先が違えば落とす (石とガラス・石と黒曜石)', () => {
    expect(settleMismatches(
      [b([0, 1, 0], 'white_wool'), b([1, 1, 0], 'stone')],
      { '0,1,0': 'white_stained_glass', '1,1,0': 'obsidian' },
    ).map(d => d.pos)).toEqual(['0,1,0', '1,1,0'])
  })

  it('置いたはずのブロックが消えた / 置いていない所に現れたら落とす', () => {
    expect(settleMismatches([b([0, 1, 0], 'stone')], {}))
      .toEqual([{ pos: '0,1,0', authored: 'stone', settled: 'air' }])
    expect(settleMismatches([], { '0,1,0': 'light_blue_wool' }))
      .toEqual([{ pos: '0,1,0', authored: 'air', settled: 'light_blue_wool' }])
  })
})

describe('buildExpect', () => {
  const blocks = [
    b([0, 1, 0], 'light_blue_wool'),
    b([1, 1, 0], 'redstone_lamp[lit=false]'),
    b([2, 1, 0], 'smooth_stone_slab[type=bottom]'),
  ]
  // 実機は材質を生のまま、ハーフには waterlogged を付けて返す
  const raw0 = {
    '0,1,0': 'light_blue_wool',
    '1,1,0': 'redstone_lamp[lit=false]',
    '2,1,0': 'smooth_stone_slab[type=bottom,waterlogged=false]',
  }

  it('材質やハーフの waterlogged は tick 0 の偽の変化にならない', () => {
    expect(buildExpect(blocks, [{ tick: 0, blocks: raw0 }], 0)).toEqual([])
  })

  it('変化は実機の生の名前で書く (畳んだ名前にしない)', () => {
    const t1 = {
      '0,2,0': 'light_blue_wool',
      '1,1,0': 'redstone_lamp[lit=true]',
      '2,1,0': 'smooth_stone_slab[type=bottom,waterlogged=false]',
    }
    expect(buildExpect(blocks, [{ tick: 0, blocks: raw0 }, { tick: 1, blocks: t1 }], 1)).toEqual([
      {
        tick: 1,
        changes: [
          { pos: [0, 1, 0], block: 'air' },
          { pos: [0, 2, 0], block: 'light_blue_wool' },
          { pos: [1, 1, 0], block: 'redstone_lamp[lit=true]' },
        ],
      },
    ])
  })

  it('材質だけの違いは変化として数えない', () => {
    expect(stateMapDiff({ '0,1,0': 'white_wool' }, { '0,1,0': 'stone' })).toEqual([])
    expect(stateMapDiff({ '0,1,0': 'glass' }, { '0,1,0': 'black_stained_glass' })).toEqual([])
  })

  it('tick が欠けていたら止める', () => {
    expect(() => buildExpect(blocks, [{ tick: 0, blocks: raw0 }], 1)).toThrow('tick 1')
  })
})

describe('fixtureBlocks', () => {
  it('材質を残し、名前空間を外してキーを並べる。items はそのまま', () => {
    expect(fixtureBlocks([
      { pos: [0, 1, 0], block: 'minecraft:light_blue_wool' },
      { pos: [1, 1, 0], block: 'smooth_stone_slab[type=top]' },
      { pos: [2, 1, 0], block: 'hopper[facing=down,enabled=true]', items: 3 },
      { pos: [3, 1, 0], block: 'barrel[open=false,facing=up]', items: [{ slot: 0, id: 'stone', count: 64 }] },
    ])).toEqual([
      { pos: [0, 1, 0], block: 'light_blue_wool' },
      { pos: [1, 1, 0], block: 'smooth_stone_slab[type=top]' },
      { pos: [2, 1, 0], block: 'hopper[enabled=true,facing=down]', items: 3 },
      { pos: [3, 1, 0], block: 'barrel[facing=up,open=false]', items: [{ slot: 0, id: 'stone', count: 64 }] },
    ])
  })
})
