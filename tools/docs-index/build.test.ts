import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { DOCS_DATA_VERSION, docsHref, findPage, parseDocsHash } from '../../packages/docs-kit/src/index.js'
import type { PageData } from '../../packages/docs-kit/src/index.js'
import { ABSOLUTE, VERBATIM } from '../ip-hygiene-patterns.js'
import { buildDocsFromRepo, buildDocsFromRepoCached, DATA_DIR, repoRoot, SECTION_IDS_FILE, sectionIdsText } from './build.js'

describe('生成物 (#434)', () => {
  it('目次とページの数が合う', () => {
    const { manifest, pages, files, records } = buildDocsFromRepoCached()
    expect(manifest.v).toBe(DOCS_DATA_VERSION)
    expect(manifest.counts.pages).toBe(manifest.pages.length)
    expect(pages.size).toBe(manifest.pages.length)
    expect(files.size).toBe(manifest.pages.length + 1)
    expect(records.length).toBe(manifest.counts.sections)
    // 目次の 3 段 (メモ → ## → ページ) をたどると、読む順のページの並びになる
    expect(manifest.docs.flatMap(d => d.groups.flatMap(g => g.pages))).toEqual(manifest.pages.map(p => p.id))
    expect(manifest.docs.map(d => d.label)).toEqual([
      'README', ...Array.from({ length: 20 }, (_, i) => `V${String(i).padStart(2, '0')}`), 'R17', 'R18', 'R19',
    ])
  })

  it('ページの前後は読む順の隣', () => {
    const { manifest, pages } = buildDocsFromRepoCached()
    manifest.pages.forEach((p, i) => {
      const data = pages.get(p.id)!
      expect(data.prev).toBe(i > 0 ? manifest.pages[i - 1].id : null)
      expect(data.next).toBe(i + 1 < manifest.pages.length ? manifest.pages[i + 1].id : null)
      expect(data.group).toBe(p.group)
      expect(data.sections[data.sections.length - 1].line).toBeLessThanOrEqual(data.endLine)
    })
  })

  it('ID から URL とページを引ける', () => {
    const { manifest } = buildDocsFromRepoCached()
    expect(docsHref('v07/4.3')).toBe('#/v07/4.3')
    expect(docsHref('v07/4.3', 'v07/4.3.2')).toBe('#/v07/4.3?s=4.3.2')
    expect(parseDocsHash('#/v07/4.3?s=4.3.2')).toEqual({ id: 'v07/4.3', s: '4.3.2' })
    expect(parseDocsHash('#/v07/4.3')).toEqual({ id: 'v07/4.3', s: null })
    expect(parseDocsHash('#top')).toBeNull()
    // ページの ID・割った ## の ID・メモの ID・ページの中の節
    expect(findPage(manifest, 'v07/4.3')).toEqual({ page: 'v07/4.3', section: null })
    expect(findPage(manifest, 'v07/4')).toEqual({ page: 'v07/4.1', section: 'v07/4' })
    expect(findPage(manifest, 'v07')).toEqual({ page: 'v07/0', section: null })
    expect(findPage(manifest, 'r19')).toEqual({ page: 'r19/top', section: null })
    expect(findPage(manifest, 'v07/5.6')).toEqual({ page: 'v07/5', section: 'v07/5.6' })
    expect(findPage(manifest, 'v05/app-C.1')).toEqual({ page: 'v05/app-C', section: 'v05/app-C.1' })
    expect(findPage(manifest, 'v99/1')).toBeNull()
  })

  it('全部の節が、ID の決まりだけでページへたどり着く', () => {
    const { manifest, model } = buildDocsFromRepoCached()
    for (const s of model.sections) {
      const hit = findPage(manifest, s.id)
      expect(hit && hit.page, s.id).toBe(s.page)
    }
  })

  it('節の記録は md の本文をそのまま持つ', () => {
    const { records, model } = buildDocsFromRepoCached()
    const r = records.find(x => x.id === 'v07/4.3')!
    expect(r.page).toBe('v07/4.3')
    expect(r.file).toBe('docs/vanilla/07_diodes.md')
    expect(r.title).toBe('4.3 リピーターの点灯条件とロック')
    expect(r.path).toEqual(['07. リピーター・コンパレーター (ダイオード)', '4. 処理の詳細', '4.3 リピーターの点灯条件とロック'])
    expect(r.marks).toContain('read')
    expect(r.refs).toContain('v07/4.2')
    expect(r.text).toContain('shouldTurnOn')
    const src = model.docs.find(d => d.source.key === 'v07')!.source.text.split('\n')
    expect(src[r.line - 1]).toBe('### 4.3 リピーターの点灯条件とロック')
    // 欄だけ用意して空のままにする物
    expect([r.classes, r.blocks, r.summary, r.aliases]).toEqual([[], [], '', []])
    // fixture を引く節
    expect(records.find(x => x.id === 'v03/2.3')!.fixtures).toContain('piston-basic')
  })

  it('大きさ: 目次は小さく、ページは 1 本ずつ軽い', () => {
    const { stats } = buildDocsFromRepoCached()
    expect(stats.bytes.manifest).toBeLessThan(200 * 1024)
    expect(stats.bytes.pageMedian).toBeLessThan(10 * 1024)
    expect(stats.bytes.pageMax).toBeLessThan(150 * 1024)
  })

  it('同じ入力から同じ物が出る (時刻や順の揺れを入れない)', () => {
    const a = buildDocsFromRepoCached()
    const b = buildDocsFromRepo(repoRoot)
    expect([...b.files.keys()]).toEqual([...a.files.keys()])
    for (const [k, v] of a.files) expect(b.files.get(k) === v, k).toBe(true)
    expect(sectionIdsText(b)).toBe(sectionIdsText(a))
  })
})

