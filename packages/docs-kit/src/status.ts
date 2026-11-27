/**
 * 既読と理解度の保存 (#434)。
 *
 * 置き場は localStorage の 1 個のキー (`rdsim:docs:status:v1`)。エディタの `rdsim:editor:circuit` と
 * 接頭辞を分ける。接頭辞は引数なので、のちの解説サイトは別の接頭辞で同じ物を使える。
 *
 * 値の形:
 *
 *     { "v": 1, "pages": { "v07/4.3": { "r": 1, "u": 60, "t": "2026-11-26T10:00:00.000Z" } } }
 *
 * - 項目が無い = 未読。`r: 1` = 読んだ。`r` の無い項目 (読んだを外した跡) も未読
 * - `u` は理解度 (0〜100 の整数)。動かすと自動で「読んだ」になる
 * - `t` は最後に変えた時刻。読み込み (併合) はページごとに `t` の新しい方を残す
 * - `last` は最後に開いたページ (「続きから読む」)。同じ値の中に置き、書き出しにも入る
 *
 * 決まり:
 *
 * - **落ちない**。読み書きは全部 try/catch で受け、保存できない時はメモリだけで動く (`saved: false`)
 * - 版 (`v`) が合わない記録・壊れた記録は読まずに空から始め、ユーザが状態を変えるまで上書きしない
 * - 今の目次に無い ID も消さない (節の番号が動いても記録を失わない)。集計には数えない
 *
 * DOM には触らない。別のタブの変更は、読む側が `storage` イベントを `sync` に渡す
 */

export const STATUS_VERSION = 1
export const DEFAULT_STATUS_PREFIX = 'rdsim:docs'

/** 保存のキー。`rdsim:docs:status:v1` */
export function statusKey(prefix: string = DEFAULT_STATUS_PREFIX): string {
  return `${prefix}:status:v${STATUS_VERSION}`
}

export interface PageStatus {
  /** 1 = 読んだ。無ければ未読 */
  r?: 1
  /** 理解度 (0〜100 の整数) */
  u?: number
  /** 最後に変えた時刻 (ISO 8601) */
  t: string
}

export interface StatusData {
  v: typeof STATUS_VERSION
  pages: Record<string, PageStatus>
  /** 最後に開いたページ */
  last?: { id: string; t: string }
}

export function emptyStatus(): StatusData {
  return { v: STATUS_VERSION, pages: {} }
}

const EPOCH = '1970-01-01T00:00:00.000Z'
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)
const validTime = (t: unknown): t is string => typeof t === 'string' && !Number.isNaN(Date.parse(t))

/** 項目を作る。欄の順 (r・u・t) をそろえる (書き出した JSON が、どこで作っても同じ字面になる) */
function entry(read: boolean, u: number | undefined, t: string): PageStatus {
  return { ...(read ? { r: 1 as const } : {}), ...(u === undefined ? {} : { u }), t }
}

/** 理解度を 0〜100 の整数に丸める */
export function clampUnderstanding(u: number): number {
  return Math.min(100, Math.max(0, Math.round(u)))
}

/**
 * 保存した文字列を読む。読めない時 (JSON でない・形が違う・版が合わない) は null。
 * 項目ごとの欄は確かめ直し、知らない欄は捨てる。`t` が読めない項目は一番古い時刻にする
 */
export function parseStatus(text: string | null | undefined): StatusData | null {
  if (!text) return null
  let raw: unknown
  try { raw = JSON.parse(text) } catch { return null }
  if (!isObj(raw) || raw.v !== STATUS_VERSION || !isObj(raw.pages)) return null
  const out = emptyStatus()
  for (const [id, e] of Object.entries(raw.pages)) {
    if (id === '__proto__' || !isObj(e)) continue
    const u = typeof e.u === 'number' && Number.isFinite(e.u) ? clampUnderstanding(e.u) : undefined
    out.pages[id] = entry(e.r === 1, u, validTime(e.t) ? e.t : EPOCH)
  }
  if (isObj(raw.last) && typeof raw.last.id === 'string' && validTime(raw.last.t)) {
    out.last = { id: raw.last.id, t: raw.last.t }
  }
  return out
}

const newer = (a: string, b: string): boolean => Date.parse(a) > Date.parse(b)

/**
 * 2 つの記録を併せる。ページごとに `t` の新しい方を残す (同じ時刻なら `a`)。
 * どちらかにしか無い ID はそのまま残す
 */
export function mergeStatus(a: StatusData, b: StatusData): StatusData {
  const out = emptyStatus()
  for (const [id, e] of Object.entries(a.pages)) out.pages[id] = { ...e }
  for (const [id, e] of Object.entries(b.pages)) {
    const cur = out.pages[id]
    if (!cur || newer(e.t, cur.t)) out.pages[id] = { ...e }
  }
  const last = a.last && b.last ? (newer(b.last.t, a.last.t) ? b.last : a.last) : a.last ?? b.last
  if (last) out.last = { ...last }
  return out
}

export interface StatusSummary {
  /** 数えたページの数 */
  total: number
  /** 読んだ数 */
  read: number
  /** 読んだページのうち、理解度を付けた数 */
  rated: number
  /** 理解度の平均 (付けたページだけ・整数)。1 つも無ければ null */
  avg: number | null
}

