import { describe, it, expect } from 'vitest'
import { buildDocsFromRepoCached, readSectionIds, repoRoot } from './build.js'
import { headingNumber } from './ids.js'
import { buildModel, findHeadings, PAGE_SPLIT_LINES, splitDoc } from './split.js'
import type { SourceFile } from './split.js'

const src = (text: string, key = 'v99'): SourceFile => ({
  key, kind: 'vanilla', num: key.slice(1), file: `docs/vanilla/${key.slice(1)}_x.md`, text,
})

/** 行数だけ合わせた本文 */
const body = (n: number) => Array.from({ length: n }, (_, i) => `行 ${i}`).join('\n')

describe('ページの分け方 (#434)', () => {
  it('# と前置き = 1 ページ、## ごとに 1 ページ', () => {
    const { doc, pages } = splitDoc(src('# 99. 題\n\n前置き\n\n## 1. 一\n\n本文\n\n### 1.1 子\n\n本文\n\n## 2. 二\n\n本文\n'))
    expect(pages.map(p => p.id)).toEqual(['v99/0', 'v99/1', 'v99/2'])
    expect(pages.map(p => [p.line, p.endLine])).toEqual([[1, 4], [5, 12], [13, 15]])
    expect(pages[1].sections.map(s => s.id)).toEqual(['v99/1', 'v99/1.1'])
    expect(doc.groups).toEqual([
      { id: 'v99/0', title: '99. 題', pages: ['v99/0'] },
      { id: 'v99/1', title: '1. 一', pages: ['v99/1'] },
      { id: 'v99/2', title: '2. 二', pages: ['v99/2'] },
    ])
    expect(doc.title).toBe('題')
    expect(doc.label).toBe('V99')
  })

  it(`## が ${PAGE_SPLIT_LINES} 行を超えたら ### で割り、前置きは先頭の ### のページに付く`, () => {
    const text = `# 99. 題\n\n## 4. 長い\n\n前置き\n\n### 4.1 一\n\n${body(100)}\n\n#### 4.1.1 孫\n\n本文\n\n### 4.2 二\n\n${body(100)}\n\n## 5. 短い\n\n### 5.1 子\n`
    const { doc, pages, sections } = splitDoc(src(text))
    expect(pages.map(p => p.id)).toEqual(['v99/0', 'v99/4.1', 'v99/4.2', 'v99/5'])
    // 先頭の ### のページは ## の見出しの行から始まり、## の節もこのページに入る
    const first = pages[1]
    expect(first.line).toBe(3)
    expect(first.sections.map(s => s.id)).toEqual(['v99/4', 'v99/4.1', 'v99/4.1.1'])
    expect(first.group).toBe('v99/4')
    expect(sections.find(s => s.id === 'v99/4')!.page).toBe('v99/4.1')
    // #### は割らない (ページ内のアンカー)
    expect(sections.find(s => s.id === 'v99/4.1.1')!.page).toBe('v99/4.1')
    expect(doc.groups[1]).toEqual({ id: 'v99/4', title: '4. 長い', pages: ['v99/4.1', 'v99/4.2'] })
    // 行はどのページにも 1 回ずつ入る
    expect(pages.map(p => p.endLine - p.line + 1).reduce((a, b) => a + b, 0)).toBe(text.split('\n').length - 1)
  })

  it(`### の無い ## は ${PAGE_SPLIT_LINES} 行を超えても割らない`, () => {
    const { pages } = splitDoc(src(`# 99. 題\n\n## 1. 表\n\n${body(200)}\n`))
    expect(pages.map(p => p.id)).toEqual(['v99/0', 'v99/1'])
  })

  it('コードフェンスの中の # は見出しにしない', () => {
    const lines = ['# 題', '```', '# コメント', '## これも', '```', '~~~text', '### 違う', '~~~', '## 1. 本物']
    expect(findHeadings(lines).map(h => h.title)).toEqual(['題', '1. 本物'])
    // フェンスの中の ``` は、~~~ のフェンスを閉じない
    expect(findHeadings(['# 題', '~~~', '```', '## 中', '~~~', '## 外']).map(h => h.title)).toEqual(['題', '外'])
  })

  it('実物: ページ数・行数の分布', () => {
    const { stats } = buildDocsFromRepoCached()
    expect(stats.docs).toBe(24)
    // 方針の表の 594 は、割った ## (30 個) の「見出しと前置きだけの切れ端」を 1 ページに数えた値。
    // 規則 4 (前置きは先頭の ### のページに付ける) を当てると 30 少ない 564 になる (その後、節を足して 567)
    expect(stats.pages).toBe(567)
    expect(stats.sections).toBe(1391)
    expect(stats.lines.overSplit).toBeLessThanOrEqual(7)
    expect(stats.lines.max).toBeLessThanOrEqual(269)
    expect(stats.lines.short).toBe(26)
    expect(stats.lines.median).toBe(30)
  })

  it('実物: 割った ## は 30 個で、どれも前置きごと先頭の ### のページに入る', () => {
    const { model } = buildDocsFromRepoCached()
    const split = model.docs.flatMap(d => d.groups.slice(1).filter(g => g.pages[0] !== g.id))
    expect(split.length).toBe(30)
    for (const g of split) {
      const head = model.sectionById.get(g.id)!
      expect(head.page).toBe(g.pages[0])
      expect(model.pageById.get(g.pages[0])!.line).toBe(head.line)
    }
    // V07 §4 は 17 ページに割れる
    const v07 = model.docs.find(d => d.source.key === 'v07')!
    expect(v07.groups.find(g => g.id === 'v07/4')!.pages.length).toBe(17)
  })

  it('実物: 全部の行がどれか 1 つのページに入る', () => {
    const { model } = buildDocsFromRepoCached()
    for (const d of model.docs) {
      const pages = model.pages.filter(p => p.doc === d.source.key)
      let next = 1
      for (const p of pages) { expect(p.line).toBe(next); next = p.endLine + 1 }
      expect(next - 1).toBe(d.source.text.replace(/\n$/, '').split('\n').length)
    }
  })
})

