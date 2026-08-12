import { describe, it, expect } from 'vitest'
import { CircuitEditor } from '../src/editor'
import { SimSession } from '../src/session'

/** #113 SimSession — 「world を組む → initialize → 落ち着くまで進める」を 1 か所に */
function pistonEditor(): CircuitEditor {
  const ed = new CircuitEditor(0)
  ed.placeBlock(0, 0, 'lever', { facing: 'up' })
  ed.placeBlock(1, 0, 'wire')
  ed.placeBlock(2, 0, 'piston', { facing: 'east' })
  ed.placeBlock(3, 0, 'solid')
  return ed
}

describe('#113 SimSession', () => {
  it('エディタの配置から world を組んで initialize まで済ませる', () => {
    const s = new SimSession(pistonEditor())
    expect(s.world.getBlockAt([0, 0, 0])).toMatchObject({ type: 'lever' })
    expect(s.quiescent).toBe(true)
  })

  it('レバーの初期状態を上書きできる (真理値表の 1 行を組む)', () => {
    const s = new SimSession(pistonEditor(), { leverStates: new Map([['0,0,0', true]]) })
    expect(s.world.getBlockAt([0, 0, 0])).toMatchObject({ type: 'lever', powered: true })
    // ON で initialize したので既にダストへ給電されている
    expect(s.world.getBlockAt([1, 0, 0])).toMatchObject({ power: 15 })
  })

  it('settle は押し出しを確定させる (flush 相当では止まってしまう箇所)', () => {
    const s = new SimSession(pistonEditor())
    s.activate(0, 0, 0)
    const r = s.settle(64)
    expect(r.quiescent).toBe(true)
    expect(s.world.getBlockAt([2, 0, 0])).toMatchObject({ type: 'piston', extended: true })
    expect(s.world.getBlockAt([3, 0, 0])).toMatchObject({ type: 'piston_head' })
  })

  it('step で 1 tick ずつ進められ、途中は active', () => {
    const s = new SimSession(pistonEditor())
    s.activate(0, 0, 0)
    s.step()
    expect(s.active).toBe(true)
    s.settle(64)
    expect(s.active).toBe(false)
  })
})
