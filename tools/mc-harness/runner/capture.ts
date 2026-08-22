// ============================================================
// capture.ts — 実回路を実機に置いて「操作 → N tick 後」を採る (#240)
//
//   npx tsx tools/mc-harness/runner/capture.ts <定義.json> [--snapshot-only]
//
// 既存の generate.ts (手書き fixture 用) との違い:
//
//   1. **回路ファイル (.litematic/.nbt/.schem) をそのまま食う**。
//      sim の型に変換せず **生の blockstate** を置くので、装飾・塀・泡柱が落ちない
//   2. **settle 照合で落とさない**。実回路は「実機が正」なので、
//      安定状態を採用して authored にする (ズレはレポートに出す)
//   3. **差分だけ記録する**。6393 ブロック x 201 tick のフルダンプは 115.9MB になる (実測)
//   4. **プレイヤーを乗せられる**。carpet の fake player は泡柱で実際に上昇する
//      (実測: y -58.7 → -47.5)。毎 tick 座標を記録する
//
// 定義ファイルの形:
// ```jsonc
// {
//   "name": "elevator-floor5",
//   "source": "xxx.litematic",              // circuits/ からの相対 (絶対パスも可)
//   "ticks": 200,
//   "pad": 2,                                  // region を回路 bbox から広げる量
//   "players": [{ "name": "gt", "spawn": [3.5, 6, 1.5] }],
//   "inputs": [
//     { "tick": 2,  "pos": [5, 2, 8], "action": "container", "signal": 5 },
//     { "tick": 10, "pos": [2, 1, 7], "action": "use" },
//     { "tick": 20, "pos": [1, 9, 9], "action": "lectern", "page": 10 }
//   ],
//   "snapshots": [0, 60, 200]                  // 回路ファイルに書き出す tick
// }
// ```
// ============================================================

import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { rcon, scarpet, withHarnessLock, sleep, reloadDumpApp, MAX_COMMAND_LEN } from './rcon.js'
import type { Capture, CaptureItems } from './compare.js'
import {
  readScheduledTicks, readComparatorOutputs, readHopperCooldowns,
} from './scheduled-ticks.js'
import { readRawPlacedBlocks } from '../../../app/src/nbtIO.js'
import type { RawPlacedBlock } from '../../../app/src/nbtIO.js'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..', '..', '..')
const sharedDir = join(repoRoot, 'tools', 'mc-harness', 'scripts', 'shared')
const outDir = join(repoRoot, 'tools', 'mc-harness', 'captures')

/**
 * 回路ファイル (.litematic/.nbt/.schem) の置き場所 (#322)。
 *
 * 定義ファイルの `source` は**ファイル名だけ**を書く。
 * 手元の絶対パスを書くと、このリポジトリは公開なので**ユーザ名がそのまま読める**。
 * 回路ファイル自体は配布物ではないので、パスを持っていても他の人が撮り直せるわけでもない。
 *
 * 置き場所は `MC_CIRCUITS_DIR` で差し替えられる (既定 `tools/mc-harness/circuits/`)。
 * ディレクトリ自体は .gitignore 済み。
 */
function circuitsDir(): string {
  // **呼ぶたびに読む**。モジュール読み込み時に固定すると、
  // 環境変数を設定してからでないと差し替えが効かない (テストからも触れない)
  const env = process.env.MC_CIRCUITS_DIR
  return env ? resolve(env) : join(repoRoot, 'tools', 'mc-harness', 'circuits')
}

/** Windows のドライブレター付きも絶対パスとして扱う (WSL から `C:\\...` を渡されることがある) */
function isAbsolutePath(p: string): boolean {
  return p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p)
}

/**
 * 定義ファイルの `source` を実際のファイルへ解決する (#322)。
 *
 * 絶対パスはそのまま使う (手元だけの一時的なキャプチャで書きたくなるため)。
 * 相対なら circuits/ → カレントの順で探し、**どこを探したかをエラーに出す**。
 */
export function resolveCircuitPath(source: string): string {
  if (isAbsolutePath(source)) {
    if (existsSync(source)) return source
    throw new Error(`回路ファイルが無い: ${source}`)
  }
  const tried = [join(circuitsDir(), source), resolve(source)]
  for (const p of tried) if (existsSync(p)) return p
  throw new Error(
    `回路ファイルが無い: ${source}\n` +
    `  探した場所:\n${tried.map(p => `    ${p}`).join('\n')}\n` +
    `  回路ファイルは配布していない。手元のものを circuits/ に置くか、` +
    `MC_CIRCUITS_DIR で置き場所を指定すること`,
  )
}

/** 実機に乗せる fake player */
export interface CaptureDefPlayer {
  name: string
  /** 立たせる座標 (回路ローカル。小数可) */
  spawn: [number, number, number]
}

export interface CaptureDefInput {
  tick: number
  pos: [number, number, number]
  /**
   * 'use'       … fake player の右クリック (レバー/ボタン/ドア)
   * 'setblock'  … `/setblock` 相当。`block` に blockstate 文字列
   * 'container' … コンテナの中身を `signal` (0-15) 相当にする (#236 の入力)
   * 'tp'        … fake player を `to` へ飛ばす (シャフトへ入れる等)
   * 'kill'      … 近傍のエンティティを消す
   * 'lectern'   … 書見台のページを `page` にする (#240 の階数指定)
   */
  action: 'use' | 'setblock' | 'container' | 'tp' | 'kill' | 'lectern'
  block?: string
  signal?: number
  player?: string
  to?: [number, number, number]
  /** action='lectern': 開くページ (0 始まり) */
  page?: number
}

