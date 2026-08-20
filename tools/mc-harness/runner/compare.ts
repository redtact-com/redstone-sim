// ============================================================
// 突き合わせ CLI: 実機キャプチャ vs @redstone/sim
//
// 使い方: npx tsx tools/mc-harness/runner/compare.ts <capture.json> [--json <out>]
//
//   --json <out> … 機械可読レポートを書き出す (AI がループで読むのが主目的)。
//                  first divergence の tick / 座標 / 前後の値・除外件数が取れる。
//
// generate.ts が撮る fixture と違い、キャプチャは「litematic を実機に流し込んで
// 撮った丸ごとの dump」なので回路が大きい。よって「全 tick の全差分を並べる」
// run.ts の出し方ではなく、**最初に食い違った tick と座標** + その座標の
// 周囲 6 方向 (実機・sim 両方) に絞って出す。原因はたいてい隣にある。
//
// 照合そのものは新しく書かず、captureToFixture でキャプチャを既存の Fixture へ
// 写して packages/sim/test/fixture-runner.ts (expandExpect / diffStateSeries) に
// 通す。tick 規約も fixture と同一:
//   state[t] = 「tick t の ScheduledTick フェーズ完了後、inputs[tick==t] を
//   適用した直後」の状態。
//
// 終了コード:
//   0 … 一致 (moving_piston 除外後)
//   1 … 不一致 / キャプチャが読めない
// ============================================================

import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { posKey, relative, ALL_DIRS } from '@redstone/sim'
import type { Pos3D, Dir6 } from '@redstone/sim'
import {
  expandExpect, diffStateSeries, runFixtureOnSim,
  type Fixture, type FixtureInput, type FixtureExpectEntry, type StateMap,
} from '../../../packages/sim/test/fixture-runner.js'

// ── キャプチャの形 ────────────────────────────────────────────────────────────
// 実機キャプチャ側 (litematic 読み込み / 実機再生 / dump) と共通の形式。
// **勝手に変えないこと** (3 実装が同じ JSON を読み書きする)。

/** コンテナ 1 スロット分の中身 (blockstate に出ない BE 内容) */
export interface CaptureSlot {
  slot: number
  id: string
  count: number
}

/** コンテナ 1 個分の初期在庫 */
export interface CaptureItems {
  pos: Pos3D
  slots: CaptureSlot[]
}

/**
 * プレイヤーの軌跡。sim にエンティティは持ち込まない (13 §2 エンティティ境界原則)
 * ので照合には使わない。実機側のデバッグ用に載っているだけ。
 */
export interface CapturePlayer {
  tick: number
  name: string
  pos: [number, number, number]
  onGround: boolean
}

export interface Capture {
  name: string
  /** 元になった litematic のパス (情報用) */
  source?: string
  mcVersion: string
  region: { from: Pos3D; to: Pos3D }
  /** 実機の settled 状態 (tick 0 の直前)。キーは "x,y,z" */
  authored: Record<string, string>
  items?: CaptureItems[]
  /**
   * 書見台の本 (#239)。**ページ数と現在ページは blockstate に出ない**ので、
   * これが無いと sim 側の出力が 14 に張り付き、階数指定が効かない
   */
  lecterns?: { pos: Pos3D; page: number; pages: number }[]
  inputs?: FixtureInput[]
  ticks: number
  /** 差分のみ。消滅は "block": "air" */
  frames?: FixtureExpectEntry[]
  players?: CapturePlayer[]
  /** 実機の予約 tick (#240)。blockstate に出ない「あと N gt で発火」を持ち込む */
  scheduled?: { pos: Pos3D; delay: number; priority: number; block?: string }[]
  /** 元ファイルと実機の安定状態のズレ (実機が正。参考情報) */
  settleDrift?: { pos: string; source: string; settled: string }[]
  generated?: { at: string; mc: string; carpet: string }
}

// ── キャプチャ → Fixture ──────────────────────────────────────────────────────

/** "x,y,z" → Pos3D。keyToPos と違い形式を検証する (キャプチャは外部入力なので) */
function parsePosKey(key: string): Pos3D {
  const parts = key.split(',').map(s => Number(s.trim()))
  if (parts.length !== 3 || parts.some(n => !Number.isInteger(n))) {
    throw new Error(`authored の座標キーが不正: "${key}" ("x,y,z" 形式で書くこと)`)
  }
  return [parts[0], parts[1], parts[2]]
}

/**
 * キャプチャを既存の Fixture へ写す。
 *
 * authored (マップ) → blocks[] / frames → expect / items → blocks[].items。
 * **新しい照合機構を作らない**ためだけの変換なので、内容は落とさず 1:1 に写す
 * (moving_piston の除外もここではやらない。compareCapture が受け持つ)。
 * players は sim に対応物が無いので捨てる。
 */
