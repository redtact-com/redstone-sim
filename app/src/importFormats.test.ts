import { describe, it, expect } from 'vitest'
import {
  NbtFile, NbtCompound, NbtList, NbtInt, NbtString, NbtLongArray, NbtByteArray,
} from 'deepslate/nbt'
import { importFromNbtBytes } from './nbtIO'

// ============================================================
// 構造ファイルの形式判別と取り込み (#174)
//
// 判別と変換は `@taku128/java-schematic` に委譲している。ここで固定するのは
// **redstone-sim 側から見た結果**だけ:
//   - 各形式が実際にブロックとして読めること
//   - 未対応形式が**黙って 0 ブロックにならず**、日本語の理由が返ること
//   - 拡張子ではなく中身で判別していること
//
// ビットパックの展開やパレットの解釈といった形式内部の仕様はライブラリ側の
// 責務なので、こちらでは持たない (#172 で自前実装していた分)。
// ============================================================

type Vec = [number, number, number]

const gz = (name: string, root: NbtCompound): Uint8Array =>
  new NbtFile(name, root, 'gzip', false, undefined).write()

// ── litematic (Litematica) ───────────────────────────────────────────────────

/** 値列をビット幅 bits で long 配列へパックする */
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

const xyz = ([x, y, z]: Vec): NbtCompound =>
  new NbtCompound().set('x', new NbtInt(x)).set('y', new NbtInt(y)).set('z', new NbtInt(z))

/** 単一リージョンの litematic を組み立てる。palette[0] は air 固定 */
function litematic(position: Vec, size: Vec, palette: string[], indices: number[]): Uint8Array {
  const names = ['minecraft:air', ...palette]
  let bits = 2
  while (1 << bits < names.length) bits++
  const region = new NbtCompound()
    .set('Position', xyz(position))
    .set('Size', xyz(size))
    .set('BlockStatePalette', new NbtList<NbtCompound>(
      names.map(n => new NbtCompound().set('Name', new NbtString(n)))))
    .set('BlockStates', new NbtLongArray(
      packLongs(indices, bits).map(v => BigInt.asIntN(64, v))))
  return gz('', new NbtCompound()
    .set('Version', new NbtInt(6))
    .set('MinecraftDataVersion', new NbtInt(3700))
    .set('Metadata', new NbtCompound())
    .set('Regions', new NbtCompound().set('Unnamed', region)))
}

// ── .schem (WorldEdit Sponge) ────────────────────────────────────────────────

/**
 * Sponge v2 の .schem を組み立てる。
 * BlockData は varint 列で、並び順は index = x + z*Width + y*Width*Length。
 * パレットが 128 未満なら varint は 1 バイトなので添字をそのまま並べればよい。
 */
function schem(size: Vec, palette: string[], indices: number[]): Uint8Array {
  const [w, h, l] = size
  const paletteComp = new NbtCompound().set('minecraft:air', new NbtInt(0))
  palette.forEach((n, i) => paletteComp.set(n, new NbtInt(i + 1)))
  const root = new NbtCompound()
    .set('Version', new NbtInt(2))
    .set('DataVersion', new NbtInt(3700))
    .set('Width', new NbtInt(w)).set('Height', new NbtInt(h)).set('Length', new NbtInt(l))
    .set('Palette', paletteComp)
    .set('PaletteMax', new NbtInt(palette.length + 1))
    .set('BlockData', new NbtByteArray(indices))
  return gz('Schematic', root)   // root 名が "Schematic" であることが判別の条件
}

// ── テスト ───────────────────────────────────────────────────────────────────

/** 取り込み結果を "x,y,z" → BlockState.type の辞書にする */
async function importTypes(bytes: Uint8Array) {
  const r = await importFromNbtBytes(bytes, { gridW: 16, gridH: 16, maxLayers: 8 })
  const map: Record<string, string> = {}
  for (const [k, v] of r.blocks) map[k] = v.type
  return { map, warnings: r.warnings, size: r.size }
}

