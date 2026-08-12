import type { BlockType, Dir6, HDir } from '@redstone/sim'

/**
 * ブロック種別ごとに許される向き (#111)。
 *
 * sim の型は素子ごとに取れる向きが違う (レバーは Dir6、リピーターは HDir、ホッパーは up 以外)。
 * grid.rotateBlock は `{ ...block, facing } as BlockState` で型検査を潰しているため、
 * ここで実行時に弾かないと「リピーターの facing が up」のような静かに壊れた状態が作れてしまう
 * (power.ts の `src.facing === toDir` が永久に false になり、無出力の素子になる)。
 */

const H: HDir[] = ['north', 'east', 'south', 'west']
const ALL: Dir6[] = [...H, 'up', 'down']

/** 取付面を選べる素子 = レバー・ボタン (床/壁/天井)。ピストン・オブザーバーも 6 方向 */
const DIR6_TYPES = new Set<BlockType>([
  'lever', 'button_stone', 'button_wood', 'piston', 'sticky_piston', 'observer',
])
/** 水平のみ。上下を入れると出力方向が消える */
const HDIR_TYPES = new Set<BlockType>(['repeater', 'comparator', 'wall_torch', 'dropper'])

export function allowedFacings(type: BlockType): Dir6[] {
  if (DIR6_TYPES.has(type)) return ALL
  if (HDIR_TYPES.has(type)) return H
  // ホッパーは真上へは向けない (types.ts の HopperState 注記)
  if (type === 'hopper') return [...H, 'down']
  // 床トーチは up 固定 (水平向きは wall_torch という別 type)
  if (type === 'torch') return ['up']
  return []
}

export function isFacingAllowed(type: BlockType, dir: Dir6): boolean {
  return allowedFacings(type).includes(dir)
}

/** 既定の向き。取付面を持つ素子は「床置き」= up が既定 */
export function defaultFacing(type: BlockType): Dir6 {
  if (type === 'lever' || type === 'button_stone' || type === 'button_wood' || type === 'torch') return 'up'
  if (type === 'hopper') return 'down'
  return 'north'
}

/** HDir しか取れない素子向け。up/down が来たら既定の水平へ落とす */
export function toHDir(dir: Dir6 | undefined, fallback: HDir = 'north'): HDir {
  return dir === undefined || dir === 'up' || dir === 'down' ? fallback : dir
}