export function captureToFixture(cap: Capture, trustAuthored = false): Fixture {
  // items / 書見台の本は座標で引けるようにしておく (authored の走査中に引き当てる)
  const lecternByPos = new Map<string, { page: number; pages: number }>()
  for (const l of cap.lecterns ?? []) lecternByPos.set(posKey(l.pos), { page: l.page, pages: l.pages })
  const itemsByPos = new Map<string, CaptureSlot[]>()
  for (const it of cap.items ?? []) itemsByPos.set(posKey(it.pos), it.slots)

  const blocks: Fixture['blocks'] = []
  for (const key of Object.keys(cap.authored)) {
    const pos = parsePosKey(key)
    // JSON のキー順に依存しないよう後で並べ替える (レポートの再現性のため)
    const slots = itemsByPos.get(posKey(pos))
    const book = lecternByPos.get(posKey(pos))
    blocks.push({
      pos,
      block: cap.authored[key],
      ...(slots === undefined ? {} : { items: slots.map(s => ({ ...s })) }),
      ...(book === undefined ? {} : { lectern: { ...book } }),
    })
  }
  blocks.sort((a, b) => a.pos[0] - b.pos[0] || a.pos[1] - b.pos[1] || a.pos[2] - b.pos[2])

  return {
    name: cap.name,
    ...(cap.source ? { description: `実機キャプチャ: ${cap.source}` } : {}),
    mcVersion: cap.mcVersion,
    ticks: cap.ticks,
    region: cap.region,
    blocks,
    inputs: cap.inputs ?? [],
    expect: cap.frames ?? [],
    // **動いている機械**は authored をそのまま出発点にし、実機の予約 tick を積む。
    // そうしないと tick 0 から食い違って以降の差分が雪崩れる (#240)
    ...(trustAuthored ? { trustAuthored: true, scheduled: cap.scheduled ?? [] } : {}),
    ...(cap.generated ? { generated: cap.generated } : {}),
  }
}

// ── 比較不能な座標 (moving_piston) ────────────────────────────────────────────

export const EXCLUDE_REASON =
  'moving_piston は運んでいる中身が BlockEntity 内にあり blockstate に出ないため比較不能 '
  + '(packages/sim/src/mcstate.ts:195-198)'

/**
 * blockstate 文字列が moving_piston か。
 * **名前空間つきでも判定する** (authored は生の実機ダンプ由来で `minecraft:` が付き得る)。
 */
function isMovingPiston(state: string): boolean {
  const id = state.replace(/^minecraft:/, '')
  return id === 'moving_piston' || id.startsWith('moving_piston[')
}

/**
 * その tick・その座標が比較不能か。
 *
 * **座標ごと全 tick を捨ててはいけない**。ピストンは動いた瞬間だけ moving_piston になり、
 * 前後の tick は普通のブロックなので比較できる。座標ごと落とすと
 * 「実機ではピストンが動いたのに sim では動かなかった」という**一番見たい食い違いが消える**
 * (検証でこの偽陰性を実証済み)。
 */
function excludedAt(expected: StateMap[], actual: StateMap[], tick: number, pos: string): boolean {
  const e = expected[tick]?.get(pos)
  const a = actual[tick]?.get(pos)
  return (e !== undefined && isMovingPiston(e)) || (a !== undefined && isMovingPiston(a))
}

// ── レポート ──────────────────────────────────────────────────────────────────

export interface NeighborView {
  dir: Dir6
  pos: string
  mc: string
  sim: string
  /** region 外 (キャプチャに観測が無く、実機側は常に 'air' に見える) */
  outside?: boolean
  /** moving_piston で比較不能な座標 */
  excluded?: boolean
}

export interface DivergentPos {
  pos: string
  /** 実機キャプチャ側の値 */
  mc: string
  /** sim 側の値 */
  sim: string
  neighbors: NeighborView[]
}

