import { describe, it, expect } from 'vitest'
import { SimWorld } from '../src/world.js'
import type { BlockState } from '../src/types.js'

/**
 * ピストンで動いたブロックの**着地は近隣更新を伴う** (#213)。
 *
 * vanilla の `PistonMovingBlockEntity.finalTick` は
 * `Level.setBlock(pos, state, UPDATE_ALL)` で置くので隣接 6 マスへ NC が飛ぶ。
 *
 * これが無いと「**移動中 (moving_piston) だったせいで押せなかったピストンが、
 * 着地後も再評価されず伸びないまま**」になる。ピストンは NC を受けたときしか
 * 再判定しない (BUD の根拠) ので、着地が更新を出さないと二度と機会が来ない。
 *
 * 実ファイル (Runa.S の 2 幅ピストンドア) で発現していた。tick 単位の回帰は
 * 実機 fixture `door-2wide-open-to-close` が守る (この修正で不一致 66 tick → 3 tick)。
 */

const tick = (w: SimWorld, n: number): void => { for (let i = 0; i < n; i++) w.tick() }
const at = (w: SimWorld, x: number, y: number, z: number) => w.getBlock(x, y, z)

describe('着地は近隣更新を出す (#213)', () => {
  /**
   * 横押しの moving_piston が縦ピストンの押し先を塞いでいる隙に縦を受電させ、
   * 着地後に再評価されるかを見る。
   */
  it('移動中で押せなかったピストンが、着地後に再評価されて伸びる', () => {
    const w = new SimWorld()
    // 横押し: レバー(0,0,0) → ピストン(1,0,0,east) → 石(2,0,0) を (3,0,0) へ
    w.setBlockAt([0, 0, 0], { type: 'lever', facing: 'up', powered: false } as BlockState)
    w.setBlockAt([1, 0, 0], { type: 'piston', facing: 'east', extended: false } as BlockState)
    w.setBlockAt([2, 0, 0], { type: 'solid', powered: false } as BlockState)
    // 縦押し: (3,-1,0) が (3,0,0) を上へ押す。電源は最初 OFF
    w.setBlockAt([3, -1, 0], { type: 'sticky_piston', facing: 'up', extended: false } as BlockState)
    w.setBlockAt([4, -1, 0], { type: 'lever', facing: 'up', powered: false } as BlockState)
    w.initialize()
    w.flush(64)
    expect(at(w, 3, -1, 0)).toMatchObject({ type: 'sticky_piston', extended: false })

    // 横押しを起動
    w.activateBlock(0, 0, 0)
    // 押し先が moving_piston になっている隙に縦を受電させる
    let poweredWhileMoving = false
    for (let i = 0; i < 6; i++) {
      w.tick()
      if (!poweredWhileMoving && at(w, 3, 0, 0)?.type === 'moving_piston') {
        w.activateBlock(4, -1, 0)
        poweredWhileMoving = true
      }
    }
    expect(poweredWhileMoving, '移動中の隙を捉えられていない (前提が崩れている)').toBe(true)

    tick(w, 12)

    // 着地の NC で縦ピストンが再評価され、石を上へ押し上げている
    expect(at(w, 3, -1, 0), '着地後に再評価されていない').toMatchObject({
      type: 'sticky_piston', extended: true,
    })
    expect(at(w, 3, 1, 0), '石が押し上がっていない').toMatchObject({ type: 'solid' })
  })
})
