// ============================================================
// rcon 基盤モジュール (実機 Minecraft への口)
//
// generate.ts / 今後のキャプチャスクリプトが共有する rcon の低レベル層。
// 前提は generate.ts と同じ (tools/mc-harness で `docker compose up -d` 済み)。
//
// ここに集めてあるのは「知らないと必ず踏む」3 つの落とし穴:
//
//   1. コマンド長 1014 文字の壁
//      itzg の rcon-cli (gorcon) は MaxCommandLen までしか送らない。実測で
//      1014 文字までは通り、**1015 文字以上はエラーも出さず無言でハングする**。
//      戻ってこないので原因究明に時間が溶ける。投げる前に落とすのが正しい。
//   2. 応答バッファはサーバ側で 1 個を共有している
//      [確定: 26.2 DedicatedServer.java:714-718 の RconConsoleSource]。
//      並行して叩くと**別セッションの応答が混線する** (実際に調査中に混入した)。
//      キャプチャ全体を withHarnessLock() で囲って直列化すること。
//   3. バッチは速いが tick を混ぜられない
//      rconBatch() の doc コメント参照。
// ============================================================

import { execFileSync } from 'node:child_process'
import { existsSync, openSync, closeSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const harnessDir = join(dirname(fileURLToPath(import.meta.url)), '..')

// WSL2 + compose v2.22 / docker 29 の API バージョン不整合回避 (README 参照)
const env = { ...process.env, DOCKER_API_VERSION: process.env.DOCKER_API_VERSION ?? '1.44' }

/**
 * rcon-cli (gorcon) が送れるコマンド長の上限。
 * 実測: 1014 文字は通り、1015 文字は応答が返らず固まる (MaxCommandLen)。
 * fill / setblock に長い blockstate や NBT を渡すと現実的に超える。
 */
export const MAX_COMMAND_LEN = 1014

/** キャプチャ直列化用のロックファイル (ハーネス直下) */
export const LOCK_PATH = join(harnessDir, '.lock')

/** これより古いロックは「プロセスが落ちた残骸」とみなして奪う */
export const LOCK_STALE_MS = 10 * 60 * 1000

/** docker exec が無応答になったときに諦めるまで (ハングを例外に変える) */
export const EXEC_TIMEOUT_MS = 60_000

/** scarpet の応答が大きいことがあるので既定 (1MB) より広げる */
export const EXEC_MAX_BUFFER = 32 * 1024 * 1024

/** 待つ。tick step の後にサーバがその tick を処理し終えるのを待つのに使う */
export const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms))

/**
 * 1014 **バイト**ガード。投げる前に落とす (投げてしまうと無言でハングするため)。
 *
 * gorcon (itzg の rcon-cli) の MaxCommandLen は Go の `len(string)` = **バイト長**なので、
 * 文字数で測ると日本語や絵文字を含むコマンドがガードをすり抜ける
 * (`'あ'.repeat(500)` は 500 文字だが 1500 バイト)。
 */
function assertCommandLen(cmd: string): void {
  const bytes = Buffer.byteLength(cmd, 'utf8')
  if (cmd.includes('\n')) {
    throw new Error(`rcon コマンドに改行を含めてはいけない (行単位で分割されて別コマンドになる): ${cmd.slice(0, 80)}`)
  }
  if (bytes > MAX_COMMAND_LEN) {
    throw new Error(
      `rcon コマンドが長すぎる (${bytes} バイト > ${MAX_COMMAND_LEN})。`
      + `rcon-cli は ${MAX_COMMAND_LEN} 文字超を無言で握り潰してハングする。`
      + `分割して送ること: ${cmd.slice(0, 120)}...`,
    )
  }
}

/**
 * rcon を 1 コマンド発行して応答文字列を返す。
 * 引数は空白区切りで連結されるので、空白を含む要素 (blockstate 等) は 1 要素で渡す。
 */
