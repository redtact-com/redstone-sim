import { useEffect, useState } from 'react'
import { parseDocsHash } from '@redstone/docs-kit'

/**
 * ハッシュ型のルータ (#434)。`/docs/#/v07/4.3?s=4.3.2`。
 * Pages は未知のパスにエディタを返すので、パス型にしない。
 */
export type Route =
  | { kind: 'home' }
  | { kind: 'wiring' }
  | { kind: 'page'; id: string; s: string | null }

export function parseRoute(hash: string): Route {
  const p = parseDocsHash(hash)
  if (!p || p.id === '') return { kind: 'home' }
  if (p.id === '_wiring') return { kind: 'wiring' }
  return { kind: 'page', id: p.id, s: p.s }
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
