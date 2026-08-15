/**
 * Litematica (.litematic) の読み取り (#172)
 *
 * Litematica MOD の保存形式。回路作品の共有で最も使われている形式だが、
 * バニラ構造 NBT (`size` / `palette` / `blocks`) とは中身が全く違うため
 * `Structure.fromNbt` では何も読めない (**エラーにもならず 0 ブロックになる**)。
 *
 * root の構造:
 *
 *   MinecraftDataVersion, Version, SubVersion
 *   Metadata { EnclosingSize, Name, Author, ... }
 *   Regions {
 *     "<リージョン名>" {
 *       Position          … スキマティック原点からのリージョン基準点
 *       Size              … リージョンの広がり。**軸ごとに負になりうる**
 *       BlockStatePalette … [{ Name, Properties }] のリスト
 *       BlockStates       … パレット添字をビットパックした long 配列
 *       TileEntities / Entities / PendingBlockTicks / PendingFluidTicks
 *     }
 *   }
 *
 * ここでは BlockStatePalette + BlockStates だけを見る (中身やエンティティは
 * sim に対応する概念が無い)。
 */

import type { NbtCompound } from 'deepslate/nbt'

/** 形式によらない「置かれた 1 ブロック」。バニラ構造の読み取り結果と同じ形 */
export interface RawPlacedBlock {
  pos: [number, number, number]
  name: string
  props: Record<string, string>
}

/** root が litematic か (バニラ構造 NBT に `Regions` は無い) */
export function isLitematicRoot(root: NbtCompound): boolean {
  return root.get('Regions') !== undefined
}

/**
 * BlockStates のビット幅。
 *
 * パレット長を表現できる最小ビット数だが、**下限が 2**。
 * (vanilla の `Integer.SIZE - numberOfLeadingZeros(size - 1)` 相当を
 *  浮動小数を通さずに求める)
 */
function bitsForPalette(paletteLength: number): number {
  let bits = 2
  while (1 << bits < paletteLength) bits++
  return bits
}

/**
 * リージョンの最小コーナー (= 配列添字 0 が指すブロック) を求める。
 *
 * `Size` は「Position からどちら向きにどれだけ伸びるか」で、**負になりうる**。
 * 負のときは Position から負方向へ伸びるので、終端は `Position + Size + 1`。
 * 配列は常に最小コーナーから + 方向へ並んでいる。
 */
function minCorner(position: number, size: number): number {
  return size < 0 ? position + size + 1 : position
}

/** long 配列からビット幅 bits の index 番目の値を取り出す (**64bit 境界をまたぐ**) */
function unpack(longs: BigUint64Array, index: number, bits: number, mask: bigint): number {
  const startOffset = index * bits
  const startArr = startOffset >>> 6
  const endArr = (startOffset + bits - 1) >>> 6
  const startBit = BigInt(startOffset & 63)
  if (startArr === endArr) {
    return Number((longs[startArr] >> startBit) & mask)
  }
  // またぐときは下位ワードの上側と上位ワードの下側を合成する
  const lower = longs[startArr] >> startBit
  const upper = longs[endArr] << (64n - startBit)
  return Number((lower | upper) & mask)
}

/**
 * litematic の root から全リージョンのブロックを取り出す。
 *
 * 座標は**スキマティック全体の最小コーナーを原点 (0,0,0)** に揃える
 * (バニラ構造 NBT の pos が 0 始まりなのに合わせるため)。air は含めない。
 */
export function readLitematicBlocks(root: NbtCompound): RawPlacedBlock[] {
  const regions = root.getCompound('Regions')

  // 1 周目: 各リージョンの最小コーナーを求め、全体の原点を決める
  const parsed: Array<{
    origin: [number, number, number]
    size: [number, number, number]
    palette: Array<{ name: string; props: Record<string, string> }>
    longs: BigUint64Array
  }> = []
  let baseX = Infinity, baseY = Infinity, baseZ = Infinity

  for (const regionName of regions.keys()) {
    const region = regions.getCompound(regionName)
    const pos = region.getCompound('Position')
    const size = region.getCompound('Size')
    const sx = size.getNumber('x'), sy = size.getNumber('y'), sz = size.getNumber('z')
    if (sx === 0 || sy === 0 || sz === 0) continue

    const ox = minCorner(pos.getNumber('x'), sx)
    const oy = minCorner(pos.getNumber('y'), sy)
    const oz = minCorner(pos.getNumber('z'), sz)

    const paletteList = region.getList('BlockStatePalette', 10)
    const palette = paletteList.map((entry) => {
      const props: Record<string, string> = {}
      const p = entry.getCompound('Properties')
      for (const k of p.keys()) props[k] = p.getString(k)
      return { name: entry.getString('Name'), props }
    })
    if (palette.length === 0) continue

    const raw = region.getLongArray('BlockStates')
    const longs = new BigUint64Array(raw.length)
    for (let i = 0; i < raw.length; i++) {
      longs[i] = BigInt.asUintN(64, raw.get(i)!.toBigInt())
    }

    parsed.push({
      origin: [ox, oy, oz],
      size: [Math.abs(sx), Math.abs(sy), Math.abs(sz)],
      palette,
      longs,
    })
    if (ox < baseX) baseX = ox
    if (oy < baseY) baseY = oy
    if (oz < baseZ) baseZ = oz
  }

  if (parsed.length === 0) return []

  // 2 周目: ビットパックを展開して絶対座標へ置く
  const out: RawPlacedBlock[] = []
  for (const { origin, size, palette, longs } of parsed) {
    const [sx, sy, sz] = size
    const bits = bitsForPalette(palette.length)
    const mask = (1n << BigInt(bits)) - 1n
    const layer = sx * sz
    // データが足りない壊れたファイルで範囲外を読まないよう、読める分に切る
    const volume = Math.min(sx * sy * sz, Math.floor((longs.length * 64) / bits))

    for (let index = 0; index < volume; index++) {
      const paletteIndex = unpack(longs, index, bits, mask)
      const entry = palette[paletteIndex]
      // air は最頻値なのでここで弾く (呼び出し側の未対応警告にも載せない)
      if (entry === undefined || entry.name === 'minecraft:air') continue

      const y = (index / layer) | 0
      const rem = index - y * layer
      const z = (rem / sx) | 0
      const x = rem - z * sx

      out.push({
        pos: [origin[0] + x - baseX, origin[1] + y - baseY, origin[2] + z - baseZ],
        name: entry.name,
        props: entry.props,
      })
    }
  }
  return out
}
