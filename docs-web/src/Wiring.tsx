import { Suspense, lazy, useEffect, useState } from 'react'
import { DOCS_DATA_VERSION, DOCS_KIT_VERSION } from '@redstone/docs-kit'
import type { Manifest } from '@redstone/docs-kit'
import { RESOURCEPACK_URL, dataUrl } from './paths'

// ビューア本体 (deepslate を含む) もここを開いた時だけ取る
const WiringViewer = lazy(() => import('./WiringViewer'))

type Check = { name: string; state: 'wait' | 'ok' | 'ng'; note: string }

/**
 * 配線の確かめ (開発用)。
 *
 * - ビューアの入口は**ここを開いた時だけ** dynamic import する。殻のチャンクに deepslate を入れない
 * - リソースパックがルート絶対のパスで届くこと (base が `/docs/` でもずれないこと) を見る
 * - 生成物が base の配下から届くことを見る
 * - 下に `packages/viewer` の確かめ (付け外し・interactive・描く頻度) を出す
 */
export function WiringCheck() {
  const [checks, setChecks] = useState<Check[]>([
    { name: 'viewer', state: 'wait', note: '' },
    { name: 'resourcepack', state: 'wait', note: '' },
    { name: 'data', state: 'wait', note: '' },
  ])
  useEffect(() => {
    let alive = true
    const set = (name: string, state: Check['state'], note: string) => {
      if (alive) setChecks(cs => cs.map(c => (c.name === name ? { name, state, note } : c)))
    }
    import('@redstone/docs-kit/viewer')
      .then(m => {
        const f = m.fixtureFrame({ from: [0, 0, 0], to: [5, 1, 1] })
        set('viewer', 'ok', `fixtureFrame の距離 ${f.distance.toFixed(2)}`)
      })
      .catch(e => set('viewer', 'ng', String(e)))
    const getJson = (url: string) => fetch(url).then(r => {
      if (!r.ok) throw new Error(`${r.status} ${url}`)
      return r.json() as Promise<Record<string, unknown>>
    })
    getJson(`${RESOURCEPACK_URL}/bundle.json`)
      .then(j => set('resourcepack', 'ok', `${RESOURCEPACK_URL}/bundle.json・${Object.keys(j).length} キー`))
      .catch(e => set('resourcepack', 'ng', String(e)))
    getJson(dataUrl('manifest.json'))
      .then(j => {
        const m = j as unknown as Manifest
        if (m.v !== DOCS_DATA_VERSION) throw new Error(`生成物の版が違う (${m.v})`)
        set('data', 'ok', `${dataUrl('manifest.json')}・メモ ${m.counts.docs}・ページ ${m.counts.pages}・節 ${m.counts.sections}`)
      })
      .catch(e => set('data', 'ng', String(e)))
    return () => { alive = false }
  }, [])
  return (
    <>
      <h1>配線の確かめ</h1>
      <p>docs-kit の版 {DOCS_KIT_VERSION}・base <code>{import.meta.env.BASE_URL}</code></p>
      <ul className="wiring">
        {checks.map(c => (
          <li key={c.name} data-check={c.name} data-state={c.state}>
            <b>{c.name}</b> {c.state} <span>{c.note}</span>
          </li>
        ))}
      </ul>
      <Suspense fallback={<p className="loading">ビューアを読み込み中…</p>}>
        <WiringViewer />
      </Suspense>
    </>
  )
}