describe('節の ID (#434)', () => {
  it('見出しの番号を読む', () => {
    expect(headingNumber('4.3 リピーターの点灯条件', false)).toEqual({ kind: 'num', label: '4.3' })
    expect(headingNumber('4. 処理の詳細', false)).toEqual({ kind: 'num', label: '4' })
    expect(headingNumber('付録: 網羅チェックで足したもの', false)).toEqual({ kind: 'app', label: 'app' })
    expect(headingNumber('付録 C. F3: 支えを失うと消える族', false)).toEqual({ kind: 'app', label: 'app-C' })
    expect(headingNumber('C.1 一覧', true)).toEqual({ kind: 'app', label: 'app-C.1' })
    expect(headingNumber('A. レッドストーン鉱石 (RedStoneOreBlock)', true)).toEqual({ kind: 'app', label: 'app-A' })
    // 付録の外では、英字 1 字で始まる見出しを付録と読まない
    expect(headingNumber('C.1 一覧', false)).toEqual({ kind: 'none' })
    expect(headingNumber('P1. set-flag2-observer', false)).toEqual({ kind: 'none' })
    expect(headingNumber('P-1 ダストの POWER 直読', true)).toEqual({ kind: 'none' })
    expect(headingNumber('R1 ダストの配布順', false)).toEqual({ kind: 'none' })
    expect(headingNumber('側面の値', false)).toEqual({ kind: 'none' })
  })

  it('番号なしの見出しは 親の ID + ファイル内の連番', () => {
    const { sections } = splitDoc(src('# 99. 題\n\n## 4. 四\n\n### 4.5 五\n\n#### 側面\n\n#### 出力\n\n## 8. 八\n\n### P1 案\n\n## 出典\n'))
    expect(sections.map(s => s.id)).toEqual(['v99/0', 'v99/4', 'v99/4.5', 'v99/4.5/n1', 'v99/4.5/n2', 'v99/8', 'v99/8/n3', 'v99/n4'])
    expect(sections.map(s => s.numbered)).toEqual([true, true, true, false, false, true, false, false])
  })

  it('付録は 3 通りの見出しを 1 つの系列に寄せる', () => {
    const { sections } = splitDoc(src('# 99 題\n\n## 付録: 足したもの\n\n### 付録 A. 流れ\n\n#### A.1 一\n\n### F.0 決まり\n\n### B. 鉱石\n'))
    expect(sections.map(s => s.id)).toEqual(['v99/0', 'v99/app', 'v99/app-A', 'v99/app-A.1', 'v99/app-F.0', 'v99/app-B'])
  })

  it('メモに §0 があるときは、前置きを top に逃がす', () => {
    const { sections, pages } = splitDoc(src('# 99. 題\n\n前置き\n\n## 0. 結論\n\n本文\n'))
    expect(sections.map(s => s.id)).toEqual(['v99/top', 'v99/0'])
    expect(pages.map(p => p.id)).toEqual(['v99/top', 'v99/0'])
  })

  it('同じ番号が 2 回出たら、後の方を番号なしにする (ID は重ならない)', () => {
    const { sections } = splitDoc(src('# 99. 題\n\n## 1. 一\n\n### 1.1 子\n\n### 1.1 子 (重複)\n'))
    expect(sections.map(s => s.id)).toEqual(['v99/0', 'v99/1', 'v99/1.1', 'v99/1/n1'])
  })

  it('見出しの中の印は題から外す', () => {
    const { sections } = splitDoc(src('# 99. 題\n\n## 2.1 全体 [確定: get_catalog_overview、2026-11-26]\n\n### P-11 撤去時の前方更新 [版差 1.21.1]\n'))
    expect(sections.map(s => s.title)).toEqual(['99. 題', '2.1 全体', 'P-11 撤去時の前方更新'])
    expect(sections[1].rawTitle).toContain('[確定:')
  })

  it('実物: ID は重ならず、形が決まっている', () => {
    const { model } = buildDocsFromRepoCached()
    const ids = model.sections.map(s => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id).toMatch(/^(v\d\d|r\d\d|v-readme)\/(top|\d+(\.\d+)*|app(-[A-Z](\.\d+)*)?)(\/n\d+)*$|^(v\d\d|r\d\d|v-readme)(\/n\d+)+$/)
    for (const want of ['v07/4.3', 'r19/3.9', 'v05/app-C.1', 'v07/0', 'r17/top', 'r17/0', 'v-readme/1', 'v05/app', 'v09/app-A', 'v11/app-F.0']) {
      expect(ids, want).toContain(want)
    }
    // 番号なしは 119 個。うちページになるのは 00 の §5・§6 の 21 枚と research/18 の「出典」
    expect(model.sections.filter(s => !s.numbered).length).toBe(119)
    expect(model.pages.filter(p => /\/n\d+$/.test(p.id)).length).toBe(22)
  })

  it('実物: section-ids.txt と一致する (前にあった ID が消えていない)', () => {
    const { model } = buildDocsFromRepoCached()
    const now = model.sections.map(s => s.id)
    const tracked = readSectionIds(repoRoot)
    const gone = tracked.filter(id => !model.sectionById.has(id))
    expect(gone, [
      '前にあった節の ID が消えた。既読と理解度の記録・図の配置・外から張った URL がこの ID を使う。',
      '見出しの番号を変えたのなら、付け替えを決めてから npm run docs:index -- --ids で一覧を作り直す',
    ].join('\n')).toEqual([])
    expect(now, '節が増えた。npm run docs:index -- --ids で一覧を作り直す').toEqual(tracked)
  })

  it('模型は ID の重複で落ちる', () => {
    expect(() => buildModel([src('# 99. 題\n'), src('# 99. 題\n')])).toThrow(/重なった/)
  })
})