export interface CaptureDef {
  name: string
  source: string
  ticks: number
  pad?: number
  players?: CaptureDefPlayer[]
  inputs?: CaptureDefInput[]
  snapshots?: number[]
  /**
   * **回路の一部だけを置く** (#食い違いの自動最小化)。座標キー "x,y,z" の配列で、
   * 指定があるとその座標のブロックだけが実機に置かれ、region は
   * **keep の bbox + pad** に縮む (指定が無ければ従来どおり回路全体)。
   *
   * 座標は「回路ファイルを原点寄せした後」の系 (= キャプチャ JSON / fixture と同じ)。
   * ブロックの無い座標を書いても構わない (region を広げるだけ)。入力の当たり先を
   * region に含めたいときに使う。
   */
  keep?: string[]
}

// Capture の形は **compare.ts が正**。二重定義するとドリフトして
// 「書いた側と読む側で形が違う」事故になるので、型はそちらから貰う
export type { Capture } from './compare.js'

const MC_VERSION = '1.21.1'

/** 掃除のあと予約 tick を枯らすために空回しする tick 数 (#240) */
const DRAIN_TICKS = 60

/** ピストンが動き終わるのを待つ上限 tick (#244)。これを超えたら警告して進む */
const SETTLE_MOVING_MAX = 40

/** "x,y,z" → [x,y,z] */
const parseKey = (k: string): [number, number, number] =>
  k.split(',').map(Number) as [number, number, number]

/** RawPlacedBlock の props から blockstate 文字列を組む (キー昇順) */
function toStateString(name: string, props: Record<string, string>): string {
  const id = name.replace(/^minecraft:/, '')
  const keys = Object.keys(props).sort()
  return keys.length === 0 ? id : `${id}[${keys.map(k => `${k}=${props[k]}`).join(',')}]`
}

export interface CaptureRegion {
  from: [number, number, number]
  to: [number, number, number]
}

export interface SelectedBlocks<T> {
  /** 実機に置くブロック (keep 指定があればその座標だけ) */
  blocks: T[]
  /** 観測 + 掃除の範囲 */
  region: CaptureRegion
  /** keep に書いたのに回路にブロックが無かった座標 (誤字の検出用。region は広がる) */
  missing: string[]
}

/** 座標列の bbox。空なら null */
function bboxOf(positions: readonly [number, number, number][]): CaptureRegion | null {
  if (positions.length === 0) return null
  const min: [number, number, number] = [Infinity, Infinity, Infinity]
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  for (const p of positions) {
    for (let i = 0; i < 3; i++) {
      if (p[i] < min[i]) min[i] = p[i]
      if (p[i] > max[i]) max[i] = p[i]
    }
  }
  return { from: min, to: max }
}

/**
 * 置くブロックを選び、region を決める純関数 (実機に触らないのでテストできる)。
 *
 * - `keep` 無し … 全ブロック。region は回路全体の bbox + pad
 * - `keep` あり … その座標のブロックだけ。region は **keep 座標の bbox + pad**
 *
 * どちらも **下端 y だけは 0 より下げない**。回路は原点寄せ済みで y=0 が床、
 * ワールドは void superflat なので y<0 には何も無く、掃除範囲を広げても無駄なだけ。
 * (keep 無しの場合 min は必ず (0,0,0) になるので from = [-pad, 0, -pad] という
 *  従来の式と完全に一致する)
 */
export function selectPlacedBlocks<T extends { pos: [number, number, number] }>(
  blocks: readonly T[], pad: number, keep?: readonly string[],
): SelectedBlocks<T> {
  const missing: string[] = []
  let picked: T[]
  let anchors: [number, number, number][]

  if (keep === undefined) {
    picked = [...blocks]
    anchors = picked.map(b => b.pos)
  } else {
    // keep は外から来る (最小化ループが組み立てる) ので形式を検証してから使う。
    // 壊れたキーを黙って捨てると region がこっそり縮んで原因不明の食い違いになる
    const wanted = new Map<string, [number, number, number]>()
    for (const k of keep) wanted.set(k, parseKeyStrict(k))
    picked = blocks.filter(b => wanted.has(b.pos.join(',')))
    const placed = new Set(picked.map(b => b.pos.join(',')))
    for (const k of wanted.keys()) if (!placed.has(k)) missing.push(k)
    anchors = [...wanted.values()]
  }

  const bbox = bboxOf(anchors)
  if (bbox === null) throw new Error('置くブロックが 1 つも無い (keep が空か、全て回路の外)')
  return {
    blocks: picked,
    region: {
      from: [bbox.from[0] - pad, Math.max(0, bbox.from[1] - pad), bbox.from[2] - pad],
      to: [bbox.to[0] + pad, bbox.to[1] + pad, bbox.to[2] + pad],
    },
    missing,
  }
}

/** "x,y,z" → [x,y,z]。壊れたキーは例外 (黙って捨てない) */
function parseKeyStrict(key: string): [number, number, number] {
  const parts = key.split(',').map(s => Number(s.trim()))
  if (parts.length !== 3 || parts.some(n => !Number.isInteger(n))) {
    throw new Error(`keep の座標キーが不正: "${key}" ("x,y,z" 形式で書くこと)`)
  }
  return [parts[0], parts[1], parts[2]]
}

