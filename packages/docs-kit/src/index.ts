/**
 * @redstone/docs-kit
 *
 * 読む用の Web (docs-web) と、のちの解説サイトが共有する部品 (#434)。
 *
 * - この入口は**軽い物だけ**を出す (型・ID の決まり・検索・状態の保存)。DOM にも WebGL にも触らない
 * - 3D/2D のビューアは `@redstone/docs-kit/viewer` に分ける。deepslate を引き込むので、
 *   読む側が「表示」を押した時にだけ dynamic import する
 */

export const DOCS_KIT_VERSION = 1

export { DOCS_DATA_VERSION } from './types.js'
export type {
  Manifest, ManifestDoc, ManifestGroup, ManifestPage, FixtureInfo,
  PageData, PageSection, SectionRecord, MarkKind, MarkCounts,
} from './types.js'
export { docOf, anchorOf, headingDomId, pageDataPath, docsHref, parseDocsHash, findPage } from './ids.js'
