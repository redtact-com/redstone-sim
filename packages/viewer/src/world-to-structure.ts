/**
 * WorldSnapshot（@redstone/sim）を deepslate の Structure に変換する。
 */

import { Structure, BlockState as DSBlockState } from 'deepslate/render'
import type { WorldSnapshot, BlockState } from '@redstone/sim'

// ── deepslate Structure の内部型（structureMutator.ts と同じハック） ──
interface StructureInternal {
  size: [number, number, number]
  blocks: Array<{ pos: [number, number, number]; state: number }>
  blocksMap: Record<number, { pos: [number, number, number]; state: number }>
  palette: DSBlockState[]
}

// ── 全方向反転 ────────────────────────────────────────────────────────────────
// deepslate の top-down レンダリングでは north↔south かつ east↔west の両方が
// 内部座標と逆になる（カメラが 180° 回転した状態に相当）。
// 方向性ブロックの facing を 180° 反転させて表示とシムの向きを一致させる。

function flipDir(dir: string): string {
  if (dir === 'north') return 'south'
  if (dir === 'south') return 'north'
  if (dir === 'east')  return 'west'
  if (dir === 'west')  return 'east'
  return dir
}

/**
 * 素材ブロックの描画名 (#343)。
 *
 * **プロパティは付けない**。sim は挙動に効かないプロパティ (原木の `axis` など) を
 * 捨てているので復元できないが、`buildResources` の `getDefaultBlockProperties` が
 * blockstate 側の値から補うため、名前だけ渡せば描ける。
 */
export function plainBlockStr(name: string): string {
  return `minecraft:${name.replace(/^minecraft:/, '')}`
}

/**
 * deepslate が描けないコンテナ名の読み替え (#343)。
 *
 * チェストとシュルカーボックスは **BlockEntity のモデル**で描かれ、通常のブロックモデルを
 * 持たない。deepslate は `SpecialRenderers` で肩代わりするが、その表は
 * **色付きシュルカー 16 色しか持たない** (`{color}_shulker_box`)。
 * 無染色の `minecraft:shulker_box` を渡すと**何も描かれず消える**ので、
 * バニラのアイテム表示に一番近い紫へ寄せる。
 */
const CONTAINER_RENDER_ALIAS: Record<string, string> = {
  // 無染色シュルカーは deepslate に renderer が無い
  shulker_box: 'purple_shulker_box',
}

/**
 * コンテナの描画名。
 *
 * `name` はブロックモデルではなく **SpecialRenderer が名前で引く**ため、
 * 余計なプロパティを付けない (chest は facing 既定 south、shulker は向きを持たない)。
 * 樽だけは variant がプロパティ必須なので明示する [#58 で踏んだ罠]。
 */
export function containerBlockStr(name: string | undefined, fullCube: boolean): string {
  const id = (name ?? (fullCube ? 'barrel' : 'chest')).replace(/^minecraft:/, '')
  const drawn = CONTAINER_RENDER_ALIAS[id] ?? id
  // 樽は facing+open のバリアント形式で、プロパティ無しだと**どれにも一致せず消える**
  if (drawn === 'barrel') return 'minecraft:barrel[facing=up,open=false]'
  return `minecraft:${drawn}`
}

// ── @redstone/sim の BlockState → Minecraft ブロック文字列 ──────────────

