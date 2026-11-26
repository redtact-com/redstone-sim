import { useEffect, useState } from 'react'
import { DOCS_KIT_VERSION } from '@redstone/docs-kit'
import { RESOURCEPACK_URL, dataUrl } from './paths'

/**
 * 読む用の Web の殻 (#434)。今は空のページで、配線だけを確かめる。
 * 目次・ページ・状態・検索は後の段で足す。
 */
export function App() {
  const hash = useHash()
  return (
    <div className="shell">
      <header className="shell-head">
        <a className="shell-title" href="#/">docs</a>
        <span className="shell-sub">Java 版 26.3 のレッドストーン読解メモ</span>
      </header>
      <main className="shell-main">
        {hash === '#/_wiring' ? <WiringCheck /> : <Empty />}
      </main>
    </div>
  )
}

function useHash(): string {
  const [hash, setHash] = useState(() => window.location.hash)
  useEffect(() => {
    const on = () => setHash(window.location.hash)
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return hash
}

function Empty() {
  return (
    <>
      <h1>docs</h1>
      <p>読む画面はこれから足す。配線の確かめは <a href="#/_wiring">#/_wiring</a>。</p>
    </>
  )
}

type Check = { name: string; state: 'wait' | 'ok' | 'ng'; note: string }

/**
 * 配線の確かめ (開発用)。
 *
 * - ビューアの入口は**ここを開いた時だけ** dynamic import する。殻のチャンクに deepslate を入れない
 * - リソースパックがルート絶対のパスで届くこと (base が `/docs/` でもずれないこと) を見る
 * - 生成物が base の配下から届くことを見る
 */
function WiringCheck() {
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
      .then(j => set('data', 'ok', `${dataUrl('manifest.json')}・${Object.keys(j).length} キー`))
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
    </>
  )
}
