import { describe, it, expect } from 'vitest'
import {
  NbtFile, NbtCompound, NbtList, NbtInt, NbtString, NbtLongArray,
} from 'deepslate/nbt'
import { isLitematicRoot, readLitematicBlocks } from './litematic'
import { importFromNbtBytes } from './nbtIO'

// ============================================================
// litematic (Litematica 形式) の読み取り (#172)
//
// 実ファイルは `.litematic` を選んでも**警告すら出ずに 0 ブロック**になっていた。
// バニラ構造 NBT と中身が全く違い、`Structure.fromNbt` が何も返さないため。
//
// 落とし穴が 3 つあるのでそれぞれ固定する:
//   1. パレット添字が **64bit long 境界をまたいで**パックされている
//   2. `Size` が**軸ごとに負になりうる** (Position から負方向へ伸びる)
//   3. リージョンが複数あり、Position が負にもなる
// ============================================================

type Vec = [number, number, number]

/** 値列をビット幅 bits で long 配列へパックする (読み取り側と対になる実装) */
function packLongs(values: number[], bits: number): bigint[] {
  const longs = new Array<bigint>(Math.ceil((values.length * bits) / 64)).fill(0n)
  values.forEach((v, i) => {
    const start = i * bits
    const lo = start >>> 6
    const hi = (start + bits - 1) >>> 6
    const off = BigInt(start & 63)
    const val = BigInt(v)
    longs[lo] = BigInt.asUintN(64, longs[lo] | (val << off))
    if (hi !== lo) longs[hi] = BigInt.asUintN(64, longs[hi] | (val >> (64n - off)))
  })
  return longs
}

function vec(name: string, [x, y, z]: Vec): NbtCompound {
  return new NbtCompound()
    .set('x', new NbtInt(x)).set('y', new NbtInt(y)).set('z', new NbtInt(z))
    .set('__name', new NbtString(name))
}

interface RegionSpec {
  name?: string
  position: Vec
  /** 軸ごとに負でもよい */
  size: Vec
  /** palette[0] は air 固定。ここには 1 番以降のブロック名を渡す */
  palette: string[]
  /** セルごとのパレット添字。順序は index = y*sx*sz + z*sx + x */
  indices: number[]
  /** ビット幅を明示したいとき (既定は max(2, パレット長を表せる最小)) */
  bits?: number
  /** 末尾を削って壊れたファイルを作るとき */
  truncateLongs?: number
}

/** litematic の root NbtCompound を組み立てる */
function buildLitematic(regions: RegionSpec[]): NbtCompound {
  const regionsComp = new NbtCompound()
  regions.forEach((spec, i) => {
    const names = ['minecraft:air', ...spec.palette]
    let bits = spec.bits ?? 2
    if (spec.bits === undefined) while (1 << bits < names.length) bits++

    const paletteList = new NbtList<NbtCompound>(
      names.map((n) => new NbtCompound().set('Name', new NbtString(n)))
    )
    let longs = packLongs(spec.indices, bits)
    if (spec.truncateLongs !== undefined) longs = longs.slice(0, spec.truncateLongs)

    regionsComp.set(spec.name ?? `region${i}`, new NbtCompound()
      .set('Position', vec('Position', spec.position))
      .set('Size', vec('Size', spec.size))
      .set('BlockStatePalette', paletteList)
      .set('BlockStates', new NbtLongArray(longs.map((v) => BigInt.asIntN(64, v)))))
  })
  return new NbtCompound()
    .set('Version', new NbtInt(6))
    .set('MinecraftDataVersion', new NbtInt(3700))
    .set('Metadata', new NbtCompound())
    .set('Regions', regionsComp)
}

/** 読み取り結果を "x,y,z" → ブロック名 の辞書にする */
function asMap(root: NbtCompound): Record<string, string> {
  const out: Record<string, string> = {}
  for (const b of readLitematicBlocks(root)) {
    out[b.pos.join(',')] = b.name.replace('minecraft:', '')
  }
  return out
}

describe('litematic の形式判定 (#172)', () => {
  it('Regions を持つ root は litematic', () => {
    expect(isLitematicRoot(buildLitematic([{
      position: [0, 0, 0], size: [1, 1, 1], palette: ['minecraft:stone'], indices: [1],
    }]))).toBe(true)
  })

  it('バニラ構造 NBT の root は litematic ではない', () => {
    const root = new NbtCompound()
      .set('size', new NbtList<NbtInt>([new NbtInt(1), new NbtInt(1), new NbtInt(1)]))
      .set('palette', new NbtList<NbtCompound>([]))
      .set('blocks', new NbtList<NbtCompound>([]))
    expect(isLitematicRoot(root)).toBe(false)
  })
})

