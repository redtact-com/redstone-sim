/**
 * 本文の節の参照を解く (#434)。md には何も書き足さず、ビルドで文字から読む。
 *
 * | 書き方 | 解き方 |
 * |---|---|
 * | 裸の `§4.2` | 同じメモ |
 * | `05 §4.4.2`・`→ 06`・`→ NN_name.md` | 書いたメモと同じディレクトリの番号 |
 * | `§4.5・§5`・`§4.13〜§4.16`・`§4.3〜4.6` の連結 | 直前の番号 (メモ) を引き継ぐ |
 * | `V06 §7.3`・`V06`・`docs/vanilla/NN` | vanilla |
 * | `R18 §4.2`・`docs/research/NN` | research。17〜19 だけリンク |
 * | `V18 の R4`、vanilla/18 の中の `R1〜R18` | vanilla 18 §2.3 の表の行 |
 * | `05 付録 C.1`・`付録 A〜H` | 付録の ID の系列 |
 * | research 01〜16 向け・`R-6` の形 | リンクにしない (「この Web に無い資料」) |
 *
 * 読み違えやすい所 (決めた扱い):
 * - 各メモの §9 (既存資料との食い違い) の表の**1 列目**の裸の `§x.y` は、その節の見出しに挙げた
 *   資料の節を指す (docs/vanilla/README.md §3.3)。2 列目から後ろは同じメモの節
 * - vanilla のメモの中の裸の `16 §2.4` は vanilla 16 だが、次のどれかなら research 16 (この Web に無い):
 *   後ろに `R-21` が続く・§9 の見出しが research 16 を挙げている・§9 の中で矢印が無く、
 *   その番号の節が research 16 にある (節の番号は vanilla と research で重なるので、節の有無だけでは決まらない)
 * - `12 → 15` のような値の移り変わりは参照にしない (矢印の左が数字)。README の読む順の表だけは別
 */

import { RESEARCH_IN_SCOPE } from './split.js'

/** メモを指す (ディレクトリ + 2 桁) */
export interface DocRef {
  kind: 'v' | 'r'
  num: string
}

/** 参照の行き先 */
export type RefTarget =
  /** 解けた。`id` は節の ID (メモだけの参照は前置きの節)。`row` は vanilla 18 §2.3 の表の行 */
  | { state: 'ok'; id: string; row?: string }
  /** この Web に無い資料 */
  | { state: 'outside' }
  /** 行き先の節が無い (`want` は探した ID)。ビルドが数える */
  | { state: 'missing'; want: string }

export interface RefPiece {
  text: string
  /** 無ければただの文 */
  target?: RefTarget
}

/** 実在する ID の表 */
export interface RefIndex {
  hasSection(id: string): boolean
  /** メモの前置きの節の ID (`v07` → `v07/0`)。メモが無ければ null */
  docIntro(key: string): string | null
  /** この Web に載せない research (01〜16) に、その番号の節があるか */
  outsideHas(num: string, label: string): boolean
  /** vanilla 18 §2.3 の表の行 (`R1`…) と、その節の ID */
  rows: ReadonlySet<string>
  rowsSection: string
}

export interface RefContext {
  /** 書いたメモの ID (`v07`・`r19`・`v-readme`) */
  selfKey: string
  /** 書いたメモのディレクトリ */
  selfKind: 'v' | 'r'
  /** 裸の `§` が指すメモ。§9 の表の 1 列目では見出しに挙げた資料、ほかは null (= 同じメモ) */
  bareDoc?: DocRef | null
  /** §9 の見出しに挙げた資料。裸の `NN §` の番号がこれと同じなら、その資料として読む */
  headingDoc?: DocRef | null
  /** vanilla のメモの §9 (既存資料との食い違い) の中か */
  inCompare?: boolean
}

const keyOf = (d: DocRef) => `${d.kind}${d.num}`
const inScope = (d: DocRef) => d.kind === 'v' || RESEARCH_IN_SCOPE.includes(d.num)