export function blockStateToMinecraftStr(block: BlockState): string {
  switch (block.type) {
    case 'wire': {
      // 'up'=上りステップ。接続方向は構造座標基準（隣接ブロックの相対位置と
      // 同じ座標系で描画されるため flipDir は適用しない）
      const val = (v: boolean | 'up') => v === 'up' ? 'up' : v ? 'side' : 'none'
      const e = val(block.connections.east)
      const n = val(block.connections.north)
      const s = val(block.connections.south)
      const w = val(block.connections.west)
      return `minecraft:redstone_wire[east=${e},north=${n},power=${block.power},south=${s},west=${w}]`
    }
    case 'torch':
      return `minecraft:redstone_torch[lit=${block.lit}]`
    case 'wall_torch':
      return `minecraft:redstone_wall_torch[facing=${flipDir(block.facing)},lit=${block.lit}]`
    case 'repeater':
      return `minecraft:repeater[delay=${block.delay},facing=${flipDir(block.facing)},locked=${block.locked},powered=${block.powered}]`
    case 'comparator':
      return `minecraft:comparator[facing=${flipDir(block.facing)},mode=${block.mode},powered=${block.powered}]`
    case 'lever': {
      const face = block.facing === 'up' ? 'floor' : block.facing === 'down' ? 'ceiling' : 'wall'
      const facing = (block.facing === 'up' || block.facing === 'down') ? 'north' : block.facing
      return `minecraft:lever[face=${face},facing=${facing},powered=${block.powered}]`
    }
    case 'button_stone': {
      const face = block.facing === 'up' ? 'floor' : block.facing === 'down' ? 'ceiling' : 'wall'
      const facing = (block.facing === 'up' || block.facing === 'down') ? 'north' : block.facing
      return `minecraft:stone_button[face=${face},facing=${facing},powered=${block.powered}]`
    }
    case 'button_wood': {
      const face = block.facing === 'up' ? 'floor' : block.facing === 'down' ? 'ceiling' : 'wall'
      const facing = (block.facing === 'up' || block.facing === 'down') ? 'north' : block.facing
      return `minecraft:oak_button[face=${face},facing=${facing},powered=${block.powered}]`
    }
    case 'lamp':
      return `minecraft:redstone_lamp[lit=${block.lit}]`
    // ── #234 ──────────────────────────────────────────────────────────
    case 'lodestone':
      return 'minecraft:lodestone'
    case 'wall':
      // 材質は name、接続形状は sim が計算した値で描く (#343)
      return `minecraft:${block.name ?? 'stone_brick_wall'}[east=${block.east},north=${block.north},`
        + `south=${block.south},up=${block.up},waterlogged=${block.waterlogged},west=${block.west}]`
    case 'soul_sand':
      return 'minecraft:soul_sand'
    case 'water':
      return 'minecraft:water[level=0]'
    case 'bubble_column':
      return `minecraft:bubble_column[drag=${block.drag}]`
    case 'decor':
      // 取り込み元の名前で描く (判断 E)。名前空間が無ければ補う
      return block.name.startsWith('minecraft:') ? block.name : `minecraft:${block.name}`
    case 'pane':
      // 材質は name、接続は sim が計算した値で描く (#303)
      return `minecraft:${block.name}[east=${block.east},north=${block.north}`
        + `,south=${block.south},waterlogged=${block.waterlogged},west=${block.west}]`
    case 'cauldron':
      // **空の大釜は別ブロック**。vanilla の water_cauldron は level=1..3 しか持たず、
      // level=0 を渡すとどの variant にも一致せず**何も描かれない** (#343)
      return block.level === 0
        ? 'minecraft:cauldron'
        : `minecraft:water_cauldron[level=${block.level}]`
    case 'composter':
      return `minecraft:composter[level=${block.level}]`
    case 'lectern':
      // ページは BE 側なので blockstate には出ない (#240)
      return `minecraft:lectern[facing=${block.facing},has_book=${block.hasBook},powered=false]`
    case 'note_block':
      // instrument は sim で保持しないため harp 固定 (見た目に差は出ない)
      return `minecraft:note_block[instrument=harp,note=${block.note},powered=${block.powered}]`
    case 'pressure_plate_wood':
      return `minecraft:oak_pressure_plate[powered=${block.powered}]`
    case 'pressure_plate_stone':
      return `minecraft:stone_pressure_plate[powered=${block.powered}]`
    case 'weighted_pressure_plate_light':
      return `minecraft:light_weighted_pressure_plate[power=${block.powered ? block.pressedPower : 0}]`
    case 'weighted_pressure_plate_heavy':
      return `minecraft:heavy_weighted_pressure_plate[power=${block.powered ? block.pressedPower : 0}]`
    case 'redstone_block':
      return 'minecraft:redstone_block'
    case 'target':
      return `minecraft:target[power=${block.outputPower}]`
    case 'observer':
      // facing は反転しない (piston と同じ規則: 観測面/背面の相手は構造座標基準で
      // 描画されるため。sim.facing = vanilla FACING = 観測方向)
      return `minecraft:observer[facing=${block.facing},powered=${block.powered}]`
    case 'container':
      // **取り込み元のブロックで描く** (#343)。以前は一律 barrel だったため
      // チェストもトラップチェストもシュルカーボックスも樽に見えていた。
      // `name` は #324 で既に保持していて、書き出しでも同じ規則を使っている
      return containerBlockStr(block.name, block.fullCube)
    case 'hopper':
      // facing は反転しない (piston/observer と同じ規則。vanilla FACING = 送り込み方向)。
      // enabled は見た目に影響しないが blockstate バリアント選択のため付与する
      return `minecraft:hopper[enabled=${block.enabled},facing=${block.facing}]`
    case 'dispenser':
      return `minecraft:dispenser[facing=${block.facing},triggered=${block.triggered}]`
    case 'crafter':
      // orientation は front_top の組。sim は front (facing) しか持たないので
      // 上向き固定で合成する。crafting はレシピ非対応なので常に false (#163)
      return `minecraft:crafter[crafting=false,orientation=${block.facing}_up,`
        + `triggered=${block.triggered}]`
    case 'dropper':
      // facing は反転しない。triggered は見た目に影響しないが付与する
      return `minecraft:dropper[facing=${block.facing},triggered=${block.triggered}]`
    case 'piston':
    case 'sticky_piston':
      // facing は反転しない: head の出現位置 (構造座標) は非反転のため、
      // base モデルだけ flipDir すると逆向きに見える (wire 接続腕と同じ規則。
      // 実機と逆向きになるユーザ報告 2026-07-03 で確定)
      return `minecraft:${block.type}[extended=${block.extended},facing=${block.facing}]`
    case 'moving_piston': {
      // 途中伸び状態の近似表示 (vanilla は BE レンダラで補間するが、
      // グリッド描画では中間 1 コマを静的に表す):
      // - 伸長中の head セル → short ヘッド (vanilla の中間状態用モデル)
      // - 収縮中の base セル → extended base (アーム収納中の見え方)
      // - 押される payload → 中身をそのまま
      const into = block.into
      if (into.type === 'piston_head') {
        return `minecraft:piston_head[facing=${into.facing},short=true,type=${into.sticky ? 'sticky' : 'normal'}]`
      }
      if (into.type === 'piston' || into.type === 'sticky_piston') {
        return `minecraft:${into.type}[extended=true,facing=${into.facing}]`
      }
      return blockStateToMinecraftStr(into)
    }
    case 'piston_head':
      return `minecraft:piston_head[facing=${block.facing},short=false,type=${block.sticky ? 'sticky' : 'normal'}]`
    case 'slime_block':  return 'minecraft:slime_block'
    case 'honey_block':  return 'minecraft:honey_block'
    case 'powered_rail':
    case 'activator_rail':
      // shape は軸/坂を表すだけなので flipDir 不要 (north_south / east_west は対称、
      // ascending_* は構造座標と同じ向きで描画される)
      return `minecraft:${block.type}[powered=${block.powered},shape=${block.shape},waterlogged=false]`
    case 'rail':
      // 通常レールは曲線 4 形状も取る。曲線名は「繋がる 2 方向」を表すので
      // 構造座標と同じ向きで描画される (flipDir 不要) (#140)
      return `minecraft:rail[shape=${block.shape},waterlogged=false]`
    case 'detector_rail':
      return `minecraft:detector_rail[powered=${block.powered},shape=${block.shape},waterlogged=false]`
    case 'copper_bulb':
      // 酸化段階は sim で持たないので素の銅の電球で描画する (#155)
      return `minecraft:copper_bulb[lit=${block.lit},powered=${block.powered}]`
    case 'trapdoor_wood':
    case 'trapdoor_iron': {
      // facing は反転する (repeater と同じく「ヒンジのある側」= 取り付け方向)。
      // half は sim で持たないので bottom 固定 (#157)
      const name = block.type === 'trapdoor_iron' ? 'iron_trapdoor' : 'oak_trapdoor'
      return `minecraft:${name}[facing=${flipDir(block.facing)},half=bottom,`
        + `open=${block.open},powered=${block.powered},waterlogged=false]`
    }
    case 'fence_gate':
      return `minecraft:oak_fence_gate[facing=${flipDir(block.facing)},in_wall=false,`
        + `open=${block.open},powered=${block.powered}]`
    case 'door_wood':
    case 'door_iron': {
      // hinge は sim で持たないので left 固定 (#159)
      const name = block.type === 'door_iron' ? 'iron_door' : 'oak_door'
      return `minecraft:${name}[facing=${flipDir(block.facing)},half=${block.half},`
        + `hinge=left,open=${block.open},powered=${block.powered}]`
    }
    // 素材は挙動に効かないが**見た目には効く**ので name で描く (#343)。
    // 名前を持たない (パレット配置の) ものは従来どおり代表ブロック
    case 'solid':
      return plainBlockStr(block.name ?? 'stone')
    case 'glass':
      return plainBlockStr(block.name ?? 'glass')
    case 'slab':
      return `minecraft:${block.name ?? 'smooth_stone_slab'}[type=${block.half}]`
    case 'air':
      return 'minecraft:air'
  }
}

