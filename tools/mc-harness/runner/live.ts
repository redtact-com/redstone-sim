// ============================================================
// 実機のライブ観測 + 操作 (#366)
//
// 前提: tools/mc-harness で `docker compose up -d` 済み。
// 使い方: npm run live -- <fixture名> [--port 8787] [--no-hidden]
//
// 既存の generate.ts / capture.ts は**一発実行**で、走り終わるとロックを返す。
// こちらは**実機を保持して命令を待つ**。ブラウザ (?live=1) が WebSocket で
// つながり、step / use / setblock を投げ、実機の差分を受け取る。
//
// sim は**ブラウザ側で回す**。ここから送るのは実機の状態だけで、
// 突き合わせは fixture-driver (CI と同じ関数) に任せる。
// サーバ側で sim を回すとドライバが 2 本になり、
// 「ライブでは合うのに CI で落ちる」が起きうるため。
// ============================================================

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocketServer, type WebSocket } from 'ws'
import { parseMcState } from '@redstone/sim'
import {
  rcon, scarpet, reloadDumpApp, withHarnessLock, refreshHarnessLock, sleep,
} from './rcon.js'
import { emitAttachedSupportUpdate } from './capture.js'
import { ensureWorldSetup } from './world-setup.js'
import { readScheduledTicks, readComparatorOutputs, readHopperCooldowns } from './scheduled-ticks.js'
import type {
  BlockMap, ClientMsg, LiveChange, LiveHiddenState, LiveSessionInfo, ServerMsg,
} from './live-protocol.js'
import { LIVE_PORT } from './live-protocol.js'

const harnessDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const fixturesDefDir = join(harnessDir, 'fixtures')
const sharedDir = join(harnessDir, 'scripts', 'shared')
const worldDir = join(harnessDir, 'data', 'world')

const PLAYER_NAME = 'GT'
/** 実機の応答を待つ余裕。generate.ts の tick step 後と同じ */
const STEP_SETTLE_MS = 120

// ─── 純粋な部分 (テストから呼ぶ) ─────────────────────────────────

/**
 * 2 つの状態マップの差分。**消滅は `'air'`** で表す
 * (fixture の expect と同じ規約。`packages/sim/test/fixture-runner.ts` の diff と揃える)
 */
export function diffBlockMaps(prev: BlockMap, cur: BlockMap): LiveChange[] {
  const keys = new Set([...Object.keys(prev), ...Object.keys(cur)])
  const out: LiveChange[] = []
  for (const k of [...keys].sort()) {
    const p = prev[k] ?? 'air'
    const c = cur[k] ?? 'air'
    if (p === c) continue
    const pos = k.split(',').map(Number) as [number, number, number]
    out.push({ pos, block: c })
  }
  return out
}

/**
 * `use` の狙点。**Y の小数部が全入力で共有される** (README の落とし穴)。
 * 床レバーは .35 / 床ボタンは .06 のように種類で変わるので、
 * fixture の `player.lookAt` に書かれた小数部をそのまま使う。
 */
export function lookTarget(
  pos: [number, number, number], lookY: number,
): [string, string, string] {
  return [String(pos[0] + 0.5), String(pos[1] + lookY), String(pos[2] + 0.5)]
}

/** 受け取ったメッセージが扱える形か。壊れた JSON でセッションを落とさない */
export function parseClientMsg(raw: string): ClientMsg | null {
  let v: unknown
  try { v = JSON.parse(raw) } catch { return null }
  if (typeof v !== 'object' || v === null) return null
  const m = v as Record<string, unknown>
  if (typeof m.type !== 'string' || typeof m.id !== 'number') return null
  const isPos = (p: unknown): p is [number, number, number] =>
    Array.isArray(p) && p.length === 3 && p.every(n => typeof n === 'number')
  switch (m.type) {
    case 'step':
      return typeof m.n === 'number' && m.n >= 1 && m.n <= 64
        ? { type: 'step', id: m.id, n: Math.floor(m.n) } : null
    case 'use':
      return isPos(m.pos) ? { type: 'use', id: m.id, pos: m.pos } : null
    case 'setblock':
      return isPos(m.pos) && typeof m.block === 'string'
        ? { type: 'setblock', id: m.id, pos: m.pos, block: m.block } : null
    case 'inspect':
      return isPos(m.pos) ? { type: 'inspect', id: m.id, pos: m.pos } : null
    case 'reset':
      return { type: 'reset', id: m.id }
    default:
      return null
  }
}

// ─── 実機とのやりとり ────────────────────────────────────────────

interface LiveDef {
  name: string
  region: { from: number[]; to: number[] }
  blocks: { pos: number[]; block: string; items?: unknown }[]
  player?: { spawn: number[]; facing: number[]; lookAt: number[] }
}

