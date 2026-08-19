// ============================================================
// 実機ダンプ (blockstate 文字列の集合) → バニラ構造 NBT
//
// キャプチャ JSON の `authored` / `frames[].changes` は
// `"x,y,z" -> "name[k=v,...]"` (名前空間なし・プロパティキー昇順) の
// StateMap で、これを **sim を経由せずに** そのまま構造 NBT へ焼く。
//
// なぜ app/src/nbtIO.ts の `exportToNbtBytes` を使わないか:
//   あちらは sim の BlockState を経由するため、sim が型を持たない/潰している
//   ブロック — 塀・水・泡柱・ソウルサンド・磁鉄鉱・装飾・大釜・コンポスター —
//   が `blockStateToMinecraft` の default に落ちて **minecraft:air になる**。
//   エレベーターの要のブロックが消えるので実機の正解ファイルには使えない。
//   ここは name / props を素通しし、**書いた文字列がそのまま palette に載る**
//   ことだけを保証する (読み直しは app/src/nbtIO.ts の `readRawPlacedBlocks`)。
//
// 使う NBT 構造はバニラの構造ブロック形式:
//   { DataVersion, size: [Int×3], palette: [{Name, Properties?}],
//     blocks: [{state, pos: [Int×3], nbt?}], entities: [] }
// ============================================================

import {
  NbtFile, NbtCompound, NbtList, NbtInt, NbtString, NbtByte,
} from 'deepslate/nbt'
import { parseMcState } from '@redstone/sim'

/**
 * MC 1.21.1 の DataVersion。バニラ / litematica 側が版判定に使う。
 * ハーネスのサーバ (fixtures の `mcVersion`) と揃えてある。
 */
const DATA_VERSION = 3955

/** block entity の 1 スロット (キャプチャ JSON の `items[].slots[]` と同形) */
export interface StateMapItemSlot {
  slot: number
  /** アイテム ID。名前空間は付いていても付いていなくてもよい */
  id: string
  count: number
}

/** ある座標の block entity の中身 (キャプチャ JSON の `items[]` と同形) */
export interface StateMapItems {
  pos: [number, number, number]
  slots: StateMapItemSlot[]
}

/** `"x,y,z"` → 整数座標。壊れたキーは黙って捨てず例外にする */
function parsePosKey(key: string): [number, number, number] {
  const parts = key.split(',')
  if (parts.length !== 3) throw new Error(`座標キーが不正 ("x,y,z" でない): ${key}`)
  const nums = parts.map(p => Number(p.trim()))
  if (nums.some(n => !Number.isInteger(n))) throw new Error(`座標キーが整数でない: ${key}`)
  return nums as [number, number, number]
}

/** 名前空間を補う (StateMap もアイテム ID も名前空間なしで来る) */
function withNamespace(id: string): string {
  return id.includes(':') ? id : `minecraft:${id}`
}

/**
 * StateMap → バニラ構造 NBT (gzip 済みバイト列)。
 *
 * - 座標は**最小コーナーが原点**になるよう平行移動する (deepslate の `Structure`
 *   は size の外にあるブロックを読み込み時に例外にするため、負座標は残せない)。
 *   `items[].pos` は StateMap と同じ座標系として同じ量だけ寄せる。
 * - `size` は寄せたあとの範囲 (最大座標 + 1)。StateMap が空なら [0,0,0]。
 * - 出力順は座標の昇順で固定する (同じ入力から同じバイト列が出るように)。
 * - `"air"` も書いたとおりに palette に載せる (差分フレームの消滅を表せるように)。
 */
