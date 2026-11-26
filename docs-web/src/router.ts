import { useEffect, useState } from 'react'
import { parseDocsHash } from '@redstone/docs-kit'

/**
 * ハッシュ型のルータ (#434)。`/docs/#/v07/4.3?s=4.3.2`。
 * Pages は未知のパスにエディタを返すので、パス型にしない。
 *
 * 検索は `#/_search?q=リピーター+ロック&doc=v07&f=need,fx` (戻る・進む・再読み込みで同じ結果に戻れる)。
 */
export type Route =
  | { kind: 'home' }
  | { kind: 'wiring' }
  | { kind: 'page'; id: string; s: string | null }
  | ({ kind: 'search' } & SearchQuery)

/** 検索の絞り込みの旗: [要実機] あり・[版差] あり・fixture あり・未読だけ */
export const SEARCH_FLAGS = ['need', 'ver', 'fx', 'unread'] as const
export type SearchFlag = typeof SEARCH_FLAGS[number]

export interface SearchQuery {
  q: string
  /** メモの ID (`v07`)。null は全部 */
  doc: string | null
  flags: SearchFlag[]
}

export const EMPTY_SEARCH: SearchQuery = { q: '', doc: null, flags: [] }

export function parseRoute(hash: string): Route {
  const p = parseDocsHash(hash)
  if (!p || p.id === '') return { kind: 'home' }
  if (p.id === '_wiring') return { kind: 'wiring' }
  if (p.id === '_search') {
    const at = hash.indexOf('?')
    const params = new URLSearchParams(at < 0 ? '' : hash.slice(at + 1))
    const f = (params.get('f') ?? '').split(',')
    return {
      kind: 'search',
      q: params.get('q') ?? '',
      doc: params.get('doc') || null,
      flags: SEARCH_FLAGS.filter(k => f.includes(k)),
    }
  }
  return { kind: 'page', id: p.id, s: p.s }
}

/** 検索の画面の URL */
export function searchHref(s: SearchQuery): string {
  const params = new URLSearchParams()
  params.set('q', s.q)
  if (s.doc) params.set('doc', s.doc)
  if (s.flags.length) params.set('f', SEARCH_FLAGS.filter(k => s.flags.includes(k)).join(','))
  return `#/_search?${params.toString().replace(/%2C/g, ',')}`
}

export function useRoute(): Route {
  const [hash, setHash] = useState(() => window.location.hash)
  useEffect(() => {
    const on = () => setHash(window.location.hash)
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return parseRoute(hash)
}
