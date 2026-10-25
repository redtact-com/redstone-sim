import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest'

/**
 * 取得先のミラー (#395)。fetch を差し替え、モジュールの状態 (覚えたミラー) は毎回作り直す。
 *
 * raw.githubusercontent.com が落ちると盤面が出なかった。同じリポの同じ版を jsDelivr から取れること、
 * 応答が来なければ 8 秒で打ち切ること、一度落ちたら次から jsDelivr を先に試すことを見る。
 */

type Sources = typeof import('./assetSources')

const PIN = 'a95e329c161b7fdd19de9f78d0a91c45da57d921'
const FILE = 'data/1.21.4/blocks_states.json'
const RAW_URL = `https://raw.githubusercontent.com/PrismarineJS/minecraft-assets/${PIN}/${FILE}`
const JSD_URL = `https://cdn.jsdelivr.net/gh/PrismarineJS/minecraft-assets@${PIN}/${FILE}`

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>

/** fetch を差し替えて、呼ばれた URL を順に記録する */
function stubFetch(handler: Handler): string[] {
  const calls: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push(url)
    return handler(url, init)
  }))
  return calls
}

const isRaw = (url: string) => url.startsWith('https://raw.githubusercontent.com/')
const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200 })
const status = (code: number) => new Response('x', { status: code })
const networkError = () => { throw new TypeError('Failed to fetch') }
const readJson = (res: Response) => res.json() as Promise<unknown>

let src: Sources
let warn: MockInstance<typeof console.warn>

