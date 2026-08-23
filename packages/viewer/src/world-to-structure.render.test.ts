import { describe, it, expect } from 'vitest'
import { mcToSim } from '@redstone/sim'
import type { BlockState } from '@redstone/sim'
import {
  blockStateToMinecraftStr, containerBlockStr,
  extraPreloadNames, VIEWER_PRELOAD_BLOCKS,
} from './world-to-structure.js'

/**
 * **取り込んだ元のブロックで描く** (#343)。
 *
 * ここが落ちる = 3D で別のブロックに見えるか、**何も描かれず消える**。
 * 消える方は例外にならないので、テストでしか捕まえられない
 * (実際 pane は名前を持ちながらプリロードから漏れて透明になっていた)。
 */

const snapshotOf = (names: string[]) => ({
  blocks: new Map(names.map((n, i) => [`${i},0,0`, mcToSim(n)!] as [string, BlockState])),
})

describe('コンテナは元のブロックで描く (#343)', () => {
  it.each([
    ['barrel', 'minecraft:barrel[facing=up,open=false]'],
    ['chest', 'minecraft:chest'],
    ['trapped_chest', 'minecraft:trapped_chest'],
    ['white_shulker_box', 'minecraft:white_shulker_box'],
    ['lime_shulker_box', 'minecraft:lime_shulker_box'],
  ])('%s → %s', (name, want) => {
    expect(blockStateToMinecraftStr(mcToSim(name)!)).toBe(want)
  })

  it('**無染色のシュルカーは紫へ寄せる** (deepslate に renderer が無く消えるため)', () => {
    expect(blockStateToMinecraftStr(mcToSim('shulker_box')!))
      .toBe('minecraft:purple_shulker_box')
  })

  it('名前を持たない (パレット配置の) コンテナは従来どおり', () => {
    expect(containerBlockStr(undefined, true)).toBe('minecraft:barrel[facing=up,open=false]')
    expect(containerBlockStr(undefined, false)).toBe('minecraft:chest')
  })
})

describe('プリロードは名前を持つ型すべてを拾う (#234 → #343)', () => {
  it('ガラス板・鉄格子が拾われる (以前は decor 限定で漏れて透明になっていた)', () => {
    const extra = extraPreloadNames(snapshotOf(['glass_pane', 'iron_bars', 'light_blue_stained_glass_pane']))
    expect(extra).toEqual([
      'minecraft:glass_pane', 'minecraft:iron_bars', 'minecraft:light_blue_stained_glass_pane',
    ])
  })

  it('チェスト・シュルカーも拾われる', () => {
    const extra = extraPreloadNames(snapshotOf(['chest', 'trapped_chest', 'lime_shulker_box']))
    expect(extra).toContain('minecraft:chest')
    expect(extra).toContain('minecraft:trapped_chest')
    expect(extra).toContain('minecraft:lime_shulker_box')
  })

  it('固定表にある名前は二重に載せない', () => {
    expect(extraPreloadNames(snapshotOf(['stone', 'redstone_wire']))).toEqual([])
  })

  it('**描く名前は必ず固定表か extra のどちらかに載る**', () => {
    // 名前を持つ型を混ぜた盤面。どれか 1 つでも漏れると 3D から静かに消える
    const names = [
      'stone', 'chest', 'trapped_chest', 'barrel', 'shulker_box', 'lime_shulker_box',
      'glass_pane', 'iron_bars', 'oak_stairs', 'lectern', 'stone_brick_wall',
    ]
    const snap = snapshotOf(names)
    const covered = new Set([...VIEWER_PRELOAD_BLOCKS, ...extraPreloadNames(snap)])
    const missing: string[] = []
    for (const b of snap.blocks.values()) {
      const drawn = blockStateToMinecraftStr(b).split('[')[0]
      if (!covered.has(drawn)) missing.push(drawn)
    }
    expect(missing, 'プリロードされない名前は 3D から消える').toEqual([])
  })
})
