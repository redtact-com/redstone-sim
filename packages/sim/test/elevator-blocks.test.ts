import { describe, it, expect } from 'vitest'
import { SimWorld } from '../src/world.js'
import { mcToSim, simToMc } from '../src/mcstate.js'
import { isConductor } from '../src/power.js'
import type { BlockState } from '../src/types.js'

/**
 * ガラスエレベーター (#234) で要る静的な性質。
 *
 * - `lodestone`: 石 (導体) だが**ピストンで押せない** [確定: 26.2 pushReaction(BLOCK)]
 * - `water_cauldron` / `composter`: **コンパレーターが LEVEL をそのまま読む**
 *   [確定: 26.2 LayeredCauldronBlock / ComposterBlock の getAnalogOutputSignal]
 * - 装飾: レッドストーン的に無関係なものを 1 型へ集約し、**元の名前は保持**する
 */
describe('lodestone', () => {
  it('導体である (石と同じ)', () => {
    expect(isConductor(mcToSim('lodestone'))).toBe(true)
  })

  it('**ピストンで押せない**', () => {
    const w = new SimWorld()
    w.setBlockAt([0, 0, 0], { type: 'lever', facing: 'up', powered: false } as BlockState)
    w.setBlockAt([1, 0, 0], { type: 'piston', facing: 'east', extended: false } as BlockState)
    w.setBlockAt([2, 0, 0], mcToSim('lodestone')!)
    w.initialize()
    w.flush(64)
    w.activateBlock(0, 0, 0)
    for (let i = 0; i < 8; i++) w.tick()
    expect(w.getBlock(1, 0, 0), '押せないのに伸びている').toMatchObject({ extended: false })
    expect(w.getBlock(2, 0, 0)?.type, '押されて動いてしまった').toBe('lodestone')
  })

  it('石は押せる (比較用 — 上のテストが空振りでないこと)', () => {
    const w = new SimWorld()
    w.setBlockAt([0, 0, 0], { type: 'lever', facing: 'up', powered: false } as BlockState)
    w.setBlockAt([1, 0, 0], { type: 'piston', facing: 'east', extended: false } as BlockState)
    w.setBlockAt([2, 0, 0], { type: 'solid', powered: false } as BlockState)
    w.initialize()
    w.flush(64)
    w.activateBlock(0, 0, 0)
    for (let i = 0; i < 8; i++) w.tick()
    expect(w.getBlock(1, 0, 0)).toMatchObject({ extended: true })
  })
})

describe('大釜 / コンポスターはコンパレーターが LEVEL を読む', () => {
  const readAt = (back: BlockState): number => {
    const w = new SimWorld()
    // comparator(1,0,0) の背面 (west=(0,0,0)) に対象を置く
    w.setBlockAt([1, 0, 0], { type: 'comparator', facing: 'east', mode: 'compare', powered: false, outputPower: 0, locked: false } as BlockState)
    w.setBlockAt([0, 0, 0], back)
    w.setBlockAt([2, 0, 0], { type: 'lamp', lit: false } as BlockState)
    w.initialize()
    w.flush(64)
    return (w.getBlock(1, 0, 0) as { outputPower: number }).outputPower
  }

  it('水入り大釜: level 0-3 がそのまま出る', () => {
    for (const lv of [0, 1, 2, 3]) {
      expect(readAt(mcToSim(`water_cauldron[level=${lv}]`)!), `level=${lv}`).toBe(lv)
    }
  })

  it('コンポスター: level 0-8 がそのまま出る', () => {
    for (const lv of [0, 3, 8]) {
      expect(readAt(mcToSim(`composter[level=${lv}]`)!), `level=${lv}`).toBe(lv)
    }
  })

  it('取り込みで範囲外の level は丸める', () => {
    expect(mcToSim('composter[level=99]')).toMatchObject({ level: 8 })
    expect(mcToSim('water_cauldron[level=99]')).toMatchObject({ level: 3 })
  })
})

