import { describe, it, expect } from 'vitest'
import {
  NbtFile, NbtCompound, NbtList, NbtInt, NbtString, NbtLongArray, NbtByteArray,
} from 'deepslate/nbt'
import { effectiveContainerSignal } from '@redstone/sim'
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

// ============================================================
// litematic のコンテナ中身 (#197)
//
// `@taku128/java-schematic` の変換は block entity を落とすため、litematic の
// `Regions.<name>.TileEntities` を元ファイルから直接読んで貼り直している。
// **座標系 (負サイズのリージョン・複数リージョン) を取り違えると別のブロックに
// 貼ってしまう**ので、貼り先がコンテナかを確認し、外れたら警告に出す。
// ============================================================

interface LiteRegion {
  name?: string
  position: Vec
  size: Vec
  palette: string[]
  indices: number[]
  tiles?: { pos: Vec; id: string; items: { slot: number; id: string; count: number }[] }[]
}

/** TileEntities つきの litematic (単一リージョン) */
function litematicWithItems(
  position: Vec, size: Vec, palette: string[], indices: number[],
  tiles: { pos: Vec; id: string; items: { slot: number; id: string; count: number }[] }[],
): Uint8Array {
  return litematicRegions([{ position, size, palette, indices, tiles }])
}

/** 複数リージョンの litematic。負サイズの検証には**基準リージョンを並べる**のが要る */
function litematicRegions(regions: LiteRegion[]): Uint8Array {
  const comp = new NbtCompound()
  regions.forEach((r, i) => comp.set(r.name ?? `R${i}`, buildLiteRegion(r)))
  return gz('', new NbtCompound()
    .set('Version', new NbtInt(6))
    .set('MinecraftDataVersion', new NbtInt(3700))
    .set('Metadata', new NbtCompound())
    .set('Regions', comp))
}

function buildLiteRegion({ position, size, palette, indices, tiles = [] }: LiteRegion): NbtCompound {
  const names = ['minecraft:air', ...palette]
  let bits = 2
  while (1 << bits < names.length) bits++
  const teList = new NbtList<NbtCompound>(tiles.map(t => {
    const c = new NbtCompound()
      .set('x', new NbtInt(t.pos[0])).set('y', new NbtInt(t.pos[1])).set('z', new NbtInt(t.pos[2]))
      .set('id', new NbtString(t.id))
    c.set('Items', new NbtList<NbtCompound>(t.items.map(i =>
      new NbtCompound()
        .set('Slot', new NbtInt(i.slot))
        .set('id', new NbtString(i.id))
        .set('count', new NbtInt(i.count)))))
    return c
  }))
  return new NbtCompound()
    .set('Position', xyz(position))
    .set('Size', xyz(size))
    .set('BlockStatePalette', new NbtList<NbtCompound>(
      names.map(n => new NbtCompound().set('Name', new NbtString(n)))))
    .set('BlockStates', new NbtLongArray(
      packLongs(indices, bits).map(v => BigInt.asIntN(64, v))))
    .set('TileEntities', teList)
}

