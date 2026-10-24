/**
 * 簡易表示 (#395)。blockstates / models の JSON がどこからも取れないときに、
 * 全ブロックを**単色の立方体**で描くためのリソースを作る。
 *
 * 単色の立方体は 3 つでできる。
 * - blockstate `{ variants: { "": { model: "redstone-sim:solid/<名前>" } } }`。
 *   variant `""` はどのプロパティにも当たる (deepslate の一致判定は `props[""] === undefined`)
 * - 6 面の立方体モデル (面ごとに cullface 付き。隣が不透明なら隠れる)
 * - アトラスに名前ごとに作る単色のスロット
 *
 * 形は再現しない (全部立方体にする)。取れるようになったら自動で差し替える再試行もしない。
 * 色は自分で決めた色で、テクスチャから抜き出した色ではない (ip-policy §2)。
 */

import {
  BlockDefinition,
  BlockModel,
  TextureAtlas,
  type Resources,
} from 'deepslate/render'
import type { Identifier } from 'deepslate/core'
import { getBlockFlags } from './blockFlags'
import { addSpecialRendererTextures } from './texturePaths'
import { buildAtlas32 } from './atlasUtils'

/** 単色の立方体のモデルとテクスチャの名前空間。バニラの名前とぶつけない */
export const SOLID_NAMESPACE = 'redstone-sim'

/** 形を持たないので簡易表示でも描かないもの */
const INVISIBLE = new Set(['air', 'cave_air', 'void_air', 'structure_void', 'barrier', 'light'])

/** `redstone-sim:solid/<名前>`。モデルとテクスチャの両方の id に使う */
export function solidId(name: string): string {
  return `${SOLID_NAMESPACE}:solid/${name}`
}

/** どのプロパティでも単色の立方体になる blockstate */
export function solidBlockStateJson(name: string) {
  return { variants: { '': { model: solidId(name) } } }
}

/** 6 面の立方体。面は全部 `solidId(name)` の単色 */
export function solidModelJson(name: string) {
  const face = (cullface: string) => ({ texture: '#all', cullface })
  return {
    textures: { all: solidId(name), particle: solidId(name) },
    elements: [{
      from: [0, 0, 0],
      to: [16, 16, 16],
      faces: {
        down: face('down'),
        up: face('up'),
        north: face('north'),
        south: face('south'),
        west: face('west'),
        east: face('east'),
      },
    }],
  }
}

/**
 * 手で決める色。名前がこれと同じか `<これ>_` で始まれば使う
 * (`redstone_lamp_on` → `redstone_lamp`、`glass_pane` → `glass`)。
 * 回路の読み取りに効く数種だけにして、残りは名前のハッシュで色相を散らす。
 */
const HAND_PICKED: Record<string, string> = {
  redstone_wire: '#a3241b',
  redstone_dust: '#a3241b',
  redstone_block: '#c0392b',
  redstone_torch: '#d9542b',
  redstone_wall_torch: '#d9542b',
  redstone_lamp: '#c8913a',
  lever: '#7d6b52',
  repeater: '#b5b5b5',
  comparator: '#b5b5b5',
  stone: '#808080',
  cobblestone: '#6f6f6f',
  smooth_stone: '#9c9c9c',
  glass: '#a9d6de',
  water: '#3f68c8',
  slime_block: '#77b55a',
}
const HAND_PICKED_KEYS = Object.keys(HAND_PICKED).sort((a, b) => b.length - a.length)

/**
 * 名前から単色の色を決める。ブロック名 (`lever`)・テクスチャのパス (`block/lever`)・
 * id (`minecraft:entity/chest/normal`) のどれでもよい。同じ名前なら同じ色になる。
 */
export function solidColor(name: string): string {
  const path = name
    .replace(/^[a-z0-9_.-]+:/, '')
    .replace(/^solid\//, '')
    .replace(/^block\//, '')
  const base = path.slice(path.lastIndexOf('/') + 1)
  for (const key of HAND_PICKED_KEYS) {
    if (base === key || base.startsWith(`${key}_`)) return HAND_PICKED[key]
  }
  return hashColor(path)
}

/** FNV-1a で色相を散らす。彩度と明度は落ち着いた範囲に収める */
function hashColor(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  const hue = h % 360
  const sat = 25 + ((h >>> 9) % 25)
  const light = 42 + ((h >>> 17) % 16)
  return `hsl(${hue}, ${sat}%, ${light}%)`
}

/** `blockNames` を全部単色の立方体で描くリソース */
export async function buildSolidResources(blockNames: string[]): Promise<Resources> {
  const names = [...new Set(blockNames.map(n => n.replace(/^minecraft:/, '')))]
    .filter(n => !INVISIBLE.has(n))

  const defs = new Map<string, BlockDefinition>()
  const models = new Map<string, BlockModel>()
  const solids: Record<string, string> = {}
  for (const name of names) {
    defs.set(name, BlockDefinition.fromJson(solidBlockStateJson(name)))
    models.set(`solid/${name}`, BlockModel.fromJson(solidModelJson(name)))
    solids[solidId(name)] = solidColor(name)
  }

  // 水・チェスト・看板など、deepslate が自前で描くものが参照するテクスチャにも色を割り当てる。
  // 割り当てないと、立方体の中から黒×マゼンタの市松がのぞく
  const special = new Set<string>()
  addSpecialRendererTextures(special, names)
  for (const path of special) solids[`minecraft:${path}`] = solidColor(path)

  const AtlasCtor = TextureAtlas as unknown as new (
    img: ImageData,
    idMap: Record<string, [number, number, number, number]>,
  ) => TextureAtlas
  const atlas = await buildAtlas32({}, AtlasCtor, solids)

  return {
    getBlockDefinition: (id: Identifier) => defs.get(id.path) ?? null,
    getBlockModel: (id: Identifier) =>
      id.namespace === SOLID_NAMESPACE ? models.get(id.path) ?? null : null,
    getTextureAtlas: () => atlas.getTextureAtlas(),
    getTextureUV: (id: Identifier) => atlas.getTextureUV(id),
    getPixelSize: () => atlas.getPixelSize(),
    getBlockFlags: (id: Identifier) => getBlockFlags(id.path),
    getBlockProperties: () => null,
    getDefaultBlockProperties: () => null,
  }
}
