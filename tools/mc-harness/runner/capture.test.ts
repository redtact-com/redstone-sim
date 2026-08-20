// ============================================================
// capture.ts の「一部のブロックだけ置く」(keep) の回帰。実機は呼ばない。
//
// region はキャプチャの**観測範囲であると同時に掃除範囲**なので、
// keep で縮めたときにここがズレると
//   - 観測できない座標が出る (実機側だけ 'air' に見えて偽の食い違いになる)
//   - 掃除が足りず前回のブロックが残る (実機側だけ動く)
// のどちらかが起きる。最小化ループが真っ先に踏む場所なので固定しておく。
// ============================================================

import { describe, it, expect } from 'vitest'
import {
  selectPlacedBlocks, collectLecternBooks, buildLecternBookArgs, buildLecternPageArgs,
} from './capture.js'
import type { LecternSource } from './capture.js'

/** 3x2x3 の塊 + 離れたところに 1 個 */
const BLOCKS: { pos: [number, number, number]; name: string }[] = [
  { pos: [0, 0, 0], name: 'stone' },
  { pos: [1, 0, 0], name: 'stone' },
  { pos: [2, 0, 0], name: 'stone' },
  { pos: [0, 1, 0], name: 'lever' },
  { pos: [1, 1, 0], name: 'redstone_wire' },
  { pos: [2, 1, 0], name: 'redstone_lamp' },
  { pos: [9, 0, 5], name: 'stone' },
]

describe('selectPlacedBlocks — keep 無し (従来どおり)', () => {
  it('全ブロックを置き、region は回路全体 + pad。**下端 y は 0 のまま**', () => {
    const r = selectPlacedBlocks(BLOCKS, 1)
    expect(r.blocks).toHaveLength(BLOCKS.length)
    // 原点寄せ済みの回路は min=(0,0,0) なので from = [-pad, 0, -pad] という従来の式と一致する
    expect(r.region).toEqual({ from: [-1, 0, -1], to: [10, 2, 6] })
    expect(r.missing).toEqual([])
  })

  it('pad を変えると x/z は両側に、y は上だけ広がる', () => {
    expect(selectPlacedBlocks(BLOCKS, 3).region).toEqual({ from: [-3, 0, -3], to: [12, 4, 8] })
  })
})

describe('selectPlacedBlocks — keep 指定', () => {
  it('keep の座標だけを置く', () => {
    const r = selectPlacedBlocks(BLOCKS, 1, ['1,1,0', '1,0,0'])
    expect(r.blocks.map(b => b.pos.join(','))).toEqual(['1,0,0', '1,1,0'])
  })

  it('region が keep の bbox + pad に縮む (離れた 1 個を捨てれば範囲も縮む)', () => {
    const r = selectPlacedBlocks(BLOCKS, 1, ['1,1,0', '1,0,0'])
    expect(r.region).toEqual({ from: [0, 0, -1], to: [2, 2, 1] })
    // keep 無しのときより明確に小さい (縮んでいることの確認)
    const full = selectPlacedBlocks(BLOCKS, 1)
    expect(r.region.to[0]).toBeLessThan(full.region.to[0])
    expect(r.region.to[2]).toBeLessThan(full.region.to[2])
  })

  it('下端 y は 0 より下げない (void superflat に掃除範囲を伸ばさない)', () => {
    const r = selectPlacedBlocks(BLOCKS, 2, ['1,0,0'])
    expect(r.region.from[1]).toBe(0)
  })

  it('1 個だけ残しても pad ぶんの立方体になる', () => {
    const r = selectPlacedBlocks(BLOCKS, 1, ['9,0,5'])
    expect(r.region).toEqual({ from: [8, 0, 4], to: [10, 1, 6] })
  })

  it('ブロックの無い座標を keep に書くと region だけ広がり missing に載る', () => {
    // 入力の当たり先 (setblock で空中に置く等) を region に含めるための挙動
    const r = selectPlacedBlocks(BLOCKS, 1, ['1,1,0', '5,3,0'])
    expect(r.blocks.map(b => b.pos.join(','))).toEqual(['1,1,0'])
    expect(r.missing).toEqual(['5,3,0'])
    expect(r.region).toEqual({ from: [0, 0, -1], to: [6, 4, 1] })
  })

  it('壊れた座標キーは黙って捨てず投げる', () => {
    expect(() => selectPlacedBlocks(BLOCKS, 1, ['1,1'])).toThrow(/keep の座標キーが不正/)
    expect(() => selectPlacedBlocks(BLOCKS, 1, ['1,1,x'])).toThrow(/keep の座標キーが不正/)
    expect(() => selectPlacedBlocks(BLOCKS, 1, ['1,1,0.5'])).toThrow(/keep の座標キーが不正/)
  })

  it('keep が空なら投げる (region が作れない)', () => {
    expect(() => selectPlacedBlocks(BLOCKS, 1, [])).toThrow(/1 つも無い/)
  })

  it('負の座標でも bbox を素直に取る', () => {
    const blocks = [{ pos: [-4, 2, -7] as [number, number, number], name: 'stone' }]
    expect(selectPlacedBlocks(blocks, 1, ['-4,2,-7']).region)
      .toEqual({ from: [-5, 1, -8], to: [-3, 3, -6] })
  })
})

