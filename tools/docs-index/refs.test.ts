import { describe, it, expect } from 'vitest'
import { buildDocsFromRepoCached } from './build.js'
import { resolvedIds, splitRefs } from './refs.js'
import type { RefContext, RefIndex, RefPiece } from './refs.js'
import { refIndexOf } from './render.js'

/** 解けない参照の上限。超えたら、md の書き間違いか解き方の抜けを見る */
const MAX_UNRESOLVED = 5

/** 小さな索引 (実物を使わない単体の確かめ用) */
const SECTIONS = new Set([
  'v03/0', 'v05/0', 'v05/4.4.2', 'v05/4.6.3', 'v05/app', 'v05/app-A', 'v05/app-B', 'v05/app-C', 'v05/app-C.1', 'v05/app-H',
  'v06/0', 'v06/7.3', 'v07/0', 'v07/4.2', 'v07/4.3', 'v07/4.5', 'v07/4.6', 'v07/5', 'v07/4.13', 'v07/4.14', 'v07/4.16',
  'v11/0', 'v11/app', 'v11/app-F.0', 'v11/app-F.18', 'v13/0', 'v16/0', 'v16/2.4', 'v17/0', 'v17/4.2', 'v18/0', 'v18/2.3', 'v18/4.2', 'v19/0',
  'r17/top', 'r17/4.2', 'r18/top', 'r18/4.2', 'r19/top', 'r19/4.2', 'v-readme/0', 'v-readme/8',
])
const index: RefIndex = {
  hasSection: id => SECTIONS.has(id),
  docIntro: key => (SECTIONS.has(`${key}/0`) ? `${key}/0` : SECTIONS.has(`${key}/top`) ? `${key}/top` : null),
  outsideHas: (num, label) => num === '16' && label === '2.4',
  rows: new Set(['R1', 'R2', 'R4', 'R7', 'R11', 'R17']),
  rowsSection: 'v18/2.3',
}
const V07: RefContext = { selfKey: 'v07', selfKind: 'v' }
const R19: RefContext = { selfKey: 'r19', selfKind: 'r' }

/** 参照だけを「文 → 行き先」で並べる */
const refs = (text: string, ctx: RefContext = V07) =>
  splitRefs(text, ctx, index).filter(p => p.target).map(p => [p.text, show(p)])
const show = (p: RefPiece) =>
  p.target!.state === 'ok' ? p.target!.id + (p.target!.row ? '#' + p.target!.row : '') : p.target!.state === 'missing' ? '?' + p.target!.want : 'outside'

