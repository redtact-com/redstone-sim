// ============================================================
// state-to-nbt: 実機ダンプ (StateMap) → バニラ構造 NBT
//
// 守りたいのは 2 つ:
//   1. **sim が潰すブロックが air にならない**こと。
//      exportToNbtBytes (sim の BlockState 経由) は塀・水・泡柱・ソウルサンドを
//      minecraft:air に落とすので、エレベーターの正解ファイルには使えなかった。
//   2. コンテナの中身 (block entity の Items) が往復すること。
//
// 読み直しは app/src/nbtIO.ts の 2 経路を両方使う:
//   - readRawPlacedBlocks … 生の name/props (書いた文字列がそのまま載ったか)
//   - importFromNbtBytes  … sim の BlockState (エディタが取り込めるか)
// ============================================================

import { describe, it, expect } from 'vitest'
import { NbtFile } from 'deepslate/nbt'
import { stateMapToStructureNbt, type StateMapItems } from './state-to-nbt'
import { importFromNbtBytes, readRawPlacedBlocks } from '../../../app/src/nbtIO'

/** readRawPlacedBlocks の結果を "x,y,z" → "name[k=v,...]" (名前空間付き) に畳む */
async function rawStates(bytes: Uint8Array): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  for (const b of await readRawPlacedBlocks(bytes)) {
    const keys = Object.keys(b.props).sort()
    const props = keys.length === 0 ? '' : `[${keys.map(k => `${k}=${b.props[k]}`).join(',')}]`
    out.set(b.pos.join(','), `${b.name}${props}`)
  }
  return out
}

/** 実機のエレベーター周りで要るブロック (どれも sim の書き出しでは air に潰れる) */
const ELEVATOR = new Map<string, string>([
  ['0,0,0', 'soul_sand'],
  ['0,1,0', 'water[level=0]'],
  ['0,2,0', 'bubble_column[drag=false]'],
  ['1,0,0', 'stone_brick_wall[east=none,north=low,south=low,up=true,waterlogged=false,west=none]'],
  ['1,1,0', 'lodestone'],
  ['1,2,0', 'water_cauldron[level=2]'],
])

describe('stateMapToStructureNbt: sim が潰すブロックが生き残る', () => {
  it('生の name/props が書いたとおりに読み戻る', async () => {
    const bytes = stateMapToStructureNbt(ELEVATOR)
    const raw = await rawStates(bytes)
    for (const [pos, state] of ELEVATOR) {
      expect(raw.get(pos)).toBe(`minecraft:${state}`)
    }
    expect(raw.size).toBe(ELEVATOR.size)
  })

  it('importFromNbtBytes が同じブロックとして取り込める (air に潰れない)', async () => {
    const { blocks, warnings } = await importFromNbtBytes(stateMapToStructureNbt(ELEVATOR))
    expect(blocks.get('0,0,0')).toMatchObject({ type: 'soul_sand' })
    expect(blocks.get('0,1,0')).toMatchObject({ type: 'water' })
    expect(blocks.get('0,2,0')).toMatchObject({ type: 'bubble_column', drag: false })
    expect(blocks.get('1,0,0')).toMatchObject({
      type: 'wall', north: 'low', south: 'low', east: 'none', west: 'none',
      up: true, waterlogged: false,
    })
    expect(blocks.get('1,1,0')).toMatchObject({ type: 'lodestone' })
    expect(blocks.get('1,2,0')).toMatchObject({ type: 'cauldron', level: 2 })
    // 1 個も落ちていない (落ちると「未対応ブロック n 個」の警告が出る)
    expect(warnings).toEqual([])
    expect(blocks.size).toBe(ELEVATOR.size)
  })

  it('レッドストーン素子の props も潰れない', async () => {
    const states = new Map<string, string>([
      ['0,0,0', 'repeater[delay=3,facing=north,locked=false,powered=true]'],
      ['0,0,1', 'redstone_wire[east=side,north=none,power=9,south=none,west=up]'],
    ])
    const raw = await rawStates(stateMapToStructureNbt(states))
    expect(raw.get('0,0,0'))
      .toBe('minecraft:repeater[delay=3,facing=north,locked=false,powered=true]')
    expect(raw.get('0,0,1'))
      .toBe('minecraft:redstone_wire[east=side,north=none,power=9,south=none,west=up]')
  })
})

