import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DIAGRAMS, LEVEL_PHASES, diagramHtml } from '@redstone/docs-kit/diagrams'
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

/**
 * 図の数と md の突き合わせ。md の手順や表の行が増減したら、図も直すこと。
 * 文言の中身までは比べない (人が見る)。
 */
describe('図の数が md と合う', () => {
  /** md の 1 節 (`### 2.1 …` から次の見出しまで) の行 */
  const sectionLines = (file: string, num: string): string[] => {
    const lines = readFileSync(join(repo, 'docs/vanilla', file), 'utf-8').split('\n')
    const start = lines.findIndex(l => l.startsWith(`### ${num} `))
    expect(start, `${file} §${num}`).toBeGreaterThanOrEqual(0)
    const rest = lines.slice(start + 1)
    const end = rest.findIndex(l => /^#{1,3} /.test(l))
    return end < 0 ? rest : rest.slice(0, end)
  }
  /** 一番外の番号つきの手順の数 */
  const steps = (file: string, num: string) => sectionLines(file, num).filter(l => /^\d+\. /.test(l)).length
  const flowSteps = (name: keyof typeof DIAGRAMS) => {
    const p = DIAGRAMS[name].panels[0]
    return p.kind === 'flow' ? p.data.steps.length : -1
  }

  it('手順の流れ 3 枚: 一番外の手順の数', () => {
    expect(flowSteps('schedule-to-fire')).toBe(steps('02_scheduled-ticks.md', '2.2'))
    expect(flowSteps('set-block-steps')).toBe(steps('04_set-block-and-updates.md', '2.1'))
    expect(flowSteps('repeater-flip')).toBe(steps('07_diodes.md', '2.4'))
  })

  it('tick の間の時系列: 手順の数', () => {
    const p = DIAGRAMS['tick-boundary'].panels[0]
    const n = p.kind === 'ticks' ? p.data.items.filter(i => i.k === 'ev').length : -1
    expect(n).toBe(steps('01_tick-loop.md', '2.4'))
  })

  it('相の時間割: 表の行 (L0〜) の数と ID', () => {
    const rows = sectionLines('01_tick-loop.md', '2.3').map(l => /^\| (L\d+) \|/.exec(l)?.[1]).filter(Boolean)
    expect(LEVEL_PHASES.map(p => p.id)).toEqual(rows)
  })
})