describe('litematic のビットパック展開 (#172)', () => {
  it('index = y*sx*sz + z*sx + x の順で並ぶ', () => {
    // 2×2×2。air 以外を 4 隅に置いて XYZ の割り当てを固定する
    const root = buildLitematic([{
      position: [0, 0, 0], size: [2, 2, 2],
      palette: ['minecraft:stone', 'minecraft:oak_planks', 'minecraft:glass'],
      //        y=0                 y=1
      //        z=0     z=1         z=0     z=1
      //        x0 x1   x0 x1       x0 x1   x0 x1
      indices: [1, 0,   0, 2,       0, 3,   0, 0],
    }])
    expect(asMap(root)).toEqual({
      '0,0,0': 'stone',
      '1,0,1': 'oak_planks',
      '1,1,0': 'glass',
    })
  })

  it('air は結果に含めない', () => {
    const root = buildLitematic([{
      position: [0, 0, 0], size: [4, 1, 1],
      palette: ['minecraft:stone'], indices: [0, 1, 0, 0],
    }])
    expect(Object.keys(asMap(root))).toEqual(['1,0,0'])
  })

  it('**64bit 境界をまたぐ**エントリも正しく読める', () => {
    // パレット 32 件 → ビット幅 5。index 12 が bit 60-64 で long をまたぐ。
    // またぎを無視しても下位ビットだけで正解してしまわないよう、
    // **全セルの添字の最上位ビットを立てる** (16..31 を使う)
    const palette = Array.from({ length: 31 }, (_, i) => `minecraft:p${i}`)
    const indices = Array.from({ length: 16 }, (_, i) => 16 + i)   // 16..31
    const root = buildLitematic([{
      position: [0, 0, 0], size: [16, 1, 1], palette, indices,
    }])
    const map = asMap(root)
    for (let i = 0; i < 16; i++) {
      expect(map[`${i},0,0`], `index ${i} (bit ${i * 5}-${i * 5 + 4})`).toBe(`p${15 + i}`)
    }
  })

  it('ビット幅の下限は 2 (パレット 2 件でも 1bit にはしない)', () => {
    // bits=2 で 32 セル = long 1 本ぴったり。1bit で読むと総崩れになる
    const indices = Array.from({ length: 32 }, (_, i) => (i % 2 === 0 ? 1 : 0))
    const root = buildLitematic([{
      position: [0, 0, 0], size: [32, 1, 1], palette: ['minecraft:stone'], indices,
    }])
    const map = asMap(root)
    expect(Object.keys(map)).toHaveLength(16)
    expect(map['0,0,0']).toBe('stone')
    expect(map['30,0,0']).toBe('stone')
  })

  it('データが足りない壊れたファイルでは読める分だけ返す (例外にしない)', () => {
    const root = buildLitematic([{
      position: [0, 0, 0], size: [64, 1, 1],
      palette: ['minecraft:stone'],
      indices: Array.from({ length: 64 }, () => 1),
      truncateLongs: 1,   // 2 本必要なところを 1 本に削る
    }])
    const map = asMap(root)
    expect(Object.keys(map)).toHaveLength(32)   // bits=2 → long 1 本で 32 セル
  })
})

describe('litematic の負サイズ (#172)', () => {
  // **単一リージョンでは符号の扱いを間違えても結果が変わらない** (全体が同じだけ
  // ずれ、最後に最小コーナーへ正規化されて打ち消される)。ずれが観測できるのは
  // 基準の違うリージョンが同居したときだけなので、必ず 2 つ並べて確かめる。

  it('Size が負の軸は Position から負方向へ伸びる (基準リージョンと揃う)', () => {
    // 実ファイルと同じ形: Position.y=11 / Size.y=-12 → 最小コーナーは y=0。
    // 符号を無視すると y=11 始まりと解釈され、下の基準リージョンから 11 ずれる
    const tall = new Array(12).fill(0)
    tall[0] = 1     // 配列 y=0
    tall[11] = 1    // 配列 y=11
    const root = buildLitematic([
      { name: 'anchor', position: [0, 0, 0], size: [1, 1, 1], palette: ['minecraft:stone'], indices: [1] },
      { name: 'neg', position: [2, 11, 0], size: [1, -12, 1], palette: ['minecraft:oak_planks'], indices: tall },
    ])
    expect(asMap(root)).toEqual({
      '0,0,0': 'stone',
      '2,0,0': 'oak_planks',    // 配列 y=0 は最小コーナー = 世界 y=0
      '2,11,0': 'oak_planks',   // 配列 y=11 は世界 y=11
    })
  })

  it('X / Z が負でも同じ (最小コーナーが原点に来る)', () => {
    const root = buildLitematic([
      { name: 'anchor', position: [0, 0, 0], size: [1, 1, 1], palette: ['minecraft:stone'], indices: [1] },
      // min corner x = 4 + (-5) + 1 = 0。配列 x=0 がそこに来る
      { name: 'neg', position: [4, 0, 2], size: [-5, 1, 1], palette: ['minecraft:oak_planks'], indices: [1, 0, 0, 0, 1] },
    ])
    expect(asMap(root)).toEqual({
      '0,0,0': 'stone',
      '0,0,2': 'oak_planks',
      '4,0,2': 'oak_planks',
    })
  })

  it('サイズ 0 の軸を持つリージョンは無視する', () => {
    const root = buildLitematic([{
      position: [0, 0, 0], size: [0, 1, 1], palette: ['minecraft:stone'], indices: [],
    }])
    expect(readLitematicBlocks(root)).toEqual([])
  })
})

