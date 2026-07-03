// ============================================================
// コンテナ物流 (ホッパー / ドロッパー / 汎用コンテナ) の定数・変換
// issue #65 / C6' (13 §4.2 スコープ入り)
//
// エンティティ境界原則 (13 §2): アイテムは「コンテナ内の数値」としてのみ
// 存在する。ワールドへのドロップ・吸い取り (アイテムエンティティ) は扱わない。
// スタック種別・スロット配置は持たず、コンテナごとに 1 本の「個数 (count)」で
// 表す。
//
// 充填率 → コンパレーター信号の変換 [確定: 02 §6 comparator —
//   AbstractContainerMenu.getRedstoneSignalFromContainer]:
//     f = (Σ 各スロットの count / maxStackSize) / スロット数
//     signal = Mth.lerpDiscrete(f, 0, 15) = floor(f * 14) + (f > 0 ? 1 : 0)
//
// 容量の抽象化 (設計判断, 02 §6 「既知の抽象化」):
//   sim は個数 1 本しか持たないため、アイテムが「スロット 0 から順にスタック
//   される」(= ホッパー/ドロッパーの実挿入順) と仮定する。この仮定の下では
//     f = count / (スロット数 × 64)
//   が per-slot 式と厳密一致する (満スタックが並ぶだけなので端数も含め等価)。
//   よって容量 = スロット数 × 64 を用いて fillSignal(count, capacity) で信号を
//   求める。異種アイテムを別スロットに散らす配置は表現しない (単一種前提)。
// ============================================================

import type { BlockState, BlockType } from '../types.js'

/** ホッパーの転送クールダウン (gt) [確定: 26.2 HopperBlockEntity — setCooldown(8)]。 */
export const HOPPER_COOLDOWN = 8

/**
 * ドロッパー/ディスペンサーの発火遅延 (gt)
 * [確定: 26.2 DispenserBlock.neighborChanged — level.scheduleTick(pos, this, 4)]。
 * 立ち上がり受電で TRIGGERED を立て、この遅延の tile tick で dispenseFrom を実行。
 */
export const DROPPER_TICK_DELAY = 4

/** 1 スタックの最大個数 [確定: バニラ既定 64]。 */
export const STACK_SIZE = 64

/** ホッパーのスロット数 [確定: 26.2 HopperBlockEntity CONTAINER_SIZE=5]。 */
export const HOPPER_SLOTS = 5
/** ドロッパー/ディスペンサーのスロット数 [確定: 26.2 DispenserBlockEntity=9]。 */
export const DROPPER_SLOTS = 9
/** 汎用コンテナ (樽/チェスト) のスロット数 [確定: 26.2 barrel/chest=27]。 */
export const CONTAINER_SLOTS = 27

/** コンテナ種か (物流の対象になり得るブロック種)。 */
export function isContainerType(type: BlockType | undefined): boolean {
  return type === 'hopper' || type === 'dropper' || type === 'container'
}

/** コンテナ種のスロット数。 */
export function containerSlots(type: BlockType): number {
  switch (type) {
    case 'hopper':    return HOPPER_SLOTS
    case 'dropper':   return DROPPER_SLOTS
    case 'container': return CONTAINER_SLOTS
    default:          return 0
  }
}

/** コンテナ種の容量 (スロット数 × 64)。 */
export function containerCapacity(type: BlockType): number {
  return containerSlots(type) * STACK_SIZE
}

/**
 * 個数 → コンパレーター信号 (0-15)。
 * lerpDiscrete(count/capacity, 0, 15) = floor(f*14) + (f>0?1:0)。
 * capacity<=0 や count<=0 は 0。満杯 (count>=capacity) は 15。
 */
export function fillSignal(count: number, capacity: number): number {
  if (capacity <= 0 || count <= 0) return 0
  const f = Math.min(count, capacity) / capacity
  return Math.floor(f * 14) + 1
}

/**
 * ブロックの現在個数。物流に参加しないブロックは undefined。
 * - hopper / dropper: 常に count を持つ (物流に参加)
 * - container: count が定義されていれば物流、未定義なら「手動 signal の計測用
 *   ダミー」(C6)。後者は物流に不参加。
 */
export function containerCount(block: BlockState | null | undefined): number | undefined {
  if (!block) return undefined
  if (block.type === 'hopper' || block.type === 'dropper') return block.count
  if (block.type === 'container') return block.count
  return undefined
}

/** ブロックが物流に参加するコンテナか (個数を持つか)。 */
export function containerParticipates(block: BlockState | null | undefined): boolean {
  return containerCount(block) !== undefined
}

/** コンテナが 1 個受け入れられるか (個数を持ち、容量に空きがある)。 */
export function canContainerAccept(block: BlockState | null | undefined): boolean {
  if (!block || !isContainerType(block.type)) return false
  const c = containerCount(block)
  if (c === undefined) return false
  return c < containerCapacity(block.type)
}

/**
 * コンパレーターが背面から読む実効信号 (0-15)。
 * - hopper / dropper: fillSignal(count, 容量)
 * - container: count があれば fillSignal、無ければ手動 signal (C6)
 * - コンテナ以外: 0
 */
export function effectiveContainerSignal(block: BlockState | null | undefined): number {
  if (!block) return 0
  if (block.type === 'hopper' || block.type === 'dropper') {
    return fillSignal(block.count, containerCapacity(block.type))
  }
  if (block.type === 'container') {
    return block.count !== undefined
      ? fillSignal(block.count, CONTAINER_SLOTS * STACK_SIZE)
      : block.signal
  }
  return 0
}
