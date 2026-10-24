import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * テクスチャと JSON の取り方 (#395)。fetch を差し替え、モジュールの状態は毎回作り直す。
 *
 * - パックへは bundle の一覧にあるものだけ取りに行く (一覧に無いと 200 + index.html の無駄だった)
 * - 取ったものはページ内で覚える。「届かない」は覚えない
 * - 同時に呼んでも 1 回しか取らない
 */

type Assets = typeof import('./mcAssets')

const PIN = 'a95e329c161b7fdd19de9f78d0a91c45da57d921'
const BUNDLE_URL = '/resourcepack/bundle.json'
const PACK_TEX = '/resourcepack/assets/minecraft/textures/'
const MCMETA_RAW = 'https://raw.githubusercontent.com/misode/mcmeta/1.21.4-assets/assets/minecraft/textures/'
const MCMETA_JSD = 'https://cdn.jsdelivr.net/gh/misode/mcmeta@1.21.4-assets/assets/minecraft/textures/'
const PRISMARINE_RAW = `https://raw.githubusercontent.com/PrismarineJS/minecraft-assets/${PIN}/data/1.21.4/`
const PRISMARINE_JSD = `https://cdn.jsdelivr.net/gh/PrismarineJS/minecraft-assets@${PIN}/data/1.21.4/`

type Handler = (url: string) => Response | Promise<Response>

function stubFetch(handler: Handler): string[] {
  const calls: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    calls.push(url)
    return handler(url)
  }))
  return calls
}

const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200 })
const png = () => new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), {
  status: 200, headers: { 'content-type': 'image/png' },
})
/** Cloudflare Pages / Vite が存在しないパスに返すもの */
const spaFallback = () => new Response('<!doctype html>', {
  status: 200, headers: { 'content-type': 'text/html' },
})
const notFound = () => new Response('Not Found', { status: 404 })
const networkError = (): never => { throw new TypeError('Failed to fetch') }

const BUNDLE = {
  models: { 'block/lever/off': { parent: 'block/lever/base' } },
  blockstates: { lever: { variants: {} } },
  textures: ['block/lever/base', 'entity/chest/trapped'],
}

/** パック内に無いものは SPA のフォールバック、バニラは全部ある、という本番に近い応答 */
function production(bundle: unknown = BUNDLE): Handler {
  return (url) => {
    if (url === BUNDLE_URL) return bundle === null ? notFound() : json(bundle)
    if (url.startsWith(PACK_TEX)) {
      const path = url.slice(PACK_TEX.length).replace(/\.png$/, '')
      return BUNDLE.textures.includes(path) ? png() : spaFallback()
    }
    if (url.startsWith('/resourcepack/')) return spaFallback()
    return png()
  }
}

let assets: Assets

