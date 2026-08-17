#!/usr/bin/env node
// ============================================================
// 音符ブロックの音色表を生成する (#231)
//
// sim は導体フルブロックを材質ごと `solid` 1 種に潰しているので、
// **音色 (直下ブロックで決まる) を材質から引けない**。取り込み時にこの表で
// 「そのブロックが上の音符ブロックへ与える音色」を拾って state に載せる。
//
// 出典: tools/decompile/out/<version>/net/minecraft/world/level/block/Blocks.java の
//       BlockBehaviour.Properties.instrument(NoteBlockInstrument.X)
// 使い方: node tools/gen-note-instruments.mjs [version]   (既定 26.2)
// ============================================================

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const version = process.argv[2] ?? '26.2'
const SOURCE = join(here, 'decompile/out', version,
  'net/minecraft/world/level/block/Blocks.java')
const OUT = join(here, '../packages/sim/src/blocks/noteInstrument.generated.ts')

const src = readFileSync(SOURCE, 'utf-8')

// `public static final Block LIGHT_BLUE_WOOL = register(...)` の宣言単位で切り、
// その範囲に instrument(...) があれば拾う。定数名の小文字化 = ブロック名という前提
// (色違い等の ColorCollection は個別名を持たないので拾えない — 下で補う)
const decls = [...src.matchAll(/public static final \w+(?:<[^>]*>)? ([A-Z0-9_]+) =/g)]
  .map(m => ({ at: m.index, name: m[1] }))
decls.push({ at: src.length, name: '<end>' })

const table = new Map()
for (let i = 0; i < decls.length - 1; i++) {
  const body = src.slice(decls[i].at, decls[i + 1].at)
  const m = body.match(/instrument\(NoteBlockInstrument\.([A-Z_]+)\)/)
  if (m) table.set(decls[i].name.toLowerCase(), m[1].toLowerCase())
}

// ColorCollection で一括登録される色付きブロック (羊毛など) は定数が 1 つしかないので、
// 代表名の音色を 16 色へ展開する
const COLORS = [
  'white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray',
  'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black',
]
for (const [base, suffix] of [['wool', 'wool'], ['concrete', 'concrete'],
  ['terracotta', 'terracotta'], ['stained_glass', 'stained_glass']]) {
  const inst = table.get(base)
  if (!inst) continue
  for (const c of COLORS) table.set(`${c}_${suffix}`, inst)
}

const entries = [...table].sort(([a], [b]) => (a < b ? -1 : 1))
const body = entries.map(([name, inst]) => `  ${name}: '${inst}',`).join('\n')

writeFileSync(OUT, `// 自動生成 — 手で編集しない (tools/gen-note-instruments.mjs)
// 出典: Minecraft ${version} Blocks.java の instrument(NoteBlockInstrument.X)
//
// 「そのブロックの**上に置かれた音符ブロック**が鳴らす音色」。
// 宣言の無いブロックは既定の harp なのでこの表に載らない。
// 値は vanilla の生の音色名。mob head 系 (zombie 等) も含むので、
// 使う側 (noteInstrumentOfBlockName) が harp へ落とす
export const NOTE_INSTRUMENT_BY_BLOCK: Readonly<Record<string, string>> = {
${body}
}
`)

const dist = {}
for (const [, inst] of entries) dist[inst] = (dist[inst] ?? 0) + 1
console.log(`${entries.length} 件を書き出した: ${OUT}`)
console.log('内訳:', Object.entries(dist).sort((a, b) => b[1] - a[1])
  .map(([k, v]) => `${k}=${v}`).join(' '))
