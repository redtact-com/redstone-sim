/**
 * 読む用の Web の生成器 (#434)。docs/vanilla と docs/research 17〜19 の md を割り、
 * 目次 (manifest.json)・ページ (pages/*.json)・検索の索引 (search-index.json)・AI 向けの索引 (ai/) を
 * docs-web/public/data へ出す。
 *
 *   npm run docs:index            … 生成する (docs-web/public/data。追跡しない)
 *   npm run docs:index -- --ids   … 節の ID の一覧 (tools/docs-index/section-ids.txt) も書き直す
 *
 * 追跡しているファイルは書き換えない (`--ids` を付けた時の section-ids.txt だけが例外)。
 * 生成物は md の文を写すだけで、リポには入れない。
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DOCS_DATA_VERSION } from '../../packages/docs-kit/src/types.js'
import type {
  FixtureInfo, Manifest, MarkKind, PageData, SectionRecord,
} from '../../packages/docs-kit/src/types.js'
import { anchorOf, pageDataPath } from '../../packages/docs-kit/src/ids.js'
import { buildSearchIndex } from '../../packages/docs-kit/src/search.js'
import type { SearchIndexData, SearchInput } from '../../packages/docs-kit/src/search.js'
import { buildAi, loadBlocksTable } from './ai.js'
import type { AiIndex, BlocksTable } from './ai.js'
import { loadFixtures } from './fixtures.js'
import type { FixtureMeta } from './fixtures.js'
import { createRenderer } from './render.js'
import type { MissingRef, RenderedPage } from './render.js'
import { buildModel, loadOutsideResearch, loadSources, PAGE_SPLIT_LINES, SHORT_PAGE_LINES } from './split.js'
import type { Model, SourceFile } from './split.js'

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** 節の ID の一覧 (リポ相対)。追跡する。前にあった ID が消えたら単体テストが落ちる */
export const SECTION_IDS_FILE = 'tools/docs-index/section-ids.txt'

/** 生成物の置き場 (リポ相対)。追跡しない */
export const DATA_DIR = 'docs-web/public/data'

export interface BuildStats {
  docs: number
  pages: number
  sections: number
  /** 番号なしの見出しの数 (ID が連番になる節) */
  unnumbered: number
  /** ページの md の行数 */
  lines: { median: number; p90: number; max: number; overSplit: number; short: number }
  strong: number
  tables: number
  longTables: number
  emDropped: number
  hrDropped: number
  refs: number
  refsOutside: number
  missing: MissingRef[]
  unknownFixtures: string[]
  /** 本文が引く fixture と、そのうち埋め込める物 (名前の順) */
  fixturesTagged: string[]
  fixturesEmbeddable: string[]
  /** 生成物の大きさ (バイト) */
  bytes: { manifest: number; pagesTotal: number; pageMedian: number; pageMax: number; htmlTotal: number; search: number }
  /** 検索の索引の字句の種類の数 */
  searchTerms: number
  /** AI 向けの索引: JSONL の大きさ・クラスの数・担当欄の参照 (解けた数)・ブロックの行・fixture */
  ai: { jsonl: number; classes: number; classRefs: number; classRefsResolved: number; blocks: number; fixtures: number }
}

export interface DocsBuild {
  model: Model
  manifest: Manifest
  /** ページの ID → ページのデータ */
  pages: Map<string, PageData>
  /** 節 1 件の記録 (md の順・クラスとブロックを埋めた物)。検索の索引と AI 向けの JSONL の元 */
  records: SectionRecord[]
  /** AI 向けの索引 (`ai/` の下のファイルの中身と、引く関数に渡す表) */
  ai: AiIndex
  /** 検索の索引 (`search-index.json` の中身) */
  search: SearchIndexData
  /** 出すファイル (`data/` からの相対パス → 中身) */
  files: Map<string, string>
  stats: BuildStats
}