// ── 書見台の本 (#240) ────────────────────────────────────────────────────────
// ガラスエレベーターの**階数指定は書見台のページ番号**で、コンパレーターがそれを読む
// [確定: 26.2 LecternBlock.getAnalogOutputSignal → LecternBlockEntity.getRedstoneSignal]。
// ところが本は blockstate ではなく **block entity の中身**なので、scarpet の set() で
// 置き直しても復元されない。has_book=true なのに中身が無い書見台は
// **常に 14 を出す** (ページ数 0 → 進捗 1.0、本の実体は無しで +1 されない) ため、
// 何ページ目にしても出力が変わらず機械がまったく動かない。
// そこで設置のあとに `/data merge block` で入れ直す (set() では BE を作れない)。

/** 書見台 1 台に入れ直す本 */
export interface LecternBook {
  pos: [number, number, number]
  /** 開いているページ (0 始まり) */
  page: number
  /** 本のページ数 (1 以上) */
  pages: number
}

/**
 * 元ファイルから読んだ書見台。`lectern` は readRawPlacedBlocks が付ける
 * 「本の中身」で、**まだ無い版でも落ちないよう任意プロパティ**として扱う。
 */
export interface LecternSource {
  pos: [number, number, number]
  name: string
  props: Record<string, string>
  lectern?: { page: number; pages: number }
}

/** ダミー本の 1 ページ分。中身は読まれないので何でもよい (空文字を避けただけ) */
const DUMMY_PAGE = '"x"'

/**
 * 入れ直す本の SNBT。**本文は再現しない**。
 *
 * コンパレーターが見るのは**ページ数と現在ページだけ**で本文には触れない
 * [確定: 26.2 LecternBlockEntity.getRedstoneSignal / getPageCount]。
 * よって同じページ数のダミーで出力は元の本と完全に一致する。
 * 本文まで運ぶと 1 ページで数百バイトになり、rcon の 1014 バイト制限
 * (rcon.ts の MAX_COMMAND_LEN) にすぐ当たるので割に合わない。
 *
 * 種類は writable book (本と羽根ペン) に統一する。written book と writable book は
 * どちらも「本を持っている」扱いで、ページ数の数え方も同じ
 * [確定: 26.2 LecternBlockEntity.hasBook / getPageCount が両方の中身を見る] ため、
 * 元がどちらでも出力は変わらない。
 *
 * **空白を入れない**こと。rcon() は引数を空白で連結するので、SNBT の中に空白があると
 * コマンドの区切りとして解釈されて壊れる。
 */
function dummyBookSnbt(page: number, pages: number): string {
  const body = new Array(pages).fill(DUMMY_PAGE).join(',')
  return '{Book:{id:"minecraft:writable_book",count:1,'
    + `components:{"minecraft:writable_book_content":{pages:[${body}]}}},Page:${page}}`
}

/**
 * 書見台へ本を入れ直す rcon コマンド (引数配列)。
 *
 * ページは 0..pages-1 に丸める。実機も本を読み込む時点で範囲外のページを丸めるので、
 * 丸めずに投げると「定義に書いた Page」と「実機の Page」がズレて出力が合わなくなる。
 *
 * **長さは投げる前に見積もる**。rcon-cli は 1014 バイト超をエラーも出さず無言でハングさせる
 * (rcon.ts) ので、ここで先に落として「どの書見台が何ページで溢れたか」が分かる形にする。
 */
export function buildLecternBookArgs(book: LecternBook): string[] {
  const key = book.pos.join(',')
  if (!Number.isInteger(book.pages) || book.pages < 1) {
    throw new Error(`書見台のページ数が不正: ${book.pages} (${key})。1 以上の整数で書くこと`)
  }
  const page = Math.min(Math.max(0, Math.floor(book.page)), book.pages - 1)
  const args = [
    'data', 'merge', 'block',
    String(book.pos[0]), String(book.pos[1]), String(book.pos[2]),
    dummyBookSnbt(page, book.pages),
  ]
  const bytes = Buffer.byteLength(args.join(' '), 'utf8')
  if (bytes > MAX_COMMAND_LEN) {
    throw new Error(
      `書見台に本を入れるコマンドが長すぎる (${bytes} バイト > ${MAX_COMMAND_LEN}): `
      + `${key} は ${book.pages} ページ。rcon-cli は上限超えを無言でハングさせるので投げない`,
    )
  }
  return args
}

/**
 * 書見台のページだけを変える rcon コマンド (入力アクション 'lectern')。
 * 本は入れ直さない (設置時に入れたものがそのまま残っている)。
 */
export function buildLecternPageArgs(pos: [number, number, number], page: number): string[] {
  if (!Number.isInteger(page) || page < 0) {
    throw new Error(`lectern の page が不正: ${page} (${pos.join(',')})。0 以上の整数で書くこと`)
  }
  return [
    'data', 'modify', 'block',
    String(pos[0]), String(pos[1]), String(pos[2]),
    'Page', 'set', 'value', String(page),
  ]
}

/**
 * 置くブロックから「本を入れ直す書見台」を拾う純関数。
 *
 * `noBook` は **blockstate が has_book=true なのに本の中身が読めなかった**座標。
 * 黙って進むと出力が 14 に張り付いたまま「なぜか動かないキャプチャ」になるので、
 * 呼び出し側で必ず警告を出すこと。
 */
export function collectLecternBooks(blocks: readonly LecternSource[]): {
  books: LecternBook[]
  noBook: string[]
} {
  const books: LecternBook[] = []
  const noBook: string[] = []
  for (const b of blocks) {
    if (b.name.replace(/^minecraft:/, '') !== 'lectern') continue
    // 本の無い書見台 (has_book=false) は復元するものが無い。blockstate を正とする
    if (b.props.has_book !== 'true') continue
    const l = b.lectern
    if (l === undefined || !Number.isInteger(l.pages) || l.pages < 1) {
      noBook.push(b.pos.join(','))
      continue
    }
    books.push({ pos: b.pos, page: l.page, pages: l.pages })
  }
  return { books, noBook }
}


