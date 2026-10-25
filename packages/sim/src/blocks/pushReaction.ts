// ============================================================
// ピストンの押し反応 (R-9 / R-10)
//
// 26.2 PistonBaseBlock.isPushable の判定順をそのまま使う:
//   1. 空気は押せる
//   2. 名指しの 4 種 (黒曜石・泣く黒曜石・リスポーンアンカー・強化深層岩) と硬さ -1 は押せない
//   3. 押し反応で決める: BLOCK は押せない / DESTROY は壊してよいときだけ / PUSH_ONLY は向きが合うときだけ
//   4. NORMAL のうち BlockEntity を持つものは押せない
// ピストン本体だけは硬さ -1 と押し反応を見ず、伸びていれば押せない (BlockEntity は持たない)。
//
// sim は材質を潰しているので、2 と 3 を blockstate の型と名前から引く表にした。
// 2 の「押せない」は 3 の BLOCK に畳む (sim には硬さが無い)。
// 以前は world.ts の isMovable / isPushDestroy に手書きのリストがあり、
// 検知レールとクラフターを壊し、扉・銅の電球・トラップドア・塀・板を押せない扱いにしていた
// (実機 1.21.1 で 8 種すべて食い違った。docs/research/16 §3.1 R-9)。
// ============================================================

import type { BlockState, PushReaction } from '../types.js'
import { isShulkerBoxName } from './blockNames.js'

/** 装飾 (`decor` 型) の名前 (プロパティを除く) を取り出す */
const decorId = (name: string): string => name.split('[')[0]

/**
 * 装飾のうち押されると壊れるもの [確定: 26.2 Blocks — flowerPotProperties / LADDER /
 * 各 HEAD・SKULL / MOSS_CARPET・PALE_MOSS_CARPET が pushReaction(DESTROY)]。
 * 羊毛のカーペットは指定なし (NORMAL) なので入れない。
 */
const DECOR_DESTROY_EXACT = new Set(['flower_pot', 'ladder', 'moss_carpet', 'pale_moss_carpet'])
const isHeadOrSkullId = (id: string): boolean =>
  id !== 'piston_head' && (id.endsWith('_head') || id.endsWith('_skull'))

/**
 * 装飾のうち BlockEntity を持つもの [確定: 26.2 — SignBlock・AbstractBannerBlock は
 * BaseEntityBlock]。押し反応は NORMAL なので、isPushable の最後の判定で動かない。
 */
const isDecorWithBlockEntity = (id: string): boolean =>
  id.endsWith('_sign') || id.endsWith('_banner')

/**
 * ブロックの押し反応。
 *
 * [確定: 26.2 Blocks の登録と PistonBaseBlock.isPushable]。実機 1.21.1 で確かめたもの:
 *   - 押せる: 検知レール・銅の電球・トラップドア・塀・ガラス板 (#384)
 *   - 壊れる: 扉・budding_amethyst (#384)
 *   - 動かない: クラフター (#384)
 * それ以外は 26.2 の読みだけ (fixture piston-push-* で確かめる)。
 */
export function pushReactionOf(block: BlockState): PushReaction {
  switch (block.type) {
    // 貼り付き素子・ダイオード [確定: 26.2 — いずれも pushReaction(DESTROY)]
    case 'wire':
    case 'torch':
    case 'wall_torch':
    case 'lever':
    case 'button_stone':
    case 'button_wood':
    case 'pressure_plate_wood':
    case 'pressure_plate_stone':
    case 'weighted_pressure_plate_light':
    case 'weighted_pressure_plate_heavy':
    case 'repeater':
    case 'comparator':
      return 'destroy'
    // 扉 (上下どちらの半分も) [確定: 26.2 Blocks — 木・鉄・銅の扉はすべて DESTROY]
    case 'door_wood':
    case 'door_iron':
      return 'destroy'
    // 水と泡柱 [確定: 26.2 Blocks.WATER / BUBBLE_COLUMN — DESTROY]。
    // sim の水は縦にしか動かないので、壊したあとに横から流れ込む挙動は再現しない
    case 'water':
    case 'bubble_column':
      return 'destroy'
    // 伸びたピストンのヘッドと移動中のブロックは障害物 [確定: 26.2 — pushReaction(BLOCK)]
    case 'piston_head':
    case 'moving_piston':
      return 'block'
    // ロードストーン [確定: 26.2 Blocks.LODESTONE — pushReaction(BLOCK)]
    case 'lodestone':
      return 'block'
    case 'solid':
      // 名前で割る (取り込み時に blockNames.ts の表から載せる)。無ければ NORMAL
      return block.pushReaction ?? 'normal'
    case 'container':
      // シュルカーボックスは BlockEntity を持つが DESTROY が先に効く
      // [確定: 26.2 Blocks.shulkerBoxProperties — pushReaction(DESTROY)]
      return block.name !== undefined && isShulkerBoxName(block.name) ? 'destroy' : 'normal'
    case 'decor': {
      const id = decorId(block.name)
      if (DECOR_DESTROY_EXACT.has(id) || isHeadOrSkullId(id)) return 'destroy'
      return 'normal'
    }
    default:
      // ピストン本体はここに来ない (呼び出し側が伸長状態で決める)。
      // ランプ・音符ブロック・信号源ブロック・オブザーバー・レール 4 種・スライム/蜂蜜・
      // ガラス・スラブ・銅の電球・トラップドア・フェンスゲート・塀・板・大釜・
      // コンポスター・ソウルサンドなどはすべて指定なし = NORMAL
      return 'normal'
  }
}

/**
 * BlockEntity を持つか。isPushable の最後の判定で、NORMAL のものはこれで動かなくなる。
 * [確定: 26.2 — コンテナ 3 種・ホッパー・ドロッパー/ディスペンサー・クラフター・
 *  書見台・看板・旗は BaseEntityBlock。彫刻された本棚も同じ (名前で載せる)]
 *
 * コンパレーターと頭・シュルカーボックスも BE を持つが、押し反応が DESTROY なので
 * ここに来る前に決まる。
 */
export function hasBlockEntity(block: BlockState): boolean {
  switch (block.type) {
    case 'container':
    case 'hopper':
    case 'dropper':
    case 'dispenser':
    case 'crafter':
    case 'lectern':
    case 'comparator':
      return true
    case 'solid':
      return block.hasBlockEntity === true
    case 'decor':
      return isDecorWithBlockEntity(decorId(block.name))
    default:
      return false
  }
}
