import { MC_VERSION, MCMETA, PRISMARINE, fetchFromMirrors } from './assetSources'

/**
 * mcmeta のテクスチャの置き場 (raw)。**パレットのアイコンが img で直接読む** (#276)。
 *
 * ビューア自身はここを使わず、`assetSources.ts` のミラーを順に試す (#395)。
 * パレットのアイコンはミラーに載せていない (今も onError で代わりの絵に替わる) ので、値は変えない。
 */
export const MCMETA_BASE =
  `https://raw.githubusercontent.com/${MCMETA.repo}/${MCMETA.ref}/assets/minecraft`

/**
 * カスタムリソースパックの基点 URL の既定。エディタは `public/resourcepack/` をここで配る。
 *
 * 別の場所で使うときは `IsometricView` の `resourcePackUrl` で変える (#434)。
 * 基点の下に `bundle.json` と `assets/minecraft/...` がある前提は変わらない。
 */
export const DEFAULT_RESOURCE_PACK_URL = '/resourcepack'

/**
 * パック JSON キャッシュ。**解決値ではなく Promise を持つ** (#276)。
 *
 * 値を await の後に入れていたので、**同一 URL への並列呼び出しが全部 fetch に行っていた**。
 * Cloudflare が `cache-control: max-age=0, must-revalidate` を返すため、
 * Chrome は同一 URL の要求をキャッシュロックで**直列化**する。
 * `note_block/template_note.json` 1 本が 50 回 × 約 22ms = 1093ms を占めていた
 * (実測: 同一 URL×50 並列 = 1069-1584ms / 別 URL×50 並列 = 102-111ms / 重複排除 = 23-28ms)。
 */
type PackJsonCache = Map<string, Promise<unknown | null>>

/** bundle.json (models + blockstates + テクスチャ一覧を 1 本にまとめたもの) */
interface PackBundle {
  models: Record<string, unknown>
  blockstates: Record<string, unknown>
  /** パック内のテクスチャのパス (拡張子なし)。**古い bundle には無い** (#395) */
  textures?: string[]
}

/**
 * 基点 URL ごとの状態 (#434)。基点が違えば中身も違いうるので、覚えた物を混ぜない。
 * 既定の基点しか使わなければ 1 個だけで、今までのモジュール変数と同じ動きになる。
 */
interface PackState {
  /** 末尾の `/` を除いた基点 */
  url: string
  /** null = 未取得 / 取得失敗 */
  bundle: PackBundle | null
  /** パック内のテクスチャ。null = 一覧が無い (bundle が取れない・古い bundle) → 今までどおり全部パックを試す */
  textures: Set<string> | null
  bundlePromise: Promise<void> | null
  jsonCache: PackJsonCache
  textureCache: Map<string, Promise<TextureResult>>
}

const packs = new Map<string, PackState>()

function packOf(packUrl: string = DEFAULT_RESOURCE_PACK_URL): PackState {
  const url = packUrl.replace(/\/+$/, '')
  let pack = packs.get(url)
  if (!pack) {
    pack = { url, bundle: null, textures: null, bundlePromise: null, jsonCache: new Map(), textureCache: new Map() }
    packs.set(url, pack)
  }
  return pack
}

/**
 * パック JSON を 1 本にまとめた `bundle.json` を先読みする (#276)。
 *
 * br 19.3KB / 1 リクエストで、個別 358 本 (3 波 470-650ms) を置き換えられる。
 * **取れなければ黙って諦める** — 呼び出し側は今までどおり個別取得にフォールバックする。
 *
 * **Promise を覚える** (#395)。以前は 2 つ目の呼び出しが読み込みを待たずに抜けていたので、
 * 同時に作ると bundle を待たずに個別取得へ進むことがあった。
 */
export function preloadPackBundle(packUrl?: string): Promise<void> {
  const pack = packOf(packUrl)
  if (!pack.bundlePromise) {
    pack.bundlePromise = (async () => {
      try {
        const res = await fetch(`${pack.url}/bundle.json`)
        if (!res.ok) return
        const data = await res.json() as Partial<PackBundle> | null
        // Cloudflare Pages は**存在しないパスにも 200 + index.html** を返すので、
        // 中身が想定の形かどうかで判定する (res.ok だけでは足りない)
        if (data && typeof data === 'object' && data.models && data.blockstates) {
          pack.bundle = data as PackBundle
          if (Array.isArray(data.textures)) pack.textures = new Set(data.textures)
        }
      } catch { /* 個別取得へフォールバック */ }
    })()
  }
  return pack.bundlePromise
}

const BUNDLE_MODEL = /^models\/block\/(.+)\.json$/
const BUNDLE_STATE = /^blockstates\/(.+)\.json$/

/** bundle にあれば返す。`models/block/foo.json` / `blockstates/foo.json` の形で引く */
function fromBundle(packBundle: PackBundle | null, subpath: string): unknown | undefined {
  if (!packBundle) return undefined
  const m = BUNDLE_MODEL.exec(subpath)
  if (m) return packBundle.models[`block/${m[1]}`]
  const b = BUNDLE_STATE.exec(subpath)
  if (b) return packBundle.blockstates[b[1]]
  return undefined
}

