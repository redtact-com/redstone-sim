import { EditorPage } from './EditorPage'
import { DemoPage } from './DemoPage'

/**
 * 純粋レッドストーンシミュレーターのルート。
 *
 * ゲーム要素（ステージ/ゴール判定/バックエンド API/素材制限）は持たず、
 * 回路エディタ + シミュレーションのみを単一画面で提供する。
 *
 * `?demo=<fixture名>` が付いているときは fixture 再生デモモード (issue #70) を
 * 表示する。通常の editor UI には影響しない。
 */
export default function App() {
  const params = new URLSearchParams(window.location.search)
  const demo = params.get('demo')
  if (demo !== null) {
    return <DemoPage fixtureName={demo} />
  }
  return <EditorPage />
}
