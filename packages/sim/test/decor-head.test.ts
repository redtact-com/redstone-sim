import { describe, it, expect } from 'vitest'
import { isDecorBlockName, classifyPlainBlock } from '../src/blocks/blockNames.js'

describe('頭・頭蓋は装飾ブロック (#290)', () => {
  // Runa.S の 5x5 扉に飾りの player_wall_head が入っており、
  // 未対応のままだと実機との突き合わせが「sim が扱えないブロック」で始まらない
  it.each([
    'player_head', 'player_wall_head', 'zombie_head', 'zombie_wall_head',
    'creeper_head', 'piglin_wall_head', 'dragon_head',
    'skeleton_skull', 'skeleton_wall_skull', 'wither_skeleton_skull',
  ])('%s は装飾', name => {
    expect(isDecorBlockName(name)).toBe(true)
    expect(classifyPlainBlock(`minecraft:${name}`)?.type).toBe('decor')
  })

  it('piston_head は名前が _head で終わるが装飾ではない', () => {
    expect(isDecorBlockName('piston_head')).toBe(false)
    expect(isDecorBlockName('minecraft:piston_head')).toBe(false)
  })

  it('取り込み元の blockstate を保つ (向きで描き分けるため)', () => {
    const b = classifyPlainBlock('minecraft:player_wall_head',
      { facing: 'north', powered: 'false' })
    expect(b).toEqual({ type: 'decor', name: 'player_wall_head[facing=north,powered=false]' })
  })
})

describe('ガラス板・鉄格子は接続を持つ pane 型 (#303)', () => {
  // Runa.S_closed が light_blue_stained_glass_pane を 9 枚使っており、
  // **接続の blockstate が隣の出入りで変わるのを真下のオブザーバーが検知**して
  // ピストンの収縮を打ち消している。装飾に潰すと扉が 1 回しか動かない
  it.each(['glass_pane', 'light_blue_stained_glass_pane', 'black_stained_glass_pane', 'iron_bars'])(
    '%s は pane 型 (装飾ではない)', name => {
      expect(isDecorBlockName(name)).toBe(false)
      expect(classifyPlainBlock(`minecraft:${name}`)?.type).toBe('pane')
    })

  it('材質を name に、接続を bool で持つ', () => {
    expect(classifyPlainBlock('minecraft:light_blue_stained_glass_pane',
      { east: 'true', north: 'false', south: 'true', waterlogged: 'false', west: 'false' }))
      .toEqual({
        type: 'pane', name: 'light_blue_stained_glass_pane',
        north: false, east: true, south: true, west: false, waterlogged: false,
      })
  })
})
