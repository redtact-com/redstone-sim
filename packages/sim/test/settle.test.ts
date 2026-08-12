import { describe, it, expect } from 'vitest'
import { SimWorld } from '../src/world'
import type { BlockState } from '../src/types'

/**
 * #113 settle / isQuiescent。
 *
 * flush() は「予約 tick が尽きた瞬間」に止まる。ところがピストンの押し出しは
 * tile tick ではなく BlockEntity 相 (moving_piston の finalizeDue) で進むため、
 * レバーを入れた直後は「予約ゼロ・押し出し未着手」という状態が存在する。
 * flush はそこで返ってしまい、押し出しが永久に起きない。
 */

const solid = (): BlockState => ({ type: 'solid', powered: false })

/** レバー → ダスト → ピストン → 押される固体 */
function pistonWorld(): SimWorld {
  const w = new SimWorld()
  for (let x = -1; x <= 4; x++) w.setBlockAt([x, -1, 0], solid())
  w.setBlockAt([-1, 0, 0], { type: 'lever', facing: 'up', powered: false } as BlockState)
  w.setBlockAt([0, 0, 0], { type: 'wire', connections: { north: false, south: false, east: true, west: true }, power: 0 } as BlockState)
  w.setBlockAt([1, 0, 0], { type: 'piston', facing: 'east', extended: false } as BlockState)
  w.setBlockAt([2, 0, 0], solid())
  w.initialize()
  return w
}

const hasMoving = (w: SimWorld): boolean =>
  [...w.snapshot().blocks.values()].some(b => b.type === 'moving_piston')

describe('#113 isQuiescent / settle', () => {
  it('何も起きていない世界は静止している', () => {
    const w = new SimWorld()
    w.setBlockAt([0, -1, 0], solid())
    w.initialize()
    expect(w.isQuiescent()).toBe(true)
  })

  it('flush は押し出しを取りこぼす (この API を足した理由)', () => {
    const w = pistonWorld()
    w.activateBlock(-1, 0, 0)
    w.flush(64)
    // 予約 tick はゼロなので flush は即座に返る。ピストンは伸びていない
    expect(w.getScheduledTicks()).toHaveLength(0)
    expect(w.getBlockAt([1, 0, 0])).toMatchObject({ type: 'piston', extended: false })
    expect(w.isQuiescent()).toBe(false)
  })

  it('settle なら押し出しが確定する', () => {
    const w = pistonWorld()
    w.activateBlock(-1, 0, 0)
    const r = w.settle(64)
    expect(r.quiescent).toBe(true)
    expect(w.getBlockAt([1, 0, 0])).toMatchObject({ type: 'piston', extended: true })
    expect(w.getBlockAt([2, 0, 0])).toMatchObject({ type: 'piston_head' })
    expect(w.getBlockAt([3, 0, 0])).toMatchObject({ type: 'solid' })
  })

  it('押し出し途中は静止していない (moving_piston を見ている)', () => {
    const w = pistonWorld()
    w.activateBlock(-1, 0, 0)
    w.tick()
    expect(hasMoving(w)).toBe(true)
    expect(w.isQuiescent()).toBe(false)
  })

  it('maxTicks で打ち切ると未確定のまま quiescent=false を返す', () => {
    const w = pistonWorld()
    w.activateBlock(-1, 0, 0)
    const r = w.settle(2)
    expect(r.ticks).toBe(2)
    expect(r.quiescent).toBe(false)
    // 続きを回せば確定する
    expect(w.settle(64).quiescent).toBe(true)
    expect(hasMoving(w)).toBe(false)
  })

  it('quietTicks で「静止が続くこと」を要求できる', () => {
    const w = pistonWorld()
    w.activateBlock(-1, 0, 0)
    const r = w.settle(64, 4)
    expect(r.quiescent).toBe(true)
    expect(w.isQuiescent()).toBe(true)
  })

  it('静止済みの世界に settle しても tick を進めない', () => {
    const w = pistonWorld()
    w.activateBlock(-1, 0, 0)
    w.settle(64)
    expect(w.settle(64)).toEqual({ ticks: 0, quiescent: true })
  })
})
