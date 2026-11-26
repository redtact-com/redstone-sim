import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DIAGRAMS, diagramHtml } from '@redstone/docs-kit/diagrams'
import { PLACEMENTS, hasDiagrams, insertDiagrams } from '../src/diagrams/placements'

/**
 * 図の置き場所 (#434)。節の番号が動くと ID が変わるので、置き場所が宙に浮かないことをここで見る。
 * 節 ID の一覧は生成器が見張っている `tools/docs-index/section-ids.txt` (追跡している) を使う。
 */
const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const sectionIds = new Set(readFileSync(join(repo, 'tools/docs-index/section-ids.txt'), 'utf-8').split('\n').filter(Boolean))

describe('図の置き場所 (placements)', () => {
  it('節 ID が全部実在する', () => {
    const missing = Object.keys(PLACEMENTS).filter(id => !sectionIds.has(id))
    expect(missing, `無い節 ID: ${missing.join(', ')}`).toEqual([])
  })

  it('図の名前が全部一覧にあり、一覧の図は全部どこかに置いてある', () => {
    const used = new Set(Object.values(PLACEMENTS).flat())
    for (const name of used) expect(DIAGRAMS[name], name).toBeDefined()
    expect([...used].sort()).toEqual(Object.keys(DIAGRAMS).sort())
  })

  it('最初の 8 枚が 9 か所に置いてある (方向の並びは V04 §2.3 と V06 §3.6 の両方)', () => {
    expect(Object.keys(DIAGRAMS)).toHaveLength(8)
    expect(Object.keys(PLACEMENTS)).toHaveLength(9)
    expect(PLACEMENTS['v04/2.3']).toEqual(['direction-orders'])
    expect(PLACEMENTS['v06/3.6']).toEqual(['direction-orders'])
  })

  it('見出しの直後に差し込む。図の無い節には何もしない', () => {
    const html = '<h2 id="sec-2" data-sec="v04/2">2. 全体像</h2><p>a</p>'
      + '<h3 id="sec-2.3" data-sec="v04/2.3">2.3 方向の<code>並び</code></h3><div class="tbl"></div>'
      + '<h3 id="sec-2.30" data-sec="v04/2.30">別の節</h3>'
    const sections = [{ id: 'v04/2' }, { id: 'v04/2.3' }, { id: 'v04/2.30' }]
    expect(hasDiagrams(sections)).toBe(true)
    expect(hasDiagrams([{ id: 'v04/2' }])).toBe(false)
    const out = insertDiagrams(html, sections, name => `<figure data-dg="${name}"></figure>`)
    expect(out).toBe(html.replace('</h3><div class="tbl">', '</h3><figure data-dg="direction-orders"></figure><div class="tbl">'))
    expect(insertDiagrams(html, [{ id: 'v04/2' }], diagramHtml)).toBe(html)
  })
})