describe('装飾は 1 型に集約しつつ名前を保持する', () => {
  it('end_rod / 階段 / 壁掛け看板が装飾になる', () => {
    for (const n of ['end_rod', 'dark_oak_stairs', 'dark_oak_wall_hanging_sign']) {
      expect(mcToSim(n)?.type, n).toBe('decor')
    }
  })

  it('**元のブロック名を保ったまま書き戻せる**', () => {
    const sim = mcToSim('end_rod[facing=up]')
    expect(sim).toMatchObject({ type: 'decor' })
    expect(simToMc(sim)).toContain('end_rod')
  })

  it('レッドストーンには関与しない (非導体)', () => {
    expect(isConductor(mcToSim('end_rod'))).toBe(false)
  })
})

describe('書見台のコンパレーター出力 (#240)', () => {
  // [確定: 26.2 LecternBlockEntity.getRedstoneSignal]
  //   pageProgress = pageCount > 1 ? page / (pageCount - 1) : 1
  //   signal = floor(pageProgress * 14) + (hasBook ? 1 : 0)
  // 実機で確認 (5 ページ本): Page 0→1 / 1→4 / 2→8 / 3→11 / 4→15、本無しは 14
  const lectern = (hasBook: boolean, page: number, pages: number): BlockState =>
    ({ type: 'lectern', facing: 'east', hasBook, page, pages })

  const readAt = (b: BlockState): number => {
    const w = new SimWorld()
    w.setBlockAt([0, -1, 0], { type: 'solid', powered: false })
    w.setBlockAt([1, -1, 0], { type: 'solid', powered: false })
    w.setBlockAt([0, 0, 0], b)
    // sim の facing は**出力方向**なので、背面 (西) の書見台を読むには east 向き
    w.setBlockAt([1, 0, 0], { type: 'comparator', facing: 'east', mode: 'compare', powered: false, outputPower: 0 } as BlockState)
    w.initialize()
    w.settle(8)
    const c = w.getBlockAt([1, 0, 0])
    return c?.type === 'comparator' ? c.outputPower : -1
  }

  it('5 ページの本は実機と同じ 1 / 4 / 8 / 11 / 15 を出す', () => {
    expect([0, 1, 2, 3, 4].map(p => readAt(lectern(true, p, 5)))).toEqual([1, 4, 8, 11, 15])
  })

  it('本の中身が無い has_book=true は 14 (実機で確認)', () => {
    expect(readAt(lectern(true, 0, 0))).toBe(14)
  })

  it('ページ数 1 以下の本は 15', () => {
    expect(readAt(lectern(true, 0, 1))).toBe(15)
  })

  it('has_book=false は 0', () => {
    expect(readAt(lectern(false, 3, 5))).toBe(0)
  })

  it('ページをめくると出力が変わり、最終ページの次は 0 に戻る', () => {
    const w = new SimWorld()
    w.setBlockAt([0, -1, 0], { type: 'solid', powered: false })
    w.setBlockAt([0, 0, 0], lectern(true, 3, 5))
    w.initialize()
    w.activateBlock(0, 0, 0)
    expect((w.getBlockAt([0, 0, 0]) as { page: number }).page).toBe(4)
    w.activateBlock(0, 0, 0)
    expect((w.getBlockAt([0, 0, 0]) as { page: number }).page).toBe(0)
  })

  it('ページを直接指定できる (階数指定の用途)', () => {
    const w = new SimWorld()
    w.setBlockAt([0, -1, 0], { type: 'solid', powered: false })
    w.setBlockAt([0, 0, 0], lectern(true, 0, 10))
    w.initialize()
    w.setLecternPage(0, 0, 0, 7)
    expect((w.getBlockAt([0, 0, 0]) as { page: number }).page).toBe(7)
    w.setLecternPage(0, 0, 0, 99)   // ページ数を超えたら最終ページで止まる
    expect((w.getBlockAt([0, 0, 0]) as { page: number }).page).toBe(9)
  })
})
