import type { BlockType } from '@redstone/sim'
import { containerSlots } from '@redstone/sim'
import type { PlaceableType, PlaceOptions } from './editor.js'
import { allowedFacings, defaultFacing } from './facing.js'

/**
 * 「置けるブロック」と配置オプションの実行時定義 (#115)。
 *
 * これまで型 (`PlaceableType` / `PlaceOptions`) しか公開しておらず、実行時に
 * 列挙・検証する手段が無かった。下流はブロック種 16 個と各オプションの範囲を
 * 手写ししており、こちらが増減しても型エラーにならず静かにドリフトしていた。
 */

/** placeBlock が受け付けるブロック種。buildBlockState が対応する型と一致させる */
export const PLACEABLE_TYPES = [
  'wire', 'torch', 'wall_torch', 'repeater', 'comparator',
  'lever', 'button_stone', 'button_wood',
  'pressure_plate_wood', 'pressure_plate_stone',
  'weighted_pressure_plate_light', 'weighted_pressure_plate_heavy',
  'lamp', 'note_block', 'copper_bulb', 'piston', 'sticky_piston',
  'trapdoor_wood', 'trapdoor_iron', 'fence_gate', 'door_wood', 'door_iron',
  'redstone_block', 'target', 'observer', 'solid', 'glass', 'slab',
  'slime_block', 'honey_block', 'rail', 'powered_rail', 'activator_rail', 'detector_rail',
  'container', 'hopper', 'dropper', 'dispenser', 'crafter',
] as const satisfies readonly PlaceableType[]

const PLACEABLE_SET: ReadonlySet<string> = new Set(PLACEABLE_TYPES)

export function isPlaceableType(v: unknown): v is PlaceableType {
  return typeof v === 'string' && PLACEABLE_SET.has(v)
}

/** 数値オプションの範囲。UI とバリデータでこの 1 か所を見る */
export const PLACE_OPTION_RANGES = {
  delay: { min: 1, max: 4 },
  /** 重量感圧板が踏まれたときの出力 */
  pressedPower: { min: 1, max: 15 },
  /** コンテナがコンパレーター背面から読まれる実効出力 */
  signal: { min: 0, max: 15 },
} as const

/**
 * 個数を持てる型か (ホッパー/ドロッパー/コンテナ)。
 * 上限はスタック上限に依存するので**最大の 64 スタック基準**で返す (#194)。
 * 実際に置ける個数は選んだスタック種別で決まり、slotsFromCount が切り詰める。
 */
export function maxCount(type: BlockType): number {
  return type === 'hopper' || type === 'dropper' || type === 'dispenser'
    || type === 'container'
    ? containerSlots(type) * 64
    : 0
}

const clamp = (v: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, Math.round(v)))

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/**
 * 配置オプションを型に合わせて正規化する。
 *
 * - その型が持たないオプションは落とす (リピーターに signal 等)
 * - 数値は範囲へ丸める (壊れた保存データや外部入力をそのまま通さない)
 * - 許されない向きは既定へ落とす ([[facing.ts]] と同じ規則)
 */
export function normalizePlaceOptions(type: BlockType, opts: PlaceOptions = {}): PlaceOptions {
  const out: PlaceOptions = {}

  const dirs = allowedFacings(type)
  if (dirs.length > 0) {
    out.facing = opts.facing !== undefined && dirs.includes(opts.facing)
      ? opts.facing
      : defaultFacing(type)
  }

  if (type === 'repeater' && isNum(opts.delay)) {
    const { min, max } = PLACE_OPTION_RANGES.delay
    out.delay = clamp(opts.delay, min, max) as 1 | 2 | 3 | 4
  }

  if (type === 'comparator' && (opts.mode === 'compare' || opts.mode === 'subtract')) {
    out.mode = opts.mode
  }

  if ((type === 'weighted_pressure_plate_light' || type === 'weighted_pressure_plate_heavy')
      && isNum(opts.pressedPower)) {
    const { min, max } = PLACE_OPTION_RANGES.pressedPower
    out.pressedPower = clamp(opts.pressedPower, min, max)
  }

  if (type === 'container' && isNum(opts.signal)) {
    const { min, max } = PLACE_OPTION_RANGES.signal
    out.signal = clamp(opts.signal, min, max)
  }

  const cap = maxCount(type)
  if (cap > 0) {
    // スタック上限 (#194) を先に確定させてから個数を丸める。
    // 実際に入る個数は スロット数 × スタック上限 が上限になる
    if (opts.stack === 1 || opts.stack === 16 || opts.stack === 64) out.stack = opts.stack
    const stack = out.stack ?? 64
    if (isNum(opts.count)) out.count = clamp(opts.count, 0, containerSlots(type) * stack)
  }

  return out
}