export interface CompareReport {
  /**
   * tick 0 (初期状態) で食い違った座標数。
   * **0 でないときは先の tick の差分を読んでも意味が無い** — 出発点が違う。
   * 動いている機械 (クロックを持つ回路) を撮ると、実機のスナップショットと
   * sim の initialize() の再計算が一致しないためここに出る
   */
  initialMismatch: number
  name: string
  source?: string
  ok: boolean
  ticks: number
  /** region 全体の座標数 */
  regionPositions: number
  /** 実際に突き合わせた座標数 (region − 除外) */
  comparedPositions: number
  excluded: {
    count: number
    positions: string[]
    /** 除外により捨てた (tick, 座標) 差分の件数 */
    suppressedDiffs: number
    reason: string
  }
  /** 不一致のあった tick 数 */
  divergentTickCount: number
  /** 不一致 tick の一覧 (先頭 MAX_TICK_LIST 件) */
  divergentTicks: number[]
  /**
   * **どこかの tick で食い違った座標の全件** (昇順・重複なし)。
   * first は先頭 tick の先頭 8 座標しか載せないので、
   * 「この座標は食い違ったか」を機械が判定するにはこちらを見る (minimize.ts の署名)。
   */
  divergentPositions: string[]
  /** (tick, 座標) 差分の総件数 */
  totalDiffs: number
  /** 最初に食い違った tick とその座標 (一致なら null) */
  first: {
    tick: number
    positions: DivergentPos[]
    /** positions に載せきらなかった座標数 */
    truncated: number
  } | null
  /** 黙って無視される指定への警告 (AI ループが空振りしないように) */
  warnings: string[]
}

/** first divergence で周囲まで出す座標の上限 (でかい回路で溢れさせない) */
const MAX_DETAIL_POSITIONS = 8
/** divergentTicks に載せる上限 */
const MAX_TICK_LIST = 32

// ── 比較本体 ──────────────────────────────────────────────────────────────────

function inRegion(fx: Fixture, p: Pos3D): boolean {
  // snapshotFixtureRegion と同じく from..to を昇順として素直に見る
  const [x0, y0, z0] = fx.region.from
  const [x1, y1, z1] = fx.region.to
  return p[0] >= x0 && p[0] <= x1 && p[1] >= y0 && p[1] <= y1 && p[2] >= z0 && p[2] <= z1
}

function regionVolume(fx: Fixture): number {
  const [x0, y0, z0] = fx.region.from
  const [x1, y1, z1] = fx.region.to
  return Math.max(0, x1 - x0 + 1) * Math.max(0, y1 - y0 + 1) * Math.max(0, z1 - z0 + 1)
}

/** 黙って無視される指定 (region 外・ticks 超過など) を洗い出す */
function captureWarnings(cap: Capture, fx: Fixture): string[] {
  const warnings: string[] = []
  const authoredKeys = new Set(fx.blocks.map(b => posKey(b.pos)))

  const outside = fx.blocks.filter(b => !inRegion(fx, b.pos)).map(b => posKey(b.pos))
  if (outside.length > 0) {
    warnings.push(`authored の ${outside.length} 座標が region 外 (sim は region しか観測しないので必ず差分になる): `
      + outside.slice(0, 5).join(' '))
  }
  for (const f of cap.frames ?? []) {
    if (f.tick > cap.ticks) {
      warnings.push(`frames の tick=${f.tick} は ticks=${cap.ticks} を超えるので無視される`)
      continue
    }
    const bad = f.changes.filter(c => !inRegion(fx, c.pos)).map(c => posKey(c.pos))
    if (bad.length > 0) {
      warnings.push(`frames tick=${f.tick} の ${bad.length} 座標が region 外: ${bad.slice(0, 5).join(' ')}`)
    }
  }
  for (const it of cap.items ?? []) {
    if (!authoredKeys.has(posKey(it.pos))) {
      warnings.push(`items の ${posKey(it.pos)} に対応する authored ブロックが無いので中身は捨てられる`)
    }
  }
  return warnings
}

/**
 * キャプチャを sim に流して突き合わせる。
 *
 * 照合は expandExpect (実機 ground truth の展開) と runFixtureOnSim を
 * diffStateSeries に掛けるだけ。ここでやる上乗せは
 *   1. moving_piston 座標の除外 (実機・sim どちらかで一度でも出たら全 tick 除外)
 *   2. 最初の食い違いへの絞り込みと周囲 6 方向の添付
 * の 2 点。
 */
