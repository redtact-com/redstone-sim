import { EditorPage } from './EditorPage'

/**
 * 純粋レッドストーンシミュレーターのルート。
 *
 * ゲーム要素（ステージ/ゴール判定/バックエンド API/素材制限）は持たず、
 * 回路エディタ + シミュレーションのみを単一画面で提供する。
 */
export default function App() {
  return <EditorPage />
}
