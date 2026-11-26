import { DOCS_DATA_VERSION, openSearchIndex, pageDataPath } from '@redstone/docs-kit'
import type { Manifest, PageData, SearchEngine, SearchIndexData } from '@redstone/docs-kit'
import { dataUrl } from './paths'

/**
 * 生成物を取る (#434)。
 *
 * - 目次 (manifest.json) は最初に 1 回
 * - ページは開いた時に 1 枚ずつ。取った物は覚えておき、同じページを 2 回取らない
 * - 検索の索引 (search-index.json) は、検索の欄に初めて入った時に 1 回
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