/**
 * 連結のつなぎ。この文だけを挟んで続く参照は、直前のメモを引き継ぐ。
 * 間の注記 (`付録 A (共通の流れ)・付録 B.1`) は 1 つだけ飛ばす。`01 §1.2 と §4.5` の `と` もつなぎ
 */
const SEP = /^(?:\s*[(（][^()（）]*[)）])?\s*[(（]?\s*(?:[・〜、,]|と)?\s*$/

/** メモの番号と節の間に挟まってよい文 (`05 (§4.7.2)`・`16_x.md の §2.7`・`19 は §1.1`・`17_x.md (アレイは付録 A.2`) */
const DOC_TO_SECTION = /^\s*(?:の|は|[(（][^()（）。§]{0,10})?\s*$/

/** 特定のメモを指さない `§` (`各メモの §6`・`メモの §9`・`その §4.3`)。参照にしない。`本メモ §4.3` は同じメモ */
const GENERIC_BEFORE = /(?:各メモ|(?<!本)(?<!この)メモ|その)(?:の)?\s?$/

const MASTER = new RegExp([
  // docs/research/16_x.md・docs/vanilla/02・docs/vanilla 18・docs/research の 02
  String.raw`(?<path>docs\/(?<pdir>vanilla|research)(?:\/|\s(?:の\s)?)(?<pnum>\d{2})(?![\d.])(?:_[a-z0-9-]+)?(?:\.md)?)`,
  // 07_diodes.md
  String.raw`(?<file>(?<![\w/-])(?<fnum>\d{2})_[a-z0-9-]+\.md)`,
  // V06
  String.raw`(?<vdoc>(?<![A-Za-z0-9_-])V(?<vnum>\d{2})(?![\d-]))`,
  // R18 (research)・R4 (vanilla 18 の表の行)
  String.raw`(?<rtok>(?<![A-Za-z0-9_-])R(?<rnum>\d{1,2})(?![\d-]))`,
  // R-6 (research 16 の番号)
  String.raw`(?<rdash>(?<![A-Za-z0-9])R-\d+[a-z]?)`,
  // §4.3
  String.raw`(?<sec>§\s?(?<snum>\d+(?:\.\d+)*))`,
  // 付録 C.1・付録 A・付録
  String.raw`(?<app>付録(?:\s?(?<alet>[A-Z])(?:\.(?<anum>\d+(?:\.\d+)*))?(?![A-Za-z0-9-])(?!\.[a-z]))?)`,
  // → 06 (矢印は文のまま残し、番号だけを参照にする)
  String.raw`(?<arrow>→\s?)(?<wnum>\d{2})(?![\d_.])(?!\s?(?:個|本|件|行|回|倍|gt|tick|%))`,
  // 05 §4.4.2・05 付録 C.1 の頭の番号。README の読む順 (01 → 02) の頭も拾う
  String.raw`(?<bare>(?<![\w.§/-])(?<bnum>\d{2})(?=\s?(?:§\s?\d|付録|は\s?§\s?\d|→\s?\d{2}(?![\d_.]))))`,
].join('|'), 'g')

/** 直前の参照から引き継ぐ物 */
interface Chain {
  end: number
  /** 引き継ぐメモ。null は同じメモ */
  doc: DocRef | null
  /** 裸の `§` から始まった連結か (後ろの `・15` をメモの番号と読まない) */
  bareStart: boolean
  /** 載せていない番号 (`99 §1`) の後ろか。続く `§` を同じメモの節と読み違えないために覚える */
  dead?: boolean
  mode: 'doc' | 'sec' | 'app' | 'row'
}

/** 文を、参照とそれ以外に割る。つなげると元の文に戻る */
export function splitRefs(text: string, ctx: RefContext, index: RefIndex): RefPiece[] {
  const pieces: RefPiece[] = []
  /** 各 piece がメモだけの参照か (後ろの節と 1 つにまとめるため) */
  const docOnly: boolean[] = []
  let pos = 0
  let chain: Chain | null = null
  const self: DocRef | null = /^[vr]\d\d$/.test(ctx.selfKey) ? { kind: ctx.selfKind, num: ctx.selfKey.slice(1) } : null

  const plain = (to: number) => {
    if (to > pos) { pieces.push({ text: text.slice(pos, to) }); docOnly.push(false) }
    pos = to
  }
  const emit = (from: number, to: number, target: RefTarget | null, isDoc = false) => {
    plain(from)
    pieces.push(target ? { text: text.slice(from, to), target } : { text: text.slice(from, to) })
    docOnly.push(isDoc && target !== null)
    pos = to
  }
  const chained = (at: number): Chain | null => (chain && SEP.test(text.slice(chain.end, at)) ? chain : null)
  /**
   * 節・付録の参照が引き継ぐ連結。メモだけの参照の後ろは、空白だけを挟むとき (`05 §4.4`) に限る。
   * `R08・§4.4` は「資料 08 と、このメモの §4.4」の並びなので引き継がない
   */
  const chainedForSection = (at: number): Chain | null => {
    if (chain && chain.mode === 'doc') return DOC_TO_SECTION.test(text.slice(chain.end, at)) ? chain : null
    return chained(at)
  }

  /** メモだけの参照の行き先。載せないメモの番号 (vanilla 20 以上など) は参照にしない */
  const docTarget = (d: DocRef): RefTarget | null => {
    if (!inScope(d)) return Number(d.num) >= 1 && Number(d.num) <= 16 ? { state: 'outside' } : null
    const intro = index.docIntro(keyOf(d))
    return intro ? { state: 'ok', id: intro } : null
  }
  const sectionTarget = (d: DocRef | null, label: string): RefTarget => {
    if (d && !inScope(d)) return { state: 'outside' }
    const key = d ? keyOf(d) : ctx.selfKey
    let id = `${key}/${label}`
    if (index.hasSection(id)) return { state: 'ok', id }
    if (label.startsWith('app-')) {
      // `付録 A.12` のように項目の番号まで書いてあるときは、見出しのある所まで上がる
      while (id.includes('.')) {
        id = id.slice(0, id.lastIndexOf('.'))
        if (index.hasSection(id)) return { state: 'ok', id }
      }
      // `11 付録 F` は、見出しが `F.0`〜 だけで `付録 F` が無い。付録の頭へ寄せる
      if (index.hasSection(`${id}.0`) || index.hasSection(`${id}.1`)) {
        if (index.hasSection(`${key}/app`)) return { state: 'ok', id: `${key}/app` }
      }
    }
    return { state: 'missing', want: `${key}/${label}` }
  }
  /** 裸の番号がどのメモか。連結の中なら直前のディレクトリを引き継ぐ */
  const bareDoc = (num: string, at: number, after: string): DocRef => {
    const c = chained(at)
    if (c && c.doc) return { kind: c.doc.kind, num }
    if (ctx.selfKind === 'v') {
      if (ctx.headingDoc && ctx.headingDoc.kind === 'r' && ctx.headingDoc.num === num) return { kind: 'r', num }
      // §9 は docs/research の資料と比べる節。矢印の無い `02 §5.3`・`16 §2.4` は、その番号の節が
      // research の側にあれば research として読む (矢印つきの `→ 04 §4.2` はメモの参照)
      const sec = /^\s?§\s?(\d+(?:\.\d+)*)/.exec(after)
      if (ctx.inCompare && sec && index.outsideHas(num, sec[1])) return { kind: 'r', num }
      // `16 §2.4 の R-21`・`16 §2 (R-8)` は research 16 の番号
      if (num === '16' && /^\s?§\s?[\d.]+(?:\s?[・、]\s?§?[\d.]+)*\s?(?:の\s?|\()R-\d/.test(after)) return { kind: 'r', num }
    }
    return { kind: ctx.selfKind, num }
  }

  MASTER.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = MASTER.exec(text))) {
    const g = m.groups!
    const at = m.index
    const end = at + m[0].length
    if (g.path !== undefined) {
      const d: DocRef = { kind: g.pdir === 'vanilla' ? 'v' : 'r', num: g.pnum }
      emit(at, end, docTarget(d), true)
      chain = { end, doc: d, bareStart: false, mode: 'doc' }
    } else if (g.file !== undefined) {
      const c = chained(at)
      const d: DocRef = { kind: c && c.doc ? c.doc.kind : ctx.selfKind, num: g.fnum }
      emit(at, end, docTarget(d), true)
      chain = { end, doc: d, bareStart: false, mode: 'doc' }
    } else if (g.vdoc !== undefined) {
      const d: DocRef = { kind: 'v', num: g.vnum }
      emit(at, end, docTarget(d), true)
      chain = { end, doc: d, bareStart: false, mode: 'doc' }
    } else if (g.rtok !== undefined) {
      const c = chained(at)
      const afterV18 = chain !== null && chain.doc !== null && keyOf(chain.doc) === 'v18'
        && (chain.mode === 'row' ? c !== null : /^\s?の\s?$/.test(text.slice(chain.end, at)))
      if (afterV18 || ctx.selfKey === 'v18') {
        // vanilla 18 §2.3 の表の行
        const row = `R${Number(g.rnum)}`
        if (index.rows.has(row)) {
          emit(at, end, { state: 'ok', id: index.rowsSection, row })
          chain = { end, doc: { kind: 'v', num: '18' }, bareStart: false, mode: 'row' }
        }
      } else if (g.rnum.length === 2) {
        const d: DocRef = { kind: 'r', num: g.rnum }
        emit(at, end, docTarget(d), true)
        chain = { end, doc: d, bareStart: false, mode: 'doc' }
      }
    } else if (g.rdash !== undefined) {
      emit(at, end, { state: 'outside' })
    } else if (g.sec !== undefined) {
      const c = chainedForSection(at)
      if (c && c.dead) continue
      if (!c && GENERIC_BEFORE.test(text.slice(0, at))) continue
      const doc = c ? c.doc : (ctx.bareDoc ?? null)
      const sameAsSelf = doc !== null && self !== null && keyOf(doc) === keyOf(self)
      emit(at, end, sectionTarget(sameAsSelf ? null : doc, g.snum))
      chain = { end, doc, bareStart: c ? c.bareStart : true, mode: 'sec' }
    } else if (g.app !== undefined) {
      const c = chainedForSection(at)
      if (g.alet === undefined) {
        // 文字の無い「付録」は、メモの番号の直後 (`11 付録`) のときだけ参照にする
        if (c && c.mode === 'doc' && c.doc && inScope(c.doc)) {
          const t = sectionTarget(c.doc, 'app')
          if (t.state === 'ok') { emit(at, end, t); chain = { end, doc: c.doc, bareStart: false, mode: 'app' } }
        }
      } else {
        const doc = c ? c.doc : null
        emit(at, end, sectionTarget(doc, `app-${g.alet}${g.anum ? '.' + g.anum : ''}`))
        chain = { end, doc, bareStart: c ? c.bareStart : true, mode: 'app' }
      }
    } else if (g.wnum !== undefined) {
      const numAt = at + g.arrow.length
      // `12 → 15` は値の移り変わり。README の読む順 (01 → 02) だけはメモの番号
      const valueArrow = /\d\s?$/.test(text.slice(0, at)) && ctx.selfKey !== 'v-readme'
      const d: DocRef = { kind: ctx.selfKind, num: g.wnum }
      const t = valueArrow ? null : docTarget(d)
      if (t) {
        emit(numAt, end, t, true)
        chain = { end, doc: d, bareStart: false, mode: 'doc' }
      }
    } else if (g.bare !== undefined) {
      const isOrder = /^\s?→/.test(text.slice(end))
      if (isOrder && ctx.selfKey !== 'v-readme') continue
      const d = bareDoc(g.bnum, at, text.slice(end))
      const t = docTarget(d)
      if (t) {
        emit(at, end, t, true)
        chain = { end, doc: d, bareStart: false, mode: 'doc' }
      } else {
        chain = { end, doc: d, bareStart: false, mode: 'doc', dead: true }
      }
    }

    // 記号を省いた続き: `§4.3〜4.6`・`付録 F.0〜F.18`・`→ 04・13`・`V18 の R4・R7`
    for (;;) {
      const cur: Chain | null = chain
      if (cur === null || cur.end !== pos || cur.dead) break
      const rest = text.slice(pos)
      let k: RegExpExecArray | null
      if (cur.mode === 'sec' && (k = /^(\s?〜\s?)(\d+(?:\.\d+)*)(?!\s?(?:個|本|件|行|回|倍|gt|tick|%))|^(\s?[・、,]\s?)(\d+(?:\.\d+)+)(?!\s?§)/.exec(rest))) {
        const sep = k[1] ?? k[3]
        const num = k[2] ?? k[4]
        const sameAsSelf = cur.doc !== null && self !== null && keyOf(cur.doc) === keyOf(self)
        emit(pos + sep.length, pos + sep.length + num.length, sectionTarget(sameAsSelf ? null : cur.doc, num))
        chain = { ...cur, end: pos }
      } else if (cur.mode === 'app' && (k = /^(\s?[〜・、]\s?)([A-Z])(?:\.(\d+(?:\.\d+)*))?(?![A-Za-z0-9-])/.exec(rest))) {
        const from = pos + k[1].length
        emit(from, pos + k[0].length, sectionTarget(cur.doc, `app-${k[2]}${k[3] ? '.' + k[3] : ''}`))
        chain = { ...cur, end: pos }
      } else if (!cur.bareStart && cur.mode !== 'row'
        && (k = /^([)）]?\s?[・、]\s?)(\d{2})(?![\d_.])(?=\s*(?:$|[・、)）。|]|\s[^\d\s§]))/.exec(rest))) {
        // メモの番号の並び (`→ 04・13`・`03 §4.9・05・14`)。ディレクトリは直前から引き継ぐ
        const d: DocRef = { kind: cur.doc ? cur.doc.kind : ctx.selfKind, num: k[2] }
        const t = docTarget(d)
        if (!t) break
        emit(pos + k[1].length, pos + k[0].length, t, true)
        chain = { end: pos, doc: d, bareStart: false, mode: 'doc' }
      } else break
      MASTER.lastIndex = pos
    }
  }
  plain(text.length)
  return mergeDocAndSection(pieces, docOnly)
}

