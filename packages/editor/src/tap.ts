import type { BlockState, Dir6 } from '@redstone/sim'
import type { PlaceableType } from './editor.js'
import { allowedFacings } from './facing.js'

/**
 * セルをタップしたとき何が起きるか (#117)。
 *
 * これまで本体アプリ (app/src/editorTap.ts) と下流 redstone-maker
 * (src/domain/interact.ts) が別々に持っており、しかも**仕様が食い違っていた**:
 *
 * | 状況 | 本体 | 下流 |
 * |---|---|---|
 * | 同種ブロックを再タップ | 選択して編集 (向き・遅延をバーで変える) | その場で N→E→S→W 回転 |
 * | ドラッグ中に同種セル | そのまま選択 | スキップ (誤回転防止) |
 *
 * どちらも「操作系の好み」であって正解が 1 つではないため、**方針をパラメータ化**して
 * 1 か所に集約する。既定は本体の操作系 (select)。
 */

export type TapPhase = 'start' | 'drag'

/** 同種ブロックを再タップしたときの方針 */
export type SameTypePolicy = 'select' | 'rotate'

export type TapAction =
  /** wire ツールで既存 wire → dot ⇄ cross */
  | { kind: 'wire-toggle' }
  /** 同種 → 選択して編集に入る */
  | { kind: 'select' }
  /** 同種 → 次の向きへ回す */
  | { kind: 'rotate'; facing: Dir6 }
  /** 空セル、または別種 (置き換え) */
  | { kind: 'place' }
  /** 何もしない (ドラッグ中の同種セル等) */
  | { kind: 'none' }

export interface TapOptions {
  phase?: TapPhase
  /** 既定 'select' (本体アプリの操作系) */
  sameType?: SameTypePolicy
}

/** 向きの回転順。その素子が取れる向きの中で次へ送る */
export function nextFacing(type: PlaceableType, current: Dir6 | undefined): Dir6 | undefined {
  const dirs = allowedFacings(type)
  if (dirs.length === 0) return undefined
  const i = current === undefined ? -1 : dirs.indexOf(current)
  return dirs[(i + 1) % dirs.length]
}

export function decideTap(
  existing: BlockState | null,
  tool: string,
  opts: TapOptions = {},
): TapAction {
  const phase = opts.phase ?? 'start'
  const sameType = opts.sameType ?? 'select'

  const isSame = !!existing && existing.type !== 'air' && existing.type === tool

  // wire × wire だけは方針によらず形状トグル (置き直しても見た目が変わらないため)
  if (isSame && tool === 'wire') {
    return phase === 'start' ? { kind: 'wire-toggle' } : { kind: 'none' }
  }

  if (isSame) {
    if (phase !== 'start') return { kind: 'none' }   // ドラッグ中の誤操作を防ぐ
    if (sameType === 'select') return { kind: 'select' }
    const cur = (existing as unknown as Record<string, unknown>).facing as Dir6 | undefined
    const next = nextFacing(tool as PlaceableType, cur)
    return next === undefined ? { kind: 'none' } : { kind: 'rotate', facing: next }
  }

  // 空セル、または別種 = 置き換え
  return { kind: 'place' }
}

/** 旧 API 互換 (本体アプリの 3 分岐)。#99 で決めた挙動をそのまま返す */
export type CellTapAction = 'wire-toggle' | 'select' | 'place'

export function decideCellTap(existing: BlockState | null, selectedType: string): CellTapAction {
  const action = decideTap(existing, selectedType)
  return action.kind === 'none' ? 'place' : (action.kind as CellTapAction)
}
