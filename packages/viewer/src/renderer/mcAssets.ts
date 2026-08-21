const MC_VERSION = '1.21.4'

// blockstates・models は PrismarineJS の一括 JSON（2 リクエストで全量取得）
const PRISMARINE_BASE = `https://raw.githubusercontent.com/PrismarineJS/minecraft-assets/master/data/${MC_VERSION}`

// テクスチャは misode/mcmeta（Java Edition モデルの参照パスと完全一致）。
//
// **タグで固定する** (#276)。`assets` ブランチは動き続けるので、
// 今まではスナップショットが出るたびに**見た目が黙って変わり得る**状態だった
// (計測時点では 26.3 Snapshot 9 を引いていた)。
// 固定した時点で 75 本を 1.21.4-assets とピクセル比較して 75/75 一致を確認しているので、
// **この変更で見た目は変わらない**。上げるときは同じ比較をしてから上げること。
export const MCMETA_BASE =
  `https://raw.githubusercontent.com/misode/mcmeta/${MC_VERSION}-assets/assets/minecraft`

// カスタムリソースパック（public/resourcepack/）
const PACK_BASE = '/resourcepack/assets/minecraft'

/**
 * パック JSON キャッシュ。**解決値ではなく Promise を持つ** (#276)。
 *
 * 値を await の後に入れていたので、**同一 URL への並列呼び出しが全部 fetch に行っていた**。
 * Cloudflare が `cache-control: max-age=0, must-revalidate` を返すため、
 * Chrome は同一 URL の要求をキャッシュロックで**直列化**する。
 * `note_block/template_note.json` 1 本が 50 回 × 約 22ms = 1093ms を占めていた
 * (実測: 同一 URL×50 並列 = 1069-1584ms / 別 URL×50 並列 = 102-111ms / 重複排除 = 23-28ms)。
 */
const packJsonCache = new Map<string, Promise<unknown | null>>()

/** bundle.json (models + blockstates を 1 本にまとめたもの)。null = 未取得 / 取得失敗 */
let packBundle: { models?: Record<string, unknown>; blockstates?: Record<string, unknown> } | null = null
let packBundleTried = false

/**
 * パック JSON を 1 本にまとめた `bundle.json` を先読みする (#276)。
 *
 * ビルド時に `app/scripts/genLocalModels.js` が作っていたのに**誰も読んでいなかった**。
 * br 19.3KB / 1 リクエストで、個別 358 本 (3 波 470-650ms) を置き換えられる。
 * **取れなければ黙って諦める** — 呼び出し側は今までどおり個別取得にフォールバックする。
 */
export async function preloadPackBundle(): Promise<void> {
  if (packBundleTried) return
  packBundleTried = true
  try {
    const res = await fetch(`${PACK_BASE}/../../bundle.json`)
    if (!res.ok) return
    const data = await res.json() as Record<string, unknown>
    // Cloudflare Pages は**存在しないパスにも 200 + index.html** を返すので、
    // 中身が想定の形かどうかで判定する (res.ok だけでは足りない)
    if (data && typeof data === 'object' && data.models && data.blockstates) {
      packBundle = data as { models: Record<string, unknown>; blockstates: Record<string, unknown> }
    }
  } catch { /* 個別取得へフォールバック */ }
}

/** bundle にあれば返す。`models/block/foo.json` / `blockstates/foo.json` の形で引く */
function fromBundle(subpath: string): unknown | undefined {
  if (!packBundle) return undefined
  const m = /^models\/block\/(.+)\.json$/.exec(subpath)
  if (m) return packBundle.models?.[`block/${m[1]}`]
  const b = /^blockstates\/(.+)\.json$/.exec(subpath)
  if (b) return packBundle.blockstates?.[b[1]]
  return undefined
}

// 一括 JSON キャッシュ（ページ内で複数の構造体をロードする場合も再取得しない）
let blockStatesCache: Record<string, unknown> | null = null
let blockModelsCache: Record<string, unknown> | null = null

export async function getBlockStates(): Promise<Record<string, unknown>> {
  if (!blockStatesCache) {
    const res = await fetch(`${PRISMARINE_BASE}/blocks_states.json`)
    if (!res.ok) throw new Error(`Failed to fetch blocks_states.json: ${res.status}`)
    blockStatesCache = await res.json() as Record<string, unknown>
  }
  return blockStatesCache
}

export async function getBlockModels(): Promise<Record<string, unknown>> {
  if (!blockModelsCache) {
    const res = await fetch(`${PRISMARINE_BASE}/blocks_models.json`)
    if (!res.ok) throw new Error(`Failed to fetch blocks_models.json: ${res.status}`)
    blockModelsCache = await res.json() as Record<string, unknown>
  }
  return blockModelsCache
}

/**
 * リソースパックから JSON ファイルを取得する。
 * subpath: "blockstates/lever.json" / "models/block/lever/off.json" など
 * 存在しない場合は null を返す。
 */
export function fetchPackJson(subpath: string): Promise<unknown | null> {
  // bundle にあるものはネットワークへ行かない (#276)
  const bundled = fromBundle(subpath)
  if (bundled !== undefined) return Promise.resolve(bundled)

  const hit = packJsonCache.get(subpath)
  if (hit) return hit
  // **await の前に Promise を入れる**。ここが後だと同一 URL の並列呼び出しが素通りする
  const p = (async (): Promise<unknown | null> => {
    try {
      const res = await fetch(`${PACK_BASE}/${subpath}`)
      if (!res.ok) return null
      return await res.json() as unknown
    } catch {
      return null
    }
  })()
  packJsonCache.set(subpath, p)
  return p
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

/**
 * テクスチャパスから Blob を取得する。
 * 1. ローカルリソースパックを優先（カスタムテクスチャ）
 * 2. misode/mcmeta にフォールバック（バニラテクスチャ）
 * 3. block/ テクスチャは PrismarineJS にさらにフォールバック
 * 取得できなかった場合は null を返す。
 */
export async function fetchTexture(path: string): Promise<Blob | null> {
  // 1. ローカルリソースパック優先
  // Vite dev server は存在しないパスに index.html (text/html, 200) を返す SPA フォールバックがあるため
  // Content-Type が image/* のレスポンスのみ受け付ける
  try {
    const packRes = await fetch(`${PACK_BASE}/textures/${path}.png`)
    const ct = packRes.headers.get('content-type') ?? ''
    if (packRes.ok && ct.includes('image')) return normalizeTexture(await packRes.blob())
  } catch { /* ignore */ }

  // 2. mcmeta（バニラ）
  const mcmetaRes = await fetch(`${MCMETA_BASE}/textures/${path}.png`)
  if (mcmetaRes.ok) {
    return normalizeTexture(await mcmetaRes.blob())
  }

  // 3. entity/ テクスチャは mcmeta にしか存在しないためフォールバック不要
  if (path.startsWith('block/')) {
    const name = path.replace(/^block\//, '')
    const fallbackRes = await fetch(`${PRISMARINE_BASE}/blocks/${name}.png`)
    if (fallbackRes.ok) {
      return normalizeTexture(await fallbackRes.blob())
    }
  }

  return null
}
