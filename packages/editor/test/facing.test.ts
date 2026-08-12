import { describe, it, expect } from 'vitest'
import { CircuitEditor } from '../src/editor'
import { allowedFacings, isFacingAllowed, defaultFacing } from '../src/facing'

/** #111 レバー/ボタンの Dir6 配置。sim は元から Dir6 対応で、詰まっていたのは editor 側 */
describe('#111 取付面つきの配置', () => {
  const dirs = ['up', 'down', 'north', 'south', 'east', 'west'] as const

  it.each(dirs)('レバーを facing=%s で置ける', dir => {
    const ed = new CircuitEditor(0)
    ed.placeBlock(1, 1, 'lever', { facing: dir })
    expect(ed.getBlock(1, 1)).toMatchObject({ type: 'lever', facing: dir })
  })

  it.each(dirs)('石ボタンを facing=%s で置ける', dir => {
    const ed = new CircuitEditor(0)
    ed.placeBlock(2, 2, 'button_stone', { facing: dir })
    expect(ed.getBlock(2, 2)).toMatchObject({ type: 'button_stone', facing: dir })
  })

  it('facing 未指定のレバー/ボタンは従来どおり床置き (up)', () => {
    const ed = new CircuitEditor(0)
    ed.placeBlock(0, 0, 'lever', {})
    ed.placeBlock(1, 0, 'button_wood', {})
    expect(ed.getBlock(0, 0)).toMatchObject({ facing: 'up' })
    expect(ed.getBlock(1, 0)).toMatchObject({ facing: 'up' })
  })

  it('水平しか取れない素子に up を渡しても水平へ落ちる (無出力の素子を作らない)', () => {
    const ed = new CircuitEditor(0)
    ed.placeBlock(3, 3, 'repeater', { facing: 'up' })
    expect(ed.getBlock(3, 3)).toMatchObject({ type: 'repeater', facing: 'north' })
  })

  it('ホッパーは up を取らない', () => {
    const ed = new CircuitEditor(0)
    ed.placeBlock(4, 4, 'hopper', { facing: 'up' })
    expect(ed.getBlock(4, 4)).toMatchObject({ type: 'hopper', facing: 'down' })
  })

  it('rotateBlock でレバーの取付面を変えられる', () => {
    const ed = new CircuitEditor(0)
    ed.placeBlock(5, 5, 'lever', { facing: 'up' })
    ed.rotateBlock(5, 5, 'east')
    expect(ed.getBlock(5, 5)).toMatchObject({ type: 'lever', facing: 'east' })
  })

  it('rotateBlock は素子が取れない向きを無視する (リピーターに up)', () => {
    const ed = new CircuitEditor(0)
    ed.placeBlock(6, 6, 'repeater', { facing: 'east' })
    ed.rotateBlock(6, 6, 'up')
    expect(ed.getBlock(6, 6)).toMatchObject({ type: 'repeater', facing: 'east' })
  })

  it('許容向きの表', () => {
    expect(allowedFacings('lever')).toHaveLength(6)
    expect(allowedFacings('repeater')).toEqual(['north', 'east', 'south', 'west'])
    expect(allowedFacings('hopper')).not.toContain('up')
    expect(allowedFacings('torch')).toEqual(['up'])
    expect(allowedFacings('wire')).toEqual([])
    expect(isFacingAllowed('comparator', 'down')).toBe(false)
    expect(defaultFacing('button_stone')).toBe('up')
  })
})
