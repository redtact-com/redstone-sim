import { DOCS_DATA_VERSION, fixtureDataPath, openSearchIndex, pageDataPath } from '@redstone/docs-kit'
import type { Manifest, PageData, SearchEngine, SearchIndexData } from '@redstone/docs-kit'
import type { Fixture } from '@redstone/sim'
import { dataUrl } from './paths'

/**
 * 生成物を取る (#434)。
 *
 * - 目次 (manifest.json) は最初に 1 回
 * - ページは開いた時に 1 枚ずつ。取った物は覚えておき、同じページを 2 回取らない
 * - 検索の索引 (search-index.json) は、検索の欄に初めて入った時に 1 回
 * - ビューアのチャンクと fixture の JSON は、札の「表示」を押した時に初めて取る
 * - 図のチャンクは、図のある節を持つページを初めて開いた時に取る
 * - 失敗した時は覚えない (もう一度開けば取り直す)
 */
async function getJson<T extends { v: number }>(rel: string): Promise<T> {
  const url = dataUrl(rel)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  const json = (await res.json()) as T
  if (json.v !== DOCS_DATA_VERSION) throw new Error(`生成物の版が違う (${json.v})。読み込み直してください`)
  return json
}

let manifest: Promise<Manifest> | null = null
export function loadManifest(): Promise<Manifest> {
  if (!manifest) {
    manifest = getJson<Manifest>('manifest.json')
    manifest.catch(() => { manifest = null })
  }
  return manifest
}

const pages = new Map<string, Promise<PageData>>()
export function loadPage(id: string): Promise<PageData> {
  let p = pages.get(id)
  if (!p) {
    p = getJson<PageData>(pageDataPath(id))
    pages.set(id, p)
    p.catch(() => { pages.delete(id) })
  }
  return p
}

/** 次のページを先に取っておく。失敗は黙って捨てる (開いた時に取り直す) */
export function prefetchPage(id: string | null): void {
  if (id) loadPage(id).catch(() => {})
}

/** 検索の索引 (`data/` からの相対パス)。e2e が「検索の欄に入るまで取られない」を見るのに使う名前 */
export const SEARCH_INDEX_FILE = 'search-index.json'

let search: Promise<SearchEngine> | null = null
/** 検索の索引を取って開く。検索の欄に初めて入った時と、検索の画面を直に開いた時に呼ぶ */
export function loadSearch(): Promise<SearchEngine> {
  if (!search) {
    search = getJson<SearchIndexData>(SEARCH_INDEX_FILE).then(openSearchIndex)
    search.catch(() => { search = null })
  }
  return search
}

/** ビューアの入口 (deepslate と sim を含む別のチャンク)。e2e が「押すまで取られない」を見る */
type ViewerModule = typeof import('@redstone/docs-kit/viewer')
let viewer: Promise<ViewerModule> | null = null
export function loadViewer(): Promise<ViewerModule> {
  if (!viewer) {
    // ビューアの中の見た目 (viewer.css) も一緒に取る。札の見た目は最初の HTML に出るので docs.css に残す
    viewer = Promise.all([import('@redstone/docs-kit/viewer'), import('./viewer.css')]).then(([m]) => m)
    viewer.catch(() => { viewer = null })
  }
  return viewer
}

/** 図の入口 (4 部品と文言を含む別のチャンク)。図のあるページを開いた時に取る */
type DiagramsModule = typeof import('@redstone/docs-kit/diagrams')
let diagrams: Promise<DiagramsModule> | null = null
let diagramsReady: DiagramsModule | null = null
export function loadDiagrams(): Promise<DiagramsModule> {
  if (!diagrams) {
    diagrams = import('@redstone/docs-kit/diagrams').then(m => {
      // 図の見た目 (色は CSS 変数で明暗に対応) を 1 回だけ入れる
      const style = document.createElement('style')
      style.setAttribute('data-dg-css', '')
      style.textContent = m.DIAGRAM_CSS
      document.head.appendChild(style)
      diagramsReady = m
      return m
    })
    diagrams.catch(() => { diagrams = null })
  }
  return diagrams
}

/** 取り終えた図の入口。まだなら null (本文を描く時に待たずに読む) */
export function diagramsNow(): DiagramsModule | null {
  return diagramsReady
}

const fixtures = new Map<string, Promise<Fixture>>()
/** 埋め込める fixture 1 本 (`data/fixtures/<名前>.json`) */
export function loadFixture(name: string): Promise<Fixture> {
  let p = fixtures.get(name)
  if (!p) {
    const url = dataUrl(fixtureDataPath(name))
    p = fetch(url).then(res => {
      if (!res.ok) throw new Error(`${res.status} ${url}`)
      return res.json() as Promise<Fixture>
    })
    fixtures.set(name, p)
    p.catch(() => { fixtures.delete(name) })
  }
  return p
}
