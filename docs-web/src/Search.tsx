import { useEffect, useMemo, useRef, useState } from 'react'
import { docOf, docsHref, makeSnippet, MARK_LABELS, SEARCH_LIMIT } from '@redstone/docs-kit'
import type { PageData, SearchEngine, SearchHit, Snippet, StatusData } from '@redstone/docs-kit'
import { loadPage, loadSearch } from './data'
import type { DocsModel } from './model'
import { EMPTY_SEARCH, parseRoute, searchHref } from './router'
import type { Route, SearchFlag, SearchQuery } from './router'

/**
 * 検索 (#434)。節 (1,385 件) を自前の 2-gram + BM25 (docs-kit の search.ts) で引く。
 *
 * - 索引は、検索の欄に初めて入った時に取る (最初の表示では取らない)
 * - 結果は本文の欄に 20 件。押すとページ + 節へ飛ぶ
 * - 索引は本文を持たないので、抜粋は結果のページを取ってから作る (打ち終わってから少し待つ)
 */

const FLAG_LABELS: Record<SearchFlag, string> = {
  need: '要実機あり', ver: '版差あり', fx: 'fixture あり', unread: '未読だけ',
}

/** 上の帯の検索の欄。打つとその場で検索の画面へ移る */
export function SearchBox({ route }: { route: Route }) {
  const current = route.kind === 'search' ? route : null
  const [text, setText] = useState(current?.q ?? '')
  const input = useRef<HTMLInputElement>(null)

  // 戻る・進むで問いが変わったら欄を合わせる。打っている最中は触らない (変換中の文字を壊さない)
  useEffect(() => {
    if (current && document.activeElement !== input.current) setText(current.q)
  }, [current?.q])

  const go = (q: string) => {
    const href = searchHref({ ...(current ?? EMPTY_SEARCH), q })
    // 検索の画面の中で打ち直す間は履歴を増やさない
    if (current) window.location.replace(href)
    else window.location.hash = href
  }

  return (
    <form
      className="head-search" role="search"
      onSubmit={e => { e.preventDefault(); if (text.trim() || current) go(text) }}
    >
      <input
        ref={input} type="search" placeholder="検索 (節の見出しと本文)" aria-label="検索"
        value={text} autoComplete="off" spellCheck={false} enterKeyHint="search"
        onFocus={() => { loadSearch().catch(() => {}) }}
        onChange={e => {
          const v = e.target.value
          setText(v)
          if (v.trim() || current) go(v)
        }}
      />
    </form>
  )
}

function useEngine(): { engine: SearchEngine | null; error: string | null; retry: () => void } {
  const [state, setState] = useState<{ engine: SearchEngine } | { error: string } | null>(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let alive = true
    loadSearch().then(
      engine => { if (alive) setState({ engine }) },
      e => { if (alive) setState({ error: String(e instanceof Error ? e.message : e) }) },
    )
    return () => { alive = false }
  }, [attempt])
  return {
    engine: state && 'engine' in state ? state.engine : null,
    error: state && 'error' in state ? state.error : null,
    retry: () => { setState(null); setAttempt(n => n + 1) },
  }
}

/** ページの HTML を節ごとの文にする (見出しは `data-sec` に節の ID を持つ) */
const pageTexts = new WeakMap<PageData, Map<string, string>>()
function sectionTexts(page: PageData): Map<string, string> {
  let out = pageTexts.get(page)
  if (out) return out
  out = new Map()
  const box = document.createElement('template')
  box.innerHTML = page.html
  let cur: string | null = null
  for (const el of box.content.children) {
    const sec = /^H[1-6]$/.test(el.tagName) ? el.getAttribute('data-sec') : null
    if (sec) { cur = sec; out.set(sec, ''); continue }
    if (cur !== null) out.set(cur, `${out.get(cur)} ${el.textContent ?? ''}`)
  }
  for (const [k, v] of out) out.set(k, v.replace(/\s+/g, ' ').trim())
  pageTexts.set(page, out)
  return out
}

/** 抜粋を待つ時間 (ms)。打っている最中に 1 字ごとにページを取りに行かない */
const SNIPPET_WAIT = 200

/** 結果の節の抜粋。前の問いの抜粋は、新しい物ができるまで出したままにする */
function useSnippets(hits: readonly SearchHit[], q: string): Map<string, Snippet> {
  const [snips, setSnips] = useState<Map<string, Snippet>>(() => new Map())
  useEffect(() => {
    let alive = true
    const timer = window.setTimeout(() => {
      for (const h of hits) {
        loadPage(h.page).then(page => {
          if (!alive) return
          const text = sectionTexts(page).get(h.id) ?? ''
          const snip = makeSnippet(text, q, 130)
          setSnips(prev => new Map(prev.size > 400 ? [] : prev).set(h.id, snip))
        }, () => { /* 取れなければ抜粋なしのまま */ })
      }
    }, SNIPPET_WAIT)
    return () => { alive = false; window.clearTimeout(timer) }
  }, [hits, q])
  return snips
}

function SnippetText({ snip }: { snip: Snippet | undefined }) {
  if (!snip || !snip.text) return <p className="hit-snip" />
  const out: (string | { hit: string })[] = []
  let pos = 0
  for (const [a, b] of snip.marks) {
    if (a > pos) out.push(snip.text.slice(pos, a))
    out.push({ hit: snip.text.slice(a, b) })
    pos = b
  }
  if (pos < snip.text.length) out.push(snip.text.slice(pos))
  return (
    <p className="hit-snip">
      {snip.head && '…'}
      {out.map((x, i) => (typeof x === 'string' ? x : <mark key={i}>{x.hit}</mark>))}
      {snip.tail && '…'}
    </p>
  )
}

