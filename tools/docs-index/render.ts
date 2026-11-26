/**
 * ページの md を HTML にする (#434)。ビルド時に markdown-it で作り、実行時にパーサは持たない。
 *
 * 描くときの決まり:
 * - 生の HTML は切る (文字として出す)。`http(s)://` で始まる URL だけをリンクにする
 * - 和文の間の改行は空白にしない (行の折り返しで字の間が空かないように)
 * - 1 つの `*`・`_` の斜体は切る。メモは斜体を使わず、`*` は掛け算や `rail-*` に出てくる。
 *   切った数は呼び出し側に返し、単体テストが数を見張る
 * - `---` は捨てる。表は 1 個ずつ横スクロールの枠で包む
 * - 印はバッジに、節の参照はリンクにする (md には何も書き足さない)
 * - fixture のタグ (`[実機 1.21.1: 名前]`) は小さなチップのままにし、タグのある段落・箇条書きの直後に
 *   1 行の札を置く。表の中のタグの札は、表の後ろの 1 つの折りたたみにまとめる (本文を押し流さない)
 * - 凡例の印 (メモの前置きの「確かさの表記は次のとおり」とその箇条書き・README の §4) はバッジには
 *   するが、節の印とページの印の数には入れない (「要実機あり」の絞り込みに凡例が混ざらないように)
 *
 * 出す HTML の形は packages/docs-kit/src/types.ts の `PageData.html` に書いてある。
 */

import MarkdownIt from 'markdown-it'
import Token from 'markdown-it/lib/token.mjs'
import type { MarkCounts, MarkKind } from '../../packages/docs-kit/src/types.js'
import { anchorOf, docsHref, headingDomId } from '../../packages/docs-kit/src/ids.js'
import { fixtureCardsHtml } from '../../packages/docs-kit/src/fixture-card.js'
import type { FixtureMeta } from './fixtures.js'
import { parseFixtureTag } from './fixtures.js'
import { MARK_OPEN, markKind } from './marks.js'
import type { DocRef, RefContext, RefIndex, RefTarget } from './refs.js'
import { splitRefs } from './refs.js'
import type { Model, Page, Section } from './split.js'

/** この行数 (見出しの行を含む) を超える表は、見出しの行を固定する */
export const LONG_TABLE_ROWS = 50

/** 解けなかった参照 1 件 */
export interface MissingRef {
  /** 書いてあった節の ID と、探した ID */
  section: string
  want: string
  text: string
}

/** ページ 1 枚を描いた結果 */
export interface RenderedPage {
  html: string
  marks: MarkCounts
  /** ページの中の fixture の名前 (出てくる順・重複を除く) */
  fixtures: string[]
  /** 数 (ビルドの記録と単体テストに使う) */
  strong: number
  tables: number
  longTables: number
  /** 切った斜体の数 (開きの数) */
  emDropped: number
  hrDropped: number
  refs: number
  refsOutside: number
  /** 凡例の中の印 (バッジにはするが `marks` には数えない) */
  legendMarks: number
  missing: MissingRef[]
  /** 名前の形なのに実在しない fixture */
  unknownFixtures: string[]
  /** 置いた札の fixture の名前 (置いた順。同じ名前が別の段落にあれば重なる) */
  cards: string[]
  /** 表の後ろの折りたたみの数 */
  cardFolds: number
  /** 節ごとの集計 (節の ID → 印の種類・fixture・解けた参照の ID) */
  bySection: Map<string, SectionFacts>
}

export interface SectionFacts {
  marks: MarkKind[]
  fixtures: string[]
  refs: string[]
}

/** 参照の索引を模型から作る */
export function refIndexOf(model: Model, outside: ReadonlyMap<string, ReadonlySet<string>> = new Map()): RefIndex {
  const intro = new Map(model.docs.map(d => [d.source.key, d.groups[0].id]))
  const rowsSection = 'v18/2.3'
  const rows = new Set<string>()
  const sec = model.sectionById.get(rowsSection)
  if (sec) for (const m of sec.text.matchAll(/^\|\s*(R\d+)\s*\|/gm)) rows.add(m[1])
  return {
    hasSection: id => model.sectionById.has(id),
    docIntro: key => intro.get(key) ?? null,
    outsideHas: (num, label) => outside.get(num)?.has(label) ?? false,
    rows,
    rowsSection,
  }
}

