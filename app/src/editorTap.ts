import type { BlockState } from '@redstone/sim'

/**
 * 編集モードで左クリック (消しゴム・右クリック削除を除く) したときの動作 (#99)。
 *
 * - `wire-toggle` : wire ツールで既存 wire をタップ → dot ⇄ cross 形状トグル
 * - `select`      : 選択中ツールと同種の既存ブロックをタップ → 選択して編集
 *                   (向き・遅延・モード等をバーへ反映)
 * - `place`       : 空セル、または選択中ツールと別種の既存ブロック → 配置
 *                   (別種は置き換え)。「ダストを持って既存リピーターに置くと置換」がこれ
 */
export type CellTapAction = 'wire-toggle' | 'select' | 'place'

export function decideCellTap(
  existing: BlockState | null,
  selectedType: string,
): CellTapAction {
  if (existing?.type === 'wire' && selectedType === 'wire') return 'wire-toggle'
  // 同種ブロックのみ選択/編集に入る。別種なら下の place で置き換える
  if (existing && existing.type !== 'air' && existing.type === selectedType) return 'select'
  return 'place'
}
