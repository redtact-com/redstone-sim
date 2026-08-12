import { EditorPage } from './EditorPage'
import { DemoPage } from './DemoPage'
import { EmbedPage } from './EmbedPage'

/**
 * 純粋レッドストーンシミュレーターのルート。
 *
 * ゲーム要素（ステージ/ゴール判定/バックエンド API/素材制限）は持たず、
 * 回路エディタ + シミュレーションのみを単一画面で提供する。
 *
 * URL パラメータで表示を分岐する (現行は単一エントリのクエリ分岐):
 * - `?demo=<fixture名>` : fixture 再生デモモード (issue #70)
 * - `?embed=1`          : 埋め込みプレイヤー (issue #97)。postMessage で回路ロード・再生制御
 * 上記が無ければ通常の editor UI。
 */
export default function App() {
  const params = new URLSearchParams(window.location.search)
  if (params.get('embed') !== null) {
    return <EmbedPage />
  }
  const demo = params.get('demo')
  if (demo !== null) {
    return <DemoPage fixtureName={demo} />
  }
  return <EditorPage />
}
