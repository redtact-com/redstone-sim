import { describe, it, expect } from 'vitest'
import { SimWorld } from '../src/world.js'
import type { WireState, BlockState } from '../src/types.js'

/**
 * 非導体フルブロック (glass / slab) の挙動 (#184)。
 *
 * これらは vanilla では `isRedstoneConductor` が false で、
 *   - 強充電を受けても隣の dust へ渡さない
 *   - dust の上下斜め接続を切らない
 *   - ピストンには押される
 * という「solid とは違うがフルブロックではある」立ち位置にある。
 *
 * **導通の有無は実機で確定済み** (fixture `nonconductor-glass-slab`: レーンごとに
 * repeater で被検ブロックを強充電し、隣の dust の power を見る。stone と二重スラブは
 * 15 / glass と単体スラブは 0)。ここではその実機結果を単体テストの粒度に分解し、
 * 併せて実機 fixture に載せていない斜め接続とピストンを固定する。
 *
 * 実装上の注意: `isConductor` (power.ts) と `isWireCutBlock` (blocks/wire.ts) は
 * どちらも「導体である型」を列挙する形なので、**型を足しただけで自動的に非導体になる**。
 * つまりこのテストは「実装したこと」ではなく「実装しなかったこと」を守っている。
 *
 * **dust への導通は 2 箇所でゲートされている** (変異テストで判明):
 *   1. `power.ts` の `isConductor` — 伝播で dust を再計算対象にするか
 *   2. `blocks/wire.ts` の `computeWirePower` の `src.type === 'solid'` 分岐 — 強充電を読むか
 * 片方だけに glass を足しても dust は 0 のままで、**両方揃って初めて導通する**。
 * 単独変異でこのテストが落ちなくても「テストが弱い」わけではないので注意
 * (実際に一度そう誤読した)。
 */

const crossWire = (power = 0): WireState => ({
  type: 'wire',
  connections: { north: true, south: true, east: true, west: true },
  power,
})

const GLASS: BlockState = { type: 'glass' }
const SLAB: BlockState = { type: 'slab', half: 'bottom' }
const SOLID: BlockState = { type: 'solid', powered: false }

function ticks(w: SimWorld, n: number): void {
  for (let i = 0; i < n; i++) w.tick()
}

describe('非導体フルブロック: 導通しない (#184)', () => {
  /**
   * リピーターで被検ブロックを**強充電**し、その隣の dust が上がるかを見る。
   * 実機 fixture nonconductor-glass-slab と同じ構成。
   */
  const dustPowerBehind = (test: BlockState): number => {
    const world = new SimWorld()
    world.setBlock(0, 0, 0, { type: 'redstone_block' })
    world.setBlock(1, 0, 0, { type: 'repeater', facing: 'east', delay: 1, locked: false, powered: false })
    world.setBlock(2, 0, 0, test)
    world.setBlock(3, 0, 0, crossWire())
    world.initialize()
    ticks(world, 4)
    return (world.getBlock(3, 0, 0) as WireState).power
  }

  it('石は強充電を隣の dust へ渡す (対照)', () => {
    expect(dustPowerBehind(SOLID)).toBe(15)
  })

  it('ガラスは渡さない', () => {
    expect(dustPowerBehind(GLASS)).toBe(0)
  })

  it('単体スラブは渡さない', () => {
    expect(dustPowerBehind(SLAB)).toBe(0)
    expect(dustPowerBehind({ type: 'slab', half: 'top' })).toBe(0)
  })
})

describe('非導体フルブロック: dust の斜め接続を切らない (#184)', () => {
  /**
   * 下側 dust の直上に被検ブロックを置き、1 段上の dust へ上りステップが通るかを見る。
   * solid だと切れる (vertical.test.ts の「直上に固体があると切断される」と同じ形)。
   */
  const upStepPower = (above: BlockState | null): number => {
    const world = new SimWorld()
    world.setBlock(0, 0, 0, { type: 'lever', facing: 'up', powered: true })
    world.setBlock(1, 0, 0, crossWire())
    if (above) world.setBlock(1, 1, 0, above)
    world.setBlock(2, 0, 0, SOLID)
    world.setBlock(2, 1, 0, crossWire())
    world.initialize()
    return (world.getBlock(2, 1, 0) as WireState).power
  }

  it('直上が空なら通る (対照)', () => {
    expect(upStepPower(null)).toBe(14)
  })

  it('直上が石なら切れる (対照)', () => {
    expect(upStepPower(SOLID)).toBe(0)
  })

  it('直上がガラスでも切れない', () => {
    expect(upStepPower(GLASS)).toBe(14)
  })

  it('直上が単体スラブでも切れない', () => {
    expect(upStepPower(SLAB)).toBe(14)
  })
})

describe('非導体フルブロック: ピストンで押せる (#184)', () => {
  /**
   * 非導体でも PushReaction は既定の NORMAL なので押される。
   * 「非導体 = 空気同然」ではないことを固定する。
   */
  const pushedTo = (payload: BlockState): BlockState | null => {
    const world = new SimWorld()
    world.setBlock(0, 0, 0, { type: 'lever', facing: 'up', powered: false })
    world.setBlock(1, 0, 0, { type: 'piston', facing: 'east', extended: false })
    world.setBlock(2, 0, 0, payload)
    world.initialize()
    world.activateBlock(0, 0, 0)
    ticks(world, 6)
    // piston_head が 2 マス目に入り、payload は 3 マス目へ移る
    return world.getBlock(3, 0, 0)
  }

  it('ガラスは押される', () => {
    expect(pushedTo(GLASS)).toMatchObject({ type: 'glass' })
  })

  it('単体スラブは押される (half を保つ)', () => {
    expect(pushedTo({ type: 'slab', half: 'top' })).toMatchObject({ type: 'slab', half: 'top' })
  })
})
