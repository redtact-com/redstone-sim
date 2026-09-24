// ============================================================
// 実機ハーネスの MCP サーバ (#369)
//
// 使い方: リポジトリ直下の .mcp.json が登録している (stdio)。
// 手で試すなら: npx tsx tools/mc-harness/runner/mcp.ts
//
// ハーネスの制約 (**ロックの直列化**と**コマンド長 1014 バイト**) を
// ここより内側に閉じ込めるのが目的。呼ぶ側はブロックと座標のことだけ考えればよい。
//
// **長時間走るもの (capture / minimize) は道具にしない**。
// 数十分かかるので MCP の 1 往復には載らない。
// ============================================================

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import {
  acquireHarnessLock, releaseHarnessLock, harnessLockHolder, refreshHarnessLock,
} from './rcon.js'
import { HarnessSession, isHarnessUp, listFixtures } from './live-session.js'
import type { LiveChange } from './live-protocol.js'

/**
 * 無操作でロックを返すまでの時間 (#369)。
 *
 * MCP サーバは常駐するので、取ったロックを握りっぱなしにすると
 * `ground-truth` や `capture` が**10 分間ブロックされる**
 * (10 分は残骸とみなされて奪われるまでの時間)。
 * それより短く手放す。
 */
export const IDLE_RELEASE_MS = 5 * 60 * 1000

const posSchema = z.tuple([z.number().int(), z.number().int(), z.number().int()])
  .describe('[x, y, z]')

/** セッションの持ち主。ロックの取得と自動解放をここだけで扱う */
class Holder {
  private session: HarnessSession | null = null
  private locked = false
  private idleTimer: NodeJS.Timeout | null = null
  private heartbeat: NodeJS.Timeout | null = null

  get current(): HarnessSession | null { return this.session }

  /** 何か触られたら無操作タイマーを引き直す */
  touch(): void {
    if (this.idleTimer !== null) clearTimeout(this.idleTimer)
    if (!this.locked) return
    this.idleTimer = setTimeout(() => this.release('無操作が続いたため'), IDLE_RELEASE_MS)
  }

  async open(name: string, withHidden: boolean): Promise<HarnessSession> {
    if (this.locked) this.release('開き直しのため')
    const holder = harnessLockHolder()
    if (holder !== null) {
      throw new Error(
        `ハーネスのロックを他プロセスが握っている (pid=${holder.pid}, 経過 ${
          Math.round(holder.ageMs / 1000)}s)。終わるのを待つか、落ちているならロックを消すこと`,
      )
    }
    acquireHarnessLock()
    this.locked = true
    // 長く握るのでハートビートを打つ (打たないと 10 分で奪われて応答が混線する)
    this.heartbeat = setInterval(() => refreshHarnessLock(), 60_000)
    try {
      this.session = await HarnessSession.open(name, { withHidden })
    } catch (e) {
      this.release('開けなかったため')
      throw e
    }
    this.touch()
    return this.session
  }

  /** ロックを返す。セッションも捨てる */
  release(why: string): void {
    if (this.idleTimer !== null) { clearTimeout(this.idleTimer); this.idleTimer = null }
    if (this.heartbeat !== null) { clearInterval(this.heartbeat); this.heartbeat = null }
    if (this.locked) {
      releaseHarnessLock()
      this.locked = false
      console.error(`[mcp] ロックを返した (${why})`)
    }
    this.session = null
  }

  /** 道具が使える状態か。使えないときは理由を返す */
  need(): HarnessSession {
    if (this.session === null) {
      throw new Error('回路を開いていない。先に harness_open を呼ぶこと (無操作が続くと自動で閉じる)')
    }
    this.touch()
    return this.session
  }

  get isLocked(): boolean { return this.locked }
}

const holder = new Holder()

/** 差分を読みやすい 1 行に */
const fmt = (changes: LiveChange[]): string =>
  changes.length === 0
    ? '変化なし'
    : changes.map(c => `${c.pos.join(',')} = ${c.block}`).join('\n')

const text = (s: string) => ({ content: [{ type: 'text' as const, text: s }] })

