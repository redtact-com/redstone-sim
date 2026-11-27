/**
 * AI 向けの索引 (#434)。検索と同じ生成器が同じビルドで出す (`data/ai/`)。
 *
 * | ファイル | 中身 |
 * |---|---|
 * | `ai/sections.jsonl` | 節 1 件 = 1 行 (SectionRecord)。本文は md のまま |
 * | `ai/by-class.json` | クラス → 節。00 の網羅表の担当欄が主、本文に名前が出る節は補助 (`mentions`) |
 * | `ai/by-fixture.json` | fixture → 節。skip つきには理由を入れる |
 * | `ai/by-block.json` | ブロック ID・和名 → クラス → 節 (blocks.json の手書きの表) |
 * | `ai/README.md` | 欄の説明と引き方 |
 *
 * 索引は docs の文から機械で作るだけで、リポには入れない。引く関数 (`lookupBlock` ほか) は
 * CLI (`npm run docs:search`) が使う。のちの MCP も同じ関数を包む。
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DOCS_DATA_VERSION } from '../../packages/docs-kit/src/types.js'
import type { FixtureInfo, SectionRecord } from '../../packages/docs-kit/src/types.js'
import { docOf } from '../../packages/docs-kit/src/ids.js'
import { COVERAGE_DOC, readCoverage } from './classes.js'
import type { Coverage } from './classes.js'
import { FIXTURE_DIR } from './fixtures.js'
import type { Model } from './split.js'

/** ブロックの手書きの表 (リポ相対)。追跡する */
export const BLOCKS_FILE = 'tools/docs-index/blocks.json'

/** blocks.json の 1 行 */
export interface BlockRow {
  /** 代表のブロック ID (`minecraft:` なし)。先頭がこの行の名前 */
  ids: string[]
  /** この語で終わる ID 全部をこの行で受ける (色・材質ちがい。`_button`) */
  suffix?: string
  /** 和名と通称 */
  ja: string[]
  /** クラスの単純な名前 (00 の網羅表にある物) */
  classes: string[]
}

export interface BlocksTable {
  note: string
  blocks: BlockRow[]
}

export function loadBlocksTable(root: string): BlocksTable {
  return JSON.parse(readFileSync(join(root, BLOCKS_FILE), 'utf-8')) as BlocksTable
}

/** by-class.json の 1 件 */
export interface ClassEntry {
  /** 網羅表に書いてある形 (`entity/HopperBlockEntity`) */
  written: string
  /** 状態 (`記述済`・`対象外`) と、担当欄の文 (対象外なら理由) */
  state: string
  owner: string
  /** 網羅表の行がある節と md の行 */
  row: string
  line: number
  /** メモ全体が担当 (`v07`) */
  docs: string[]
  /** 担当の節 (族の節を含む) */
  sections: string[]
  /** 担当欄の裸の族 (`F4`) */
  families: string[]
  /** 補助: 見出しか本文にクラス名が出る節 (担当の節と網羅表を除く・md の順)。広いので主には使わない */
  mentions: string[]
}

export interface ByClass {
  v: number
  source: string
  classes: Record<string, ClassEntry>
}

/** by-fixture.json の 1 件 */
export interface FixtureEntry extends FixtureInfo {
  /** fixture の JSON (リポ相対) */
  file: string
}

export interface ByFixture {
  v: number
  fixtures: Record<string, FixtureEntry>
}

/** by-block.json の 1 件 */
export interface BlockEntry extends BlockRow {
  docs: string[]
  sections: string[]
}

export interface ByBlock {
  v: number
  note: string
  /** 鍵は行の名前 (`ids` の先頭) */
  blocks: Record<string, BlockEntry>
  /** ブロック ID・和名 (小文字) → 行の名前 */
  lookup: Record<string, string>
  /** 語尾 → 行の名前 (長い語尾が先) */
  suffixes: [string, string][]
}

export interface AiIndex {
  coverage: Coverage
  byClass: ByClass
  byFixture: ByFixture
  byBlock: ByBlock
  /** クラスとブロックを埋めた節の記録 (md の順) */
  records: SectionRecord[]
  byId: Map<string, SectionRecord>
  /** 出すファイル (`data/` からの相対パス → 中身) */
  files: Map<string, string>
}

const uniq = <T>(list: readonly T[]): T[] => [...new Set(list)]

