import type { Pos3D, WorldSnapshot } from '@redstone/sim'

export interface RedstoneViewerProps {
  snapshot: WorldSnapshot
  /** ブロックをクリックしたときのコールバック */
  onBlockClick?: (pos: Pos3D, button: 'left' | 'right') => void
  /** ブロックにホバーしたときのコールバック */
  onBlockHover?: (pos: Pos3D | null) => void
  /** ハイライト表示するブロック座標一覧（ゴール確認等） */
  highlight?: Pos3D[]
  className?: string
  style?: React.CSSProperties
}

/** ビューアー実装が共通で満たすインターフェース */
export interface RedstoneViewer {
  setSnapshot(snapshot: WorldSnapshot): void
  destroy(): void
}