beforeEach(async () => {
  vi.resetModules()
  src = await import('./assetSources')
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('取得先の固定 (#395)', () => {
  it('PrismarineJS はコミット、mcmeta はタグで固定し、ミラーごとに URL を組み立てる', () => {
    expect(src.PRISMARINE.ref).toBe(PIN)
    expect(src.MCMETA.ref).toBe('1.21.4-assets')
    expect(src.MIRRORS.map(m => m.url(src.PRISMARINE, FILE))).toEqual([RAW_URL, JSD_URL])
    expect(src.MIRRORS[1].url(src.MCMETA, 'assets/minecraft/textures/block/stone.png'))
      .toBe('https://cdn.jsdelivr.net/gh/misode/mcmeta@1.21.4-assets/assets/minecraft/textures/block/stone.png')
  })
})

describe('ミラーを順に試す (#395)', () => {
  it('普段は raw だけを取る', async () => {
    const calls = stubFetch(() => json({ stone: 1 }))
    const r = await src.fetchFromMirrors(src.PRISMARINE, FILE, readJson)
    expect(r).toEqual({ kind: 'ok', value: { stone: 1 } })
    expect(calls).toEqual([RAW_URL])
    expect(warn).not.toHaveBeenCalled()
  })

  it.each([
    ['通信エラー', networkError],
    ['429', () => status(429)],
    ['503', () => status(503)],
    ['壊れた JSON', () => new Response('{"stone":', { status: 200 })],
  ])('raw が %s → コミット固定の jsDelivr の URL を取りに行く', async (_label, rawRes) => {
    const calls = stubFetch(url => (isRaw(url) ? rawRes() : json({ from: 'jsd' })))
    const r = await src.fetchFromMirrors(src.PRISMARINE, FILE, readJson)
    expect(r).toEqual({ kind: 'ok', value: { from: 'jsd' } })
    expect(calls).toEqual([RAW_URL, JSD_URL])
    // ミラーを切り替えたことを 1 回だけ知らせる
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('raw が 404 で jsDelivr が 200 → jsDelivr の中身を返し、リポが消えた合図として 1 回知らせる', async () => {
    const calls = stubFetch(url => (isRaw(url) ? status(404) : json({ from: 'jsd' })))
    const r = await src.fetchFromMirrors(src.PRISMARINE, FILE, readJson)
    expect(r).toEqual({ kind: 'ok', value: { from: 'jsd' } })
    expect(calls).toEqual([RAW_URL, JSD_URL])
    expect(warn.mock.calls.some(c => String(c[0]).includes('リポが消えていないか'))).toBe(true)
  })

  it('両方 404 →「無い」', async () => {
    stubFetch(() => status(404))
    expect(await src.fetchFromMirrors(src.PRISMARINE, FILE, readJson)).toEqual({ kind: 'missing' })
  })

  it('通信の失敗が 1 つでもあれば「届かない」(404 と混ざっても)', async () => {
    stubFetch(url => (isRaw(url) ? networkError() : status(404)))
    expect(await src.fetchFromMirrors(src.PRISMARINE, FILE, readJson)).toEqual({ kind: 'unreachable' })
    stubFetch(() => networkError())
    expect(await src.fetchFromMirrors(src.PRISMARINE, FILE, readJson)).toEqual({ kind: 'unreachable' })
  })

  it('一度 raw が落ちたら、次の取得は jsDelivr から始める', async () => {
    const calls = stubFetch(url => (isRaw(url) ? networkError() : json({ ok: true })))
    await src.fetchFromMirrors(src.PRISMARINE, FILE, readJson)
    calls.length = 0
    await src.fetchFromMirrors(src.PRISMARINE, 'data/1.21.4/blocks_models.json', readJson)
    expect(calls).toEqual([`https://cdn.jsdelivr.net/gh/PrismarineJS/minecraft-assets@${PIN}/data/1.21.4/blocks_models.json`])

    // jsDelivr が落ちて raw が戻ったら、また raw を先に試す
    stubFetch(url => (isRaw(url) ? json({ ok: true }) : networkError()))
    await src.fetchFromMirrors(src.PRISMARINE, FILE, readJson)
    const again = stubFetch(() => json({ ok: true }))
    await src.fetchFromMirrors(src.PRISMARINE, FILE, readJson)
    expect(again).toEqual([RAW_URL])
  })
})

describe('応答が来ないときの打ち切り (#395)', () => {
  /** 本物の fetch と同じく、signal が abort されたら AbortError で reject する */
  const hang: Handler = (_url, init) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
  })

  it('応答ヘッダが 8 秒来なければ打ち切って次へ進む', async () => {
    vi.useFakeTimers()
    const calls = stubFetch((url, init) => (isRaw(url) ? hang(url, init) : json({ from: 'jsd' })))
    const p = src.fetchFromMirrors(src.PRISMARINE, FILE, readJson)

    await vi.advanceTimersByTimeAsync(src.RESPONSE_TIMEOUT_MS - 1)
    expect(calls, '8 秒経つまでは次へ進まない').toEqual([RAW_URL])

    await vi.advanceTimersByTimeAsync(1)
    expect(await p).toEqual({ kind: 'ok', value: { from: 'jsd' } })
    expect(calls).toEqual([RAW_URL, JSD_URL])
    expect(src.RESPONSE_TIMEOUT_MS).toBe(8000)
  })

  it('応答ヘッダが来たら、本文の読み込みには時間制限を掛けない', async () => {
    vi.useFakeTimers()
    stubFetch(() => json({ slow: true }))
    const slowRead = async (res: Response) => {
      await new Promise(r => setTimeout(r, 20_000))
      return res.json() as Promise<unknown>
    }
    const p = src.fetchFromMirrors(src.PRISMARINE, FILE, slowRead)
    await vi.advanceTimersByTimeAsync(20_000)
    expect(await p).toEqual({ kind: 'ok', value: { slow: true } })
  })

  it('どこも応答しなければ、16 秒後に「届かない」', async () => {
    vi.useFakeTimers()
    stubFetch(hang)
    const p = src.fetchFromMirrors(src.PRISMARINE, FILE, readJson)
    await vi.advanceTimersByTimeAsync(src.RESPONSE_TIMEOUT_MS * 2)
    expect(await p).toEqual({ kind: 'unreachable' })
  })
})