/** 引く時の鍵の寄せ方: 全角を半角に・小文字に・`minecraft:` を外す・空白を `_` に (英字の ID の時) */
export function normalizeKey(raw: string): string {
  const s = raw.normalize('NFKC').trim().toLowerCase().replace(/^minecraft:/, '')
  return /^[a-z0-9_ -]+$/.test(s) ? s.replace(/[ -]+/g, '_') : s
}

/** AI 向けの索引を組み立てる (ファイルは書かない) */
export function buildAi(
  model: Model,
  records: readonly SectionRecord[],
  fixtures: Readonly<Record<string, FixtureInfo>>,
  table: BlocksTable,
): AiIndex {
  const coverage = readCoverage(model)
  const intro = new Map(model.docs.map(d => [d.groups[0].id, d.source.key]))

  // クラス → 節
  const names = new Set(coverage.rows.map(r => r.name))
  const mentions = new Map<string, string[]>()
  for (const r of records) {
    if (docOf(r.id) === COVERAGE_DOC) continue
    const seen = new Set((`${r.title}\n${r.text}`.match(/[A-Z][A-Za-z0-9]+/g) ?? []).filter(w => names.has(w)))
    for (const w of seen) {
      const list = mentions.get(w) ?? []
      list.push(r.id)
      mentions.set(w, list)
    }
  }
  const classes: Record<string, ClassEntry> = {}
  for (const row of coverage.rows) {
    const own = new Set(row.sections)
    classes[row.name] = {
      written: row.written, state: row.state, owner: row.owner, row: row.row, line: row.line,
      docs: uniq(row.sections.filter(id => intro.has(id)).map(id => intro.get(id)!)),
      sections: row.sections.filter(id => !intro.has(id)),
      families: row.families,
      mentions: (mentions.get(row.name) ?? []).filter(id => !own.has(id)),
    }
  }
  const byClass: ByClass = { v: DOCS_DATA_VERSION, source: model.docs.find(d => d.source.key === COVERAGE_DOC)?.source.file ?? '', classes }

  // fixture → 節
  const byFixture: ByFixture = { v: DOCS_DATA_VERSION, fixtures: {} }
  for (const [name, info] of Object.entries(fixtures)) {
    byFixture.fixtures[name] = { file: `${FIXTURE_DIR}/${name}.json`, ...info }
  }

  // ブロック → クラス → 節
  const byBlock: ByBlock = { v: DOCS_DATA_VERSION, note: table.note, blocks: {}, lookup: {}, suffixes: [] }
  for (const row of table.blocks) {
    const name = row.ids[0]
    const known = row.classes.map(c => classes[c]).filter((c): c is ClassEntry => c !== undefined)
    byBlock.blocks[name] = {
      ...row,
      docs: uniq(known.flatMap(c => c.docs)),
      sections: uniq(known.flatMap(c => c.sections)),
    }
    for (const key of [...row.ids, ...row.ja]) byBlock.lookup[normalizeKey(key)] = name
    if (row.suffix) byBlock.suffixes.push([row.suffix, name])
  }
  byBlock.suffixes.sort((a, b) => b[0].length - a[0].length || a[0].localeCompare(b[0]))

  // 節の記録にクラスとブロックを入れる (メモ全体が担当の物は、前置きの節に入れる)
  const classesOf = new Map<string, string[]>()
  const blocksOf = new Map<string, string[]>()
  const push = (map: Map<string, string[]>, id: string, value: string) => {
    const list = map.get(id) ?? []
    if (!list.includes(value)) list.push(value)
    map.set(id, list)
  }
  const introOf = new Map([...intro].map(([id, key]) => [key, id]))
  for (const [name, c] of Object.entries(classes)) {
    for (const id of [...c.docs.map(d => introOf.get(d)!), ...c.sections]) push(classesOf, id, name)
  }
  for (const [name, b] of Object.entries(byBlock.blocks)) {
    for (const id of [...b.docs.map(d => introOf.get(d)!), ...b.sections]) push(blocksOf, id, name)
  }
  const filled = records.map(r => ({
    ...r,
    classes: classesOf.get(r.id) ?? [],
    blocks: blocksOf.get(r.id) ?? [],
  }))

  const files = new Map<string, string>()
  const skipped = new Set(Object.entries(fixtures).filter(([, f]) => f.skip !== undefined).map(([name]) => name))
  files.set('ai/sections.jsonl', filled.map(r => JSON.stringify(jsonlRow(r, skipped))).join('\n') + '\n')
  files.set('ai/by-class.json', JSON.stringify(byClass))
  files.set('ai/by-fixture.json', JSON.stringify(byFixture))
  files.set('ai/by-block.json', JSON.stringify(byBlock))
  files.set('ai/README.md', readme(filled.length, byClass, byFixture, byBlock))
  return {
    coverage, byClass, byFixture, byBlock,
    records: filled, byId: new Map(filled.map(r => [r.id, r])), files,
  }
}

