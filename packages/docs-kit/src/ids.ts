/**
 * ID と URL の決まり (#434)。生成器・読む画面・検索・CLI が同じ関数を使う。
 * ID の形は types.ts の頭の表にある。
 */

import type { Manifest } from './types.js'

/** ID からメモの ID を取る (`v07/4.3` → `v07`) */
export function docOf(id: string): string {
  const i = id.indexOf('/')
  return i < 0 ? id : id.slice(0, i)
}

/** 節の ID からページ内のアンカーを取る (`v07/4.3.2` → `4.3.2`)。URL の `?s=` に使う */
export function anchorOf(sectionId: string): string {
  const i = sectionId.indexOf('/')
  return i < 0 ? '' : sectionId.slice(i + 1)
}

/** HTML の見出しの `id` (`sec-4.3.2`)。`document.getElementById` で引く */
export function headingDomId(anchor: string): string {
  return `sec-${anchor}`
}

/** ページのデータの相対パス (`data/` から。`pages/v07/4.3.json`) */
export function pageDataPath(pageId: string): string {
  return `pages/${pageId}.json`
}

/**
 * ハッシュ型の URL を作る (`#/v07/4.3?s=4.3.2`)。
 * 節がページの頭なら `?s=` は付けない。
 */
export function docsHref(pageId: string, sectionId?: string): string {
  if (!sectionId || sectionId === pageId) return `#/${pageId}`
  return `#/${pageId}?s=${encodeURIComponent(anchorOf(sectionId))}`
}

/** ハッシュを読む。`#/v07/4.3?s=4.3.2` → `{ id: 'v07/4.3', s: '4.3.2' }`。形が違えば null */
export function parseDocsHash(hash: string): { id: string; s: string | null } | null {
  const m = /^#\/([^?]*)(?:\?(.*))?$/.exec(hash)
  if (!m) return null
  let id: string
  try { id = decodeURIComponent(m[1]) } catch { return null }
  const s = new URLSearchParams(m[2] ?? '').get('s')
  return { id: id.replace(/\/+$/, ''), s: s || null }
}

/**
 * ID からページを探す。ページの ID でなくても、その節が入っているページへ寄せる。
 *
 * - ページの ID ならそのまま
 * - 割った `##` の ID (`v07/4`) とメモの ID (`v07`) は、先頭のページ
 * - ページの中の節 (`v07/4.3.2`・`v07/4.5/n2`) は、後ろを 1 段ずつ削って当たったページ
 *
 * 戻り値の `section` は、ページの頭でなければ元の ID (ページ内へスクロールする先)。
 */
export function findPage(manifest: Manifest, id: string): { page: string; section: string | null } | null {
  const pages = pageIdSet(manifest)
  if (pages.has(id)) return { page: id, section: null }
  for (const d of manifest.docs) {
    if (d.key === id) return { page: d.groups[0].pages[0], section: null }
    for (const g of d.groups) if (g.id === id) return { page: g.pages[0], section: g.pages[0] === id ? null : id }
  }
  let cur = id
  for (;;) {
    const cut = Math.max(cur.lastIndexOf('.'), cur.lastIndexOf('/'))
    if (cut <= 0) return null
    cur = cur.slice(0, cut)
    if (pages.has(cur)) return { page: cur, section: id }
    if (!cur.includes('/')) return null
  }
}

const pageSets = new WeakMap<Manifest, Set<string>>()
function pageIdSet(manifest: Manifest): Set<string> {
  let s = pageSets.get(manifest)
  if (!s) { s = new Set(manifest.pages.map(p => p.id)); pageSets.set(manifest, s) }
  return s
}
