import { describe, it, expect } from 'vitest'
import { SimWorld } from '../src/world.js'
import type { BlockState, ObserverState } from '../src/types.js'

/**
 * **点灯したまま運ばれたオブザーバーは着地で消灯する** (#221)。
 *
 * [確定: 26.2 ObserverBlock.onPlace — POWERED かつ scheduledTick が無ければ
 *  setBlock(POWERED=false, flag 18) + updateNeighborsInFront]
 *
 * 消灯 tick は**移動前の座標**に予約されているのでブロックが動くと失われる。
 * 着地側で消灯しないと**二度と消えない**。
 *
 * ユーザ提供の 2 幅ピストンドアで発現していた: 押されて戻ったオブザーバーが
 * 点きっぱなしになり、**1 往復はできるが 2 往復目が動かない**。
 * (#119 は「消灯状態で着地 → 2gt 後に発火」という逆の経路)
 */

const ticks = (w: SimWorld, n: number): void => { for (let i = 0; i < n; i++) w.tick() }
const obsAt = (w: SimWorld, x: number, y: number, z: number) =>
  w.getBlock(x, y, z) as ObserverState | null

describe('点灯したまま運ばれたオブザーバー (#221)', () => {
  it('着地したら消灯する (点きっぱなしにならない)', () => {
    const w = new SimWorld()
    // オブザーバー(2,0,0) は北 (2,0,-1) のレバーを観測する。
    // 観測用レバーはピストンに触れない位置に置く (誤って起動させないため)
    w.setBlockAt([2, 0, 0], { type: 'observer', facing: 'north', powered: false } as BlockState)
    w.setBlockAt([2, 0, -1], { type: 'lever', facing: 'up', powered: false } as BlockState)
    // ピストン(1,0,0,east) がオブザーバーを東へ押す。レバーで起動
    w.setBlockAt([1, 0, 0], { type: 'piston', facing: 'east', extended: false } as BlockState)
    w.setBlockAt([0, 0, 0], { type: 'lever', facing: 'up', powered: false } as BlockState)
    w.initialize()
    w.flush(64)
    expect(obsAt(w, 2, 0, 0)).toMatchObject({ powered: false })

    // 観測先のレバーを倒してオブザーバーを発火させる
    w.activateBlock(2, 0, -1)
    w.tick()
    w.tick()
    expect(obsAt(w, 2, 0, 0), '前提: オブザーバーが点灯していない').toMatchObject({ powered: true })

    // **点灯している隙に**押し出す
    w.activateBlock(0, 0, 0)
    let movedWhilePowered = false
    for (let i = 0; i < 4; i++) {
      w.tick()
      if (w.getBlock(2, 0, 0)?.type === 'moving_piston') movedWhilePowered = true
    }
    expect(movedWhilePowered, '前提: 点灯中に動かせていない').toBe(true)

    ticks(w, 20)

    // 着地先 (3,0,0) のオブザーバーは消灯していること
    const landed = obsAt(w, 3, 0, 0)
    expect(landed?.type, 'オブザーバーが着地していない').toBe('observer')
    expect(landed, '**点灯したまま固まっている**').toMatchObject({ powered: false })
  })
})
