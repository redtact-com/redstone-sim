import { describe, it, expect } from 'vitest'
import { brotliCompressSync } from 'node:zlib'
import { openSearchIndex } from '../../packages/docs-kit/src/index.js'
import type { SearchIndexData } from '../../packages/docs-kit/src/index.js'
import { buildDocsFromRepoCached, SEARCH_INDEX_FILE } from './build.js'

/**
 * 検索の当たり方 (#434)。問いと、出てほしい節の ID。
 *
 * 出てほしい節は、その節そのものか、その下の節 (`v07/4.3` には `v07/4.3.1` も当たり)。
 * 外れる 4 問は言い換えが原因 (本文に無い語で聞いている)。節の要約と別名
 * (`summary`・`aliases`) を埋めるまで外れたままにし、ここでは今より悪くならないことを見張る。
 */
export const QUESTIONS: readonly (readonly [query: string, want: readonly string[]])[] = [
  ['リピーターのロック', ['v07/4.3', 'v07/5.1', 'v07/5.2']],
  ['ダストの更新の順', ['v06/4.12', 'v06/4.11', 'v06/4.13']],
  ['予約 tick の上限', ['v02/4.3']],
  ['トーチの焼き切れ', ['v08/4.1', 'v08/5.1', 'v08/5.2', 'v08/5.3']],
  ['オブザーバーのパルス', ['v08/4.2', 'v08/2', 'v07/5.8']],
  ['ピストンが押せるブロック', ['v13/4.6', 'v05/4.6']],
  ['ホッパーの待ち時間', ['v14/4.2', 'v14/5.1']],
  ['コンパレーターの減算モード', ['v07/4.5', 'v07/2.3']],
  ['準接続', ['v05/4.5']],
  ['ブロックイベントの実行順', ['v03/4.2']],
  ['近隣更新の連鎖上限', ['v18/4.9', 'v04/5.10']],
  ['検知レールが信号を出す条件', ['v15/4.10', 'v17/4.7']],
  ['スカルクセンサーの届く範囲', ['v10/4.3']],
  ['銅の電球の切り替え', ['v11/4.8']],
  ['クラフターが作るタイミング', ['v12/4.14', 'v12/4.15', 'v12/4.13']],
  ['水の横の広がり', ['v16/4.6', 'v16/4.5']],
  ['ハッシュマップの反復順', ['v18/4.2', 'v18/4.3']],
  ['コンテナの信号の強さの式', ['v14/4.1']],
  ['フラグ 2 の書き込みがオブザーバーに見える', ['v04/5.2']],
  ['ドアは隣のドアの更新を無視する', ['v11/5.4', 'v11/4.3']],
  // 識別子 (クラス名#メソッド名・メソッド名・ブロック ID・fixture の名前)
  ['DiodeBlock#checkTickOnNeighbor', ['v07/4.7', 'v07/4.8']],
  ['willTickThisTick', ['v02/4.5', 'v07/4.9', 'v07/5.11']],
  ['moving_piston', ['v13/4.13', 'v13/4.9', 'v13/4.8']],
  ['observer-comparator-swallow', ['v07/5.8']],
]

/** 識別子の問いの数 (QUESTIONS の後ろ) */
const IDENTIFIERS = 4

const under = (id: string, want: readonly string[]) =>
  want.some(w => id === w || id.startsWith(`${w}/`) || id.startsWith(`${w}.`))