describe('stateMapToStructureNbt: palette の組み立て', () => {
  // 変異検出用: props をキーに含めない / 毎回新規登録する、のどちらでも落ちる
  const states = new Map<string, string>([
    ['0,0,0', 'repeater[delay=1,facing=north,locked=false,powered=false]'],
    ['1,0,0', 'repeater[delay=1,facing=south,locked=false,powered=false]'],
    ['2,0,0', 'stone'],
    ['3,0,0', 'stone'],
  ])

  it('同じ blockstate は 1 エントリに畳まれ、違えば別エントリになる', () => {
    const root = NbtFile.read(stateMapToStructureNbt(states)).root
    // repeater(north) / repeater(south) / stone の 3 種
    expect(root.getList('palette').length).toBe(3)
    expect(root.getList('blocks').length).toBe(4)
  })

  it('畳んだあとも各座標が自分の blockstate を指す', async () => {
    const raw = await rawStates(stateMapToStructureNbt(states))
    expect(raw.get('0,0,0')).toContain('facing=north')
    expect(raw.get('1,0,0')).toContain('facing=south')
    expect(raw.get('2,0,0')).toBe('minecraft:stone')
    expect(raw.get('3,0,0')).toBe('minecraft:stone')
  })
})

describe('stateMapToStructureNbt: コンテナの中身', () => {
  const states = new Map<string, string>([
    ['0,0,0', 'barrel[facing=up,open=false]'],
    ['0,0,1', 'hopper[enabled=true,facing=down]'],
    ['0,0,2', 'stone'],
  ])
  // スタック上限の違うアイテムを混ぜる (コンパレーター強度は上限依存)
  const items: StateMapItems[] = [
    { pos: [0, 0, 0], slots: [{ slot: 0, id: 'cobblestone', count: 26 }, { slot: 26, id: 'snowball', count: 3 }] },
    { pos: [0, 0, 1], slots: [{ slot: 4, id: 'minecraft:snowball', count: 16 }] },
  ]

  it('生の Items が往復する', async () => {
    const placed = await readRawPlacedBlocks(stateMapToStructureNbt(states, items))
    const byPos = new Map(placed.map(b => [b.pos.join(','), b]))
    expect(byPos.get('0,0,0')!.items).toEqual([
      { slot: 0, id: 'minecraft:cobblestone', count: 26 },
      { slot: 26, id: 'minecraft:snowball', count: 3 },
    ])
    expect(byPos.get('0,0,1')!.items).toEqual([{ slot: 4, id: 'minecraft:snowball', count: 16 }])
    // 中身を渡していないブロックに block entity は付かない
    expect(byPos.get('0,0,2')!.items).toBeUndefined()
  })

  it('importFromNbtBytes がスロット/個数/スタック上限まで取り込む', async () => {
    const { blocks, warnings } = await importFromNbtBytes(stateMapToStructureNbt(states, items))
    const barrel = blocks.get('0,0,0') as { type: string; slots: Array<unknown> }
    expect(barrel.type).toBe('container')
    expect(barrel.slots).toHaveLength(27)
    expect(barrel.slots[0]).toEqual({ id: 'cobblestone', stack: 64, count: 26 })
    expect(barrel.slots[26]).toEqual({ id: 'snowball', stack: 16, count: 3 })
    const hopper = blocks.get('0,0,1') as { type: string; slots: Array<unknown> }
    expect(hopper.type).toBe('hopper')
    expect(hopper.slots[4]).toEqual({ id: 'snowball', stack: 16, count: 16 })
    expect(warnings).toEqual([])
  })

  it('個数 0 のスロットは書かない', async () => {
    const empty: StateMapItems[] = [{ pos: [0, 0, 0], slots: [{ slot: 0, id: 'cobblestone', count: 0 }] }]
    const placed = await readRawPlacedBlocks(stateMapToStructureNbt(states, empty))
    expect(placed.find(b => b.pos.join(',') === '0,0,0')!.items).toBeUndefined()
  })

  it('同じ座標の中身が 2 回書かれていれば例外 (後勝ちで消さない)', () => {
    const dup: StateMapItems[] = [
      { pos: [0, 0, 0], slots: [{ slot: 0, id: 'cobblestone', count: 1 }] },
      { pos: [0, 0, 0], slots: [{ slot: 1, id: 'cobblestone', count: 2 }] },
    ]
    expect(() => stateMapToStructureNbt(states, dup)).toThrow(/同じ座標が 2 回/)
  })

  it('中身の座標にブロックが無ければ例外 (黙って捨てない)', () => {
    const orphan: StateMapItems[] = [{ pos: [9, 9, 9], slots: [{ slot: 0, id: 'cobblestone', count: 1 }] }]
    expect(() => stateMapToStructureNbt(states, orphan)).toThrow(/対応するブロックがない/)
  })
})

