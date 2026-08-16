/**
 * NBT エクスポート / インポート ユーティリティ
 *
 * エクスポート: CircuitEditor の BlockState → Minecraft バニラ構造 NBT (.nbt)
 * インポート : バニラ構造 NBT → CircuitEditor の BlockState
 */

import {
  NbtFile, NbtCompound, NbtList, NbtInt, NbtString, NbtByte,
} from 'deepslate/nbt'
import { Structure } from 'deepslate'
import { sniffFormat, convertBuffer } from '@taku128/java-schematic'
import type { DetectedFormat } from '@taku128/java-schematic'
import type { BlockState, BlockType, ContainerSlots, Dir6 } from '@redstone/sim'
import { emptySlots, stackSizeOf, containerSlotsOf } from '@redstone/sim'

const FACING_OPPOSITE: Record<string, string> = {
  north: 'south', south: 'north', east: 'west', west: 'east',
}

/**
 * sim の facing と vanilla NBT の facing で**意味が逆になる**素子の変換。
 *
 * 反転が要るのは 3 種:
 *   - `wall_torch` — sim は「土台の方向」、vanilla は「torch が向く方向」
 *   - `repeater` / `comparator` — **sim は出力方向、vanilla は入力側**
 *     [確定: 実機 fixture `nonconductor-glass-slab` / `dust-block-repeater` —
 *      `repeater[facing=west]` が西のブロックを読んで東へ出力している]
 *
 * 規約の正は `packages/sim/src/mcstate.ts` (実機ハーネスとの変換器) で、
 * 描画側 `packages/viewer/src/world-to-structure.ts` の `flipDir` も同じ。
 * **この 3 者は必ず揃えること** (`nbtIO.test.ts` の突き合わせテストが守る)。
 *
 * 履歴 (#189): repeater / comparator は「vanilla と一致するので反転不要」と
 * 誤って書かれており、取り込みで 180° 反転していた。書き出し側も同じ漏れが
 * あったため往復テストでは打ち消し合って検出できなかった。
 */
function flipFacingForVanillaNbt(facing: string | undefined): string {
  if (!facing) return 'north'
  return FACING_OPPOSITE[facing] ?? facing
}

/**
 * コンテナの中身を block entity NBT として書き出す (#194)。
 * 中身を落とすと**コンパレーター強度の微調整が失われる**ため往復で保持する。
 * Items が空なら undefined (不要な nbt を付けない)。
 */
function containerNbt(block: BlockState, name: string): NbtCompound | undefined {
  const slots = containerSlotsOf(block)
  if (!slots) return undefined
  const entries: NbtCompound[] = []
  slots.forEach((s, i) => {
    if (!s || s.count <= 0) return
    entries.push(new NbtCompound()
      .set('Slot', new NbtByte(i))
      .set('id', new NbtString(`minecraft:${s.id}`))
      .set('count', new NbtInt(s.count)))
  })
  if (entries.length === 0) return undefined
  return new NbtCompound()
    .set('id', new NbtString(name))
    .set('Items', new NbtList<NbtCompound>(entries))
}

// ── エクスポート ─────────────────────────────────────────────────────────────

/** BlockState (3D key "x,y,z") → Minecraft バニラ構造 NBT バイト列 */
export function exportToNbtBytes(
  blocks: Map<string, BlockState>,
  gridW: number,
  gridH: number,
): Uint8Array {
  // palette: 重複排除
  const paletteMap = new Map<string, number>()
  const paletteCompounds: NbtCompound[] = []

  const getOrAdd = (name: string, props: Record<string, string> = {}): number => {
    const key = name + JSON.stringify(props)
    if (paletteMap.has(key)) return paletteMap.get(key)!
    const idx = paletteCompounds.length
    paletteMap.set(key, idx)
    const comp = new NbtCompound()
    comp.set('Name', new NbtString(name))
    if (Object.keys(props).length > 0) {
      const propsComp = new NbtCompound()
      for (const [k, v] of Object.entries(props)) propsComp.set(k, new NbtString(v))
      comp.set('Properties', propsComp)
    }
    paletteCompounds.push(comp)
    return idx
  }

  // air を 0 番に登録
  getOrAdd('minecraft:air')

  const blockEntries: Array<{
    x: number; y: number; z: number; state: number; nbt?: NbtCompound
  }> = []
  let maxY = 0

  for (const [key, block] of blocks) {
    const [x, y, z] = key.split(',').map(Number)
    const [name, props] = blockStateToMinecraft(block)
    const state = getOrAdd(name, props)
    blockEntries.push({ x, y, z, state, nbt: containerNbt(block, name) })
    if (y > maxY) maxY = y
  }

  // palette リスト
  const paletteList = new NbtList<NbtCompound>(paletteCompounds)

  // blocks リスト
  const blocksList = new NbtList<NbtCompound>(
    blockEntries.map(({ x, y, z, state, nbt }) => {
      const c = new NbtCompound()
      c.set('state', new NbtInt(state))
      const pos = new NbtList<NbtInt>([new NbtInt(x), new NbtInt(y), new NbtInt(z)])
      c.set('pos', pos)
      if (nbt) c.set('nbt', nbt)   // コンテナの中身 (#194)
      return c
    })
  )

  // entities リスト (空)
  const entitiesList = new NbtList<NbtCompound>([])

  // size
  const sizeList = new NbtList<NbtInt>([
    new NbtInt(gridW),
    new NbtInt(maxY + 1),
    new NbtInt(gridH),
  ])

  const root = new NbtCompound()
  root.set('size', sizeList)
  root.set('palette', paletteList)
  root.set('blocks', blocksList)
  root.set('entities', entitiesList)

  const file = new NbtFile('', root, 'gzip', false, undefined)
  return file.write()
}

