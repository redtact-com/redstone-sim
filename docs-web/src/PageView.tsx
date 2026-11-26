import { useEffect, useRef, useState } from 'react'
import type { MouseEvent, ReactNode } from 'react'
import { docsHref, headingDomId } from '@redstone/docs-kit'
import type { FixtureInfo, PageData } from '@redstone/docs-kit'
import { loadPage, prefetchPage } from './data'
import { FixtureCards } from './Fixtures'
import { groupLabel } from './model'
import type { DocsModel } from './model'

type Loaded = { id: string; data: PageData } | { id: string; error: string }

/**
 * ページ 1 枚を取って覚える。次のページを 1 つ先に取っておく。
 * 取っている間は「読み込み中…」を出す (前のページの本文は残さない。残すと、上下の操作と前後が
 * 別のページの物になる)。読む順の次のページは先読みしてあるので、待ちが出るのは目次・参照・検索から飛ぶ時。
 */
export function usePage(id: string): { data: PageData | null; error: string | null; loading: boolean; retry: () => void } {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let alive = true
    loadPage(id).then(
      data => {
        if (!alive) return
        setLoaded({ id, data })
        prefetchPage(data.next)
      },
      e => { if (alive) setLoaded({ id, error: String(e instanceof Error ? e.message : e) }) },
    )
    return () => { alive = false }
  }, [id, attempt])
  const fresh = loaded?.id === id
  return {
    data: loaded && 'data' in loaded ? loaded.data : null,
    error: fresh && loaded && 'error' in loaded ? loaded.error : null,
    loading: !fresh,
    retry: () => setAttempt(n => n + 1),
  }
}

/** 本文の HTML。ビルド時に作った物をそのまま置く (実行時にパーサは持たない) */
export function PageBody({ data, section, row, fixtures }: {
  data: PageData; section: string | null; row: string | null
  /** fixture の目録 (札の注記に使う) */
  fixtures: Record<string, FixtureInfo>
}) {
  const body = useRef<HTMLElement>(null)
  // 開いた時と、節の指定が変わった時に、自前でその節へスクロールする
  useEffect(() => {
    const el = section ? document.getElementById(headingDomId(section)) : null
    if (!el) { window.scrollTo(0, 0); return }
    const target = (row && findRow(el, row)) || el
    if (target === el) { el.scrollIntoView(); return }
    target.scrollIntoView({ block: 'center' })
    target.classList.add('row-hit')
    return () => target.classList.remove('row-hit')
  }, [data.id, section, row])
  return (
    <>
      <article className="doc-body" ref={body} data-page={data.id} dangerouslySetInnerHTML={{ __html: data.html }} />
      {/* 札の無いページでは何も付けない (ビューアのチャンクも取らない) */}
      {data.fixtures.length > 0 && <FixtureCards root={body} fixtures={fixtures} />}
    </>
  )
}

/** 見出しの後ろの最初の表から、1 列目が `row` の行を探す (`V18 の R4` の行き先) */
function findRow(heading: HTMLElement, row: string): HTMLElement | null {
  for (let el = heading.nextElementSibling; el && !/^H[1-6]$/.test(el.tagName); el = el.nextElementSibling) {
    for (const tr of el.querySelectorAll('tbody tr')) {
      if (tr.firstElementChild?.textContent?.trim() === row) return tr as HTMLElement
    }
  }
  return null
}

export function PageView({ model, pageId, section, top, bottom, pagerMid }: {
  model: DocsModel; pageId: string; section: string | null
  /** 本文の上と下に置く操作 (既読と理解度)。`pagerMid` は前へ・次への間 (読んだにして次へ) */
  top?: ReactNode; bottom?: ReactNode; pagerMid?: ReactNode
}) {
  const { data, error, loading, retry } = usePage(pageId)
  // 表の行の指定 (`V18 の R4`)。押したリンクの行き先と一緒に覚え、ほかの道で移った時は持ち越さない
  const [rowFor, setRowFor] = useState<{ href: string; row: string } | null>(null)
  const [again, setAgain] = useState(0)
  const entry = model.pages.get(pageId)

  useEffect(() => {
    if (entry) document.title = `${entry.page.title} — docs`
  }, [entry])

  // 節の参照のリンクを押した時: 今と同じ行き先なら hashchange が出ないので、自前でスクロールし直す
  const onClick = (e: MouseEvent) => {
    const a = (e.target as Element).closest?.('a.ref') as HTMLAnchorElement | null
    if (!a) return
    const href = a.getAttribute('href') ?? ''
    setRowFor(a.dataset.row ? { href, row: a.dataset.row } : null)
    if (href === window.location.hash) setAgain(n => n + 1)
  }
  if (!entry) return null
  const { page, index } = entry
  const doc = model.docs.get(page.doc)!
  const group = model.groups.get(page.group)!
  const prev = index > 0 ? model.manifest.pages[index - 1] : null
  const next = model.manifest.pages[index + 1] ?? null
  const shown = data && data.id === pageId ? data : null
  const row = rowFor && rowFor.href === window.location.hash ? rowFor.row : null

  return (
    <div className="page" onClick={onClick} aria-busy={loading}>
      <nav className="crumbs" aria-label="パンくず">
        <a href={docsHref(doc.groups[0].pages[0])}>{doc.label}</a>
        {group.pages.length > 1 && <> <span aria-hidden="true">›</span> <a href={docsHref(group.pages[0])}>{groupLabel(doc, group)}</a></>}
        {' '}<span aria-hidden="true">›</span> <span>{group === doc.groups[0] ? doc.title : page.title}</span>
      </nav>
      {top}
      {error
        ? <p className="notice notice-err" role="alert">ページを取れなかった ({error})。<button type="button" onClick={retry}>もう一度</button></p>
        : shown
          ? <PageBody key={`${shown.id}:${again}`} data={shown} section={section} row={row} fixtures={model.manifest.fixtures} />
          : <p className="loading">読み込み中…</p>}
      {shown && bottom}
      <nav className={pagerMid ? 'pager pager-3' : 'pager'} aria-label="前後のページ">
        {prev ? <a className="pager-prev" href={docsHref(prev.id)} rel="prev"><span>‹ 前へ</span><b>{prev.title}</b></a> : <span />}
        {shown && pagerMid}
        {next ? <a className="pager-next" href={docsHref(next.id)} rel="next"><span>次へ ›</span><b>{next.title}</b></a> : <span />}
      </nav>
    </div>
  )
}

/** 右の欄「このページ」。ページの中の見出しへ飛ぶ。見出しが 1 つだけなら出さない */
export function PageOutline({ pageId }: { pageId: string }) {
  const { data } = usePage(pageId)
  if (!data || data.id !== pageId || data.sections.length < 2) return null
  const base = Math.min(...data.sections.slice(1).map(s => s.level))
  return (
    <nav className="outline" aria-label="このページ">
      <h2>このページ</h2>
      <ul>
        {data.sections.slice(1).map(s => (
          <li key={s.id} style={{ paddingLeft: `${(s.level - base) * 12}px` }}>
            <a href={docsHref(data.id, s.id)}>{s.title}</a>
          </li>
        ))}
      </ul>
    </nav>
  )
}