export function stateMapToStructureNbt(
  states: Map<string, string>,
  items: StateMapItems[] = [],
): Uint8Array {
  // 1. 座標をパースして昇順に並べる (出力を入力の挿入順に依存させない)
  const placed = [...states].map(([key, state]) => ({ pos: parsePosKey(key), state }))
  placed.sort((a, b) => (a.pos[0] - b.pos[0]) || (a.pos[1] - b.pos[1]) || (a.pos[2] - b.pos[2]))

  // 2. 最小コーナー (空なら原点)。
  //    `Math.min(...配列)` は **12.5 万件あたりでスタックを溢れさせる** (実測) ので使わない。
  //    実機ダンプは 50^3 でその規模に届く
  const origin: [number, number, number] = [0, 0, 0]
  if (placed.length > 0) {
    origin[0] = origin[1] = origin[2] = Number.POSITIVE_INFINITY
    for (const p of placed) {
      if (p.pos[0] < origin[0]) origin[0] = p.pos[0]
      if (p.pos[1] < origin[1]) origin[1] = p.pos[1]
      if (p.pos[2] < origin[2]) origin[2] = p.pos[2]
    }
  }
  const shift = (pos: [number, number, number]): [number, number, number] =>
    [pos[0] - origin[0], pos[1] - origin[1], pos[2] - origin[2]]

  // 3. palette (重複排除)。
  //    キーは「名前 + プロパティのキー昇順並べ替え」。**props をキーに含めないと
  //    別 blockstate が同じ palette 番号に潰れる** (向き違いのリピーターが同じ
  //    ブロックになる等) ので、正規化した文字列で引く
  const paletteIndex = new Map<string, number>()
  const paletteCompounds: NbtCompound[] = []
  const getOrAddPalette = (name: string, props: Record<string, string>): number => {
    const keys = Object.keys(props).sort()
    const key = `${name}|${keys.map(k => `${k}=${props[k]}`).join(',')}`
    const hit = paletteIndex.get(key)
    if (hit !== undefined) return hit
    const idx = paletteCompounds.length
    paletteIndex.set(key, idx)
    const comp = new NbtCompound().set('Name', new NbtString(name))
    if (keys.length > 0) {
      const propsComp = new NbtCompound()
      for (const k of keys) propsComp.set(k, new NbtString(props[k]))
      comp.set('Properties', propsComp)
    }
    paletteCompounds.push(comp)
    return idx
  }

  // 4. items を寄せた座標で引けるようにする
  // (座標が壊れていれば下の孤児チェックで落ちる)
  const itemsByPos = new Map<string, StateMapItemSlot[]>()
  for (const entry of items) {
    const key = shift(entry.pos).join(',')
    // 同じコンテナが 2 回書かれていたら後勝ちで黙って上書きしない (中身が消える)
    if (itemsByPos.has(key)) throw new Error(`items に同じ座標が 2 回ある: ${entry.pos.join(',')}`)
    itemsByPos.set(key, entry.slots)
  }

  // 5. blocks
  const blockCompounds: NbtCompound[] = []
  let maxX = 0, maxY = 0, maxZ = 0
  for (const { pos, state } of placed) {
    const { name, props } = parseMcState(state)
    const qualified = withNamespace(name)
    const [x, y, z] = shift(pos)
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
    if (z > maxZ) maxZ = z

    const comp = new NbtCompound()
      .set('state', new NbtInt(getOrAddPalette(qualified, props)))
      .set('pos', new NbtList<NbtInt>([new NbtInt(x), new NbtInt(y), new NbtInt(z)]))

    const key = `${x},${y},${z}`
    const slots = itemsByPos.get(key)
    if (slots) {
      const nbt = containerNbt(qualified, slots)
      if (nbt) comp.set('nbt', nbt)
      itemsByPos.delete(key)
    }
    blockCompounds.push(comp)
  }

  // items にブロックの無い座標があれば座標系の解釈違いなので黙って捨てない
  if (itemsByPos.size > 0) {
    const orphans = [...itemsByPos.keys()].join(' / ')
    throw new Error(`items の座標に対応するブロックがない (原点を寄せた後の座標): ${orphans}`)
  }

  const root = new NbtCompound()
    .set('DataVersion', new NbtInt(DATA_VERSION))
    .set('size', new NbtList<NbtInt>(placed.length === 0
      ? [new NbtInt(0), new NbtInt(0), new NbtInt(0)]
      : [new NbtInt(maxX + 1), new NbtInt(maxY + 1), new NbtInt(maxZ + 1)]))
    .set('palette', new NbtList<NbtCompound>(paletteCompounds))
    .set('blocks', new NbtList<NbtCompound>(blockCompounds))
    .set('entities', new NbtList<NbtCompound>([]))

  // バニラの構造ファイルは gzip 済み。**非圧縮のままだと実機/litematica が読めない**
  // (deepslate は非圧縮も読めてしまうので、往復テストだけでは検出できない)
  return new NbtFile('', root, 'gzip', false, undefined).write()
}

/**
 * コンテナの中身 → block entity NBT。
 * 形式は 1.20.5 以降の `{ Slot: Byte, id: String, count: Int }`
 * (app/src/nbtIO.ts の `containerNbt` / `readItems` と同じ)。
 * 個数 0 以下のスロットは書かない。書くものが無ければ undefined。
 */
function containerNbt(blockName: string, slots: StateMapItemSlot[]): NbtCompound | undefined {
  const entries = slots
    .filter(s => s.count > 0)
    .map(s => new NbtCompound()
      .set('Slot', new NbtByte(s.slot))
      .set('id', new NbtString(withNamespace(s.id)))
      .set('count', new NbtInt(s.count)))
  if (entries.length === 0) return undefined
  return new NbtCompound()
    .set('id', new NbtString(blockName))
    .set('Items', new NbtList<NbtCompound>(entries))
}