/**
 * §9 (既存資料との食い違い) の中の節が、見出しに挙げている資料。
 * その節の表の 1 列目の裸の `§x.y` は、この資料の節を指す。
 */
export function comparedDoc(section: Section, model: Model): DocRef | null {
  if (!/^v\d\d$/.test(section.doc)) return null
  let s: Section | undefined = section
  while (s && s.level > 2) {
    const m = /docs\/(vanilla|research)\/(\d{2})/.exec(s.rawTitle)
    if (m) return under9(s, model) ? { kind: m[1] === 'vanilla' ? 'v' : 'r', num: m[2] } : null
    s = s.parent ? model.sectionById.get(s.parent) : undefined
  }
  return null
}

/** vanilla のメモの §9 (既存資料との食い違い) の中の節か */
export function under9(section: Section, model: Model): boolean {
  if (!/^v\d\d$/.test(section.doc)) return false
  let s: Section | undefined = section
  while (s && s.level > 2) s = s.parent ? model.sectionById.get(s.parent) : undefined
  return s !== undefined && s.id === `${s.doc}/9`
}

/** 凡例だけの節の題 (README §4) */
const LEGEND_TITLE = '確かさの表記'

/**
 * 凡例の始まりの文 (メモの前置きにある)。書き方は 4 通り:
 * 「確かさの表記は次のとおり」「確かさの印は次のとおり」「確かさの表記:」「確かさは [..] / [..] で書く」と、
 * vanilla 18 の「本メモだけ次の 1 つを足す」。「確かさの表記は 01〜19 と同じである」は凡例ではない
 */