// ── インポート ─────────────────────────────────────────────────────────────

/** インポート時に構造を収める盤面の範囲 (省略した軸は無制限) */
export interface ImportBounds {
  /** X 幅 (0 .. gridW-1)。範囲外の x は省略 */
  gridW?: number
  /** Z 幅 (0 .. gridH-1)。範囲外の z は省略 */
  gridH?: number
  /** レイヤー数 (0 .. maxLayers-1)。以上の y は省略 */
  maxLayers?: number
}

/**
 * 読めない形式のときに返す説明 (#174)。
 *
 * `sniffFormat` の判別結果から引く。**英語の例外メッセージを文字列一致で
 * 掴まない**ため (ライブラリの文言変更で壊れる)。
 * 判別できたのに読めなかった、を黙って 0 ブロックにしないのが目的。
 */
const UNSUPPORTED_FORMAT_MESSAGE: Partial<Record<DetectedFormat, string>> = {
  'bedrock-mcstructure':
    'Bedrock 版の .mcstructure には未対応です (Java 版の .nbt / .litematic / .schem を使ってください)',
  schematic:
    '旧 MCEdit の .schematic (数値 ID) には未対応です。.schem か .litematic で保存し直してください',
  unknown:
    'NBT の形式を判別できませんでした (対応形式は .nbt / .litematic / .schem)',
}

/** 形式の判別に失敗したときの ImportResult */
function emptyResult(warning: string): ImportResult {
  return { blocks: new Map(), warnings: [warning], size: [0, 0, 0] }
}

/** 置かれた 1 ブロック (形式によらない中間形) */
interface RawPlacedBlock {
  pos: [number, number, number]
  name: string
  props: Record<string, string>
  /** コンテナの中身 (block entity の Items)。#194 */
  items?: RawItem[]
}

/** block entity の Items 1 件 (#194)。 */
interface RawItem { slot: number; id: string; count: number }

/** バニラ構造 NBT (.nbt) を RawPlacedBlock 列にする */
function readVanillaStructureBlocks(root: NbtCompound): RawPlacedBlock[] {
  return Structure.fromNbt(root).getBlocks().map((placed) => ({
    pos: placed.pos as [number, number, number],
    name: placed.state.getName().toString(),
    props: placed.state.getProperties() as Record<string, string>,
    items: readItems((placed as { nbt?: NbtCompound }).nbt),
  }))
}

/**
 * block entity の `Items` を読む (#194)。
 * コンパレーター強度はスタック上限に依存するので、**個数だけでなく ID が要る**。
 * 1.20.5 以降は `count`、それ以前は `Count` [minecraft.wiki Item structure]。
 */
function readItems(nbt: NbtCompound | undefined): RawItem[] | undefined {
  if (!nbt) return undefined
  const list = nbt.get('Items')
  if (!(list instanceof NbtList)) return undefined
  const out: RawItem[] = []
  for (let i = 0; i < list.length; i++) {
    const e = list.get(i)
    if (!(e instanceof NbtCompound)) continue
    const id = e.getString('id')
    if (!id) continue
    const count = e.getNumber('count') || e.getNumber('Count') || 0
    if (count <= 0) continue
    out.push({ slot: e.getNumber('Slot') ?? 0, id, count })
  }
  return out.length > 0 ? out : undefined
}

export interface ImportResult {
  /** エディタ用ブロックマップ (key: "x,y,z") */
  blocks: Map<string, BlockState>
  /** 省略・非対応など、利用者へ伝える警告 (種類ごとに集約済み) */
  warnings: string[]
  /** 取り込めたブロックのバウンディングボックスサイズ [sx, sy, sz]。0 個なら [0,0,0] */
  size: [number, number, number]
}

/**
 * Java 版の構造ファイル (.nbt / .litematic / .schem) → エディタブロックマップ。
 *
 * 形式は**拡張子ではなく NBT の中身**で判別する (#174)。バニラ構造 NBT は
 * そのまま deepslate で読み、それ以外は `@taku128/java-schematic` で構造 NBT へ
 * 変換してから同じ経路に流す。以降のブロック名変換・バウンド判定・警告集約は
 * 全形式で共通。
 *
 * bounds を渡すと盤面 (gridW×gridH×maxLayers) に収まらないブロックを省略し、
 * 省略数・非対応ブロックを種類ごとに集約した警告を返す。埋め込み表示 (#97) では
 * この警告を親ページへ渡し、「n 個を簡略化しました」と提示する。
 */
