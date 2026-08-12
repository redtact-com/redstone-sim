import { describe, it, expect } from 'vitest'
import {
  NbtFile, NbtCompound, NbtList, NbtInt, NbtString,
} from 'deepslate/nbt'
import type { BlockState } from '@redstone/sim'
import { exportToNbtBytes, importFromNbtBytes } from './nbtIO'

// ============================================================
// nbtIO: ボタン専用型の往復 (#54)
//
// 従来 *_button は import でレバー近似していたが、sim に button_stone /
// button_wood が実装されたため専用型で往復する。export は面 = floor 固定
// (stone_button / oak_button)、import は面情報を捨てて facing='up' に正規化。
// ============================================================

const GRID = 16

/** 単一ブロックを export → import して往復後の BlockState を得る */
function roundTrip(block: BlockState): BlockState | undefined {
  const src = new Map<string, BlockState>([['0,0,0', block]])
  const bytes = exportToNbtBytes(src, GRID, GRID)
  return importFromNbtBytes(bytes, { maxLayers: 8 }).blocks.get('0,0,0')
}

/** 任意の vanilla ブロック名 + props を持つ最小構造 NBT を組み立てて import する */
function importVanilla(name: string, props: Record<string, string> = {}): BlockState | undefined {
  const air = new NbtCompound().set('Name', new NbtString('minecraft:air'))
  const target = new NbtCompound().set('Name', new NbtString(name))
  if (Object.keys(props).length > 0) {
    const p = new NbtCompound()
    for (const [k, v] of Object.entries(props)) p.set(k, new NbtString(v))
    target.set('Properties', p)
  }
  const palette = new NbtList<NbtCompound>([air, target])
  const blockEntry = new NbtCompound()
    .set('state', new NbtInt(1))
    .set('pos', new NbtList<NbtInt>([new NbtInt(0), new NbtInt(0), new NbtInt(0)]))
  const root = new NbtCompound()
    .set('size', new NbtList<NbtInt>([new NbtInt(1), new NbtInt(1), new NbtInt(1)]))
    .set('palette', palette)
    .set('blocks', new NbtList<NbtCompound>([blockEntry]))
    .set('entities', new NbtList<NbtCompound>([]))
  const bytes = new NbtFile('', root, 'gzip', false, undefined).write()
  return importFromNbtBytes(bytes, { maxLayers: 8 }).blocks.get('0,0,0')
}

/**
 * palette[1] のブロックを pos 群に配置した構造 NBT を組み立てる。
 * size は内容を収める最小値を自動計算する (deepslate は size 外の pos を弾くため)。
 */
function buildStructure(name: string, positions: Array<[number, number, number]>): Uint8Array {
  const air = new NbtCompound().set('Name', new NbtString('minecraft:air'))
  const target = new NbtCompound().set('Name', new NbtString(name))
  const palette = new NbtList<NbtCompound>([air, target])
  const blocks = new NbtList<NbtCompound>(
    positions.map(([x, y, z]) =>
      new NbtCompound()
        .set('state', new NbtInt(1))
        .set('pos', new NbtList<NbtInt>([new NbtInt(x), new NbtInt(y), new NbtInt(z)]))
    )
  )
  const sx = Math.max(1, ...positions.map((p) => p[0] + 1))
  const sy = Math.max(1, ...positions.map((p) => p[1] + 1))
  const sz = Math.max(1, ...positions.map((p) => p[2] + 1))
  const root = new NbtCompound()
    .set('size', new NbtList<NbtInt>([new NbtInt(sx), new NbtInt(sy), new NbtInt(sz)]))
    .set('palette', palette)
    .set('blocks', blocks)
    .set('entities', new NbtList<NbtCompound>([]))
  return new NbtFile('', root, 'gzip', false, undefined).write()
}

describe('nbtIO: ボタン専用型の往復', () => {
  it('button_stone は往復しても button_stone (レバーにならない)', () => {
    expect(roundTrip({ type: 'button_stone', facing: 'up', powered: false }))
      .toMatchObject({ type: 'button_stone', facing: 'up', powered: false })
  })

  it('button_wood は往復しても button_wood', () => {
    expect(roundTrip({ type: 'button_wood', facing: 'up', powered: false }))
      .toMatchObject({ type: 'button_wood', facing: 'up', powered: false })
  })
})

describe('nbtIO: vanilla ボタン名 → 専用型 import', () => {
  it('stone_button / polished_blackstone_button は button_stone', () => {
    expect(importVanilla('minecraft:stone_button', { face: 'floor', facing: 'south', powered: 'false' }))
      .toMatchObject({ type: 'button_stone', facing: 'up', powered: false })
    expect(importVanilla('minecraft:polished_blackstone_button'))
      .toMatchObject({ type: 'button_stone', facing: 'up' })
  })

  it('oak_button / bamboo_button など木材系は button_wood', () => {
    expect(importVanilla('minecraft:oak_button')).toMatchObject({ type: 'button_wood', facing: 'up' })
    expect(importVanilla('minecraft:bamboo_button')).toMatchObject({ type: 'button_wood', facing: 'up' })
  })
})

