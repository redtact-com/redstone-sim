import { REPEATER_FLIP } from './diodes.data.js'
import { figureHtml } from './figure.js'
import type { DiagramDef } from './figure.js'
import { PISTON_TIMELINE } from './pistons.data.js'
import { SCHEDULE_TO_FIRE } from './scheduled-ticks.data.js'
import { DIRECTION_ORDERS, SET_BLOCK_STEPS } from './set-block.data.js'
import { LEVEL_PHASE_TIMELINE, TICK_BOUNDARY, TICK_LOOP_CYCLE } from './tick-loop.data.js'

/**
 * 名前で引ける図の一覧 (#434)。読む側は「節 ID → ここの名前」を持つ (docs-web/src/diagrams/placements.ts)。
 * 図を足す時は、`*.data.ts` に文言を書いてここに 1 行足す。
 */
export const DIAGRAMS = {
  'tick-loop-cycle': TICK_LOOP_CYCLE,
  'level-phases': LEVEL_PHASE_TIMELINE,
  'tick-boundary': TICK_BOUNDARY,
  'schedule-to-fire': SCHEDULE_TO_FIRE,
  'set-block-steps': SET_BLOCK_STEPS,
  'direction-orders': DIRECTION_ORDERS,
  'repeater-flip': REPEATER_FLIP,
  'piston-timeline': PISTON_TIMELINE,
} satisfies Record<string, DiagramDef>

export type DiagramName = keyof typeof DIAGRAMS

/** 名前から図 1 枚の HTML を作る */
export function diagramHtml(name: DiagramName): string {
  return figureHtml(name, DIAGRAMS[name])
}
