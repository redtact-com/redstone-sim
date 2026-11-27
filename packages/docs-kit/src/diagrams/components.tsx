import type { ReactElement } from 'react'
import { directionOrderSvg } from './direction-order.js'
import type { DirectionOrderData } from './direction-order.js'
import { figureInnerHtml } from './figure.js'
import type { DiagramDef } from './figure.js'
import { phaseTimelineSvg } from './phase-timeline.js'
import type { PhaseTimelineData } from './phase-timeline.js'
import { stepFlowSvg } from './step-flow.js'
import type { StepFlowData } from './step-flow.js'
import { tickAxisSvg } from './tick-axis.js'
import type { TickAxisData } from './tick-axis.js'

/**
 * 図の React の部品 (#434)。どれも「データ → SVG の文字列」の関数を包むだけで、状態も副作用も持たない。
 * 見た目は `DIAGRAM_CSS` をページに 1 回入れる。
 */
function Svg({ html }: { html: string }): ReactElement {
  return <div className="dg-one" dangerouslySetInnerHTML={{ __html: html }} />
}

export function PhaseTimeline({ data, label }: { data: PhaseTimelineData; label?: string }): ReactElement {
  return <Svg html={phaseTimelineSvg(data, label)} />
}

export function DirectionOrder({ data, label }: { data: DirectionOrderData; label?: string }): ReactElement {
  return <Svg html={directionOrderSvg(data, label)} />
}

export function TickAxis({ data, label }: { data: TickAxisData; label?: string }): ReactElement {
  return <Svg html={tickAxisSvg(data, label)} />
}

export function StepFlow({ data, label }: { data: StepFlowData; label?: string }): ReactElement {
  return <Svg html={stepFlowSvg(data, label)} />
}

/** 題つきの図 1 枚 (`figureHtml` と同じ HTML になる) */
export function Diagram({ name, def }: { name: string; def: DiagramDef }): ReactElement {
  return <figure className="dg" data-dg={name} dangerouslySetInnerHTML={{ __html: figureInnerHtml(def) }} />
}