/** sections.jsonl の 1 行 (節の記録 + skip つきの fixture の印) */
export interface JsonlRow extends SectionRecord {
  /**
   * `fixtures` のうち skip つきの物 (今のエンジンは実機と違う)。実機の裏づけとして読む時は、
   * この名前の fixture の expect を見る (理由は by-fixture.json の `skip`)
   */
  skipFixtures: string[]
}

/** JSONL の 1 行。欄の並びを決める (README の表と同じ順) */
export function jsonlRow(r: SectionRecord, skipped: ReadonlySet<string>): JsonlRow {
  return {
    id: r.id, page: r.page, file: r.file, line: r.line, level: r.level, title: r.title, path: r.path,
    text: r.text, classes: r.classes, fixtures: r.fixtures, skipFixtures: r.fixtures.filter(n => skipped.has(n)),
    marks: r.marks, refs: r.refs, blocks: r.blocks,
    summary: r.summary, aliases: r.aliases,
  }
}

// ---------------------------------------------------------------------------
// 引く関数 (CLI が使う)
// ---------------------------------------------------------------------------

/** 節を指す 1 件 */
export interface SectionPointer {
  id: string
  page: string
  title: string
  file: string
  line: number
  /** `file:line` */
  where: string
  /** メモ全体が担当 (節はメモの前置き) */
  whole?: true
}

export function pointer(r: SectionRecord, whole = false): SectionPointer {
  const p: SectionPointer = { id: r.id, page: r.page, title: r.title, file: r.file, line: r.line, where: `${r.file}:${r.line}` }
  if (whole) p.whole = true
  return p
}

function pointers(ai: AiIndex, model: Model, docs: readonly string[], sections: readonly string[]): SectionPointer[] {
  const introOf = new Map(model.docs.map(d => [d.source.key, d.groups[0].id]))
  return [
    ...docs.map(d => pointer(ai.byId.get(introOf.get(d)!)!, true)),
    ...sections.map(id => pointer(ai.byId.get(id)!)),
  ]
}

/** 表に無い時に返す文。「メモに無い」と読み違えないように、表の範囲を書く */
export const NOT_IN_BLOCK_TABLE =
  '表に無い: ブロックの表 (tools/docs-index/blocks.json) はレッドストーン部品だけを載せている。メモに記述が無いという意味ではない。語で検索すること (npm run docs:search -- <語>)'
export const NOT_IN_CLASS_TABLE =
  '表に無い: 00 の網羅表 (docs/vanilla/00_coverage.md) に、この名前のクラスの行が無い。メモに記述が無いという意味ではない。語で検索すること (npm run docs:search -- <語>)'
export const NOT_IN_FIXTURE_TABLE =
  '表に無い: 本文の [実機 1.21.1: 名前] の印が、この名前の fixture を引いていない。fixture が無いという意味ではない (置き場は packages/sim/test/fixtures)'

export type BlockLookup =
  | { found: true; block: string; entry: BlockEntry; classes: ClassLookup[]; sections: SectionPointer[]; mentions: SectionPointer[] }
  | { found: false; block: string; note: string; known: number }

export type ClassLookup =
  | { found: true; class: string; entry: ClassEntry; sections: SectionPointer[]; mentions: SectionPointer[] }
  | { found: false; class: string; note: string; near: string[] }

export type FixtureLookup =
  | { found: true; fixture: string; entry: FixtureEntry; sections: SectionPointer[] }
  | { found: false; fixture: string; note: string; near: string[] }

