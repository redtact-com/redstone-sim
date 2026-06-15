const MC_VERSION = '1.21.4'

// blockstates・models は PrismarineJS の一括 JSON（2 リクエストで全量取得）
const PRISMARINE_BASE = `https://raw.githubusercontent.com/PrismarineJS/minecraft-assets/master/data/${MC_VERSION}`

// テクスチャは misode/mcmeta（Java Edition モデルの参照パスと完全一致）
export const MCMETA_BASE = 'https://raw.githubusercontent.com/misode/mcmeta/assets/assets/minecraft'

// カスタムリソースパック（public/resourcepack/）
const PACK_BASE = '/resourcepack/assets/minecraft'

// パック JSON キャッシュ（null = 存在しない）
const packJsonCache = new Map<string, unknown>()

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
export async function fetchPackJson(subpath: string): Promise<unknown | null> {
  if (packJsonCache.has(subpath)) return packJsonCache.get(subpath) ?? null
  try {
    const res = await fetch(`${PACK_BASE}/${subpath}`)
    if (!res.ok) {
      packJsonCache.set(subpath, null)
      return null
    }
    const data = await res.json() as unknown
    packJsonCache.set(subpath, data)
    return data
  } catch {
    packJsonCache.set(subpath, null)
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
