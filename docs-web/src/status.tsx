import { useRef, useSyncExternalStore } from 'react'
import { createStatusStore, docsHref, statusFileName, summarizeStatus } from '@redstone/docs-kit'
import type { StatusData, StatusSnapshot, StatusSummary } from '@redstone/docs-kit'
import type { DocsModel } from './model'

/**
 * 既読と理解度 (#434)。置き場は localStorage の `rdsim:docs:status:v1` (docs-kit の status.ts)。
 * localStorage はオリジンごとなので、手元 (決まったポート) と PR ごとのプレビューで別になる。
 * 主な置き場は手元。ほかへ持って行く時は書き出して読み込む
 */
export const statusStore = createStatusStore()

// 別のタブの変更を拾う
window.addEventListener('storage', e => {
  let local = false
  try { local = e.storageArea === window.localStorage } catch { /* 触れない環境では拾わない */ }
  if (local) statusStore.sync(e.key, e.newValue)
})

export function useStatus(): StatusSnapshot {
  return useSyncExternalStore(statusStore.subscribe, statusStore.get)
}

/**
 * PR のプレビューか。`pr-preview.yml` がビルドの時に `VITE_DOCS_PREVIEW=1` を渡す。
 * 手元の dev・手元のビルド・e2e では立たない (ホスト名では見分けない。手元を別の端末から開くこともある)
 */
export const IS_PREVIEW = import.meta.env.VITE_DOCS_PREVIEW === '1'

/** 「読んだ 8/31・平均 62」の短い形 */
export function statText(s: StatusSummary): string {
  return s.avg === null ? `${s.read}/${s.total}` : `${s.read}/${s.total} ${s.avg}`
}

/** ページの上と下に置く操作: 「読んだ」と理解度 (5 刻み) */
export function StatusBar({ id, data, where }: { id: string; data: StatusData; where: 'top' | 'bottom' }) {
  const e = data.pages[id]
  const read = e?.r === 1
  return (
    <div className="status-bar" data-where={where}>
      <label className="status-read">
        <input type="checkbox" checked={read} onChange={ev => statusStore.setRead(id, ev.target.checked)} />
        読んだ
      </label>
      <label className="status-u">
        <span>理解度</span>
        <input
          type="range" min={0} max={100} step={5} value={e?.u ?? 0}
          aria-valuetext={read && e?.u !== undefined ? String(e.u) : '未設定'}
          onChange={ev => statusStore.setUnderstanding(id, Number(ev.target.value))}
        />
        <output>{read && e?.u !== undefined ? e.u : '—'}</output>
      </label>
    </div>
  )
}

/** 下に置く「読んだにして次へ」。最後のページでは「読んだにする」 */
export function ReadAndNext({ id, next }: { id: string; next: string | null }) {
  return (
    <button
      type="button" className="read-next"
      onClick={() => {
        statusStore.setRead(id, true)
        if (next) window.location.hash = docsHref(next)
      }}
    >{next ? '読んだにして次へ' : '読んだにする'}</button>
  )
}

function download(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.append(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** 全体の進みと、書き出す・読み込む */
export function Overall({ model, data, onMessage }: { model: DocsModel; data: StatusData; onMessage: (text: string) => void }) {
  const file = useRef<HTMLInputElement>(null)
  const s = summarizeStatus(data, model.pages.keys())
  return (
    <div className="overall">
      <span className="overall-text" data-read={s.read} data-avg={s.avg ?? ''}>
        全体 {s.read} / {s.total}{s.avg !== null && <>・平均 {s.avg}</>}
      </span>
      <button type="button" onClick={() => download(statusFileName(), statusStore.exportJson())}>書き出す</button>
      <button type="button" onClick={() => file.current?.click()}>読み込む</button>
      <input
        ref={file} type="file" accept="application/json,.json" hidden
        onChange={async ev => {
          const f = ev.target.files?.[0]
          ev.target.value = ''
          if (!f) return
          let text = ''
          try { text = await f.text() } catch { /* 読めないファイルは形の違いと同じに扱う */ }
          const res = statusStore.importJson(text)
          onMessage(res.ok
            ? `読み込んだ: ${res.pages} ページの記録 (うち ${res.changed} ページを新しい方へ更新)`
            : '読み込めなかった: 書き出した記録 (rdsim-docs-status-….json) ではない')
        }}
      />
    </div>
  )
}

/** 上の帯の下に出す 1 行の知らせ */
export function Notes({ saved, message, onClose }: { saved: boolean; message: string | null; onClose: () => void }) {
  return (
    <>
      {IS_PREVIEW && (
        <p className="head-note" data-note="preview">この記録は PR を閉じると消えます。残すときは「書き出す」で保存してください。</p>
      )}
      {!saved && (
        <p className="head-note head-note-warn" data-note="memory" role="status">この端末では記録を保存できません。画面を閉じると消えるので、「書き出す」で保存してください。</p>
      )}
      {message && (
        <p className="head-note" data-note="import" role="status">{message} <button type="button" onClick={onClose} aria-label="閉じる">×</button></p>
      )}
    </>
  )
}

/** 最初の画面の「全体の進み」と「続きから読む」 */
export function Progress({ model, data }: { model: DocsModel; data: StatusData }) {
  const s = summarizeStatus(data, model.pages.keys())
  const last = data.last ? model.pages.get(data.last.id)?.page ?? null : null
  const lastDoc = last ? model.docs.get(last.doc) : null
  return (
    <section className="progress" aria-label="全体の進み">
      <div className="progress-line">
        <span>読んだ {s.read} / {s.total} ページ{s.avg !== null && <>・理解度の平均 {s.avg}</>}</span>
        <progress max={s.total} value={s.read} />
      </div>
      {last && lastDoc && (
        <a className="progress-resume" href={docsHref(last.id)}>
          <span>続きから読む</span>
          <b>{lastDoc.label} › {last.title}</b>
        </a>
      )}
    </section>
  )
}

/** 目次の絞り込み */
export type TocFilter = 'all' | 'unread' | 'low'
export const LOW_UNDERSTANDING = 50

export function matchFilter(filter: TocFilter, data: StatusData, id: string): boolean {
  if (filter === 'all') return true
  const e = data.pages[id]
  const read = e?.r === 1
  if (filter === 'unread') return !read
  return read && e.u !== undefined && e.u < LOW_UNDERSTANDING
}