/** `05` + ` ` + `§4.4.2` を 1 つの参照にまとめる (リンクが 2 つ並ばないように) */
function mergeDocAndSection(pieces: RefPiece[], docOnly: boolean[]): RefPiece[] {
  const out: RefPiece[] = []
  for (let i = 0; i < pieces.length; i++) {
    const a = pieces[i]
    const gap = pieces[i + 1]
    const b = pieces[i + 2]
    if (docOnly[i] && gap && !gap.target && /^\s*$/.test(gap.text) && b && b.target && !docOnly[i + 2]
      && /^(§|付録)/.test(b.text) && sameDoc(a.target!, b.target)) {
      out.push({ text: a.text + gap.text + b.text, target: b.target })
      i += 2
    } else if (docOnly[i] && gap && gap.target && !docOnly[i + 1] && /^(§|付録)/.test(gap.text) && sameDoc(a.target!, gap.target)) {
      out.push({ text: a.text + gap.text, target: gap.target })
      i += 1
    } else {
      out.push(a)
    }
  }
  return out
}

/** メモの参照と、続く節の参照が同じメモを指すか (まとめてよいか) */
function sameDoc(doc: RefTarget, sec: RefTarget): boolean {
  if (doc.state === 'outside') return sec.state === 'outside'
  if (doc.state !== 'ok') return false
  const key = doc.id.slice(0, doc.id.indexOf('/'))
  if (sec.state === 'ok') return sec.id.startsWith(key + '/')
  if (sec.state === 'missing') return sec.want.startsWith(key + '/')
  return false
}

/** 文の中の解けた参照の ID (重複を除く・出てくる順) */
export function resolvedIds(pieces: readonly RefPiece[]): string[] {
  const out: string[] = []
  for (const p of pieces) {
    if (p.target?.state === 'ok' && !out.includes(p.target.id)) out.push(p.target.id)
  }
  return out
}
