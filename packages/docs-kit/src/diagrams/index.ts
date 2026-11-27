/**
 * @redstone/docs-kit/diagrams
 *
 * 記事の中の図 (#434)。自前の SVG で、部品は 4 つ (相の時間割・方向の並び・tick の時間軸・手順の流れ)。
 *
 * - 「データ → SVG の文字列」の関数が本体。React の部品はそれを包むだけ (静的な HTML の記事にも埋められる)
 * - 図の文言は `*.data.ts` に集める。docs/vanilla の md の表と手順の言い換えだけを書き、
 *   デコンパイルしたコードの字面は書かない (tools/ip-hygiene.test.ts がこのフォルダの全行を見る)
 * - 色は CSS 変数 (`--dg-*`)。`DIAGRAM_CSS` をページに 1 回入れる
 * - 読む用の Web (docs-web) には依存しない。どの節に置くかは読む側が決める
 */

export { DIAGRAM_CSS, DIAGRAM_WIDTH } from './svg.js'
export { phaseTimelineSvg } from './phase-timeline.js'
export type { PhaseCell, PhaseGroup, PhaseTimelineData } from './phase-timeline.js'
export { directionOrderSvg } from './direction-order.js'
export type { Dir, DirOrder, DirectionOrderData } from './direction-order.js'
export { tickAxisSvg } from './tick-axis.js'
export type { TickCol, TickEvent, TickBar, TickArrow, TickItem, TickAxisData } from './tick-axis.js'
export { stepFlowSvg } from './step-flow.js'
export type { FlowStep, StepFlowData } from './step-flow.js'
export { panelSvg, figureInnerHtml, figureHtml } from './figure.js'
export type { DiagramPanel, DiagramDef } from './figure.js'
export { PhaseTimeline, DirectionOrder, TickAxis, StepFlow, Diagram } from './components.js'
export { DIAGRAMS, diagramHtml } from './catalog.js'
export type { DiagramName } from './catalog.js'
export { LEVEL_PHASES } from './tick-loop.data.js'
export { DIR_NAMES } from './set-block.data.js'