/**
 * 回路ファイルを読み、原点寄せして「置くブロック」と region を決める。
 *
 * `fullRegion` は keep で絞る前の回路全体の範囲。keep で縮めたときの
 * **掃除範囲**に使う (縮めた region だけを掃除すると、前回のキャプチャで置いた
 * ブロックが region のすぐ外に残り、実機だけが影響を受ける — README の「残骸」)。
 */
export async function loadCircuit(def: CaptureDef) {
  const path = resolveCircuitPath(def.source)
  const raw = await readRawPlacedBlocks(new Uint8Array(readFileSync(path)))
  if (raw.length === 0) throw new Error(`ブロックが 1 つも読めなかった: ${path}`)

  // 原点寄せ (回路ファイルの座標は 0 始まりとは限らない)
  let minX = Infinity, minY = Infinity, minZ = Infinity
  for (const b of raw) {
    if (b.pos[0] < minX) minX = b.pos[0]
    if (b.pos[1] < minY) minY = b.pos[1]
    if (b.pos[2] < minZ) minZ = b.pos[2]
  }
  const blocks = raw.map(b => {
    const { name, props } = { name: b.name, props: b.props }
    // 書見台の本 (#240) は readRawPlacedBlocks が**任意プロパティ**で付ける
    // (本を持たない書見台や、この項目を持たない版では単に付かない)。
    // 付いていない前提で読むので、無くてもここから先は落ちない
    const lectern = (b as RawPlacedBlock & { lectern?: { page: number; pages: number } }).lectern
    return {
      pos: [b.pos[0] - minX, b.pos[1] - minY, b.pos[2] - minZ] as [number, number, number],
      name: name.replace(/^minecraft:/, ''),
      props,
      items: b.items,
      lectern,
    }
  })
  const pad = def.pad ?? 1
  const picked = selectPlacedBlocks(blocks, pad, def.keep)
  return {
    blocks: picked.blocks,
    region: picked.region,
    // keep で縮めても掃除だけは回路全体に掛ける (前回の残骸を region の外に残さない)
    fullRegion: selectPlacedBlocks(blocks, pad).region,
    missing: picked.missing,
  }
}

/**
 * 記録側の tick が target に届くまで待つ。
 *
 * `/tick step N` は**即座に返る** (サーバは後から N tick 進める) ので、
 * sleep で待つと先走って記録が途中で終わる (実機で 120 tick 指定して 46 tick しか
 * 採れなかった)。1 tick ごとに領域を全走査するぶん所要時間は回路の大きさで変わるため、
 * **完了はポーリングで確かめる**。
 */
async function waitForDrain(n: number, timeoutMs = 5 * 60 * 1000): Promise<void> {
  // `/tick step N` は即座に返るので、**進み終わるまで待つ**。
  // sleep で待つと残りの tick が「ブロックを置いている最中」に進んでしまい、
  // 同じ条件で撮っても結果がばらつく (実測で 29 座標のズレが残っていた原因)
  const base = Number(scarpet('fx_tickcount()').match(/=\s*(\d+)/)?.[1] ?? 0)
  rcon('tick', 'step', String(n))
  const started = Date.now()
  for (;;) {
    const cur = Number(scarpet('fx_tickcount()').match(/=\s*(\d+)/)?.[1] ?? 0)
    if (cur - base >= n) return
    if (Date.now() - started > timeoutMs) throw new Error(`空回しが進まない (${cur - base}/${n})`)
    await sleep(200)
  }
}

async function waitForTick(target: number, timeoutMs = 15 * 60 * 1000): Promise<void> {
  const started = Date.now()
  let last = -1
  for (;;) {
    const cur = Number(scarpet('fx_cap_tick()').match(/=\s*(\d+)/)?.[1] ?? -1)
    if (cur >= target) return
    if (cur !== last) { last = cur; if (process.env.GT_DEBUG) console.log(`[capture] tick ${cur}/${target}`) }
    if (Date.now() - started > timeoutMs) {
      throw new Error(`tick が進まない (${cur}/${target})。サーバが固まっていないか確認すること`)
    }
    await sleep(400)
  }
}

/** 入力を実機へ当てる。当てた「直後」に fx_cap_reframe を呼ぶのは呼び出し側 */
/** `updateNeighborsAt` が近傍を叩く順序 [確定: 26.2 NeighborUpdater] */
const NEIGHBOR_ORDER: [number, number, number][] = [
  [-1, 0, 0], [1, 0, 0], [0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1],
]

const FACING_DELTA: Record<string, [number, number, number]> = {
  north: [0, 0, -1], south: [0, 0, 1], west: [-1, 0, 0], east: [1, 0, 0],
}

/**
 * 貼り付き電源 (レバー / ボタン) が貼り付いている**支えブロック**の座標。
 *
 * 支え = `pos` から「貼り付き方向の逆」へ 1 つ
 * [確定: 26.2 FaceAttachedHorizontalDirectionalBlock.getConnectedDirection]。
 * face=floor なら下、face=ceiling なら上、face=wall なら `facing` の逆。
 *
 * 対象外のブロックなら null。
 */
