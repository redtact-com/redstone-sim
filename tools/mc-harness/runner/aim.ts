// ============================================================
// `use` の狙点をブロックの当たり判定に合わせる (#378)。
//
// ハーネスはずっと**セル中心 (x+0.5, y+0.5, z+0.5)** を狙っていた。
// `face=wall` のボタン/レバーは当たり判定が壁際に寄っているので射線が入らず、
// **押せないまま黙って何も起きない** (`player use once` は当たらなくても
// エラーを返さない)。#376 でエレベーターの呼びボタンがこれに当たり、
// 「機械が動くかをハーネスから確かめられない」状態になっていた。
//
// 対処は 2 段構え:
//   1. まずセル中心を狙う (**従来と同じ**。既存のキャプチャを動かさないため)
//   2. 反応が無ければ形状から決めた点を狙い直す
//
// 押せたかどうかは**対象ブロックの blockstate が変わったか**で見る。
// ボタンもレバーも押せば必ず `powered` が変わるので、変わらなければ外している。
// ============================================================

import { parseMcState } from '../../../packages/sim/src/mcstate.js'
import { scarpet } from './rcon.js'

export type Pos3 = [number, number, number]

/** 向きの単位ベクトル */
const DIR: Record<string, Pos3> = {
  north: [0, 0, -1],
  south: [0, 0, 1],
  west: [-1, 0, 0],
  east: [1, 0, 0],
}

/**
 * 壁付けの当たり判定へ寄せる量。
 *
 * `ButtonBlock` の当たり判定は `facing` の**反対側**の面に寄っている
 * (facing=north なら z が 0.875〜1.0)。**0.4 で押せることを実機で確認した**
 * (0.5 = セル中心は外れる)。レバーも同じ形。
 */
export const WALL_OFFSET = 0.4

/** 天井付けの狙点の高さ (当たり判定は y 0.875〜1.0) */
export const CEILING_Y = 0.94

/** 床置きの狙点の高さ (ボタンは y 0〜0.125、レバーは 0〜0.375) */
export const FLOOR_Y: Record<string, number> = { button: 0.06, lever: 0.3 }

/** 押せば blockstate が変わる (= 空振りを検出できる) ブロックか */
export function isVerifiable(state: string): boolean {
  const { name, props } = parseMcState(state)
  if (props.powered === undefined) return false
  return name.endsWith('_button') || name === 'lever'
}

/** 形状から決まる狙点。ボタン/レバー以外は `null` */
export function shapeAim(pos: Pos3, state: string): Pos3 | null {
  const { name, props } = parseMcState(state)
  const kind = name.endsWith('_button') ? 'button' : name === 'lever' ? 'lever' : null
  if (kind === null) return null
  const cx = pos[0] + 0.5
  const cz = pos[2] + 0.5

  switch (props.face) {
    case 'wall': {
      const d = DIR[props.facing ?? '']
      if (d === undefined) return null
      // **facing の反対**へ寄せる (当たり判定が壁に貼り付いている側)
      return [cx - d[0] * WALL_OFFSET, pos[1] + 0.5, cz - d[2] * WALL_OFFSET]
    }
    case 'floor':
      return [cx, pos[1] + FLOOR_Y[kind], cz]
    case 'ceiling':
      return [cx, pos[1] + CEILING_Y, cz]
    default:
      return null
  }
}

/**
 * 押しに行くための立ち位置の候補 (**近い順**)。
 *
 * 狙点を直しても**届かなければ押せない**。エレベーターの呼びボタンは y=59 に
 * あるのに定義の fake player は y=6 に湧くので、狙点だけでは届かなかった。
 *
 * 壁付けはボタンが向いている側 (`facing`) に立つ。視線が壁に遮られないのと、
 * リーチ (サバイバルで 4.5) に収まるのが条件。**足元 1 ブロック下**を基本にするのは
 * 目の高さ (足元 +1.62) がボタンの中心 (+0.5) より少し上に来て見下ろす形になるため。
 */
export function standCandidates(pos: Pos3, state: string | undefined): Pos3[] {
  if (state === undefined) return []
  const { props } = parseMcState(state)
  const cx = pos[0] + 0.5
  const cz = pos[2] + 0.5

  switch (props.face) {
    case 'wall': {
      const d = DIR[props.facing ?? '']
      if (d === undefined) return []
      // **セル中心に立たせる** (整数ブロック分だけ離す)。
      // 1.5 ブロック離すとプレイヤーの当たり判定がセル境界にまたがり、
      // 同じ狙点でも押せなくなる (実測: z=7.0 は失敗 / z=7.5 は 4 回中 4 回成功)
      const out: Pos3[] = []
      for (const dy of [-1, -2, 0]) {
        for (const dist of [1, 2]) {
          out.push([cx + d[0] * dist, pos[1] + dy, cz + d[2] * dist])
        }
      }
      return out
    }
    case 'floor':
      // ボタン自身のセル (非導体なので立てる) から見下ろす
      return [[cx, pos[1], cz], [cx, pos[1] + 1, cz]]
    case 'ceiling':
      return [[cx, pos[1] - 2, cz], [cx, pos[1] - 1, cz]]
    default:
      return []
  }
}

const same = (a: Pos3, b: Pos3): boolean =>
  a.every((v, i) => Math.abs(v - b[i]) < 1e-9)