// ── ブロック文字列 → name + props ──────────────────────────────────────

function parseBlockStr(blockStr: string): { name: string; props: Record<string, string> } {
  const bracketIdx = blockStr.indexOf('[')
  if (bracketIdx === -1) return { name: blockStr, props: {} }
  const name = blockStr.slice(0, bracketIdx)
  const props: Record<string, string> = {}
  const propsStr = blockStr.slice(bracketIdx + 1, -1)
  for (const kv of propsStr.split(',')) {
    const eq = kv.indexOf('=')
    if (eq !== -1) props[kv.slice(0, eq)] = kv.slice(eq + 1)
  }
  return { name, props }
}

// ── 既知ブロック名一覧（buildResources のプリロード用） ──────────────

export const VIEWER_PRELOAD_BLOCKS: string[] = [
  'minecraft:redstone_wire',
  'minecraft:redstone_torch',
  'minecraft:redstone_wall_torch',
  'minecraft:repeater',
  'minecraft:comparator',
  'minecraft:lever',
  'minecraft:stone_button',
  'minecraft:oak_button',
  'minecraft:oak_pressure_plate',
  'minecraft:stone_pressure_plate',
  'minecraft:light_weighted_pressure_plate',
  'minecraft:heavy_weighted_pressure_plate',
  'minecraft:redstone_lamp',
  'minecraft:note_block',
  'minecraft:piston',
  'minecraft:sticky_piston',
  'minecraft:piston_head',
  'minecraft:redstone_block',
  'minecraft:observer',
  'minecraft:barrel',
  'minecraft:hopper',
  'minecraft:dropper',
  'minecraft:dispenser',
  'minecraft:crafter',
  'minecraft:stone',
  'minecraft:cobblestone',
  'minecraft:glass',
  'minecraft:smooth_stone_slab',
  'minecraft:smooth_stone',
  'minecraft:target',
  'minecraft:slime_block',
  'minecraft:honey_block',
  'minecraft:powered_rail',
  'minecraft:activator_rail',
  'minecraft:rail',
  'minecraft:detector_rail',
  'minecraft:copper_bulb',
  'minecraft:oak_trapdoor',
  'minecraft:iron_trapdoor',
  'minecraft:oak_fence_gate',
  'minecraft:oak_door',
  'minecraft:iron_door',
  // #234 ガラスエレベーター。**ここに無い名前は deepslate が描けず消えて見える**
  'minecraft:lodestone',
  'minecraft:stone_brick_wall',
  'minecraft:soul_sand',
  'minecraft:water',
  'minecraft:bubble_column',
  'minecraft:water_cauldron',
  // 空の大釜は別ブロック (#343。level=0 は water_cauldron の variant に無い)
  'minecraft:cauldron',
  'minecraft:composter',
  'minecraft:lectern',
]