// ============================================================
// 書見台の本を入れ直すコマンド組み立て (#240)。実機は呼ばない。
//
// 階数指定は書見台のページ番号なので、**ページ数と Page が 1 でもズレると
// コンパレーターの出力が変わり、機械が別の階へ行く**。しかも本は block entity の
// 中身で blockstate に出ないため、間違えても「置いた回路は正しく見える」。
// 実機に投げてからでは気付けないので、組み立てだけをここで固定しておく。
// ============================================================

/** 実測の御坊エレベーター相当: 各階 15 ページ / 地上 5 ページ + 本無し + 情報欠落 */
const LECTERNS: LecternSource[] = [
  { pos: [1, 9, 9], name: 'lectern', props: { facing: 'north', has_book: 'true' }, lectern: { page: 0, pages: 15 } },
  // 元ファイル側が `minecraft:` 付きで返しても拾えること
  { pos: [5, 2, 8], name: 'minecraft:lectern', props: { facing: 'east', has_book: 'true' }, lectern: { page: 4, pages: 5 } },
  { pos: [7, 0, 0], name: 'lectern', props: { facing: 'south', has_book: 'false' } },
  { pos: [8, 0, 0], name: 'lectern', props: { facing: 'south', has_book: 'true' } },
  { pos: [0, 0, 0], name: 'stone', props: {} },
]

/** 15 ページのダミー本 (Page=0) を入れる完成形。字面ごと固定する */
const BOOK_15_PAGE0 =
  'data merge block 1 9 9 {Book:{id:"minecraft:writable_book",count:1,'
  + 'components:{"minecraft:writable_book_content":'
  + '{pages:["x","x","x","x","x","x","x","x","x","x","x","x","x","x","x"]}}},Page:0}'

describe('collectLecternBooks — 本を入れ直す書見台を拾う', () => {
  it('本のある書見台だけを拾い、ページ数と Page をそのまま持ち出す', () => {
    const r = collectLecternBooks(LECTERNS)
    expect(r.books).toEqual([
      { pos: [1, 9, 9], page: 0, pages: 15 },
      { pos: [5, 2, 8], page: 4, pages: 5 },
    ])
  })

  it('has_book=false は復元対象でも警告対象でもない (blockstate が正)', () => {
    const r = collectLecternBooks(LECTERNS)
    expect(r.books.map(b => b.pos.join(','))).not.toContain('7,0,0')
    expect(r.noBook).not.toContain('7,0,0')
  })

  it('has_book=true なのに本の中身が無い座標は noBook に出す (出力が 14 に張り付く)', () => {
    expect(collectLecternBooks(LECTERNS).noBook).toEqual(['8,0,0'])
  })

  it('本の情報がまだ付かない版 (lectern プロパティ無し) でも落ちない', () => {
    const noLectern = LECTERNS.map(({ pos, name, props }) => ({ pos, name, props }))
    const r = collectLecternBooks(noLectern)
    expect(r.books).toEqual([])
    expect(r.noBook).toEqual(['1,9,9', '5,2,8', '8,0,0'])
  })

  it('ページ数 0 (中身の無い本) は復元せず noBook 扱い', () => {
    const r = collectLecternBooks([
      { pos: [1, 0, 1], name: 'lectern', props: { has_book: 'true' }, lectern: { page: 0, pages: 0 } },
    ])
    expect(r.books).toEqual([])
    expect(r.noBook).toEqual(['1,0,1'])
  })
})

