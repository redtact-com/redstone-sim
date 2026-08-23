import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { ALL_BLOCK_TYPES, TRIGGERABLE_TYPES } from '@redstone/sim'
import { PLACEABLE_TYPES, CircuitEditor, DEFAULT_BOARD, BOARD_MAX } from '@redstone/editor'
import { blockStateToMinecraftStr, VIEWER_PRELOAD_BLOCKS, extraPreloadNames } from '@redstone/viewer'
import { exportToNbtBytes, importFromNbtBytes } from './nbtIO'
import { classifyPlainBlock, mcToSim } from '@redstone/sim'
import type { BlockState } from '@redstone/sim'
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

/**
 * 往復 (取り込み → 書き出し → 取り込み) を確かめる代表名。
 * **新しいブロック種を足したらここにも 1 つ足す** — 下の網羅チェックが落ちて気づける。
 */
const ROUND_TRIP_NAMES = [
  'stone', 'glass', 'redstone_wire', 'repeater', 'comparator', 'redstone_torch',
  'lever', 'redstone_lamp', 'note_block', 'observer', 'piston', 'sticky_piston',
  'hopper', 'dropper', 'barrel', 'target', 'redstone_block', 'slime_block',
  // #234 以降に足した型
  'stone_brick_wall', 'bubble_column', 'soul_sand', 'water', 'lodestone',
  'water_cauldron', 'composter', 'lectern', 'oak_stairs',
  // #303 以降に足した型
  'light_blue_stained_glass_pane',
  // 網羅チェック (下) を満たすための代表名
  'stone_button', 'oak_button', 'stone_pressure_plate', 'oak_pressure_plate',
  'light_weighted_pressure_plate', 'heavy_weighted_pressure_plate',
  'oak_door', 'iron_door', 'oak_trapdoor', 'iron_trapdoor', 'oak_fence_gate',
  'rail', 'powered_rail', 'detector_rail', 'activator_rail',
  'dispenser', 'crafter', 'chest', 'honey_block', 'waxed_copper_bulb',
  'smooth_stone_slab', 'redstone_wall_torch[facing=north]',
  // #324 以降に足した名前。**コンテナは名前で往復する** — fullCube から
  // 樽 / チェストを選び直していた頃はシュルカーが樽に、トラップチェストがチェストに化けた
  'shulker_box', 'white_shulker_box', 'trapped_chest',
  // #343 以降。**代表名ではない素材**を並べる。ここが代表名だけだと
  // 「名前を捨てる実装」でもテストが緑のまま通ってしまう
  'obsidian', 'black_wool', 'oak_planks', 'red_concrete', 'gray_glazed_terracotta',
  'glowstone', 'sea_lantern', 'light_blue_stained_glass',
  'oak_slab', 'cobblestone_wall',
  // #346 以降。樹種・酸化段階。**実機側の変換器が例外を投げていた名前**も混ぜる
  'spruce_door', 'copper_door', 'warped_trapdoor', 'bamboo_fence_gate',
  'cherry_button', 'polished_blackstone_button',
  'spruce_pressure_plate', 'polished_blackstone_pressure_plate',
  'exposed_copper_bulb',
]

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

  it('取り込み専用のブロックもプリロード対象になっている (#234)', () => {
    // パレットに無い = 配置できないが**取り込みでは現れる**ブロック。表に無い名前は
    // deepslate が描画をスキップし、エラーも出さずに**消えて見える**
    // (エレベーターの塀 280 個が透明なまま GIF に写って気づいた)
    const imported = ['lodestone', 'stone_brick_wall', 'soul_sand', 'water',
      'bubble_column', 'water_cauldron', 'composter', 'lectern']
    const missing: string[] = []
    for (const id of imported) {
      const block = classifyPlainBlock(id)
      expect(block, `${id} が取り込めない`).not.toBeNull()
      const name = blockStateToMinecraftStr(block as BlockState).split('[')[0]
      if (!VIEWER_PRELOAD_BLOCKS.includes(name)) missing.push(`${id} → ${name}`)
    }
    expect(missing, 'VIEWER_PRELOAD_BLOCKS への追加漏れ').toEqual([])
  })

  it('装飾はスナップショットから拾ってプリロードに足される (#234)', () => {
    // 装飾は取り込み元の名前を保持する = 名前の集合が閉じないので固定表に列挙できない
    const decor = classifyPlainBlock('oak_stairs', { facing: 'north' })
    expect(decor?.type, 'oak_stairs が装飾として取り込めない').toBe('decor')
    const blocks = new Map<string, BlockState>([['0,0,0', decor as BlockState]])
    expect(extraPreloadNames({ blocks })).toEqual(['minecraft:oak_stairs'])

    // 固定表にある名前は二重に足さない
    const stone = new Map<string, BlockState>([['0,0,0', { type: 'solid', powered: false }]])
    expect(extraPreloadNames({ blocks: stone })).toEqual([])
  })

  it('往復テストの一覧が**全ブロック種を覆っている** (#303)', () => {
    // 一覧が手書きなので、新しい型を足しても往復テストの対象に入らない。
    // ガラス板 (pane) を足したとき実際にここを落とし、
    // **保存でガラス板が air に潰れる**回帰を出した (取り込みは通るので気づきにくい)
    const covered = new Set(ROUND_TRIP_NAMES.map(n => mcToSim(n)?.type).filter(Boolean))
    // 名前から作れない / 往復の対象外な型
    const EXEMPT = new Set([
      'air',                            // 空気そのもの
      'moving_piston', 'piston_head',   // ピストンの過渡状態 (単体では置かれない)
    ])
    const missing = ALL_BLOCK_TYPES.filter(t => !covered.has(t) && !EXEMPT.has(t))
    expect(missing).toEqual([])
  })

  it('**取り込めるブロックは書き出しても消えない** (#245)', async () => {
    // 書き出しに case が無いと `default` で air に潰れる。
    // 取り込んだ回路を保存すると塀・泡柱・書見台などが**黙って消えていた** (実測: 9 種すべて)
    const names = ROUND_TRIP_NAMES
    const blocks = new Map<string, BlockState>()
    const want = new Map<string, BlockState>()   // 座標 → 期待する状態
    names.forEach((n, i) => {
      const b = mcToSim(n)
      if (b === null) return
      blocks.set(`${i},0,0`, b)
      want.set(`${i},0,0`, b)
    })
    const back = await importFromNbtBytes(exportToNbtBytes(blocks as never, names.length, 1))
    // **型だけでなくプロパティまで見る** (#274)。
    // 型しか比べていなかったせいで、音符ブロックの instrument が落ちているのを
    // 何度も往復しても捕まえられなかった。落ちた 1 個が実回路を壊した
    // (undefined → 引き直しで直上のオブザーバーを偽発火させる)。
    // sim が動的に決めるプロパティ (充電状態など) は往復で変わり得るので比較から外す
    const DYNAMIC = new Set(['powered', 'lit', 'cooldownUntil', 'slots', 'outputPower'])
    const broken: string[] = []
    for (const [key, exp] of want) {
      const got = back.blocks.get(key)
      if (got === undefined) { broken.push(`${exp.type}: 消えた`); continue }
      if (got.type !== exp.type) { broken.push(`${exp.type}: ${got.type} になった`); continue }
      for (const k of Object.keys(exp) as (keyof BlockState)[]) {
        if (k === 'type' || DYNAMIC.has(k as string)) continue
        // 元が undefined のものは比較しない (**失いようがない**)。
        // ここでは素の名前から作っているので facing 等が入っていない
        if (exp[k] === undefined) continue
        const a = JSON.stringify(exp[k]), b = JSON.stringify((got as BlockState)[k])
        if (a !== b) broken.push(`${exp.type}.${String(k)}: ${a} → ${b}`)
      }
    }
    expect(broken, '書き出し → 読み直しで壊れたブロック').toEqual([])
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
describe('盤面サイズ定数のドリフト検知 (#179 → #226)', () => {
  // #226 でエディタの盤面は可変になり、定数の正は @redstone/editor の DEFAULT_BOARD に移した。
  // 検知したいのは「また別ファイルに数値が書き足されていないか」なので、
  // 一致比較ではなく **literal が復活していないこと** を見る。
  const srcOf = (file: string): string => readFileSync(new URL(file, import.meta.url), 'utf8')

  it.each(['GRID_W', 'GRID_H', 'GRID_LAYERS'])('%s に数値リテラルを書き戻していない', (name) => {
    for (const file of ['./EditorPage.tsx', './EmbedPage.tsx']) {
      expect(srcOf(file), `${file} の ${name} が数値リテラルに戻っている`)
        .not.toMatch(new RegExp(`const ${name} = \\d`))
    }
  })

  it('EmbedPage の盤面は DEFAULT_BOARD から引いている', () => {
    const src = srcOf('./EmbedPage.tsx')
    expect(src).toMatch(/const GRID_W = DEFAULT_BOARD\.x/)
    expect(src).toMatch(/const GRID_H = DEFAULT_BOARD\.z/)
    expect(src).toMatch(/const GRID_LAYERS = DEFAULT_BOARD\.y/)
  })

  it('EditorPage に盤面の定数を持たせていない (state と ref だけで持つ)', () => {
    const src = srcOf('./EditorPage.tsx')
    expect(src, 'GRID_* の別名が復活している').not.toMatch(/const GRID_[A-Z]+ =/)
    expect(src).toMatch(/useState<BoardSize>/)
  })

  it('既定の高さは実回路が入る段数を確保している', () => {
    // 8 段だった頃、配布回路 (12 段) が取り込み時に 34% 切り落とされていた (#179)
    expect(DEFAULT_BOARD.y).toBeGreaterThanOrEqual(12)
  })

  it('盤面の上限は既定より大きい (#226 で広げられる)', () => {
    expect(BOARD_MAX).toBeGreaterThan(DEFAULT_BOARD.y)
  })
})
