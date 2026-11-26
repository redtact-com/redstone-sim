import { describe, it, expect } from 'vitest'
import {
  createStatusStore, mergeStatus, parseStatus, statusFileName, statusKey, summarizeStatus,
} from '@redstone/docs-kit'
import type { StatusData } from '@redstone/docs-kit'

/** メモリの上の置き場。`fail` で読み書きを throw させる */
function memStorage(init: Record<string, string> = {}, fail: { get?: boolean; set?: boolean } = {}) {
  const map = new Map(Object.entries(init))
  let writes = 0
  return {
    map,
    get writes() { return writes },
    getItem(k: string) { if (fail.get) throw new Error('SecurityError'); return map.get(k) ?? null },
    setItem(k: string, v: string) { if (fail.set) throw new Error('QuotaExceededError'); writes++; map.set(k, v) },
  }
}

/** 呼ぶたびに 1 分進む時計 */
function clock(start = '2026-11-26T10:00:00.000Z') {
  let t = Date.parse(start)
  return () => { const d = new Date(t); t += 60_000; return d }
}

const KEY = 'rdsim:docs:status:v1'
const data = (pages: StatusData['pages'], last?: StatusData['last']): StatusData => ({ v: 1, pages, ...(last ? { last } : {}) })

describe('状態の保存のキーと形 (#434)', () => {
  it('キーは rdsim:docs:status:v1。接頭辞は引数', () => {
    expect(statusKey()).toBe(KEY)
    expect(statusKey('guide')).toBe('guide:status:v1')
    expect(createStatusStore({ storage: null }).key).toBe(KEY)
  })

  it('読んだ・理解度を付けると、方針の形の JSON が 1 個のキーに入る', () => {
    const st = memStorage()
    const store = createStatusStore({ storage: st, now: clock() })
    store.setUnderstanding('v07/4.3', 60)
    expect([...st.map.keys()]).toEqual([KEY])
    expect(JSON.parse(st.map.get(KEY)!)).toEqual({ v: 1, pages: { 'v07/4.3': { r: 1, u: 60, t: '2026-11-26T10:00:00.000Z' } } })
  })

  it('理解度を動かすと自動で「読んだ」になる。0〜100 の整数に丸める', () => {
    const store = createStatusStore({ storage: null })
    store.setUnderstanding('a', 62.4)
    store.setUnderstanding('b', 140)
    store.setUnderstanding('c', -3)
    const p = store.get().data.pages
    expect([p.a.r, p.a.u, p.b.u, p.c.u]).toEqual([1, 62, 100, 0])
  })

  it('未読に戻しても項目と理解度は残し、r だけ外す。項目の無いページを未読にしても何も書かない', () => {
    const st = memStorage()
    const store = createStatusStore({ storage: st, now: clock() })
    store.setRead('x', false)
    expect(st.writes).toBe(0)
    store.setUnderstanding('x', 40)
    store.setRead('x', false)
    expect(store.get().data.pages.x).toEqual({ u: 40, t: '2026-11-26T10:01:00.000Z' })
    store.setRead('x', true)
    expect(store.get().data.pages.x).toEqual({ r: 1, u: 40, t: '2026-11-26T10:02:00.000Z' })
  })

  it('作り直すと、保存した記録から始まる (再読み込みで残る)', () => {
    const st = memStorage()
    const a = createStatusStore({ storage: st, now: clock() })
    a.setRead('v07/1', true)
    a.setUnderstanding('v07/4.3', 60)
    a.setLast('v07/4.3')
    const b = createStatusStore({ storage: st })
    expect(b.get().data).toEqual(a.get().data)
    expect(b.get().data.last?.id).toBe('v07/4.3')
    expect(b.get().saved).toBe(true)
  })

  it('変わるたびに新しい snapshot を返し、購読者を呼ぶ', () => {
    const store = createStatusStore({ storage: null })
    let n = 0
    const off = store.subscribe(() => { n++ })
    const s0 = store.get()
    expect(store.get()).toBe(s0)
    store.setRead('a', true)
    expect(store.get()).not.toBe(s0)
    off()
    store.setRead('b', true)
    expect(n).toBe(1)
  })
})

