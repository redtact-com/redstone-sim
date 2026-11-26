import { describe, it, expect } from 'vitest'
import { FixtureRunner } from '@redstone/sim'
import type { Fixture } from '@redstone/sim'
import { fitDistance, VIEWER_FOV_DEG } from '@redstone/viewer'
import { clampLayer, fixtureFrame, sliceSnapshot, topDownDistance, topLayer } from '@redstone/docs-kit/viewer'

const FX: Fixture = {
  name: 'two-layers', mcVersion: '1.21.1', ticks: 2,
  region: { from: [0, 4, 0], to: [3, 6, 1] },
  blocks: [
    { pos: [0, 4, 0], block: 'stone' },
    { pos: [1, 4, 0], block: 'stone' },
    { pos: [0, 5, 0], block: 'redstone_block' },
    { pos: [1, 5, 0], block: 'redstone_wire' },
    { pos: [3, 6, 1], block: 'stone' },
  ],
  inputs: [], expect: [],
}

describe('ビューアの枠の計算 (#434)', () => {
  it('領域から大きさ・中心・層の範囲を決める (向きが逆でも同じ)', () => {
    const f = fixtureFrame(FX.region, 1.6)
    expect(f.size).toEqual([4, 3, 2])
    expect(f.center).toEqual([2, 5.5, 1])
    expect(f.layers).toEqual([4, 6])
    expect(f.distance).toBe(fitDistance([4, 3, 2], { aspect: 1.6 }))
    expect(fixtureFrame({ from: FX.region.to, to: FX.region.from }, 1.6)).toEqual(f)
  })

  it('2D: 層より上のブロックを外す。領域は変えない', () => {
    const snap = new FixtureRunner(FX).worldSnapshot()
    expect(snap.blocks.size).toBe(5)
    const mid = sliceSnapshot(snap, 5)
    expect([...mid.blocks.keys()].sort()).toEqual(['0,4,0', '0,5,0', '1,4,0', '1,5,0'])
    expect(mid.bounds).toBe(snap.bounds)
    expect(sliceSnapshot(snap, 4).blocks.size).toBe(2)
    // 残したブロックは同じ物 (viewer はエントリの参照で変化を見る)
    expect(mid.blocks.get('1,5,0')).toBe(snap.blocks.get('1,5,0'))
    // 上端の層は絞らない (同じ snapshot を返すので、描き直しも起きない)
    expect(sliceSnapshot(snap, 6)).toBe(snap)
    expect(sliceSnapshot(snap, 9)).toBe(snap)
  })

  it('2D の寄り: 層の上の面が、縦にも横にも枠に収まる', () => {
    const f = fixtureFrame(FX.region)
    const tan = Math.tan((VIEWER_FOV_DEG * Math.PI) / 360)
    for (const aspect of [0.6, 1, 1.6, 2.4]) {
      for (const layer of [4, 5, 6]) {
        const d = topDownDistance(f, layer, aspect)
        // 層の上の面までの奥行き
        const depth = d - ((layer - 4 + 1) - f.size[1] / 2)
        expect(depth * tan, `縦 ${aspect} ${layer}`).toBeGreaterThanOrEqual(f.size[2] / 2)
        expect(depth * tan * aspect, `横 ${aspect} ${layer}`).toBeGreaterThanOrEqual(f.size[0] / 2)
      }
    }
    // 下の層ほど、カメラは近くてよい
    expect(topDownDistance(f, 4, 1.6)).toBeLessThan(topDownDistance(f, 6, 1.6))
  })

  it('最初の層は、ブロックのある一番上の層', () => {
    const tall: Fixture = { ...FX, region: { from: [0, 4, 0], to: [3, 9, 1] } }
    const snap = new FixtureRunner(tall).worldSnapshot()
    expect(topLayer(snap, fixtureFrame(tall.region))).toBe(6)
    expect(topLayer({ blocks: new Map(), bounds: snap.bounds }, fixtureFrame(tall.region))).toBe(4)
  })

  it('層は範囲の中に収める', () => {
    const f = fixtureFrame(FX.region)
    expect([3, 4, 5, 6, 7].map(y => clampLayer(f, y))).toEqual([4, 4, 5, 6, 6])
  })
})