/** クラス名から引く。大文字と小文字の違い・パスつき (`entity/HopperBlockEntity`) も受ける */
export function lookupClass(ai: AiIndex, model: Model, raw: string): ClassLookup {
  const key = raw.trim().split(/[/.]/).pop() ?? ''
  const all = Object.keys(ai.byClass.classes)
  const name = ai.byClass.classes[key] ? key : all.find(n => n.toLowerCase() === key.toLowerCase())
  if (!name) {
    const low = key.toLowerCase()
    const near = low.length >= 3 ? all.filter(n => n.toLowerCase().includes(low)).slice(0, 10) : []
    return { found: false, class: raw, note: NOT_IN_CLASS_TABLE, near }
  }
  const entry = ai.byClass.classes[name]
  return {
    found: true, class: name, entry,
    sections: pointers(ai, model, entry.docs, entry.sections),
    mentions: entry.mentions.map(id => pointer(ai.byId.get(id)!)),
  }
}

/** ブロック ID か和名から引く。表に無いブロックは、空ではなく「表に無い」を返す */
export function lookupBlock(ai: AiIndex, model: Model, raw: string): BlockLookup {
  const key = normalizeKey(raw)
  const name = ai.byBlock.lookup[key] ?? ai.byBlock.suffixes.find(([suffix]) => key.endsWith(suffix))?.[1]
  if (!name) return { found: false, block: raw, note: NOT_IN_BLOCK_TABLE, known: Object.keys(ai.byBlock.blocks).length }
  const entry = ai.byBlock.blocks[name]
  const classes = entry.classes.map(c => lookupClass(ai, model, c))
  const own = new Set(pointers(ai, model, entry.docs, entry.sections).map(p => p.id))
  const mentioned = uniq(classes.flatMap(c => (c.found ? c.entry.mentions : []))).filter(id => !own.has(id))
  // md の順に並べ直す
  const order = new Map(ai.records.map((r, i) => [r.id, i]))
  mentioned.sort((a, b) => order.get(a)! - order.get(b)!)
  return {
    found: true, block: name, entry, classes,
    sections: pointers(ai, model, entry.docs, entry.sections),
    mentions: mentioned.map(id => pointer(ai.byId.get(id)!)),
  }
}

/** fixture の名前から引く */
export function lookupFixture(ai: AiIndex, raw: string): FixtureLookup {
  const key = raw.trim().replace(/\.json$/, '')
  const entry = ai.byFixture.fixtures[key]
  if (!entry) {
    const near = key.length >= 3 ? Object.keys(ai.byFixture.fixtures).filter(n => n.includes(key)).slice(0, 10) : []
    return { found: false, fixture: raw, note: NOT_IN_FIXTURE_TABLE, near }
  }
  return { found: true, fixture: key, entry, sections: entry.sections.map(id => pointer(ai.byId.get(id)!)) }
}

// ---------------------------------------------------------------------------
// README
// ---------------------------------------------------------------------------