const LEGEND_LEAD = /確かさ(?:の表記|の印)?(?:は次のとおり|\s?[:：]|は\s?\[)|次の \d+ つを足す/

/** 凡例の表の見出しの 1 列目 (`| 表記 | 意味 |`) */
const LEGEND_TABLE_HEAD = '表記'

/** 節が凡例だけの節か (docs/vanilla/README.md の「確かさの表記」) */
export function isLegendSection(section: Section): boolean {
  return section.title.replace(/^[\d.]+\s*/, '') === LEGEND_TITLE
}

const CJK = /[⺀-鿿豈-﫿＀-￯　-〿]/

export function createRenderer(
  model: Model,
  fixtures: ReadonlyMap<string, FixtureMeta>,
  outside: ReadonlyMap<string, ReadonlySet<string>> = new Map(),
) {
  const md = new MarkdownIt({ html: false, linkify: true, breaks: false })
  // `diffs.md` のような語を国別ドメイン (.md) の URL と読ませない
  md.linkify.set({ fuzzyLink: false, fuzzyEmail: false, fuzzyIP: false })
  const esc = md.utils.escapeHtml
  const index = refIndexOf(model, outside)
  const fileToDoc = new Map(model.docs.map(d => [d.source.file, d]))

  md.renderer.rules.table_open = (tokens, i) => `<div class="tbl${tokens[i].meta?.long ? ' tbl-long' : ''}"><table>\n`
  md.renderer.rules.table_close = () => '</table></div>\n'
  md.renderer.rules.docs_raw = (tokens, i) => tokens[i].content
  md.renderer.rules.softbreak = (tokens, i) => {
    const before = edgeChar(tokens, i - 1, -1)
    const after = edgeChar(tokens, i + 1, 1)
    return before && after && CJK.test(before) && CJK.test(after) ? '' : '\n'
  }

  /** 改行の隣の字。開き・閉じのタグは飛ばして探す */
  function edgeChar(tokens: Token[], from: number, step: 1 | -1): string {
    for (let i = from; i >= 0 && i < tokens.length; i += step) {
      const t = tokens[i]
      const text: string = t.type === 'docs_raw' ? (t.meta?.plain ?? '') : (t.type === 'text' || t.type === 'code_inline' ? t.content : '')
      if (text) return step === 1 ? text[0] : text[text.length - 1]
      if (t.type === 'softbreak' || t.type === 'hardbreak') return ''
    }
    return ''
  }

  function raw(html: string, plain: string): Token {
    const tok = new Token('docs_raw', '', 0)
    tok.content = html
    tok.meta = { plain }
    return tok
  }
  function textToken(content: string): Token {
    const tok = new Token('text', '', 0)
    tok.content = content
    return tok
  }

  function refHtml(text: string, target: RefTarget): string {
    if (target.state === 'ok') {
      const sec = model.sectionById.get(target.id)!
      const row = target.row ? ` data-row="${esc(target.row)}"` : ''
      return `<a class="ref" href="${esc(docsHref(sec.page, sec.id))}" data-ref="${esc(sec.id)}"${row}>${esc(text)}</a>`
    }
    if (target.state === 'outside') return `<span class="ref-out" title="この Web に無い資料">${esc(text)}</span>`
    return `<span class="ref-miss" title="行き先の節が見つからない">${esc(text)}</span>`
  }

  function renderPage(page: Page): RenderedPage {
    const doc = model.docs.find(d => d.source.key === page.doc)!
    const lines = doc.source.text.split('\n').slice(page.line - 1, page.endLine)
    const out: RenderedPage = {
      html: '', marks: {}, fixtures: [], strong: 0, tables: 0, longTables: 0, emDropped: 0, hrDropped: 0,
      refs: 0, refsOutside: 0, legendMarks: 0, missing: [], unknownFixtures: [], cards: [], cardFolds: 0,
      bySection: new Map(),
    }
    const byLine = new Map(page.sections.map(s => [s.line, s]))
    let section = page.sections[0]
    const facts = (id: string): SectionFacts => {
      let f = out.bySection.get(id)
      if (!f) out.bySection.set(id, f = { marks: [], fixtures: [], refs: [] })
      return f
    }
    for (const s of page.sections) facts(s.id)
    const add = <T>(list: T[], v: T) => { if (!list.includes(v)) list.push(v) }

    const env = {}
    const tokens = md.parse(lines.join('\n'), env)
    const kept: Token[] = []
    let inTable = false
    let column = -1
    // 札を待っている fixture (今の段落・箇条書きの中のタグ / 今の表の中のタグ)。重複は 1 枚にする
    const cardRow: string[] = []
    const cardFold: string[] = []
    let compared: DocRef | null = comparedDoc(section, model)
    let inCompare = under9(section, model)

    /** 行の中の並びを描き直す: 斜体を切る → 参照 → 印。`legend` は凡例の中 (印を数えない) */
    const inline = (children: Token[], legend: boolean): Token[] => {
      // 1. 斜体を文字に戻し、隣り合う文をつなぐ
      const merged: Token[] = []
      for (const c of children) {
        let cur = c
        if (c.type === 'em_open' || c.type === 'em_close') {
          if (c.type === 'em_open') out.emDropped++
          cur = textToken(c.markup)
        }
        if (cur.type === 'strong_open') out.strong++
        const last = merged[merged.length - 1]
        if (cur.type === 'text' && last && last.type === 'text') last.content += cur.content
        else merged.push(cur)
      }

      // 2. 節の参照 (リンクの中と、コードの中は触らない)
      const ctx: RefContext = {
        selfKey: page.doc,
        selfKind: doc.source.kind === 'vanilla' ? 'v' : 'r',
        bareDoc: inTable && column === 0 ? compared : null,
        headingDoc: compared,
        inCompare,
      }
      const withRefs: Token[] = []
      let linkDepth = 0
      for (const c of merged) {
        if (c.type === 'link_open') {
          linkDepth++
          rewriteLink(c)
        } else if (c.type === 'link_close') linkDepth--
        if (c.type !== 'text' || linkDepth > 0) { withRefs.push(c); continue }
        for (const piece of splitRefs(c.content, ctx, index)) {
          if (!piece.target) { withRefs.push(textToken(piece.text)); continue }
          if (piece.target.state === 'ok') { out.refs++; add(facts(section.id).refs, piece.target.id) }
          else if (piece.target.state === 'outside') out.refsOutside++
          else out.missing.push({ section: section.id, want: piece.target.want, text: piece.text })
          withRefs.push(raw(refHtml(piece.text, piece.target), piece.text))
        }
      }

      // 3. 印。閉じの `]` は後ろの文にあることがある (中の URL がリンクになったとき)
      const res: Token[] = []
      const queue = withRefs.slice()
      while (queue.length) {
        const c = queue.shift()!
        if (c.type !== 'text') { res.push(c); continue }
        MARK_OPEN.lastIndex = 0
        const m = MARK_OPEN.exec(c.content)
        if (!m) { res.push(c); continue }
        const kind = markKind(m[1])
        const openAt = m.index
        // 閉じを探す
        let closeTok = -1
        let closeAt = c.content.indexOf(']', openAt)
        if (closeAt < 0) {
          for (let j = 0; j < queue.length; j++) {
            const q = queue[j]
            if (q.type === 'softbreak' || q.type === 'hardbreak') break
            if (q.type === 'text' && q.content.includes(']')) { closeTok = j; closeAt = q.content.indexOf(']'); break }
          }
          if (closeTok < 0) {
            // 閉じが無い。印にしないで先へ進む
            res.push(textToken(c.content.slice(0, openAt + 1)))
            queue.unshift(textToken(c.content.slice(openAt + 1)))
            continue
          }
        }
        const before = c.content.slice(0, openAt)
        let innerPlain: string
        const middle: Token[] = []
        let after: string
        if (closeTok < 0) {
          innerPlain = c.content.slice(openAt + 1, closeAt)
          middle.push(textToken(innerPlain))
          after = c.content.slice(closeAt + 1)
        } else {
          const head = c.content.slice(openAt + 1)
          const between = queue.splice(0, closeTok)
          const tail = queue.shift()!
          middle.push(textToken(head), ...between, textToken(tail.content.slice(0, closeAt)))
          innerPlain = head + between.map(t => (t.type === 'docs_raw' ? t.meta?.plain ?? '' : t.type === 'text' || t.type === 'code_inline' ? t.content : '')).join('') + tail.content.slice(0, closeAt)
          after = tail.content.slice(closeAt + 1)
        }
        if (!legend) {
          out.marks[kind] = (out.marks[kind] ?? 0) + 1
          add(facts(section.id).marks, kind)
        } else out.legendMarks++
        let fx = ''
        if (kind === 'fx' && !legend) {
          const tag = parseFixtureTag(innerPlain, fixtures)
          for (const n of tag.names) {
            add(out.fixtures, n)
            add(facts(section.id).fixtures, n)
            add(inTable ? cardFold : cardRow, n)
          }
          for (const n of tag.unknown) add(out.unknownFixtures, n)
          if (tag.names.length) fx = ` data-fx="${esc(tag.names.join(' '))}"`
        }
        if (before) res.push(textToken(before))
        res.push(raw(`<span class="mk mk-${kind}"${fx}>`, ''), ...middle.filter(t => t.type !== 'text' || t.content), raw('</span>', ''))
        if (after) queue.unshift(textToken(after))
      }
      return res
    }

    /** md のリンク。メモへの相対リンクはページへ、外のリンクは別のタブへ */
    const rewriteLink = (open: Token) => {
      const href = open.attrGet('href') ?? ''
      if (/^https?:\/\//i.test(href)) {
        open.attrSet('target', '_blank')
        open.attrSet('rel', 'noopener noreferrer')
        return
      }
      const dir = doc.source.file.slice(0, doc.source.file.lastIndexOf('/'))
      const target = fileToDoc.get(normalize(`${dir}/${href.replace(/#.*$/, '')}`))
      if (target) {
        const intro = target.groups[0].id
        open.attrSet('href', docsHref(intro))
        open.attrSet('class', 'ref')
        open.attrSet('data-ref', intro)
        out.refs++
        add(facts(section.id).refs, intro)
      } else {
        // 行き先がこの Web に無い。押しても開けないので、リンクを外して注記だけ残す
        open.attrs = [['class', 'ref-out'], ['title', 'この Web に無い資料']]
        open.tag = 'span'
        open.meta = { ...(open.meta ?? {}), span: true }
        out.refsOutside++
      }
    }

    /** 待っている札を出す。段落・箇条書きの分はそのまま並べ、表の分は 1 つの折りたたみにまとめる */
    const flushCards = () => {
      for (const [names, fold] of [[cardRow, false], [cardFold, true]] as const) {
        if (names.length === 0) continue
        const html = fixtureCardsHtml(names.map(n => [n, fixtures.get(n)!] as const), fold)
        kept.push(raw(html, ''))
        out.cards.push(...names)
        if (fold) out.cardFolds++
        names.length = 0
      }
    }

    // 凡例: メモの前置き (# の節) で凡例の始まりの文と、その直後の箇条書きか表。見出しが「表記」の表
    let legendArmed = false
    let legendUntil = -1
    const closeOf = (from: number, open: string, close: string): number => {
      let depth = 0
      for (let j = from; j < tokens.length; j++) {
        if (tokens[j].type === open) depth++
        else if (tokens[j].type === close && --depth === 0) return j
      }
      return tokens.length
    }
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i]
      if (t.type === 'hr') { out.hrDropped++; continue }
      if (legendArmed && t.type !== 'paragraph_close') {
        legendArmed = false
        if (t.type === 'bullet_list_open') legendUntil = closeOf(i, 'bullet_list_open', 'bullet_list_close')
        else if (t.type === 'table_open') legendUntil = closeOf(i, 'table_open', 'table_close')
      }
      if (t.type === 'table_open' && section.level === 1) {
        const head = tokens.slice(i).find(x => x.type === 'inline')
        if (head && head.content.trim() === LEGEND_TABLE_HEAD) legendUntil = closeOf(i, 'table_open', 'table_close')
      }
      if (t.type === 'heading_open') {
        const s = byLine.get(page.line + (t.map ? t.map[0] : 0))
        if (!s) throw new Error(`${page.id}: 見出しの行が節に対応しない (${t.map})`)
        section = s
        compared = comparedDoc(section, model)
        inCompare = under9(section, model)
        t.attrSet('id', headingDomId(anchorOf(s.id)))
        t.attrSet('data-sec', s.id)
      } else if (t.type === 'table_open') {
        inTable = true
        out.tables++
        let rows = 0
        for (let j = i + 1; tokens[j].type !== 'table_close'; j++) if (tokens[j].type === 'tr_open') rows++
        t.meta = { long: rows > LONG_TABLE_ROWS }
        if (rows > LONG_TABLE_ROWS) out.longTables++
      } else if (t.type === 'table_close') inTable = false
      else if (t.type === 'tr_open') column = -1
      else if (t.type === 'td_open' || t.type === 'th_open') column++
      else if (t.type === 'inline' && t.children) {
        const lead = section.level === 1 && LEGEND_LEAD.test(t.content)
        if (lead) legendArmed = true
        t.children = inline(t.children, lead || i < legendUntil || isLegendSection(section))
        // リンクを外した所は、閉じのタグも span にそろえる
        let span = false
        for (const c of t.children) {
          if (c.type === 'link_open') span = c.meta?.span === true
          else if (c.type === 'link_close' && span) { c.tag = 'span'; span = false }
        }
      }
      kept.push(t)
      // 一番外のまとまり (段落・箇条書き・表・見出し) が閉じた所に、中のタグの札を置く
      if (t.level === 0 && t.nesting === -1) flushCards()
    }
    flushCards()
    out.html = md.renderer.render(kept, md.options, env)
    return out
  }

  return { renderPage, index }
}

/** `a/b/../c` → `a/c` */
function normalize(path: string): string {
  const out: string[] = []
  for (const part of path.split('/')) {
    if (part === '..') out.pop()
    else if (part !== '.' && part !== '') out.push(part)
  }
  return out.join('/')
}