export function compareCapture(cap: Capture, opts: { trustAuthored?: boolean } = {}): CompareReport {
  const fx = captureToFixture(cap, opts.trustAuthored === true)

  // **初期状態の moving_piston は落とさず、落とす** (#248)。
  //
  // 以前はここで黙って world 構築から外していた。「どのみち比較不能座標なので
  // 結果には影響しない」と書いてあったが、**影響する**。moving_piston が導体なら
  // それが air になって給電経路がまるごと消え、食い違いは
  // **その座標ではなく下流**に出る。実際 #248 では 5 ブロック先のコンパレーターが
  // 食い違い、tick 内の順序の問題だと 1 周誤診した。
  // tick 途中に現れる moving_piston の (tick, 座標) 単位の除外は下でそのまま続ける
  const authoredMoving = fx.blocks.filter(b => isMovingPiston(b.block))
  if (authoredMoving.length > 0) {
    throw new Error(
      `初期状態に moving_piston が ${authoredMoving.length} 個あります `
      + `(${authoredMoving.slice(0, 5).map(b => b.pos.join(',')).join(' ')})。`
      + 'sim 側で復元できないので、このキャプチャは比較に使えません。'
      + 'ピストンが動き終わってから撮り直してください (npm run capture)')
  }

  const expected = expandExpect(fx)
  const actual = runFixtureOnSim(fx)

  // 除外は **(tick, 座標) 単位**。その tick に実機か sim のどちらかが moving_piston の
  // ときだけ落とす。authored の moving_piston は tick 0 の分だけ落ちる
  const excluded = new Set<string>()
  let suppressedDiffs = 0
  let totalDiffs = 0
  const kept: { tick: number; diffs: { pos: string; expected: string; actual: string }[] }[] = []
  for (const d of diffStateSeries(expected, actual)) {
    const diffs = d.diffs.filter(x => {
      if (!excludedAt(expected, actual, d.tick, x.pos)) return true
      excluded.add(x.pos)
      return false
    })
    suppressedDiffs += d.diffs.length - diffs.length
    if (diffs.length === 0) continue
    totalDiffs += diffs.length
    kept.push({ tick: d.tick, diffs })
  }

  // kept は diffStateSeries が tick 昇順に積むのでそのまま先頭が最初の食い違い
  const head = kept[0]
  const first = head === undefined ? null : {
    tick: head.tick,
    positions: head.diffs.slice(0, MAX_DETAIL_POSITIONS).map(x => ({
      pos: x.pos,
      mc: x.expected,
      sim: x.actual,
      neighbors: neighborsOf(fx, x.pos, expected[head.tick], actual[head.tick], excluded),
    })),
    truncated: Math.max(0, head.diffs.length - MAX_DETAIL_POSITIONS),
  }

  // **tick 0 の不一致は「初期状態が再現できていない」**という別種の問題。
  // ここがズレたまま先の tick を見ても差分は雪崩れるだけなので、明示的に分ける
  const initialMismatch = kept.length > 0 && kept[0].tick === 0
    ? kept[0].diffs.length : 0

  // 食い違った座標を全件集める (minimize.ts が「署名」の判定に使う)
  const divergent = new Set<string>()
  for (const d of kept) for (const x of d.diffs) divergent.add(x.pos)

  const volume = regionVolume(fx)
  return {
    initialMismatch,
    name: cap.name,
    ...(cap.source ? { source: cap.source } : {}),
    ok: kept.length === 0,
    ticks: fx.ticks,
    regionPositions: volume,
    comparedPositions: Math.max(0, volume - excluded.size),
    excluded: {
      count: excluded.size,
      positions: [...excluded].sort(),
      suppressedDiffs,
      reason: EXCLUDE_REASON,
    },
    divergentTickCount: kept.length,
    divergentTicks: kept.slice(0, MAX_TICK_LIST).map(d => d.tick),
    divergentPositions: [...divergent].sort(),
    totalDiffs,
    first,
    warnings: captureWarnings(cap, fx),
  }
}

/** 座標の周囲 6 方向を実機・sim 両方で並べる (原因はたいてい隣にある) */
function neighborsOf(
  fx: Fixture,
  pos: string,
  mcState: StateMap | undefined,
  simState: StateMap | undefined,
  excluded: Set<string>,
): NeighborView[] {
  const p = parsePosKey(pos)
  return ALL_DIRS.map(dir => {
    const np = relative(p, dir)
    const key = posKey(np)
    const view: NeighborView = {
      dir,
      pos: key,
      mc: mcState?.get(key) ?? 'air',
      sim: simState?.get(key) ?? 'air',
    }
    if (!inRegion(fx, np)) view.outside = true
    if (excluded.has(key)) view.excluded = true
    return view
  })
}

// ── 表示 ──────────────────────────────────────────────────────────────────────

const DIR_LABEL: Record<Dir6, string> = {
  north: 'north', south: 'south', east: 'east ', west: 'west ', up: 'up   ', down: 'down ',
}

