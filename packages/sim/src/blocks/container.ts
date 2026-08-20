// ============================================================
// コンテナ物流 (ホッパー / ドロッパー / 汎用コンテナ) の定数・変換
// issue #65 / C6' (13 §4.2 スコープ入り)
//
// エンティティ境界原則 (13 §2): アイテムは「コンテナ内の数値」としてのみ
// 存在する。ワールドへのドロップ・吸い取り (アイテムエンティティ) は扱わない。
//
// #194 でスロットモデルに変更した。それまでは「個数 1 本の数値・スタック上限
// 64 固定」で、**スタック上限の違うアイテムを混ぜて強度を微調整する回路**
// (実在の配布回路で使われる定番手法) が再現できなかった。
//
// 充填率 → コンパレーター信号の変換 [確定: 02 §6 comparator —
//   AbstractContainerMenu.getRedstoneSignalFromContainer]:
//     f = (Σ 各スロットの count / maxStackSize) / スロット数
//     signal = lerpDiscrete(f, 0, 15) 相当 = f が 0 なら 0、それ以外は f × 14 の切り捨て + 1
//
// [実機測定でこの式を 7 ケース確認 (#194)。ホッパー (5 スロット):
//   snowball 14 (16 スタック) = 3 / player_head 14 (64) = 1 / 混載 11+3 = 2 /
//   iron_axe 1 (スタック不可) = 3 / snowball 1 = 1 / gold_ingot 1 = 1 /
//   iron_axe ×5 スロット = 15]
//
// アイテム ID を保持する理由 (#194 の判断): 強度も転送順も stack しか見ないが、
// ID を捨てると**上限が同じ別アイテムが 1 スロットに統合されてしまう**。
// 実機では別スロットを消費するため、スロットを使い切るタイミングがずれる。
// ============================================================

import type { BlockState, BlockType, ContainerSlots, ItemStack, StackSize } from '../types.js'
import { REPRESENTATIVE_ITEM } from './itemStacks.js'

/** ホッパーの転送クールダウン (gt) [確定: 26.2 HopperBlockEntity — クールダウンを 8 に設定]。 */
export const HOPPER_COOLDOWN = 8

/**
 * ドロッパー/ディスペンサーの発火遅延 (gt)
 * [確定: 26.2 DispenserBlock.neighborChanged — 4gt の tile tick を予約する]。
 * 立ち上がり受電で TRIGGERED を立て、この遅延の tile tick で dispenseFrom を実行。
 */
export const DROPPER_TICK_DELAY = 4

/** 既定のスタック上限 [確定: バニラ既定 64]。ID 表に無いアイテムはこれ。 */
export const STACK_SIZE: StackSize = 64

/** ホッパーのスロット数 [確定: 26.2 HopperBlockEntity CONTAINER_SIZE=5]。 */
export const HOPPER_SLOTS = 5
/** ドロッパー/ディスペンサーのスロット数 [確定: 26.2 DispenserBlockEntity=9]。 */
export const DROPPER_SLOTS = 9
/** 汎用コンテナ (樽/チェスト) のスロット数 [確定: 26.2 barrel/chest=27]。 */
export const CONTAINER_SLOTS = 27

/** コンテナ種か (物流の対象になり得るブロック種)。 */
export function isContainerType(type: BlockType | undefined): boolean {
  return type === 'hopper' || type === 'dropper' || type === 'dispenser'
    || type === 'container'
}

/** コンテナ種のスロット数。 */
export function containerSlots(type: BlockType): number {
  switch (type) {
    case 'hopper':    return HOPPER_SLOTS
    case 'dropper':
    case 'dispenser': return DROPPER_SLOTS
    case 'container': return CONTAINER_SLOTS
    default:          return 0
  }
}

/** 空のスロット列を作る。 */
export function emptySlots(type: BlockType): ContainerSlots {
  return new Array<ItemStack | null>(containerSlots(type)).fill(null)
}

/**
 * スロット列 → コンパレーター信号 (0-15)。
 *   f = Σ(count / stack) / スロット数
 *   signal = f が 0 なら 0、それ以外は f × 14 の切り捨て + 1
 */
export function fillSignal(slots: ContainerSlots, slotCount: number): number {
  if (slotCount <= 0) return 0
  let sum = 0
  for (const s of slots) if (s) sum += s.count / s.stack
  if (sum <= 0) return 0
  const f = Math.min(sum / slotCount, 1)
  return Math.floor(f * 14) + 1
}

/** スロット列の総個数 (アイテムが 1 個でもあるかの判定に使う)。 */
export function totalItems(slots: ContainerSlots): number {
  let n = 0
  for (const s of slots) if (s) n += s.count
  return n
}

/**
 * ブロックの現在のスロット列。物流に参加しないブロックは undefined。
 * - hopper / dropper / dispenser: 常に持つ
 * - container: slots が定義されていれば物流、未定義なら手動 signal (C6)
 */
