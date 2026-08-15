import { describe, it, expect } from 'vitest'
import { CircuitEditor } from '../src/editor'
import {
  PLACEABLE_TYPES, isPlaceableType, PLACE_OPTION_RANGES, maxCount, normalizePlaceOptions,
} from '../src/placeable'

/** #115 実行時に列挙・検証できるようにする (下流の手写しスキーマを消すため) */
describe('#115 PLACEABLE_TYPES / normalizePlaceOptions', () => {
  it('列挙したすべての型が実際に配置できる (表と実装のドリフト検知)', () => {
    for (const type of PLACEABLE_TYPES) {
      const ed = new CircuitEditor(0)
      ed.placeBlock(0, 0, type, {})
      expect(ed.getBlock(0, 0), `${type} が置けない`).toMatchObject({ type })
    }
  })

  it('isPlaceableType は未知の値を弾く', () => {
    expect(isPlaceableType('wire')).toBe(true)
    expect(isPlaceableType('air')).toBe(false)
    expect(isPlaceableType('piston_head')).toBe(false)   // sim 管理で editor からは置けない
    expect(isPlaceableType('unknown_block')).toBe(false)
    expect(isPlaceableType(42)).toBe(false)
    expect(isPlaceableType(undefined)).toBe(false)
  })

  it('型が持たないオプションは落とす', () => {
    expect(normalizePlaceOptions('wire', { delay: 3, signal: 5, count: 9 })).toEqual({})
    expect(normalizePlaceOptions('repeater', { signal: 5 })).toEqual({ facing: 'north' })
  })

  it('数値は範囲へ丸める', () => {
    expect(normalizePlaceOptions('repeater', { delay: 99 as never }).delay).toBe(4)
    expect(normalizePlaceOptions('repeater', { delay: 0 as never }).delay).toBe(1)
    expect(normalizePlaceOptions('weighted_pressure_plate_light', { pressedPower: 999 }).pressedPower).toBe(15)
    expect(normalizePlaceOptions('weighted_pressure_plate_light', { pressedPower: -5 }).pressedPower).toBe(1)
    expect(normalizePlaceOptions('container', { signal: 42 }).signal).toBe(15)
    expect(normalizePlaceOptions('container', { signal: -1 }).signal).toBe(0)
  })

  it('個数は容量で頭打ちになる', () => {
    expect(maxCount('hopper')).toBe(320)
    expect(maxCount('dropper')).toBe(576)
    expect(maxCount('container')).toBe(1728)
    expect(maxCount('wire')).toBe(0)
    expect(normalizePlaceOptions('hopper', { count: 99999 }).count).toBe(320)
    expect(normalizePlaceOptions('dropper', { count: -3 }).count).toBe(0)
  })

  it('NaN / 文字列などの壊れた値は無視する', () => {
    expect(normalizePlaceOptions('repeater', { delay: NaN as never }).delay).toBeUndefined()
    expect(normalizePlaceOptions('container', { signal: '5' as never }).signal).toBeUndefined()
  })

  it('範囲表は 1 か所だけを見る', () => {
    expect(PLACE_OPTION_RANGES.delay).toEqual({ min: 1, max: 4 })
    expect(PLACE_OPTION_RANGES.pressedPower).toEqual({ min: 1, max: 15 })
    expect(PLACE_OPTION_RANGES.signal).toEqual({ min: 0, max: 15 })
  })

  it('壊れたオプションで配置しても BlockState が壊れない', () => {
    const ed = new CircuitEditor(0)
    ed.placeBlock(1, 1, 'repeater', { delay: 42 as never, facing: 'up' })
    expect(ed.getBlock(1, 1)).toMatchObject({ type: 'repeater', delay: 4, facing: 'north' })
  })
})
