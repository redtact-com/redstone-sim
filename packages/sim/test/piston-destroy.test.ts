import { describe, it, expect } from 'vitest'
import { SimWorld } from '../src/world.js'
import type { BlockState, WireConnections } from '../src/types.js'

// ============================================================
// ピストンによる破壊 (PUSH_DESTROY) — アイテム化なしの消滅 (#64、13 §4.1)
// [確定: 26.2 PistonStructureResolver] 破壊はチェーン終端の 1 ブロックで、
// push limit 12 にはカウントされない。retract に破壊は無い。
// 実機系列は fixture destroy-push-dust / destroy-push-torch が正。
// ============================================================

function wire(conn: Partial<WireConnections> = {}): BlockState {
  return {
    type: 'wire',
    connections: { north: false, south: false, east: false, west: false, ...conn },
    power: 0,
  }
}
const solid = (): BlockState => ({ type: 'solid', powered: false })
const lever = (powered = false): BlockState => ({ type: 'lever', facing: 'up', powered })

function ticks(w: SimWorld, n: number): void {
  for (let i = 0; i < n; i++) w.tick()
}

describe('ピストン破壊: チェーン終端の PUSH_DESTROY (#64)', () => {
  it('押し先のダストを破壊して伸長する (直接)', () => {
    const w = new SimWorld()
    w.setBlock(0, 0, 0, lever(false))
    w.setBlock(1, 0, 0, { type: 'piston', facing: 'east', extended: false })
    w.setBlock(2, 0, 0, wire())
    w.initialize()

    w.activateBlock(0, 0, 0)
    ticks(w, 6)

    expect(w.getBlock(1, 0, 0)).toMatchObject({ type: 'piston', extended: true })
    expect(w.getBlock(2, 0, 0)).toMatchObject({ type: 'piston_head' })
    expect(w.getBlock(3, 0, 0)).toBeNull()   // ダストは押し出されず消滅 (アイテム化なし)
  })

  it('石の先のダストを破壊し、石が跡地へ移動する', () => {
    const w = new SimWorld()
    w.setBlock(0, 0, 0, lever(false))
    w.setBlock(1, 0, 0, { type: 'piston', facing: 'east', extended: false })
    w.setBlock(2, 0, 0, solid())
    w.setBlock(3, 0, 0, wire())
    w.initialize()

    w.activateBlock(0, 0, 0)
    ticks(w, 6)

    expect(w.getBlock(2, 0, 0)).toMatchObject({ type: 'piston_head' })
    expect(w.getBlock(3, 0, 0)).toMatchObject({ type: 'solid' })   // 石が破壊跡へ
    expect(w.getBlock(4, 0, 0)).toBeNull()
  })

  it('破壊対象は push limit 12 にカウントされない (石 12 + ダストは押せる)', () => {
    const w = new SimWorld()
    w.setBlock(0, 0, 0, lever(false))
    w.setBlock(1, 0, 0, { type: 'piston', facing: 'east', extended: false })
    for (let x = 2; x <= 13; x++) w.setBlock(x, 0, 0, solid())   // 石 12 個
    w.setBlock(14, 0, 0, wire())                                  // 13 個目 = 破壊対象
    w.initialize()

    w.activateBlock(0, 0, 0)
    ticks(w, 6)

    expect(w.getBlock(1, 0, 0)).toMatchObject({ type: 'piston', extended: true })
    expect(w.getBlock(14, 0, 0)).toMatchObject({ type: 'solid' })  // 12 個目の石が跡地へ
  })

  it('石 13 個は破壊対象がいても押せない (12 制限は toPush のみ)', () => {
    const w = new SimWorld()
    w.setBlock(0, 0, 0, lever(false))
    w.setBlock(1, 0, 0, { type: 'piston', facing: 'east', extended: false })
    for (let x = 2; x <= 14; x++) w.setBlock(x, 0, 0, solid())   // 石 13 個
    w.setBlock(15, 0, 0, wire())
    w.initialize()

    w.activateBlock(0, 0, 0)
    ticks(w, 6)

    expect(w.getBlock(1, 0, 0)).toMatchObject({ type: 'piston', extended: false })
    expect(w.getBlock(15, 0, 0)).toMatchObject({ type: 'wire' })  // 破壊されない
  })

  it('信号源トーチの破壊で下流の回路が消灯する', () => {
    const w = new SimWorld()
    w.setBlock(0, 0, 0, lever(false))
    w.setBlock(1, 0, 0, { type: 'piston', facing: 'east', extended: false })
    w.setBlock(2, 0, 0, { type: 'torch', facing: 'up', lit: true })
    w.setBlock(3, 0, 0, wire({ east: true, west: true }))
    w.setBlock(4, 0, 0, { type: 'lamp', lit: false })
    w.initialize()
    ticks(w, 4)
    expect(w.getBlock(4, 0, 0)).toMatchObject({ type: 'lamp', lit: true })

    w.activateBlock(0, 0, 0)
    ticks(w, 10)

    expect(w.getBlock(2, 0, 0)).toMatchObject({ type: 'piston_head' })
    expect(w.getBlock(3, 0, 0)).toMatchObject({ type: 'wire', power: 0 })
    expect(w.getBlock(4, 0, 0)).toMatchObject({ type: 'lamp', lit: false })
  })

  it('retract は PUSH_DESTROY を引かず破壊もしない (置き去り)', () => {
    const w = new SimWorld()
    w.setBlock(0, 0, 0, lever(false))
    w.setBlock(1, 0, 0, { type: 'sticky_piston', facing: 'east', extended: false })
    w.setBlock(3, 0, 0, wire())    // head の 1 個先 (伸長時は head が (2) に来る)
    w.initialize()

    w.activateBlock(0, 0, 0)   // ON: (2) は空きなので破壊なしで伸長
    ticks(w, 6)
    expect(w.getBlock(2, 0, 0)).toMatchObject({ type: 'piston_head' })
    expect(w.getBlock(3, 0, 0)).toMatchObject({ type: 'wire' })

    w.activateBlock(0, 0, 0)   // OFF: sticky だが wire は引かない・壊さない
    ticks(w, 6)
    expect(w.getBlock(1, 0, 0)).toMatchObject({ type: 'sticky_piston', extended: false })
    expect(w.getBlock(2, 0, 0)).toBeNull()
    expect(w.getBlock(3, 0, 0)).toMatchObject({ type: 'wire' })
  })
})
