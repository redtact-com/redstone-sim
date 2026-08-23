import {
  BlockDefinition,
  BlockModel,
  TextureAtlas,
  type Resources,
  type BlockModelProvider,
} from 'deepslate/render'
import { Identifier } from 'deepslate/core'
import { getBlockFlags } from './blockFlags'
import { getBlockStates, getBlockModels, fetchTexture, fetchPackJson, preloadPackBundle } from './mcAssets'
import { collectTexturePaths, addSpecialRendererTextures } from './texturePaths'
import { buildAtlas32 } from './atlasUtils'

const _loggedMissing = new Set<string>()

// ── パックのblockstateからモデルパスを収集するヘルパー ──────────

function collectModelRefsFromState(obj: unknown): string[] {
  const refs: string[] = []
  function walk(o: unknown) {
    if (!o || typeof o !== 'object') return
    if (Array.isArray(o)) { o.forEach(walk); return }
    const rec = o as Record<string, unknown>
    if (typeof rec['model'] === 'string') {
      refs.push((rec['model'] as string).replace('minecraft:', ''))
    }
    Object.values(rec).forEach(walk)
  }
  walk(obj)
  return refs
}

// ── パックのblockstate/modelをPrismarineJS束にオーバーレイ ────────

async function overlayPackData(
  blockNames: string[],
  statesJson: Record<string, unknown>,
  modelsJson: Record<string, unknown>,
): Promise<void> {
  const names = [...new Set(blockNames.map(n => n.replace('minecraft:', '')))]

  // blockstateをパックから取得し、モデル参照を収集
  const allModelRefs = new Set<string>()
  await Promise.all(names.map(async (name) => {
    const packState = await fetchPackJson(`blockstates/${name}.json`)
    if (!packState) return
    statesJson[name] = packState
    collectModelRefsFromState(packState).forEach(ref => allModelRefs.add(ref))
    console.log(`[buildResources] pack blockstate overlay: ${name}`)
  }))

  // パックモデルを親チェーンを辿りながら順次ロード
  // （親が見つからない場合はPrismarineJS側で解決される）
  const loaded = new Set<string>()
  const queue = [...allModelRefs]

  while (queue.length > 0) {
    // **同じ ref を 1 度しか取らない** (#276)。親 ref は下の push で重複して積まれるので、
    // ここで落とさないと同一 URL への並列 fetch が大量に走る
    // (実測: 358 本のうちユニークは 264 本、94 本が同じ波の中の重複だった)
    const batch = [...new Set(queue.splice(0, queue.length))].filter(ref => !loaded.has(ref))
    if (batch.length === 0) break

    batch.forEach(ref => loaded.add(ref))

    await Promise.all(batch.map(async (modelRef) => {
      // modelRef: "block/lever/off" → file: "models/block/lever/off.json"
      const filePath = modelRef.replace(/^block\//, '')
      const packModel = await fetchPackJson(`models/block/${filePath}.json`)
      if (!packModel) return

      // フルパスキーで登録（getBlockModel の id.path と一致させる）
      modelsJson[modelRef] = packModel

      // 親チェーンを追跡
      const parent = (packModel as Record<string, unknown>)['parent']
      if (typeof parent === 'string') {
        const parentRef = parent.replace('minecraft:', '')
        if (!loaded.has(parentRef)) queue.push(parentRef)
      }
    }))
  }

  console.log(`[buildResources] pack models loaded: ${loaded.size}`)
}

export async function buildResources(blockNames: string[]): Promise<Resources> {
  console.log('[buildResources] Fetching block states & models...')

  const [statesJsonBase, modelsJsonBase] = await Promise.all([
    getBlockStates(),
    getBlockModels(),
    // パック JSON を 1 本にまとめた bundle.json を**並行して**先読みする (#276)。
    // 取れなければ個別取得にフォールバックするので、失敗しても壊れない
    preloadPackBundle(),
  ])

  // キャッシュを汚染しないようシャローコピーを作成
  const statesJson: Record<string, unknown> = { ...statesJsonBase }
  const modelsJson: Record<string, unknown> = { ...modelsJsonBase }

  // パックデータをオーバーレイ（パックにあるブロックのみ上書き）
  await overlayPackData(blockNames, statesJson, modelsJson)

  // variant 必須プロパティの既定値 (#343)。sim が捨てたプロパティを描画時に補う
  const defaultProps = new Map<string, Record<string, string>>()

  // 構造体のブロックの BlockDefinition を構築
  const blockDefs = new Map<string, BlockDefinition>()
  for (const fullName of blockNames) {
    const name = fullName.replace('minecraft:', '')
    if (statesJson[name]) {
      try {
        blockDefs.set(name, BlockDefinition.fromJson(statesJson[name]))
        const defs = defaultPropsOf(statesJson[name])
        if (Object.keys(defs).length > 0) defaultProps.set(name, defs)
      } catch { /* skip */ }
    }
  }

  // cube_mirrored は面の UV が [16,0,0,16]（U 反転）で deepslate が誤表示する。
  // flatten 前に raw JSON を正常 [0,0,16,16] に書き換えてから BlockModel を構築する。
  const patchedModelsJson = { ...modelsJson } as Record<string, unknown>
  const cubeMirroredRaw = patchedModelsJson['cube_mirrored'] as
    | { elements?: Array<{ faces?: Record<string, { uv?: number[] }> }> }
    | undefined
  if (cubeMirroredRaw?.elements) {
    const patched = JSON.parse(JSON.stringify(cubeMirroredRaw)) as typeof cubeMirroredRaw
    patched.elements?.forEach(elem => {
      Object.values(elem.faces ?? {}).forEach(face => {
        if (face.uv && face.uv[0] > face.uv[2]) {
          ;[face.uv[0], face.uv[2]] = [face.uv[2], face.uv[0]]
        }
      })
    })
    patchedModelsJson['cube_mirrored'] = patched
  }

  // 全 BlockModel を構築（flatten で親チェーンを解決するため全量必要）
  const blockModels = new Map<string, BlockModel>()
  for (const [key, data] of Object.entries(patchedModelsJson)) {
    try {
      blockModels.set(key, BlockModel.fromJson(data))
    } catch { /* skip */ }
  }

  // flatten: 親モデルからエレメント・テクスチャを継承させる
  // パックモデルは "block/lever/off" キー、PrismarineJS モデルは "lever" キーで検索
  const modelProvider: BlockModelProvider = {
    getBlockModel(id: Identifier) {
      const key = id.path.replace(/^block\//, '')
      return blockModels.get(key) ?? blockModels.get(id.path) ?? null
    },
  }
  for (const model of blockModels.values()) {
    try { model.flatten(modelProvider) } catch { /* skip */ }
  }

  // 構造体のブロックが実際に使うテクスチャのみ収集
  // statesJson・modelsJson にパックデータが含まれているため、
  // パックブロックのカスタムテクスチャパスも自動的に収集される
  const uniqueBlockNames = [...new Set(blockNames.map(n => n.replace('minecraft:', '')))]
  console.log('[buildResources] Unique blocks in structure:', uniqueBlockNames.sort())

  const texturePaths = collectTexturePaths(
    uniqueBlockNames.map(n => `minecraft:${n}`),
    statesJson,
    modelsJson,
  )
  addSpecialRendererTextures(texturePaths, uniqueBlockNames)

  console.log(`[buildResources] Fetching ${texturePaths.size} textures...`)

  // テクスチャを並列フェッチ（パック → mcmeta → PrismarineJS の順で試行）
  const textureBlobs: Record<string, Blob> = {}
  await Promise.all(
    [...texturePaths].map(async (path) => {
      const blob = await fetchTexture(path)
      if (blob) textureBlobs[`minecraft:${path}`] = blob
    })
  )

  // Blob の正規化と事前検証:
  // GitHub CDN は PNG を application/octet-stream 等で返すことがあり、
  // createImageBitmap が MIME タイプを見て失敗するケースがある。
  // Blob を image/png に強制変換してから検証することで回避する。
  const validBlobs: Record<string, Blob> = {}
  await Promise.all(
    Object.entries(textureBlobs).map(async ([key, blob]) => {
      try {
        // MIME タイプを image/png に正規化
        const typed = blob.type === 'image/png'
          ? blob
          : new Blob([blob], { type: 'image/png' })
        await createImageBitmap(typed)
        validBlobs[key] = typed
      } catch {
        console.warn(`[buildResources] skip invalid blob: ${key}`)
      }
    })
  )

  // deepslate の upperPowerOfTwo バグ対策 (詳細は atlasUtils.ts を参照)
  // padTextureBlobs は呼ばない (#276)。テクスチャを 286 → 1023 に水増しするが、
  // buildAtlas32 は自前で幅を計算するので**アトラス幅は両方 32 で不変**だった
  // (実測: 1023 版 283ms / 286 版 88ms。完全な無駄)

  const actualN = Object.keys(validBlobs).length
  console.log(
    `[buildResources] Ready: ${blockDefs.size} blockstates, ` +
    `${blockModels.size} models, ${actualN}/${texturePaths.size} textures`
  )

  // 32×32 スロットのカスタムアトラスを構築
  // deepslate の fromBlobs は drawImage のソース rect を固定 16×16 にするため
  // 32×32 テクスチャの下半分が欠落する。buildAtlas32 は全テクスチャを 32×32 スロットに
  // 等倍描画し、UV 座標は deepslate 標準（スロットインデックス/幅）と同一なので互換性を保つ。
  const AtlasCtor = TextureAtlas as unknown as new (
    img: ImageData,
    idMap: Record<string, [number, number, number, number]>,
  ) => TextureAtlas
  const atlas = await buildAtlas32(validBlobs, AtlasCtor)

  return {
    getBlockDefinition(id: Identifier) {
      return blockDefs.get(id.path) ?? null
    },
    getBlockModel(id: Identifier) {
      const key = id.path.replace(/^block\//, '')
      return blockModels.get(key) ?? blockModels.get(id.path) ?? null
    },
    getTextureAtlas() {
      return atlas.getTextureAtlas()
    },
    getTextureUV(id: Identifier) {
      const uv = atlas.getTextureUV(id)
      if (!_loggedMissing.has(id.toString()) && uv[0] === 0 && uv[1] === 0) {
        _loggedMissing.add(id.toString())
        console.warn('[getTextureUV] fallback for:', id.toString())
      }
      return uv
    },
    getPixelSize() {
      return atlas.getPixelSize()
    },
    getBlockFlags(id: Identifier) {
      return getBlockFlags(id.path)
    },
    getBlockProperties: () => null,
    // **実装しないと variant 必須のブロックが消える** (#343)。下の defaultPropsOf 参照
    getDefaultBlockProperties: (id: Identifier) =>
      defaultProps.get(id.path.replace(/^block\//, '')) ?? null,
  }
}

/**
 * blockstate の variant キーから既定プロパティを組み立てる (#343)。
 *
 * sim は挙動に効かないプロパティを捨てるので、`oak_log` の `axis` や
 * `carved_pumpkin` の `facing` を持っていない。deepslate の variant 選択は
 * **全プロパティ完全一致**なので、そのままでは**どれにも一致せず何も描かれない**
 * (エラーにならないので気づけない。#234 で塀が消えたのと同じ症状)。
 *
 * `ChunkBuilder` は `getDefaultBlockProperties` で**足りないプロパティだけ**を補うので、
 * ここで「その名前が取りうる値」を返せば、名前ごとの手書き表を持たずに全ブロックが救われる。
 *
 * 値の選び方: バニラの既定に近いものを優先する (縦置きの原木・北向き・雪なし)。
 * 一覧に無ければ variant に最初に出てくる値を使う。
 */
const PREFERRED_VALUES = ['y', 'north', 'false', 'bottom', 'none', 'single', 'normal', '0']

export function defaultPropsOf(stateJson: unknown): Record<string, string> {
  const variants = (stateJson as { variants?: Record<string, unknown> } | null)?.variants
  if (!variants) return {}
  const seen = new Map<string, string[]>()
  for (const key of Object.keys(variants)) {
    if (key === '') return {}     // プロパティ不問の variant があるなら補う必要はない
    for (const kv of key.split(',')) {
      const [prop, value] = kv.split('=')
      if (!prop || value === undefined) continue
      const list = seen.get(prop) ?? []
      if (!list.includes(value)) list.push(value)
      seen.set(prop, list)
    }
  }
  const out: Record<string, string> = {}
  for (const [prop, values] of seen) {
    out[prop] = values.find(v => PREFERRED_VALUES.includes(v)) ?? values[0]
  }
  return out
}
