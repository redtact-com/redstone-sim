// ============================================================
// 回路全体の平行移動と、盤面に収める切り捨て (#226)
//
// ここは純粋関数だけ。**盤面の外へ出たブロックをすぐ捨てない**のが要点で、
// 「preview で見せて警告 → 確定で切り捨て」の流れ (ユーザ判断 B/C) を成り立たせる。
// 行き過ぎたら戻せるようにするため、移動そのものは範囲を制限しない。
// ============================================================

import type { BlockState } from '@redstone/sim'
import type { BoardSize } from './board.js'
import { isInsideBoard, blocksExtent, normalizeBoardSize } from './board.js'

export type BlockMap = Map<string, BlockState>

const key3 = (x: number, y: number, z: number): string => `${x},${y},${z}`

const parseKey = (key: string): [number, number, number] => {
  const [x, y, z] = key.split(',').map(Number)
  return [x, y, z]
}

/**
 * 全ブロックを平行移動する。**盤面の外に出ても捨てない**。
 * 相対位置は必ず保たれる (回路が壊れないため)。
 */
export function translateBlocks(blocks: BlockMap, dx: number, dy: number, dz: number): BlockMap {
  const out: BlockMap = new Map()
  for (const [key, block] of blocks) {
    const [x, y, z] = parseKey(key)
    out.set(key3(x + dx, y + dy, z + dz), block)
  }
  return out
}

/** 最小座標を原点 (0,0,0) へ寄せる。インポートで使う (ユーザ判断 D) */
export function normalizeToOrigin(blocks: BlockMap): BlockMap {
  const ext = blocksExtent(blocks)
  if (!ext) return new Map(blocks)
  return translateBlocks(blocks, -ext.min.x, -ext.min.y, -ext.min.z)
}

export interface ClipResult {
  /** 盤面に収まったブロック */
  kept: BlockMap
  /** 盤面の外にあって捨てられたブロック */
  dropped: BlockMap
}

/** 盤面に収まらないブロックを分ける。確定の瞬間だけ呼ぶ */
export function clipToBoard(blocks: BlockMap, board: BoardSize): ClipResult {
  const kept: BlockMap = new Map()
  const dropped: BlockMap = new Map()
  for (const [key, block] of blocks) {
    const [x, y, z] = parseKey(key)
    ;(isInsideBoard(x, y, z, board) ? kept : dropped).set(key, block)
  }
  return { kept, dropped }
}

/** 盤面の外にあるブロックの個数。警告の表示に使う (確定前) */
export function countOutside(blocks: BlockMap, board: BoardSize): number {
  let n = 0
  for (const key of blocks.keys()) {
    const [x, y, z] = parseKey(key)
    if (!isInsideBoard(x, y, z, board)) n++
  }
  return n
}

/**
 * 回路全体を盤面に収めるのに必要な最小の盤面サイズ。
 * インポートで「広げますか」を出すときの提案値に使う。
 *
 * **負の座標も面積として数える** (原点寄せ前に呼ばれても過小に出さないため)。
 */
export function requiredBoardSize(blocks: BlockMap): BoardSize {
  const ext = blocksExtent(blocks)
  if (!ext) return { x: 1, y: 1, z: 1 }
  return {
    x: Math.max(ext.max.x + 1, ext.size.x),
    y: Math.max(ext.max.y + 1, ext.size.y),
    z: Math.max(ext.max.z + 1, ext.size.z),
  }
}

/**
 * 盤面の中に収まる範囲で、寄せられるだけ寄せた移動量。
 * 「はみ出しているので中へ入れる」ボタン用。収まらない大きさなら 0 側へ寄せる。
 */
export function offsetToFitBoard(blocks: BlockMap, board: BoardSize): { dx: number; dy: number; dz: number } {
  const ext = blocksExtent(blocks)
  if (!ext) return { dx: 0, dy: 0, dz: 0 }
  // `-0` を返さないこと。移動量として持ち回ると座標キーに `-0` が混ざり、
  // 同じ位置が別キー扱いになる
  const noNegZero = (v: number): number => (v === 0 ? 0 : v)
  const fitAxis = (min: number, max: number, limit: number): number => {
    if (min < 0) return -min                       // 手前に出ている → 押し戻す
    // 奥に出ている → 引き戻す (0 より手前へは行かない)
    if (max >= limit) return noNegZero(Math.max(-min, limit - 1 - max))
    return 0
  }
  return {
    dx: fitAxis(ext.min.x, ext.max.x, board.x),
    dy: fitAxis(ext.min.y, ext.max.y, board.y),
    dz: fitAxis(ext.min.z, ext.max.z, board.z),
  }
}

/**
 * 「盤面を広げますか」の提案サイズ (#226 判断 C)。提案しない場合は null。
 *
 * null になるのは 2 通り:
 * - 今の盤面にすでに収まっている
 * - **広げても今と同じ** (盤面の上限で頭打ち)。押しても何も変わらないボタンを
 *   出すと「広げれば入る」と誤解させるので出さない
 */
export function growthProposal(current: BoardSize, need: BoardSize): BoardSize | null {
  if (need.x <= current.x && need.y <= current.y && need.z <= current.z) return null
  const grown = normalizeBoardSize({
    x: Math.max(current.x, need.x),
    y: Math.max(current.y, need.y),
    z: Math.max(current.z, need.z),
  })
  const changes = grown.x !== current.x || grown.y !== current.y || grown.z !== current.z
  return changes ? grown : null
}
