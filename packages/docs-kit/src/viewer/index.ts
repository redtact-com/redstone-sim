/**
 * @redstone/docs-kit/viewer
 *
 * fixture を記事の中で再生するビューアの入口 (#434)。deepslate と sim を引き込むので、
 * 読む側は「表示」が押された時にだけ dynamic import する (殻のチャンクに入れない)。
 */

export { FixtureViewer, FIXTURE_TICK_MS } from './FixtureViewer.js'
export type { FixtureViewerProps } from './FixtureViewer.js'
export { fixtureFrame, topDownDistance, sliceSnapshot, clampLayer, topLayer } from './frame.js'
export type { FixtureFrame } from './frame.js'
