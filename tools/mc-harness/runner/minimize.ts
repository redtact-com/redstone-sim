// ============================================================
// minimize.ts — 実機と sim の食い違いを「小さな再現」まで自動で縮める
//
//   npx tsx tools/mc-harness/runner/minimize.ts <capture定義.json> --pos x,y,z [--out <fixture名>]
//
// capture (実機で撮る) → compare (sim と突き合わせる) の次の段。
// 6393 ブロックの機械が「どこかで食い違う」と分かっても、そのままでは
// 原因も追えないし fixture にもできない。ここは **対象座標の食い違いを保ったまま
// 回路を削り**、残ったものを packages/sim/test/fixtures/ に書き出す。
// 書き出した fixture は実機由来の期待値を持つので、そのまま CI の回帰になる。
//
// 手順:
//   1. まず定義そのままで撮り、**対象座標が本当に食い違うか**を確かめる
//      (食い違わないなら「再現しない」と言って終わる。ここは飛ばさない)
//   2. 署名 = 「対象座標がどこかの tick で差分に出ること」
//   3. 候補を対象座標からの距離順に並べ、**遠い側から塊で落とす**
//      (落として撮り直し、署名が保たれれば採用・消えれば戻す。塊は半分ずつ縮める)
//   4. 収束したら最後にもう一度撮って fixture を書く
//
// 削り方そのものは delta-debug.ts (純関数) にある。ここはその oracle として
// 「実機キャプチャ + 突き合わせ」を差し込むだけ。
//
// 注意:
//   - **1 回のキャプチャは回路の大きさで数秒〜25 秒**。オラクル呼び出しは候補数に
//     対しておよそ 2n 回なので、エレベーター全体 (6393) をそのまま掛けてはいけない。
//     まず --keep 付きの定義や小さな回路で絞ること (--max-trials で予算も切れる)
//   - rcon の応答バッファはサーバ側で 1 個を共有しているので、全体を
//     withHarnessLock で囲って直列化する
//
// 終了コード:
//   0 … 縮めて fixture を書けた
//   1 … 再現しない / 実行に失敗した
// ============================================================

import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'
import { capture, loadCircuit, type CaptureDef } from './capture.js'
import { compareCapture, captureToFixture, type Capture, type CompareReport } from './compare.js'
import { minimizeSubset } from './delta-debug.js'
import { rcon, withHarnessLock, refreshHarnessLock } from './rcon.js'
import {
  expandExpect, diffStateSeries, runFixtureOnSim, type Fixture,
} from '../../../packages/sim/test/fixture-runner.js'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..', '..', '..')
const fixturesOutDir = join(repoRoot, 'packages', 'sim', 'test', 'fixtures')

// ── 引数 ──────────────────────────────────────────────────────────────────────

export interface MinimizeArgs {
  defPath: string
  /** 対象座標 "x,y,z" (正規化済み) */
  pos: string
  /** 書き出す fixture 名 (未指定なら定義名 + '-min') */
  out?: string
  /**
   * true … 実機の状態を出発点にして「動きが合うか」を見る (compare の動的側)。
   * false … 実機の状態を sim が「組み直せるか」を見る (静的側。--static)。
   * 動いている機械は静的が落ちて当たり前なので既定は動的
   */
  trustAuthored: boolean
  /** オラクル (= 実機キャプチャ) 呼び出しの上限 */
  maxTrials: number
  /** fixture に付ける skipUntil。null なら付けない (--no-skip) */
  skipUntil: string | null
  /** 既存 fixture を置き換えてよいか (--force) */
  force: boolean
}

export const USAGE =
  '使い方: npx tsx tools/mc-harness/runner/minimize.ts <capture定義.json> --pos x,y,z'
  + ' [--out <fixture名>] [--static] [--max-trials N] [--skip-until <issue>] [--no-skip]'

/** 既定の skipUntil。**縮めた結果は必ず食い違う fixture** なので、付けないと CI が赤くなる */
export const DEFAULT_SKIP_UNTIL = 'unresolved'

/** "x, y ,z" → "x,y,z"。壊れていれば例外 */
export function normalizePosKey(raw: string): string {
  const parts = raw.split(',').map(s => Number(s.trim()))
  if (parts.length !== 3 || parts.some(n => !Number.isInteger(n))) {
    throw new Error(`--pos は "x,y,z" (整数) で書くこと: "${raw}"`)
  }
  return parts.join(',')
}

