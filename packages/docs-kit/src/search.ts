/**
 * 節の検索 (#434)。自前の 2-gram の転置索引 + BM25。依存なし。
 * 読む用の Web・CLI (`npm run docs:search`)・テストが同じ関数を使う。
 *
 * - 字句分け: 和文の連なりは 2-gram (1 字だけなら 1 字)。英数字は語 + 部分
 *   (`#` `.` `_` `-` と camelCase で割る)。`Class#method` は丸ごとでも引ける
 * - 重み: 見出し ×6・上位の見出し ×2・本文 ×1 (別名は見出し、要約は上位の見出しと同じ重み)
 * - 単位は節。結果はページ + 節へ飛ぶ
 *
 * 索引 (`data/search-index.json`) は本文を持たない。抜粋は、本文を持っている側
 * (CLI は md、Web は開いたページ) が `makeSnippet` で作る。
 */

import { DOCS_DATA_VERSION, MARK_KINDS } from './types.js'
import type { MarkKind } from './types.js'

/** 見出し・上位の見出し・本文の重み */
export const SEARCH_WEIGHTS = { title: 6, path: 2, body: 1 } as const

/** 結果の数の既定 */
export const SEARCH_LIMIT = 20

/** BM25 の定数 */
const K1 = 1.2
const B = 0.75