export function rcon(...args: string[]): string {
  const cmd = args.join(' ')
  assertCommandLen(cmd)
  const out = execFileSync(
    'docker',
    ['compose', 'exec', '-T', 'mc', 'rcon-cli', '--', ...args],
    { cwd: harnessDir, env, encoding: 'utf-8', timeout: EXEC_TIMEOUT_MS, maxBuffer: EXEC_MAX_BUFFER },
  )
  if (process.env.GT_DEBUG) console.log(`[rcon] ${cmd} => ${out.trim()}`)
  return out.trim()
}

/**
 * 複数コマンドを **1 回の docker exec** で流す (stdin 経由)。
 * 実測: 40 コマンドで合計 155ms。1 コマンドずつだと 186ms/回 なので約 48 倍速い
 * (遅さの正体は rcon ではなく docker exec のプロセス起動コスト)。
 *
 * **tick を進めるコマンド (`tick step` / `tick sprint` / `tick unfreeze`) を混ぜてはいけない。**
 * バッチは同一サーバティック内でまとめて処理されるため、
 * 「step → 入力 → step」のつもりで並べても入力が全部同じティックに載り、
 * 意図した順序で記録できない。tick 境界をまたぐ列は rcon() で 1 本ずつ発行すること。
 * バッチの用途は setblock / fill / gamerule / kill のような**同一ティック内で完結する準備**。
 *
 * 戻り値は応答の行配列 (コマンドと同じ並び)。
 * `script run` のような**複数行応答のコマンドも混ぜない**こと (行と要素の対応がずれる。
 * ずれた場合は警告を出すが、対応付けは呼び出し側で保証すること)。
 */
export function rconBatch(cmds: string[]): string[] {
  if (cmds.length === 0) return []
  for (const c of cmds) assertCommandLen(c)
  const input = cmds.join('\n') + '\n'
  const out = execFileSync(
    'docker',
    ['compose', 'exec', '-T', 'mc', 'rcon-cli'],
    { cwd: harnessDir, env, encoding: 'utf-8', input },
  )
  // 末尾の終端改行だけを落とす (応答が空のコマンドは空行として並ぶので、
  // 空行を一括で捨てると以降の対応がずれる)
  const body = out.endsWith('\n') ? out.slice(0, -1) : out
  const lines = body === '' ? [] : body.split('\n').map(l => l.trim())
  if (lines.length !== cmds.length) {
    console.warn(
      `[rconBatch] 応答行数がコマンド数と一致しない (cmds=${cmds.length} lines=${lines.length})。`
      + '複数行応答のコマンドが混ざっている可能性がある',
    )
  }
  if (process.env.GT_DEBUG) {
    for (let i = 0; i < cmds.length; i++) console.log(`[rcon] ${cmds[i]} => ${lines[i] ?? ''}`)
  }
  return lines
}

/** scarpet 関数呼び出し。error/failed/exception を含む応答はエラー扱い (generate.ts と同判定) */
export function scarpet(expr: string): string {
  const out = rcon('script', 'in', 'dump', 'run', expr)
  if (/error|failed|exception/i.test(out)) {
    throw new Error(`scarpet 実行エラー: ${expr}\n${out}`)
  }
  return out
}

interface LockInfo {
  pid: number
  /** 取得時刻 (epoch ms) */
  at: number
}

/** ロックファイルの中身。壊れている / 読めない場合は null (= 奪ってよい残骸扱い) */
function readLockInfo(lockPath: string): LockInfo | null {
  try {
    const info = JSON.parse(readFileSync(lockPath, 'utf-8')) as Partial<LockInfo>
    if (typeof info.pid !== 'number' || typeof info.at !== 'number') return null
    return { pid: info.pid, at: info.at }
  } catch {
    return null
  }
}

/** 'wx' で排他生成。既にあれば null (EEXIST 以外は握り潰さず投げる) */
function tryCreate(lockPath: string): number | null {
  try {
    return openSync(lockPath, 'wx')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EEXIST') return null
    throw e
  }
}

function writeLockInfo(fd: number): void {
  const info: LockInfo = { pid: process.pid, at: Date.now() }
  writeFileSync(fd, JSON.stringify({ ...info, iso: new Date(info.at).toISOString() }))
  closeSync(fd)
}