export function createServer(): McpServer {
  const server = new McpServer({ name: 'mc-harness', version: '1.0.0' })

  server.tool(
    'harness_status',
    '実機ハーネスの状態 (起きているか / ロックの持ち主 / 開いている回路 / tick)',
    {},
    async () => {
      const up = isHarnessUp()
      const lock = harnessLockHolder()
      const s = holder.current
      return text([
        `実機: ${up ? '起きている' : '起きていない (npm run harness:up を実行すること)'}`,
        `ロック: ${lock === null ? 'なし' : `pid=${lock.pid} 経過 ${Math.round(lock.ageMs / 1000)}s`}`
          + (holder.isLocked ? ' (このサーバが保持)' : ''),
        s === null ? '回路: 開いていない' : `回路: ${s.info.name} / tick ${s.tick}`,
        `開ける回路: ${listFixtures().length} 本 (harness_open に名前を渡す)`,
      ].join('\n'))
    },
  )

  server.tool(
    'harness_open',
    'fixture 定義の回路を実機に置いて開く (掃除 → 設置 → settle)。ロックを取る',
    {
      name: z.string().describe('fixture 名 (tools/mc-harness/fixtures/<name>.json)'),
      withHidden: z.boolean().optional()
        .describe('予約 tick / コンパレーター保持 / クールダウンを保存ファイルから読む (既定 true)'),
    },
    async ({ name, withHidden }) => {
      if (!isHarnessUp()) {
        return text('実機が起きていない。`npm run harness:up` を実行すること')
      }
      if (!listFixtures().includes(name)) {
        return text(`そんな fixture は無い: ${name}\n候補: ${listFixtures().slice(0, 20).join(', ')} ...`)
      }
      const s = await holder.open(name, withHidden !== false)
      const h = s.hidden()
      return text([
        `${name} を開いた (tick ${s.tick})`,
        `region: ${JSON.stringify(s.info.region)}`,
        `ブロック ${Object.keys(s.state()).length} 個`,
        h === null ? '隠れ状態: 読んでいない' : `隠れ状態: 予約 ${h.scheduled.length} / 比較 ${h.comparators.length} / 冷却 ${h.cooldowns.length}`,
      ].join('\n'))
    },
  )

  server.tool(
    'harness_step',
    'tick を進める。戻りは変化した座標',
    { n: z.number().int().min(1).max(64).default(1).describe('進める tick 数 (1〜64)') },
    async ({ n }) => {
      const s = holder.need()
      const changes = await s.step(n)
      return text(`tick ${s.tick} (+${n})\n${fmt(changes)}`)
    },
  )

  server.tool(
    'harness_use',
    '座標のブロックを押す (レバー・ボタン等)。fake player が照準して右クリックする',
    { pos: posSchema },
    async ({ pos }) => {
      const s = holder.need()
      const changes = await s.use(pos as [number, number, number])
      return text(`use ${pos.join(',')} (tick ${s.tick})\n${fmt(changes)}`)
    },
  )

  server.tool(
    'harness_setblock',
    '座標に blockstate を置く。支えブロックへの近隣更新も配る',
    { pos: posSchema, block: z.string().describe("例: lever[face=floor,facing=north,powered=true]") },
    async ({ pos, block }) => {
      const s = holder.need()
      const changes = await s.setblock(pos as [number, number, number], block)
      return text(`setblock ${pos.join(',')} ${block} (tick ${s.tick})\n${fmt(changes)}`)
    },
  )

  server.tool(
    'harness_scan',
    'いまの region 全体の blockstate',
    {},
    async () => {
      const s = holder.need()
      const m = s.state()
      const lines = Object.keys(m).sort().map(k => `${k} = ${m[k]}`)
      return text(`tick ${s.tick} / ${lines.length} 個\n${lines.join('\n')}`)
    },
  )

  server.tool(
    'harness_inspect',
    '1 座標の blockstate (無ければ air)',
    { pos: posSchema },
    async ({ pos }) => {
      const s = holder.need()
      return text(`${pos.join(',')} = ${s.inspect(pos as [number, number, number])}`)
    },
  )

  server.tool(
    'harness_reset',
    '回路を置き直して 0 tick へ戻す',
    {},
    async () => {
      const s = holder.need()
      await s.reset()
      return text(`置き直した (tick ${s.tick})`)
    },
  )

  server.tool(
    'harness_close',
    'セッションを閉じてロックを返す (ground-truth や capture を回す前に呼ぶ)',
    {},
    async () => {
      holder.release('harness_close が呼ばれたため')
      return text('閉じてロックを返した')
    },
  )

  return server
}

async function main(): Promise<void> {
  const server = createServer()
  // **ロックを持ったまま死なないようにする**
  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.once(sig, () => { holder.release(`${sig} を受けたため`); process.exit(0) })
  }
  process.once('uncaughtException', e => {
    holder.release('未捕捉の例外のため')
    console.error(e)
    process.exit(1)
  })
  await server.connect(new StdioServerTransport())
  console.error('[mcp] mc-harness を stdio で待機中')
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(e => {
    console.error(e instanceof Error ? e.message : e)
    process.exit(1)
  })
}