describe('生成物の衛生 (docs/ip-policy.md・#434)', () => {
  it('デコンパイルした Java の逐語引用のパターンが 0 件', () => {
    const { files, pages } = buildDocsFromRepoCached()
    const hits: string[] = []
    const scan = (where: string, text: string) => {
      for (const line of text.split('\n')) {
        for (const p of VERBATIM) if (p.re.test(line)) hits.push(`${where} [${p.name}] ${line.trim().slice(0, 100)}`)
      }
    }
    // 出すファイルそのもの (JSON) と、タグを外した本文の両方を見る
    for (const [rel, text] of files) scan(rel, text)
    for (const p of pages.values()) scan(`${p.id} (本文)`, textOf(p))
    expect(hits, hits.join('\n')).toEqual([])
    // java のコードフェンスは、HTML では language-java になる
    expect([...pages.values()].filter(p => /language-java/.test(p.html)).map(p => p.id)).toEqual([])
  })

  it('絶対パスが入っていない (file はリポ相対)', () => {
    const { files, pages, records } = buildDocsFromRepoCached()
    const hits: string[] = []
    for (const [rel, text] of files) for (const p of ABSOLUTE) if (p.re.test(text)) hits.push(`${rel} [${p.name}]`)
    expect(hits).toEqual([])
    for (const p of pages.values()) expect(p.file).toMatch(/^docs\/(vanilla|research)\/[\w.-]+\.md$/)
    for (const r of records) expect(r.file).toMatch(/^docs\/(vanilla|research)\/[\w.-]+\.md$/)
  })

  it('生成物の置き場は追跡していない。追跡するのは節の ID の一覧だけ', () => {
    const tracked = (path: string) =>
      execFileSync('git', ['ls-files', path], { cwd: repoRoot, encoding: 'utf-8' }).split('\n').filter(Boolean)
    expect(tracked(DATA_DIR)).toEqual([])
    const ignored = execFileSync('git', ['check-ignore', `${DATA_DIR}/manifest.json`], { cwd: repoRoot, encoding: 'utf-8' }).trim()
    expect(ignored).toBe(`${DATA_DIR}/manifest.json`)
    expect(existsSync(join(repoRoot, SECTION_IDS_FILE))).toBe(true)
  })
})

/** ページの本文からタグを外す (文字参照は戻す) */
function textOf(p: PageData): string {
  return p.html.replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
}