function acquireLock(lockPath: string): void {
  const fd = tryCreate(lockPath)
  if (fd !== null) {
    writeLockInfo(fd)
    return
  }
  // 既に誰かが握っている。中身を見て「生きているロック」か「残骸」かを決める
  if (existsSync(lockPath)) {
    const info = readLockInfo(lockPath)
    const ageMs = info === null ? Number.POSITIVE_INFINITY : Date.now() - info.at
    if (ageMs <= LOCK_STALE_MS) {
      throw new Error(
        `別のキャプチャが実行中 (pid=${info?.pid ?? '不明'}, 経過 ${Math.round(ageMs / 1000)}s): ${lockPath}\n`
        + 'rcon の応答バッファはサーバ側で 1 個を共有しているため並行実行すると応答が混線する。'
        + '終わるのを待つか、プロセスが死んでいるならこのファイルを削除すること',
      )
    }
    // 10 分以上古い = プロセスが落ちて finally を通れなかった残骸なので奪う
    try {
      unlinkSync(lockPath)
    } catch { /* 同時に他が消しただけなので無視 */ }
  }
  // 直前に解放された / 残骸を消した後の取り直し
  const retry = tryCreate(lockPath)
  if (retry === null) {
    throw new Error(`ロックを取得できない (取り直しの直前に横取りされた): ${lockPath}`)
  }
  writeLockInfo(retry)
}

/**
 * ハーネスのロックを取って fn を実行する (キャプチャ全体を直列化する)。
 *
 * rcon の応答バッファはサーバ側で **1 個を共有** している
 * [確定: 26.2 DedicatedServer.java:714-718 が RconConsoleSource を 1 個だけ持つ]。
 * 並行して叩くと応答が混線し、他セッションの出力を自分の応答として読んでしまう
 * (実際に調査中に別セッションの応答が混入した)。
 *
 * ロックファイルには pid と取得時刻を書き、**10 分以上古いロックは奪う**
 * (プロセスが落ちて finally を通れなかった場合の復旧)。
 *
 * @param lockPath テスト用の差し替え口。通常は既定 (LOCK_PATH) のまま使う
 */
export async function withHarnessLock<T>(
  fn: () => T | Promise<T>, lockPath: string = LOCK_PATH,
): Promise<T> {
  acquireLock(lockPath)
  const mine = process.pid
  try {
    // **await する**。同期版だと async fn が Promise を返した瞬間に finally が走り、
    // rcon を 1 本も撃たないうちにロックが外れる (直列化の意味が消える)
    return await fn()
  } finally {
    releaseLock(lockPath, mine)
  }
}

/**
 * ロックの取得時刻を更新する (ハートビート)。
 *
 * **長時間の作業では必須**。最小化は 6393 ブロックだと数十分〜数時間走るが、
 * 取得時刻を更新しないと 10 分で「残骸」とみなされて他プロセスに奪われ、
 * 同じサーバを 2 本が並行して叩く = rcon の応答が混線して**黙って壊れた ground truth** が出る。
 */
export function refreshHarnessLock(lockPath: string = LOCK_PATH): void {
  try {
    const info = readLockInfo(lockPath)
    if (info !== null && info.pid !== process.pid) return   // 既に奪われている
    writeFileSync(lockPath, JSON.stringify({ pid: process.pid, at: Date.now(), iso: new Date().toISOString() }))
  } catch { /* 消えていたら何もしない */ }
}

/**
 * 自分が握っているロックだけを消す。
 *
 * 無条件に unlink すると、**残骸とみなして奪われた側**が抜けるときに
 * 「奪った側のロック」を消してしまい、3 本目が同時に走れてしまう
 * (= このロックが唯一防ごうとしている応答混線がそのまま起きる)。
 */
function releaseLock(lockPath: string, pid: number): void {
  try {
    const info = readLockInfo(lockPath)
    if (info !== null && info.pid !== pid) return   // 既に他人のロックになっている
    unlinkSync(lockPath)
  } catch { /* 既に無いなら何もしなくてよい */ }
}
