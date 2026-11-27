import { describe, it, expect } from 'vitest'
import { buildDocs, buildDocsFromRepoCached } from './build.js'
import type { FixtureMeta } from './fixtures.js'
import { LONG_TABLE_ROWS } from './render.js'
import type { SourceFile } from './split.js'

const FIXTURES = new Map<string, FixtureMeta>([
  ['piston-basic', { blocks: 12, ticks: 16, embed: true }],
  ['torch-clock', { blocks: 11, ticks: 22, embed: true }],
])

/** 小さな md 1 本を描いて、先頭の `##` のページの HTML を返す */
function render(body: string, key = 'v07'): string {
  const src: SourceFile = { key, kind: 'vanilla', num: key.slice(1), file: `docs/vanilla/${key.slice(1)}_x.md`, text: `# ${key.slice(1)}. 題\n\n## 1. 節\n\n${body}\n` }
  return buildDocs([src], FIXTURES).pages.get(`${key}/1`)!.html
}

describe('ページの HTML (#434)', () => {
  it('見出しに ID を付ける', () => {
    const html = render('### 1.1 子 [要実機]\n\n本文\n\n#### 側面の値\n')
    expect(html).toContain('<h2 id="sec-1" data-sec="v07/1">1. 節</h2>')
    expect(html).toContain('<h3 id="sec-1.1" data-sec="v07/1.1">1.1 子 <span class="mk mk-need">要実機</span></h3>')
    expect(html).toContain('<h4 id="sec-1.1/n1" data-sec="v07/1.1/n1">側面の値</h4>')
  })

  it('生の HTML は切り、http(s) の URL だけをリンクにする', () => {
    const html = render('<script>alert(1)</script> と <b>太字</b>。https://example.com/a と 19_version-diffs.md と foo.md')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('&lt;b&gt;')
    expect(html).toContain('<a href="https://example.com/a" target="_blank" rel="noopener noreferrer">https://example.com/a</a>')
    // `.md` を国別ドメインの URL と読まない
    expect(html).not.toMatch(/href="http:\/\/[^"]*\.md"/)
    expect(html.match(/<a /g)!.length).toBe(1)
  })

  it('javascript: のリンクは作らない', () => {
    expect(render('[押す](javascript:alert(1))')).not.toContain('<a ')
  })

  it('和文の間の改行は空白にしない (英数字の間は残す)', () => {
    expect(render('これは長い文で、\n途中で折り返す。')).toContain('<p>これは長い文で、途中で折り返す。</p>')
    expect(render('**太字**で終わる行\nの次の行')).toContain('<strong>太字</strong>で終わる行の次の行')
    expect(render('one\ntwo')).toContain('<p>one\ntwo</p>')
    expect(render('値は 15\nである')).toContain('値は 15\nである')
  })

  it('1 つの * と _ の斜体は切り、太字は残す', () => {
    const html = render('rail-* と *-rail の 2 つ。a_b と c_d、_x_ も。**太字** は残る')
    expect(html).not.toContain('<em>')
    expect(html).toContain('rail-* と *-rail の 2 つ')
    expect(html).toContain('_x_ も')
    expect(html).toContain('<strong>太字</strong>')
  })

  it('--- は捨てる', () => {
    expect(render('上\n\n---\n\n下')).not.toContain('<hr')
  })

  it('表は 1 個ずつ枠で包み、長い表に印を付ける', () => {
    const table = (rows: number) => ['| a | b |', '|---|---|', ...Array.from({ length: rows }, (_, i) => `| ${i} | x |`)].join('\n')
    const short = render(table(3))
    expect(short).toContain('<div class="tbl"><table>')
    expect(short).toContain('</table></div>')
    // 見出しの行を含めて LONG_TABLE_ROWS 行を超えたら長い表
    expect(render(table(LONG_TABLE_ROWS - 1))).toContain('<div class="tbl"><table>')
    expect(render(table(LONG_TABLE_ROWS))).toContain('<div class="tbl tbl-long"><table>')
  })

  it('コードフェンスはそのまま出し、中の印や参照は触らない', () => {
    const html = render('```text\n# 見出しではない [要実機] §4.2\n  ┌──┐\n```')
    expect(html).toContain('<pre><code class="language-text"># 見出しではない [要実機] §4.2\n  ┌──┐\n</code></pre>')
    expect(html).not.toContain('<h1')
    expect(render('`[要実機]` と `§4.2`')).toContain('<code>[要実機]</code> と <code>§4.2</code>')
  })

  it('印はバッジに、添字はそのまま', () => {
    const html = render('値 a[t] と b[4]。[26.3 読解: DiodeBlock#tick] [版差 1.21.1: 出る] [実機 1.21.1: piston-basic・torch-clock] [実機 1.21.1: 名前]')
    expect(html).toContain('値 a[t] と b[4]。')
    expect(html).toContain('<span class="mk mk-read">26.3 読解: DiodeBlock#tick</span>')
    expect(html).toContain('<span class="mk mk-ver">版差 1.21.1: 出る</span>')
    expect(html).toContain('<span class="mk mk-fx" data-fx="piston-basic torch-clock">実機 1.21.1: piston-basic・torch-clock</span>')
    expect(html).toContain('<span class="mk mk-fx">実機 1.21.1: 名前</span>')
  })

  it('印の中の URL と参照も描く', () => {
    const html = render('[確定: https://example.com/x] と [要実機: §1 の P1]')
    expect(html).toContain('<span class="mk mk-sure">確定: <a href="https://example.com/x" target="_blank" rel="noopener noreferrer">https://example.com/x</a></span>')
    expect(html).toContain('<span class="mk mk-need">要実機: <a class="ref" href="#/v07/1" data-ref="v07/1">§1</a> の P1</span>')
  })

  it('閉じの無い角括弧は印にしない', () => {
    expect(render('[要実機 と書きかけ')).toContain('<p>[要実機 と書きかけ</p>')
  })

  it('節の参照をリンクにし、無い資料と解けない物を分ける', () => {
    const html = render('### 1.1 子\n\n(§1.1) と docs/research/16 §2.4 がある。§9.9 は無い')
    expect(html).toContain('(<a class="ref" href="#/v07/1?s=1.1" data-ref="v07/1.1">§1.1</a>)')
    expect(html).toContain('<span class="ref-out" title="この Web に無い資料">docs/research/16 §2.4</span>')
    expect(html).toContain('<span class="ref-miss" title="行き先の節が見つからない">§9.9</span>')
  })

  it('md のリンク: メモはページへ、無いファイルはリンクを外す', () => {
    const a: SourceFile = { key: 'v-readme', kind: 'vanilla', num: null, file: 'docs/vanilla/README.md', text: '# 目次\n\n## 1. 一覧\n\n[07_x.md](07_x.md) と [方針](../ip-policy.md)\n' }
    const b: SourceFile = { key: 'v07', kind: 'vanilla', num: '07', file: 'docs/vanilla/07_x.md', text: '# 07. 題\n' }
    const html = buildDocs([a, b], FIXTURES).pages.get('v-readme/1')!.html
    expect(html).toContain('<a href="#/v07/0" class="ref" data-ref="v07/0">07_x.md</a>')
    expect(html).toContain('<span class="ref-out" title="この Web に無い資料">方針</span>')
  })

  it('§9 の表の 1 列目の裸の § は見出しの資料、2 列目から後ろは同じメモ', () => {
    const body = '本文\n\n## 9. 既存資料との食い違い\n\n### 9.1 docs/research/02_behavior-spec.md §6\n\n| 既存 | 26.3 |\n|---|---|\n| §1 の記述 | 本メモ §1 と同じ |\n'
    const src: SourceFile = { key: 'v07', kind: 'vanilla', num: '07', file: 'docs/vanilla/07_x.md', text: `# 07. 題\n\n## 1. 節\n\n${body}` }
    const html = buildDocs([src], FIXTURES).pages.get('v07/9')!.html
    expect(html).toContain('<td><span class="ref-out" title="この Web に無い資料">§1</span> の記述</td>')
    expect(html).toContain('<td>本メモ <a class="ref" href="#/v07/1" data-ref="v07/1">§1</a> と同じ</td>')
  })

  it('実物: 入れている版の markdown-it で太字 1,300 個・表 725 個が効き、斜体は 0', () => {
    const { stats, pages } = buildDocsFromRepoCached()
    const all = [...pages.values()].map(p => p.html).join('\n')
    expect(stats.strong).toBe(1300)
    expect(all.match(/<strong>/g)!.length).toBe(1300)
    expect(stats.tables).toBe(725)
    expect(all.match(/<div class="tbl[^"]*"><table>/g)!.length).toBe(725)
    expect(all).not.toContain('<em>')
    expect(all).not.toContain('<hr')
    expect(stats.hrDropped).toBe(236)
    // 太字にならずに残った ** が無い (コードの中は除く)
    const outsideCode = all.replace(/<pre>[\s\S]*?<\/pre>/g, '').replace(/<code>[\s\S]*?<\/code>/g, '')
    expect(outsideCode).not.toContain('**')
    // 表にならずに残った行が無い
    expect(outsideCode).not.toMatch(/<p>\|/)
  })

  it('実物: 切った斜体は 9 か所で、どれも意図した斜体ではない', () => {
    // メモは斜体を使わない。`*` と `_` は掛け算・`rail-*`・識別子に出てくる。
    // 数が変わったら、足した文に意図した斜体が無いかを見てからここを直す
    expect(buildDocsFromRepoCached().stats.emDropped).toBe(9)
  })

  it(`実物: ${LONG_TABLE_ROWS} 行を超える表は少数`, () => {
    const { stats } = buildDocsFromRepoCached()
    expect(stats.longTables).toBeGreaterThanOrEqual(2)
    expect(stats.longTables).toBeLessThanOrEqual(5)
  })

  it('実物: 見出しの ID はページの節の一覧と一致する', () => {
    const { pages } = buildDocsFromRepoCached()
    for (const p of pages.values()) {
      const inHtml = [...p.html.matchAll(/<h[1-6] id="sec-([^"]*)" data-sec="([^"]+)"/g)].map(m => [m[1], m[2]])
      expect(inHtml, p.id).toEqual(p.sections.map(s => [s.anchor, s.id]))
    }
  })
})
