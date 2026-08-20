// ============================================================
// rcon 基盤モジュールのテスト。
//
// **実機 (docker) には一切触らない**。execFileSync をモックして
// 「何を投げようとしたか」だけを見る (ハングの検証は実機ではできない。
//  1015 文字を実際に投げると戻ってこないので、投げる前に落ちることを確かめる)。
// ロックだけは本物の fs を使う (一時ディレクトリに逃がしてハーネス直下は汚さない)。
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('node:child_process', () => ({ execFileSync: vi.fn(() => '') }))

const { execFileSync } = await import('node:child_process')
const { rcon, rconBatch, scarpet, withHarnessLock, MAX_COMMAND_LEN, LOCK_STALE_MS }
  = await import('./rcon.js')

const exec = vi.mocked(execFileSync)

beforeEach(() => {
  exec.mockReset()
  exec.mockReturnValue('')
})

/** 引数連結後にちょうど len 文字になるコマンドを作る ('say ' + 本文) */
const cmdOfLen = (len: number): string[] => ['say', 'a'.repeat(len - 'say '.length)]

describe('1014 文字ガード', () => {
  it('ちょうど 1014 文字は通る', () => {
    const args = cmdOfLen(MAX_COMMAND_LEN)
    expect(args.join(' ')).toHaveLength(1014)
    exec.mockReturnValue('ok\n')
    expect(rcon(...args)).toBe('ok')
    expect(exec).toHaveBeenCalledTimes(1)
  })

  it('**日本語はバイト数で数える** (文字数で測るとガードをすり抜ける)', () => {
    // gorcon の MaxCommandLen は Go の len(string) = バイト長。
    // 'あ' は 1 文字 3 バイトなので、文字数で測ると 3 倍まで素通りしてしまう
    const cmd = 'say ' + 'あ'.repeat(400)   // 404 文字 / 1204 バイト
    expect(cmd.length).toBeLessThan(MAX_COMMAND_LEN)
    expect(Buffer.byteLength(cmd, 'utf8')).toBeGreaterThan(MAX_COMMAND_LEN)
    expect(() => rcon(cmd)).toThrow(/長すぎる/)
  })

  it('改行を含むコマンドは弾く (行単位で別コマンドに割れるため)', () => {
    expect(() => rcon('say a\nsay b')).toThrow(/改行/)
  })

  it('1015 文字は投げる前に throw する (実機はここで無言ハングする)', () => {
    const args = cmdOfLen(MAX_COMMAND_LEN + 1)
    expect(args.join(' ')).toHaveLength(1015)
    expect(() => rcon(...args)).toThrow(/長すぎる/)
    // 投げてしまうと戻ってこないので、docker を起動していないことが肝
    expect(exec).not.toHaveBeenCalled()
  })

  it('rconBatch も各コマンドにガードを掛ける', () => {
    expect(() => rconBatch(['say short', cmdOfLen(MAX_COMMAND_LEN + 1).join(' ')]))
      .toThrow(/長すぎる/)
    expect(exec).not.toHaveBeenCalled()
  })
})

describe('rconBatch', () => {
  it('何コマンドあっても docker exec は 1 回だけ (stdin にまとめる)', () => {
    const cmds = Array.from({ length: 40 }, (_, i) => `setblock ${i} 0 0 stone`)
    exec.mockReturnValue(cmds.map((_, i) => `Changed the block at ${i}`).join('\n') + '\n')
    const res = rconBatch(cmds)
    expect(exec).toHaveBeenCalledTimes(1)
    const [bin, argv, opts] = exec.mock.calls[0] as [string, string[], { input: string }]
    expect(bin).toBe('docker')
    expect(argv).toEqual(['compose', 'exec', '-T', 'mc', 'rcon-cli'])
    expect(opts.input).toBe(cmds.join('\n') + '\n')
    expect(res).toHaveLength(40)
    expect(res[39]).toBe('Changed the block at 39')
  })

  it('応答が空のコマンドは空行のまま保持する (詰めると対応がずれる)', () => {
    exec.mockReturnValue('a\n\nc\n')
    expect(rconBatch(['c1', 'c2', 'c3'])).toEqual(['a', '', 'c'])
  })

  it('空配列なら docker を起動しない', () => {
    expect(rconBatch([])).toEqual([])
    expect(exec).not.toHaveBeenCalled()
  })
})

