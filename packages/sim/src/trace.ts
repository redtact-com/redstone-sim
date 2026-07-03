// ============================================================
// トレース出力 (I10 #18)。記法は docs/research/08_trace-notation.md が正。
//
// enokilovin 氏の descriptive logics を sim 実装へ適応したもの。
// SimWorld の内部イベント (schedule / execute / update 発行) から
// TraceEvent を生成し、1 行 1 イベントの文字列へ整形する。
//
// レベル (08 §5):
//   - processFormula 行 … 常に出力 ([PI]/[ST]/[BE] の 1 行)
//   - updateFormula 行 … verbose 時のみ (bu 更新の発行内訳)
//
// 記法の実装割当 (08 §1-4):
//   <gt>gt[Phase]: Abbr(action.delay)   予約 (schedule)
//   <gt>gt[Phase]: Abbr{action.delay}   実行 (execute)
//   ST 予約は末尾に " p<priority>" を併記する。
//   BE 予約の delay は 's' (BlockEvent scheduling, 08 §1)。
//   異常系 '*' / 失敗 '-' は action の直後に付く (08 §1 の修飾)。
//
// 本適応版の判断 (08 §1 の worked example と整合させた運用):
//   - 実行 (execute) の delay は素子固有の遅延 (elemDelay) を表示する。
//     例: Le{n.0} (レバー=0), Co{c.2} (コンパレーター=2), Pi{p.0} (BE=0)。
//   - 予約 (reserve) の delay は schedule に渡した実 delay を表示する。
//   - verbose の bu トークンは発行対象を発行元からの相対座標で表す
//     (08 §2 の front 相対命名の完全再現はしない。方向順の受け入れ基準は
//      I6 側が担保する、と 08 §2 が明記)。
// ============================================================

import type { BlockState } from './types.js'

/** 08 §1 の Phase 列挙 (CT/EN/TE は sim 未実装。予約語として確保) */
export type TracePhase = 'PI' | 'CT' | 'ST' | 'BE' | 'EN' | 'TE'

/** 08 §1 の action: turn oN / turn oFf / Push / Retract / Change */
export type TraceAction = 'n' | 'f' | 'p' | 'r' | 'c'

/**
 * 1 トレースイベント。
 * - kind='process': processFormula 行 (常時出力)
 * - kind='update' : updateFormula 行 (verbose 時のみ)
 */
export interface TraceEvent {
  kind: 'process' | 'update'
  gt: number
  phase: TracePhase
  /** 素子略号 (08 §4)。abbrOf() 参照 */
  abbr: string
  action: TraceAction
  /** 予約遅延 (gt) or 's' (BlockEvent 予約) */
  delay: number | 's'
  /** true = 予約 '()' / false = 実行 '{}' */
  reserve: boolean
  /** ST 予約の TickPriority (小さいほど先。08/02 §2.2) */
  priority?: number
  /** '-' 失敗修飾 (08 §1) */
  failed?: boolean
  /** '*' 異常系修飾 (08 §1) */
  abnormal?: boolean
  /** verbose: updateFormula の bu/su トークン列 */
  updates?: string[]
}

export interface TraceOptions {
  /** true で updateFormula 行 (bu 発行内訳) も出力する (08 §6: 既定は抑制) */
  verbose?: boolean
}

/**
 * 素子略号 (08 §4 対応表)。
 * moving_piston は確定先 (into) の略号を返す (08 §6 の [ST] 扱いに合わせる)。
 * spec 表に無い素子 (redstone_block=Rb / target=Tg / container=Cn) は拡張。
 */
export function abbrOf(b: BlockState): string {
  switch (b.type) {
    case 'lever':          return 'Le'
    case 'button_stone':
    case 'button_wood':    return 'Bu'
    case 'pressure_plate_wood':
    case 'pressure_plate_stone': return 'Pp'
    case 'weighted_pressure_plate_light':
    case 'weighted_pressure_plate_heavy': return 'Wp'
    case 'wire':           return 'Rs'
    case 'torch':
    case 'wall_torch':     return 'To'
    case 'repeater':       return 'Re'
    case 'comparator':     return 'Co'
    case 'lamp':           return 'La'
    case 'solid':          return 'Bl'
    case 'redstone_block': return 'Rb'
    case 'target':         return 'Tg'
    case 'container':      return 'Cn'
    case 'piston':
    case 'sticky_piston':  return 'Pi'
    case 'piston_head':    return 'Ph'
    case 'observer':       return 'Ob'
    case 'moving_piston':  return abbrOf(b.into)
    case 'air':            return 'Ai'
  }
}

