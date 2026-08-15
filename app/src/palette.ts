/**
 * パレットとトリガパネルの定義 (#153)。
 *
 * EditorPage / EmbedPage の両方から使うので独立モジュールにしてある
 * (以前は EditorPage 内に定義し、EmbedPage が TRIGGER_META を重複して持っていた)。
 * **新しいブロック種を足したときの追加漏れ**は blockDrift.test.ts が検知する —
 * #146 で detector_rail を TRIGGER_META に入れ忘れ、ブラウザで置けるのに
 * 通電させられない状態を出したのがきっかけ。
 */

import type { PlaceableType } from '@redstone/editor'

/** パレットアイテムの型。PlaceableType + 消しゴム + 移動 */
export type PaletteType = PlaceableType | 'eraser' | 'move'

/** sim モードでパネルから手動トリガできる素子 */
export interface TriggerEntry {
  pos: [number, number, number]
  type: string
}

/** トリガパネルの対象素子と表示 (略号は trace の abbrOf と揃える) */
export const TRIGGER_META: Record<string, { abbr: string; log: string; momentary: boolean }> = {
  lever:                           { abbr: 'Le', log: 'レバー',   momentary: false },
  button_stone:                    { abbr: 'Bu', log: 'ボタン(石) を押す', momentary: true },
  button_wood:                     { abbr: 'Bu', log: 'ボタン(木) を押す', momentary: true },
  pressure_plate_wood:             { abbr: 'Pp', log: '感圧板(木) を踏む', momentary: true },
  pressure_plate_stone:            { abbr: 'Pp', log: '感圧板(石) を踏む', momentary: true },
  weighted_pressure_plate_light:   { abbr: 'Wp', log: '重量板(金) を踏む', momentary: true },
  weighted_pressure_plate_heavy:   { abbr: 'Wp', log: '重量板(鉄) を踏む', momentary: true },
  target:                          { abbr: 'Tg', log: 'ターゲット発火',   momentary: true },
  trapdoor_wood:                   { abbr: 'Td', log: 'トラップドア(木) を開閉', momentary: false },
  fence_gate:                      { abbr: 'Fg', log: 'フェンスゲート を開閉',   momentary: false },
  detector_rail:                   { abbr: 'Dt', log: 'ディテクターレールにトロッコ', momentary: true },
}
export const TRIGGER_TYPES = new Set(Object.keys(TRIGGER_META))

/** トリガ素子の作動中表示 (lever/plate=powered, target=outputPower>0) */
export function isTriggerOn(b: { type: string; powered?: boolean; outputPower?: number }): boolean {
  if (b.type === 'target') return (b.outputPower ?? 0) > 0
  return b.powered ?? false
}

export interface BlockMeta {
  type:       PaletteType
  label:      string
  /** mcmeta テクスチャパス。null のときは専用アイコンをレンダリング */
  texture:    string | null
  cssFilter?: string
  hasFacing:  boolean
  hasDelay:   boolean
  hasMode:    boolean
  /** 重量感圧板の踏まれ信号 (1-15) セレクタを表示するか */
  hasPressedPower?: boolean
  /** コンテナの背面読み信号 (0-15) セレクタを表示するか */
  hasSignal?: boolean
  /** ホッパー/ドロッパーの内容個数セレクタを表示するか (#65) */
  hasCount?: boolean
}