describe('buildLecternBookArgs — /data merge block でダミー本を入れる', () => {
  it('15 ページ本 Page=0 のコマンドを字面ごと固定する', () => {
    expect(buildLecternBookArgs({ pos: [1, 9, 9], page: 0, pages: 15 }).join(' ')).toBe(BOOK_15_PAGE0)
  })

  it('ページ数と Page がそのままコマンドに出る (5 ページ本の最終ページ)', () => {
    const cmd = buildLecternBookArgs({ pos: [5, 2, 8], page: 4, pages: 5 }).join(' ')
    expect(cmd).toContain('{pages:["x","x","x","x","x"]}')
    expect(cmd).toContain('Page:4')
  })

  it('ページ数ぶんだけページを並べる (1 ページ / 40 ページ)', () => {
    const pagesIn = (n: number) =>
      buildLecternBookArgs({ pos: [0, 0, 0], page: 0, pages: n })[6].match(/"x"/g)?.length
    expect(pagesIn(1)).toBe(1)
    expect(pagesIn(40)).toBe(40)
  })

  it('範囲外の Page は 0..ページ数-1 に丸める (実機の丸めと揃える)', () => {
    expect(buildLecternBookArgs({ pos: [0, 0, 0], page: 99, pages: 15 }).join(' ')).toContain('Page:14}')
    expect(buildLecternBookArgs({ pos: [0, 0, 0], page: -3, pages: 15 }).join(' ')).toContain('Page:0}')
  })

  it('SNBT に空白と改行を入れない (rcon は引数を空白で連結する / 改行は別コマンドになる)', () => {
    const snbt = buildLecternBookArgs({ pos: [-4, 2, -7], page: 1, pages: 3 })[6]
    expect(snbt).not.toMatch(/[\s]/)
    // 座標は別引数のまま渡す (符号付きでも壊れない)
    expect(buildLecternBookArgs({ pos: [-4, 2, -7], page: 1, pages: 3 }).slice(0, 6))
      .toEqual(['data', 'merge', 'block', '-4', '2', '-7'])
  })

  it('ページ数が 1 未満 / 非整数なら投げる', () => {
    expect(() => buildLecternBookArgs({ pos: [0, 0, 0], page: 0, pages: 0 })).toThrow(/ページ数が不正/)
    expect(() => buildLecternBookArgs({ pos: [0, 0, 0], page: 0, pages: 2.5 })).toThrow(/ページ数が不正/)
  })

  it('1014 バイトを超える本は投げる前に落とす (rcon-cli は上限超えで無言ハングする)', () => {
    const fits = (pages: number): boolean => {
      try { buildLecternBookArgs({ pos: [0, 0, 0], page: 0, pages }); return true } catch { return false }
    }
    let max = 1
    while (max < 5000 && fits(max + 1)) max++
    // バニラの本は最大 100 ページ。そこまでは必ず 1 コマンドで入る
    expect(max).toBeGreaterThanOrEqual(100)
    expect(Buffer.byteLength(buildLecternBookArgs({ pos: [0, 0, 0], page: 0, pages: max }).join(' '), 'utf8'))
      .toBeLessThanOrEqual(1014)
    expect(() => buildLecternBookArgs({ pos: [0, 0, 0], page: 0, pages: max + 1 })).toThrow(/長すぎる/)
  })
})

describe('buildLecternPageArgs — 入力アクション lectern', () => {
  it('Page だけを書き換える (本は入れ直さない)', () => {
    expect(buildLecternPageArgs([5, 2, 8], 10))
      .toEqual(['data', 'modify', 'block', '5', '2', '8', 'Page', 'set', 'value', '10'])
  })

  it('負のページ / 非整数は投げる', () => {
    expect(() => buildLecternPageArgs([5, 2, 8], -1)).toThrow(/page が不正/)
    expect(() => buildLecternPageArgs([5, 2, 8], 1.5)).toThrow(/page が不正/)
  })
})