function readme(sections: number, byClass: ByClass, byFixture: ByFixture, byBlock: ByBlock): string {
  const cls = Object.values(byClass.classes)
  const fx = Object.values(byFixture.fixtures)
  return `# AI 向けの索引

docs/vanilla (21 本) と docs/research 17〜19 の md から、ビルドの時に機械で作った索引。
md が正で、ここは写し。リポには入れていない (\`npm run docs:index\` で docs-web/public/data/ai に出る)。

## ファイル

| ファイル | 中身 | 数 |
|---|---|---|
| \`sections.jsonl\` | 節 1 件 = 1 行。本文は md のまま | ${sections} 行 |
| \`by-class.json\` | クラス → 節 (00 の網羅表の担当欄) | ${cls.length} クラス (記述済 ${cls.filter(c => c.state === '記述済').length}) |
| \`by-fixture.json\` | fixture → 節 (本文の \`[実機 1.21.1: 名前]\` の印) | ${fx.length} 本 |
| \`by-block.json\` | ブロック ID・和名 → クラス → 節 (レッドストーン部品だけの手書きの表) | ${Object.keys(byBlock.blocks).length} 行 |

## ID

| 対象 | 形 |
|---|---|
| メモ | \`v07\` (docs/vanilla/07_*.md)・\`r19\` (docs/research/19_*.md)・\`v-readme\` |
| 番号つきの節 | \`v07/4.3\`・\`r19/3.9\` (メモの番号 + 見出しの番号。本文の「07 §4.3」と同じ) |
| 付録 | \`v05/app-C.1\` |
| 番号なしの見出し | 親の ID + ファイル内の連番 (\`v07/4.5/n2\`)。見出しを足すと後ろがずれる |
| メモの \`#\` と前置き | \`v07/0\` (research 17〜19 は \`r17/top\`) |

読む用の Web では \`#/<ID>\` で開く (節はその節が入っているページへ寄せる)。

## sections.jsonl の欄

| 欄 | 中身 |
|---|---|
| \`id\` | 節の ID |
| \`page\` | 入っているページの ID |
| \`file\`・\`line\` | リポ相対のパスと、見出しの行 (1 始まり) |
| \`level\` | 見出しの深さ (\`#\` の数) |
| \`title\` | 見出し (印を外した文) |
| \`path\` | 見出しの道筋 (メモの題 → … → この節) |
| \`text\` | 本文 (md のまま。見出しの行は含まず、次の見出しの手前まで。下の節の本文は含まない) |
| \`classes\` | この節が担当のクラス (00 の網羅表)。メモ全体が担当のクラスは、前置きの節に入る |
| \`fixtures\` | 本文が引く fixture の名前 |
| \`skipFixtures\` | \`fixtures\` のうち skip つきの物。**今のエンジンが実機と違う** fixture なので、実機の裏づけとして読む時は fixture の expect を見る (理由は by-fixture.json の \`skip\`) |
| \`marks\` | 本文と見出しに出る印の種類 (メモの頭の凡例の印は数えない)。\`read\` = 26.3 読解・\`need\` = 要実機・\`fx\` = 実機・\`ver\` = 版差・\`sure\` = 確定・\`meas\` = 実測・\`guess\` = 推定・\`check\` = 要確認 |
| \`refs\` | 本文が引く節の ID (解けた物だけ) |
| \`blocks\` | この節が担当のブロック (by-block.json の行の名前) |
| \`summary\`・\`aliases\` | 節の要約と別名。欄だけあり、今は空 |

## by-class.json

\`classes[クラスの単純な名前]\` に 1 件。

| 欄 | 中身 |
|---|---|
| \`state\` | \`記述済\` か \`対象外\`。対象外は節を引かない (\`owner\` が理由) |
| \`owner\` | 担当欄の文 (md のまま) |
| \`row\`・\`line\` | 網羅表の行がある節と md の行 |
| \`docs\` | メモ全体が担当 (\`v07\`) |
| \`sections\` | 担当の節。担当欄の裸の族 (\`F4\`) は、00 §1.4 の「どこに書いてあるか」の節に開いてある |
| \`mentions\` | 補助: 見出しか本文にクラス名が出る節。広いので、担当の節で足りない時だけ使う |

## by-fixture.json

\`fixtures[名前]\` に 1 件。\`sections\` がその fixture を引く節。\`skip\` がある fixture は
**今のエンジンが実機と違う** (理由がその文)。実機の裏づけとして読む時は fixture の expect を見る。
\`entities\` は summon・item・kill の入力を含む印。

## by-block.json

\`lookup[ブロック ID か和名]\` → 行の名前 → \`blocks[行の名前]\`。色・材質ちがいは \`suffixes\` (語尾 → 行の名前) で受ける。

**表はレッドストーン部品だけ**。\`lookup\` にも \`suffixes\` にも当たらないブロックは「表に無い」であって、
「メモに記述が無い」ではない。その時は語で検索する。

## 引き方

リポの中では CLI を使う (md からその場で索引を作るので、ビルドは要らない)。

\`\`\`
npm run docs:search -- リピーター ロック        # 語で探す (ID・見出し・file:line・抜粋)
npm run docs:search -- --json リピーター ロック # JSON で受ける
npm run docs:search -- --id v07/4.3            # 節の本文 (下の節も含む)
npm run docs:search -- --id v07 --full         # メモの全文 (v07/0 は前置きだけ)
npm run docs:search -- --block repeater        # ブロック ID・和名 → 節
npm run docs:search -- --class RepeaterBlock   # クラス → 節
npm run docs:search -- --fixture piston-basic  # fixture → 節
npm run docs:search -- --mark need ピストン     # 印で絞る (--doc v13 でメモで絞る)
\`\`\`

リポの外からは、PR のプレビューの \`/docs/data/ai/\` の下のファイルを取る。
`
}