// ── PrismarineJS の一括 JSON (2 リクエストで全量) ─────────────────────

/**
 * 取得中または取得済みの Promise。**await の前に入れる** (#395)。
 * 以前は await のあとで値を入れていたので、同時に作ると JSON を 2 回取っていた。
 * 取れなかったら消して、次に作り直すときに取り直す。
 */
let blockStatesPromise: Promise<Record<string, unknown> | null> | null = null
let blockModelsPromise: Promise<Record<string, unknown> | null> | null = null

/** 本文を JSON として読む。**オブジェクトでなければ壊れているとみなして次のミラーへ進む** */
async function readJsonObject(res: Response): Promise<Record<string, unknown>> {
  const data = await res.json() as unknown
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('JSON がオブジェクトではない')
  }
  return data as Record<string, unknown>
}

function fetchPrismarineJson(file: string): Promise<Record<string, unknown> | null> {
  return fetchFromMirrors(PRISMARINE, `data/${MC_VERSION}/${file}`, readJsonObject)
    .then(r => (r.kind === 'ok' ? r.value : null))
}

/** blocks_states.json。**どのミラーからも取れなければ null** (呼び出し側は単色で描く) */
export function getBlockStates(): Promise<Record<string, unknown> | null> {
  if (!blockStatesPromise) {
    const p = fetchPrismarineJson('blocks_states.json').then(v => {
      if (v === null && blockStatesPromise === p) blockStatesPromise = null
      return v
    })
    blockStatesPromise = p
  }
  return blockStatesPromise
}

/** blocks_models.json。**どのミラーからも取れなければ null** (呼び出し側は単色で描く) */
export function getBlockModels(): Promise<Record<string, unknown> | null> {
  if (!blockModelsPromise) {
    const p = fetchPrismarineJson('blocks_models.json').then(v => {
      if (v === null && blockModelsPromise === p) blockModelsPromise = null
      return v
    })
    blockModelsPromise = p
  }
  return blockModelsPromise
}

/**
 * リソースパックから JSON ファイルを取得する。
 * subpath: "blockstates/lever.json" / "models/block/lever/off.json" など
 * 存在しない場合は null を返す。
 */
export function fetchPackJson(subpath: string, packUrl?: string): Promise<unknown | null> {
  const pack = packOf(packUrl)
  const hit = pack.jsonCache.get(subpath)
  if (hit) return hit
  // **await の前に Promise を入れる**。ここが後だと同一 URL の並列呼び出しが素通りする
  const p = (async (): Promise<unknown | null> => {
    await preloadPackBundle(pack.url)
    // bundle にあるものはネットワークへ行かない (#276)
    const bundled = fromBundle(pack.bundle, subpath)
    if (bundled !== undefined) return bundled
    // **bundle が読めたら、そこに無いものはパックに無い** (#395)。取りに行っても
    // Cloudflare Pages が 200 + index.html を返すだけだった (本番の初回ロードで 36 本)
    if (pack.bundle && (BUNDLE_MODEL.test(subpath) || BUNDLE_STATE.test(subpath))) return null
    try {
      const res = await fetch(`${pack.url}/assets/minecraft/${subpath}`)
      if (!res.ok) return null
      return await res.json() as unknown
    } catch {
      return null
    }
  })()
  pack.jsonCache.set(subpath, p)
  return p
}

// ── テクスチャ ────────────────────────────────────────────────────────

/** 取得だけの結果。`blob` はまだ切り出しも検証もしていない */
export type TextureFetchResult =
  | { kind: 'ok'; blob: Blob }
  | { kind: 'missing' }
  | { kind: 'unreachable' }

/**
 * テクスチャの結果。
 * - `ok`: 先頭フレームを切り出し、image/png にそろえて検証済み
 * - `missing`: どこにも無い (全部 404・壊れた画像)。今までどおり市松で描く
 *   (#343 のような取りこぼしに気づけるようにするため)
 * - `unreachable`: 届かない。その面を単色で描く
 */
export type TextureResult = TextureFetchResult

/**
 * テクスチャのキャッシュ (#395)。**パスごとに Promise を持つ** (await の前に入れる)。
 *
 * 盤面を作り直すたびに全テクスチャを取り直していた (START のたびに 347 本・約 2.2 秒。
 * デモと埋め込みは回路を読み込むときに作り直すので、同じものを 2 回取っていた)。
 * 成功と「無い」は覚える (固定した版なので変わらない)。**「届かない」は覚えない**。
 */
// (キャッシュの実体は基点ごとの PackState.textureCache。パックが先に試されるので、基点が違えば結果も違いうる)

/**
 * テクスチャを取って、描ける Blob にそろえる。
 * 1. ローカルリソースパック (bundle の一覧にあるときだけ。一覧が無ければ今までどおり試す)
 * 2. misode/mcmeta (raw → jsDelivr)
 * 3. block/ テクスチャは PrismarineJS (raw → jsDelivr)
 */
