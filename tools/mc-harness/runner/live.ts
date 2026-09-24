// ============================================================
// 実機のライブ観測 + 操作 (#366)
//
// 前提: tools/mc-harness で `docker compose up -d` 済み。
// 使い方: npm run live -- <fixture名> [--port 8791] [--no-hidden]
//         npm run live -- --def <キャプチャ定義名>   … 実回路 (#372)
//
// 既存の generate.ts / capture.ts は**一発実行**で、走り終わるとロックを返す。
// こちらは**実機を保持して命令を待つ**。ブラウザ (?live=1) が WebSocket で
// つながり、step / use / setblock を投げ、実機の差分を受け取る。
//
// 実機を触る部分は `live-session.ts` に切り出してある (#369 で MCP と共有)。
// ここは**それを WebSocket に流すだけ**。
//
// sim は**ブラウザ側で回す**。ここから送るのは実機の状態だけで、
// 突き合わせは fixture-driver (CI と同じ関数) に任せる。
// ============================================================

import { WebSocketServer, type WebSocket } from 'ws'
import { withHarnessLock, refreshHarnessLock } from './rcon.js'
import { HarnessSession } from './live-session.js'
import type { ClientMsg, LiveChange, ServerMsg } from './live-protocol.js'
import { LIVE_PORT } from './live-protocol.js'

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

// ─── セッション ──────────────────────────────────────────────────

async function serve(
  name: string, port: number, withHidden: boolean, kind: 'fixture' | 'capture',
): Promise<void> {
  console.log(`=== ライブ: ${name} (${kind === 'capture' ? '実回路' : 'fixture'}) ===`)
  const session = await HarnessSession.open(name, { withHidden, kind })

  const wss = new WebSocketServer({ host: '127.0.0.1', port })

  /**
   * 待ち受けに失敗したら**必ず例外にする**。
   *
   * `WebSocketServer` の 'error' を拾わないと Node が未捕捉例外でプロセスを落とし、
   * `withHarnessLock` の finally を通らないので**ロックが残る** (実際に踏んだ)。
   * 残ると次の実行が 10 分間ブロックされる。
   */
  await new Promise<void>((resolve, reject) => {
    wss.once('listening', () => resolve())
    wss.once('error', (e: NodeJS.ErrnoException) => {
      reject(e.code === 'EADDRINUSE'
        ? new Error(`ポート ${port} は使用中。--port で別の番号を指定してください`)
        : e)
    })
  })

  const clients = new Set<WebSocket>()
  const send = (ws: WebSocket, msg: ServerMsg): void => ws.send(JSON.stringify(msg))
  const broadcast = (msg: ServerMsg): void => {
    for (const ws of clients) send(ws, msg)
  }
  const hello = (): ServerMsg => ({
    type: 'hello',
    session: session.info,
    tick: session.tick,
    authored: session.state(),
    hidden: session.hidden(),
  })

  // 実機を掴んでいるあいだロックを手放さない (奪われると応答が混線する)
  const heartbeat = setInterval(() => refreshHarnessLock(), 60_000)

  wss.on('connection', ws => {
    clients.add(ws)
    console.log(`[live] 接続 (${clients.size} 本)`)
    send(ws, hello())

    ws.on('message', async raw => {
      const msg = parseClientMsg(String(raw))
      if (msg === null) {
        send(ws, { type: 'error', id: null, message: '解釈できない命令' })
        return
      }
      try {
        /*
         * **差分を取ってから tick を読む** (#369)。
         *
         * `{ tick: session.tick, changes: await session.step(n) }` と書くと
         * リテラルの評価順で **step する前の tick** が入り、フレームの番号が
         * 1 つ手前にずれる (切り出しのときに実際に作り込んだ)。
         */
        const frame = async (changes: Promise<LiveChange[]>, cause: string): Promise<void> => {
          const c = await changes
          broadcast({ type: 'frame', tick: session.tick, changes: c, cause })
        }
        switch (msg.type) {
          case 'step':
            await frame(session.step(msg.n), `step ${msg.n}`)
            break
          case 'use':
            await frame(session.use(msg.pos), `use ${msg.pos.join(',')}`)
            break
          case 'setblock':
            await frame(session.setblock(msg.pos, msg.block), `setblock ${msg.pos.join(',')}`)
            break
          case 'inspect':
            send(ws, { type: 'state', pos: msg.pos, block: session.inspect(msg.pos) })
            break
          case 'reset':
            await session.reset()
            broadcast(hello())
            break
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
  console.log('[live] ブラウザ: npm run dev のうえで http://localhost:5173/?live=1')
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
    console.error('使い方: npm run live -- <fixture名> [--port 8791] [--no-hidden]')
    console.error('        npm run live -- --def <キャプチャ定義名>   (実回路)')
    process.exit(1)
  }
  // **自動判定しない**。同名があったときにどちらを開いたか分からなくなる
  const kind = args.includes('--def') ? 'capture' as const : 'fixture' as const
  const portArg = args.find(a => a.startsWith('--port'))
  const port = portArg ? Number(portArg.split('=')[1] ?? args[args.indexOf(portArg) + 1]) : LIVE_PORT
  const withHidden = !args.includes('--no-hidden')
  await withHarnessLock(() => serve(name, port, withHidden, kind))
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(e => {
    console.error(e instanceof Error ? e.message : e)
    process.exit(1)
  })
}