export function formatReport(r: CompareReport): string {
  const lines: string[] = []
  const ex = r.excluded.count > 0
    ? `, 除外 ${r.excluded.count} 座標 (moving_piston)`
    : ''

  if (r.ok) {
    lines.push(`✔ ${r.name}: 一致 (${r.ticks + 1} tick 分, ${r.comparedPositions} 座標${ex})`)
  } else {
    lines.push(`✘ ${r.name}: ${r.divergentTickCount} tick で不一致 (差分 ${r.totalDiffs} 件${ex})`)
    if (r.initialMismatch > 0) {
      lines.push(`  ⚠ **初期状態 (tick 0) が ${r.initialMismatch} 座標で食い違っている**。`)
      lines.push('    出発点が違うので先の tick の差分は雪崩れているだけ。まずここを合わせること')
      lines.push('    (動いている機械を撮ると、実機のスナップショットと sim の initialize() の再計算がズレる)')
    }
  }
  if (r.excluded.suppressedDiffs > 0) {
    lines.push(`  除外座標で捨てた差分: ${r.excluded.suppressedDiffs} 件 — ${r.excluded.reason}`)
  }
  for (const w of r.warnings) lines.push(`  警告: ${w}`)

  if (r.first) {
    const more = r.divergentTickCount > r.divergentTicks.length ? ' ...' : ''
    lines.push(`  不一致 tick: ${r.divergentTicks.join(', ')}${more}`)
    lines.push(`  食い違った座標: ${r.divergentPositions.length} 件`
      + ` (最小化: npx tsx tools/mc-harness/runner/minimize.ts <定義.json> --pos ${r.divergentPositions[0] ?? 'x,y,z'})`)
    lines.push(`  最初の食い違い: tick ${r.first.tick}`)
    for (const p of r.first.positions) {
      lines.push(`    ${p.pos}`)
      lines.push(`      実機=${p.mc}`)
      lines.push(`      sim =${p.sim}`)
      lines.push('      周囲 6 方向:')
      for (const n of p.neighbors) {
        const note = [n.outside ? 'region外' : '', n.excluded ? '除外' : ''].filter(Boolean).join(' ')
        lines.push(`        ${DIR_LABEL[n.dir]} ${n.pos}  実機=${n.mc} / sim=${n.sim}${note ? `  (${note})` : ''}`)
      }
    }
    if (r.first.truncated > 0) {
      lines.push(`    (他 ${r.first.truncated} 座標は省略。全件は --json で)`)
    }
  }
  return lines.join('\n')
}

// ── CLI ───────────────────────────────────────────────────────────────────────

const USAGE = '使い方: npx tsx tools/mc-harness/runner/compare.ts <capture.json> [--json <out>]'

function main(argv: string[]): number {
  const jsonIdx = argv.indexOf('--json')
  if (jsonIdx >= 0 && argv[jsonIdx + 1] === undefined) {
    console.error('--json には出力先パスが要る')
    console.error(USAGE)
    return 1
  }
  const jsonOut = jsonIdx >= 0 ? argv[jsonIdx + 1] : undefined
  // --json の次の引数 (出力先) は位置引数に数えない
  const positional = argv.filter((a, i) => !a.startsWith('-') && !(jsonIdx >= 0 && i === jsonIdx + 1))
  if (positional.length !== 1) {
    console.error(USAGE)
    return 1
  }

  let cap: Capture
  try {
    cap = JSON.parse(readFileSync(positional[0], 'utf-8')) as Capture
  } catch (e) {
    console.error(`キャプチャを読めない: ${positional[0]}\n${(e as Error).message}`)
    return 1
  }

  // **2 通りで測る**。どちらが落ちたかで原因の切り分けが変わる:
  //   静的  … 実機の状態を sim が「組み直せる」か (initialize の再現性)
  //   動的  … 実機の状態をそのまま出発点にして、**動きが合う**か
  // 動いている機械 (クロック持ち) は静的が落ちて当たり前なので、
  // 終了コードは**動的**で決める
  let staticReport: CompareReport
  let dynamicReport: CompareReport
  try {
    staticReport = compareCapture(cap)
    dynamicReport = compareCapture(cap, { trustAuthored: true })
  } catch (e) {
    console.error(`突き合わせに失敗: ${(e as Error).message}`)
    return 1
  }
  console.log('── 静的: 実機の状態を sim が組み直せるか ' + '─'.repeat(30))
  console.log(formatReport(staticReport))
  console.log('')
  console.log('── 動的: 実機の状態を出発点にして動きが合うか ' + '─'.repeat(26))
  console.log(formatReport(dynamicReport))
  if (jsonOut) {
    writeFileSync(jsonOut, `${JSON.stringify({ static: staticReport, dynamic: dynamicReport }, null, 2)}\n`)
    console.log(`  レポート: ${jsonOut}`)
  }
  return dynamicReport.ok ? 0 : 1
}

// テストから import しても CLI が走らないようにする (run.ts と違いここは両用)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv.slice(2)))
}