/** 検索の画面 (本文の欄に出す) */
export function SearchView({ model, query, data }: { model: DocsModel; query: SearchQuery; data: StatusData }) {
  const { engine, error, retry } = useEngine()
  const { q, doc, flags } = query
  const unread = flags.includes('unread')

  useEffect(() => { document.title = q.trim() ? `検索: ${q.trim()} — docs` : '検索 — docs' }, [q])
  useEffect(() => { window.scrollTo(0, 0) }, [])

  const result = useMemo(() => {
    if (!engine || !q.trim()) return null
    const filter = (h: Omit<SearchHit, 'score'>) =>
      (!doc || docOf(h.id) === doc)
      && (!flags.includes('need') || h.marks.includes('need'))
      && (!flags.includes('ver') || h.marks.includes('ver'))
      && (!flags.includes('fx') || h.fixtures > 0)
      && (!unread || data.pages[h.page]?.r !== 1)
    return engine.search(q, { limit: SEARCH_LIMIT, filter: doc || flags.length ? filter : undefined })
    // 既読の記録は「未読だけ」の時にだけ結果を変える
  }, [engine, q, doc, flags.join(','), unread ? data : null])

  const snips = useSnippets(result?.hits ?? NO_HITS, q)
  // 今の URL から組み直す (続けて押した時に、前の押下が届く前の絞り込みで上書きしない)
  const set = (change: (now: SearchQuery) => Partial<SearchQuery>) => {
    const r = parseRoute(window.location.hash)
    const now = r.kind === 'search' ? r : query
    window.location.replace(searchHref({ ...now, ...change(now) }))
  }

  return (
    <div className="search" data-ready={engine ? '1' : '0'}>
      <h1>検索</h1>
      <div className="search-filter" role="group" aria-label="絞り込み">
        <select aria-label="メモ" value={doc ?? ''} onChange={e => set(() => ({ doc: e.target.value || null }))}>
          <option value="">全部のメモ</option>
          {model.manifest.docs.map(d => <option key={d.key} value={d.key}>{d.label} {d.title}</option>)}
        </select>
        {(Object.keys(FLAG_LABELS) as SearchFlag[]).map(k => (
          <button
            key={k} type="button" aria-pressed={flags.includes(k)} data-flag={k}
            onClick={() => set(now => ({ flags: now.flags.includes(k) ? now.flags.filter(x => x !== k) : [...now.flags, k] }))}
          >{FLAG_LABELS[k]}</button>
        ))}
      </div>
      {error ? (
        <p className="notice notice-err" role="alert">検索の索引を取れなかった ({error})。<button type="button" onClick={retry}>もう一度</button></p>
      ) : !engine ? (
        <p className="loading">索引を読み込み中…</p>
      ) : !result ? (
        <p className="search-count">上の欄に語を入れると、節 {engine.size} 件から探す。語は空白で区切る。クラス名・メソッド名・ブロック ID・fixture の名前でも引ける。</p>
      ) : (
        <>
          <p className="search-count" role="status" data-total={result.total}>
            {result.total === 0
              ? '当てはまる節は無い。語を減らすか、絞り込みを外す。'
              : result.total > result.hits.length
                ? `${result.total} 件のうち上位 ${result.hits.length} 件`
                : `${result.total} 件`}
          </p>
          <ol className="hits">
            {result.hits.map(h => <Hit key={h.id} hit={h} model={model} data={data} snip={snips.get(h.id)} />)}
          </ol>
        </>
      )}
    </div>
  )
}

const NO_HITS: readonly SearchHit[] = []

function Hit({ hit, model, data, snip }: { hit: SearchHit; model: DocsModel; data: StatusData; snip: Snippet | undefined }) {
  const doc = model.docs.get(docOf(hit.id))
  const e = data.pages[hit.page]
  const read = e?.r === 1
  // 道筋の頭 (メモの題) は呼び名に替える。最後 (この節) は題として別に出す
  const trail = hit.path.slice(1, -1)
  return (
    <li>
      <a className="hit" href={docsHref(hit.page, hit.id)} data-id={hit.id} data-read={read ? '1' : '0'}>
        <span className="hit-path">
          <b className="hit-doc">{doc?.label ?? docOf(hit.id)}</b>
          {trail.map((t, i) => <span key={i}> › {t}</span>)}
          <code className="hit-id">{hit.id}</code>
        </span>
        <b className="hit-title">{hit.path.length === 1 ? doc?.title ?? hit.title : hit.title}</b>
        <SnippetText snip={snip} />
        <span className="hit-meta">
          <span className="hit-read">
            <span className="toc-dot" role="img" aria-label={read ? '読んだ' : '未読'} />
            {read ? (e.u !== undefined ? `読んだ・理解度 ${e.u}` : '読んだ') : '未読'}
          </span>
          {hit.marks.map(k => <span key={k} className={`mk mk-${k}`}>{MARK_LABELS[k]}</span>)}
          {hit.fixtures > 0 && <span className="mk mk-fx">fixture {hit.fixtures}</span>}
        </span>
      </a>
    </li>
  )
}