/**
 * 予約 (schedule) 時点のブロック状態から「予約される遷移の action」を推定する。
 * schedule() は action を持たない (実行時再評価) が、トレース表示のため
 * その時点の状態から予約意図を推定する (08 §1 の Co(f.2) 等に相当)。
 */
export function pendingAction(b: BlockState): TraceAction {
  switch (b.type) {
    case 'torch':
    case 'wall_torch':     return b.lit ? 'f' : 'n'
    case 'lamp':           return b.lit ? 'f' : 'n'
    case 'repeater':       return b.powered ? 'f' : 'n'
    case 'button_stone':
    case 'button_wood':    return b.powered ? 'f' : 'n'
    case 'pressure_plate_wood':
    case 'pressure_plate_stone':
    case 'weighted_pressure_plate_light':
    case 'weighted_pressure_plate_heavy': return b.powered ? 'f' : 'n'
    case 'target':         return b.outputPower > 0 ? 'f' : 'n'
    case 'observer':       return b.powered ? 'f' : 'n'
    case 'comparator':     return 'c'
    case 'moving_piston':  return 'c'
    default:               return 'c'
  }
}

/**
 * 素子固有の遅延 (gt)。実行 (execute) 行の delay 表示に使う。
 * schedule に渡す実 delay と一致する (torch burnout の 160gt 復帰のみ例外で 2)。
 */
export function elemDelay(b: BlockState): number {
  switch (b.type) {
    case 'repeater':       return b.delay * 2
    case 'comparator':     return 2
    case 'torch':
    case 'wall_torch':     return 2
    case 'lamp':           return 4
    case 'button_stone':   return 20
    case 'button_wood':    return 30
    case 'pressure_plate_wood':
    case 'pressure_plate_stone': return 20   // [確定: 26.2 getPressedTime]
    case 'weighted_pressure_plate_light':
    case 'weighted_pressure_plate_heavy': return 10  // [確定: 26.2 getPressedTime]
    case 'target':         return 20
    case 'moving_piston':  return 2
    default:               return 0
  }
}

/** 1 イベントを 08 記法の 1 行文字列へ整形する */
export function formatTraceEvent(e: TraceEvent): string {
  const mods = `${e.abnormal ? '*' : ''}${e.failed ? '-' : ''}`
  let body: string
  if (e.reserve) {
    body = `${e.abbr}(${e.action}.${e.delay}${mods})`
  } else {
    const d = e.delay === 's' ? '' : `.${e.delay}`
    body = `${e.abbr}{${e.action}${d}${mods}}`
  }
  if (e.kind === 'update') {
    // updateFormula: "Body; {tokens}" (08 §2。gt/Phase 接頭辞は付けない)
    return `${body}; {${(e.updates ?? []).join(', ')}}`
  }
  // processFormula: "<gt>gt[Phase]: Body" (+ ST 予約は priority 併記)
  let line = `${e.gt}gt[${e.phase}]: ${body}`
  if (e.reserve && e.priority !== undefined) line += ` p${e.priority}`
  return line
}

/**
 * トレースイベントの収集・整形を担う。SimWorld が 1 つ保持する。
 * getLines() は verbose に応じて updateFormula 行を出し分ける。
 */
export class Tracer {
  readonly verbose: boolean
  private events: TraceEvent[] = []

  constructor(opts: TraceOptions = {}) {
    this.verbose = opts.verbose ?? false
  }

  push(e: TraceEvent): void {
    this.events.push(e)
  }

  clear(): void {
    this.events.length = 0
  }

  getEvents(): readonly TraceEvent[] {
    return this.events
  }

  /** verbose=false では process 行 (=PI/ST/BE) のみを返す */
  getLines(): string[] {
    return this.events
      .filter(e => this.verbose || e.kind === 'process')
      .map(formatTraceEvent)
  }
}
