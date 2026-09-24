import { describe, it, expect, vi } from 'vitest'

/**
 * MCP サーバの道具立て (#369)。**実機は要らない**。
 *
 * 実機を触る関数はモックにして、
 * ①道具が全部生えているか ②引数の検査 ③実機が落ちているときの返し方
 * を見る。実機ありの疎通は手で確認する (README)。
 */

vi.mock('./live-session.js', () => ({
  isHarnessUp: vi.fn(() => false),
  listFixtures: vi.fn(() => ['repeater-delay-1', 'torch-basic']),
  listCaptureDefs: vi.fn(() => ['circuit1', 'runa-open-short']),
  HarnessSession: { open: vi.fn() },
}))
vi.mock('./rcon.js', () => ({
  acquireHarnessLock: vi.fn(),
  releaseHarnessLock: vi.fn(),
  harnessLockHolder: vi.fn(() => null),
  refreshHarnessLock: vi.fn(),
}))

const { createServer, IDLE_RELEASE_MS } = await import('./mcp.js')
const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js')
const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')

async function connect() {
  const [clientT, serverT] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'test', version: '0' })
  await Promise.all([createServer().connect(serverT), client.connect(clientT)])
  return client
}

const textOf = (r: unknown): string =>
  ((r as { content: { type: string; text?: string }[] }).content ?? [])
    .map(c => c.text ?? '').join('\n')

describe('道具立て', () => {
  it('必要な道具が全部生えている', async () => {
    const client = await connect()
    const names = (await client.listTools()).tools.map(t => t.name).sort()
    expect(names).toEqual([
      'harness_close', 'harness_inspect', 'harness_open', 'harness_reset',
      'harness_scan', 'harness_setblock', 'harness_status', 'harness_step', 'harness_use',
    ])
  })

  it('**長時間走るものは道具にしない** (capture / minimize)', async () => {
    const client = await connect()
    const names = (await client.listTools()).tools.map(t => t.name)
    expect(names.some(n => /capture|minimize/.test(n))).toBe(false)
  })

  it('どの道具にも説明がある', async () => {
    const client = await connect()
    for (const t of (await client.listTools()).tools) {
      expect(t.description, t.name).toBeTruthy()
    }
  })
})

describe('実機が落ちているとき', () => {
  it('status は「起きていない」と答える (例外にしない)', async () => {
    const client = await connect()
    const out = textOf(await client.callTool({ name: 'harness_status', arguments: {} }))
    expect(out).toContain('起きていない')
    expect(out).toContain('harness:up')
  })

  it('open は理由を返す (例外にしない)', async () => {
    const client = await connect()
    const out = textOf(await client.callTool({ name: 'harness_open', arguments: { name: 'repeater-delay-1' } }))
    expect(out).toContain('実機が起きていない')
  })
})

describe('引数の検査', () => {
  it('実回路 (capture) も開ける', async () => {
    const client = await connect()
    const t = (await client.listTools()).tools.find(x => x.name === 'harness_open')
    expect(JSON.stringify(t?.inputSchema)).toContain('capture')
  })

  it('無い実回路は capture の候補を添えて返す', async () => {
    const { isHarnessUp } = await import('./live-session.js')
    vi.mocked(isHarnessUp).mockReturnValueOnce(true)
    const client = await connect()
    const out = textOf(await client.callTool({
      name: 'harness_open', arguments: { name: '無い', kind: 'capture' },
    }))
    expect(out).toContain('そんな capture は無い')
    expect(out).toContain('circuit1')
  })

  it('無い fixture は候補を添えて返す', async () => {
    const { isHarnessUp } = await import('./live-session.js')
    vi.mocked(isHarnessUp).mockReturnValueOnce(true)
    const client = await connect()
    const out = textOf(await client.callTool({ name: 'harness_open', arguments: { name: 'そんなの無い' } }))
    expect(out).toContain('そんな fixture は無い')
    expect(out).toContain('repeater-delay-1')
  })

  it('step は 1〜64 の範囲外を弾く', async () => {
    const client = await connect()
    const r = await client.callTool({ name: 'harness_step', arguments: { n: 999 } })
    expect(r.isError, JSON.stringify(r)).toBe(true)
  })

  it('座標は数値 3 つでないと弾く', async () => {
    const client = await connect()
    const r = await client.callTool({ name: 'harness_use', arguments: { pos: [1, 2] } })
    expect(r.isError).toBe(true)
  })

  it('回路を開く前に触ると「先に harness_open」と言う', async () => {
    const client = await connect()
    const r = await client.callTool({ name: 'harness_step', arguments: { n: 1 } })
    expect(textOf(r) + JSON.stringify(r)).toContain('harness_open')
  })
})

describe('ロックの扱い', () => {
  it('他プロセスが握っていたら待たずに pid と経過を返す', async () => {
    const { isHarnessUp } = await import('./live-session.js')
    const { harnessLockHolder } = await import('./rcon.js')
    vi.mocked(isHarnessUp).mockReturnValueOnce(true)
    vi.mocked(harnessLockHolder).mockReturnValueOnce({ pid: 4242, ageMs: 30_000 })
    const client = await connect()
    const r = await client.callTool({ name: 'harness_open', arguments: { name: 'repeater-delay-1' } })
    const out = textOf(r) + JSON.stringify(r)
    expect(out).toContain('4242')
    expect(out).toContain('30')
  })

  it('**自動解放は 10 分より短い** (残骸とみなされて奪われる前に返す)', () => {
    expect(IDLE_RELEASE_MS).toBeLessThan(10 * 60 * 1000)
  })
})
