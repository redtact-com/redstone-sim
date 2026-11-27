/**
 * md を節とページに割る (#434)。Node の純粋な関数で、md は 1 行も書き換えない。
 *
 * ページの分け方:
 * 1. メモの `#` と冒頭の前置き = 1 ページ
 * 2. `##` ごとに 1 ページ
 * 3. `##` が PAGE_SPLIT_LINES 行を超えるときだけ `###` で割る。`####` は割らず、ページ内のアンカー
 * 4. 割った `##` で最初の `###` の前に前置きがあるときは、先頭の `###` のページの頭に付ける
 * 5. コードフェンスの中の `#` は見出しにしない (`---` は描く側で捨てる)
 *
 * 節 (検索と索引の単位) は見出し 1 個 = 1 件。
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { headingNumber, IdAllocator } from './ids.js'
import { stripMarks } from './marks.js'

/** `##` をこの行数を超えたら `###` で割る。変えるとページの ID (既読の記録の鍵) が動く */
export const PAGE_SPLIT_LINES = 150

/** この行数に満たないページは「短いページ」。集計と「読んだにして次へ」で進める */
export const SHORT_PAGE_LINES = 10

/** 読む md 1 本 */
export interface SourceFile {
  /** メモの ID (`v07`・`r19`・`v-readme`) */
  key: string
  kind: 'vanilla' | 'research'
  /** ファイル名の頭の 2 桁。README は null */
  num: string | null
  /** リポ相対のパス */
  file: string
  text: string
}

/** 節 1 件 (見出し 1 個と、次の見出しの手前までの本文) */
export interface Section {
  id: string
  doc: string
  file: string
  /** 見出しの行 (1 始まり) と、本文の最後の行 */
  line: number
  endLine: number
  level: number
  /** 見出しの文 (md のまま) と、印を外した文 */
  rawTitle: string
  title: string
  /** 見出しの道筋 (メモの題 → … → この節)。印を外した文 */
  path: string[]
  /** 親の節の ID (`#` は null) */
  parent: string | null
  /** 番号つきか (`4.3`・付録)。番号なしの ID はページ内のアンカーと検索にだけ使う */
  numbered: boolean
  /** 本文 (md のまま。見出しの行は含まない) */
  text: string
  /** 入っているページの ID */
  page: string
}

/** ページ 1 枚 */
export interface Page {
  id: string
  doc: string
  /** 属する `##` の節の ID (前置きのページは自分の ID) */
  group: string
  title: string
  file: string
  /** md の行の範囲 (1 始まり・両端を含む) */
  line: number
  endLine: number
  /** ページの中の節 (先頭がページの頭) */
  sections: Section[]
}

/** `##` 1 個 (目次の 2 段目) */
export interface Group {
  id: string
  title: string
  pages: string[]
}

export interface Doc {
  source: SourceFile
  /** 短い呼び名 (`V07`・`R19`・`README`) */
  label: string
  /** `#` の見出し (頭の番号と印を外した文) */
  title: string
  groups: Group[]
}

export interface Model {
  docs: Doc[]
  /** 読む順 */
  pages: Page[]
  /** md の順 */
  sections: Section[]
  sectionById: Map<string, Section>
  pageById: Map<string, Page>
}

/** この Web に載せる research の番号。ほか (01〜16) への参照はリンクにしない */
export const RESEARCH_IN_SCOPE = ['17', '18', '19']

/** 対象の md を読む。並びは README → vanilla 00〜19 → research 17〜19 */
export function loadSources(root: string): SourceFile[] {
  const out: SourceFile[] = []
  const read = (file: string) => readFileSync(join(root, file), 'utf-8')
  const vanilla = readdirSync(join(root, 'docs/vanilla')).filter(f => f.endsWith('.md')).sort()
  for (const f of vanilla.filter(f => f === 'README.md')) {
    out.push({ key: 'v-readme', kind: 'vanilla', num: null, file: `docs/vanilla/${f}`, text: read(`docs/vanilla/${f}`) })
  }
  for (const f of vanilla) {
    const m = /^(\d\d)_/.exec(f)
    if (m) out.push({ key: `v${m[1]}`, kind: 'vanilla', num: m[1], file: `docs/vanilla/${f}`, text: read(`docs/vanilla/${f}`) })
  }
  for (const f of readdirSync(join(root, 'docs/research')).filter(f => f.endsWith('.md')).sort()) {
    const m = /^(\d\d)_/.exec(f)
    if (m && RESEARCH_IN_SCOPE.includes(m[1])) {
      out.push({ key: `r${m[1]}`, kind: 'research', num: m[1], file: `docs/research/${f}`, text: read(`docs/research/${f}`) })
    }
  }
  return out
}

/**
 * この Web に載せない research (01〜16) の、番号つきの節の一覧 (番号 → 節の番号の集合)。
 * 本文は読まない。vanilla のメモの §9 が引く裸の `16 §2.4` が、vanilla 16 と research 16 の
 * どちらの節かを見分けるのに使う (refs.ts)。
 */
export function loadOutsideResearch(root: string): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  for (const f of readdirSync(join(root, 'docs/research')).filter(f => f.endsWith('.md')).sort()) {
    const m = /^(\d\d)_/.exec(f)
    if (!m || RESEARCH_IN_SCOPE.includes(m[1])) continue
    const labels = new Set<string>()
    for (const h of findHeadings(readFileSync(join(root, 'docs/research', f), 'utf-8').split('\n'))) {
      const num = h.level > 1 ? headingNumber(h.title, false) : null
      if (num && num.kind === 'num') labels.add(num.label)
    }
    out.set(m[1], labels)
  }
  return out
}