describe('scarpet', () => {
  it('script in dump run に包んで投げる', () => {
    exec.mockReturnValue(' = ok\n')
    expect(scarpet('fx_dump(3)')).toBe('= ok')
    const [, argv] = exec.mock.calls[0] as [string, string[]]
    expect(argv).toEqual(['compose', 'exec', '-T', 'mc', 'rcon-cli', '--',
      'script', 'in', 'dump', 'run', 'fx_dump(3)'])
  })

  it('error を含む応答は throw する', () => {
    exec.mockReturnValue("Expected a function, got 'foo' error\n")
    expect(() => scarpet('foo()')).toThrow(/scarpet 実行エラー/)
  })
})

describe('withHarnessLock', () => {
  let dir: string
  let lock: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mc-harness-lock-'))
    lock = join(dir, '.lock')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('取得中はロックファイルがあり、抜けると消える', async () => {
    const seen = await withHarnessLock(() => {
      expect(existsSync(lock)).toBe(true)
      return JSON.parse(readFileSync(lock, 'utf-8')) as { pid: number; at: number }
    }, lock)
    expect(seen.pid).toBe(process.pid)
    expect(existsSync(lock)).toBe(false)
  })

  it('**async な処理でも終わるまでロックを持ち続ける**', async () => {
    // 同期版だと Promise を返した瞬間に finally が走り、
    // rcon を 1 本も撃たないうちにロックが外れる (直列化の意味が消える)
    let heldDuringWork = false
    await withHarnessLock(async () => {
      await new Promise(r => setTimeout(r, 30))
      heldDuringWork = existsSync(lock)
    }, lock)
    expect(heldDuringWork, '非同期処理の最中にロックが外れている').toBe(true)
    expect(existsSync(lock)).toBe(false)
  })

  it('fn が throw してもロックは消える', async () => {
    await expect(withHarnessLock(() => { throw new Error('中で失敗') }, lock)).rejects.toThrow('中で失敗')
    expect(existsSync(lock)).toBe(false)
  })

  it('二重取得を弾く (応答混線の防止)', async () => {
    await withHarnessLock(async () => {
      await expect(withHarnessLock(() => 'never', lock)).rejects.toThrow(/別のキャプチャが実行中/)
    }, lock)
  })

  it('生きている他プロセスのロックは奪わない', async () => {
    writeFileSync(lock, JSON.stringify({ pid: 999999, at: Date.now() - 60_000 }))
    await expect(withHarnessLock(() => 'never', lock)).rejects.toThrow(/別のキャプチャが実行中/)
    // 弾いた側がロックを消してしまわないこと (相手はまだ実行中)
    expect(existsSync(lock)).toBe(true)
  })

  it('**奪われた後に抜けても他人のロックを消さない**', async () => {
    // A が持っている間に B が残骸とみなして奪った状況を作る。
    // A の finally が無条件 unlink だと B のロックが消え、3 本目が同時に走れてしまう
    await withHarnessLock(async () => {
      writeFileSync(lock, JSON.stringify({ pid: 999999, at: Date.now() }))  // B が奪った
    }, lock)
    expect(existsSync(lock), '他人のロックを消してしまった').toBe(true)
    expect((JSON.parse(readFileSync(lock, 'utf-8')) as { pid: number }).pid).toBe(999999)
  })

  it('10 分ちょうどはまだ生きている / 10 分を超えたら残骸として奪う', async () => {
    // 定数から時刻を作ると閾値をどう変えても通ってしまうので **固定値** で書く
    expect(LOCK_STALE_MS).toBe(600_000)
    writeFileSync(lock, JSON.stringify({ pid: 999999, at: Date.now() - 600_000 + 50 }))
    await expect(withHarnessLock(() => 'never', lock)).rejects.toThrow(/別のキャプチャが実行中/)

    writeFileSync(lock, JSON.stringify({ pid: 999999, at: Date.now() - 600_000 - 1000 }))
    const pid = await withHarnessLock(
      () => (JSON.parse(readFileSync(lock, 'utf-8')) as { pid: number }).pid, lock)
    expect(pid).toBe(process.pid)
    expect(existsSync(lock)).toBe(false)
  })

  it('壊れたロックファイルも残骸として奪う', async () => {
    writeFileSync(lock, 'not json')
    expect(await withHarnessLock(() => 'ok', lock)).toBe('ok')
  })
})
