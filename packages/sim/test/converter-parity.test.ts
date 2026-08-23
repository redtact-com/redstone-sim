import { describe, it, expect } from 'vitest'
import { mcToSim } from '../src/mcstate.js'
import { doorLikeKindOf, buttonLikeKindOf } from '../src/blocks/blockNames.js'

/**
 * **2 本の変換器が同じ名前を受ける**こと (#346)。
 *
 * 取り込みは `app/src/nbtIO.ts` (アプリ) と `packages/sim/src/mcstate.ts` (実機キャプチャ) の
 * 2 本ある。以前は前者が接尾辞で広く受け、後者が case 列挙だったため、
 * **アプリでは取り込めるのに実機キャプチャを fixture にできない**名前が 20 以上あった。
 * 判定を `blockNames.ts` の共有ヘルパへ寄せたので、ここでその一致を固定する。
 */

/** 以前 mcstate 側だけが例外を投げていた名前 */
const PREVIOUSLY_REJECTED = [
  'copper_door', 'exposed_copper_door', 'weathered_copper_door', 'oxidized_copper_door',
  'waxed_copper_door', 'waxed_exposed_copper_door',
  'copper_trapdoor', 'waxed_oxidized_copper_trapdoor',
  'polished_blackstone_button', 'polished_blackstone_pressure_plate',
  'birch_pressure_plate', 'jungle_pressure_plate', 'cherry_pressure_plate',
  'bamboo_button', 'cherry_button', 'crimson_button',
]

describe('取り込みの受理名が 2 本の変換器で一致する (#346)', () => {
  it.each(PREVIOUSLY_REJECTED)('%s を実機キャプチャ側も取り込める', (id) => {
    const b = mcToSim(id)
    expect(b, `${id} が取り込めない`).not.toBeNull()
    expect((b as { name?: string }).name, '元の名前を保持していない').toBe(id)
  })

  it('共有ヘルパは重量感圧板を拾わない (別型で出力が 0-15)', () => {
    expect(buttonLikeKindOf('light_weighted_pressure_plate')).toBeNull()
    expect(buttonLikeKindOf('heavy_weighted_pressure_plate')).toBeNull()
    expect(mcToSim('light_weighted_pressure_plate')?.type).toBe('weighted_pressure_plate_light')
  })

  it('鉄の建具は木と別型のまま', () => {
    expect(doorLikeKindOf('iron_door')).toEqual({ type: 'door_iron', name: 'iron_door' })
    expect(doorLikeKindOf('iron_trapdoor')).toEqual({ type: 'trapdoor_iron', name: 'iron_trapdoor' })
    expect(mcToSim('iron_door')?.type).toBe('door_iron')
  })

  it('関係ない名前は拾わない', () => {
    for (const id of ['stone', 'oak_stairs', 'redstone_wire', 'oak_wall_sign']) {
      expect(doorLikeKindOf(id), id).toBeNull()
      expect(buttonLikeKindOf(id), id).toBeNull()
    }
  })
})