/** 見出しの行 (フェンスの外だけ) */
export interface HeadingLine {
  /** 0 始まりの行 */
  index: number
  level: number
  title: string
}

/** md の行から見出しを拾う。コードフェンス (``` と ~~~) の中の `#` は見出しにしない */
export function findHeadings(lines: readonly string[]): HeadingLine[] {
  const out: HeadingLine[] = []
  let fence: string | null = null
  lines.forEach((line, index) => {
    const f = /^\s{0,3}(```+|~~~+)/.exec(line)
    if (f) {
      if (fence === null) fence = f[1][0]
      else if (f[1][0] === fence) fence = null
      return
    }
    if (fence !== null) return
    const m = /^(#{1,6})\s+(.*?)\s*$/.exec(line)
    if (m) out.push({ index, level: m[1].length, title: m[2] })
  })
  return out
}

/** 見出しを目次に出す文にする (印・強調・コードの記号を外す) */
export function plainTitle(raw: string): string {
  return stripMarks(raw).replace(/\*\*|`/g, '').trim()
}

/** md 1 本を節とページに割る */
export function splitDoc(source: SourceFile): { doc: Doc; pages: Page[]; sections: Section[] } {
  const lines = source.text.split('\n')
  // 末尾の改行で出来る空の 1 行は数えない
  const total = lines.length > 0 && lines[lines.length - 1] === '' ? lines.length - 1 : lines.length
  const heads = findHeadings(lines)
  if (heads.length === 0 || heads[0].level !== 1 || heads[0].index !== 0) {
    throw new Error(`${source.file}: 1 行目が # の見出しではない`)
  }
  if (heads.filter(h => h.level === 1).length !== 1) throw new Error(`${source.file}: # の見出しが 2 つ以上ある`)

  const ids = new IdAllocator(source.key)
  const hasZero = heads.some(h => h.level === 2 && /^0\.?(\s|$)/.test(h.title))
  const sections: Section[] = []
  const stack: Section[] = []
  heads.forEach((h, i) => {
    while (stack.length && stack[stack.length - 1].level >= h.level) stack.pop()
    const parent = stack.length ? stack[stack.length - 1] : null
    const inAppendix = stack.some(s => /\/app(-|$)/.test(s.id))
    const num = h.level === 1 ? null : headingNumber(h.title, inAppendix)
    const id = num === null ? ids.intro(hasZero) : ids.heading(num, parent && parent.level > 1 ? parent.id : null)
    const end = i + 1 < heads.length ? heads[i + 1].index : total
    const title = plainTitle(h.title)
    const s: Section = {
      id, doc: source.key, file: source.file,
      line: h.index + 1, endLine: end,
      level: h.level, rawTitle: h.title, title,
      path: [...stack.map(x => x.title), title],
      parent: parent ? parent.id : null,
      numbered: num === null || (num.kind !== 'none' && id === `${source.key}/${num.label}`),
      text: lines.slice(h.index + 1, end).join('\n'),
      page: '',
    }
    sections.push(s)
    stack.push(s)
  })

  // ページに割る。h2 の境目で切り、長い h2 だけ h3 で切る
  const pages: Page[] = []
  const groups: Group[] = []
  const h2 = sections.filter(s => s.level === 2)
  const intro = sections[0]
  const cut = (first: Section, last: number, group: Section, members: Section[]) => {
    const page: Page = {
      id: first.id, doc: source.key, group: group.id, title: first.title, file: source.file,
      line: members[0].line, endLine: last, sections: members,
    }
    for (const s of members) s.page = page.id
    pages.push(page)
    return page
  }
  const upTo = (from: Section, endLine: number) => sections.filter(s => s.line >= from.line && s.line <= endLine)

  const introEnd = h2.length ? h2[0].line - 1 : total
  cut(intro, introEnd, intro, upTo(intro, introEnd))
  groups.push({ id: intro.id, title: intro.title, pages: [intro.id] })

  h2.forEach((g, gi) => {
    const end = gi + 1 < h2.length ? h2[gi + 1].line - 1 : total
    const inside = upTo(g, end)
    const h3 = inside.filter(s => s.level === 3)
    const group: Group = { id: g.id, title: g.title, pages: [] }
    if (end - g.line + 1 > PAGE_SPLIT_LINES && h3.length > 0) {
      h3.forEach((c, ci) => {
        const cEnd = ci + 1 < h3.length ? h3[ci + 1].line - 1 : end
        // 先頭の ### は、## の見出しと前置きごと 1 ページにする
        const members = ci === 0 ? upTo(g, cEnd) : upTo(c, cEnd)
        group.pages.push(cut(c, cEnd, g, members).id)
      })
    } else {
      group.pages.push(cut(g, end, g, inside).id)
    }
    groups.push(group)
  })

  const label = source.num === null ? 'README' : `${source.kind === 'vanilla' ? 'V' : 'R'}${source.num}`
  // `07. リピーター…`・`03 ブロックイベント…` の頭の番号を外す
  const title = intro.title.replace(/^\d\d\.?\s+/, '')
  return { doc: { source, label, title, groups }, pages, sections }
}

/** 全部の md を割って 1 つの模型にする */
export function buildModel(sources: readonly SourceFile[]): Model {
  const model: Model = { docs: [], pages: [], sections: [], sectionById: new Map(), pageById: new Map() }
  for (const src of sources) {
    const { doc, pages, sections } = splitDoc(src)
    model.docs.push(doc)
    model.pages.push(...pages)
    model.sections.push(...sections)
  }
  for (const s of model.sections) {
    if (model.sectionById.has(s.id)) throw new Error(`節の ID が重なった: ${s.id}`)
    model.sectionById.set(s.id, s)
  }
  for (const p of model.pages) model.pageById.set(p.id, p)
  return model
}