export function fetchTexture(path: string, packUrl?: string): Promise<TextureResult> {
  const { textureCache, url } = packOf(packUrl)
  const hit = textureCache.get(path)
  if (hit) return hit
  const p: Promise<TextureResult> = loadTexture(path, url)
    .catch((): TextureResult => ({ kind: 'unreachable' }))
    .then(r => {
      if (r.kind === 'unreachable' && textureCache.get(path) === p) textureCache.delete(path)
      return r
    })
  textureCache.set(path, p)
  return p
}

/** 「取得 → 先頭フレームの切り出し → image/png にそろえて検証」を 1 本にまとめる */
async function loadTexture(path: string, packUrl: string): Promise<TextureResult> {
  const fetched = await fetchTextureBlob(path, packUrl)
  if (fetched.kind !== 'ok') return fetched
  const blob = await prepareTexture(fetched.blob, path)
  return blob ? { kind: 'ok', blob } : { kind: 'missing' }
}

/** bundle が取れないか古いときは一覧が無いので、今までどおり全部パックを試す */
function mayBeInPack(pack: PackState, path: string): boolean {
  return pack.textures === null || pack.textures.has(path)
}

/**
 * テクスチャの取得だけを行う (覚えない)。画像を扱わないので node でも試せる。
 *
 * どのミラーにも届かなければ `unreachable`。全部 404 なら `missing`。
 * パックの取得が通信で失敗していたら、バニラに無くても `missing` とは言い切れないので `unreachable`。
 */
export async function fetchTextureBlob(path: string, packUrl?: string): Promise<TextureFetchResult> {
  const pack = packOf(packUrl)
  await preloadPackBundle(pack.url)
  let packFailed = false

  // 1. ローカルリソースパック優先 (bundle の一覧にあるものだけ。#395)
  // Vite dev server / Cloudflare Pages は存在しないパスに index.html (text/html, 200) を返すため
  // Content-Type が image/* のレスポンスのみ受け付ける
  if (mayBeInPack(pack, path)) {
    try {
      const res = await fetch(`${pack.url}/assets/minecraft/textures/${path}.png`)
      const ct = res.headers.get('content-type') ?? ''
      if (res.ok && ct.includes('image')) return { kind: 'ok', blob: await res.blob() }
    } catch {
      packFailed = true
    }
  }

  // 2. mcmeta（バニラ）
  const mcmeta = await fetchFromMirrors(MCMETA, `assets/minecraft/textures/${path}.png`, readBlob)
  if (mcmeta.kind === 'ok') return { kind: 'ok', blob: mcmeta.value }
  if (mcmeta.kind === 'unreachable') return { kind: 'unreachable' }

  // 3. entity/ テクスチャは mcmeta にしか存在しないためフォールバック不要
  if (path.startsWith('block/')) {
    const name = path.slice('block/'.length)
    const prismarine = await fetchFromMirrors(PRISMARINE, `data/${MC_VERSION}/blocks/${name}.png`, readBlob)
    if (prismarine.kind === 'ok') return { kind: 'ok', blob: prismarine.value }
    if (prismarine.kind === 'unreachable') return { kind: 'unreachable' }
  }

  return packFailed ? { kind: 'unreachable' } : { kind: 'missing' }
}

function readBlob(res: Response): Promise<Blob> {
  return res.blob()
}

/**
 * 先頭フレームを切り出し、image/png にそろえて検証する。壊れていれば null。
 *
 * GitHub CDN は PNG を application/octet-stream 等で返すことがあり、
 * createImageBitmap が MIME タイプを見て失敗するケースがある。
 * Blob を image/png に強制変換してから検証することで回避する。
 */
async function prepareTexture(blob: Blob, path: string): Promise<Blob | null> {
  const normalized = await normalizeTexture(blob)
  const typed = normalized.type === 'image/png'
    ? normalized
    : new Blob([normalized], { type: 'image/png' })
  try {
    const bmp = await createImageBitmap(typed)
    bmp.close()
    return typed
  } catch {
    console.warn(`[mcAssets] skip invalid texture: ${path}`)
    return null
  }
}

/**
 * アニメーションテクスチャ（縦長 PNG）を先頭フレームだけに切り出す。
 * 高解像度テクスチャ（32×32 等）はそのまま返す。
 * buildAtlas32 がスロット 32×32 に等倍描画するため、ここではリサイズしない。
 */
async function normalizeTexture(blob: Blob): Promise<Blob> {
  return new Promise((resolve) => {
    const img = new Image()
    const url = URL.createObjectURL(blob)
    img.onload = () => {
      URL.revokeObjectURL(url)
      if (img.height > img.width) {
        // アニメーション: 先頭フレーム（width × width）を切り出す
        const canvas = document.createElement('canvas')
        canvas.width = img.width
        canvas.height = img.width
        canvas.getContext('2d')!.drawImage(img, 0, 0)
        canvas.toBlob((b) => resolve(b ?? blob), 'image/png')
      } else {
        resolve(blob)
      }
    }
    img.onerror = () => { URL.revokeObjectURL(url); resolve(blob) }
    img.src = url
  })
}