describe('litematic の取り込み (#174)', () => {
  it('ブロックとして読める', async () => {
    const { map, size } = await importTypes(litematic(
      [0, 0, 0], [2, 2, 2],
      ['minecraft:stone', 'minecraft:lever', 'minecraft:redstone_wire'],
      // index = y*sx*sz + z*sx + x
      [1, 0, 0, 2, 0, 3, 0, 0],
    ))
    expect(map).toEqual({ '0,0,0': 'solid', '1,0,1': 'lever', '1,1,0': 'wire' })
    expect(size).toEqual([2, 2, 2])
  })

  it('**Size が負の軸**を持つファイルも読める (実ファイルがこの形)', async () => {
    // 実ファイルと同じ Position.y=11 / Size.y=-12。最小コーナーは y=0
    const indices = new Array(12).fill(0)
    indices[0] = 1
    indices[11] = 1
    const { map } = await importTypes(litematic([0, 11, 0], [1, -12, 1], ['minecraft:stone'], indices))
    // 盤面の高さ上限 8 で上は切れるが、下端が y=0 から始まっていれば符号は正しい
    expect(map['0,0,0']).toBe('solid')
  })

  it('パレットが 4 件を超えてもずれない (ビット幅の切り上がり)', async () => {
    // names = air + 4 種 = 5 → ビット幅 3。2bit のままだと総崩れになる
    const palette = ['minecraft:stone', 'minecraft:lever', 'minecraft:redstone_wire', 'minecraft:redstone_lamp']
    const { map } = await importTypes(litematic([0, 0, 0], [4, 1, 1], palette, [1, 2, 3, 4]))
    expect(map).toEqual({ '0,0,0': 'solid', '1,0,0': 'lever', '2,0,0': 'wire', '3,0,0': 'lamp' })
  })
})

describe('.schem (WorldEdit) の取り込み (#174)', () => {
  it('ブロックとして読める (#172 では未対応だった)', async () => {
    // **litematic とは並び順が違う**: .schem は index = x + z*Width + y*Width*Length
    //   i=0 → (0,0,0) / i=3 → (1,0,1)
    const { map, size } = await importTypes(schem(
      [2, 2, 2],
      ['minecraft:stone', 'minecraft:lever'],
      [1, 0, 0, 2, 0, 0, 0, 0],
    ))
    expect(map).toEqual({ '0,0,0': 'solid', '1,0,1': 'lever' })
    expect(size).toEqual([2, 1, 2])
  })
})

describe('形式の判別 (#174)', () => {
  it('拡張子ではなく中身で判別する', async () => {
    // ファイル名を一切渡していないのに litematic / schem / 構造 NBT を読み分けている
    const asLitematic = await importTypes(litematic([0, 0, 0], [1, 1, 1], ['minecraft:stone'], [1]))
    const asSchem = await importTypes(schem([1, 1, 1], ['minecraft:stone'], [1]))
    expect(asLitematic.map).toEqual({ '0,0,0': 'solid' })
    expect(asSchem.map).toEqual({ '0,0,0': 'solid' })
  })

  it('Bedrock の .mcstructure は理由つきで弾く', async () => {
    const root = new NbtCompound()
      .set('format_version', new NbtInt(1))
      .set('structure', new NbtCompound())
    const { map, warnings } = await importTypes(gz('', root))
    expect(map).toEqual({})
    expect(warnings[0]).toContain('Bedrock')
  })

  it('旧 MCEdit の .schematic は理由つきで弾く', async () => {
    const root = new NbtCompound()
      .set('Blocks', new NbtByteArray([1]))
      .set('Data', new NbtByteArray([0]))
      .set('Width', new NbtInt(1)).set('Height', new NbtInt(1)).set('Length', new NbtInt(1))
    const { map, warnings } = await importTypes(gz('Schematic', root))
    expect(map).toEqual({})
    expect(warnings[0]).toContain('MCEdit')
  })

  it('判別できない NBT も黙って空にならない', async () => {
    const { map, warnings } = await importTypes(gz('', new NbtCompound().set('foo', new NbtInt(1))))
    expect(map).toEqual({})
    expect(warnings[0]).toContain('判別できませんでした')
  })

  it('NBT ですらないファイルでも例外を投げない', async () => {
    const notNbt = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])   // PNG ヘッダ
    const { map, warnings } = await importTypes(notNbt)
    expect(map).toEqual({})
    expect(warnings).toHaveLength(1)
  })
})
