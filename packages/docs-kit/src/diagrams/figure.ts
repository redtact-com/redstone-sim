import { directionOrderSvg } from './direction-order.js'
import type { DirectionOrderData } from './direction-order.js'
import { phaseTimelineSvg } from './phase-timeline.js'
import type { PhaseTimelineData } from './phase-timeline.js'
import { stepFlowSvg } from './step-flow.js'
import type { StepFlowData } from './step-flow.js'
import { esc } from './svg.js'
import { tickAxisSvg } from './tick-axis.js'
import type { TickAxisData } from './tick-axis.js'

/** 図の中の 1 枚。部品の種類と、その部品に渡す値 */
export type DiagramPanel = { title?: string } & (
  | { kind: 'phase'; data: PhaseTimelineData }
  | { kind: 'dirs'; data: DirectionOrderData }
  | { kind: 'ticks'; data: TickAxisData }
  | { kind: 'flow'; data: StepFlowData }
)

/** 図 1 枚 (題・元にした節・中身)。文言は `*.data.ts` に書く */
export interface DiagramDef {
  title: string
  /** 元にしたメモの節 (`V01 §2.3`)。題の後ろに小さく出す */
  source: string
  /** 中身。ふつうは 1 枚。伸長と収縮のように並べて見せる時だけ 2 枚にする */
  panels: DiagramPanel[]
}

/** 部品 1 枚を SVG の文字列にする */
export function panelSvg(p: DiagramPanel, label: string): string {
  switch (p.kind) {
    case 'phase': return phaseTimelineSvg(p.data, label)
    case 'dirs': return directionOrderSvg(p.data, label)
    case 'ticks': return tickAxisSvg(p.data, label)
    case 'flow': return stepFlowSvg(p.data, label)
  }
}

/** `<figure>` の中身 (題と SVG) */
export function figureInnerHtml(def: DiagramDef): string {
  const cap = `<figcaption class="dg-cap">図: ${esc(def.title)} <span class="dg-src">(${esc(def.source)} の言い換え)</span></figcaption>`
  return cap + def.panels.map(p =>
    (p.title ? `<p class="dg-panel">${esc(p.title)}</p>` : '')
    + panelSvg(p, p.title ? `${def.title}: ${p.title}` : def.title)).join('')
}

/**
 * 図 1 枚の HTML (`<figure class="dg" data-dg="名前">`)。静的な HTML の記事にもそのまま埋められる。
 * 見た目は `DIAGRAM_CSS` をページに 1 回入れる。
 */
export function figureHtml(name: string, def: DiagramDef): string {
  return `<figure class="dg" data-dg="${esc(name)}">${figureInnerHtml(def)}</figure>`
}