describe('litematic の複数リージョン (#172)', () => {
  it('全体の最小コーナーが原点 (0,0,0) になるよう揃える', () => {
    const root = buildLitematic([
      { name: 'a', position: [-3, 0, 0], size: [1, 1, 1], palette: ['minecraft:stone'], indices: [1] },
      { name: 'b', position: [2, 4, 1], size: [1, 1, 1], palette: ['minecraft:oak_planks'], indices: [1] },
    ])
    // base = (-3, 0, 0) → a は原点、b は (5, 4, 1)
    expect(asMap(root)).toEqual({ '0,0,0': 'stone', '5,4,1': 'oak_planks' })
  })

  it('リージョンごとに別のパレット・別のビット幅を持てる', () => {
    const many = Array.from({ length: 40 }, (_, i) => `minecraft:q${i}`)
    const root = buildLitematic([
      { name: 'small', position: [0, 0, 0], size: [1, 1, 1], palette: ['minecraft:stone'], indices: [1] },
      { name: 'big', position: [10, 0, 0], size: [1, 1, 1], palette: many, indices: [40] },
    ])
    expect(asMap(root)).toEqual({ '0,0,0': 'stone', '10,0,0': 'q39' })
  })
})

describe('litematic の取り込み経路 (#172)', () => {
  it('importFromNbtBytes が形式を自動判別して BlockState に変換する', () => {
    const root = buildLitematic([{
      position: [0, 0, 0], size: [3, 1, 1],
      palette: ['minecraft:stone', 'minecraft:lever', 'minecraft:redstone_wire'],
      indices: [1, 2, 3],
    }])
    const bytes = new NbtFile('', root, 'gzip', false, undefined).write()
    const result = importFromNbtBytes(bytes, { gridW: 16, gridH: 16, maxLayers: 8 })
    expect(result.blocks.get('0,0,0')).toMatchObject({ type: 'solid' })
    expect(result.blocks.get('1,0,0')).toMatchObject({ type: 'lever' })
    expect(result.blocks.get('2,0,0')).toMatchObject({ type: 'wire' })
    expect(result.size).toEqual([3, 1, 1])
    expect(result.warnings).toEqual([])
  })

  it('未対応形式は黙らずに理由を警告として返す (.schem)', () => {
    // WorldEdit Sponge v2 の最小形。以前はこれが**警告すら出ずに 0 ブロック**だった
    const root = new NbtCompound()
      .set('Version', new NbtInt(2))
      .set('Width', new NbtInt(1)).set('Height', new NbtInt(1)).set('Length', new NbtInt(1))
      .set('BlockData', new NbtList<NbtInt>([new NbtInt(0)]))
    const bytes = new NbtFile('', root, 'gzip', false, undefined).write()
    const result = importFromNbtBytes(bytes, {})
    expect(result.blocks.size).toBe(0)
    expect(result.warnings[0]).toContain('.schem')
  })

  it('どの形式でもないファイルも黙らない', () => {
    const bytes = new NbtFile('', new NbtCompound(), 'gzip', false, undefined).write()
    expect(importFromNbtBytes(bytes, {}).warnings[0]).toContain('対応形式')
  })

  it('盤面に載らない分は従来どおり警告になる (0 ブロックで黙らない)', () => {
    const root = buildLitematic([{
      position: [0, 0, 0], size: [1, 10, 1],
      palette: ['minecraft:stone'], indices: new Array(10).fill(1),
    }])
    const bytes = new NbtFile('', root, 'gzip', false, undefined).write()
    const result = importFromNbtBytes(bytes, { gridW: 16, gridH: 16, maxLayers: 8 })
    expect(result.blocks.size).toBe(8)
    expect(result.warnings).toEqual(['高さ上限 (Y≥8) 超過で 2 ブロックを省略'])
  })
})
