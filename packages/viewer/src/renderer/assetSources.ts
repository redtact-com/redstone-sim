/**
 * バニラのアセット (blockstates / models の JSON とテクスチャ) の取得元とミラー (#395)。
 *
 * docs/ip-policy.md §2 によりアセットは同梱しないので、実行時に GitHub のリポから取る。
 * 取得先が raw.githubusercontent.com の 1 つしか無く、ここが落ちると盤面が出なかった
 * (遮断すると約 1 秒で「Error: Failed to fetch」、応答が無いと「Loading textures...」のまま)。
 *
 * 取得元は「リポ + 版 + パス」で持ち、URL はミラーごとに組み立てる。
 * どのミラーも**同じリポの同じ版**を配るので、どこから取っても中身は同じ。
 */

export const MC_VERSION = '1.21.4'

export interface AssetRepo {
  /** `owner/name` */
  readonly repo: string
  /** コミットかタグ。**ブランチは指さない** (中身が黙って変わるため) */
  readonly ref: string
}

/**
 * PrismarineJS/minecraft-assets。blocks_states.json / blocks_models.json と、block テクスチャの予備。
 *
 * **コミットで固定する** (#395)。以前は master を指していた。
 * a95e329 は data/1.21.4 を最後に変えたコミット (「1.21.4 (#33)」2025-02-09) で、
 * 固定した時点の master と JSON 2 本が同じバイト列 (sha256 f2e3cdf9… / d2ed5140…)。
 * render-coverage が使う test/blockstate-variants.1.21.4.json も同じ元から作っている。
 * **MC_VERSION を上げるときは、この版と test のデータも一緒に上げる**。
 */
export const PRISMARINE: AssetRepo = {
  repo: 'PrismarineJS/minecraft-assets',
  ref: 'a95e329c161b7fdd19de9f78d0a91c45da57d921',
}

/**
 * misode/mcmeta。テクスチャ (Java 版のモデルが参照するパスと完全一致)。
 * **タグで固定する** (#276)。タグはコミットごとに自動で付くので動かない前提にしている。
 * 上げるときはテクスチャをピクセル比較してから上げること。
 */
export const MCMETA: AssetRepo = {
  repo: 'misode/mcmeta',
  ref: `${MC_VERSION}-assets`,
}

export interface Mirror {
  readonly name: string
  url(src: AssetRepo, path: string): string
}

/**
 * 試す順。**先頭が普段の取得先** (#395 の案 A: raw を主に、jsDelivr を予備に)。
 * 入れ替えるときはこの配列の順を変えるだけでよい。
 *
 * jsDelivr はコミットやタグを指す URL を 1 年キャッシュして永続保存し、GitHub が落ちても配る
 * (GitHub から取るのは初回だけ)。制限は 1 ファイル 20MB・パッケージ 150MB。
 * どちらのリポも LICENSE が無い (中身は Mojang のアセット)。こちらは同梱も中継もせず、
 * 利用者のブラウザが同じリポを別の配信網から取るだけなので ip-policy §2 の範囲に入る。
 * **CSP を付けるときは connect-src に cdn.jsdelivr.net を足すこと**。
 *
 * 採らなかったもの: raw.githack.com (画像を raw へ 301 で転送するので一緒に落ちる)・
 * statically (http:// へ転送するので https のページから使えない)。
 */
export const MIRRORS: readonly Mirror[] = [
  {
    name: 'raw.githubusercontent.com',
    url: (s, p) => `https://raw.githubusercontent.com/${s.repo}/${s.ref}/${p}`,
  },
  {
    name: 'cdn.jsdelivr.net',
    url: (s, p) => `https://cdn.jsdelivr.net/gh/${s.repo}@${s.ref}/${p}`,
  },
]

/**
 * 応答ヘッダを待つ上限。**本文の読み込みには掛けない**。
 * 実測では raw の応答は普段 0.06〜0.2 秒、jsDelivr は手元に無い初回で 3〜4 秒。
 */
export const RESPONSE_TIMEOUT_MS = 8000

export type FetchOutcome<T> =
  | { kind: 'ok'; value: T }
  /** どのミラーも 404 */
  | { kind: 'missing' }
  /** 通信の失敗が 1 つでもあり、どこからも取れなかった */
  | { kind: 'unreachable' }

/** うまくいったミラー。次の取得はここから試す (raw が落ちている間、毎回 8 秒待たずに済む) */
let preferred = 0
let warnedFoundElsewhere = false

/**
 * ミラーを順に試して本文を読む。
 *
 * 次のミラーへ進むのは、通信エラー・打ち切り・404 以外の失敗応答 (429・5xx など)・
 * 本文の読み込みの失敗 (途中で切れた・JSON が壊れている) と、**404**。
 * 404 でも次を試すのは、障害中の raw が 404 を返す場合に備えるため
 * (既定の盤面には本当に無いファイルが 0 本なので、要求はほぼ増えない)。
 *
 * どのミラーでもだめなら、通信の失敗が 1 つでもあれば `unreachable`、全部 404 なら `missing`。
 * ここでは結果を覚えない (覚えるかどうかは呼び出し側が決める)。
 */
export async function fetchFromMirrors<T>(
  src: AssetRepo,
  path: string,
  read: (res: Response) => Promise<T>,
): Promise<FetchOutcome<T>> {
  const order = [preferred, ...MIRRORS.map((_, i) => i).filter(i => i !== preferred)]
  let failed = false
  let missingAt: string | null = null

  for (const i of order) {
    const mirror = MIRRORS[i]
    let res: Response
    try {
      res = await fetchWithTimeout(mirror.url(src, path), RESPONSE_TIMEOUT_MS)
    } catch {
      failed = true
      continue
    }
    if (res.status === 404) {
      missingAt ??= mirror.name
      continue
    }
    if (!res.ok) {
      failed = true
      continue
    }
    let value: T
    try {
      value = await read(res)
    } catch {
      failed = true
      continue
    }

    if (preferred !== i) {
      console.warn(`[assets] ${MIRRORS[preferred].name} から取れなかったので、以後は ${mirror.name} から先に取る`)
      preferred = i
    }
    if (missingAt !== null && !warnedFoundElsewhere) {
      // 固定した版なのに片方にだけ無いのは、リポが消えた合図。
      // 権利者の求めで消えたのなら、取得先を見直す
      warnedFoundElsewhere = true
      console.warn(`[assets] ${missingAt} に無い ${src.repo}/${path} を ${mirror.name} から取った。リポが消えていないか確かめること`)
    }
    return { kind: 'ok', value }
  }

  return failed ? { kind: 'unreachable' } : { kind: 'missing' }
}

/** 応答ヘッダが `ms` 来なければ打ち切る。ヘッダが来たらタイマーを外す (本文は待つ) */
async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  try {
    return await fetch(url, { signal: ctrl.signal })
  } finally {
    clearTimeout(timer)
  }
}
