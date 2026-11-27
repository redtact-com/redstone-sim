import { describe, it, expect } from 'vitest'
import {
  buildSearchIndex, makeSnippet, openSearchIndex, plainText, tokenize, DOCS_DATA_VERSION,
} from '@redstone/docs-kit'
import type { SearchInput } from '@redstone/docs-kit'

/** 検索 (#434)。字句分け・採点・絞り込み・抜粋。実物の md での当たり方は tools/docs-index/search.test.ts */

const sec = (id: string, title: string, text: string, more: Partial<SearchInput> = {}): SearchInput => ({
  id, page: id, title, parent: null, text, marks: [], fixtures: 0, ...more,
})

describe('字句分け', () => {
  it('和文の連なりは 2-gram。1 字だけなら 1 字', () => {
    expect(tokenize('リピーター')).toEqual(['リピ', 'ピー', 'ータ', 'ター'])
    expect(tokenize('準接続')).toEqual(['準接', '接続'])
    expect(tokenize('水')).toEqual(['水'])
    // 助詞をまたいでつながる (分かち書きはしない)
    expect(tokenize('水の横')).toEqual(['水の', 'の横'])
  })

  it('英数字は語 + 部分。記号と camelCase で割る', () => {
    expect(tokenize('willTickThisTick')).toEqual(['willtickthistick', 'will', 'tick', 'this', 'tick'])
    expect(tokenize('moving_piston')).toEqual(['moving_piston', 'moving', 'piston'])
    expect(tokenize('observer-comparator-swallow')).toEqual(
      ['observer-comparator-swallow', 'observer', 'comparator', 'swallow'])
  })

  it('Class#method は丸ごとでも、左右でも、部分でも引ける', () => {
    const t = tokenize('DiodeBlock#checkTickOnNeighbor')
    expect(t[0]).toBe('diodeblock#checktickonneighbor')
    expect(t).toEqual(expect.arrayContaining(['diode', 'block', 'check', 'neighbor', 'diodeblock', 'checktickonneighbor']))
  })

  it('全角の英数字は半角に寄せる。記号だけの文は空', () => {
    expect(tokenize('ｔｉｃｋ １２')).toEqual(['tick', '12'])
    expect(tokenize('§ → ・ 「」')).toEqual([])
  })

  it('和文と英数字が隣り合うと、そこで切れる', () => {
    expect(tokenize('予約tickの上限')).toEqual(['予約', 'tick', 'の上', '上限'])
  })
})