export function parseArgs(argv: readonly string[]): MinimizeArgs {
  const positional: string[] = []
  let pos: string | undefined
  let out: string | undefined
  let trustAuthored = true
  let maxTrials = 400
  let skipUntil: string | null = DEFAULT_SKIP_UNTIL
  let force = false

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const need = (): string => {
      const v = argv[++i]
      if (v === undefined || v.startsWith('--')) throw new Error(`${a} には値が要る`)
      return v
    }
    if (a === '--pos') pos = normalizePosKey(need())
    else if (a === '--out') out = need()
    else if (a === '--static') trustAuthored = false
    else if (a === '--max-trials') {
      maxTrials = Number(need())
      if (!Number.isInteger(maxTrials) || maxTrials < 1) throw new Error('--max-trials は 1 以上の整数')
    } else if (a === '--skip-until') skipUntil = need()
    else if (a === '--no-skip') skipUntil = null
    else if (a === '--force') force = true
    else if (a.startsWith('-')) throw new Error(`知らないオプション: ${a}`)
    else positional.push(a)
  }
  if (positional.length !== 1) throw new Error('capture 定義 JSON を 1 つ渡すこと')
  if (pos === undefined) throw new Error('--pos x,y,z は必須 (どの座標の食い違いを残すか)')
  return { defPath: positional[0], pos, out, trustAuthored, maxTrials, skipUntil, force }
}