/** ひらがな・カタカナ・漢字・々・ー の連なり (中黒 `・` は語の切れ目)、または英数字の語 (`#` `.` `_` `-` でつながる物は 1 語) */
const TOKEN = /([ぁ-ゟァ-ヺー-ヿ㐀-鿿々]+)|([A-Za-z0-9_][A-Za-z0-9_#.\-]*[A-Za-z0-9_]|[A-Za-z0-9_])/g

/**
 * 文を字句に割る。索引を作る時と引く時で同じ関数を使う。
 *
 * - `リピーター` → `リピ` `ピー` `ータ` `ター`
 * - `DiodeBlock#checkTickOnNeighbor` → 丸ごと (小文字) + `diode` `block` `check` … + `diodeblock` `checktickonneighbor`
 */
export function tokenize(raw: string): string[] {
  const out: string[] = []
  const s = raw.normalize('NFKC')
  TOKEN.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = TOKEN.exec(s))) {
    if (m[1]) {
      const r = m[1]
      if (r.length === 1) out.push(r)
      else for (let i = 0; i < r.length - 1; i++) out.push(r.slice(i, i + 2))
      continue
    }
    const w = m[2]
    out.push(w.toLowerCase())
    // 部分: 記号と camelCase の境目で割る
    const parts = w.replace(/([a-z0-9])([A-Z])/g, '$1\u0000$2').split(/[#._\-\u0000]+/).filter(Boolean)
    if (parts.length > 1) for (const p of parts) out.push(p.toLowerCase())
    // `Class#method`・`a.b` の左右
    const segs = w.split(/[#.]+/).filter(Boolean)
    if (segs.length > 1) for (const p of segs) out.push(p.toLowerCase())
  }
  return out
}

/** 索引に入れる節 1 件 */
export interface SearchInput {
  /** 節の ID と、入っているページの ID */
  id: string
  page: string
  /** 見出し (印を外した文) */
  title: string
  /** 親の節の ID (メモの `#` は null)。上位の見出しの重みと、結果の道筋に使う */
  parent: string | null
  /** 本文 (md のまま) */
  text: string
  marks: readonly MarkKind[]
  /** 本文が引く fixture の数 */
  fixtures: number
  /** 節の要約と別名 (言い換えで引くため)。今は空 */
  summary?: string
  aliases?: readonly string[]
}

/**
 * 索引の形 (`data/search-index.json`)。列ごとの配列で持つ (同じ添字が同じ節)。
 */
export interface SearchIndexData {
  /** DOCS_DATA_VERSION */
  v: number
  ids: string[]
  pages: string[]
  titles: string[]
  /** 親の節の添字 (無ければ -1) */
  up: number[]
  /** 印の種類のビット (MARK_KINDS の並び) */
  marks: number[]
  /** fixture の数 */
  fx: number[]
  /** 字句の数 (BM25 の長さの補正) と、その平均 */
  dl: number[]
  avg: number
  /**
   * 字句 → 当たる節の列 (添字の昇順)。1 件は「前の添字との差 + 1」(最初は添字 + 1) と重みつきの回数。
   * 回数が 1 の時は差だけを正の数で書き、それ以外は差を負にして次に回数を書く (`[3, -2, 6]` = 添字 2 が 1 回・添字 3 が 6 回)
   */
  terms: Record<string, number[]>
}

/** 節の列から索引を作る */
export function buildSearchIndex(inputs: readonly SearchInput[]): SearchIndexData {
  const at = new Map(inputs.map((s, i) => [s.id, i]))
  const up = inputs.map(s => (s.parent === null ? -1 : at.get(s.parent) ?? -1))
  const upper = (i: number): string => {
    const names: string[] = []
    for (let p = up[i]; p >= 0; p = up[p]) names.unshift(inputs[p].title)
    return names.join(' ')
  }
  const post = new Map<string, number[]>()
  const last = new Map<string, number>()
  const dl: number[] = []
  inputs.forEach((s, i) => {
    const tf = new Map<string, number>()
    let len = 0
    const add = (text: string, weight: number) => {
      for (const k of tokenize(text)) { tf.set(k, (tf.get(k) ?? 0) + weight); len++ }
    }
    add(s.text, SEARCH_WEIGHTS.body)
    add(s.title, SEARCH_WEIGHTS.title)
    add(upper(i), SEARCH_WEIGHTS.path)
    if (s.aliases?.length) add(s.aliases.join(' '), SEARCH_WEIGHTS.title)
    if (s.summary) add(s.summary, SEARCH_WEIGHTS.path)
    dl.push(len)
    for (const [k, v] of tf) {
      let p = post.get(k)
      if (!p) post.set(k, p = [])
      const d = i - (last.get(k) ?? -1)
      if (v === 1) p.push(d)
      else p.push(-d, v)
      last.set(k, i)
    }
  })
  // 鍵の順を決める (同じ入力から同じ文字列が出るように)
  const terms: Record<string, number[]> = Object.create(null) as Record<string, number[]>
  for (const k of [...post.keys()].sort()) terms[k] = post.get(k)!
  return {
    v: DOCS_DATA_VERSION,
    ids: inputs.map(s => s.id),
    pages: inputs.map(s => s.page),
    titles: inputs.map(s => s.title),
    up,
    marks: inputs.map(s => MARK_KINDS.reduce((bits, k, n) => (s.marks.includes(k) ? bits | (1 << n) : bits), 0)),
    fx: inputs.map(s => s.fixtures),
    dl,
    avg: dl.length ? dl.reduce((a, b) => a + b, 0) / dl.length : 0,
    terms,
  }
}

/** 結果 1 件 */
export interface SearchHit {
  /** 索引の中の添字 */
  index: number
  id: string
  page: string
  title: string
  /** 見出しの道筋 (メモの題 → … → この節) */
  path: string[]
  marks: MarkKind[]
  fixtures: number
  score: number
}

export interface SearchOptions {
  /** 返す数 (既定 20) */
  limit?: number
  /** 絞り込み。false を返した節は結果に入れない (数える前に外す) */
  filter?: (hit: Omit<SearchHit, 'score'>) => boolean
}

export interface SearchEngine {
  /** 節の数 */
  readonly size: number
  /** 添字から節の情報を引く */
  entry(index: number): Omit<SearchHit, 'score'>
  /** 点の高い順。`total` は絞り込みの後に当たった節の数 */
  search(query: string, options?: SearchOptions): { hits: SearchHit[]; total: number }
}

/** 索引を開く。字句の表は 1 回だけ Map にする */
export function openSearchIndex(data: SearchIndexData): SearchEngine {
  const N = data.ids.length
  const terms = new Map(Object.entries(data.terms))
  const entries = new Map<number, Omit<SearchHit, 'score'>>()
  const entry = (i: number): Omit<SearchHit, 'score'> => {
    let e = entries.get(i)
    if (!e) {
      const path: string[] = []
      for (let p = i; p >= 0; p = data.up[p]) path.unshift(data.titles[p])
      e = {
        index: i, id: data.ids[i], page: data.pages[i], title: data.titles[i], path,
        marks: MARK_KINDS.filter((_, n) => (data.marks[i] & (1 << n)) !== 0),
        fixtures: data.fx[i],
      }
      entries.set(i, e)
    }
    return e
  }
  return {
    size: N,
    entry,
    search(query, options = {}) {
      const score = new Float64Array(N)
      for (const t of new Set(tokenize(query))) {
        const p = terms.get(t)
        if (!p) continue
        let df = 0
        for (let j = 0; j < p.length; j++) { df++; if (p[j] < 0) j++ }
        const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5))
        let i = -1
        for (let j = 0; j < p.length; j++) {
          let tf = 1
          if (p[j] < 0) { i -= p[j]; tf = p[++j] } else i += p[j]
          score[i] += idf * tf * (K1 + 1) / (tf + K1 * (1 - B + B * data.dl[i] / data.avg))
        }
      }
      let order: number[] = []
      for (let i = 0; i < N; i++) if (score[i] > 0) order.push(i)
      if (options.filter) order = order.filter(i => options.filter!(entry(i)))
      // 同点は md の順 (添字の小さい方) で決める
      order.sort((a, b) => score[b] - score[a] || a - b)
      const hits = order.slice(0, options.limit ?? SEARCH_LIMIT).map(i => ({ ...entry(i), score: score[i] }))
      return { hits, total: order.length }
    },
  }
}

/** 抜粋。`marks` は `text` の中の当たった所 (始まり・終わり。重なりはまとめてある) */
export interface Snippet {
  text: string
  marks: [number, number][]
  /** 前と後ろを切ったか */
  head: boolean
  tail: boolean
}

/** md の飾り (表の縦線・太字・コードの印・見出しの `#`) を落として 1 行にする */
export function plainText(md: string): string {
  return md
    .replace(/^\s*\|?[\s:|-]*-{3,}[\s:|-]*$/gm, ' ')   // 表の区切りの行
    .replace(/^\s*(```|~~~).*$/gm, ' ')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*|`/g, '')
    .replace(/\s*\|\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * 問いに当たる所を中心に、文を `width` 字ほど切り出す。
 * 当たりは、問いの語 (空白で割った物)。語が丸ごとは出てこない時だけ、その語の字句 (和文は 2-gram) で探す。
 * 窓は、当たった語の種類が多い所を選ぶ (同じ語が何度も出る所より、別の語がそろう所)。
 * 当たりが無ければ頭から切る。`text` は飾りを落とした文 (`plainText`) を渡す。
 */
export function makeSnippet(text: string, query: string, width = 120): Snippet {
  const low = text.toLowerCase()
  const words = [...new Set(query.normalize('NFKC').toLowerCase().split(/\s+/).filter(Boolean))]
  // 探す文字列と重み。丸ごとの語は、字句より重い
  const needles: [string, number][] = []
  for (const w of words) {
    if (low.includes(w)) needles.push([w, 8])
    else for (const g of new Set(tokenize(w))) if (!needles.some(n => n[0] === g)) needles.push([g, 1])
  }
  // 当たり: [始まり, 終わり, 何番目の探す文字列か]
  const found: [number, number, number][] = []
  needles.forEach(([needle], k) => {
    for (let i = low.indexOf(needle), n = 0; i >= 0 && n < 200; i = low.indexOf(needle, i + 1), n++) {
      found.push([i, i + needle.length, k])
    }
  })
  if (found.length === 0) {
    const cut = text.length > width
    return { text: cut ? text.slice(0, width) : text, marks: [], head: false, tail: cut }
  }
  found.sort((a, b) => a[0] - b[0])
  // 窓の点 = 窓の中にある種類の重みの合計 (+ 当たりの数を少し)。最も高い窓を選ぶ
  const counts = needles.map(() => 0)
  let best = -1
  let bestAt = found[0][0]
  let kinds = 0
  let total = 0
  for (let a = 0, b = 0; a < found.length; a++) {
    while (b < found.length && found[b][1] <= found[a][0] + width) {
      if (counts[found[b][2]]++ === 0) kinds += needles[found[b][2]][1]
      total++
      b++
    }
    const score = kinds * 1000 + total
    if (score > best) { best = score; bestAt = found[a][0] }
    if (--counts[found[a][2]] === 0) kinds -= needles[found[a][2]][1]
    total--
  }
  const from = Math.max(0, Math.min(bestAt - Math.floor(width / 5), text.length - width))
  const to = Math.min(text.length, from + width)
  const marks: [number, number][] = []
  for (const [s, e] of found) {
    if (s < from || e > to) continue
    const prev = marks[marks.length - 1]
    if (prev && s <= prev[1]) prev[1] = Math.max(prev[1], e)
    else marks.push([s, e])
  }
  return {
    text: text.slice(from, to),
    marks: marks.map(([s, e]) => [s - from, e - from]),
    head: from > 0,
    tail: to < text.length,
  }
}