export const BLOCK_PALETTE: BlockMeta[] = [
  // 移動ツール（特殊アイテム）
  { type: 'move',       label: '移動',          texture: null,                    hasFacing: false, hasDelay: false, hasMode: false },
  { type: 'wire',       label: 'ワイヤー',      texture: 'block/redstone_dust_dot',
    cssFilter: 'sepia(1) saturate(10) hue-rotate(320deg) brightness(0.8)',
    hasFacing: false, hasDelay: false, hasMode: false },
  { type: 'lever',      label: 'レバー',        texture: 'block/lever',           hasFacing: true,  hasDelay: false, hasMode: false },
  { type: 'button_stone', label: 'ボタン(石)',  texture: 'block/stone',           hasFacing: true,  hasDelay: false, hasMode: false },
  { type: 'button_wood',  label: 'ボタン(木)',  texture: 'block/oak_planks',      hasFacing: true,  hasDelay: false, hasMode: false },
  { type: 'torch',      label: 'トーチ(床)',    texture: 'block/redstone_torch',  hasFacing: false, hasDelay: false, hasMode: false },
  { type: 'wall_torch', label: 'トーチ(壁)',    texture: 'block/redstone_torch',  hasFacing: true,  hasDelay: false, hasMode: false },
  { type: 'repeater',   label: 'リピーター',    texture: 'block/repeater',        hasFacing: true,  hasDelay: true,  hasMode: false },
  { type: 'comparator', label: 'コンパレーター', texture: 'block/comparator',      hasFacing: true,  hasDelay: false, hasMode: true  },
  { type: 'pressure_plate_wood',  label: '感圧板(木)', texture: 'block/oak_planks',   hasFacing: false, hasDelay: false, hasMode: false },
  { type: 'pressure_plate_stone', label: '感圧板(石)', texture: 'block/stone',        hasFacing: false, hasDelay: false, hasMode: false },
  { type: 'weighted_pressure_plate_light', label: '重量板(金)', texture: 'block/gold_block', hasFacing: false, hasDelay: false, hasMode: false, hasPressedPower: true },
  { type: 'weighted_pressure_plate_heavy', label: '重量板(鉄)', texture: 'block/iron_block', hasFacing: false, hasDelay: false, hasMode: false, hasPressedPower: true },
  { type: 'lamp',       label: 'ランプ',        texture: 'block/redstone_lamp',   hasFacing: false, hasDelay: false, hasMode: false },
  { type: 'note_block', label: '音符ブロック',  texture: 'block/note_block',      hasFacing: false, hasDelay: false, hasMode: false },
  { type: 'copper_bulb', label: '銅の電球',   texture: 'block/copper_bulb',     hasFacing: false, hasDelay: false, hasMode: false },
  { type: 'trapdoor_wood', label: 'トラップドア(木)', texture: 'block/oak_trapdoor', hasFacing: true, hasDelay: false, hasMode: false },
  { type: 'trapdoor_iron', label: 'トラップドア(鉄)', texture: 'block/iron_trapdoor', hasFacing: true, hasDelay: false, hasMode: false },
  { type: 'fence_gate', label: 'フェンスゲート', texture: 'block/oak_planks',   hasFacing: true, hasDelay: false, hasMode: false },
  { type: 'piston',     label: 'ピストン',      texture: 'block/piston_top',      hasFacing: true,  hasDelay: false, hasMode: false },
  { type: 'sticky_piston', label: '粘着ピストン', texture: 'block/piston_top_sticky', hasFacing: true, hasDelay: false, hasMode: false },
  { type: 'observer',   label: 'オブザーバー',  texture: 'block/observer_front',   hasFacing: true,  hasDelay: false, hasMode: false },
  { type: 'redstone_block', label: 'レッドストーンブロック', texture: 'block/redstone_block', hasFacing: false, hasDelay: false, hasMode: false },
  { type: 'slime_block', label: 'スライム',    texture: 'block/slime_block',     hasFacing: false, hasDelay: false, hasMode: false },
  { type: 'honey_block', label: 'ハチミツ',    texture: 'block/honey_block_side', hasFacing: false, hasDelay: false, hasMode: false },
  { type: 'rail', label: 'レール', texture: 'block/rail', hasFacing: true, hasDelay: false, hasMode: false },
  { type: 'powered_rail', label: 'パワードレール', texture: 'block/powered_rail', hasFacing: true, hasDelay: false, hasMode: false },
  { type: 'activator_rail', label: 'アクティベーターレール', texture: 'block/activator_rail', hasFacing: true, hasDelay: false, hasMode: false },
  { type: 'detector_rail', label: 'ディテクターレール', texture: 'block/detector_rail', hasFacing: true, hasDelay: false, hasMode: false },
  { type: 'target',     label: 'ターゲット',    texture: 'block/target_side',     hasFacing: false, hasDelay: false, hasMode: false },
  { type: 'container',  label: 'コンテナ',      texture: 'block/barrel_side',     hasFacing: false, hasDelay: false, hasMode: false, hasSignal: true },
  { type: 'hopper',     label: 'ホッパー',      texture: 'block/hopper_outside',  hasFacing: true,  hasDelay: false, hasMode: false, hasCount: true },
  { type: 'dropper',    label: 'ドロッパー',    texture: 'block/dropper_front',   hasFacing: true,  hasDelay: false, hasMode: false, hasCount: true },
  { type: 'solid',      label: '石',            texture: 'block/stone',           hasFacing: false, hasDelay: false, hasMode: false },
  // 消しゴム（特殊アイテム）
  { type: 'eraser',     label: '消しゴム',      texture: null,                    hasFacing: false, hasDelay: false, hasMode: false },
]

export type { PlaceableType }