beforeEach(async () => {
  vi.resetModules()
  assets = await import('./mcAssets')
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/** 画像の切り出し・検証は node に無いので、描ける画像として振る舞う最小の代役を置く */
function stubImageDecoding(opts: { broken?: boolean } = {}) {
  class FakeImage {
    width = 16
    height = 16
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    set src(_url: string) { queueMicrotask(() => this.onload?.()) }
  }
  vi.stubGlobal('Image', FakeImage)
  vi.stubGlobal('createImageBitmap', vi.fn(async () => {
    if (opts.broken) throw new Error('broken image')
    return { width: 16, height: 16, close() {} }
  }))
}

describe('パックへは bundle の一覧にあるものだけ取りに行く (#395)', () => {
  it('一覧に無いテクスチャはパックへ行かず mcmeta (raw) から取る', async () => {
    const calls = stubFetch(production())
    const r = await assets.fetchTextureBlob('block/stone')
    expect(r.kind).toBe('ok')
    expect(calls).toEqual([BUNDLE_URL, `${MCMETA_RAW}block/stone.png`])
  })

  it('パックがバニラのパスで上書きしているトラップチェストは、今までどおりパックから取る', async () => {
    const calls = stubFetch(production())
    expect((await assets.fetchTextureBlob('entity/chest/trapped')).kind).toBe('ok')
    expect(calls).toEqual([BUNDLE_URL, `${PACK_TEX}entity/chest/trapped.png`])
  })

  it('textures の無い古い bundle なら、今までどおり全部パックを試す', async () => {
    const { textures: _omit, ...old } = BUNDLE
    const calls = stubFetch(production(old))
    expect((await assets.fetchTextureBlob('block/stone')).kind).toBe('ok')
    expect(calls).toEqual([BUNDLE_URL, `${PACK_TEX}block/stone.png`, `${MCMETA_RAW}block/stone.png`])
  })

  it('bundle が取れなければ、今までどおり全部パックを試す', async () => {
    const calls = stubFetch(production(null))
    expect((await assets.fetchTextureBlob('block/stone')).kind).toBe('ok')
    expect(calls).toEqual([BUNDLE_URL, `${PACK_TEX}block/stone.png`, `${MCMETA_RAW}block/stone.png`])
  })

  it('fetchPackJson は、bundle が読めたら bundle に無いものを fetch しない', async () => {
    const calls = stubFetch(production())
    expect(await assets.fetchPackJson('models/block/lever/off.json')).toEqual({ parent: 'block/lever/base' })
    expect(await assets.fetchPackJson('blockstates/lever.json')).toEqual({ variants: {} })
    expect(await assets.fetchPackJson('blockstates/stone.json')).toBeNull()
    expect(await assets.fetchPackJson('models/block/cube_all.json')).toBeNull()
    expect(calls).toEqual([BUNDLE_URL])
  })

  it('fetchPackJson は、bundle が無ければ今までどおり個別に取る', async () => {
    const calls = stubFetch(production(null))
    expect(await assets.fetchPackJson('blockstates/stone.json')).toBeNull()
    expect(calls).toEqual([BUNDLE_URL, '/resourcepack/assets/minecraft/blockstates/stone.json'])
  })

  it('bundle は同時に呼んでも 1 回だけ取り、どの呼び出しも読み込みを待つ', async () => {
    const calls = stubFetch(production())
    const first = assets.preloadPackBundle()
    // 以前は 2 つ目の呼び出しが読み込みを待たずに抜けていた (同じ Promise を返せば待てる)
    const second = assets.preloadPackBundle()
    expect(second).toBe(first)
    await second
    expect(await assets.fetchPackJson('blockstates/lever.json')).toEqual({ variants: {} })
    expect(calls).toEqual([BUNDLE_URL])
  })
})

describe('テクスチャの取得先の順番 (#395)', () => {
  it('mcmeta が全部 404 なら PrismarineJS の blocks/ を試す (block/ のみ)', async () => {
    const calls = stubFetch(url => {
      if (url === BUNDLE_URL) return json(BUNDLE)
      if (url.startsWith(PRISMARINE_JSD)) return png()
      return notFound()
    })
    expect((await assets.fetchTextureBlob('block/foo')).kind).toBe('ok')
    expect(calls).toEqual([
      BUNDLE_URL,
      `${MCMETA_RAW}block/foo.png`, `${MCMETA_JSD}block/foo.png`,
      `${PRISMARINE_RAW}blocks/foo.png`, `${PRISMARINE_JSD}blocks/foo.png`,
    ])
  })

  it('どこにも無ければ「無い」(市松で描く)。entity/ は PrismarineJS を試さない', async () => {
    const calls = stubFetch(url => (url === BUNDLE_URL ? json(BUNDLE) : notFound()))
    expect(await assets.fetchTextureBlob('entity/foo')).toEqual({ kind: 'missing' })
    expect(calls.some(u => u.includes('PrismarineJS'))).toBe(false)
  })

  it('mcmeta に届かなければ「届かない」(その面を単色で描く)。PrismarineJS へは進まない', async () => {
    const calls = stubFetch(url => (url === BUNDLE_URL ? json(BUNDLE) : networkError()))
    expect(await assets.fetchTextureBlob('block/stone')).toEqual({ kind: 'unreachable' })
    expect(calls.some(u => u.includes('PrismarineJS'))).toBe(false)
  })

  it('パックの取得が通信で失敗していたら、バニラに無くても「無い」とは言わない', async () => {
    stubFetch(url => {
      if (url === BUNDLE_URL) return json(BUNDLE)
      if (url.startsWith(PACK_TEX)) return networkError()
      return notFound()
    })
    expect(await assets.fetchTextureBlob('block/lever/base')).toEqual({ kind: 'unreachable' })
  })
})

describe('取得したテクスチャを覚える (#395)', () => {
  it('同時に 3 回呼んでも fetch は 1 回だけ。2 回目の作り直しでは取らない', async () => {
    stubImageDecoding()
    const calls = stubFetch(production())
    const rs = await Promise.all([1, 2, 3].map(() => assets.fetchTexture('block/stone')))
    expect(rs.map(r => r.kind)).toEqual(['ok', 'ok', 'ok'])
    expect(calls.filter(u => u.endsWith('block/stone.png'))).toHaveLength(1)

    calls.length = 0
    expect((await assets.fetchTexture('block/stone')).kind).toBe('ok')
    expect(calls).toEqual([])
  })

  it('取ったものは image/png にそろえて返す (CDN が octet-stream で返しても描けるように)', async () => {
    stubImageDecoding()
    stubFetch(url => (url === BUNDLE_URL ? json(BUNDLE)
      : new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'application/octet-stream' } })))
    const r = await assets.fetchTexture('block/stone')
    expect(r.kind === 'ok' && r.blob.type).toBe('image/png')
  })

  it('「無い」は覚える (固定した版なので変わらない)', async () => {
    const calls = stubFetch(url => (url === BUNDLE_URL ? json(BUNDLE) : notFound()))
    expect(await assets.fetchTexture('entity/foo')).toEqual({ kind: 'missing' })
    calls.length = 0
    expect(await assets.fetchTexture('entity/foo')).toEqual({ kind: 'missing' })
    expect(calls).toEqual([])
  })

  it('壊れた画像は「無い」として扱う (市松)', async () => {
    stubImageDecoding({ broken: true })
    stubFetch(production())
    expect(await assets.fetchTexture('block/stone')).toEqual({ kind: 'missing' })
  })

  it('全部届かない →「届かない」を返し、次の呼び出しでもう一度 fetch する', async () => {
    stubImageDecoding()
    const calls = stubFetch(url => (url === BUNDLE_URL ? json(BUNDLE) : networkError()))
    expect(await assets.fetchTexture('block/stone')).toEqual({ kind: 'unreachable' })
    expect(calls.length).toBeGreaterThan(1)

    // 戻ったら取れる
    const again = stubFetch(production())
    expect((await assets.fetchTexture('block/stone')).kind).toBe('ok')
    expect(again.filter(u => u.endsWith('block/stone.png')).length).toBe(1)
  })
})

