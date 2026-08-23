import { describe, it, expect } from 'vitest'
import { mcToSim } from '@redstone/sim'
import { describeImportedBlock } from './EditorPage'

/**
 * 選択中のブロックが**取り込んだ元のブロック**だと分かること (#356)。
 *
 * パレットは「置ける種類」の選択肢なので、黒曜石を選んでも「石」が光るだけ。
 * 3D の見た目 (#343 / #351) が元どおりになっても、名前は画面のどこにも出ていなかった。
 */
describe('取り込んだブロックの表示 (#356)', () => {
  it.each([
    ['obsidian', 'obsidian'],
    ['chest', 'chest'],
    ['lime_shulker_box', 'lime_shulker_box'],
    ['spruce_door', 'spruce_door'],
  ])('%s → %s', (id, want) => {
    expect(describeImportedBlock(mcToSim(id))).toBe(want)
  })

  it('見た目プロパティも併せて出す', () => {
    expect(describeImportedBlock(mcToSim('oak_log[axis=x]'))).toBe('oak_log[axis=x]')
    expect(describeImportedBlock(mcToSim('oak_slab[type=double,waterlogged=false]')))
      .toBe('oak_slab[type=double]')
  })

  it('**パレットから置いたものには何も出さない** (名前を持たないため)', () => {
    expect(describeImportedBlock({ type: 'solid', powered: false })).toBeNull()
    expect(describeImportedBlock({ type: 'wire', connections: {
      north: false, east: false, south: false, west: false }, power: 0 })).toBeNull()
  })

  it('空セルでも落ちない', () => {
    expect(describeImportedBlock(null)).toBeNull()
    expect(describeImportedBlock(undefined)).toBeNull()
  })
})
