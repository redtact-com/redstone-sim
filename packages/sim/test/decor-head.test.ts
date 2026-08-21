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
