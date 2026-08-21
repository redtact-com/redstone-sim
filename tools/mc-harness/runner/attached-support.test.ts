import { describe, it, expect } from 'vitest'
import { attachedSupportPos } from './capture.js'

describe('貼り付き電源の支えブロック (#290)', () => {
  // /setblock はレバー自身の隣にしか更新を配らないので、
  // 支えブロックの隣へ update() を撃ち直す必要がある。その支え位置の算出
  it('face=floor は真下', () => {
    expect(attachedSupportPos([4, 1, 0], 'lever[face=floor,facing=north,powered=true]'))
      .toEqual([4, 0, 0])
  })

  it('face=ceiling は真上', () => {
    expect(attachedSupportPos([4, 1, 0], 'lever[face=ceiling,facing=north,powered=true]'))
      .toEqual([4, 2, 0])
  })

  it.each([
    ['north', [4, 1, 1]], ['south', [4, 1, -1]], ['east', [3, 1, 0]], ['west', [5, 1, 0]],
  ] as const)('face=wall facing=%s は facing の逆側', (facing, want) => {
    expect(attachedSupportPos([4, 1, 0], `lever[face=wall,facing=${facing},powered=true]`))
      .toEqual(want)
  })

  it('ボタンも同じ', () => {
    expect(attachedSupportPos([1, 2, 3], 'minecraft:stone_button[face=wall,facing=east,powered=true]'))
      .toEqual([0, 2, 3])
  })

  it('レバー・ボタン以外は対象外', () => {
    expect(attachedSupportPos([1, 2, 3], 'minecraft:redstone_block')).toBeNull()
    expect(attachedSupportPos([1, 2, 3], 'minecraft:piston[facing=up,extended=false]')).toBeNull()
  })
})