export function containerSlotsOf(block: BlockState | null | undefined): ContainerSlots | undefined {
  if (!block) return undefined
  if (block.type === 'hopper' || block.type === 'dropper' || block.type === 'dispenser') {
    return block.slots
  }
  if (block.type === 'container') return block.slots
  return undefined
}

/** ブロックが物流に参加するコンテナか。 */
export function containerParticipates(block: BlockState | null | undefined): boolean {
  return containerSlotsOf(block) !== undefined
}

/**
 * 先頭の非空スロットから 1 個取り出す [確定: 実機測定 (#194) — 混載ホッパーは
 * slot0 が尽きてから slot1 に移る]。取れなければ null。
 */
export function takeOne(slots: ContainerSlots): { item: ItemStack; slots: ContainerSlots } | null {
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i]
    if (!s || s.count <= 0) continue
    const next = slots.slice()
    next[i] = s.count > 1 ? { ...s, count: s.count - 1 } : null
    return { item: { ...s, count: 1 }, slots: next }
  }
  return null
}

/**
 * 1 個入れる。**同じ ID の空きスタックへマージ → 無ければ先頭の空きスロット**
 * [確定: 26.2 HopperBlockEntity.addItem]。入らなければ null。
 */
export function putOne(slots: ContainerSlots, item: ItemStack): ContainerSlots | null {
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i]
    if (s && s.id === item.id && s.count < s.stack) {
      const next = slots.slice()
      next[i] = { ...s, count: s.count + 1 }
      return next
    }
  }
  for (let i = 0; i < slots.length; i++) {
    if (slots[i] === null) {
      const next = slots.slice()
      next[i] = { ...item, count: 1 }
      return next
    }
  }
  return null
}

/** そのアイテムを 1 個受け入れられるか。 */
export function canContainerAcceptItem(
  block: BlockState | null | undefined, item: ItemStack,
): boolean {
  if (!block || !isContainerType(block.type)) return false
  const slots = containerSlotsOf(block)
  if (slots === undefined) return false
  return putOne(slots, item) !== null
}

/**
 * コンパレーターが背面から読む実効信号 (0-15)。
 * - hopper / dropper / dispenser: スロットから導出
 * - container: slots があればスロット、無ければ手動 signal (C6)
 * - コンテナ以外: 0
 */
export function effectiveContainerSignal(block: BlockState | null | undefined): number {
  if (!block) return 0
  if (block.type === 'hopper' || block.type === 'dropper' || block.type === 'dispenser') {
    return fillSignal(block.slots, containerSlots(block.type))
  }
  if (block.type === 'container') {
    return block.slots !== undefined
      ? fillSignal(block.slots, CONTAINER_SLOTS)
      : block.signal
  }
  return 0
}

/**
 * 指定のコンパレーター信号 (0-15) になる**最小個数**のスロット列を作る (#236)。
 *
 * `fillSignal` の逆写像。`f = 総個数 / 容量`, `signal = floor(f*14)+1` を解いて
 * `count = ceil((signal-1) * 容量 / 14)`。**15 は容量いっぱい**でしか出ない
 * (`f >= 1` が要る)、**1 は 1 個でよい**、という両端が直感に反する。
 *
 * **容量が 14 個未満だと刻めない信号が出る** (スタック不可アイテムだけの
 * ホッパーは 5 個しか入らず、信号 1・2 を作れない)。そのときは切り上げた分だけ
 * 上の信号になる — 樽 (27 スロット) では起きない。
 */
export function slotsForSignal(
  type: BlockType, signal: number, stack: StackSize = STACK_SIZE, id?: string,
): ContainerSlots {
  const slotCount = containerSlots(type)
  const s = Math.max(0, Math.min(15, Math.floor(signal)))
  if (s === 0 || slotCount === 0) return emptySlots(type)
  const cap = slotCount * stack
  return slotsFromCount(type, Math.max(1, Math.ceil(((s - 1) * cap) / 14)), stack, id)
}

/**
 * 「同じアイテムを n 個、slot 0 から詰める」スロット列を作る (#194)。
 *
 * エディタ (スタック種別ごとに代表アイテム 1 種) と、実機 fixture の
 * `items: <数>` 形式、旧 `count` からの移行で使う。
 * 容量を超える分は切り捨てる。
 */
export function slotsFromCount(
  type: BlockType, count: number, stack: StackSize = STACK_SIZE, id?: string,
): ContainerSlots {
  const n = containerSlots(type)
  const out = new Array<ItemStack | null>(n).fill(null)
  const itemId = id ?? REPRESENTATIVE_ITEM[stack]
  let left = Math.max(0, Math.min(count, n * stack))
  for (let i = 0; i < n && left > 0; i++) {
    const c = Math.min(left, stack)
    out[i] = { id: itemId, stack, count: c }
    left -= c
  }
  return out
}