describe('節の参照 (#434)', () => {
  it('割ってつなげると元の文に戻る', () => {
    const text = '入力 (§4.2) と 05 §4.4.2・§4.6.3、→ 06・13 と docs/research/16 §2.4 の R-21。'
    expect(splitRefs(text, V07, index).map(p => p.text).join('')).toBe(text)
  })

  it('裸の § は同じメモ', () => {
    expect(refs('入力 (§4.2) が 0 より大きい')).toEqual([['§4.2', 'v07/4.2']])
    expect(refs('設計は §4.2 にある', R19)).toEqual([['§4.2', 'r19/4.2']])
  })

  it('番号つきは書いたメモと同じディレクトリ', () => {
    expect(refs('05 §4.4.2 を見る')).toEqual([['05 §4.4.2', 'v05/4.4.2']])
    expect(refs('担当外 (→ 06)。')).toEqual([['06', 'v06/0']])
    expect(refs('| → 13_pistons.md |')).toEqual([['13_pistons.md', 'v13/0']])
    // research の中の裸の番号は research
    expect(refs('17 §4.2 と 18 §4.2', R19)).toEqual([['17 §4.2', 'r17/4.2'], ['18 §4.2', 'r18/4.2']])
  })

  it('連結は直前の番号を引き継ぐ', () => {
    expect(refs('05 §4.4.2・§4.6.3')).toEqual([['05 §4.4.2', 'v05/4.4.2'], ['§4.6.3', 'v05/4.6.3']])
    expect(refs('§4.13〜§4.16')).toEqual([['§4.13', 'v07/4.13'], ['§4.16', 'v07/4.16']])
    expect(refs('§4.13〜4.16 と §4.5・4.6')).toEqual([['§4.13', 'v07/4.13'], ['4.16', 'v07/4.16'], ['§4.5', 'v07/4.5'], ['4.6', 'v07/4.6']])
    expect(refs('→ 06・13 を見る')).toEqual([['06', 'v06/0'], ['13', 'v13/0']])
    expect(refs('03 §4.9・05・17 §4.2')).toEqual([['03 §4.9', '?v03/4.9'], ['05', 'v05/0'], ['17 §4.2', 'v17/4.2']])
    expect(refs('05 §4.4.2 と §4.6.3 の表')).toEqual([['05 §4.4.2', 'v05/4.4.2'], ['§4.6.3', 'v05/4.6.3']])
    // 文が切れたら引き継がない
    expect(refs('05 §4.4.2 を見る。§4.2 は')).toEqual([['05 §4.4.2', 'v05/4.4.2'], ['§4.2', 'v07/4.2']])
    // 間の注記は 1 つ飛ばす
    expect(refs('05 付録 A (共通の流れ)・付録 B')).toEqual([['05 付録 A', 'v05/app-A'], ['付録 B', 'v05/app-B']])
    // 裸の § から始まった連結の後ろの数は、メモの番号と読まない
    expect(refs('§4.2・13 個の')).toEqual([['§4.2', 'v07/4.2']])
    // メモだけの参照と § の並びは別々の物
    expect(refs('R08・§4.2', R19)).toEqual([['R08', 'outside'], ['§4.2', 'r19/4.2']])
  })

  it('メモの番号と節の間の文 (の・は・括弧)', () => {
    expect(refs('→ 05 (§4.4.2)・16')).toEqual([['05', 'v05/0'], ['§4.4.2', 'v05/4.4.2'], ['16', 'v16/0']])
    expect(refs('19 は §4.2 を直す', { selfKey: 'v-readme', selfKind: 'v' })).toEqual([['19', 'v19/0'], ['§4.2', '?v19/4.2']])
    expect(refs('→ 17_entities-interplay.md (アレイは §4.2)')).toEqual([['17_entities-interplay.md', 'v17/0'], ['§4.2', 'v17/4.2']])
  })

  it('V## と R## と docs/ のパス', () => {
    expect(refs('V06 §7.3 と V06', R19)).toEqual([['V06 §7.3', 'v06/7.3'], ['V06', 'v06/0']])
    expect(refs('R18 §4.2 と R16 §5', R19)).toEqual([['R18 §4.2', 'r18/4.2'], ['R16 §5', 'outside']])
    expect(refs('docs/vanilla/07_diodes.md §4.3 と docs/research/18 §4.2')).toEqual([['docs/vanilla/07_diodes.md §4.3', 'v07/4.3'], ['docs/research/18 §4.2', 'r18/4.2']])
    expect(refs('docs/vanilla 18 §2.3 の表', R19)).toEqual([['docs/vanilla 18 §2.3', 'v18/2.3']])
    // vanilla の 17〜19 と research の 17〜19 を解き分ける
    expect(refs('17 §4.2')).toEqual([['17 §4.2', 'v17/4.2']])
    expect(refs('17 §4.2', R19)).toEqual([['17 §4.2', 'r17/4.2']])
    expect(refs('docs/research/17 §4.2')).toEqual([['docs/research/17 §4.2', 'r17/4.2']])
    // パスの後ろの並びはディレクトリを引き継ぐ
    expect(refs('docs/research/15 §1.3・17 §4.2')).toEqual([['docs/research/15 §1.3', 'outside'], ['17 §4.2', 'r17/4.2']])
  })

  it('V18 の R# と、vanilla 18 の中の R# は §2.3 の表の行', () => {
    expect(refs('V18 の R4・R7・R11 (段 E4)', R19)).toEqual([['V18', 'v18/0'], ['R4', 'v18/2.3#R4'], ['R7', 'v18/2.3#R7'], ['R11', 'v18/2.3#R11']])
    expect(refs('R1〜R17 の順', { selfKey: 'v18', selfKind: 'v' })).toEqual([['R1', 'v18/2.3#R1'], ['R17', 'v18/2.3#R17']])
    // 表に無い行と、ほかのメモの中の 1 桁の R# は参照にしない
    expect(refs('R9 は無い', { selfKey: 'v18', selfKind: 'v' })).toEqual([])
    expect(refs('R4 の行')).toEqual([])
    // vanilla 18 の中でも、直後が § の R17〜R19 は research のメモ (表の行は節を持たない)
    expect(refs('R17 と R18 §4.2', { selfKey: 'v18', selfKind: 'v' })).toEqual([['R17', 'v18/2.3#R17'], ['R18 §4.2', 'r18/4.2']])
    expect(refs('V18 の R4 と R18 §4.2', R19)).toEqual([['V18', 'v18/0'], ['R4', 'v18/2.3#R4'], ['R18 §4.2', 'r18/4.2']])
  })

  it('付録は ID の系列に寄せる', () => {
    expect(refs('05 付録 C.1 (F3)')).toEqual([['05 付録 C.1', 'v05/app-C.1']])
    expect(refs('05 付録 A〜H')).toEqual([['05 付録 A', 'v05/app-A'], ['H', 'v05/app-H']])
    expect(refs('11 付録 F.0〜F.18')).toEqual([['11 付録 F.0', 'v11/app-F.0'], ['F.18', 'v11/app-F.18']])
    // 項目の番号まで書いてあるときは、見出しのある所へ上がる
    expect(refs('05 付録 C.1.2')).toEqual([['05 付録 C.1.2', 'v05/app-C.1']])
    // `付録 F` の見出しが無く `F.0`〜 だけのときは、付録の頭
    expect(refs('→ 11 付録 F')).toEqual([['11 付録 F', 'v11/app']])
    // 凡例の「NN 付録 X.y」は参照にしない
    expect(refs('「NN 付録 X.y」と書く')).toEqual([])
  })

  it('research 01〜16 と R-6 の形はリンクにしない', () => {
    expect(refs('docs/research/16_nucleation-comparison.md §2.4 の R-21')).toEqual([['docs/research/16_nucleation-comparison.md §2.4', 'outside'], ['R-21', 'outside']])
    expect(refs('R-6 (tick の中の OFF は -2 固定)')).toEqual([['R-6', 'outside']])
    expect(refs('R08・R13', R19)).toEqual([['R08', 'outside'], ['R13', 'outside']])
  })

  it('vanilla の中の裸の 16 § を research 16 と読む場合', () => {
    expect(refs('16 §2.4 を見る')).toEqual([['16 §2.4', 'v16/2.4']])
    expect(refs('16 §2.4 の R-21 と同じ')).toEqual([['16 §2.4', 'outside'], ['R-21', 'outside']])
    expect(refs('16 §2.4 に既出', { ...V07, inCompare: true })).toEqual([['16 §2.4', 'outside']])
    expect(refs('(→ 16 §2.4)', { ...V07, inCompare: true })).toEqual([['16 §2.4', 'v16/2.4']])
    expect(refs('16 §2.4', { ...V07, headingDoc: { kind: 'r', num: '16' } })).toEqual([['16 §2.4', 'outside']])
  })

  it('§9 の表の 1 列目の裸の § は、見出しに挙げた資料の節', () => {
    const first: RefContext = { ...V07, bareDoc: { kind: 'r', num: '02' } }
    expect(refs('§6.2「comparator の遅延」', first)).toEqual([['§6.2', 'outside']])
    expect(refs('§4.2', { ...V07, bareDoc: { kind: 'r', num: '18' } })).toEqual([['§4.2', 'r18/4.2']])
  })

  it('参照ではない物', () => {
    // 値の移り変わり
    expect(refs('軽い板なら 12 → 15')).toEqual([])
    expect(refs('手順 6 → 7 → 9 → 10 の順')).toEqual([])
    // 左の項が 1 つ前の番号で始まる並び・量だけの項 (人数 → 信号の強さ)
    expect(refs('8 ブロックイベント → 9 エンティティ → 10 BlockEntity → 11 エンティティ管理')).toEqual([])
    expect(refs('1〜10 体 → 1、141 体以上 → 15')).toEqual([])
    // 特定のメモを指さない §
    expect(refs('各メモの §7 と、メモの §9 に返す')).toEqual([])
    expect(refs('本メモ §4.2 と同じ')).toEqual([['§4.2', 'v07/4.2']])
    // 数の並び・版の番号
    expect(refs('d² (7・15・23・28 …) は表に現れない。1.21.1 → 26.2')).toEqual([])
    // 載せていない番号
    expect(refs('→ 42 と 99 §1')).toEqual([])
  })

  it('メモの番号の連鎖 (→ 11 → 09) は直前の参照を引き継ぐ', () => {
    expect(refs('05 §4.4.2 と 06 §7.3 (redstone_ore → 11 → 13 / 17)'))
      .toEqual([['05 §4.4.2', 'v05/4.4.2'], ['06 §7.3', 'v06/7.3'], ['11', 'v11/0'], ['13', 'v13/0']])
    // 数字で始まるだけの文はメモの参照のまま
    expect(refs('2 マスの自分を読むだけで準接続ではない → 11')).toEqual([['11', 'v11/0']])
    // 左の項の頭が参照なら、頭の数字はメモの番号
    expect(refs('05 §4.4.2 の表 → 06')).toEqual([['05 §4.4.2', 'v05/4.4.2'], ['06', 'v06/0']])
  })

  it('README の読む順は矢印の左も右もメモ', () => {
    const readme: RefContext = { selfKey: 'v-readme', selfKind: 'v' }
    expect(refs('05 → 18', readme)).toEqual([['05', 'v05/0'], ['18', 'v18/0']])
    expect(refs('書き方の決まり (§8)', readme)).toEqual([['§8', 'v-readme/8']])
  })

  it('行き先の節が無ければ missing', () => {
    expect(refs('§9.9 と 05 §9.9')).toEqual([['§9.9', '?v07/9.9'], ['05 §9.9', '?v05/9.9']])
  })

  it('解けた ID を重複なしで返す', () => {
    expect(resolvedIds(splitRefs('§4.2・§4.3 と §4.2、R-6', V07, index))).toEqual(['v07/4.2', 'v07/4.3'])
  })

  it(`実物: 解けない参照は ${MAX_UNRESOLVED} 件以下`, () => {
    const { stats } = buildDocsFromRepoCached()
    const list = stats.missing.map(m => `${m.section} の「${m.text}」→ ${m.want}`)
    expect(list.length, list.join('\n')).toBeLessThanOrEqual(MAX_UNRESOLVED)
    // 今の 1 件は、00 §3.2 が「誤っていた参照」として引用している文
    expect(list).toEqual(['v00/3.2 の「02 §1.4」→ v02/1.4'])
    expect(stats.refs).toBeGreaterThan(3500)
    expect(stats.refsOutside).toBeGreaterThan(300)
  })

  it('実物: 方針で挙げた参照が狙った節へ飛ぶ', () => {
    const { model, pages } = buildDocsFromRepoCached()
    const idx = refIndexOf(model)
    expect(idx.rows.size).toBe(18)
    // `05 §4.4.2・§4.6.3` の 2 つ目が V05 へ飛ぶ
    const hit = [...pages.values()].find(p => /data-ref="v05\/4\.4\.2">[^<]*<\/a>・<a class="ref" href="#\/v05\/4\.6\?s=4\.6\.3"/.test(p.html))
    expect(hit, '05 §4.4.2・§4.6.3 の並び').toBeDefined()
    // research/19 の頭の凡例: V18 の R4 は表の行、R18 §4.2 は research 18
    const top = pages.get('r19/top')!.html
    expect(top).toMatch(/<a class="ref" href="#\/v18\/2\?s=2\.3" data-ref="v18\/2\.3" data-row="R4">R4<\/a>/)
    expect(top).toMatch(/<a class="ref" href="#\/r18\/4\?s=4\.2" data-ref="r18\/4\.2">R18 §4\.2<\/a>/)
    // research 01〜16 への参照はリンクにならない
    const all = [...pages.values()].map(p => p.html).join('\n')
    expect(all).not.toMatch(/href="#\/r(0\d|1[0-6])\b/)
    expect(all).toMatch(/<span class="ref-out" title="この Web に無い資料">docs\/research\/16/)
    // リンクの行き先は全部、実在するページと節
    for (const m of all.matchAll(/<a class="ref" href="#\/([^"?]+)(?:\?s=([^"]+))?" data-ref="([^"]+)"/g)) {
      const sec = model.sectionById.get(m[3])
      expect(sec, m[0]).toBeDefined()
      expect(sec!.page).toBe(m[1])
    }
  })
})
