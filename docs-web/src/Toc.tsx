import { useEffect, useRef, useState } from 'react'
import { docsHref } from '@redstone/docs-kit'
import type { ManifestDoc, ManifestGroup } from '@redstone/docs-kit'
import { groupLabel } from './model'
import type { DocsModel } from './model'

/**
 * 目次 (#434)。メモ → `##` → 割れたページ の 3 段。
 *
 * - 開いているのは、今のページのメモと、自分で開いたメモだけ (564 ページを一度に並べない)
 * - `##` が 1 ページならその行がリンク。割れた `##` は開閉できる行で、下にページが並ぶ
 */
export function Toc({ model, current }: { model: DocsModel; current: string | null }) {
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
      <ul className="toc-docs">
        {model.manifest.docs.map(doc => {
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
              </button>
              {open && (
                <ul className="toc-groups">
                  {doc.groups.map(group => (
                    <TocGroup
                      key={group.id} doc={doc} group={group} current={current}
                      open={openGroups.has(group.id)}
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

function TocGroup({ doc, group, current, open, onToggle, model }: {
  doc: ManifestDoc; group: ManifestGroup; current: string | null
  open: boolean; onToggle: () => void; model: DocsModel
}) {
  const label = groupLabel(doc, group)
  if (group.pages.length === 1) {
    const id = group.pages[0]
    return (
      <li className="toc-group">
        <a className="toc-row toc-link" href={docsHref(id)} aria-current={id === current ? 'page' : undefined}>
          <span className="toc-title">{label}</span>
        </a>
      </li>
    )
  }
  return (
    <li className="toc-group">
      <button type="button" className="toc-row toc-group-row" aria-expanded={open} onClick={onToggle}>
        <span className="toc-caret" aria-hidden="true">{open ? '▾' : '▸'}</span>
        <span className="toc-title">{label}</span>
        <span className="toc-count">{group.pages.length}</span>
      </button>
      {open && (
        <ul className="toc-pages">
          {group.pages.map(id => (
            <li key={id}>
              <a className="toc-row toc-link" href={docsHref(id)} aria-current={id === current ? 'page' : undefined}>
                <span className="toc-title">{model.pages.get(id)?.page.title ?? id}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}