describe('blocks_states / blocks_models (#395)', () => {
  it('同時に 3 回呼んでも JSON は 1 回だけ取る', async () => {
    const calls = stubFetch(() => json({ stone: {} }))
    const rs = await Promise.all([assets.getBlockStates(), assets.getBlockStates(), assets.getBlockStates()])
    expect(rs).toEqual([{ stone: {} }, { stone: {} }, { stone: {} }])
    expect(calls).toEqual([`${PRISMARINE_RAW}blocks_states.json`])
    await assets.getBlockStates()
    expect(calls).toHaveLength(1)
  })

  it('raw に届かなければ jsDelivr から取る', async () => {
    const calls = stubFetch(url => (url.startsWith('https://raw.') ? networkError() : json({ stone: {} })))
    expect(await assets.getBlockModels()).toEqual({ stone: {} })
    expect(calls).toEqual([`${PRISMARINE_RAW}blocks_models.json`, `${PRISMARINE_JSD}blocks_models.json`])
  })

  it('どこからも取れなければ null (単色で描く)。覚えずに次でまた取りに行く', async () => {
    stubFetch(() => networkError())
    expect(await assets.getBlockStates()).toBeNull()
    const again = stubFetch(() => json({ stone: {} }))
    expect(await assets.getBlockStates()).toEqual({ stone: {} })
    expect(again).toEqual([`${PRISMARINE_RAW}blocks_states.json`])
  })

  it('200 で HTML が返っても JSON として受け取らない', async () => {
    stubFetch(url => (url.startsWith('https://raw.') ? spaFallback() : json({ stone: {} })))
    expect(await assets.getBlockStates()).toEqual({ stone: {} })
  })
})

describe('パレットのアイコンの置き場 (#276)', () => {
  it('MCMETA_BASE の値は変えない (アイコンはミラーに載せていない)', () => {
    expect(assets.MCMETA_BASE)
      .toBe('https://raw.githubusercontent.com/misode/mcmeta/1.21.4-assets/assets/minecraft')
  })
})
