import { EditorPage } from './EditorPage'
import { DemoPage } from './DemoPage'
import { EmbedPage } from './EmbedPage'
import { lazy, Suspense } from 'react'

/**
 * 実機ライブ観測 (#366) は**開発時だけ**。
 *
 * `import.meta.env.DEV` は本番ビルドで false に置き換わるので、この分岐は
 * 丸ごと落ち、LivePage はバンドルにもチャンクにも出ない。
 * 本番で `?live=1` を開いても通常のエディタが出るだけ。
 */
const LivePage = import.meta.env.DEV
  ? lazy(() => import('./LivePage').then(m => ({ default: m.LivePage })))
  : null

/**
 * 純粋レッドストーンシミュレーターのルート。
 *
 * ゲーム要素（ステージ/ゴール判定/バックエンド API/素材制限）は持たず、
 * 回路エディタ + シミュレーションのみを単一画面で提供する。
 *
 * URL パラメータで表示を分岐する (現行は単一エントリのクエリ分岐):
 * - `?demo=<fixture名>` : fixture 再生デモモード (issue #70)
 * - `?embed=1`          : 埋め込みプレイヤー (issue #97)。postMessage で回路ロード・再生制御
 * - `?live=1`           : 実機ライブ観測 (issue #366)。**開発時のみ**
 * 上記が無ければ通常の editor UI。
 */
export default function App() {
  const params = new URLSearchParams(window.location.search)
  if (params.get('embed') !== null) {
    return <EmbedPage />
  }
  if (LivePage !== null && params.get('live') !== null) {
    return <Suspense fallback={null}><LivePage /></Suspense>
  }
  const demo = params.get('demo')
  if (demo !== null) {
    return <DemoPage fixtureName={demo} />
  }
  return <EditorPage />
}
