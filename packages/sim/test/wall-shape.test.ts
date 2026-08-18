import { describe, it, expect } from 'vitest'
import { SimWorld } from '../src/world.js'
import { mcToSim } from '../src/mcstate.js'
import type { BlockState } from '../src/types.js'

/**
 * 塀 = **下方向の無遅延バス** (#234)。
 *
 * 仕掛けは [確定: 26.2 WallBlock.shouldRaisePost] の先頭:
 * 「**上の塀が up=true なら自分も up=true**」。updateShape は隣へ連鎖するので、
 * 上端の 1 か所を変えると柱の全段が**同じ tick で**反転する。
 *
 * 実機で確認済み (rcon 直接測定 + fixture wall-post-cascade が 25 tick 一致):
 * 7 段の柱の最上段の側面を壊すと t=0 で全段 up=false → true、
 * 下端の上向きオブザーバーが 2gt 後に発火する。
 */
const wall = (n: string, s: string) =>
  mcToSim(`stone_brick_wall[east=none,north=${n},south=${s},up=false,waterlogged=false,west=none]`)!

/** 南北をガラスで挟んだ塀の柱 */
const column = (h: number): SimWorld => {
  const w = new SimWorld()
  w.setBlockAt([1, 0, 1], { type: 'solid', powered: false } as BlockState)
  w.setBlockAt([1, 1, 1], { type: 'observer', facing: 'up', powered: false } as BlockState)
  for (let y = 2; y <= h + 1; y++) {
    w.setBlockAt([1, y, 1], wall(y === h + 1 ? 'low' : 'tall', y === h + 1 ? 'low' : 'tall'))
    w.setBlockAt([1, y, 0], { type: 'glass' } as BlockState)
    w.setBlockAt([1, y, 2], { type: 'glass' } as BlockState)
  }
  w.initialize()
  w.flush(64)
  return w
}

const upAt = (w: SimWorld, y: number): boolean => (w.getBlock(1, y, 1) as { up: boolean }).up

describe('塀の形状', () => {
  it('取り込める (4 辺 + up + waterlogged)', () => {
    expect(mcToSim('stone_brick_wall[east=none,north=tall,south=tall,up=false,waterlogged=true,west=none]'))
      .toEqual({ type: 'wall', north: 'tall', south: 'tall', east: 'none', west: 'none', up: false, waterlogged: true })
  })

  it('南北がガラスなら up=false で安定する', () => {
    const w = column(6)
    for (let y = 2; y <= 6; y++) expect(upAt(w, y), `y=${y}`).toBe(false)
  })

  it('**上端の側面を壊すと全段が同じ tick で up=true になる**', () => {
    const w = column(6)
    // 最上段 (y=7) の北のガラスを壊す → 角持ちになって up=true
    w.setBlockCommand([1, 7, 0], { type: 'air' })
    for (let y = 2; y <= 7; y++) expect(upAt(w, y), `y=${y} が反転していない`).toBe(true)
  })

  it('140 段でも同じ tick で下端まで届く', () => {
    const w = column(140)
    w.setBlockCommand([1, 141, 0], { type: 'air' })
    expect(upAt(w, 2), '下端まで届いていない').toBe(true)
  })

  it('下端のオブザーバーが検知する', () => {
    const w = column(6)
    expect(w.getBlock(1, 1, 1)).toMatchObject({ powered: false })
    w.setBlockCommand([1, 7, 0], { type: 'air' })
    let fired = false
    for (let t = 1; t <= 8; t++) {
      w.tick()
      if ((w.getBlock(1, 1, 1) as { powered?: boolean }).powered) fired = true
    }
    expect(fired, '形状が変わったのにオブザーバーが発火しない').toBe(true)
  })

  it('上が塀のとき、辺の高さは**上の塀の同じ辺**で決まる', () => {
    const w = column(6)
    w.setBlockCommand([1, 7, 0], { type: 'air' })
    // 上端 (y=7) は north=none になり、その 1 つ下 (y=6) の north は low に落ちる
    expect(w.getBlock(1, 7, 1)).toMatchObject({ north: 'none' })
    expect(w.getBlock(1, 6, 1), '上が none なのに tall のまま').toMatchObject({ north: 'low' })
    // さらに下は上の塀が north=low (none ではない) なので tall のまま
    expect(w.getBlock(1, 5, 1)).toMatchObject({ north: 'tall' })
  })
})
