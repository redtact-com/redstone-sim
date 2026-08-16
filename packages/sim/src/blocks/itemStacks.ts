// ============================================================
// アイテム ID → スタック上限 (#194)
//
// レッドストーン的に効くのはスタック上限だけなので、上限 1 / 16 のものだけを
// 列挙し、**表に無いものは 64** として扱う。全アイテムの列挙はしない。
//
// [確定: 実機測定 (#194) — ホッパー 5 スロットのコンパレーター強度が
//  iron_axe 1 個 = 3 / snowball 1 個 = 1 / gold_ingot 1 個 = 1 と割れる]
// ============================================================

import type { StackSize } from '../types.js'

/** 上限 16 のアイテム [26.2 Items の maxStackSize(16)]。 */
const STACK_16 = new Set([
  'snowball', 'ender_pearl', 'egg', 'armor_stand', 'written_book',
  'honey_bottle', 'sign', 'hanging_sign',
  // 空バケツだけ 16。水/溶岩/魚入りは 1 で、下の _bucket 接尾辞が拾う
  'bucket',
])

/** 上限 16 になる接尾辞 (木材ごとの看板など)。 */
const STACK_16_SUFFIX = ['_sign', '_hanging_sign']

/**
 * 上限 1 のアイテム (スタック不可)。道具・防具・ポーション・乗り物など。
 * 接尾辞で拾えるものは下の表に寄せる。
 */
const STACK_1 = new Set([
  'bow', 'crossbow', 'trident', 'shield', 'elytra', 'fishing_rod', 'flint_and_steel',
  'shears', 'carrot_on_a_stick', 'warped_fungus_on_a_stick', 'brush', 'spyglass',
  'saddle', 'bundle', 'lodestone_compass', 'writable_book', 'knowledge_book',
  'enchanted_book', 'filled_map', 'cake', 'beacon', 'conduit',
  'water_bucket', 'lava_bucket', 'powder_snow_bucket', 'milk_bucket',
  'mushroom_stew', 'rabbit_stew', 'beetroot_soup', 'suspicious_stew',
  'potion', 'splash_potion', 'lingering_potion', 'experience_bottle',
  'totem_of_undying', 'debug_stick',
])

/** 上限 1 になる接尾辞。 */
const STACK_1_SUFFIX = [
  '_sword', '_pickaxe', '_axe', '_shovel', '_hoe',
  '_helmet', '_chestplate', '_leggings', '_boots',
  '_horse_armor', '_boat', '_chest_boat', '_raft', '_chest_raft',
  '_minecart', '_bed', '_banner_pattern', '_bucket',
  '_shulker_box',
]

/** 上限 1 になる接頭辞。 */
const STACK_1_PREFIX = ['music_disc_']

/**
 * **64 と分かっている**アイテム。ホッパータイマーの詰め物によく使われるものを
 * 中心に列挙する。ここに無いものも 64 として扱うが `known=false` になり、
 * 取り込み時に「64 として扱った」旨の警告が出る (#194 の判断 3)。
 */
const STACK_64 = new Set([
  'cobblestone', 'stone', 'dirt', 'sand', 'gravel', 'netherrack', 'obsidian',
  'redstone', 'iron_ingot', 'gold_ingot', 'diamond', 'emerald', 'coal', 'charcoal',
  'stick', 'string', 'gunpowder', 'glowstone_dust', 'quartz', 'lapis_lazuli',
  'arrow', 'bone', 'blaze_rod', 'paper', 'leather', 'feather', 'flint',
  'wheat', 'bread', 'apple', 'carrot', 'potato', 'melon_slice',
  'player_head', 'skeleton_skull', 'zombie_head', 'creeper_head', 'wither_skeleton_skull',
  'dragon_head', 'piglin_head',
])

/** 64 と分かっている接尾辞 (ブロック類はほぼ 64)。 */
const STACK_64_SUFFIX = [
  '_planks', '_log', '_wood', '_wool', '_concrete', '_terracotta', '_block',
  '_ingot', '_nugget', '_dust', '_ore', '_bricks', '_slab', '_stairs', '_glass',
]

/**
 * アイテム ID → スタック上限。**表に無いものは 64**。
 * `known=false` のときは呼び出し側が警告を出す (#194 の判断 3)。
 */
export function stackSizeOf(id: string): { stack: StackSize; known: boolean } {
  const name = id.startsWith('minecraft:') ? id.slice('minecraft:'.length) : id

  if (STACK_1.has(name)) return { stack: 1, known: true }
  // **空バケツだけ 16**、水/溶岩/魚入りバケツは 1。接尾辞判定より先に見る
  if (name === 'bucket') return { stack: 16, known: true }
  if (STACK_1_SUFFIX.some(s => name.endsWith(s))) return { stack: 1, known: true }
  if (STACK_1_PREFIX.some(s => name.startsWith(s))) return { stack: 1, known: true }
  if (STACK_16.has(name)) return { stack: 16, known: true }
  if (STACK_16_SUFFIX.some(s => name.endsWith(s))) return { stack: 16, known: true }
  if (STACK_64.has(name)) return { stack: 64, known: true }
  if (STACK_64_SUFFIX.some(s => name.endsWith(s))) return { stack: 64, known: true }

  // 判別できないものは 64。呼び出し側が警告を出す
  return { stack: 64, known: false }
}

/**
 * エディタが置く代表アイテム (#194 の判断 2: エディタはスタック種別ごとに 1 種でよい)。
 * 実ファイル取り込みでは本物の ID がそのまま入る。
 */
export const REPRESENTATIVE_ITEM: Record<StackSize, string> = {
  64: 'cobblestone',
  16: 'snowball',
  1: 'iron_axe',
}
