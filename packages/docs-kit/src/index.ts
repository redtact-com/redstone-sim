/**
 * @redstone/docs-kit
 *
 * 読む用の Web (docs-web) と、のちの解説サイトが共有する部品 (#434)。
 *
 * - この入口は**軽い物だけ**を出す (型・ID の決まり・検索・状態の保存・fixture の札の HTML)。DOM にも WebGL にも触らない
 * - 3D/2D のビューアは `@redstone/docs-kit/viewer` に分ける。deepslate を引き込むので、
 *   読む側が「表示」を押した時にだけ dynamic import する
 * - 図 (自前の SVG の 4 部品と文言) は `@redstone/docs-kit/diagrams` に分ける。図のあるページでだけ読む
 */

export const DOCS_KIT_VERSION = 1

export { DOCS_DATA_VERSION, MARK_KINDS, MARK_LABELS } from './types.js'
export type {
  Manifest, ManifestDoc, ManifestGroup, ManifestPage, FixtureInfo,
  PageData, PageSection, SectionRecord, MarkKind, MarkCounts,
} from './types.js'
export { docOf, anchorOf, headingDomId, pageDataPath, fixtureDataPath, docsHref, parseDocsHash, findPage } from './ids.js'
export {
  FIXTURE_ENTITY_ACTIONS, FIXTURE_NOTE_TOO_BIG, FIXTURE_NOTE_SKIP, FIXTURE_NOTE_ENTITIES, FIXTURE_NOTE_ENGINE,
  FIXTURE_OPEN_LABEL, FIXTURE_CLOSE_LABEL, fixtureCardHtml, fixtureCardsHtml,
} from './fixture-card.js'
export type { FixtureCardInfo } from './fixture-card.js'
export {
  STATUS_VERSION, DEFAULT_STATUS_PREFIX, statusKey, emptyStatus, parseStatus, mergeStatus,
  summarizeStatus, statusFileName, clampUnderstanding, createStatusStore,
} from './status.js'
export type {
  PageStatus, StatusData, StatusSummary, StatusSnapshot, StatusStore, StatusStoreOptions, ImportResult,
} from './status.js'
export {
  SEARCH_WEIGHTS, SEARCH_LIMIT, tokenize, buildSearchIndex, openSearchIndex, plainText, makeSnippet,
} from './search.js'
export type {
  SearchInput, SearchIndexData, SearchHit, SearchOptions, SearchEngine, Snippet,
} from './search.js'