describe('併合 (読み込み)', () => {
  const older = '2026-11-01T00:00:00.000Z'
  const newer = '2026-11-20T00:00:00.000Z'

  it('ページごとに t の新しい方を残す。同じ時刻は手元を残す', () => {
    const mine = data({ a: { r: 1, u: 30, t: older }, b: { r: 1, u: 80, t: newer }, c: { r: 1, u: 10, t: older } })
    const theirs = data({ a: { r: 1, u: 70, t: newer }, b: { r: 1, u: 20, t: older }, c: { r: 1, u: 90, t: older } })
    const m = mergeStatus(mine, theirs)
    expect([m.pages.a.u, m.pages.b.u, m.pages.c.u]).toEqual([70, 80, 10])
  })

  it('新しい「未読に戻した」は、古い「読んだ」に勝つ', () => {
    const m = mergeStatus(data({ a: { r: 1, u: 50, t: older } }), data({ a: { u: 50, t: newer } }))
    expect(m.pages.a.r).toBeUndefined()
  })

  it('片方にしか無い ID は残す。今の目次に無い ID も消さず、集計には数えない', () => {
    const store = createStatusStore({ storage: null, now: clock() })
    store.setUnderstanding('v07/4.3', 60)
    const res = store.importJson(JSON.stringify(data({ 'v99/gone': { r: 1, u: 100, t: newer }, 'v07/1': { r: 1, t: newer } })))
    expect(res).toEqual({ ok: true, pages: 2, changed: 2 })
    const d = store.get().data
    expect(Object.keys(d.pages).sort()).toEqual(['v07/1', 'v07/4.3', 'v99/gone'])
    expect(summarizeStatus(d, ['v07/1', 'v07/4.3', 'v07/5'])).toEqual({ total: 3, read: 2, rated: 1, avg: 60 })
  })

  it('読み込んだ数と、書き換えた数を返す (古い記録は書き換えない)', () => {
    const store = createStatusStore({ storage: null, now: clock('2026-11-10T00:00:00.000Z') })
    store.setUnderstanding('a', 30)
    const res = store.importJson(JSON.stringify(data({ a: { r: 1, u: 90, t: older }, b: { r: 1, t: older } })))
    expect(res).toEqual({ ok: true, pages: 2, changed: 1 })
    expect(store.get().data.pages.a.u).toBe(30)
  })

  it('書き出した JSON を別の置き場 (別のオリジン) で読み込むと、同じ集計になる', () => {
    const ids = ['p1', 'p2', 'p3', 'p4']
    const a = createStatusStore({ storage: memStorage(), now: clock() })
    a.setUnderstanding('p1', 60)
    a.setUnderstanding('p2', 45)
    a.setRead('p3', true)
    const b = createStatusStore({ storage: memStorage() })
    expect(b.importJson(a.exportJson())).toEqual({ ok: true, pages: 3, changed: 3 })
    expect(summarizeStatus(b.get().data, ids)).toEqual(summarizeStatus(a.get().data, ids))
    expect(summarizeStatus(b.get().data, ids)).toEqual({ total: 4, read: 3, rated: 2, avg: 53 })
    expect(b.exportJson()).toBe(a.exportJson())
  })

  it('形の違うファイルは読み込まず、今の記録を変えない', () => {
    const store = createStatusStore({ storage: null })
    store.setRead('a', true)
    const before = store.get()
    for (const text of ['', 'not json', '[]', '{"v":2,"pages":{}}', '{"v":1}', '{"v":1,"pages":[]}']) {
      expect(store.importJson(text)).toEqual({ ok: false, reason: 'format' })
    }
    expect(store.get()).toBe(before)
  })

  it('項目の欄を確かめ直す (知らない欄は捨てる・理解度は丸める・読めない t は一番古い時刻)', () => {
    const d = parseStatus(JSON.stringify({
      v: 1,
      pages: { a: { r: 1, u: 61.7, t: 'x', extra: 1 }, b: { r: 'yes', u: 'high', t: newer }, c: 5, d: { r: 1, u: 999, t: newer } },
      last: { id: 'a', t: newer }, other: true,
    }))!
    expect(d.pages).toEqual({
      a: { r: 1, u: 62, t: '1970-01-01T00:00:00.000Z' },
      b: { t: newer },
      d: { r: 1, u: 100, t: newer },
    })
    expect(d.last).toEqual({ id: 'a', t: newer })
  })
})

