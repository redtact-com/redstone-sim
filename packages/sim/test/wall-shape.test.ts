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

describe('塀が横に繋がる相手 (#244)', () => {
  // **実機で全数測った表**。ドアを落としていたため、ドアが隣にある塀の柱が
  // sim だけ up=true に反転し、140 段まるごと食い違っていた
  const wallAt = (w: SimWorld, pos: Pos3D): { south: string; up: boolean } => {
    const b = w.getBlockAt(pos)
    if (b?.type !== 'wall') throw new Error('塀ではない')
    return { south: b.south, up: b.up }
  }

  /** 塀 (0,1,0) の南 (0,1,1) に置いたブロックで side がどうなるか */
  const southSide = (neighbor: BlockState | null): string => {
    const w = new SimWorld()
    for (const x of [-1, 0, 1]) for (const z of [-1, 0, 1]) {
      w.setBlockAt([x, 0, z], { type: 'solid', powered: false })
    }
    w.setBlockAt([0, 1, 0], {
      type: 'wall', north: 'none', east: 'none', south: 'none', west: 'none',
      up: true, waterlogged: false,
    } as BlockState)
    if (neighbor) w.setBlockAt([0, 1, 1], neighbor)
    w.initialize()
    // 形状は近隣更新で決まるので、隣に何か置いた形で組み直す
    w.setBlockCommand([0, 1, 1], neighbor ?? { type: 'air' })
    w.settle(8)
    return wallAt(w, [0, 1, 0]).south
  }

  it('**ドアは開閉・向きによらず繋がる** (実機で 8 通り確認)', () => {
    for (const open of [false, true]) {
      for (const facing of ['north', 'south', 'east', 'west'] as const) {
        const door: BlockState = {
          type: 'door_iron', facing, half: 'lower', hinge: 'left', open, powered: false,
        } as BlockState
        expect(southSide(door), `facing=${facing} open=${open}`).not.toBe('none')
      }
    }
  })

  it('フェンスゲートも繋がる', () => {
    expect(southSide({ type: 'fence_gate', facing: 'east', open: false, powered: false } as BlockState))
      .not.toBe('none')
  })

  it('ガラス・音符ブロック・ピストンは繋がる (フルブロック)', () => {
    expect(southSide({ type: 'glass' } as BlockState)).not.toBe('none')
    expect(southSide({ type: 'note_block', note: 0, powered: false, instrument: 'harp' } as BlockState)).not.toBe('none')
    expect(southSide({ type: 'piston', facing: 'north', extended: false } as BlockState)).not.toBe('none')
  })

  it('**トラップドアと下ハーフは繋がらない** (実機で確認)', () => {
    expect(southSide({ type: 'trapdoor_wood', facing: 'north', half: 'bottom', open: false, powered: false } as BlockState))
      .toBe('none')
    expect(southSide({ type: 'slab', half: 'bottom' } as BlockState)).toBe('none')
    expect(southSide(null)).toBe('none')
  })
})