describe('stateMapToStructureNbt: 座標と size', () => {
  it('最小座標を原点に寄せ、size が範囲ちょうどになる', async () => {
    const states = new Map<string, string>([
      ['10,64,-3', 'stone'],
      ['12,64,-3', 'soul_sand'],
      ['10,66,-1', 'water[level=0]'],
    ])
    const bytes = stateMapToStructureNbt(states)
    const size = NbtFile.read(bytes).root.getList('size', 3)
    expect([size.getNumber(0), size.getNumber(1), size.getNumber(2)]).toEqual([3, 3, 3])
    const raw = await rawStates(bytes)
    expect(raw.get('0,0,0')).toBe('minecraft:stone')
    expect(raw.get('2,0,0')).toBe('minecraft:soul_sand')
    expect(raw.get('0,2,2')).toBe('minecraft:water[level=0]')
  })

  it('items の座標も同じだけ寄る', async () => {
    const states = new Map<string, string>([['10,64,-3', 'barrel[facing=up,open=false]']])
    const items: StateMapItems[] = [
      { pos: [10, 64, -3], slots: [{ slot: 1, id: 'cobblestone', count: 5 }] },
    ]
    const placed = await readRawPlacedBlocks(stateMapToStructureNbt(states, items))
    expect(placed[0].pos).toEqual([0, 0, 0])
    expect(placed[0].items).toEqual([{ slot: 1, id: 'minecraft:cobblestone', count: 5 }])
  })

  it('空の StateMap は size [0,0,0] の空構造になる', async () => {
    const bytes = stateMapToStructureNbt(new Map())
    const size = NbtFile.read(bytes).root.getList('size', 3)
    expect([size.getNumber(0), size.getNumber(1), size.getNumber(2)]).toEqual([0, 0, 0])
    expect(await readRawPlacedBlocks(bytes)).toEqual([])
  })

  it('座標キーが壊れていれば例外', () => {
    expect(() => stateMapToStructureNbt(new Map([['1,2', 'stone']]))).toThrow(/座標キー/)
    expect(() => stateMapToStructureNbt(new Map([['1,2,x', 'stone']]))).toThrow(/座標キー/)
  })
})

describe('stateMapToStructureNbt: ファイル形式', () => {
  it('gzip されている (実機/litematica は非圧縮を読めない)', () => {
    const bytes = stateMapToStructureNbt(ELEVATOR)
    expect([bytes[0], bytes[1]]).toEqual([0x1f, 0x8b])
  })

  it('DataVersion が 1.21.1 (3955)', () => {
    const root = NbtFile.read(stateMapToStructureNbt(ELEVATOR)).root
    expect(root.getNumber('DataVersion')).toBe(3955)
    expect(root.has('entities')).toBe(true)
  })
})