describe('版ちがいと壊れた記録', () => {
  for (const [name, text] of [
    ['版が違う', '{"v":2,"pages":{"a":{"r":1,"t":"2026-11-01T00:00:00.000Z"}}}'],
    ['JSON でない', '{{{'],
  ] as const) {
    it(`${name}記録は読まずに空から始め、ユーザが状態を変えるまで上書きしない`, () => {
      const st = memStorage({ [KEY]: text })
      const store = createStatusStore({ storage: st, now: clock() })
      expect(store.get().data).toEqual({ v: 1, pages: {} })
      // ページを開いただけ (最後に開いたページ) では上書きしない
      store.setLast('v07/1')
      expect(store.get().data.last?.id).toBe('v07/1')
      expect(st.map.get(KEY)).toBe(text)
      expect(st.writes).toBe(0)
      // 状態を変えたら、そこからは保存する
      store.setRead('v07/1', true)
      expect(JSON.parse(st.map.get(KEY)!)).toMatchObject({ v: 1, pages: { 'v07/1': { r: 1 } }, last: { id: 'v07/1' } })
      store.setLast('v07/2')
      expect(JSON.parse(st.map.get(KEY)!).last.id).toBe('v07/2')
    })
  }
})

describe('throw する storage', () => {
  it('読む時に throw しても空から動き、保存できていないと分かる', () => {
    const store = createStatusStore({ storage: memStorage({}, { get: true, set: true }) })
    expect(store.get()).toEqual({ data: { v: 1, pages: {} }, saved: false })
    expect(() => { store.setUnderstanding('a', 50); store.setLast('a') }).not.toThrow()
    expect(store.get().data.pages.a).toMatchObject({ r: 1, u: 50 })
    expect(store.get().saved).toBe(false)
  })

  it('書く時だけ throw する (容量超過) なら、メモリで続けて saved を false にする', () => {
    const st = memStorage({}, { set: true })
    const store = createStatusStore({ storage: st })
    expect(store.get().saved).toBe(true)
    store.setRead('a', true)
    expect(store.get().saved).toBe(false)
    expect(store.get().data.pages.a.r).toBe(1)
    expect(store.exportJson()).toContain('"a"')
  })

  it('置き場が無い (null) 時もメモリで動く', () => {
    const store = createStatusStore({ storage: null })
    store.setRead('a', true)
    expect(store.get().saved).toBe(false)
    expect(summarizeStatus(store.get().data, ['a', 'b'])).toEqual({ total: 2, read: 1, rated: 0, avg: null })
  })
})

describe('別のタブ (storage イベント)', () => {
  it('同じキーの変更を拾う。ほかのキーは無視する', () => {
    const st = memStorage()
    const a = createStatusStore({ storage: st, now: clock() })
    const b = createStatusStore({ storage: st, now: clock() })
    let n = 0
    b.subscribe(() => { n++ })
    a.setUnderstanding('v07/4.3', 60)
    b.sync('rdsim:editor:circuit', '{"v":1}')
    expect(n).toBe(0)
    b.sync(KEY, st.map.get(KEY)!)
    expect(n).toBe(1)
    expect(b.get().data.pages['v07/4.3'].u).toBe(60)
    const writes = st.writes
    b.sync(KEY, 'broken')
    expect(b.get().data.pages['v07/4.3'].u).toBe(60)
    expect(st.writes).toBe(writes)
  })

  it('消された (newValue が null) ら空に戻す', () => {
    const store = createStatusStore({ storage: memStorage() })
    store.setRead('a', true)
    store.sync(null, null)
    expect(store.get().data.pages).toEqual({})
  })
})

describe('書き出すファイルの名前', () => {
  it('rdsim-docs-status-YYYYMMDD.json', () => {
    expect(statusFileName(new Date(2026, 10, 26, 10, 0))).toBe('rdsim-docs-status-20261126.json')
    expect(statusFileName(new Date(2027, 0, 5))).toBe('rdsim-docs-status-20270105.json')
  })
})
