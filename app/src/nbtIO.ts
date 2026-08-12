/**
 * NBT エクスポート / インポート ユーティリティ
 *
 * エクスポート: CircuitEditor の BlockState → Minecraft バニラ構造 NBT (.nbt)
 * インポート : バニラ構造 NBT → CircuitEditor の BlockState
 */

import {
  NbtFile, NbtCompound, NbtList, NbtInt, NbtString,
} from 'deepslate/nbt'
import { Structure } from 'deepslate'
import type { BlockState } from '@redstone/sim'

const FACING_OPPOSITE: Record<string, string> = {
  north: 'south', south: 'north', east: 'west', west: 'east',
}

/**
 * プロジェクトの BlockState.wall_torch.facing は「土台の方向」（取り付き
 * 面の方向）で、vanilla NBT の facing「torch が向く方向」と逆になっている
 * （redstone-lib の torch.ts コメント参照）。export/import 境界で反転して
 * NBT のみ vanilla 互換にし、内部規約は維持する。
 *
 * repeater / comparator は redstone-lib 内でも facing = 出力方向
 * （isRepeaterInputPowered が OPPOSITE[block.facing] を input dir として
 * いることで確認済）で vanilla と一致するため、ここでは反転しない。
 */
function flipFacingForVanillaNbt(facing: string | undefined): string {
  if (!facing) return 'north'
  return FACING_OPPOSITE[facing] ?? facing
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

  const blockEntries: Array<{ x: number; y: number; z: number; state: number }> = []
  let maxY = 0

  for (const [key, block] of blocks) {
    const [x, y, z] = key.split(',').map(Number)
    const [name, props] = blockStateToMinecraft(block)
    const state = getOrAdd(name, props)
    blockEntries.push({ x, y, z, state })
    if (y > maxY) maxY = y
  }

  // palette リスト
  const paletteList = new NbtList<NbtCompound>(paletteCompounds)

  // blocks リスト
  const blocksList = new NbtList<NbtCompound>(
    blockEntries.map(({ x, y, z, state }) => {
      const c = new NbtCompound()
      c.set('state', new NbtInt(state))
      const pos = new NbtList<NbtInt>([new NbtInt(x), new NbtInt(y), new NbtInt(z)])
      c.set('pos', pos)
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

export interface ImportResult {
  /** エディタ用ブロックマップ (key: "x,y,z") */
  blocks: Map<string, BlockState>
  /** 省略・非対応など、利用者へ伝える警告 (種類ごとに集約済み) */
  warnings: string[]
  /** 取り込めたブロックのバウンディングボックスサイズ [sx, sy, sz]。0 個なら [0,0,0] */
  size: [number, number, number]
}

/**
 * バニラ構造 NBT バイト列 → エディタブロックマップ。
 *
 * bounds を渡すと盤面 (gridW×gridH×maxLayers) に収まらないブロックを省略し、
 * 省略数・非対応ブロックを種類ごとに集約した警告を返す。埋め込み表示 (#97) では
 * この警告を親ページへ渡し、「n 個を簡略化しました」と提示する。
 */
export function importFromNbtBytes(bytes: Uint8Array, bounds: ImportBounds = {}): ImportResult {
  const { gridW, gridH, maxLayers } = bounds
  const nbt = NbtFile.read(bytes)
  const structure = Structure.fromNbt(nbt.root)

  const resultBlocks = new Map<string, BlockState>()
  const warnings: string[] = []
  let skippedAbove = 0
  let skippedOutOfBounds = 0
  // 非対応ブロックは種類ごとに件数を集約する (1 個ずつ列挙すると警告が溢れるため)
  const unsupported = new Map<string, number>()

  let minX = Infinity, minY = Infinity, minZ = Infinity
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity

  for (const placed of structure.getBlocks()) {
    const [bx, by, bz] = placed.pos as [number, number, number]
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

    const name = placed.state.getName().toString()
    const props = placed.state.getProperties() as Record<string, string>

    const block = minecraftToBlockState(name, props)
    if (!block) {
      // air 亜種 (cave_air / void_air) は空セル扱いで無警告 (通常の air と同様)
      const isAir = name === 'minecraft:air' || name.endsWith('_air')
      if (!isAir) unsupported.set(name, (unsupported.get(name) ?? 0) + 1)
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

  if (unsupported.size > 0) {
    const total = [...unsupported.values()].reduce((a, b) => a + b, 0)
    const kinds = [...unsupported.keys()].map((n) => n.replace('minecraft:', '')).join(', ')
    warnings.push(`未対応ブロック ${total} 個 (${unsupported.size} 種: ${kinds}) を省略`)
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
    case 'repeater':
      return ['minecraft:repeater', {
        facing:  (block as any).facing ?? 'north',
        delay:   String((block as any).delay ?? 1),
        locked:  'false',
        powered: String((block as any).powered ?? false),
      }]
    case 'comparator':
      return ['minecraft:comparator', {
        facing:  (block as any).facing ?? 'north',
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
    case 'dropper':
      return ['minecraft:dropper', {
        facing: (block as any).facing ?? 'north',
        triggered: String((block as any).triggered ?? false),
      }]
    case 'lever':
      return ['minecraft:lever', {
        face:    'floor',
        facing:  'south',
        powered: String((block as any).powered ?? false),
      }]
    case 'button_stone':
      // 床ボタン固定 (face=floor)。感圧板と同様に専用型で往復する (#54)
      return ['minecraft:stone_button', {
        face:    'floor',
        facing:  'south',
        powered: String(block.powered),
      }]
    case 'button_wood':
      return ['minecraft:oak_button', {
        face:    'floor',
        facing:  'south',
        powered: String(block.powered),
      }]
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
    default:
      return ['minecraft:air', {}]
  }
}

// ── Minecraft → BlockState 変換 ─────────────────────────────────────────────

function minecraftToBlockState(
  name: string,
  props: Record<string, string>,
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
    const facing = (props.facing ?? 'north') as any
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
    const facing = (props.facing ?? 'north') as any
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
    return { type: 'container', signal: 0 } as BlockState
  }

  if (name === 'minecraft:hopper') {
    return {
      type: 'hopper',
      facing: (props.facing ?? 'down') as any,
      count: 0,
      enabled: props.enabled !== 'false',
    } as BlockState
  }

  if (name === 'minecraft:dropper') {
    return {
      type: 'dropper',
      facing: (props.facing ?? 'north') as any,
      count: 0,
      triggered: props.triggered === 'true',
    } as BlockState
  }

  if (name === 'minecraft:lever') {
    return { type: 'lever', facing: 'up', powered: props.powered === 'true' } as BlockState
  }

  // ボタン類 → 専用型 (石系 = stone_button / polished_blackstone_button、
  // その他木材系 = button_wood)。editor は床ボタンのみ扱うため facing='up' 固定
  // (踏まれ状態は entity 由来のため常に OFF で取り込む)。
  if (name.endsWith('_button')) {
    const isStone =
      name === 'minecraft:stone_button' || name === 'minecraft:polished_blackstone_button'
    return {
      type: isStone ? 'button_stone' : 'button_wood',
      facing: 'up',
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

  // 固体ブロック一覧
  const solidBlocks = [
    'minecraft:stone', 'minecraft:cobblestone', 'minecraft:smooth_stone',
    'minecraft:granite', 'minecraft:diorite', 'minecraft:andesite',
    'minecraft:deepslate', 'minecraft:tuff', 'minecraft:calcite',
    'minecraft:dirt', 'minecraft:sand', 'minecraft:gravel',
    'minecraft:oak_planks', 'minecraft:spruce_planks', 'minecraft:birch_planks',
    'minecraft:jungle_planks', 'minecraft:acacia_planks', 'minecraft:dark_oak_planks',
    'minecraft:crimson_planks', 'minecraft:warped_planks',
    'minecraft:bricks', 'minecraft:nether_bricks', 'minecraft:quartz_block',
    'minecraft:iron_block', 'minecraft:gold_block', 'minecraft:diamond_block',
    'minecraft:emerald_block', 'minecraft:coal_block', 'minecraft:copper_block',
    'minecraft:obsidian', 'minecraft:crying_obsidian',
    'minecraft:slime_block', 'minecraft:honey_block',
  ]
  if (solidBlocks.includes(name) || name.endsWith('_slab') || name.endsWith('_concrete') || name.endsWith('_terracotta')) {
    return { type: 'solid', powered: false } as BlockState
  }

  return null
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