describe('索引と採点', () => {
  const inputs: SearchInput[] = [
    sec('a', 'メモ A', ''),
    sec('a/1', 'リピーターのロック', '横から別のダイオードが入ると固まる。', { parent: 'a', marks: ['read', 'need'] }),
    sec('a/2', '遅延', 'リピーターの遅延は 1〜4 で、ロックとは別の話。リピーターは向きを持つ。', { parent: 'a', fixtures: 2 }),
    sec('b', 'メモ B', ''),
    sec('b/1', 'トーチ', 'RedstoneTorchBlock が焼き切れる。', { parent: 'b', marks: ['ver'] }),
  ]
  const data = buildSearchIndex(inputs)
  const engine = openSearchIndex(data)

  it('見出しの当たりが本文の当たりより上に来る', () => {
    const { hits, total } = engine.search('リピーター ロック')
    expect(hits.map(h => h.id).slice(0, 2)).toEqual(['a/1', 'a/2'])
    expect(total).toBe(2)
    expect(hits[0].score).toBeGreaterThan(hits[1].score)
  })

  it('結果は道筋・印・fixture の数を持つ', () => {
    const [h] = engine.search('ロック').hits
    expect(h).toMatchObject({ id: 'a/1', page: 'a/1', title: 'リピーターのロック', path: ['メモ A', 'リピーターのロック'], marks: ['read', 'need'], fixtures: 0 })
    expect(engine.entry(2)).toMatchObject({ id: 'a/2', fixtures: 2, path: ['メモ A', '遅延'] })
    expect(engine.size).toBe(5)
  })

  it('上位の見出しの語でも当たる (本文より重く、見出しより軽い)', () => {
    // 「メモ B」は b と b/1 に当たる。見出しそのものの b が上
    expect(engine.search('メモ B').hits.map(h => h.id).slice(0, 2)).toEqual(['b', 'b/1'])
  })

  it('クラス名の一部で引ける', () => {
    expect(engine.search('torch').hits.map(h => h.id)).toEqual(['b/1'])
    expect(engine.search('RedstoneTorchBlock').hits[0].id).toBe('b/1')
  })

  it('絞り込みは数える前に外す。当たらない問いは 0 件', () => {
    const r = engine.search('リピーター', { filter: h => h.fixtures > 0 })
    expect(r.hits.map(h => h.id)).toEqual(['a/2'])
    expect(r.total).toBe(1)
    expect(engine.search('リピーター', { limit: 1 }).hits).toHaveLength(1)
    expect(engine.search('リピーター', { limit: 1 }).total).toBe(2)
    expect(engine.search('ピストン').hits).toEqual([])
    expect(engine.search('').hits).toEqual([])
  })

  it('JSON にして戻しても同じ結果。`constructor` のような語で壊れない', () => {
    const again = openSearchIndex(JSON.parse(JSON.stringify(data)))
    for (const q of ['リピーター ロック', 'torch', 'メモ']) {
      expect(again.search(q).hits).toEqual(engine.search(q).hits)
    }
    expect(data.v).toBe(DOCS_DATA_VERSION)
    expect(engine.search('constructor __proto__ toString').hits).toEqual([])
    const odd = openSearchIndex(JSON.parse(JSON.stringify(buildSearchIndex([sec('x', '__proto__ constructor', '')]))))
    expect(odd.search('__proto__').hits.map(h => h.id)).toEqual(['x'])
    expect(odd.search('constructor').hits.map(h => h.id)).toEqual(['x'])
  })

  it('別名と要約を入れると、言い換えで当たる (今のメモでは空)', () => {
    const e = openSearchIndex(buildSearchIndex([
      sec('p', '予約 tick の数', '65,536 件まで。', { aliases: ['上限'] }),
      sec('q', '別の節', '上限という語が本文にある。'),
    ]))
    expect(e.search('上限').hits.map(h => h.id)).toEqual(['p', 'q'])
  })
})

describe('抜粋', () => {
  it('md の飾りを落とす', () => {
    expect(plainText('| 列 | **値** |\n|---|:--|\n| `a` | b |\n\n```text\nx\n```\n#### 見出し')).toBe('列 値 a b x 見出し')
  })

  it('当たった所を中心に切り、当たりの位置を返す', () => {
    const text = 'あ'.repeat(200) + 'リピーターのロックは横から入る。' + 'い'.repeat(200)
    const s = makeSnippet(text, 'リピーター ロック', 60)
    expect(s.text.length).toBe(60)
    expect(s.head && s.tail).toBe(true)
    expect(s.marks.map(([a, b]) => s.text.slice(a, b))).toEqual(['リピーター', 'ロック'])
  })

  it('語が丸ごと無くても 2-gram の当たりへ寄せる。大文字と小文字は区別しない', () => {
    const s = makeSnippet('x'.repeat(300) + ' リピーターがロックされる ' + 'y'.repeat(300), 'リピーターのロック', 40)
    expect(s.text).toContain('リピーター')
    expect(makeSnippet('see DiodeBlock here', 'diodeblock').marks).toEqual([[4, 14]])
  })

  it('当たりが無ければ頭から切る。短い文はそのまま', () => {
    expect(makeSnippet('abcdef', 'zzz', 4)).toEqual({ text: 'abcd', marks: [], head: false, tail: true })
    expect(makeSnippet('abc', 'b', 10)).toEqual({ text: 'abc', marks: [[1, 2]], head: false, tail: false })
  })
})
