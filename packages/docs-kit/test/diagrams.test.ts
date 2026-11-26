import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  DIAGRAMS, DIAGRAM_CSS, DIAGRAM_WIDTH, DIR_NAMES, LEVEL_PHASES,
  Diagram, DirectionOrder, PhaseTimeline, StepFlow, TickAxis,
  diagramHtml, directionOrderSvg, figureHtml, phaseTimelineSvg, stepFlowSvg, tickAxisSvg,
} from '@redstone/docs-kit/diagrams'
import type { DiagramName } from '@redstone/docs-kit/diagrams'
import { textWidth, wrap } from '../src/diagrams/svg'

/** 図の部品 (#434)。文言と md の突き合わせは人が見る。ここは形と数を見る */
const names = Object.keys(DIAGRAMS) as DiagramName[]
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length

describe('図の小道具', () => {
  it('字の幅は全角 1em・半角 0.6em で見積もる', () => {
    expect(textWidth('あい', 10)).toBe(20)
    expect(textWidth('ab', 10)).toBe(12)
  })

  it('幅で折り返す。半角の語は切らず、行の頭に句読点を置かない', () => {
    expect(wrap('あいうえお', 30, 10)).toEqual(['あいう', 'えお'])
    expect(wrap('あい ticktick', 60, 10)).toEqual(['あい', 'ticktick'])
    expect(wrap('あいう。え', 30, 10)).toEqual(['あいう。', 'え'])
    expect(wrap('abcdefghij', 30, 10)).toEqual(['abcde', 'fghij'])
    expect(wrap('', 30, 10)).toEqual([''])
  })
})

describe('図の部品 4 つ', () => {
  it('PhaseTimeline: ますの数だけ箱が出て、色つきのますと今の相が分かる', () => {
    const svg = phaseTimelineSvg({ cells: LEVEL_PHASES, legend: '凡例' })
    expect(LEVEL_PHASES.map(c => c.id)).toEqual(Array.from({ length: 16 }, (_, i) => `L${i}`))
    expect(count(svg, /<rect /g)).toBe(16 + 1)            // ます 16 + 凡例の見本
    expect(count(svg, /class="dg-hi"/g)).toBe(7 + 1)      // L5・L6・L7・L9・L10・L12・L13 + 凡例
    expect(svg).toContain(`viewBox="0 0 ${DIAGRAM_WIDTH} `)
    const mini = phaseTimelineSvg({ cells: LEVEL_PHASES, mini: true, current: 'L6' })
    expect(count(mini, /class="dg-cur"/g)).toBe(1)
    expect(mini).not.toContain('予約')
    expect(mini.length).toBeLessThan(svg.length)
  })

  it('DirectionOrder: 並びの長さだけ番号が付く', () => {
    const svg = directionOrderSvg({
      names: DIR_NAMES,
      orders: [{ label: '6', order: ['W', 'E', 'D', 'U', 'N', 'S'] }, { label: '2', order: ['U', 'D'] }],
    })
    expect(count(svg, /<circle /g)).toBe(6 + 2)
    expect(svg).toContain('西 → 東 → 下 → 上 → 北 → 南')
    expect(svg).toContain('上 → 下')
  })

  it('TickAxis: 箱・帯・矢印を置く', () => {
    const svg = tickAxisSvg({
      cols: [{ label: 'T', group: 'g' }, { label: 'T+1', group: 'g' }],
      lanes: ['上の段', '下の段'],
      items: [
        { k: 'ev', col: 0, lane: 0, text: '積む', n: 1 },
        { k: 'ev', col: 1, lane: 1, text: '走る', hi: true },
        { k: 'bar', lane: 1, from: 0, to: 1, text: '待つ' },
        { k: 'arrow', from: [0, 0], to: [1, 1], text: '予約' },
      ],
    })
    for (const s of ['T+1', '上の段', '積む', '走る', '待つ', '予約', 'class="dg-ah"', 'class="dg-alt"']) expect(svg).toContain(s)
  })

  it('StepFlow: 番号を上から振り、分岐を右へ出す', () => {
    const svg = stepFlowSvg({ steps: [{ text: '一' }, { text: '二', sub: ['小'], out: { when: '駄目なら', text: '戻る' } }, { text: '三' }] })
    expect(count(svg, /<circle /g)).toBe(3)
    expect(count(svg, /class="dg-ah"/g)).toBe(2 + 1)      // 箱の間 2 + 分岐 1
    expect(svg).toContain('2.1  小')
    expect(svg).toContain('class="dg-out"')
  })

  it('字は escape する', () => {
    expect(stepFlowSvg({ steps: [{ text: 'a < b & "c"' }] })).toContain('a &lt; b &amp; &quot;c&quot;')
  })

  it('React の部品は、関数の SVG をそのまま包む', () => {
    const data = { steps: [{ text: '一' }] }
    expect(renderToStaticMarkup(createElement(StepFlow, { data }))).toBe(`<div class="dg-one">${stepFlowSvg(data)}</div>`)
    const phase = { cells: LEVEL_PHASES }
    expect(renderToStaticMarkup(createElement(PhaseTimeline, { data: phase }))).toContain(phaseTimelineSvg(phase))
    const dirs = { names: DIR_NAMES, orders: [{ label: 'a', order: ['U' as const] }] }
    expect(renderToStaticMarkup(createElement(DirectionOrder, { data: dirs }))).toContain(directionOrderSvg(dirs))
    const ticks = { cols: [{ label: 'T' }], lanes: [''], items: [] }
    expect(renderToStaticMarkup(createElement(TickAxis, { data: ticks }))).toContain(tickAxisSvg(ticks))
    const def = DIAGRAMS['level-phases']
    expect(renderToStaticMarkup(createElement(Diagram, { name: 'level-phases', def }))).toBe(figureHtml('level-phases', def))
  })
})