/**
 * スナップショットに出てくる「プリロード表に無いブロック名」(#234 → #343)。
 *
 * 取り込み元の名前を保持する型 (`decor` / `pane` / `container` …) は名前の集合が閉じておらず、
 * 固定表に列挙できない。ここで拾って `buildResources` に足さないと、
 * そのブロックは**エラーにならず静かに消える** (実際、壁が透明なまま GIF に写って気づいた)。
 *
 * **型で絞らない** (#343)。以前は `decor` だけを見ていたため、同じく名前を持つ
 * `pane` (ガラス板・鉄格子) が取り込んでも 3D から消えていた。
 * 名前を持つ型が今後増えても、ここは何もしなくても追従する。
 */
export function extraPreloadNames(
  snapshot: { blocks: ReadonlyMap<string, BlockState> },
): string[] {
  const known = new Set(VIEWER_PRELOAD_BLOCKS)
  const found = new Set<string>()
  for (const block of snapshot.blocks.values()) {
    const name = blockStateToMinecraftStr(block).split('[')[0]
    if (name !== 'minecraft:air' && !known.has(name)) found.add(name)
  }
  return [...found].sort()
}

// ── WorldSnapshot → Structure ────────────────────────────────────────

export interface SnapshotBounds {
  minX: number; maxX: number
  minY: number; maxY: number
  minZ: number; maxZ: number
}

