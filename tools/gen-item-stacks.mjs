#!/usr/bin/env node
// ============================================================
// アイテム ID → スタック上限の表を mcmeta から生成する (#202)
//
// 手書きの表では上限 16 のアイテムを取りこぼし、コンパレーター強度が黙って
// ずれる恐れがあった。mcmeta には全アイテムの `minecraft:max_stack_size` が
// 入っているのでそれを正とする。
//
//   npm run gen-item-stacks
//
// 生成物はコミットする (実行時にネットワークへ出ない)。
// バージョンはハーネスの実機 (1.21.1) に合わせる。viewer アセットが 1.21.4、
// デコンパイル典拠が 26.2 という版差はプロジェクト全体の既知の課題。
// ============================================================

import { writeFileSync } from 'node:fs'

const MC_VERSION = process.env.MC_VERSION ?? '1.21.1'
const SOURCE_URL = `https://raw.githubusercontent.com/misode/mcmeta/${MC_VERSION}-summary/item_components/data.json`

const res = await fetch(SOURCE_URL)
if (!res.ok) throw new Error(`mcmeta の取得に失敗: ${res.status} ${SOURCE_URL}`)
const data = await res.json()

const byStack = { 1: [], 16: [], 64: [] }
for (const [id, comps] of Object.entries(data)) {
  const n = comps['minecraft:max_stack_size'] ?? 64
  if (!byStack[n]) throw new Error(`想定外のスタック上限 ${n} (${id})`)
  byStack[n].push(id)
}
for (const k of Object.keys(byStack)) byStack[k].sort()

const total = Object.values(byStack).reduce((a, b) => a + b.length, 0)
if (total < 1000) throw new Error(`アイテム数が少なすぎる (${total})。取得内容を確認すること`)

/** 1 行あたり ~90 桁で折り返して並べる */
const fmt = (ids) => {
  const lines = []
  let cur = '  '
  for (const id of ids) {
    const tok = `'${id}',`
    if (cur.length + tok.length > 92) { lines.push(cur.trimEnd()); cur = '  ' }
    cur += tok + ' '
  }
  if (cur.trim()) lines.push(cur.trimEnd())
  return lines.join('\n')
}

const out = `// ============================================================
// 自動生成 — 手で編集しないこと (#202)
//
// 生成元: ${SOURCE_URL}
// 生成コマンド: npm run gen-item-stacks
// Minecraft ${MC_VERSION} / アイテム ${total} 種
//   上限 1: ${byStack[1].length} 種 / 上限 16: ${byStack[16].length} 種 / 上限 64: ${byStack[64].length} 種
//
// 表に無い ID は 64 として扱い、警告を出す (生成元より新しい / MOD のアイテム)。
// ============================================================

/** スタック上限 1 (スタック不可) のアイテム。 */
export const STACK_1_IDS: readonly string[] = [
${fmt(byStack[1])}
]

/** スタック上限 16 のアイテム。 */
export const STACK_16_IDS: readonly string[] = [
${fmt(byStack[16])}
]

/**
 * スタック上限 64 のアイテム。
 *
 * 判定自体は「1 でも 16 でもなければ 64」で足りるが、**未知アイテムの警告**を
 * 出すために「このバージョンに存在した ID」を知る必要があるので列挙する。
 */
export const STACK_64_IDS: readonly string[] = [
${fmt(byStack[64])}
]

/** 生成元の Minecraft バージョン (テストで参照する)。 */
export const ITEM_STACK_MC_VERSION = '${MC_VERSION}'

/** 生成時点の全アイテム数 (取得内容が壊れていないかの目安)。 */
export const ITEM_STACK_TOTAL = ${total}
`

const dest = new URL('../packages/sim/src/blocks/itemStacks.generated.ts', import.meta.url)
writeFileSync(dest, out)
console.log(`生成: ${dest.pathname}`)
console.log(`  MC ${MC_VERSION} / 全 ${total} 種 (1:${byStack[1].length} / 16:${byStack[16].length} / 64:${byStack[64].length})`)