describe('nbtIO: コンテナ / 重量板の既存往復が壊れていない', () => {
  it('container は barrel として export → container(signal=0) で import', () => {
    // signal は NBT に現れないため 0 で戻る
    expect(roundTrip({ type: 'container', signal: 5 }))
      .toMatchObject({ type: 'container', signal: 0 })
  })

  it('重量板(金)は往復後も専用型で powered=false に正規化される', () => {
    // pressedPower は現状 import 時に既定 15 へ戻る (entity 由来のため OFF 正規化)。
    // ここではボタン変更でこの既存挙動が壊れていないことを確認する。
    expect(roundTrip({ type: 'weighted_pressure_plate_light', pressedPower: 6, powered: true }))
      .toMatchObject({ type: 'weighted_pressure_plate_light', powered: false })
  })
})

describe('nbtIO: ホッパー / ドロッパーの往復 (#65)', () => {
  it('hopper は facing/enabled を保持し count=0 で戻る (中身は NBT に無い)', () => {
    expect(roundTrip({ type: 'hopper', facing: 'east', count: 12, enabled: true }))
      .toMatchObject({ type: 'hopper', facing: 'east', enabled: true, count: 0 })
  })

  it('dropper は facing/triggered を保持し count=0 で戻る', () => {
    expect(roundTrip({ type: 'dropper', facing: 'up', count: 5, triggered: false }))
      .toMatchObject({ type: 'dropper', facing: 'up', triggered: false, count: 0 })
  })

  it('vanilla hopper[facing=down] → hopper 型 import', () => {
    expect(importVanilla('minecraft:hopper', { enabled: 'true', facing: 'down' }))
      .toMatchObject({ type: 'hopper', facing: 'down', enabled: true })
  })

  it('vanilla dropper[facing=north,triggered=false] → dropper 型 import', () => {
    expect(importVanilla('minecraft:dropper', { facing: 'north', triggered: 'false' }))
      .toMatchObject({ type: 'dropper', facing: 'north', triggered: false })
  })
})

describe('nbtIO: bounds 検証と warnings 集約 (#97)', () => {
  it('盤面範囲外 (x/z) のブロックは省略され警告を返す', () => {
    // 16×16 グリッド外 (x=16, z=16) を含む 17×1×17 構造
    const bytes = buildStructure('minecraft:redstone_lamp', [
      [0, 0, 0], [15, 0, 15], [16, 0, 0], [0, 0, 16],
    ])
    const { blocks, warnings, size } = importFromNbtBytes(bytes, { gridW: 16, gridH: 16, maxLayers: 8 })
    expect(blocks.size).toBe(2) // (0,0,0) と (15,0,15) のみ
    expect(warnings.some((w) => w.includes('盤面範囲外') && w.includes('2'))).toBe(true)
    expect(size).toEqual([16, 1, 16]) // 取り込めた分の bounding box
  })

  it('高さ上限超過 (Y≥maxLayers) は省略され警告を返す', () => {
    const bytes = buildStructure('minecraft:redstone_lamp', [[0, 0, 0], [0, 8, 0], [0, 20, 0]])
    const { blocks, warnings } = importFromNbtBytes(bytes, { gridW: 16, gridH: 16, maxLayers: 8 })
    expect(blocks.size).toBe(1)
    expect(warnings.some((w) => w.includes('高さ上限') && w.includes('2'))).toBe(true)
  })

  it('非対応ブロックは種類ごとに集約して 1 警告にまとめる', () => {
    const bytes = buildStructure('minecraft:tnt', [[0, 0, 0], [1, 0, 0], [2, 0, 0]])
    const { blocks, warnings } = importFromNbtBytes(bytes, { gridW: 16, gridH: 16, maxLayers: 8 })
    expect(blocks.size).toBe(0)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('未対応ブロック 3 個')
    expect(warnings[0]).toContain('tnt')
  })

  it('全て範囲外/非対応なら blocks は空・size は [0,0,0]', () => {
    const bytes = buildStructure('minecraft:tnt', [[0, 0, 0]])
    const { blocks, size } = importFromNbtBytes(bytes, { gridW: 16, gridH: 16, maxLayers: 8 })
    expect(blocks.size).toBe(0)
    expect(size).toEqual([0, 0, 0])
  })

  it('air 亜種 (cave_air / void_air) は空セル扱いで無警告', () => {
    for (const air of ['minecraft:cave_air', 'minecraft:void_air']) {
      const bytes = buildStructure(air, [[0, 0, 0]])
      const { blocks, warnings } = importFromNbtBytes(bytes, { gridW: 16, gridH: 16, maxLayers: 8 })
      expect(blocks.size).toBe(0)
      expect(warnings).toHaveLength(0) // 未対応ブロック警告を出さない
    }
  })
})
