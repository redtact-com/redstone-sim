import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { anchorOf, findPage } from '@redstone/docs-kit'
import { loadManifest } from './data'
import { buildModel } from './model'
import type { DocsModel } from './model'
import { useRoute } from './router'
import { Toc } from './Toc'
import { PageOutline, PageView } from './PageView'
import { Home } from './Home'
import { SearchBox, SearchView } from './Search'
import { Notes, Overall, Progress, ReadAndNext, StatusBar, statText, statusStore, useStatus } from './status'
import { summarizeStatus } from '@redstone/docs-kit'
import { SHORT_PAGE_LINES } from './model'

/**
 * 読む用の Web の殻 (#434)。
 *
 * 画面は 3 欄 (目次・本文・このページ)。狭い幅では目次が引き出しになり、右の欄は出さない。
 * 検索の結果 (`#/_search?q=`) は本文の欄に出す。
 * 3D/2D のビューアは、本文の fixture の札の「表示」を押した時にだけ読む (Fixtures.tsx)
 */
export function App() {
  const route = useRoute()
  const model = useModel()
  const [drawer, setDrawer] = useState(false)
  const status = useStatus()
  const [message, setMessage] = useState<string | null>(null)
  const head = useRef<HTMLElement>(null)

  // 見出しの帯の高さを CSS に渡す (目次の貼り付く位置と、節へ飛んだ時の余白に使う)
  useLayoutEffect(() => {
    const el = head.current
    if (!el) return
    const set = () => document.documentElement.style.setProperty('--head-h', `${el.offsetHeight}px`)
    set()
    const ro = new ResizeObserver(set)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // 行き先。ページの ID でなくても (割った `##`・メモ・ページの中の節)、入っているページへ寄せる
  const target = useMemo(() => {
    if (route.kind !== 'page' || !('model' in model)) return null
    const hit = findPage(model.model.manifest, route.id)
    if (!hit) return null
    return { page: hit.page, section: route.s ?? (hit.section ? anchorOf(hit.section) : null) }
  }, [model, route.kind, route.kind === 'page' ? route.id : '', route.kind === 'page' ? route.s : null])

  // ページを移ったら引き出しを閉じる。Esc でも閉じる
  useEffect(() => { setDrawer(false) }, [route.kind, target?.page, target?.section, route.kind === 'search' ? route.q : ''])
  useEffect(() => {
    if (!drawer) return
    const on = (e: KeyboardEvent) => { if (e.key === 'Escape') setDrawer(false) }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [drawer])

  const ready = 'model' in model ? model.model : null

  // 開いたページを覚える (「続きから読む」)
  useEffect(() => { if (target) statusStore.setLast(target.page) }, [target?.page])

  const overall = ready && <Overall model={ready} data={status.data} onMessage={setMessage} />
  const page = target && ready ? ready.pages.get(target.page) ?? null : null

  return (
    <div className="shell">
      <header className="head" ref={head}>
        <div className="head-row">
          <button
            type="button" className="head-menu" aria-label="目次を開く" aria-expanded={drawer}
            aria-controls="toc-col" onClick={() => setDrawer(d => !d)}
          >☰ 目次</button>
          <a className="head-title" href="#/">docs</a>
          <SearchBox route={route} />
          <div className="head-status">{overall}</div>
        </div>
        <Notes saved={status.saved} message={message} onClose={() => setMessage(null)} />
      </header>
      {'error' in model ? (
        <main className="solo">
          <p className="notice notice-err" role="alert">目次を取れなかった ({model.error})。<button type="button" onClick={model.retry}>もう一度</button></p>
        </main>
      ) : !ready ? (
        <main className="solo"><p className="loading">読み込み中…</p></main>
      ) : (
        <div className="cols">
          {drawer && <div className="drawer-back" onClick={() => setDrawer(false)} />}
          <aside id="toc-col" className={drawer ? 'toc-col open' : 'toc-col'}>
            <div className="drawer-status">{overall}</div>
            <Toc model={ready} current={target?.page ?? null} data={status.data} />
          </aside>
          <main className="main">
            {route.kind === 'home' ? (
              <Home
                model={ready}
                progress={<Progress model={ready} data={status.data} />}
                docStat={key => statText(summarizeStatus(status.data, ready.docs.get(key)!.groups.flatMap(g => g.pages)))}
              />
            ) : route.kind === 'search' ? (
              <SearchView model={ready} query={route} data={status.data} />
            ) : target && page ? (
              <PageView
                model={ready} pageId={target.page} section={target.section}
                // 10 行未満のページは上の操作を出さない (すぐ下に同じ物が来る)
                top={page.page.lines >= SHORT_PAGE_LINES && <StatusBar id={target.page} data={status.data} where="top" />}
                bottom={<StatusBar id={target.page} data={status.data} where="bottom" />}
                pagerMid={<ReadAndNext id={target.page} next={ready.manifest.pages[page.index + 1]?.id ?? null} />}
              />
            ) : (
              <NotFound id={route.kind === 'page' ? route.id : ''} />
            )}
          </main>
          <aside className="side-col">
            {target && <PageOutline pageId={target.page} />}
          </aside>
        </div>
      )}
    </div>
  )
}

type ModelState = { model: DocsModel } | { error: string; retry: () => void } | { loading: true }

function useModel(): ModelState {
  const [state, setState] = useState<{ model: DocsModel } | { error: string } | null>(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let alive = true
    loadManifest().then(
      m => { if (alive) setState({ model: buildModel(m) }) },
      e => { if (alive) setState({ error: String(e instanceof Error ? e.message : e) }) },
    )
    return () => { alive = false }
  }, [attempt])
  return useMemo<ModelState>(() => {
    if (!state) return { loading: true }
    if ('error' in state) return { error: state.error, retry: () => { setState(null); setAttempt(n => n + 1) } }
    return state
  }, [state])
}

function NotFound({ id }: { id: string }) {
  return (
    <div className="page">
      <h1>ページが無い</h1>
      <p><code>{id}</code> というページは目次に無い。節の番号が変わった可能性がある。<a href="#/">最初の画面へ</a></p>
    </div>
  )
}
