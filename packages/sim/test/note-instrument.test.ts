import { describe, it, expect } from 'vitest'
import { SimWorld } from '../src/world.js'
import { noteInstrumentFor, noteInstrumentOfBlockName } from '../src/blocks/noteInstrument.js'
import { mcToSim, simToMc } from '../src/mcstate.js'
import type { BlockState } from '../src/types.js'

/**
 * 音符ブロックの音色 (#231)。
 *
 * 音そのものは sim の対象外だが、**instrument は blockstate なので変化が
 * オブザーバーに検知される**。持たないと、直下のブロックが入れ替わったときの
 * 発火を丸ごと落とす (5×5 ドアでピストンが早く縮む原因だった)。
 */
describe('音色の決まり方 [確定: 26.2 NoteBlock.setInstrument / Blocks.java]', () => {
  it('石の上は basedrum / ガラスの上は hat / 音符ブロックの上は bass', () => {
    expect(noteInstrumentFor({ type: 'solid', powered: false })).toBe('basedrum')
    expect(noteInstrumentFor({ type: 'glass' })).toBe('hat')
    expect(noteInstrumentFor({ type: 'note_block', powered: false, note: 0, instrument: 'harp' }))
      .toBe('bass')
  })

  it('空気・未宣言のブロックの上は harp', () => {
    expect(noteInstrumentFor(null)).toBe('harp')
    expect(noteInstrumentFor({ type: 'air' })).toBe('harp')
    // ピストンは石に見えるが instrument を宣言していない [確定: Blocks.PISTON]
    expect(noteInstrumentFor({ type: 'piston', facing: 'up', extended: false })).toBe('harp')
  })

  it('オブザーバーの上は basedrum (5×5 ドアで効いていた組み合わせ)', () => {
    expect(noteInstrumentFor({ type: 'observer', facing: 'down', powered: false })).toBe('basedrum')
  })

  it('**材質を潰した solid でも取り込み時の音色を保つ** (羊毛=guitar)', () => {
    const wool = mcToSim('light_blue_wool')!
    expect(wool.type).toBe('solid')
    expect(noteInstrumentFor(wool)).toBe('guitar')
  })

  it('ブロック名から引ける / 未宣言は harp', () => {
    expect(noteInstrumentOfBlockName('minecraft:light_blue_wool')).toBe('guitar')
    expect(noteInstrumentOfBlockName('oak_planks')).toBe('bass')
    expect(noteInstrumentOfBlockName('hopper')).toBe('harp')
  })

  it('mob head は下に置かれても harp [確定: worksAboveNoteBlock]', () => {
    expect(noteInstrumentOfBlockName('zombie_head')).toBe('harp')
  })
})

describe('音色の引き直しと検知', () => {
  const noteBlock = (instrument: 'harp' | 'basedrum'): BlockState =>
    ({ type: 'note_block', powered: false, note: 0, instrument }) as BlockState

  /** 音符ブロックの下でピストンが石を押し込み、音色が変わるかを見る */
  function build(): SimWorld {
    const w = new SimWorld()
    // (0,0,0) レバー → (1,0,0) ピストン east → (2,0,0) の石を (3,0,0) へ
    w.setBlockAt([0, 0, 0], { type: 'lever', facing: 'up', powered: false } as BlockState)
    w.setBlockAt([1, 0, 0], { type: 'piston', facing: 'east', extended: false } as BlockState)
    w.setBlockAt([2, 0, 0], { type: 'solid', powered: false } as BlockState)
    // (3,1,0) に音符ブロック。石が (3,0,0) に入ると下が石になる
    w.setBlockAt([3, 1, 0], noteBlock('harp'))
    w.initialize()
    w.flush(64)
    return w
  }

  it('settle だけでは引き直さない (実機も古い音色のまま残る)', () => {
    const w = build()
    expect(w.getBlock(3, 1, 0)).toMatchObject({ instrument: 'harp' })
  })

  it('下に石が入ると basedrum になる', () => {
    const w = build()
    w.activateBlock(0, 0, 0)
    for (let i = 0; i < 8; i++) w.tick()
    expect(w.getBlock(3, 0, 0)).toMatchObject({ type: 'solid' })
    expect(w.getBlock(3, 1, 0), '音色が引き直されていない').toMatchObject({ instrument: 'basedrum' })
  })

  it('**音色の変化はオブザーバーが検知する**', () => {
    const w = build()
    // 音符ブロックの上にオブザーバー (下向き = 音符ブロックを見る)
    w.setBlockAt([3, 2, 0], { type: 'observer', facing: 'down', powered: false } as BlockState)
    w.flush(64)
    expect(w.getBlock(3, 2, 0)).toMatchObject({ powered: false })

    w.activateBlock(0, 0, 0)
    let fired = false
    for (let i = 0; i < 12; i++) {
      w.tick()
      if ((w.getBlock(3, 2, 0) as { powered?: boolean })?.powered) fired = true
    }
    expect(fired, '音色が変わったのにオブザーバーが発火していない').toBe(true)
  })

  it('blockstate 文字列に音色が出る (実機比較で効く)', () => {
    const s = simToMc(noteBlock('basedrum'))
    expect(s).toContain('instrument=basedrum')
  })
})
