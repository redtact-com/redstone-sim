import { useEffect, useRef, useState } from 'react'
import { docsHref } from '@redstone/docs-kit'
import type { ManifestDoc, ManifestGroup } from '@redstone/docs-kit'
import { summarizeStatus } from '@redstone/docs-kit'
import type { StatusData } from '@redstone/docs-kit'
import { groupLabel } from './model'
import type { DocsModel } from './model'
import { matchFilter, statText } from './status'
import type { TocFilter } from './status'

/**
 * 目次 (#434)。メモ → `##` → 割れたページ の 3 段。
 *
 * - 開いているのは、今のページのメモと、自分で開いたメモだけ (564 ページを一度に並べない)
 * - `##` が 1 ページならその行がリンク。割れた `##` は開閉できる行で、下にページが並ぶ
 * - メモと割れた `##` の行に「読んだ数 / ページ数」と理解度の平均を出す
 * - 絞り込み (未読だけ・理解度 50 未満) は、当てはまるページだけを残す
 */
export function Toc({ model, current, data }: { model: DocsModel; current: string | null; data: StatusData }) {
  const [filter, setFilter] = useState<TocFilter>('all')
  const match = (id: string) => matchFilter(filter, data, id)
  const docPages = (doc: ManifestDoc) => doc.groups.flatMap(g => g.pages)
  const docs = filter === 'all' ? model.manifest.docs : model.manifest.docs.filter(d => docPages(d).some(match))
  const cur = current ? model.pages.get(current)?.page ?? null : null
  const [openDocs, setOpenDocs] = useState<Set<string>>(() => new Set(cur ? [cur.doc] : []))
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set(cur ? [cur.group] : []))
  const root = useRef<HTMLElement>(null)

  // ページを移ったら、そのメモと `##` を開き、今の行を目次の中に見せる
  useEffect(() => {
    if (!cur) return
    setOpenDocs(s => (s.has(cur.doc) ? s : new Set(s).add(cur.doc)))
    setOpenGroups(s => (s.has(cur.group) ? s : new Set(s).add(cur.group)))
    // 目次の欄の中だけを動かす (scrollIntoView は本文のスクロールまで動かすことがある)
    const t = window.setTimeout(() => {
      const row = root.current?.querySelector<HTMLElement>('[aria-current="page"]')
      const box = root.current?.parentElement
      if (!row || !box) return
      const r = row.getBoundingClientRect()
      const b = box.getBoundingClientRect()
      if (r.top < b.top || r.bottom > b.bottom) box.scrollTop += r.top - b.top - (b.height - r.height) / 2
    }, 0)
    return () => window.clearTimeout(t)
  }, [cur])

  const toggle = (set: Set<string>, key: string) => {
    const next = new Set(set)
    if (!next.delete(key)) next.add(key)
    return next
  }

  return (
    <nav className="toc" aria-label="目次" ref={root}>
      <div className="toc-filter" role="group" aria-label="絞り込み">
        {([['unread', '未読だけ'], ['low', '50 未満']] as const).map(([key, label]) => (
          <button
            key={key} type="button" aria-pressed={filter === key} data-filter={key}
            onClick={() => setFilter(f => (f === key ? 'all' : key))}
          >{label}</button>
        ))}
      </div>
      {docs.length === 0 && <p className="toc-empty">当てはまるページは無い</p>}
      <ul className="toc-docs">
        {docs.map(doc => {
          const open = openDocs.has(doc.key)
          return (
            <li key={doc.key} className="toc-doc" data-doc={doc.key}>
              <button
                type="button" className="toc-row toc-doc-row" aria-expanded={open}
                onClick={() => setOpenDocs(s => toggle(s, doc.key))}
              >
                <span className="toc-caret" aria-hidden="true">{open ? '▾' : '▸'}</span>
                <span className="toc-label">{doc.label}</span>
                <span className="toc-title">{doc.title}</span>
                <span className="toc-count">{statText(summarizeStatus(data, docPages(doc)))}</span>
              </button>
              {open && (
                <ul className="toc-groups">
                  {doc.groups.filter(g => g.pages.some(match)).map(group => (
                    <TocGroup
                      key={group.id} doc={doc} group={group} current={current}
                      data={data} pages={group.pages.filter(match)}
                      open={filter !== 'all' || openGroups.has(group.id)}
                      onToggle={() => setOpenGroups(s => toggle(s, group.id))}
                      model={model}
                    />
                  ))}
                </ul>
              )}
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

/** ページの行の印: 未読は白い丸、読んだは塗った丸と理解度 */
function PageRow({ id, title, current, data }: { id: string; title: string; current: string | null; data: StatusData }) {
  const e = data.pages[id]
  const read = e?.r === 1
  return (
    <a className="toc-row toc-link" href={docsHref(id)} aria-current={id === current ? 'page' : undefined} data-read={read ? '1' : '0'}>
      <span className="toc-dot" role="img" aria-label={read ? '読んだ' : '未読'} />
      <span className="toc-title">{title}</span>
      {read && e.u !== undefined && <span className="toc-count">{e.u}</span>}
    </a>
  )
}

function TocGroup({ doc, group, current, open, onToggle, model, data, pages }: {
  doc: ManifestDoc; group: ManifestGroup; current: string | null
  open: boolean; onToggle: () => void; model: DocsModel
  data: StatusData
  /** 絞り込みの後に残ったページ */
  pages: string[]
}) {
  const label = groupLabel(doc, group)
  if (group.pages.length === 1) {
    return <li className="toc-group"><PageRow id={group.pages[0]} title={label} current={current} data={data} /></li>
  }
  return (
    <li className="toc-group">
      <button type="button" className="toc-row toc-group-row" aria-expanded={open} onClick={onToggle}>
        <span className="toc-caret" aria-hidden="true">{open ? '▾' : '▸'}</span>
        <span className="toc-title">{label}</span>
        <span className="toc-count">{statText(summarizeStatus(data, group.pages))}</span>
      </button>
      {open && (
        <ul className="toc-pages">
          {pages.map(id => (
            <li key={id}><PageRow id={id} title={model.pages.get(id)?.page.title ?? id} current={current} data={data} /></li>
          ))}
        </ul>
      )}
    </li>
  )
}
