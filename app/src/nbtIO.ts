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

export interface ImportResult {
  /** エディタ用ブロックマップ (key: "x,y,z") */
  blocks: Map<string, BlockState>
  warnings: string[]
}

/** バニラ構造 NBT バイト列 → エディタブロックマップ（全レイヤー） */
export function importFromNbtBytes(bytes: Uint8Array, maxLayers?: number): ImportResult {
  const nbt = NbtFile.read(bytes)
  const structure = Structure.fromNbt(nbt.root)

  const resultBlocks = new Map<string, BlockState>()
  const warnings: string[] = []
  let skippedAbove = 0

  for (const placed of structure.getBlocks()) {
    const [bx, by, bz] = placed.pos as [number, number, number]
    if (maxLayers !== undefined && by >= maxLayers) {
      skippedAbove++
      continue
    }

    const name = placed.state.getName().toString()
    const props = placed.state.getProperties() as Record<string, string>

    const block = minecraftToBlockState(name, props)
    if (!block) {
      if (name !== 'minecraft:air') warnings.push(`未対応ブロック: ${name}`)
      continue
    }
    resultBlocks.set(`${bx},${by},${bz}`, block)
  }

  if (skippedAbove > 0) warnings.push(`高さ上限超過で ${skippedAbove} ブロックを省略`)

  return { blocks: resultBlocks, warnings }
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
    case 'redstone_block':
      return ['minecraft:redstone_block', {}]
    case 'target':
      return ['minecraft:target', { power: String(block.outputPower) }]
    case 'container':
      // コンテナは barrel として書き出す (signal は NBT に現れないため破棄)
      return ['minecraft:barrel', {}]
    case 'lever':
      return ['minecraft:lever', {
        face:    'floor',
        facing:  'south',
        powered: String((block as any).powered ?? false),
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

  if (name === 'minecraft:redstone_block') {
    return { type: 'redstone_block' } as BlockState
  }

  if (name === 'minecraft:target') {
    return { type: 'target', outputPower: Number(props.power ?? 0) } as BlockState
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

  if (name === 'minecraft:lever') {
    return { type: 'lever', facing: 'up', powered: props.powered === 'true' } as BlockState
  }

  // レバーとして扱えるボタン類
  if (name.endsWith('_button')) {
    const facing = (props.facing ?? 'north') as any
    return { type: 'lever', facing, powered: false } as BlockState
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