/** authored に置けない過渡状態 */
const MOVING_PISTON = /^(minecraft:)?moving_piston(\[|$)/

/** 距離での粗い絞り込みで試す半径 (チェビシェフ距離)。小さい方から試す */
const RADIUS_STEPS = [4, 8, 16, 32, 64]

/** 座標キー同士のチェビシェフ距離 (各軸の差の最大値) */
function chebyshev(a: string, b: string): number {
  const pa = a.split(',').map(Number)
  const pb = b.split(',').map(Number)
  return Math.max(Math.abs(pa[0] - pb[0]), Math.abs(pa[1] - pb[1]), Math.abs(pa[2] - pb[2]))
}

// ── 署名 ──────────────────────────────────────────────────────────────────────

/**
 * 署名: **対象座標がどこかの tick で差分に出ること**。
 *
 * 「不一致がある」ではなく「**その座標**が食い違う」で判定するのが要点。
 * 前者にすると、削った拍子に生えた別の食い違い (region 端の残骸など) を
 * 追いかけて、見たかった食い違いを取り落とす。
 */
export function signatureHolds(report: CompareReport, pos: string): boolean {
  return report.divergentPositions.includes(pos)
}

/**
 * 対象座標が最初に食い違う tick とその値 (説明文用)。
 *
 * compareCapture と違い **moving_piston の除外を掛けない**ので、
 * 署名の判定には使わないこと (ここは fixture の skipReason を書くための材料)。
 */
export function divergenceDetail(
  cap: Capture, pos: string, trustAuthored: boolean,
): { tick: number; mc: string; sim: string } | null {
  const full = captureToFixture(cap, trustAuthored)
  // authored に moving_piston があると mcToSim が throw する (過渡状態は復元不能)。
  // compareCapture は除外しているのにここが素通しで、**縮め終わった直後に全部失う**
  // 事故になっていた (ピストン駆動の回路が主対象なので必ず踏む)
  const fx = {
    ...full,
    blocks: full.blocks.filter(b => !/^(minecraft:)?moving_piston(\[|$)/.test(b.block)),
  }
  const diffs = diffStateSeries(expandExpect(fx), runFixtureOnSim(fx))
  for (const d of diffs) {
    const hit = d.diffs.find(x => x.pos === pos)
    if (hit) return { tick: d.tick, mc: hit.expected, sim: hit.actual }
  }
  return null
}

// ── fixture 書き出し ──────────────────────────────────────────────────────────

export interface BuildFixtureOptions {
  /** fixture 名 (= ファイル名) */
  name: string
  /** 対象座標 */
  pos: string
  trustAuthored: boolean
  /** 元になった capture 定義のパス (説明文用) */
  defPath?: string
  /** null なら skipUntil を付けない */
  skipUntil: string | null
}

/**
 * 縮めたキャプチャを fixture にする。
 *
 * 中身の写しは captureToFixture が正 (二重実装しない)。ここで足すのは
 * 名前・説明・skipUntil だけ。**既定で skipUntil を付ける**のは、
 * 最小化の結果が定義上「まだ sim が再現できていない回路」だからで、
 * 付けずにコミットすると CI が即座に赤くなる (README の既知ギャップ運用と同じ)。
 * sim を直したら skipUntil を外すだけで回帰になる。
 */
export function buildMinimizedFixture(
  cap: Capture, opts: BuildFixtureOptions,
): Fixture {
  const raw = captureToFixture(cap, opts.trustAuthored)
  // **moving_piston は authored に書けない** (運んでいる中身が BE 内にあり復元できない)。
  // 残したまま書き出すと fixture が読み込み時に落ちて、縮めた成果が使えない
  const dropped = raw.blocks.filter(b => MOVING_PISTON.test(b.block)).length
  if (dropped > 0) {
    // **黙って落とすと道具由来の食い違いを生む** (#244)。
    // 伸びかけのピストンを air にすると「伸びたはずのピストンが伸びない」記録になる
    console.warn(`[minimize] **警告**: authored に moving_piston が ${dropped} 個ある。`
      + '動作中に撮ったキャプチャなので、この最小化は実機の再現になっていない可能性が高い')
  }
  const base: Fixture = dropped === 0
    ? raw
    : { ...raw, blocks: raw.blocks.filter(b => !MOVING_PISTON.test(b.block)) }
  const detail = divergenceDetail(cap, opts.pos, opts.trustAuthored)
  const where = detail
    ? `tick ${detail.tick} で 実機=${detail.mc} / sim=${detail.sim}`
    : '差分の詳細は compare.ts で確認すること'
  const skipReason = `対象 ${opts.pos} が ${where}。自動最小化で ${base.blocks.length} ブロックまで縮めた実機記録`

  return {
    name: opts.name,
    description:
      `実機と sim の食い違いを自動最小化した記録 (対象 ${opts.pos})。`
      + `${opts.defPath ? `元定義 ${opts.defPath} / ` : ''}`
      + `${base.blocks.length} ブロックまで削っても食い違いが残ることを実機で確認済み。${where}`
      + `${dropped > 0 ? ` (**過渡状態の moving_piston ${dropped} 個を除いたので、この記録は初期状態が実機と違う**)` : ''}`,
    mcVersion: base.mcVersion,
    ticks: base.ticks,
    ...(opts.skipUntil !== null ? { skipUntil: opts.skipUntil, skipReason } : {}),
    region: base.region,
    ...(base.trustAuthored ? { trustAuthored: true, scheduled: base.scheduled ?? [] } : {}),
    blocks: base.blocks,
    inputs: base.inputs,
    expect: base.expect,
    ...(base.generated ? { generated: base.generated } : {}),
  }
}

// ── 進捗ログ ──────────────────────────────────────────────────────────────────

/** ms → "12.3s" / "2m03s" (AI がループで読むので短く固定幅寄り) */
export function fmtMs(ms: number): string {
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)}s`
  const m = Math.floor(s / 60)
  return `${m}m${String(Math.round(s - m * 60)).padStart(2, '0')}s`
}

const log = (line: string): void => console.log(`[minimize] ${line}`)

// ── 本体 ──────────────────────────────────────────────────────────────────────

/** 対象からの距離 (2 乗) 昇順。同距離はキー順で決定的に */
export function sortByDistance(keys: readonly string[], pos: string): string[] {
  const [px, py, pz] = pos.split(',').map(Number)
  const d2 = (k: string): number => {
    const [x, y, z] = k.split(',').map(Number)
    return (x - px) ** 2 + (y - py) ** 2 + (z - pz) ** 2
  }
  return [...keys].sort((a, b) => d2(a) - d2(b) || (a < b ? -1 : a > b ? 1 : 0))
}

async function run(args: MinimizeArgs): Promise<number> {
  const def = JSON.parse(readFileSync(args.defPath, 'utf-8')) as CaptureDef
  const outName = args.out ?? `${def.name}-min`
  const mode = args.trustAuthored ? '動的 (trustAuthored)' : '静的'
  log(`定義 ${def.name} / 対象 ${args.pos} / モード ${mode} / 予算 ${args.maxTrials} 回`)

  // dump.sc を読み直す (fx_setup の掃除範囲指定が要る)
  const loaded = rcon('script', 'load', 'dump')
  if (!/reloaded|loaded/.test(loaded)) throw new Error(`dump.sc をロードできない: ${loaded}`)

  // 1. 全体を撮って「対象が本当に食い違う」ことを確かめる
  const started = Date.now()
  log('1. 全体を撮って再現を確かめる…')
  const full = await capture(args.defPath)
  const fullReport = compareCapture(full, { trustAuthored: args.trustAuthored })
  const fullBlocks = Object.keys(full.authored).length
  if (!signatureHolds(fullReport, args.pos)) {
    log(`   再現しない: ${fullBlocks} ブロックを撮ったが ${args.pos} は 1 度も食い違わなかった`
      + ` [${fmtMs(Date.now() - started)}]`)
    log(`   不一致 tick ${fullReport.divergentTickCount} / 食い違い座標 ${fullReport.divergentPositions.length}`)
    if (fullReport.divergentPositions.length > 0) {
      log(`   食い違ったのはこちら: ${fullReport.divergentPositions.slice(0, 12).join(' ')}`)
      log('   --pos をこの中から選び直すこと')
    } else {
      log('   sim と完全に一致している。--static / --pos / 定義の inputs を見直すこと')
    }
    return 1
  }
  log(`   ${fullBlocks} ブロック: 不一致 tick ${fullReport.divergentTickCount}`
    + ` / 食い違い座標 ${fullReport.divergentPositions.length} → ${args.pos} は食い違う (再現あり)`
    + ` [${fmtMs(Date.now() - started)}]`)

  // 2. 候補を並べる。**対象座標と入力の当たり先は絶対に落とさない**
  //    (落とすと入力が空振りして「署名が消えた」と誤判定する)
  const circuit = await loadCircuit(def)
  const forced = [...new Set([args.pos, ...(def.inputs ?? []).map(i => i.pos.join(','))])]
  const candidates = sortByDistance(
    circuit.blocks.map(b => b.pos.join(',')).filter(k => !forced.includes(k)), args.pos)
  log(`2. 候補 ${candidates.length} ブロック (強制保持 ${forced.length}: ${forced.join(' ')})`)

  // 3. delta debugging。oracle = 一部だけ置いて撮り直し、署名が残るか
  const tmpDir = mkdtempSync(join(tmpdir(), 'mc-minimize-'))
  const trialDefPath = join(tmpDir, 'trial.def.json')
  const trialName = `${def.name}-min`
  let lastGood: Capture = full
  try {
    let failStreak = 0
    const runTrial = async (keep: readonly string[]): Promise<boolean> => {
      // **ロックの取得時刻を更新する**。最小化は長時間走るので、更新しないと
      // 10 分で残骸とみなされて奪われ、他プロセスと並行して同じサーバを叩く
      refreshHarnessLock()
      writeFileSync(trialDefPath, JSON.stringify({ ...def, name: trialName, keep }))
      try {
        const cap = await capture(trialDefPath, { quiet: true })
        const report = compareCapture(cap, { trustAuthored: args.trustAuthored })
        const held = signatureHolds(report, args.pos)
        if (held) lastGood = cap
        failStreak = 0
        return held
      } catch (e) {
        // 削った結果 sim が組み立てられない状態になることがある (型不一致など)。
        // **署名が消えた扱い**にして戻す。落とさないほうが安全側
        log(`   ! 試行が失敗したので戻す: ${(e as Error).message.split('\n')[0]}`)
        // **連続で失敗し続けるならサーバ側の異常**。予算を使い切るまで
        // タイムアウトを踏み続けると何時間も占有するので打ち切る
        if (++failStreak >= 5) {
          throw new Error('試行が 5 回連続で失敗した。サーバが落ちているか固まっている可能性がある')
        }
        return false
      }
    }

    // 2b. **まず距離で粗く絞る** (#240)。
    //
    // 遠い側から 1 塊ずつ削る delta debugging は、6393 ブロックのような大物だと
    // 収束が遅い (実測: 100 試行 15 分で 2500 → 2392 までしか縮まなかった)。
    // 先に「対象からチェビシェフ距離 R 以内」だけを残して署名が保たれる R を
    // **倍々で探す**と、log 回のキャプチャで候補が桁で減る。
    // 保たれる R が見つからなければ全体のまま delta debugging に進む (損はしない)
    let narrowed = candidates
    for (const r of RADIUS_STEPS) {
      const within = candidates.filter(k => chebyshev(k, args.pos) <= r)
      if (within.length === 0 || within.length === candidates.length) continue
      const t0 = Date.now()
      const held = await runTrial([...forced, ...within])
      log(`   半径 ${r}: ${forced.length + within.length} ブロック → `
        + `${held ? '署名あり → ここから縮める' : '署名が消えた → もっと広く'}`
        + ` [${fmtMs(Date.now() - t0)}]`)
      if (held) { narrowed = within; break }
    }
    log(`   遠い側から塊で落とす (候補 ${narrowed.length})`)

    const result = await minimizeSubset<string>({
      candidates: narrowed,
      maxTrials: args.maxTrials,
      oracle: subset => runTrial([...forced, ...subset]),
      onTrial: t => log(
        `   k=${t.chunkSize} #${t.index} ${t.dropped.length} 個落とす`
        + ` → 残り ${forced.length + t.remaining} ブロック:`
        + ` ${t.held ? '署名あり → 採用' : '署名が消えた → 戻す'}`
        + ` [${fmtMs(t.ms)} / 累計 ${fmtMs(Date.now() - started)}]`),
      onPass: p => log(
        `   -- k=${p.chunkSize} のパス終了: ${forced.length + p.before} → ${forced.length + p.after} ブロック`
        + ` (試行 ${p.trials}, ${fmtMs(p.ms)})`),
    })
    const keptTotal = forced.length + result.kept.length
    log(`3. ${result.stoppedBy === 'converged' ? '収束' : '予算切れ (--max-trials)'}:`
      + ` ${keptTotal} ブロック (試行 ${result.trials} / ${fmtMs(Date.now() - started)})`)

    // 4. 最後にもう一度撮る。**直前の試行は却下されたものかもしれない**ので、
    //    実機の中身と書き出す fixture を必ず一致させる
    log('4. 最終確認キャプチャ…')
    const finalKeep = [...forced, ...result.kept]
    if (!await runTrial(finalKeep)) {
      log('   最終確認で署名が消えた (実機が非決定的か、残骸が効いている)。fixture は書かない')
      return 1
    }
    const finalReport = compareCapture(lastGood, { trustAuthored: args.trustAuthored })
    const detail = divergenceDetail(lastGood, args.pos, args.trustAuthored)
    log(`   OK: ${Object.keys(lastGood.authored).length} ブロック / 不一致 tick ${finalReport.divergentTickCount}`
      + (detail ? ` / ${args.pos} は tick ${detail.tick} で 実機=${detail.mc} sim=${detail.sim}` : ''))

    // 5. fixture として書き出す
    const fixture = buildMinimizedFixture(lastGood, {
      name: outName, pos: args.pos, trustAuthored: args.trustAuthored,
      defPath: args.defPath, skipUntil: args.skipUntil,
    })
    mkdirSync(fixturesOutDir, { recursive: true })
    const outPath = join(fixturesOutDir, `${outName}.json`)
    // **既存 fixture を黙って潰さない**。実機検証済みの ground truth を
    // skipUntil 付きの「わざと食い違う」ものに置き換えると、回帰が 1 本静かに消える
    if (existsSync(outPath) && !args.force) {
      throw new Error(
        `既に fixture がある: ${outPath}\n`
        + '別の名前を --out で指定するか、本当に置き換えるなら --force を付けること')
    }
    writeFileSync(outPath, JSON.stringify(fixture, null, 2) + '\n')
    log(`5. fixture: ${outPath}`)
    log(`   照合: npx tsx tools/mc-harness/runner/run.ts ${outName}`)
    if (args.skipUntil !== null) {
      log(`   skipUntil=${args.skipUntil} を付けてある (CI では skip される)。`
        + 'issue 番号に書き換え、sim を直したら外すこと')
    }
    return 0
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
}

async function main(argv: string[]): Promise<number> {
  let args: MinimizeArgs
  try {
    args = parseArgs(argv)
  } catch (e) {
    console.error((e as Error).message)
    console.error(USAGE)
    return 1
  }
  try {
    return await withHarnessLock(() => run(args))
  } catch (e) {
    console.error(e instanceof Error ? e.message : e)
    return 1
  }
}

// テストから import しても CLI が走らないようにする
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(code => process.exit(code))
}
