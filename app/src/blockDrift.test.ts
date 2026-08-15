import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { TRIGGERABLE_TYPES } from '@redstone/sim'
import { PLACEABLE_TYPES, CircuitEditor } from '@redstone/editor'
import { blockStateToMinecraftStr, VIEWER_PRELOAD_BLOCKS } from '@redstone/viewer'
import { BLOCK_PALETTE, TRIGGER_META } from './palette'

/**
 * 新しいブロック種を足したときの「どこかのリストへの入れ忘れ」を検知する (#153)。
 *
 * 発端は #146 の detector_rail で、sim のロジックもテストも fixture も通っているのに
 * `TRIGGER_META` への追加を落として **ブラウザで置けるのに通電させられない** 状態を
 * 出したこと。これらのリストは `Record<string, ...>` や素の配列なので型で守られず、
 * 追加漏れが静かに起きる。
 *
 * 型で守られる部分 (BlockState union を広げるとビルドが壊れる) は sim 側の
 * `Record<BlockType, boolean>` が担当し、ここは**型が届かない UI 側のリスト**を見る。
 */

const sorted = (xs: readonly string[]): string[] => [...xs].sort()

describe('ブロック定義のドリフト検知 (#153)', () => {
  it('トリガパネルの一覧は sim の手動トリガ対象と一致する', () => {
    // ここが落ちたら、activateBlock で反応する素子なのに UI から触れない (逆も同じ)
    expect(sorted(Object.keys(TRIGGER_META))).toEqual(sorted(TRIGGERABLE_TYPES))
  })

  it('パレットは配置可能なブロック種を過不足なく載せている', () => {
    // move / eraser はブロックではなくツールなので除く
    const paletteBlocks = BLOCK_PALETTE
      .map(b => b.type)
      .filter(t => t !== 'move' && t !== 'eraser')
    expect(sorted(paletteBlocks)).toEqual(sorted(PLACEABLE_TYPES))
  })

  it('配置できるブロックはすべてビューアのプリロード対象になっている', () => {
    // 漏れると 3D で紫黒 (未解決テクスチャ) になる。型では守られない
    const editor = new CircuitEditor(0)
    const missing: string[] = []
    for (const type of PLACEABLE_TYPES) {
      editor.placeBlock(0, 0, type)
      const block = editor.getBlock(0, 0)
      if (!block) continue          // piston_head 等の内部専用型は配置されない
      const name = blockStateToMinecraftStr(block).split('[')[0]
      if (!VIEWER_PRELOAD_BLOCKS.includes(name)) missing.push(`${type} → ${name}`)
    }
    expect(missing, 'VIEWER_PRELOAD_BLOCKS への追加漏れ').toEqual([])
  })

  it('パレットのラベルとテクスチャが空でない', () => {
    for (const meta of BLOCK_PALETTE) {
      expect(meta.label, `${meta.type} のラベル`).not.toBe('')
      // texture=null は専用アイコン (move / eraser / wire 以外は原則テクスチャを持つ)
      if (meta.type !== 'move' && meta.type !== 'eraser') {
        expect(meta.texture, `${meta.type} のテクスチャ`).not.toBeNull()
      }
    }
  })
})

/**
 * 盤面サイズの定数は EditorPage と EmbedPage に**同じものが 2 つ**ある (#179)。
 * どちらもモジュール私有で export していないため、型でもインポートでも守られない。
 * 片方だけ変えると「エディタでは置けるのに埋め込みでは切り落とされる」がテスト全緑で通る。
 */
describe('盤面サイズ定数のドリフト検知 (#179)', () => {
  const constOf = (file: string, name: string): number => {
    const src = readFileSync(new URL(file, import.meta.url), 'utf8')
    const m = src.match(new RegExp(`const ${name} = (\\d+)`))
    if (!m) throw new Error(`${file} に ${name} の定義が見つからない`)
    return Number(m[1])
  }

  it.each(['GRID_W', 'GRID_H', 'GRID_LAYERS'])('%s が EditorPage と EmbedPage で一致する', (name) => {
    expect(constOf('./EmbedPage.tsx', name)).toBe(constOf('./EditorPage.tsx', name))
  })

  it('高さは実回路が入る段数を確保している', () => {
    // 8 段だった頃、配布回路 (12 段) が取り込み時に 34% 切り落とされていた (#179)
    expect(constOf('./EditorPage.tsx', 'GRID_LAYERS')).toBeGreaterThanOrEqual(12)
  })
})