export function worldSnapshotToStructure(snapshot: WorldSnapshot): {
  structure: Structure
  bounds: SnapshotBounds
} {
  if (snapshot.blocks.size === 0) {
    // 空スナップショット: snapshot.bounds のサイズで空の Structure を生成
    const { x: [minX, maxX], y: [minY, maxY], z: [minZ, maxZ] } = snapshot.bounds
    const sX = maxX - minX + 1
    const sY = maxY - minY + 1
    const sZ = maxZ - minZ + 1
    const structure = new Structure([sX, sY, sZ]) as unknown as StructureInternal
    structure.blocks = []
    structure.blocksMap = {}
    structure.palette = []
    return {
      structure: structure as unknown as Structure,
      bounds: { minX, maxX, minY, maxY, minZ, maxZ },
    }
  }

  const { x: [minX, maxX], y: [minY, maxY], z: [minZ, maxZ] } = snapshot.bounds
  const sizeX = maxX - minX + 1
  const sizeY = maxY - minY + 1
  const sizeZ = maxZ - minZ + 1

  // deepslate Structure を空で生成してから内部を操作
  const structure = new Structure([sizeX, sizeY, sizeZ]) as unknown as StructureInternal
  structure.blocks = []
  structure.blocksMap = {}
  structure.palette = []

  for (const [key, block] of snapshot.blocks) {
    if (block.type === 'air') continue
    const [x, y, z] = (key as string).split(',').map(Number)
    const px = x - minX
    const py = y - minY
    const pz = z - minZ

    const blockStr = blockStateToMinecraftStr(block)
    if (blockStr === 'minecraft:air') continue

    const { name, props } = parseBlockStr(blockStr)
    const dsBlock = new DSBlockState(name, props)

    let stateIdx = structure.palette.findIndex(b => b.equals(dsBlock))
    if (stateIdx === -1) {
      stateIdx = structure.palette.length
      structure.palette.push(dsBlock)
    }

    const flatIdx = px * sizeY * sizeZ + py * sizeZ + pz
    const entry = { pos: [px, py, pz] as [number, number, number], state: stateIdx }
    structure.blocks.push(entry)
    structure.blocksMap[flatIdx] = entry
  }

  return {
    structure: structure as unknown as Structure,
    bounds: { minX, maxX, minY, maxY, minZ, maxZ },
  }
}

/**
 * スナップショットの差分だけ Structure を更新する。
 * シミュレーションの tick 後など、変化が少ない場合に効率的。
 */
export function patchStructureFromSnapshot(
  structure: Structure,
  oldSnapshot: WorldSnapshot,
  newSnapshot: WorldSnapshot,
  bounds: SnapshotBounds,
): void {
  const s = structure as unknown as StructureInternal
  const [, sY, sZ] = s.size
  const { minX, minY, minZ } = bounds

  const allKeys = new Set([...oldSnapshot.blocks.keys(), ...newSnapshot.blocks.keys()])

  for (const key of allKeys) {
    const oldBlock = oldSnapshot.blocks.get(key as `${number},${number},${number}`)
    const newBlock = newSnapshot.blocks.get(key as `${number},${number},${number}`)

    // 変化なし
    if (JSON.stringify(oldBlock) === JSON.stringify(newBlock)) continue

    const [x, y, z] = (key as string).split(',').map(Number)
    const px = x - minX
    const py = y - minY
    const pz = z - minZ

    const flatIdx = px * sY * sZ + py * sZ + pz

    if (!newBlock || newBlock.type === 'air') {
      // 削除
      delete s.blocksMap[flatIdx]
      s.blocks = s.blocks.filter(b => b.pos[0] !== px || b.pos[1] !== py || b.pos[2] !== pz)
    } else {
      const blockStr = blockStateToMinecraftStr(newBlock)
      const { name, props } = parseBlockStr(blockStr)
      const dsBlock = new DSBlockState(name, props)

      let stateIdx = s.palette.findIndex(b => b.equals(dsBlock))
      if (stateIdx === -1) {
        stateIdx = s.palette.length
        s.palette.push(dsBlock)
      }

      if (s.blocksMap[flatIdx]) {
        s.blocksMap[flatIdx].state = stateIdx
        const arr = s.blocks.find(b => b.pos[0] === px && b.pos[1] === py && b.pos[2] === pz)
        if (arr) arr.state = stateIdx
      } else {
        const entry = { pos: [px, py, pz] as [number, number, number], state: stateIdx }
        s.blocksMap[flatIdx] = entry
        s.blocks.push(entry)
      }
    }
  }
}
