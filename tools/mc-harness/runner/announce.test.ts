import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * 合図 (#374)。**実機は要らない**。
 *
 * いちばん危ないのは**コマンド長 1014 バイトを超えて実機が無言でハングする**ことなので、
 * 切り詰めを重点的に見る。
 */

const rcon = vi.fn((..._a: string[]) => 'There are 0 of a max of 20 players online:')
const rconBatch = vi.fn((_c: string[], _o?: unknown) => [] as string[])
vi.mock('./rcon.js', () => ({
  rcon: (...a: string[]) => rcon(...a),
  rconBatch: (c: string[], o?: unknown) => rconBatch(c, o),
  MAX_COMMAND_LEN: 1014,
  sleep: () => Promise.resolve(),
}))

const {
  Announcer, clip, tellrawArgs, actionbarArgs, changesSummary, humanPlayers,
  PREFIX, MAX_BODY_BYTES,
} = await import('./announce.js')

beforeEach(() => {
  rcon.mockClear(); rconBatch.mockClear()
  rcon.mockReturnValue('There are 0 of a max of 20 players online:')
})

/** 人が n 人入っている応答 (GT はハーネスのものなので別枠) */
const online = (n: number) =>
  rcon.mockReturnValue(`There are ${n} of a max of 20 players online: `
    + Array.from({ length: n }, (_, i) => `Human${i}`).join(', '))

describe('切り詰め', () => {
  it('短い文はそのまま', () => {
    expect(clip('レバーを押します')).toBe('レバーを押します')
  })

  it('**バイト数で切る** (日本語は 1 文字 3 バイト)', () => {
    const long = 'あ'.repeat(500)          // 1500 バイト
    const out = clip(long)
    expect(Buffer.from(out, 'utf-8').length).toBeLessThanOrEqual(MAX_BODY_BYTES)
    expect(out.endsWith('…')).toBe(true)
  })

  it('切っても文字が壊れない (マルチバイトの途中で切らない)', () => {
    for (const n of [230, 233, 234, 250]) {
      const out = clip('あ'.repeat(n))
      expect(out.includes('�'), `${n} 文字`).toBe(false)
    }
  })

  it('組み立てたコマンドが 1014 バイトを超えない', () => {
    const long = 'あ'.repeat(1000)
    for (const args of [tellrawArgs(long), actionbarArgs(long)]) {
      expect(Buffer.from(args.join(' '), 'utf-8').length).toBeLessThanOrEqual(1014)
    }
  })

  it('JSON を壊す文字を逃がす', () => {
    const args = tellrawArgs('"引用" と \\ と 改行\n')
    expect(() => JSON.parse(args[2])).not.toThrow()
    expect(args.join(' ')).not.toContain('\n')   // 改行は rcon が弾く
  })
})

describe('人が居ないときは黙る', () => {
  it('誰も入っていなければ送らない', () => {
    const a = new Announcer()
    a.say('見えますか')
    expect(rconBatch).not.toHaveBeenCalled()
  })

  it('入っていれば送る', () => {
    online(1)
    const a = new Announcer()
    a.say('見えますか')
    expect(rconBatch).toHaveBeenCalledOnce()
    expect(rconBatch.mock.calls[0]![0][0]).toContain(PREFIX)
  })

  it('**/list は 10 秒だけ使い回す** (毎回叩くと 1 命令ごとに遅くなる)', () => {
    online(1)
    const a = new Announcer()
    a.say('1 回目'); a.say('2 回目'); a.say('3 回目')
    expect(rcon).toHaveBeenCalledOnce()          // list は 1 回だけ
    expect(rconBatch).toHaveBeenCalledTimes(3)
  })

  it('10 秒たてば聞き直す', () => {
    online(1)
    const a = new Announcer()
    expect(a.hasAudience(0)).toBe(true)
    expect(a.hasAudience(20_000)).toBe(true)
    expect(rcon).toHaveBeenCalledTimes(2)
  })

  it('黙らせたら /list も叩かない', () => {
    online(1)
    const a = new Announcer(false)
    a.say('出ないはず')
    expect(rcon).not.toHaveBeenCalled()
    expect(rconBatch).not.toHaveBeenCalled()
  })

  it('/list が失敗しても落ちない (実機が落ちている)', () => {
    rcon.mockImplementation(() => { throw new Error('接続できない') })
    const a = new Announcer()
    expect(() => a.say('x')).not.toThrow()
  })
})

describe('観客の数え方 (#374)', () => {
  it('**ハーネスの fake player (GT) は数えない** (数えると永久に黙らない)', () => {
    rcon.mockReturnValue('There are 1 of a max of 20 players online: GT')
    const a = new Announcer()
    a.say('出ないはず')
    expect(rconBatch).not.toHaveBeenCalled()
  })

  it('人が 1 人でも居れば送る', () => {
    rcon.mockReturnValue('There are 2 of a max of 20 players online: GT, Taku128')
    const a = new Announcer()
    a.say('出るはず')
    expect(rconBatch).toHaveBeenCalledOnce()
  })

  it('定義の fake player も除ける', () => {
    rcon.mockReturnValue('There are 2 of a max of 20 players online: GT, Rider')
    const a = new Announcer()
    a.exclude('Rider')
    a.say('出ないはず')
    expect(rconBatch).not.toHaveBeenCalled()
  })

  it('**大小を無視する** (/list は fake player を小文字で返す)', () => {
    rcon.mockReturnValue('There are 1 of a max of 20 players online: gt')
    const a = new Announcer()
    a.say('出ないはず')
    expect(rconBatch).not.toHaveBeenCalled()
  })

  it('名前の切り出し', () => {
    expect(humanPlayers('There are 0 of a max of 20 players online:')).toEqual([])
    expect(humanPlayers('There are 1 of a max of 20 players online: GT')).toEqual([])
    expect(humanPlayers('There are 1 of a max of 20 players online: gt')).toEqual([])
    expect(humanPlayers('There are 2 of a max of 20 players online: GT, Taku128'))
      .toEqual(['Taku128'])
  })
})

describe('出し方', () => {
  it('big のときはチャットとアクションバーを **1 回の docker exec** でまとめる', () => {
    online(1)
    const a = new Announcer()
    a.say('押します', { big: true })
    expect(rconBatch).toHaveBeenCalledOnce()
    const cmds = rconBatch.mock.calls[0]![0]
    expect(cmds).toHaveLength(2)
    expect(cmds[0]).toContain('tellraw')
    expect(cmds[1]).toContain('actionbar')
  })

  it('送信に失敗しても例外にしない (本体の操作を止めない)', () => {
    online(1)
    rconBatch.mockImplementation(() => { throw new Error('送れない') })
    const a = new Announcer()
    expect(() => a.say('x')).not.toThrow()
  })

  it('カウントダウンは n 回 + 本文', async () => {
    online(1)
    const a = new Announcer()
    await a.countdown(3, '押します')
    expect(rconBatch).toHaveBeenCalledTimes(3)
    expect(rconBatch.mock.calls[0]![0][0]).toContain('3')
  })
})

describe('変化のまとめ', () => {
  it('無いときは「変化なし」', () => {
    expect(changesSummary([])).toBe('変化なし')
  })

  it('少ないときは全部出す', () => {
    expect(changesSummary([{ pos: [1, 2, 3] }, { pos: [4, 5, 6] }]))
      .toBe('変化 2 か所: 1,2,3 / 4,5,6')
  })

  it('多いときは頭だけ出して「ほか」を付ける', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ pos: [i, 0, 0] as [number, number, number] }))
    const out = changesSummary(many)
    expect(out).toContain('変化 9 か所')
    expect(out).toContain('ほか')
  })
})