/** 渡した ID のページだけを数える (今の目次に無い ID は、渡さなければ数に入らない) */
export function summarizeStatus(data: StatusData, pageIds: Iterable<string>): StatusSummary {
  let total = 0, read = 0, rated = 0, sum = 0
  for (const id of pageIds) {
    total++
    const e = data.pages[id]
    if (e?.r !== 1) continue
    read++
    if (e.u !== undefined) { rated++; sum += e.u }
  }
  return { total, read, rated, avg: rated ? Math.round(sum / rated) : null }
}

/** 書き出すファイルの名前。`rdsim-docs-status-YYYYMMDD.json` (その端末の日付) */
export function statusFileName(date: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `rdsim-docs-status-${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}.json`
}

/** 今の状態。変わるたびに新しい物になる (React の useSyncExternalStore にそのまま渡せる) */
export interface StatusSnapshot {
  data: StatusData
  /** 保存できているか。false の間はメモリだけで動いている (画面を閉じると消える) */
  saved: boolean
}

export type ImportResult =
  | { ok: true; /** 読み込んだ記録のページ数 */ pages: number; /** そのうち、今の記録を書き換えた・足した数 */ changed: number }
  | { ok: false; reason: 'format' }

export interface StatusStore {
  /** 保存のキー */
  readonly key: string
  get(): StatusSnapshot
  subscribe(fn: () => void): () => void
  /** 読んだ・未読を付ける。未読に戻しても項目は残す (併合で「戻した」が伝わるように) */
  setRead(id: string, read: boolean): void
  /** 理解度を付ける。同時に「読んだ」になる */
  setUnderstanding(id: string, u: number): void
  /** 最後に開いたページを覚える。状態の変更とは数えない (版の合わない記録をこれだけでは上書きしない) */
  setLast(id: string): void
  /** 今の記録の JSON (保存している物と同じ形) */
  exportJson(): string
  /** 書き出した JSON を併せる (`t` の新しい方を残す) */
  importJson(text: string): ImportResult
  /** 別のタブの変更を拾う。`storage` イベントの `key` と `newValue` を渡す */
  sync(key: string | null, newValue: string | null): void
}

export interface StatusStoreOptions {
  prefix?: string
  /** 置き場。省くと localStorage。null は「置き場なし」(メモリだけ) */
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null
  now?: () => Date
}

/** localStorage は「触った瞬間に throw する」環境がある (プライベートモードなど) */
function defaultStorage(): Pick<Storage, 'getItem' | 'setItem'> | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null }
}

export function createStatusStore(opts: StatusStoreOptions = {}): StatusStore {
  const key = statusKey(opts.prefix)
  const storage = opts.storage === undefined ? defaultStorage() : opts.storage
  const now = opts.now ?? (() => new Date())
  const subs = new Set<() => void>()

  let saved = storage !== null
  /** 読めない記録が置いてある。ユーザが状態を変えるまで上書きしない */
  let held = false
  let data = emptyStatus()
  if (storage) {
    try {
      const text = storage.getItem(key)
      const parsed = parseStatus(text)
      if (parsed) data = parsed
      else if (text !== null) held = true
    } catch { saved = false }
  }
  let snap: StatusSnapshot = { data, saved }

  const emit = () => {
    snap = { data, saved }
    for (const fn of [...subs]) fn()
  }
  const write = () => {
    if (!storage) return
    try { storage.setItem(key, JSON.stringify(data)); saved = true } catch { saved = false }
  }
  /** ユーザの変更。読めない記録があっても、ここからは上書きする */
  const commit = (next: StatusData) => {
    data = next
    held = false
    write()
    emit()
  }
  const withPage = (id: string, page: PageStatus): StatusData => ({ ...data, pages: { ...data.pages, [id]: page } })

  return {
    key,
    get: () => snap,
    subscribe(fn) {
      subs.add(fn)
      return () => { subs.delete(fn) }
    },
    setRead(id, read) {
      const cur = data.pages[id]
      if (!read && !cur) return
      commit(withPage(id, entry(read, cur?.u, now().toISOString())))
    },
    setUnderstanding(id, u) {
      commit(withPage(id, entry(true, clampUnderstanding(u), now().toISOString())))
    },
    setLast(id) {
      if (data.last?.id === id) return
      data = { ...data, last: { id, t: now().toISOString() } }
      if (!held) write()
      emit()
    },
    exportJson: () => JSON.stringify(data),
    importJson(text) {
      const incoming = parseStatus(text)
      if (!incoming) return { ok: false, reason: 'format' }
      const merged = mergeStatus(data, incoming)
      let changed = 0
      for (const [id, e] of Object.entries(incoming.pages)) if (merged.pages[id]?.t === e.t && data.pages[id]?.t !== e.t) changed++
      commit(merged)
      return { ok: true, pages: Object.keys(incoming.pages).length, changed }
    },
    sync(k, newValue) {
      // key が null は「全部消した」(storage.clear)
      if (k !== null && k !== key) return
      const parsed = parseStatus(newValue)
      if (parsed) { data = mergeStatus(parsed, data); held = false }
      else if (newValue === null) { data = emptyStatus(); held = false }
      else return
      emit()
    },
  }
}