describe('最初の 8 枚', () => {
  it('8 枚ある', () => {
    expect(names).toEqual([
      'tick-loop-cycle', 'level-phases', 'tick-boundary', 'schedule-to-fire',
      'set-block-steps', 'direction-orders', 'repeater-flip', 'piston-timeline',
    ])
  })

  it.each(names)('%s: 題と元の節が付き、座標に NaN が出ず、色を直に書かない', name => {
    const html = diagramHtml(name)
    expect(html.startsWith(`<figure class="dg" data-dg="${name}">`)).toBe(true)
    expect(html).toContain('<figcaption class="dg-cap">図: ')
    expect(html).toMatch(/\(V\d\d §[\d.〜§]+ の言い換え\)/)
    expect(html).not.toMatch(/NaN|undefined|Infinity/)
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,6}\b|rgb\(|fill="|stroke="/)
    expect(count(html, /<svg /g)).toBe(DIAGRAMS[name].panels.length)
  })

  it('数が md と合う (手順・相・並び)', () => {
    const steps = (n: DiagramName) => {
      const p = DIAGRAMS[n].panels[0]
      return p.kind === 'flow' ? p.data.steps.length : -1
    }
    expect(steps('schedule-to-fire')).toBe(7)     // V02 §2.2 の 7 手順
    expect(steps('set-block-steps')).toBe(10)     // V04 §2.1 の 10 手順
    expect(steps('repeater-flip')).toBe(5)        // V07 §2.4 の 5 手順
    const cycle = DIAGRAMS['tick-loop-cycle'].panels[0]
    expect(cycle.kind === 'phase' && cycle.data.cells.map(c => c.id).join(' ')).toBe('A B1 B2 B3 B4 B5 B6 B7 B8 B9 B10 C')
    const boundary = DIAGRAMS['tick-boundary'].panels[0]
    expect(boundary.kind === 'ticks' && boundary.data.items.filter(i => i.k === 'ev').map(i => i.k === 'ev' && i.n)).toEqual([1, 2, 3, 4, 5, 6, 7])
    const dirs = DIAGRAMS['direction-orders'].panels[0]
    expect(dirs.kind === 'dirs' && dirs.data.orders.map(o => o.order.join(''))).toEqual(['DUNSWE', 'WEDUNS', 'WENSDU', 'NESW', 'UD'])
    expect(DIAGRAMS['piston-timeline'].panels.map(p => p.title)).toEqual(['伸長', '収縮'])
  })

  it('見た目の CSS は明暗の両方の色を持つ', () => {
    expect(DIAGRAM_CSS).toContain('prefers-color-scheme:dark')
    expect(DIAGRAM_CSS).toContain('overflow-x:auto')
    for (const v of ['--dg-bg', '--dg-fg', '--dg-muted', '--dg-line', '--dg-box', '--dg-hi', '--dg-accent', '--dg-alt']) {
      expect(count(DIAGRAM_CSS, new RegExp(`${v}:`, 'g')), v).toBe(2)
    }
  })
})