export function attachedSupportPos(
  pos: number[], block: string,
): [number, number, number] | null {
  const id = block.replace(/^minecraft:/, '').replace(/\[.*/, '')
  if (id !== 'lever' && !id.endsWith('_button')) return null
  const props = Object.fromEntries(
    (block.match(/\[(.*)\]/)?.[1] ?? '').split(',').filter(Boolean)
      .map(kv => kv.split('=').map(t => t.trim()) as [string, string]))
  const face = props.face ?? 'wall'
  const d: [number, number, number] | undefined = face === 'floor'
    ? [0, -1, 0]
    : face === 'ceiling'
      ? [0, 1, 0]
      : FACING_DELTA[props.facing ?? 'north']?.map(v => -v) as [number, number, number] | undefined
  if (!d) return null
  return [pos[0] + d[0], pos[1] + d[1], pos[2] + d[2]]
}

/**
 * `/setblock` で貼り付き電源を置いたときに足りない近傍更新を補う。
 *
 * バニラのレバー/ボタンは倒したとき **2 か所**へ更新を配る
 * [確定: 26.2 LeverBlock.updateNeighbours / ButtonBlock.updateNeighbours]:
 * レバー自身の位置と、**貼り付いている支えブロックの位置**。
 * `/setblock` は前者しか配らないため、支えブロックの隣にある機構
 * (ランプ・音符ブロック・リピーター・ピストン) が**強充電に気づかないまま**になり、
 * 「レバーを ON にしたのに回路が起動しない」実機キャプチャができてしまう (#290)。
 *
 * 実測 (1.21.1): 羊毛の上に床レバー ON → 羊毛の下のランプは**消灯のまま**。
 * ランプ位置に `update()` を撃つと点灯する = 強充電は効いていて更新だけ届いていない。
 *
 * 書見台のページ送り (`lectern`) と同じ「更新が配られない」罠 (#196)。
 */
export function emitAttachedSupportUpdate(pos: number[], block: string): void {
  const support = attachedSupportPos(pos, block)
  if (!support) return
  for (const [dx, dy, dz] of NEIGHBOR_ORDER) {
    scarpet(`update([${support[0] + dx},${support[1] + dy},${support[2] + dz}])`)
  }
}

async function applyInput(input: CaptureDefInput, players: CaptureDefPlayer[]): Promise<void> {
  const [x, y, z] = input.pos
  switch (input.action) {
    case 'use': {
      const name = input.player ?? players[0]?.name
      if (!name) throw new Error(`use には fake player が要る (players を定義する): ${input.pos}`)
      // ブロック中心へ照準し直してから 1 回だけ使う
      rcon('player', name, 'look', 'at', String(x + 0.5), String(y + 0.5), String(z + 0.5))
      await sleep(150)
      rcon('player', name, 'use', 'once')
      await sleep(150)
      break
    }
    case 'setblock':
      if (!input.block) throw new Error(`setblock に block が無い: ${input.pos}`)
      rcon('setblock', String(x), String(y), String(z), input.block)
      emitAttachedSupportUpdate(input.pos, input.block)
      break
    case 'container': {
      // コンテナの中身をコンパレーター強度 signal 相当にする (#236)。
      // 樽 27 スロット x 64 で f = 個数/容量、signal = floor(f*14)+1
      //
      // **2 段構え**にする。scarpet の inventory_set は速いが
      // vanilla の `Container.setItem → setChanged` を通らないため
      // **コンパレーターが更新されない** (空にしても前の値が残る — 実測)。
      // 中身は scarpet で作り、**最後に slot 0 だけ `/item replace block` で置き直す**。
      // こうすると更新の出方が実機のプレイヤー操作と同じになる
      const s = Math.max(0, Math.min(15, Math.floor(input.signal ?? 0)))
      const ret = scarpet(`fx_set_signal([${x},${y},${z}], ${s})`)
      const first = Number(ret.match(/\[\s*\d+\s*,\s*(\d+)\s*\]/)?.[1] ?? 0)
      if (first > 0) {
        rcon('item', 'replace', 'block', String(x), String(y), String(z),
          'container.0', 'with', 'minecraft:cobblestone', String(first))
      } else {
        rcon('item', 'replace', 'block', String(x), String(y), String(z),
          'container.0', 'with', 'minecraft:air')
      }
      break
    }
    case 'tp': {
      const name = input.player ?? players[0]?.name
      if (!name) throw new Error('tp には fake player が要る')
      const to = input.to ?? [x + 0.5, y, z + 0.5]
      rcon('tp', name, String(to[0]), String(to[1]), String(to[2]))
      await sleep(150)
      break
    }
    case 'kill':
      rcon('kill', `@e[type=!player,x=${x},y=${y},z=${z},distance=..3]`)
      break
    case 'lectern': {
      // 書見台のページを変える (#240)。本はそのまま、Page だけ動かす
      rcon(...buildLecternPageArgs(input.pos, Math.floor(input.page ?? 0)))
      // `/data modify` は block entity を書き換えるだけで**更新を配らない**。
      // 実機のページめくりは書見台側が出力先へ更新を出す
      // [確定: 26.2 LecternBlock がページ変更時に comparator 向けの更新を出す] ので、
      // 同じことをしないと下流のコンパレーターが古い値を読み続ける (中身投入と同じ罠 #196)
      scarpet(`update([${x},${y},${z}])`)
      break
    }
  }
}

/** capture() の任意設定 */
export interface CaptureOptions {
  /**
   * 進捗ログを出さない。最小化ループは 1 回のキャプチャにつき 10 行以上出されると
   * 「残り何ブロックか」が流れて読めなくなるので、そこからは静かに呼ぶ
   */
  quiet?: boolean
}

export async function capture(defPath: string, opts: CaptureOptions = {}): Promise<Capture> {
  const log = opts.quiet === true ? () => {} : (...a: unknown[]) => console.log(...a)
  const def = JSON.parse(readFileSync(defPath, 'utf-8')) as CaptureDef
  const { blocks, region, fullRegion, missing } = await loadCircuit(def)
  log(`[capture] ${def.name}: ${blocks.length} ブロック / region ${region.from} - ${region.to}`)
  if (missing.length > 0) {
    log(`[capture] keep のうち ${missing.length} 座標には回路のブロックが無い (region を広げるだけ): `
      + missing.slice(0, 5).join(' '))
  }

  // 1. 共有 JSON へ (rcon のコマンド長 1014 文字を超えられないのでファイル経由)
  //
  // **これは実機へ入れる用**。キャプチャに載せる中身は settle 後に実機から読み直す
  // (#252)。settle 中に機械が動いてコンテナの中身が変わることがあり、
  // 元ファイルの中身を出発点にすると sim だけ違う持ち物で始まってしまう
  // (ガラスエレベーターのディスペンサーは空バケツ ⇄ 水バケツで入れ替わる)
  const placeItems = blocks
    .filter(b => b.items && b.items.length > 0)
    .map(b => ({ pos: b.pos, slots: b.items!.map(i => ({ slot: i.slot, id: i.id.replace(/^minecraft:/, ''), count: i.count })) }))
  mkdirSync(sharedDir, { recursive: true })
  writeFileSync(join(sharedDir, 'fixture.json'), JSON.stringify({
    region,
    // 掃除だけは回路全体に掛ける (keep で region を縮めたとき、前回置いた
    // ブロックが region の外に残って実機側だけを動かすのを防ぐ)
    clear: fullRegion,
    blocks: blocks.map(b => ({ pos: b.pos, name: b.name, props: b.props })),
    items: placeItems,
  }))
  log(`[capture] コンテナ ${placeItems.length} 個`
    + ` / スロット ${placeItems.reduce((n, i) => n + i.slots.length, 0)}`)

  // 書見台の本 (#240)。**本が無いと出力が 14 に張り付いて階数指定が効かない**
  const { books: lecternBooks, noBook } = collectLecternBooks(blocks)
  if (noBook.length > 0) {
    log(`[capture] 書見台 ${noBook.length} 台の本を読めなかった (出力が 14 に張り付いて機械が動かない): `
      + noBook.slice(0, 5).join(' '))
  }

  // 2. 設置 → 中身 → 安定化
  reloadDumpApp()
  rcon('tick', 'freeze')
  // **掃除 → 空回し → 設置** の順にする (#240)。
  // 続けてやると前回の実行が残した**予約 tick がキューに残ったまま**になり、
  // 同じ回路を置き直しても発火して結果が変わる (予約は座標 + ブロック種で照合されるので
  // 同じ種類を置き直すと当たる)。実測: 同条件で 2 回撮ると 6396 中 242 座標が食い違い、
  // 予約の読み取りも 11 件 vs 91 件とばらついた。空回しを挟むと**完全に一致する**。
  // 空にした座標の予約は発火時にブロック種の照合で捨てられるので、
  // 一番長い遅延 (ソウルサンド 20gt 等) を越える分だけ回せば枯れる
  scarpet('fx_clear()')
  // **エンティティも消す**。ブロックを air にしても、前回の実行でドロッパーが吐いた
  // アイテムなどはワールドに残り、次の実行でホッパーに吸われて中身が変わる
  // (README「掃除と残骸」#161 と同じ理由)
  rcon('kill', '@e[type=!player]')
  await waitForDrain(DRAIN_TICKS)
  scarpet('fx_setup()')
  if (placeItems.length > 0) {
    const n = scarpet('fx_items()')
    log(`[capture] 中身を投入: ${n.trim()}`)
    scarpet('fx_settle()')   // #196: 中身を入れた後にもう一度更新を配らないとコンパレーターが読まない
  }
  if (lecternBooks.length > 0) {
    // set() は blockstate しか作らないので、本は設置の**後**に rcon で入れ直す
    for (const b of lecternBooks) rcon(...buildLecternBookArgs(b))
    log(`[capture] 書見台に本を入れ直した: ${lecternBooks.length} 台 `
      + `(${lecternBooks.slice(0, 3).map(b => `${b.pos.join(',')} ${b.page + 1}/${b.pages}p`).join(' ')})`)
    // コンテナの中身と同じ理由 (#196)。without_updates で置いた後に block entity だけ
    // 変えてもコンパレーターは読みに行かないので、更新を配り直す
    scarpet('fx_settle()')
  }
  scarpet('fx_settle()')
  await waitForDrain(8)

  // 3. **ピストンが動き終わるまで待つ** (#244)。
  //
  // 動作中 (moving_piston) に撮り始めると**再現できないキャプチャ**になる。
  // moving_piston は運んでいる中身が BlockEntity 内にあって blockstate に出ないため、
  // 記録しても sim 側で復元できず、「伸びたはずのピストンが伸びない」という
  // **道具由来の食い違い**が出る (実際にこれで 1 周無駄にした)。
  for (let i = 0; ; i++) {
    const moving = Number(scarpet('fx_moving()').match(/=\s*(\d+)/)?.[1] ?? 0)
    if (moving === 0) break
    if (i >= SETTLE_MOVING_MAX) {
      // **警告して続けない** (#248)。moving_piston が初期状態に残ったキャプチャは
      // sim 側で復元できず、しかも食い違いが**下流の別の座標**に出るので
      // 「sim のバグ」に見えてしまう。撮れないなら撮れないと言って止まる方がよい
      throw new Error(
        `ピストンが ${SETTLE_MOVING_MAX} tick 経っても ${moving} 個動いたままです。`
        + 'この状態で撮ると初期状態を sim 側で復元できず、食い違いが道具由来になります。'
        + '止まらない機械なら region を狭めるか、動き続けない場面で撮ってください')
    }
    await waitForDrain(1)
  }

  // 4. プレイヤーを置く
  const players = def.players ?? []
  for (const p of players) {
    rcon('player', p.name, 'spawn', 'at', String(p.spawn[0]), String(p.spawn[1]), String(p.spawn[2]))
    await sleep(300)
  }

  // 5. 記録開始 → 入力を挟みながら tick を進める。
  //
  // **初期状態 (authored) も fx_cap_start が撮る** (#248)。
  // 差分の基準と同じ 1 回のスキャンから書き出すので、
  // 「初期状態 ≡ 記録開始時点」が構造的に保証される。
  // 以前は 3 の手前で別に撮っていて、そのあと 3 のピストン待ちが tick を進めるぶん
  // **初期状態だけが古い**キャプチャになっていた
  const watch = players.map(p => `'${p.name}'`).join(',')
  // **前回の残骸を消してから撮る**。書き出しに失敗しても古いファイルが読めてしまうと、
  // 「前回の初期状態 + 今回の frames」という一番たちの悪いキャプチャになる
  rmSync(join(sharedDir, 'authored.json'), { force: true })
  scarpet(`fx_cap_start([${watch}], '${def.name}')`)
  if (!existsSync(join(sharedDir, 'authored.json'))) {
    throw new Error('fx_cap_start が初期状態を書き出しませんでした (dump.sc の読み込みを確認)')
  }
  const authored = (JSON.parse(readFileSync(join(sharedDir, 'authored.json'), 'utf-8')) as {
    blocks: Record<string, string>
  }).blocks

  // **ブロック状態に出ない値を保存データから読む** (#240 / #249)。
  //
  // 記録開始と**同じ瞬間**に読むのが肝。以前は 3 の手前で読んでいたが、
  // 初期状態と時刻が揃っている保証が無かった (#248 と同じ穴)。
  // freeze 中なので save-all を挟んでも tick は進まない
  rcon('save-all', 'flush')
  await sleep(1500)
  const worldDir = join(repoRoot, 'tools', 'mc-harness', 'data', 'world')
  // 「あと 5gt で ON」のような予約 (#240)
  const scheduled = readScheduledTicks(worldDir, region.from, region.to)
  if (scheduled.length > 0) {
    log(`[capture] 実機の予約 tick: ${scheduled.length} 件`)
    for (const st of scheduled.slice(0, 5)) {
      log(`    ${st.pos.join(',')} ${st.block.replace('minecraft:', '')} 残り ${st.delay}gt 優先度 ${st.priority}`)
    }
  }
  // コンテナの中身 (#252)。**元ファイルではなく実機から読む**。
  // settle 中に機械が動いて中身が変わることがあり、そこがずれると
  // 「sim だけ違う持ち物で始まる」ことになる
  // (エレベーターのディスペンサーは空バケツ ⇄ 水バケツで入れ替わる)
  scarpet('fx_read_items()')
  const items = (JSON.parse(readFileSync(join(sharedDir, 'items.json'), 'utf-8')) as {
    items: CaptureItems[]
  }).items
  // **キーの並び順で差が出ないように正規化して比べる**
  // (実機から読んだ側は {count,id,slot}、元ファイル側は {slot,id,count} の順で来る)
  const slotsOf = (list: CaptureItems[], pos: number[]): string =>
    JSON.stringify((list.find(i => i.pos.join(',') === pos.join(','))?.slots ?? [])
      .map(x => [x.slot, x.id, x.count]))
  const drifted = items.filter(i => slotsOf(placeItems, i.pos) !== slotsOf(items, i.pos))
  log(`[capture] コンテナの中身を実機から読み直した: ${items.length} 個`
    + `${drifted.length > 0 ? ` (元ファイルとズレ ${drifted.length} 個)` : ''}`)
  for (const d of drifted.slice(0, 5)) {
    log(`    ${d.pos.join(',')}: ファイル=${slotsOf(placeItems, d.pos)} 実機=${slotsOf(items, d.pos)}`)
  }

  // コンパレーターが保持している出力強度 (#249)。0 のものは sim 側の既定と同じなので落とす
  const comparators = readComparatorOutputs(worldDir, region.from, region.to)
    .filter(c => c.output !== 0)
  if (comparators.length > 0) {
    log(`[capture] コンパレーターの保持出力: ${comparators.length} 個`
      + ` (${comparators.slice(0, 5).map(c => `${c.pos.join(',')}=${c.output}`).join(' ')})`)
  }

  // ホッパーの転送クールダウン (#290)。0 のものは sim 側の既定と同じなので落とす
  const cooldowns = readHopperCooldowns(worldDir, region.from, region.to)
    .filter(c => c.cooldown !== 0)
  if (cooldowns.length > 0) {
    log(`[capture] ホッパーの転送クールダウン: ${cooldowns.length} 個`
      + ` (${cooldowns.slice(0, 5).map(c => `${c.pos.join(',')}=${c.cooldown}gt`).join(' ')})`)
  }

  // 元ファイルとのズレを記録する (落とさない。実機が正)
  const source: Record<string, string> = {}
  for (const b of blocks) source[b.pos.join(',')] = toStateString(b.name, b.props)
  const settleDrift: Capture['settleDrift'] = []
  for (const k of new Set([...Object.keys(source), ...Object.keys(authored)])) {
    if (source[k] !== authored[k]) {
      settleDrift.push({ pos: k, source: source[k] ?? 'air', settled: authored[k] ?? 'air' })
    }
  }
  if (settleDrift.length > 0) {
    log(`[capture] 元ファイルと実機の安定状態が ${settleDrift.length} か所ズレた (実機を採用)`)
    for (const d of settleDrift.slice(0, 8)) log(`    ${d.pos}: ファイル=${d.source} 実機=${d.settled}`)
    if (settleDrift.length > 8) log(`    … 他 ${settleDrift.length - 8} 件`)
  }

  // **初期状態に moving_piston が残っていたら撮り直し** (#248)。
  // 3 の待ちループを抜けた後なので普通は起きないが、ここが最後の砦。
  // 残ったまま進むと compare 側で導体が air に化けて、
  // **5 ブロック下流の座標**が食い違い「sim のバグ」に見える
  const movingPos = Object.entries(authored)
    .filter(([, v]) => v.startsWith('moving_piston')).map(([k]) => k)
  if (movingPos.length > 0) {
    throw new Error(
      `初期状態に moving_piston が ${movingPos.length} 個残っています `
      + `(${movingPos.slice(0, 5).join(' ')})。`
      + 'sim 側で復元できないので、このキャプチャは使えません')
  }
  const inputs = (def.inputs ?? []).slice().sort((a, b) => a.tick - b.tick)
  let cur = 0
  for (const input of inputs) {
    if (input.tick > def.ticks) break
    if (input.tick > cur) {
      // **1 コマンドで N tick 進む**。__on_tick が 1 tick ずつ差分を記録する
      rcon('tick', 'step', String(input.tick - cur))
      await waitForTick(input.tick)
      cur = input.tick
    }
    await applyInput(input, players)
    scarpet('fx_cap_reframe()')
  }
  if (def.ticks > cur) {
    rcon('tick', 'step', String(def.ticks - cur))
    await waitForTick(def.ticks)
  }

  // 6. 回収
  const saved = scarpet(`fx_cap_save('${def.name}')`)
  log(`[capture] 記録: ${saved.trim()}`)
  const raw = JSON.parse(readFileSync(join(sharedDir, 'capture.json'), 'utf-8')) as {
    ticks: number
    frames: { tick: number; changes: { pos: string; block: string }[] }[]
    players: { tick: number; name: string; pos: number[]; on_ground: boolean }[]
  }
  for (const p of players) rcon('player', p.name, 'kill')

  const out: Capture = {
    name: def.name,
    source: def.source,
    mcVersion: MC_VERSION,
    region,
    authored,
    ...(items.length > 0 ? { items } : {}),
    // 書見台の本 (#239)。blockstate に出ないので、これを載せないと
    // sim 側が出力 14 に張り付いて階数指定が効かない
    ...(lecternBooks.length > 0
      ? { lecterns: lecternBooks.map(b => ({ pos: b.pos, page: b.page, pages: b.pages })) }
      : {}),
    // sim 側の FixtureInput にはまだ 'lectern' が無い (#240 で別担当が足す)。
    // キャプチャは**実機に当てた入力をそのまま残す**のが仕事なので、落とさずに書き出す
    inputs: inputs as Capture['inputs'],
    ticks: raw.ticks,
    frames: raw.frames.map(f => ({
      tick: f.tick,
      changes: f.changes.map(c => ({ pos: parseKey(c.pos), block: c.block })),
    })),
    players: raw.players.map(p => ({
      tick: p.tick, name: p.name,
      pos: [p.pos[0], p.pos[1], p.pos[2]],
      onGround: p.on_ground,
    })),
    ...(scheduled.length > 0 ? { scheduled } : {}),
    ...(comparators.length > 0 ? { comparators } : {}),
    ...(cooldowns.length > 0 ? { cooldowns } : {}),
    ...(settleDrift.length > 0 ? { settleDrift } : {}),
    generated: { at: new Date().toISOString(), mc: MC_VERSION, carpet: readCarpetVersion() },
  }
  mkdirSync(outDir, { recursive: true })
  const outPath = join(outDir, `${def.name}.json`)
  writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n')
  log(`[capture] 書き込み: ${outPath}`)
  log(`[capture] 変化のあった tick: ${out.frames?.length ?? 0} / 記録 ${out.ticks} tick`)
  return out
}

function readCarpetVersion(): string {
  try {
    const modsDir = join(repoRoot, 'tools', 'mc-harness', 'data', 'mods')
    const f = readFileSync(join(modsDir, '.index.json'), 'utf-8')
    const m = f.match(/carpet[^"]*?(\d[\w.+-]*)\.jar/)
    return m ? m[1] : 'unknown'
  } catch { return 'unknown' }
}

async function main() {
  const args = process.argv.slice(2)
  if (args.length === 0) {
    console.error('使い方: npx tsx tools/mc-harness/runner/capture.ts <定義.json>')
    process.exit(1)
  }
  for (const p of args.filter(a => !a.startsWith('-'))) {
    await withHarnessLock(() => capture(p))
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(e => {
    console.error(e instanceof Error ? e.message : e)
    process.exit(1)
  })
}
