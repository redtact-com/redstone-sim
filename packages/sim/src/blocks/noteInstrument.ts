// ============================================================
// 音符ブロックの音色 (#231)
//
// 音そのものは sim の対象外だが、**instrument は blockstate なので変化が
// オブザーバーに検知される**。ここを持たないと、直下のブロックが入れ替わった
// ときの発火を丸ごと落とす (ユーザ提供の 5×5 ドアで、ピストンが早く縮む原因だった)。
// ============================================================

import type { BlockState } from '../types.js'
import { NOTE_INSTRUMENT_BY_BLOCK } from './noteInstrument.generated.js'

/**
 * 音符ブロックの音色。値は vanilla の NoteBlockInstrument (BASE_BLOCK 型) に対応。
 * mob head 由来 (zombie 等) は**下に置かれても harp になる**ので含めない
 * [確定: 26.2 NoteBlock.setInstrument — 下のブロックが worksAboveNoteBlock() なら HARP]
 */
export type NoteInstrument =
  | 'harp' | 'basedrum' | 'hat' | 'bass' | 'snare' | 'guitar' | 'flute' | 'bell'
  | 'chime' | 'xylophone' | 'iron_xylophone' | 'cow_bell' | 'didgeridoo' | 'bit'
  | 'banjo' | 'pling'

/**
 * ブロック種別ごとの音色 [確定: 26.2 Blocks.java の
 * `BlockBehaviour.Properties.instrument(NoteBlockInstrument.X)`]。
 *
 * **宣言が無いブロックは既定の HARP**。ピストン・ホッパー・レッドストーンブロック・
 * ランプ・ターゲットが HARP なのは直感に反するが、一次資料どおり
 * (石っぽい見た目でも instrument を宣言していない)。
 *
 * sim は導体フルブロックを材質ごと `solid` 1 種に潰している (13 §2 の既知の抽象化)
 * ため、**材質ごとの音色差は表現できない**。`solid` は正規形の stone に合わせて
 * basedrum とする。木のブロックの上に置かれた音符ブロックは vanilla では bass だが
 * sim では basedrum になる — 音色だけの差で、検知される変化のタイミングは同じ。
 */
const INSTRUMENT_BY_TYPE: Partial<Record<BlockState['type'], NoteInstrument>> = {
  // BASEDRUM (石系)
  solid: 'basedrum',            // 正規形 stone [確定: STONE]
  slab: 'basedrum',             // 正規形 smooth_stone_slab [確定: SMOOTH_STONE_SLAB]
  observer: 'basedrum',         // [確定: OBSERVER]
  dropper: 'basedrum',          // [確定: DROPPER]
  dispenser: 'basedrum',        // [確定: DISPENSER]
  pressure_plate_stone: 'basedrum', // [確定: STONE_PRESSURE_PLATE]
  // HAT (ガラス)
  glass: 'hat',                 // [確定: GLASS]
  // BASS (木系)
  note_block: 'bass',           // [確定: NOTE_BLOCK]
  container: 'bass',            // 正規形 chest [確定: CHEST]
}

/**
 * 音符ブロックの音色を直下のブロックから決める。
 *
 * [確定: 26.2 NoteBlock.setInstrument] — 本来は「上のブロックが
 * worksAboveNoteBlock() (= mob head) ならそれ、でなければ下のブロック」だが、
 * **sim に mob head は無い**ので常に下のブロックで決まる。
 * 下が空気や instrument 未宣言のブロックなら既定の harp。
 */
export function noteInstrumentFor(below: BlockState | null | undefined): NoteInstrument {
  if (!below || below.type === 'air') return 'harp'
  // 材質を潰している型 (solid / glass / slab) は取り込み時に実際の音色を載せてある。
  // 無ければ正規形 (stone / glass / smooth_stone_slab) の音色に落とす
  if (below.type === 'solid' || below.type === 'glass' || below.type === 'slab') {
    return below.instrument ?? INSTRUMENT_BY_TYPE[below.type] ?? 'harp'
  }
  return INSTRUMENT_BY_TYPE[below.type] ?? 'harp'
}

/**
 * vanilla のブロック名から「その上の音符ブロックが鳴らす音色」を引く。
 * 表に無い = instrument 未宣言 = 既定の harp。
 * mob head 系は下に置かれても harp なので落とす (worksAboveNoteBlock)。
 */
export function noteInstrumentOfBlockName(name: string): NoteInstrument {
  const v = NOTE_INSTRUMENT_BY_BLOCK[name.replace(/^minecraft:/, '')]
  return v && !MOB_HEAD_INSTRUMENTS.has(v) ? v as NoteInstrument : 'harp'
}

/** 下に置かれても harp になる音色 (mob head / custom head) */
const MOB_HEAD_INSTRUMENTS = new Set([
  'zombie', 'skeleton', 'creeper', 'dragon', 'wither_skeleton', 'piglin', 'custom_head',
])

const KNOWN: ReadonlySet<string> = new Set<NoteInstrument>([
  'harp', 'basedrum', 'hat', 'bass', 'snare', 'guitar', 'flute', 'bell',
  'chime', 'xylophone', 'iron_xylophone', 'cow_bell', 'didgeridoo', 'bit',
  'banjo', 'pling',
])

/** blockstate から音色を取り込む。扱わない値 (mob head 等) は harp に落とす */
export function toNoteInstrument(v: string | undefined): NoteInstrument {
  return v !== undefined && KNOWN.has(v) ? v as NoteInstrument : 'harp'
}