/** md と fixture から生成物を組み立てる (ファイルは書かない) */
export function buildDocs(
  sources: readonly SourceFile[],
  fixtures: ReadonlyMap<string, FixtureMeta>,
  outside: ReadonlyMap<string, ReadonlySet<string>> = new Map(),
  blocks: BlocksTable = { note: '', blocks: [] },
): DocsBuild {
  const model = buildModel(sources)
  const renderer = createRenderer(model, fixtures, outside)
  const rendered = new Map<string, RenderedPage>()
  for (const p of model.pages) rendered.set(p.id, renderer.renderPage(p))

  // ページ
  const pages = new Map<string, PageData>()
  model.pages.forEach((p, i) => {
    const r = rendered.get(p.id)!
    pages.set(p.id, {
      v: DOCS_DATA_VERSION,
      id: p.id, doc: p.doc, group: p.group, title: p.title,
      path: model.sectionById.get(p.id)!.path,
      file: p.file, line: p.line, endLine: p.endLine,
      html: r.html,
      sections: p.sections.map(s => ({ id: s.id, anchor: anchorOf(s.id), level: s.level, title: s.title, line: s.line })),
      prev: i > 0 ? model.pages[i - 1].id : null,
      next: i + 1 < model.pages.length ? model.pages[i + 1].id : null,
      marks: r.marks,
      fixtures: r.fixtures,
    })
  })

  // 節の記録と、fixture → 節
  const fixtureSections = new Map<string, string[]>()
  const bare: SectionRecord[] = model.sections.map(s => {
    const f = rendered.get(s.page)!.bySection.get(s.id) ?? { marks: [] as MarkKind[], fixtures: [], refs: [] }
    for (const n of f.fixtures) {
      const list = fixtureSections.get(n) ?? []
      list.push(s.id)
      fixtureSections.set(n, list)
    }
    return {
      id: s.id, page: s.page, file: s.file, line: s.line, level: s.level,
      title: s.title, path: s.path, text: s.text,
      marks: f.marks, fixtures: f.fixtures, refs: f.refs,
      classes: [], blocks: [], summary: '', aliases: [],
    }
  })

  const fixtureInfo: Record<string, FixtureInfo> = {}
  for (const name of [...fixtureSections.keys()].sort()) {
    fixtureInfo[name] = { ...fixtures.get(name)!, sections: fixtureSections.get(name)! }
  }

  const all = [...rendered.values()]
  const sum = (f: (r: RenderedPage) => number) => all.reduce((a, r) => a + f(r), 0)
  const missing = all.flatMap(r => r.missing)
  const manifest: Manifest = {
    v: DOCS_DATA_VERSION,
    docs: model.docs.map(d => ({
      key: d.source.key, kind: d.source.kind, num: d.source.num, label: d.label, title: d.title,
      file: d.source.file, groups: d.groups,
    })),
    pages: model.pages.map(p => {
      const r = rendered.get(p.id)!
      return {
        id: p.id, doc: p.doc, group: p.group, title: p.title,
        lines: p.endLine - p.line + 1, marks: r.marks, fixtures: r.fixtures.length,
      }
    }),
    fixtures: fixtureInfo,
    counts: {
      docs: model.docs.length,
      pages: model.pages.length,
      sections: model.sections.length,
      refs: sum(r => r.refs),
      refsOutside: sum(r => r.refsOutside),
      refsUnresolved: missing.length,
    },
  }

  // AI 向けの索引。節の記録にクラスとブロックを入れる
  const ai = buildAi(model, bare, fixtureInfo, blocks)
  const records = ai.records

  const search = buildSearchIndex(searchInputs(model, records))

  const files = new Map<string, string>()
  files.set('manifest.json', JSON.stringify(manifest))
  for (const [id, page] of pages) files.set(pageDataPath(id), JSON.stringify(page))
  files.set(SEARCH_INDEX_FILE, JSON.stringify(search))
  for (const [rel, text] of ai.files) files.set(rel, text)

  const lens = manifest.pages.map(p => p.lines).sort((a, b) => a - b)
  const pageBytes = [...pages.keys()].map(id => Buffer.byteLength(files.get(pageDataPath(id))!)).sort((a, b) => a - b)
  const tagged = Object.keys(fixtureInfo)
  const stats: BuildStats = {
    docs: model.docs.length,
    pages: model.pages.length,
    sections: model.sections.length,
    unnumbered: model.sections.filter(s => !s.numbered).length,
    lines: {
      median: lens[lens.length >> 1],
      p90: lens[Math.ceil(lens.length * 0.9) - 1],
      max: lens[lens.length - 1],
      overSplit: lens.filter(n => n > PAGE_SPLIT_LINES).length,
      short: lens.filter(n => n < SHORT_PAGE_LINES).length,
    },
    strong: sum(r => r.strong),
    tables: sum(r => r.tables),
    longTables: sum(r => r.longTables),
    emDropped: sum(r => r.emDropped),
    hrDropped: sum(r => r.hrDropped),
    refs: manifest.counts.refs,
    refsOutside: manifest.counts.refsOutside,
    missing,
    unknownFixtures: [...new Set(all.flatMap(r => r.unknownFixtures))].sort(),
    fixturesTagged: tagged,
    fixturesEmbeddable: tagged.filter(n => fixtureInfo[n].embed),
    bytes: {
      manifest: Buffer.byteLength(files.get('manifest.json')!),
      pagesTotal: pageBytes.reduce((a, b) => a + b, 0),
      pageMedian: pageBytes[pageBytes.length >> 1],
      pageMax: pageBytes[pageBytes.length - 1],
      htmlTotal: [...pages.values()].reduce((a, p) => a + Buffer.byteLength(p.html), 0),
      search: Buffer.byteLength(files.get(SEARCH_INDEX_FILE)!),
    },
    searchTerms: Object.keys(search.terms).length,
    ai: {
      jsonl: Buffer.byteLength(files.get('ai/sections.jsonl')!),
      classes: Object.keys(ai.byClass.classes).length,
      classRefs: ai.coverage.refs,
      classRefsResolved: ai.coverage.resolved,
      blocks: Object.keys(ai.byBlock.blocks).length,
      fixtures: Object.keys(ai.byFixture.fixtures).length,
    },
  }
  return { model, manifest, pages, records, ai, search, files, stats }
}