describe('litematic のコンテナ中身 (#197)', () => {
  const HOPPER = 'minecraft:hopper'

  it('ホッパーの中身を取り込む (変換で落ちる分を元ファイルから補う)', async () => {
    const bytes = litematicWithItems([0, 0, 0], [2, 1, 1], [HOPPER], [1, 0], [
      { pos: [0, 0, 0], id: HOPPER, items: [
        { slot: 0, id: 'minecraft:player_head', count: 11 },
        { slot: 1, id: 'minecraft:snowball', count: 3 },
      ] },
    ])
    const r = await importFromNbtBytes(bytes, { gridW: 16, gridH: 16, maxLayers: 16 })
    const h = r.blocks.get('0,0,0') as { slots: readonly ({ id: string; stack: number; count: number } | null)[] }
    expect(h.slots[0]).toMatchObject({ id: 'player_head', stack: 64, count: 11 })
    expect(h.slots[1]).toMatchObject({ id: 'snowball', stack: 16, count: 3 })
    expect(r.warnings).toEqual([])
  })

  it('**強度が実機と同じ 2 になる** (混載の要点)', async () => {
    const bytes = litematicWithItems([0, 0, 0], [1, 1, 1], [HOPPER], [1], [
      { pos: [0, 0, 0], id: HOPPER, items: [
        { slot: 0, id: 'minecraft:player_head', count: 11 },
        { slot: 1, id: 'minecraft:snowball', count: 3 },
      ] },
    ])
    const r = await importFromNbtBytes(bytes, { gridW: 16, gridH: 16, maxLayers: 16 })
    expect(effectiveContainerSignal(r.blocks.get('0,0,0') as never)).toBe(2)
  })

  it('**Size が負のリージョン**でも正しい位置に貼る', async () => {
    // #172 と同じ罠: 単一リージョンだと符号を間違えても最小コーナー正規化で
    // 打ち消され結果が変わらない。**基準リージョンを並べて相対位置で検証する**
    const bytes = litematicRegions([
      // 基準: x=0 に石 (最小コーナー 0,0,0)
      { position: [0, 0, 0], size: [1, 1, 1], palette: ['minecraft:stone'], indices: [1] },
      // 検証対象: Position.y=3 / Size.y=-3 → 最小コーナーは y=1
      {
        position: [2, 3, 0], size: [1, -3, 1], palette: [HOPPER], indices: [1, 1, 1],
        // TileEntity 座標は**リージョン相対** (最小コーナー基準の 0 始まり)
        tiles: [{ pos: [0, 0, 0], id: HOPPER, items: [{ slot: 0, id: 'minecraft:snowball', count: 5 }] }],
      },
    ])
    const r = await importFromNbtBytes(bytes, { gridW: 16, gridH: 16, maxLayers: 16 })
    // 最小コーナー正規化後、ホッパーは x=2 / y=1..3 に並ぶ。TileEntity は y=1 のもの
    const at = (k: string) => (r.blocks.get(k as never) as
      { slots?: readonly ({ count: number } | null)[] } | undefined)?.slots?.filter(Boolean) ?? []
    // 最小コーナー (y=1) のホッパーにだけ入り、他の 2 つは空であること。
    // **「他が空」まで見ないと補正を外しても通ってしまう** (ずれ先も同じホッパー種のため)
    expect(at('2,1,0'), '最小コーナーのホッパーに入っていない').toMatchObject([{ count: 5 }])
    expect(at('2,2,0'), 'ずれて別のホッパーに入っている').toEqual([])
    expect(at('2,3,0'), 'ずれて別のホッパーに入っている').toEqual([])
    expect(r.warnings).toEqual([])
  })

  it('貼り先がコンテナでなければ**黙って捨てず警告する**', async () => {
    // TileEntity の座標が石を指している = 座標系の解釈がずれている状況
    const bytes = litematicWithItems([0, 0, 0], [2, 1, 1], ['minecraft:stone'], [1, 1], [
      { pos: [0, 0, 0], id: HOPPER, items: [{ slot: 0, id: 'minecraft:snowball', count: 1 }] },
    ])
    const r = await importFromNbtBytes(bytes, { gridW: 16, gridH: 16, maxLayers: 16 })
    expect(r.warnings.some(w => w.includes('対応付けられませんでした'))).toBe(true)
  })

  it('TileEntities が無い litematic は従来どおり', async () => {
    const bytes = litematicWithItems([0, 0, 0], [1, 1, 1], [HOPPER], [1], [])
    const r = await importFromNbtBytes(bytes, { gridW: 16, gridH: 16, maxLayers: 16 })
    const h = r.blocks.get('0,0,0') as { slots: readonly unknown[] }
    expect(h.slots.every(s => s === null)).toBe(true)
    expect(r.warnings).toEqual([])
  })
})
