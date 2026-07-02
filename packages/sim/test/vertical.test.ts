import { describe, it, expect } from 'vitest'
import { SimWorld } from '../src/world.js'
import type { WireState } from '../src/types.js'

/**
 * 3D（垂直ステップ）伝播のテスト。
 * ワイヤーの connections は editor が計算するが、ここでは sim 単体で
 * 全方向 cross（north/south/east/west=true）を直接セットして検証する。
 */

const crossWire = (power = 0): WireState => ({
  type: 'wire',
  connections: { north: true, south: true, east: true, west: true },
  power,
})

describe('SimWorld: 垂直ステップ伝播', () => {
  it('上りステップ: 直上が開いていれば1段上のワイヤーへ減衰して伝わる', () => {
    const world = new SimWorld()
    world.setBlock(0, 0, 0, { type: 'lever', facing: 'up', powered: true })
    world.setBlock(1, 0, 0, crossWire())
    world.setBlock(2, 0, 0, { type: 'solid', powered: false })
    world.setBlock(2, 1, 0, crossWire())
    world.initialize()

    expect(world.getBlock(1, 0, 0)).toMatchObject({ type: 'wire', power: 15 })
    expect(world.getBlock(2, 1, 0)).toMatchObject({ type: 'wire', power: 14 })
  })

  it('上りステップ: 下側ワイヤーの直上に固体があると切断される', () => {
    const world = new SimWorld()
    world.setBlock(0, 0, 0, { type: 'lever', facing: 'up', powered: true })
    world.setBlock(1, 0, 0, crossWire())
    world.setBlock(1, 1, 0, { type: 'solid', powered: false })  // カットブロック
    world.setBlock(2, 0, 0, { type: 'solid', powered: false })
    world.setBlock(2, 1, 0, crossWire())
    world.initialize()

    expect(world.getBlock(1, 0, 0)).toMatchObject({ type: 'wire', power: 15 })
    expect(world.getBlock(2, 1, 0)).toMatchObject({ type: 'wire', power: 0 })
  })

  it('下りステップ: 1段下のワイヤーへ減衰して伝わる', () => {
    const world = new SimWorld()
    world.setBlock(0, 1, 0, { type: 'lever', facing: 'up', powered: true })
    world.setBlock(1, 1, 0, crossWire())
    world.setBlock(2, 0, 0, crossWire())
    world.initialize()

    expect(world.getBlock(1, 1, 0)).toMatchObject({ type: 'wire', power: 15 })
    expect(world.getBlock(2, 0, 0)).toMatchObject({ type: 'wire', power: 14 })
  })

  it('レバーOFFで垂直ステップ先のワイヤーも消灯する（ゼロ化→再増加）', () => {
    const world = new SimWorld()
    world.setBlock(0, 0, 0, { type: 'lever', facing: 'up', powered: true })
    world.setBlock(1, 0, 0, crossWire())
    world.setBlock(2, 0, 0, { type: 'solid', powered: false })
    world.setBlock(2, 1, 0, crossWire())
    world.initialize()
    expect(world.getBlock(2, 1, 0)).toMatchObject({ type: 'wire', power: 14 })

    world.activateBlock(0, 0, 0)  // OFF
    expect(world.getBlock(1, 0, 0)).toMatchObject({ type: 'wire', power: 0 })
    expect(world.getBlock(2, 1, 0)).toMatchObject({ type: 'wire', power: 0 })
  })

  it('直上直下のワイヤーは接続しない（vanillaで発生しない配置）', () => {
    const world = new SimWorld()
    world.setBlock(0, 0, 0, { type: 'lever', facing: 'up', powered: true })
    world.setBlock(1, 0, 0, crossWire())
    world.setBlock(1, 1, 0, crossWire())  // 直上（斜めなし）
    world.initialize()

    expect(world.getBlock(1, 0, 0)).toMatchObject({ type: 'wire', power: 15 })
    expect(world.getBlock(1, 1, 0)).toMatchObject({ type: 'wire', power: 0 })
  })

  it('強充電された固体ブロックは隣接ワイヤーに15を与える', () => {
    const world = new SimWorld()
    // repeater(powered) → solid 強充電 → 上のワイヤーが受電
    world.setBlock(0, 0, 0, { type: 'lever', facing: 'up', powered: true })
    world.setBlock(1, 0, 0, { type: 'repeater', facing: 'east', delay: 1, powered: false, locked: false })
    world.setBlock(2, 0, 0, { type: 'solid', powered: false })
    world.setBlock(2, 1, 0, crossWire())
    world.initialize()
    world.flush()

    expect(world.getBlock(2, 0, 0)).toMatchObject({ type: 'solid', powered: true })
    expect(world.getBlock(2, 1, 0)).toMatchObject({ type: 'wire', power: 15 })
  })
})
