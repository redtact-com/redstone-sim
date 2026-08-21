import { describe, it, expect } from 'vitest'
import { isConductor } from '../src/power.js'
import { isWireCutBlock } from '../src/blocks/wire.js'
import type { BlockState } from '../src/types.js'

// #300: isConductor (power.ts) と isWireCutBlock (blocks/wire.ts) は
// どちらも vanilla の isRedstoneConductor 由来なので**同じ集合**でなければならない。
// #290 で isConductor だけにドロッパー等を足して乖離させた回帰を防ぐ。
//
// 実機で測った結果 (実機 fixture wire-cut-conductor):
//   上り接続を切る (= 導体) … stone dropper dispenser crafter redstone_lamp
//                              note_block target barrel
//   切らない (= 非導体)     … glass observer chest waxed_copper_bulb hopper

const SAMPLES: BlockState[] = [
  { type: 'solid', powered: false },
  { type: 'lamp', lit: false },
  { type: 'target', outputPower: 0 },
  { type: 'note_block', instrument: 'harp', note: 0, powered: false },
  { type: 'dropper', facing: 'north', slots: [], triggered: false },
  { type: 'dispenser', facing: 'north', slots: [], triggered: false },
  { type: 'crafter', facing: 'north', triggered: false, occupiedSlots: 0 },
  { type: 'glass' },
  { type: 'observer', facing: 'north', powered: false },
  { type: 'hopper', facing: 'down', slots: [], enabled: true, cooldownUntil: 0 },
  { type: 'copper_bulb', lit: false, powered: false },
  { type: 'air' },
] as BlockState[]

describe('導体判定は 2 か所で一致する (#300)', () => {
  it.each(SAMPLES.map(b => [b.type, b] as const))(
    '%s は isConductor と isWireCutBlock が同じ', (_name, block) => {
      expect(isWireCutBlock(block)).toBe(isConductor(block))
    })

  it('ドロッパー系は導体でありダストの上り接続を切る', () => {
    for (const t of ['dropper', 'dispenser', 'crafter'] as const) {
      const b = SAMPLES.find(s => s.type === t)!
      expect(isConductor(b)).toBe(true)
      expect(isWireCutBlock(b)).toBe(true)
    }
  })

  it('ガラス・オブザーバー・ホッパー・銅の電球は切らない', () => {
    for (const t of ['glass', 'observer', 'hopper', 'copper_bulb'] as const) {
      const b = SAMPLES.find(s => s.type === t)!
      expect(isConductor(b)).toBe(false)
      expect(isWireCutBlock(b)).toBe(false)
    }
  })
})