export async function importFromNbtBytes(
  bytes: Uint8Array,
  bounds: ImportBounds = {},
): Promise<ImportResult> {
  const { gridW, gridH, maxLayers } = bounds

  let format: DetectedFormat
  try {
    format = sniffFormat(bytes).format
  } catch (e) {
    // NBT として展開すらできない (画像を掴んだ等)
    return emptyResult(`NBT として読めませんでした: ${e instanceof Error ? e.message : String(e)}`)
  }
  const unsupported = UNSUPPORTED_FORMAT_MESSAGE[format]
  if (unsupported) return emptyResult(unsupported)

  // バニラ構造 NBT は変換不要 (再エンコード + 再パースの往復を挟まない)
  let structureBytes = bytes
  if (format !== 'structure') {
    try {
      structureBytes = (await convertBuffer(bytes)).nbt
    } catch (e) {
      return emptyResult(`${format} の変換に失敗しました: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const nbt = NbtFile.read(structureBytes)
  unknownStackItems.clear()   // #194: 取り込みごとに集計し直す
  const placedBlocks = readVanillaStructureBlocks(nbt.root)

  const resultBlocks = new Map<string, BlockState>()
  const warnings: string[] = []
  let skippedAbove = 0
  let skippedOutOfBounds = 0
  // 非対応ブロックは種類ごとに件数を集約する (1 個ずつ列挙すると警告が溢れるため)
  const unsupportedBlocks = new Map<string, number>()

  let minX = Infinity, minY = Infinity, minZ = Infinity
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity

  for (const placed of placedBlocks) {
    const [bx, by, bz] = placed.pos
    if (maxLayers !== undefined && by >= maxLayers) {
      skippedAbove++
      continue
    }
    if (
      by < 0 ||
      (gridW !== undefined && (bx < 0 || bx >= gridW)) ||
      (gridH !== undefined && (bz < 0 || bz >= gridH))
    ) {
      skippedOutOfBounds++
      continue
    }

    const { name, props } = placed

    const block = minecraftToBlockState(name, props, placed.items)
    if (!block) {
      // air 亜種 (cave_air / void_air) は空セル扱いで無警告 (通常の air と同様)
      const isAir = name === 'minecraft:air' || name.endsWith('_air')
      if (!isAir) unsupportedBlocks.set(name, (unsupportedBlocks.get(name) ?? 0) + 1)
      continue
    }
    resultBlocks.set(`${bx},${by},${bz}`, block)
    if (bx < minX) minX = bx
    if (by < minY) minY = by
    if (bz < minZ) minZ = bz
    if (bx > maxX) maxX = bx
    if (by > maxY) maxY = by
    if (bz > maxZ) maxZ = bz
  }

  if (placedBlocks.length === 0) warnings.push('読み取れるブロックがありませんでした (空の構造ファイル)')
  if (unknownStackItems.size > 0) {
    // スタック上限が分からないとコンパレーター強度がずれるので黙って進めない (#194)
    const names = [...unknownStackItems].sort()
    warnings.push(
      `スタック上限が不明なアイテム ${names.length} 種 (${names.slice(0, 4).join(', ')}`
      + `${names.length > 4 ? ' ほか' : ''}) を 64 として扱いました`,
    )
  }
  if (unsupportedBlocks.size > 0) {
    const total = [...unsupportedBlocks.values()].reduce((a, b) => a + b, 0)
    const kinds = [...unsupportedBlocks.keys()].map((n) => n.replace('minecraft:', '')).join(', ')
    warnings.push(`未対応ブロック ${total} 個 (${unsupportedBlocks.size} 種: ${kinds}) を省略`)
  }
  if (skippedAbove > 0) warnings.push(`高さ上限 (Y≥${maxLayers}) 超過で ${skippedAbove} ブロックを省略`)
  if (skippedOutOfBounds > 0) {
    warnings.push(`盤面範囲外 (${gridW ?? '∞'}×${gridH ?? '∞'}) の ${skippedOutOfBounds} ブロックを省略`)
  }

  const size: [number, number, number] = resultBlocks.size > 0
    ? [maxX - minX + 1, maxY - minY + 1, maxZ - minZ + 1]
    : [0, 0, 0]

  return { blocks: resultBlocks, warnings, size }
}

// ── BlockState → Minecraft 変換 ─────────────────────────────────────────────

/**
 * レバー・ボタンの取付面 (#111)。
 *
 * sim の facing は「レバーが向く方向 (壁から離れる方向)」で、vanilla の
 * face(floor|wall|ceiling) + facing の組と 1:1 に対応する:
 *   up → face=floor / down → face=ceiling / 水平 → face=wall, facing=そのまま
 *
 * **flipFacingForVanillaNbt は掛けない**。反転が要るのは repeater / comparator /
 * wall_torch だけで、レバー・ボタンは vanilla と sim で向きの意味が一致している
 * (packages/sim/src/mcstate.ts と packages/viewer/src/world-to-structure.ts が同じ規約)。
 */
function dir6ToFaceFacing(dir: unknown): { face: string; facing: string } {
  if (dir === 'up') return { face: 'floor', facing: 'north' }
  if (dir === 'down') return { face: 'ceiling', facing: 'north' }
  if (dir === 'north' || dir === 'south' || dir === 'east' || dir === 'west') {
    return { face: 'wall', facing: dir }
  }
  return { face: 'floor', facing: 'north' }
}

function faceFacingToDir6(face: string | undefined, facing: string | undefined): Dir6 {
  // face 未指定は床置き扱い。vanilla の既定は wall だが、面情報を持たない古い
  // 保存データ (facing='up' 時代) を素直に床へ寄せる方が事故が少ない
  if (face === 'ceiling') return 'down'
  if (face === 'wall') {
    return facing === 'north' || facing === 'south' || facing === 'east' || facing === 'west'
      ? facing
      : 'north'
  }
  return 'up'
}

function blockStateToMinecraft(block: BlockState): [string, Record<string, string>] {
  switch (block.type) {
    case 'wire': {
      const conn = (block as any).connections as Record<string, boolean | 'up'>
      const val = (v: boolean | 'up' | undefined) => v === 'up' ? 'up' : v ? 'side' : 'none'
      return ['minecraft:redstone_wire', {
        north: val(conn?.north),
        south: val(conn?.south),
        east:  val(conn?.east),
        west:  val(conn?.west),
        power: String((block as any).power ?? 0),
      }]
    }
    case 'torch':
      return ['minecraft:redstone_torch', { lit: String((block as any).lit ?? true) }]
    case 'wall_torch':
      return ['minecraft:redstone_wall_torch', {
        facing: flipFacingForVanillaNbt((block as any).facing),
        lit: String((block as any).lit ?? true),
      }]
    // sim は出力方向、vanilla は入力側なので反転する (#189)
    case 'repeater':
      return ['minecraft:repeater', {
        facing:  flipFacingForVanillaNbt((block as any).facing),
        delay:   String((block as any).delay ?? 1),
        locked:  'false',
        powered: String((block as any).powered ?? false),
      }]
    case 'comparator':
      return ['minecraft:comparator', {
        facing:  flipFacingForVanillaNbt((block as any).facing),
        mode:    (block as any).mode ?? 'compare',
        powered: String((block as any).powered ?? false),
      }]
    case 'lamp':
      return ['minecraft:redstone_lamp', { lit: String((block as any).lit ?? false) }]
    case 'note_block':
      return ['minecraft:note_block', {
        instrument: 'harp',
        note: String((block as any).note ?? 0),
        powered: String((block as any).powered ?? false),
      }]
    case 'slime_block':
      return ['minecraft:slime_block', {}]
    case 'honey_block':
      return ['minecraft:honey_block', {}]
    case 'rail':
      // 通常レールは powered を持たない。曲線 4 形状も取る (#140)
      return ['minecraft:rail', { shape: block.shape, waterlogged: 'false' }]
    case 'door_wood':
    case 'door_iron':
      return [block.type === 'door_iron' ? 'minecraft:iron_door' : 'minecraft:oak_door', {
        facing: block.facing, half: block.half, hinge: 'left',
        open: String(block.open), powered: String(block.powered),
      }]
    case 'trapdoor_wood':
    case 'trapdoor_iron':
      return [block.type === 'trapdoor_iron' ? 'minecraft:iron_trapdoor' : 'minecraft:oak_trapdoor', {
        facing: block.facing, half: 'bottom',
        open: String(block.open), powered: String(block.powered), waterlogged: 'false',
      }]
    case 'fence_gate':
      return ['minecraft:oak_fence_gate', {
        facing: block.facing, in_wall: 'false',
        open: String(block.open), powered: String(block.powered),
      }]
    case 'copper_bulb':
      // 酸化バリアントは 1 種に集約しているので素の銅の電球として書き出す (#155)
      return ['minecraft:copper_bulb', {
        lit: String(block.lit),
        powered: String(block.powered),
      }]
    case 'detector_rail':
    case 'powered_rail':
    case 'activator_rail':
      return [`minecraft:${block.type}`, {
        powered: String(block.powered),
        shape: block.shape,
        waterlogged: 'false',
      }]
    case 'redstone_block':
      return ['minecraft:redstone_block', {}]
    case 'target':
      return ['minecraft:target', { power: String(block.outputPower) }]
    case 'observer':
      // facing = 観測方向 = vanilla FACING (反転不要。repeater と同じ方針)
      return ['minecraft:observer', {
        facing: (block as any).facing ?? 'south',
        powered: String((block as any).powered ?? false),
      }]
    case 'container':
      // コンテナは barrel として書き出す (signal は NBT に現れないため破棄)
      return ['minecraft:barrel', {}]
    case 'hopper':
      // facing = 送り込み方向 = vanilla FACING (非反転)。count は NBT の中身依存で破棄
      return ['minecraft:hopper', {
        enabled: String((block as any).enabled ?? true),
        facing: (block as any).facing ?? 'down',
      }]
    case 'crafter':
      // レシピ非対応なので crafting は常に false。orientation は front_top の組 (#163)
      return ['minecraft:crafter', {
        crafting: 'false',
        orientation: `${(block as any).facing ?? 'north'}_up`,
        triggered: String((block as any).triggered ?? false),
      }]
    case 'dropper':
    case 'dispenser':
      return [`minecraft:${block.type}`, {
        facing: (block as any).facing ?? 'north',
        triggered: String((block as any).triggered ?? false),
      }]
    case 'lever': {
      const { face, facing } = dir6ToFaceFacing((block as any).facing)
      return ['minecraft:lever', { face, facing, powered: String((block as any).powered ?? false) }]
    }
    case 'button_stone': {
      // 取付面つきで往復する (#111)。感圧板と同様に専用型で往復する (#54)
      const { face, facing } = dir6ToFaceFacing((block as any).facing)
      return ['minecraft:stone_button', { face, facing, powered: String(block.powered) }]
    }
    case 'button_wood': {
      const { face, facing } = dir6ToFaceFacing((block as any).facing)
      return ['minecraft:oak_button', { face, facing, powered: String(block.powered) }]
    }
    case 'pressure_plate_wood':
      return ['minecraft:oak_pressure_plate', { powered: String((block as any).powered ?? false) }]
    case 'pressure_plate_stone':
      return ['minecraft:stone_pressure_plate', { powered: String((block as any).powered ?? false) }]
    case 'weighted_pressure_plate_light':
      // 手動モデルの pressedPower は POWER として保存 (踏まれ中のみ >0 になる vanilla とは
      // 意味が異なるため、非作動時は 0 を書く)
      return ['minecraft:light_weighted_pressure_plate', {
        power: String((block as any).powered ? ((block as any).pressedPower ?? 15) : 0),
      }]
    case 'weighted_pressure_plate_heavy':
      return ['minecraft:heavy_weighted_pressure_plate', {
        power: String((block as any).powered ? ((block as any).pressedPower ?? 15) : 0),
      }]
    case 'piston':
    case 'sticky_piston':
      return [`minecraft:${(block as any).type}`, {
        extended: String((block as any).extended ?? false),
        facing: (block as any).facing ?? 'north',
      }]
    case 'moving_piston':
      return ['minecraft:air', {}]  // 過渡状態は保存しない
    case 'piston_head':
      return ['minecraft:piston_head', {
        facing: (block as any).facing ?? 'north',
        type: (block as any).sticky ? 'sticky' : 'normal',
      }]
    case 'solid':
      return ['minecraft:stone', {}]
    // 非導体 (#184)。色・素材を保持しないので代表名で書き出す
    case 'glass':
      return ['minecraft:glass', {}]
    case 'slab':
      return ['minecraft:smooth_stone_slab', { type: block.half }]
    default:
      return ['minecraft:air', {}]
  }
}

// ── Minecraft → BlockState 変換 ─────────────────────────────────────────────

function minecraftToBlockState(
  name: string,
  props: Record<string, string>,
  items?: RawItem[],
): BlockState | null {
  if (name === 'minecraft:redstone_wire') {
    const val = (p: string | undefined) => p === 'up' ? 'up' as const : p === 'side'
    return {
      type: 'wire',
      connections: {
        north: val(props.north),
        south: val(props.south),
        east:  val(props.east),
        west:  val(props.west),
      },
      power: Number(props.power ?? 0),
    } as BlockState
  }

  if (name === 'minecraft:redstone_torch') {
    return { type: 'torch', facing: 'up', lit: props.lit !== 'false' } as BlockState
  }

  if (name === 'minecraft:redstone_wall_torch') {
    const facing = flipFacingForVanillaNbt(props.facing) as any
    return { type: 'wall_torch', facing, lit: props.lit !== 'false' } as BlockState
  }

  if (name === 'minecraft:repeater') {
    // vanilla の facing は入力側、sim は出力方向 (#189)
    const facing = flipFacingForVanillaNbt(props.facing) as any
    const delay = Number(props.delay ?? 1) as 1 | 2 | 3 | 4
    return {
      type: 'repeater',
      facing,
      delay,
      powered: props.powered === 'true',
      locked: props.locked === 'true',
    } as BlockState
  }

  if (name === 'minecraft:comparator') {
    // vanilla の facing は入力側 (背面)、sim は出力方向 (#189)
    const facing = flipFacingForVanillaNbt(props.facing) as any
    const mode = (props.mode === 'subtract' ? 'subtract' : 'compare') as 'compare' | 'subtract'
    return {
      type: 'comparator',
      facing,
      mode,
      powered: props.powered === 'true',
      outputPower: 0,
    } as BlockState
  }

  if (name === 'minecraft:piston' || name === 'minecraft:sticky_piston') {
    return {
      type: name.replace('minecraft:', '') as 'piston' | 'sticky_piston',
      facing: (props.facing ?? 'north') as any,
      extended: props.extended === 'true',
    } as BlockState
  }

  if (name === 'minecraft:piston_head') {
    return {
      type: 'piston_head',
      facing: (props.facing ?? 'north') as any,
      sticky: props.type === 'sticky',
    } as BlockState
  }

  if (name === 'minecraft:redstone_lamp') {
    return { type: 'lamp', lit: props.lit === 'true' } as BlockState
  }

  if (name === 'minecraft:note_block') {
    return {
      type: 'note_block',
      powered: props.powered === 'true',
      note: Number(props.note ?? 0),
    } as BlockState
  }

  if (name === 'minecraft:slime_block') return { type: 'slime_block' } as BlockState
  if (name === 'minecraft:honey_block') return { type: 'honey_block' } as BlockState
  if (name.endsWith('_door')) {
    // 樹種は挙動に影響しないので木/鉄の 2 種に集約する (#159)
    return {
      type: name === 'minecraft:iron_door' ? 'door_iron' : 'door_wood',
      half: props.half === 'upper' ? 'upper' : 'lower',
      facing: (props.facing ?? 'north'),
      open: props.open === 'true',
      powered: props.powered === 'true',
    } as BlockState
  }
  if (name.endsWith('_trapdoor')) {
    // 樹種は挙動に影響しないので木/鉄の 2 種に集約する (#157)
    return {
      type: name === 'minecraft:iron_trapdoor' ? 'trapdoor_iron' : 'trapdoor_wood',
      facing: (props.facing ?? 'north'),
      open: props.open === 'true',
      powered: props.powered === 'true',
    } as BlockState
  }
  if (name.endsWith('_fence_gate')) {
    return {
      type: 'fence_gate',
      facing: (props.facing ?? 'north'),
      open: props.open === 'true',
      powered: props.powered === 'true',
    } as BlockState
  }
  if (name.endsWith('copper_bulb')) {
    // 酸化 8 バリアントはレッドストーン挙動が同一なので 1 種に集約する (#155)
    return {
      type: 'copper_bulb',
      lit: props.lit === 'true',
      powered: props.powered === 'true',
    } as BlockState
  }
  if (name === 'minecraft:rail') {
    // SHAPE は RAIL_SHAPE (直線2+坂4+曲線4)。通常レールだけが曲線を取る (#140)
    return { type: 'rail', shape: (props.shape ?? 'north_south') } as BlockState
  }
  if (name === 'minecraft:detector_rail') {
    return {
      type: 'detector_rail',
      shape: (props.shape ?? 'north_south'),
      powered: props.powered === 'true',
    } as BlockState
  }
  if (name === 'minecraft:powered_rail' || name === 'minecraft:activator_rail') {
    // SHAPE は RAIL_SHAPE_STRAIGHT (直線2+坂4)。曲線はこの 2 種には無い。
    // activator_rail は powered_rail と同じ PoweredRailBlock なので状態も同形 (#138)
    return {
      type: name === 'minecraft:activator_rail' ? 'activator_rail' : 'powered_rail',
      shape: (props.shape ?? 'north_south'),
      powered: props.powered === 'true',
    } as BlockState
  }
  if (name === 'minecraft:redstone_block') {
    return { type: 'redstone_block' } as BlockState
  }

  if (name === 'minecraft:target') {
    return { type: 'target', outputPower: Number(props.power ?? 0) } as BlockState
  }

  if (name === 'minecraft:observer') {
    return {
      type: 'observer',
      facing: (props.facing ?? 'south') as any,
      powered: props.powered === 'true',
    } as BlockState
  }

  // コンテナ系 (barrel / chest / trapped_chest / shulker_box 等) → container。
  // NBT には内容 (充填率) が現れないため signal=0 で取り込む。
  if (
    name === 'minecraft:barrel' ||
    name === 'minecraft:chest' ||
    name === 'minecraft:trapped_chest' ||
    name.endsWith('shulker_box')
  ) {
    return { type: 'container', signal: 0, slots: buildSlots('container', items) } as BlockState
  }

  if (name === 'minecraft:hopper') {
    return {
      type: 'hopper',
      facing: (props.facing ?? 'down') as any,
      slots: buildSlots('hopper', items),
      enabled: props.enabled !== 'false',
    } as BlockState
  }

  if (name === 'minecraft:crafter') {
    return {
      type: 'crafter',
      facing: ((props.orientation ?? 'north_up').split('_')[0]) as any,
      triggered: props.triggered === 'true',
      occupiedSlots: 0,
    } as BlockState
  }
  if (name === 'minecraft:dropper' || name === 'minecraft:dispenser') {
    return {
      type: name === 'minecraft:dispenser' ? 'dispenser' : 'dropper',
      facing: (props.facing ?? 'north') as any,
      slots: buildSlots(name === 'minecraft:dispenser' ? 'dispenser' : 'dropper', items),
      triggered: props.triggered === 'true',
    } as BlockState
  }

  if (name === 'minecraft:lever') {
    return {
      type: 'lever',
      facing: faceFacingToDir6(props.face, props.facing),
      powered: props.powered === 'true',
    } as BlockState
  }

  // ボタン類 → 専用型 (石系 = stone_button / polished_blackstone_button、
  // その他木材系 = button_wood)。取付面は face/facing から復元する (#111)。
  // 押下状態は momentary で entity 由来のため常に OFF で取り込む。
  if (name.endsWith('_button')) {
    const isStone =
      name === 'minecraft:stone_button' || name === 'minecraft:polished_blackstone_button'
    return {
      type: isStone ? 'button_stone' : 'button_wood',
      facing: faceFacingToDir6(props.face, props.facing),
      powered: false,
    } as BlockState
  }

  // 感圧板 (踏まれ状態は entity 由来のため常に OFF で取り込む。initialize でも OFF 化される)
  if (name === 'minecraft:light_weighted_pressure_plate') {
    return { type: 'weighted_pressure_plate_light', powered: false, pressedPower: 15 } as BlockState
  }
  if (name === 'minecraft:heavy_weighted_pressure_plate') {
    return { type: 'weighted_pressure_plate_heavy', powered: false, pressedPower: 15 } as BlockState
  }
  if (name === 'minecraft:stone_pressure_plate') {
    return { type: 'pressure_plate_stone', powered: false } as BlockState
  }
  if (name.endsWith('_pressure_plate')) {
    // 木材各種はまとめて木の感圧板として取り込む
    return { type: 'pressure_plate_wood', powered: false } as BlockState
  }

  // 非導体 (#184)。solid より先に見る — `_slab` は接尾辞判定に引っかかるため
  const nonConductive = toNonConductiveBlockState(name, props)
  if (nonConductive) return nonConductive

  if (isSolidBlockName(name)) return { type: 'solid', powered: false } as BlockState

  return null
}

// ── コンテナの中身 (#194) ────────────────────────────────────────────────────

/** スタック上限が表に無かったアイテム ID。取り込みごとに集約して警告に出す */
const unknownStackItems = new Set<string>()

/**
 * block entity の Items → sim のスロット列 (#194)。
 *
 * コンパレーター強度は `Σ(個数/スタック上限) / スロット数` なので**上限が要る**。
 * 表に無い ID は 64 として扱い、`unknownStackItems` に積んで警告する。
 */
function buildSlots(type: BlockType, items: RawItem[] | undefined): ContainerSlots {
  const slots = emptySlots(type).slice()
  if (!items) return slots
  for (const it of items) {
    if (it.slot < 0 || it.slot >= slots.length) continue
    const { stack, known } = stackSizeOf(it.id)
    if (!known) unknownStackItems.add(it.id.replace(/^minecraft:/, ''))
    const id = it.id.replace(/^minecraft:/, '')
    slots[it.slot] = { id, stack, count: Math.min(it.count, stack) }
  }
  return slots
}

// ── 非導体ブロック (#184) ────────────────────────────────────────────────────
//
// 「フルブロックだが `isRedstoneConductor` が false」のもの。solid に落とすと
// **存在しない導通が生まれる**ため、専用の型に割り当てる。

/**
 * `glass` 型 (= 非導体フルブロック) に集約する名前。
 *
 * **実機ハーネスで 1 つずつ測って確定させた** (#184)。見た目や直感では判別できず、
 * 実際に半分外した:
 *   - 非導体: glass 系 / glowstone / sea_lantern / **ice**
 *   - 導体:   **packed_ice** / **blue_ice** / soul_sand / mud / magma_block / shroomlight
 * ice と packed_ice で結果が割れるので、名前の似ているものを勝手に仲間にしないこと。
 */
const GLASS_EXACT = new Set([
  'glass', 'tinted_glass',
  'glowstone', 'sea_lantern', 'ice',
])
/** 無色ガラスに集約するもの (色は sim で保持しない) */
const GLASS_SUFFIXES = ['_stained_glass']

function toNonConductiveBlockState(
  name: string, props: Record<string, string>,
): BlockState | null {
  const id = name.startsWith('minecraft:') ? name.slice('minecraft:'.length) : name

  if (GLASS_EXACT.has(id) || GLASS_SUFFIXES.some(s => id.endsWith(s))) {
    // ガラス板 (_pane) はフルブロックではないので対象外 (この分岐にも来ない)
    return { type: 'glass' } as BlockState
  }

  if (id.endsWith('_slab')) {
    // **二重スラブだけは導体**。当たり判定がフルブロックになるため
    // isRedstoneConductor の既定 (isCollisionShapeFullBlock) が true になる
    if (props.type === 'double') return { type: 'solid', powered: false } as BlockState
    return { type: 'slab', half: props.type === 'top' ? 'top' : 'bottom' } as BlockState
  }

  return null
}

// ── 固体ブロック (redstone conductor) の判定 ──────────────────────────────────
//
// レッドストーン的に効くのは「**導体のフルブロック**か」だけ (ダストが乗る /
// 強充電を受けて隣へ配る / ピストンに押される)。素材の違いは挙動に影響しない
// ので、該当するものは全部 solid 1 種に集約する。
//
// 逆に**フルブロックでも非導体**のもの (ガラス・色付きガラス・ハーフブロックなど。
// vanilla では `isRedstoneConductor` が false) は solid にすると**誤って導通する**。
// これらは toNonConductiveBlockState が専用の型 (glass / slab) に割り当てるので、
// ここには来ない (#184)。鉄格子のようにフルブロックですらないものは対象外で、
// 従来どおり未対応ブロックとして警告に出る。

/** 名前がそのまま一致する導体フルブロック */
const SOLID_EXACT = new Set([
  // 石・岩系
  'stone', 'cobblestone', 'mossy_cobblestone', 'smooth_stone',
  'granite', 'polished_granite', 'diorite', 'polished_diorite',
  'andesite', 'polished_andesite',
  'deepslate', 'cobbled_deepslate', 'polished_deepslate', 'chiseled_deepslate',
  'reinforced_deepslate', 'tuff', 'polished_tuff', 'chiseled_tuff',
  'calcite', 'dripstone_block', 'netherrack', 'end_stone', 'bedrock',
  'obsidian', 'crying_obsidian',
  'blackstone', 'polished_blackstone', 'chiseled_polished_blackstone', 'gilded_blackstone',
  'basalt', 'polished_basalt', 'smooth_basalt', 'magma_block',
  // 土・砂・氷系
  'dirt', 'coarse_dirt', 'rooted_dirt', 'grass_block', 'podzol', 'mycelium',
  'mud', 'packed_mud', 'clay', 'sand', 'red_sand', 'gravel',
  'soul_sand', 'soul_soil', 'snow_block', 'moss_block',
  // ice は非導体 (実機確認済み)。packed_ice / blue_ice は**導体**で挙動が違う
  'packed_ice', 'blue_ice',
  // 鉱物・金属ブロック (redstone_block は信号源なので上流で処理済み)
  'iron_block', 'gold_block', 'diamond_block', 'emerald_block', 'lapis_block',
  'coal_block', 'netherite_block', 'copper_block', 'amethyst_block',
  'raw_iron_block', 'raw_gold_block', 'raw_copper_block',
  // 石英・プルプァ・プリズマリン
  'quartz_block', 'smooth_quartz', 'quartz_bricks', 'quartz_pillar', 'chiseled_quartz_block',
  'purpur_block', 'purpur_pillar',
  'prismarine', 'prismarine_bricks', 'dark_prismarine',   // sea_lantern は非導体
  // 砂岩 (red_sandstone 等は接尾辞側で拾う)
  'sandstone',
  // 有機・その他フルブロック
  'bookshelf', 'chiseled_bookshelf', 'hay_block', 'dried_kelp_block', 'bone_block',
  'sponge', 'wet_sponge', 'melon', 'pumpkin', 'carved_pumpkin', 'jack_o_lantern',
  'nether_wart_block', 'warped_wart_block', 'shroomlight',   // glowstone は非導体
  'brown_mushroom_block', 'red_mushroom_block', 'mushroom_stem',
])

/** 接尾辞で一致する導体フルブロック */
const SOLID_SUFFIXES = [
  '_planks', '_log', '_wood', '_stem', '_hyphae',
  '_wool', '_concrete', '_concrete_powder', '_terracotta',
  '_bricks', '_sandstone', '_ore',
  '_copper', 'cut_copper',   // 酸化・蝋引きの各段階
]

/** 接尾辞に引っかかるが**フルブロックではない**ので除外するもの */
const NOT_SOLID_EXACT = new Set([
  'melon_stem', 'pumpkin_stem', 'attached_melon_stem', 'attached_pumpkin_stem',
])

function isSolidBlockName(name: string): boolean {
  const id = name.startsWith('minecraft:') ? name.slice('minecraft:'.length) : name
  if (NOT_SOLID_EXACT.has(id)) return false
  if (SOLID_EXACT.has(id)) return true
  if (SOLID_SUFFIXES.some(s => id.endsWith(s))) return true
  // ハーフブロックは #184 で非導体の slab 型に移した (二重スラブのみここへ来る前に
  // toNonConductiveBlockState が solid を返す)
  return false
}

// ── ファイルダウンロード ────────────────────────────────────────────────────

export function downloadNbt(bytes: Uint8Array, filename: string): void {
  const blob = new Blob([bytes as unknown as ArrayBuffer], { type: 'application/octet-stream' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// ── ファイル読み込み ────────────────────────────────────────────────────────

export function readFileAsUint8Array(file: File): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer))
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(file)
  })
}