/** 検索の索引 (`data/` からの相対パス)。検索の欄に初めて入った時に取る */
export const SEARCH_INDEX_FILE = 'search-index.json'

/** 節の記録を、検索の索引に入れる形にする (親は模型から引く) */
export function searchInputs(model: Model, records: readonly SectionRecord[]): SearchInput[] {
  return records.map(r => ({
    id: r.id, page: r.page, title: r.title,
    parent: model.sectionById.get(r.id)!.parent,
    text: r.text, marks: r.marks, fixtures: r.fixtures.length,
    summary: r.summary, aliases: r.aliases,
  }))
}

/** リポの md と fixture を読んで組み立てる */
export function buildDocsFromRepo(root: string): DocsBuild {
  return buildDocs(loadSources(root), loadFixtures(root), loadOutsideResearch(root), loadBlocksTable(root))
}

let cached: DocsBuild | null = null

/** 同じ結果を使い回す (単体テストがファイルごとに組み立て直さないように) */
export function buildDocsFromRepoCached(): DocsBuild {
  return (cached ??= buildDocsFromRepo(repoRoot))
}

/** 節の ID の一覧の中身 (1 行 1 件・md の順) */
export function sectionIdsText(build: DocsBuild): string {
  return build.model.sections.map(s => s.id).join('\n') + '\n'
}

/** 追跡している節の ID の一覧を読む */
export function readSectionIds(root: string): string[] {
  return readFileSync(join(root, SECTION_IDS_FILE), 'utf-8').split('\n').filter(Boolean)
}

/** 生成物を書き出す。置き場は毎回作り直す (消えたページの JSON を残さない) */
export function writeData(build: DocsBuild, outDir: string): void {
  rmSync(outDir, { recursive: true, force: true })
  for (const [rel, text] of build.files) {
    const file = join(outDir, rel)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, text)
  }
}

function main(): void {
  const t0 = performance.now()
  const build = buildDocsFromRepo(repoRoot)
  writeData(build, join(repoRoot, DATA_DIR))
  if (process.argv.includes('--ids')) {
    writeFileSync(join(repoRoot, SECTION_IDS_FILE), sectionIdsText(build))
    console.log(`${SECTION_IDS_FILE} を書き直した (${build.stats.sections} 件)`)
  }
  const s = build.stats
  const kb = (n: number) => `${(n / 1024).toFixed(1)} kB`
  console.log([
    `メモ ${s.docs}・ページ ${s.pages}・節 ${s.sections} (番号なし ${s.unnumbered})`,
    `ページの行数: 中央値 ${s.lines.median}・90% 点 ${s.lines.p90}・最大 ${s.lines.max}・${PAGE_SPLIT_LINES} 行超 ${s.lines.overSplit}・${SHORT_PAGE_LINES} 行未満 ${s.lines.short}`,
    `太字 ${s.strong}・表 ${s.tables} (${s.longTables} 個は長い)・切った斜体 ${s.emDropped}・捨てた --- ${s.hrDropped}`,
    `参照: リンク ${s.refs}・この Web に無い資料 ${s.refsOutside}・解けない ${s.missing.length}`,
    ...s.missing.map(m => `  解けない: ${m.section} の「${m.text}」→ ${m.want}`),
    `fixture: 本文が引く ${s.fixturesTagged.length} 本・埋め込める ${s.fixturesEmbeddable.length} 本・知らない名前 ${s.unknownFixtures.length}`,
    ...s.unknownFixtures.map(n => `  知らない名前: ${n}`),
    `大きさ: manifest ${kb(s.bytes.manifest)}・ページ ${s.pages} 本 ${kb(s.bytes.pagesTotal)} (中央値 ${kb(s.bytes.pageMedian)}・最大 ${kb(s.bytes.pageMax)})`,
    `検索の索引: ${kb(s.bytes.search)}・字句 ${s.searchTerms} 種`,
    `AI 向け: sections.jsonl ${kb(s.ai.jsonl)}・クラス ${s.ai.classes} (担当欄の参照 ${s.ai.classRefs}・解けた ${s.ai.classRefsResolved})・ブロック ${s.ai.blocks} 行・fixture ${s.ai.fixtures} 本`,
    `${DATA_DIR} へ ${build.files.size} ファイル (${Math.round(performance.now() - t0)} ms)`,
  ].join('\n'))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
