import { describe, it, expect } from 'vitest'
import { SimWorld } from '../src/world.js'
import type { WireState } from '../src/types.js'

/**
 * collectWireStarts が末尾に足す起点 (段越しの読み手と置いたダスト自身。#404) は、
 * ほかの起点と同じ網にいるときは BFS の探索順を変えてはいけない。
 * 探索順 = changedWires の順 = 形状更新とダスト多段 NC の順で、方針どおり
 * ダスト網の中の更新順 (R-20) はこの PR で変えない。
 *
 * 配置 (y=1 の層。床は石):
 *   A (1,1,0) ─ E (1,1,1) ─ G (2,1,1)   同層で連結
 *   D (0,0,1): E の西の 1 段下。(0,1,1) は空気なので E は D を下りで読み、
 *              D は東の石 (1,0,1) 越しに E を上りで読む
 * (0,1,0) に redstone_block を置くと A が 15、E 14、G 13、D 13 になる。
 * D は置いた位置 (0,1,0) の水平隣 (0,1,1) の 1 段下なので「段越しの読み手」として
 * 起点の末尾に入るが、A から E 経由で辿れるので、探索順は A → E → G → D のまま
 * (develop ed3baa9 と同じ。起点をキューの先頭にまとめて積むと A → D → E → G になる)。
 * 各ダストを向いたオブザーバーが形状更新を受けて tick を予約するので、予約の順で見る。
 */
describe('段越しの読み手の起点は既存の探索順を変えない (#404)', () => {
  /** 導出値どおりの形で置く (置いた時点で張り替えが走ると、その形状更新が先に出てしまう) */
  const wire = (c: Partial<WireState['connections']>): WireState => ({
    type: 'wire',
    connections: { north: false, south: false, east: false, west: false, ...c },
    power: 0,
  })

  it('redstone_block を置いたときの changedWires の順が A → E → G → D', () => {
    const world = new SimWorld()
    for (const [x, z] of [[1, 0], [1, 1], [2, 1]]) world.setBlock(x, 0, z, { type: 'solid', powered: false })
    world.setBlock(0, -1, 1, { type: 'solid', powered: false })
    world.setBlock(1, 1, 0, wire({ north: true, south: true }))              // A (南の E だけ。直線)
    world.setBlock(1, 1, 1, wire({ north: true, east: true, west: true }))   // E (A・G・下りの D)
    world.setBlock(2, 1, 1, wire({ east: true, west: true }))                // G (西の E だけ。直線)
    world.setBlock(0, 0, 1, wire({ east: 'up', west: true }))                // D (東の上り E だけ。直線)
    // A・E・G は真上のオブザーバー (下向き)。D は南のオブザーバー (北向き)。
    // どれも置く位置 (0,1,0) に隣接させない (置いた時点の更新で先に予約されないように)
    for (const [x, y, z] of [[1, 2, 0], [1, 2, 1], [2, 2, 1]]) {
      world.setBlock(x, y, z, { type: 'observer', facing: 'down', powered: false })
    }
    world.setBlock(0, 0, 2, { type: 'observer', facing: 'north', powered: false })
    world.initialize()
    world.flush(64)
    expect(world.getScheduledTicks()).toEqual([])

    world.setBlockCommand([0, 1, 0], { type: 'redstone_block' })
    const powers = [[1, 1, 0], [1, 1, 1], [2, 1, 1], [0, 0, 1]]
      .map(([x, y, z]) => (world.getBlock(x, y, z) as WireState).power)
    expect(powers).toEqual([15, 14, 13, 13])
    const order = world.getScheduledTicks()
      .filter(t => t.blockType === 'observer')
      .map(t => t.pos.join(','))
    // 4 本とも 1 回ずつ (置いた時点の張り替えによる形状更新は無い)
    expect(order).toEqual(['1,2,0', '1,2,1', '2,2,1', '0,0,2'])
  })
})
