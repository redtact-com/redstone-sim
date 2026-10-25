import { describe, it, expect } from 'vitest'
import { isConductor } from '../src/power.js'
import { isWireCutBlock } from '../src/blocks/wire.js'
import { ALL_BLOCK_TYPES } from '../src/types.js'
import type { BlockState } from '../src/types.js'

// #300 / R-2: isConductor (power.ts) と isWireCutBlock (blocks/wire.ts) は
// どちらも vanilla の isRedstoneConductor 由来なので**同じ集合**でなければならない。
// #290 で isConductor だけにドロッパー等を足して乖離させた回帰があり、R-2 では
// slime_block / lodestone / soul_sand の 3 型が切る側に無かった。以前の SAMPLES (12 種) に
// この 3 型が無く、すり抜けていた。**全型を回す**ので、2 つを再び別の一覧に分けたときの
// 食い違いは型を問わずここで出る (isConductor の表そのものの誤りはこのテストでは見えない。
// 新しい型が導体かどうかは実機で測る)。
//
// 実機で測った結果:
//   上り接続を切る (= 導体) … stone dropper dispenser crafter redstone_lamp
//                              note_block target [実機 fixture wire-cut-conductor]
//                              slime_block lodestone soul_sand [実機 fixture wire-cut-conductor-power]
//   切らない (= 非導体)     … glass observer chest waxed_copper_bulb hopper [実機 fixture wire-cut-conductor]
//   樽は導体 [実機 fixture barrel-chest-conductor] なので切る (上り接続を切る様子は fixture に入っていない)

/** 判定は type と container の fullCube だけで決まるので、最小の形で全型を作る */
const SAMPLES: BlockState[] = ALL_BLOCK_TYPES.flatMap((type): { type: BlockState['type']; fullCube?: boolean }[] =>
  type === 'container'
    ? [{ type, fullCube: true }, { type, fullCube: false }]
    : [{ type }],
) as BlockState[]

const sampleOf = (type: BlockState['type']): BlockState => SAMPLES.find(s => s.type === type)!

describe('導体判定は 2 か所で一致する (#300 / R-2)', () => {
  it('全型を網羅している', () => {
    expect(SAMPLES.length).toBeGreaterThan(40)
    expect(SAMPLES.some(s => s.type === 'slime_block')).toBe(true)
  })

  it.each(SAMPLES.map(b => [
    b.type + (b.type === 'container' ? `(fullCube=${(b as { fullCube?: boolean }).fullCube})` : ''),
    b,
  ] as const))(
    '%s は isConductor と isWireCutBlock が同じ', (_name, block) => {
      expect(isWireCutBlock(block)).toBe(isConductor(block))
    })

  it('ドロッパー系は導体でありダストの上り接続を切る', () => {
    for (const t of ['dropper', 'dispenser', 'crafter'] as const) {
      const b = sampleOf(t)
      expect(isConductor(b)).toBe(true)
      expect(isWireCutBlock(b)).toBe(true)
    }
  })

  it('スライム・ロードストーン・ソウルサンドは導体でありダストの上り接続を切る (R-2)', () => {
    for (const t of ['slime_block', 'lodestone', 'soul_sand'] as const) {
      const b = sampleOf(t)
      expect(isConductor(b)).toBe(true)
      expect(isWireCutBlock(b)).toBe(true)
    }
  })

  it('ガラス・オブザーバー・ホッパー・銅の電球・レッドストーンブロック・ハチミツは切らない', () => {
    for (const t of ['glass', 'observer', 'hopper', 'copper_bulb', 'redstone_block', 'honey_block', 'air'] as const) {
      const b = sampleOf(t)
      expect(isConductor(b)).toBe(false)
      expect(isWireCutBlock(b)).toBe(false)
    }
  })

  it('樽 (fullCube) は切り、チェスト (fullCube でない) は切らない (#291)', () => {
    expect(isWireCutBlock({ type: 'container', fullCube: true } as BlockState)).toBe(true)
    expect(isWireCutBlock({ type: 'container', fullCube: false } as BlockState)).toBe(false)
  })
})
