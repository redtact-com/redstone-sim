// ============================================================
// アイテム ID → スタック上限 (#194 / #202)
//
// レッドストーン的に効くのはスタック上限だけ。実機の値は **1 / 16 / 64 の 3 種類
// しかない** ことを mcmeta 全 1333 アイテムで確認した。
//
// [確定: 実機測定 (#194) — ホッパー 5 スロットのコンパレーター強度が
//  iron_axe 1 個 = 3 / snowball 1 個 = 1 / gold_ingot 1 個 = 1 と割れる]
//
// 表は mcmeta から自動生成する (#202)。`npm run gen-item-stacks` で
// itemStacks.generated.ts を作り直す。**手書きの表は取りこぼしが出て
// コンパレーター強度が黙ってずれる**ため廃止した。
// ============================================================

import type { StackSize } from '../types.js'
import { STACK_1_IDS, STACK_16_IDS, STACK_64_IDS } from './itemStacks.generated.js'

const STACK_1 = new Set(STACK_1_IDS)
const STACK_16 = new Set(STACK_16_IDS)
const STACK_64 = new Set(STACK_64_IDS)

/**
 * アイテム ID → スタック上限。
 *
 * 生成表はそのバージョンの全アイテムを網羅しているので、どれにも無い ID は
 * **生成元より新しいアイテムか MOD** ということになる。その場合は 64 として扱い
 * `known=false` を返す。呼び出し側 (nbtIO) がまとめて警告する (#194 の判断 3)。
 */
export function stackSizeOf(id: string): { stack: StackSize; known: boolean } {
  const name = id.startsWith('minecraft:') ? id.slice('minecraft:'.length) : id
  if (STACK_1.has(name)) return { stack: 1, known: true }
  if (STACK_16.has(name)) return { stack: 16, known: true }
  return { stack: 64, known: STACK_64.has(name) }
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