describe('検索の当たり方 (24 問・#434)', () => {
  const build = buildDocsFromRepoCached()
  const engine = openSearchIndex(JSON.parse(build.files.get(SEARCH_INDEX_FILE)!) as SearchIndexData)
  /** 出てほしい節が最初に出る順位 (上位 10 件に無ければ 0) */
  const ranks = QUESTIONS.map(([q, want]) => engine.search(q, { limit: 10 }).hits.findIndex(h => under(h.id, want)) + 1)

  it('出てほしい節の ID は全部実在する', () => {
    const ids = new Set(build.records.map(r => r.id))
    expect(QUESTIONS.flatMap(([, want]) => want).filter(id => !ids.has(id))).toEqual([])
    expect(QUESTIONS).toHaveLength(24)
  })

  it('上位 3 件に 20 問以上・上位 10 件に 22 問以上・1 位は 14 問以上', () => {
    const top = (n: number) => ranks.filter(r => r > 0 && r <= n).length
    const missed = QUESTIONS.map(([q], i) => ({ q, rank: ranks[i] })).filter(x => !(x.rank > 0 && x.rank <= 3)).map(x => `${x.q} (${x.rank || '-'})`)
    expect(top(3), `外れ: ${missed.join(' / ')}`).toBeGreaterThanOrEqual(20)
    expect(top(10)).toBeGreaterThanOrEqual(22)
    expect(top(1)).toBeGreaterThanOrEqual(14)
  })

  it('識別子の 4 問は 1 位', () => {
    expect(ranks.slice(-IDENTIFIERS)).toEqual([1, 1, 1, 1])
  })

  it('e2e と GIF で使う問い「リピーター ロック」は V07 の節が 1 位', () => {
    const [first] = engine.search('リピーター ロック').hits
    expect(first.id).toBe('v07/4.3')
    expect(first.page).toBe('v07/4.3')
    expect(first.path).toEqual(['07. リピーター・コンパレーター (ダイオード)', '4. 処理の詳細', '4.3 リピーターの点灯条件とロック'])
  })

  it('索引は全部の節を持ち、節の記録と同じ並び', () => {
    expect(build.search.ids).toEqual(build.records.map(r => r.id))
    expect(build.search.pages).toEqual(build.records.map(r => r.page))
    expect(engine.size).toBe(1383)
    // 結果のページは実在する (ページ + 節へ飛べる)
    const pages = new Set(build.manifest.pages.map(p => p.id))
    expect(build.search.pages.filter(p => !pages.has(p))).toEqual([])
    // 印と fixture の絞り込みが、節の記録と同じ数になる
    const all = Array.from({ length: engine.size }, (_, i) => engine.entry(i))
    expect(all.filter(e => e.marks.includes('need')).length).toBe(build.records.filter(r => r.marks.includes('need')).length)
    expect(all.filter(e => e.fixtures > 0).length).toBe(build.records.filter(r => r.fixtures.length > 0).length)
  })

  it('絞り込み: メモ・要実機・版差・fixture あり', () => {
    const q = 'リピーター'
    const inDoc = engine.search(q, { filter: h => h.id.startsWith('v13/') })
    expect(inDoc.hits.length).toBeGreaterThan(0)
    expect(inDoc.hits.every(h => h.id.startsWith('v13/'))).toBe(true)
    for (const kind of ['need', 'ver'] as const) {
      const r = engine.search(q, { filter: h => h.marks.includes(kind) })
      expect(r.hits.length).toBeGreaterThan(0)
      expect(r.hits.every(h => h.marks.includes(kind))).toBe(true)
      expect(r.total).toBeLessThan(engine.search(q).total)
    }
    const fx = engine.search(q, { filter: h => h.fixtures > 0 })
    expect(fx.hits.length).toBeGreaterThan(0)
    expect(fx.hits.every(h => h.fixtures > 0)).toBe(true)
  })

  // brotli は Node の既定 (品質 11) の値。配信の側の圧縮はこれより弱いことがあり、届く量は gzip に近くなりうる。
  // docs/vanilla の md が増えてここが落ちた時は、(1) 索引を削る (字句の部分を減らす・本文の重みつきの回数を丸める)
  // (2) 上限を見直して PR に書く、のどちらかを選ぶ。黙って上限だけを上げない
  it('大きさ: brotli で 500 kB 以下', () => {
    const json = build.files.get(SEARCH_INDEX_FILE)!
    expect(brotliCompressSync(json).length).toBeLessThanOrEqual(500 * 1024)
    expect(Buffer.byteLength(json)).toBe(build.stats.bytes.search)
  })
})