/**
 * 狙点の候補を**狙う順**に返す。
 *
 * 先頭は `firstAim` (無ければセル中心) で、**これが従来の挙動**。
 * 形状から別の点が決まるときだけ 2 つ目が付く。
 */
export function aimCandidates(
  pos: Pos3, state: string | undefined, firstAim?: Pos3,
): Pos3[] {
  const first: Pos3 = firstAim ?? [pos[0] + 0.5, pos[1] + 0.5, pos[2] + 0.5]
  if (state === undefined) return [first]
  const shape = shapeAim(pos, state)
  return shape === null || same(first, shape) ? [first] : [first, shape]
}

/**
 * `use` が当たったか。
 *
 * ボタンもレバーも押せれば `powered` が変わる。**押す前から `powered=true`
 * のボタン**は押しても `true` のままなので、その場合は判定できない
 * (`null` を返して「分からない」と伝える。空振り扱いにすると
 * 連打したときに毎回警告が出る)。
 */
export function didRespond(before: string | undefined, after: string | undefined): boolean | null {
  if (before === undefined || after === undefined) return null
  if (!isVerifiable(before)) return null
  if (parseMcState(before).props.powered === 'true') return null
  return before !== after
}

/** 狙点をコマンド引数の文字列にする */
export const aimArgs = (p: Pos3): [string, string, string] =>
  [String(p[0]), String(p[1]), String(p[2])]

export interface PressResult {
  /** 実際に使った狙点 */
  aim: Pos3
  /** 押すために動かした先 (動かしていなければ null) */
  movedTo: Pos3 | null
  /** 空振りを検出して狙い直したか */
  retried: boolean
  /**
   * 当たったか。`null` は「判定できない」
   * (ボタン/レバー以外、または押す前から powered=true)
   */
  responded: boolean | null
}

export interface PressDeps {
  /**
   * 照準して 1 回だけ使う。
   *
   * `moveTo` が付いたら**同じ rcon バッチで先に動かす** (#382)。
   * `/tick freeze` は**プレイヤーを止めない**ので、足場の無い所に置いた fake player は
   * 実時間で落ちていく (Runa のドアは壁レバーの前に床が無く、tp してから
   * 別コマンドで押すと 600 ミリ秒で 1.8 ブロック落ちて外す)。
   * tp → 照準 → 使用を 1 バッチで送れば落ちる前に押し切れる。
   */
  use: (aim: Pos3, moveTo?: Pos3) => Promise<void>
  /** 対象の blockstate を読む (判定に使う。読めなければ undefined) */
  read: () => string | undefined
  log?: (msg: string) => void
}

/**
 * 狙点を切り替えながら `use` する。
 *
 * **`use` は tick を進めない**ので、外した 1 回目は世界に何も残らない
 * (ボタンにもレバーにも当たっていないため)。よって狙い直しても
 * キャプチャの tick 精度は崩れない。
 */
export async function pressBlock(
  pos: Pos3, state: string | undefined, deps: PressDeps,
  opts: { firstAim?: Pos3; warnOnFail?: boolean; stands?: Pos3[] } = {},
): Promise<PressResult> {
  const log = deps.log ?? (() => {})
  const aims = aimCandidates(pos, state, opts.firstAim)
  const shape = state === undefined ? null : shapeAim(pos, state)
  let last: PressResult = { aim: aims[0], movedTo: null, retried: false, responded: null }

  // 1. いまの場所から狙点を変えながら押す
  for (let i = 0; i < aims.length; i++) {
    const before = deps.read()
    await deps.use(aims[i])
    const responded = didRespond(before, deps.read())
    last = { aim: aims[i], movedTo: null, retried: i > 0, responded }
    if (responded !== false) return last
    if (i + 1 < aims.length) {
      log(`[aim] ${pos.join(',')} をセル中心で押せなかった (${before})。`
        + `形状に合わせて ${aims[i + 1].join(',')} を狙い直す`)
    }
  }

  // 2. それでも駄目なら**動かして押す**。tp と押すのを 1 バッチで送るので
  //    足場が無くても落ちる前に押し切れる
  const stands = opts.stands ?? []
  for (const at of stands) {
    const aim = shape ?? aims[0]
    const before = deps.read()
    await deps.use(aim, at)
    const responded = didRespond(before, deps.read())
    last = { aim, movedTo: at, retried: true, responded }
    if (responded !== false) {
      log(`[aim] ${pos.join(',')} は ${at.join(',')} へ動かして押した`)
      return last
    }
  }

  // 呼び元が別の手を持っているなら、ここでは警告しない
  if (opts.warnOnFail !== false) {
    log(`[aim] ⚠ ${pos.join(',')} を押せなかった (${state ?? '不明'})。`
      + `狙点 ${aims.length} 通り / 立ち位置 ${stands.length} 通りを試した。`
      + '視線が遮られていないか、facing 側に立てるかを疑うこと')
  }
  return last
}

/**
 * 実機から 1 ブロックの blockstate を読む。
 *
 * `str(block(...))` は props を落として `oak_button` しか返さないので
 * `face` / `facing` が見えない。dump.sc の `fx_state` を通す。
 */
export function readState(pos: Pos3): string | undefined {
  try {
    const out = scarpet(`fx_state([${pos.join(',')}])`)
    const m = /=\s*(\S+)/.exec(out)
    return m?.[1]
  } catch {
    return undefined
  }
}
