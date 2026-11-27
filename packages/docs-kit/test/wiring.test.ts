import { describe, it, expect } from 'vitest'
import { FixtureRunner } from '@redstone/sim'
import type { Fixture } from '@redstone/sim'
import { fitDistance } from '@redstone/viewer'
import { DOCS_KIT_VERSION } from '@redstone/docs-kit'
import { FixtureViewer, fixtureFrame } from '@redstone/docs-kit/viewer'

/**
 * 配線の最小のテスト (#434)。docs-kit から viewer と sim を import できることを見る。
 * 同じ import を `tsc -b` (packages/docs-kit/tsconfig.json) と `vite build` (docs-web) も通る。
 * alias を足し忘れると、3 つのどれかがここで落ちる。
 */
describe('docs-kit の配線', () => {
  it('入口と viewer の入口を別々に import できる', () => {
    expect(DOCS_KIT_VERSION).toBe(1)
    expect(typeof fixtureFrame).toBe('function')
    expect(typeof FixtureViewer).toBe('function')
  })

  it('viewer の fitDistance で枠を決める', () => {
    const f = fixtureFrame({ from: [0, 0, 0], to: [5, 1, 1] }, 16 / 9)
    expect(f.size).toEqual([6, 2, 2])
    expect(f.center).toEqual([3, 1, 1])
    expect(f.distance).toBe(fitDistance([6, 2, 2], { aspect: 16 / 9 }))
    expect(f.distance).toBeGreaterThan(0)
  })

  it('sim の FixtureRunner が動く', () => {
    const fixture: Fixture = {
      name: 'wiring', mcVersion: '1.21.1', ticks: 2,
      region: { from: [0, 0, 0], to: [0, 0, 0] },
      blocks: [{ pos: [0, 0, 0], block: 'stone' }],
      inputs: [], expect: [],
    }
    const runner = new FixtureRunner(fixture)
    expect(runner.step().tick).toBe(1)
    expect(runner.maxTicks).toBe(2)
  })
})
