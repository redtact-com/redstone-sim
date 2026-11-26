/**
 * クラス → 節 (#434)。00 の網羅表 (docs/vanilla/00_coverage.md) の担当欄を読む。
 *
 * - 表は 1 列目の見出しが「クラス」の物。行 = クラス 1 個 (`entity/HopperBlockEntity` のようにパスつきの行もある)
 * - 担当欄の節の参照は、本文と同じ決まり (refs.ts) で解く。番号だけの `07`・`04・05` はメモ全体 (前置きの節)
 * - 担当欄の裸の `F4` は族 (00 §1.4)。族の「どこに書いてあるか」の節を足す。
 *   括弧の中の `(F3: …)` は、前の節への注記なので足さない
 * - 状態が「対象外」の行は節を引かない (理由の文に出る節は、担当ではない)
 */

import { refIndexOf } from './render.js'
import { splitRefs } from './refs.js'
import type { RefContext, RefIndex } from './refs.js'
import type { Model } from './split.js'

/** 網羅表のメモの ID と、族の表がある節 */
export const COVERAGE_DOC = 'v00'
export const FAMILY_SECTION = 'v00/1.4'

/** 網羅表の 1 行 */
export interface ClassRow {
  /** クラスの単純な名前 (`HopperBlockEntity`) */
  name: string
  /** 表に書いてある形 (`entity/HopperBlockEntity`)。パスなしなら name と同じ */
  written: string
  /** 行がある節の ID と、md の行 (1 始まり) */
  row: string
  line: number
  /** 状態 (`記述済`・`対象外`) */
  state: string
  /** 担当欄の文 (md のまま) */
  owner: string
  /** 担当欄の裸の族 (`F4`) */
  families: string[]
  /** 担当の節の ID (出てくる順・重複を除く)。族の節は後ろ */
  sections: string[]
}

export interface Coverage {
  rows: ClassRow[]
  /** 族 → 節 (00 §1.4 の「どこに書いてあるか」) */
  families: Map<string, string[]>
  /** 担当欄の参照の数と、そのうち解けた数 (族は数えない) */
  refs: number
  resolved: number
  /** 解けなかった参照 (`クラス: 文`) */
  missing: string[]
}

const CTX: RefContext = { selfKey: COVERAGE_DOC, selfKind: 'v' }

/** 表の行を列に割る (`\|` は列の中の縦線) */
function cells(line: string): string[] {
  return line.replace(/\\\|/g, '\u0001').split('|').slice(1, -1).map(c => c.replace(/\u0001/g, '|').trim())
}

const SEPARATOR = /^:?-+:?$/

/** 節の本文の表を、[見出しの列, 行の列, 行の番号 (本文の中・0 始まり)] で回す */
function* tableRows(text: string): Generator<{ head: string[]; cols: string[]; at: number }> {
  let head: string[] | null = null
  let fence = false
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i]
    if (/^\s*(```|~~~)/.test(ln)) { fence = !fence; head = null; continue }
    if (fence || !ln.startsWith('|')) { head = null; continue }
    const cols = cells(ln)
    if (cols.length > 0 && cols.every(c => SEPARATOR.test(c))) continue
    if (!head) { head = cols; continue }
    yield { head, cols, at: i }
  }
}

/** 文の中の節の参照を解く。番号だけ (`07`・`04・05`) はメモ全体として読む */
function ownerRefs(text: string, index: RefIndex): { ok: string[]; missing: string[]; total: number } {
  const ok: string[] = []
  const missing: string[] = []
  let total = 0
  for (const piece of splitRefs(text, CTX, index)) {
    if (piece.target) {
      total++
      if (piece.target.state === 'ok') ok.push(piece.target.id)
      else if (piece.target.state === 'missing') missing.push(piece.text)
      continue
    }
    // 参照にならなかった文の中の、番号だけのメモ
    for (const m of piece.text.matchAll(/(?<![\w.§/-])(\d{2})(?![\w.]|\s?(?:gt|個|本|件|行|回|倍|段|種|%))/g)) {
      const intro = index.docIntro(`v${m[1]}`)
      if (!intro) continue
      total++
      ok.push(intro)
    }
  }
  return { ok, missing, total }
}

const uniq = <T>(list: readonly T[]): T[] => [...new Set(list)]

/** 括弧の中を落とす (入れ子は 1 段)。族が裸かどうかを見るのに使う */
const outsideParens = (text: string) => text.replace(/[(（][^()（）]*[)）]/g, ' ')

/** 網羅表を読む */
export function readCoverage(model: Model, index: RefIndex = refIndexOf(model)): Coverage {
  const families = new Map<string, string[]>()
  const fam = model.sectionById.get(FAMILY_SECTION)
  if (fam) {
    for (const { head, cols } of tableRows(fam.text)) {
      const where = head.findIndex(h => h.startsWith('どこに書いてあるか'))
      const m = /^(F\d+)\b/.exec(cols[0] ?? '')
      if (head[0] !== '族' || where < 0 || !m) continue
      families.set(m[1], uniq(ownerRefs(cols[where] ?? '', index).ok))
    }
  }

  const rows: ClassRow[] = []
  const missing: string[] = []
  let refs = 0
  let resolved = 0
  for (const s of model.sections) {
    if (s.doc !== COVERAGE_DOC) continue
    for (const { head, cols, at } of tableRows(s.text)) {
      if (head[0] !== 'クラス') continue
      const col = (name: string) => cols[head.findIndex(h => h.startsWith(name))] ?? ''
      const written = cols[0]
      const state = col('状態')
      const owner = col('担当')
      const row: ClassRow = {
        name: written.split('/').pop()!, written, row: s.id, line: s.line + 1 + at,
        state, owner, families: [], sections: [],
      }
      if (state === '記述済') {
        const r = ownerRefs(owner, index)
        refs += r.total
        resolved += r.ok.length
        for (const t of r.missing) missing.push(`${row.name}: ${t}`)
        row.families = uniq([...outsideParens(owner).matchAll(/(?<![\w-])F\d+(?![\w.])/g)].map(m => m[0]))
          .filter(f => families.has(f))
        row.sections = uniq([...r.ok, ...row.families.flatMap(f => families.get(f)!)])
      }
      rows.push(row)
    }
  }
  return { rows, families, refs, resolved, missing }
}