function readCarpetVersion(): string {
  try {
    const out = execFileSync(
      'docker', ['compose', 'exec', '-T', 'mc', 'ls', '/data/mods'],
      { cwd: harnessDir, env: { ...process.env, DOCKER_API_VERSION: '1.44' }, encoding: 'utf-8' },
    )
    const jar = out.split('\n').find(l => /carpet.*\.jar/i.test(l))
    return jar?.replace(/\.jar$/, '').replace(/^fabric-carpet-|^carpet-/, '') ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

/** いまの region を実機から読む。dump.sc が shared/live.json に書いたものを回収する */
function scanRegion(): BlockMap {
  scarpet('fx_live_save()')
  const path = join(sharedDir, 'live.json')
  if (!existsSync(path)) throw new Error(`live.json が無い: ${path}`)
  const json = JSON.parse(readFileSync(path, 'utf-8')) as { blocks: BlockMap }
  return json.blocks ?? {}
}

/** 回路を置き直して落ち着かせる。掃除 → 空回し → 設置 の順は capture.ts と同じ理由 (#240) */
async function setupCircuit(def: LiveDef): Promise<void> {
  mkdirSync(sharedDir, { recursive: true })
  const scBlocks = def.blocks.map(b => {
    const { name, props } = parseMcState(b.block)
    return { pos: b.pos, name, props }
  })
  writeFileSync(
    join(sharedDir, 'fixture.json'),
    JSON.stringify({ region: def.region, blocks: scBlocks }),
  )

  // 残骸掃除は unfreeze 区間で行う (freeze 中は player kill/spawn が保留される)
  rcon('tick', 'unfreeze')
  rcon('player', PLAYER_NAME, 'kill')
  rcon('kill', '@e[type=!player]')
  await sleep(400)
  rcon('tick', 'freeze')

  // 前回の予約 tick を枯らしてから置く (#240)
  scarpet('fx_clear()')
  rcon('tick', 'step', '60')
  await sleep(600)
  scarpet('fx_setup()')
  scarpet('fx_settle()')
  rcon('tick', 'step', '8')
  await sleep(600)

  // fake player を出す (use 入力に要る)。spawn は unfreeze 区間でしか完了しない
  if (def.player) {
    const [sx, sy, sz] = def.player.spawn
    const [yaw, pitch] = def.player.facing
    rcon('tick', 'unfreeze')
    rcon('player', PLAYER_NAME, 'spawn', 'at', String(sx), String(sy), String(sz),
      'facing', String(yaw), String(pitch), 'in', 'minecraft:overworld', 'in', 'survival')
    await sleep(800)
    rcon('tick', 'freeze')
  }
}

/**
 * blockstate に出ない 3 値を保存ファイルから読む。
 *
 * **sim の出発点をそろえるのに要る** (予約 tick・コンパレーターの保持出力・
 * ホッパーのクールダウン)。`/save-all flush` の後でないと古い値を読む。
 */
function readHidden(def: LiveDef): LiveHiddenState | null {
  try {
    rcon('save-all', 'flush')
    const from = def.region.from as [number, number, number]
    const to = def.region.to as [number, number, number]
    return {
      scheduled: readScheduledTicks(worldDir, from, to).map(e => ({
        pos: e.pos, block: e.block, delay: e.delay, priority: e.priority,
      })),
      comparators: readComparatorOutputs(worldDir, from, to).map(e => ({
        pos: e.pos, output: e.output,
      })),
      cooldowns: readHopperCooldowns(worldDir, from, to).map(e => ({
        pos: e.pos, cooldown: e.cooldown,
      })),
    }
  } catch (e) {
    console.warn(`[live] 隠れ状態を読めなかった (sim の出発点がずれる可能性がある): ${
      e instanceof Error ? e.message : e}`)
    return null
  }
}

// ─── セッション ──────────────────────────────────────────────────

async function serve(name: string, port: number, withHidden: boolean): Promise<void> {
  const defPath = join(fixturesDefDir, `${name}.json`)
  if (!existsSync(defPath)) throw new Error(`fixture 定義が無い: ${defPath}`)
  const def = JSON.parse(readFileSync(defPath, 'utf-8')) as LiveDef

  console.log(`=== ライブ: ${name} ===`)
  ensureWorldSetup()
  reloadDumpApp()   // dump.sc を読み直す (script load だけでは読み直さない)
  await setupCircuit(def)

  let tick = 0
  let prev = scanRegion()
  let hidden = withHidden ? readHidden(def) : null

  const lookY = def.player ? def.player.lookAt[1] - Math.floor(def.player.lookAt[1]) : 0.5
  const session: LiveSessionInfo = {
    name,
    mcVersion: '1.21.1',
    carpet: readCarpetVersion(),
    region: {
      from: def.region.from as [number, number, number],
      to: def.region.to as [number, number, number],
    },
    lookY,
  }

  const wss = new WebSocketServer({ host: '127.0.0.1', port })

  /**
   * 待ち受けに失敗したら**必ず例外にする**。
   *
   * `WebSocketServer` の 'error' を拾わないと Node が未捕捉例外でプロセスを落とし、
   * `withHarnessLock` の finally を通らないので**ロックが残る** (実際に踏んだ)。
   * 残ると次の実行が 10 分間ブロックされる。
   */
  const listening = new Promise<void>((resolve, reject) => {
    wss.once('listening', () => resolve())
    wss.once('error', (e: NodeJS.ErrnoException) => {
      reject(e.code === 'EADDRINUSE'
        ? new Error(`ポート ${port} は使用中。--port で別の番号を指定してください`)
        : e)
    })
  })
  await listening
  const clients = new Set<WebSocket>()
  const send = (ws: WebSocket, msg: ServerMsg): void => ws.send(JSON.stringify(msg))
  const broadcast = (msg: ServerMsg): void => {
    for (const ws of clients) send(ws, msg)
  }

  /** 実機を読み直して差分を配る。命令 1 つにつき 1 回 */
  const publish = (cause: string): void => {
    const cur = scanRegion()
    const changes = diffBlockMaps(prev, cur)
    prev = cur
    broadcast({ type: 'frame', tick, changes, cause })
  }

  // 実機を掴んでいるあいだロックを手放さない (奪われると応答が混線する)
  const heartbeat = setInterval(() => refreshHarnessLock(), 60_000)

  wss.on('connection', ws => {
    clients.add(ws)
    console.log(`[live] 接続 (${clients.size} 本)`)
    send(ws, { type: 'hello', session, tick, authored: prev, hidden })

    ws.on('message', async raw => {
      const msg = parseClientMsg(String(raw))
      if (msg === null) {
        send(ws, { type: 'error', id: null, message: '解釈できない命令' })
        return
      }
      try {
        switch (msg.type) {
          case 'step': {
            for (let i = 0; i < msg.n; i++) {
              rcon('tick', 'step', '1')
              await sleep(STEP_SETTLE_MS)
              tick++
            }
            publish(`step ${msg.n}`)
            break
          }
          case 'use': {
            const [lx, ly, lz] = lookTarget(msg.pos, lookY)
            rcon('player', PLAYER_NAME, 'look', 'at', lx, ly, lz)
            await sleep(200)
            rcon('player', PLAYER_NAME, 'use', 'once')
            await sleep(200)
            publish(`use ${msg.pos.join(',')}`)
            break
          }
          case 'setblock': {
            rcon('setblock', String(msg.pos[0]), String(msg.pos[1]), String(msg.pos[2]), msg.block)
            // レバー/ボタンは**支えブロックの隣**にも更新を配る (#290)。
            // 落とすと「ON にしたのに動かない」実機状態ができる
            emitAttachedSupportUpdate(msg.pos, msg.block)
            await sleep(200)
            publish(`setblock ${msg.pos.join(',')}`)
            break
          }
          case 'inspect': {
            const key = msg.pos.join(',')
            send(ws, { type: 'state', pos: msg.pos, block: prev[key] ?? 'air' })
            break
          }
          case 'reset': {
            await setupCircuit(def)
            tick = 0
            prev = scanRegion()
            hidden = withHidden ? readHidden(def) : null
            broadcast({ type: 'hello', session, tick, authored: prev, hidden })
            break
          }
        }
        send(ws, { type: 'ack', id: msg.id })
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        console.error(`[live] ${message}`)
        send(ws, { type: 'error', id: msg.id, message })
      }
    })

    ws.on('close', () => {
      clients.delete(ws)
      console.log(`[live] 切断 (${clients.size} 本)`)
    })
  })

  console.log(`[live] ws://127.0.0.1:${port} で待機中`)
  console.log(`[live] ブラウザ: npm run dev のうえで http://localhost:5173/?live=1`)
  console.log('[live] Ctrl-C で終了 (ロックを返します)')

  await new Promise<void>((resolve, reject) => {
    const stop = (): void => {
      clearInterval(heartbeat)
      wss.close(() => resolve())
    }
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
    // 走り出したあとの異常も拾う (拾わないとロックが残る)
    wss.on('error', e => {
      clearInterval(heartbeat)
      reject(e)
    })
  })
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const name = args.find(a => !a.startsWith('-'))
  if (name === undefined) {
    console.error('使い方: npm run live -- <fixture名> [--port 8787] [--no-hidden]')
    process.exit(1)
  }
  const portArg = args.find(a => a.startsWith('--port'))
  const port = portArg ? Number(portArg.split('=')[1] ?? args[args.indexOf(portArg) + 1]) : LIVE_PORT
  const withHidden = !args.includes('--no-hidden')
  await withHarnessLock(() => serve(name, port, withHidden))
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(e => {
    console.error(e instanceof Error ? e.message : e)
    process.exit(1)
  })
}
