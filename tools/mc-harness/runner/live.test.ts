import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { diffBlockMaps, lookTarget, parseClientMsg } from './live.js'
import { WORLD_SETUP_COMMANDS } from './world-setup.js'

/**
 * ライブ観測の純粋な部分 (#366)。**実機は要らない**。
 * compare.test.ts と同じく合成データで検査する。
 */

const runnerDir = dirname(fileURLToPath(import.meta.url))

describe('diffBlockMaps', () => {
  it('変わった座標だけを返す', () => {
    expect(diffBlockMaps({ '0,1,0': 'a', '1,1,0': 'b' }, { '0,1,0': 'a', '1,1,0': 'c' }))
      .toEqual([{ pos: [1, 1, 0], block: 'c' }])
  })

  it('消滅は air で表す (fixture の expect と同じ規約)', () => {
    expect(diffBlockMaps({ '2,1,0': 'stone' }, {}))
      .toEqual([{ pos: [2, 1, 0], block: 'air' }])
  })

  it('新しく出たブロックも差分になる', () => {
    expect(diffBlockMaps({}, { '0,0,0': 'stone' }))
      .toEqual([{ pos: [0, 0, 0], block: 'stone' }])
  })

  it('座標順は安定している (文字列昇順)', () => {
    const d = diffBlockMaps({}, { '2,1,0': 'a', '0,1,0': 'b', '1,1,0': 'c' })
    expect(d.map(c => c.pos)).toEqual([[0, 1, 0], [1, 1, 0], [2, 1, 0]])
  })
})

describe('lookTarget', () => {
  it('セル中心を狙い、**Y は小数部をそのまま足す** (床レバーは .35)', () => {
    expect(lookTarget([3, 1, 4], 0.35)).toEqual(['3.5', '1.35', '4.5'])
  })

  it('小数部 0 なら整数 + .5 / y はそのまま', () => {
    expect(lookTarget([0, 2, 0], 0)).toEqual(['0.5', '2', '0.5'])
  })
})

describe('parseClientMsg', () => {
  it('壊れた JSON は null (セッションを落とさない)', () => {
    expect(parseClientMsg('{')).toBeNull()
    expect(parseClientMsg('null')).toBeNull()
    expect(parseClientMsg('123')).toBeNull()
  })

  it('id の無い命令は受けない', () => {
    expect(parseClientMsg(JSON.stringify({ type: 'step', n: 1 }))).toBeNull()
  })

  it('知らない type は受けない', () => {
    expect(parseClientMsg(JSON.stringify({ type: 'explode', id: 1 }))).toBeNull()
  })

  it('step は 1〜64 の整数だけ', () => {
    expect(parseClientMsg(JSON.stringify({ type: 'step', id: 1, n: 8 })))
      .toEqual({ type: 'step', id: 1, n: 8 })
    expect(parseClientMsg(JSON.stringify({ type: 'step', id: 1, n: 0 }))).toBeNull()
    expect(parseClientMsg(JSON.stringify({ type: 'step', id: 1, n: 999 }))).toBeNull()
    expect(parseClientMsg(JSON.stringify({ type: 'step', id: 1, n: 2.7 })))
      .toEqual({ type: 'step', id: 1, n: 2 })
  })

  it('座標は数値 3 つでなければ受けない', () => {
    expect(parseClientMsg(JSON.stringify({ type: 'use', id: 1, pos: [1, 2] }))).toBeNull()
    expect(parseClientMsg(JSON.stringify({ type: 'use', id: 1, pos: ['a', 1, 2] }))).toBeNull()
    expect(parseClientMsg(JSON.stringify({ type: 'use', id: 1, pos: [1, 2, 3] })))
      .toEqual({ type: 'use', id: 1, pos: [1, 2, 3] })
  })

  it('setblock は block 文字列が要る', () => {
    expect(parseClientMsg(JSON.stringify({ type: 'setblock', id: 1, pos: [0, 1, 0] }))).toBeNull()
    expect(parseClientMsg(JSON.stringify({
      type: 'setblock', id: 1, pos: [0, 1, 0], block: 'stone',
    }))).toEqual({ type: 'setblock', id: 1, pos: [0, 1, 0], block: 'stone' })
  })
})

describe('ワールド初期化の列', () => {
  /**
   * `generate.ts` は**自前の同じ列**を持っている。片方だけ直すと
   * 「generate では動くのに live では動かない」が起きるので、
   * generate.ts のソースに同じコマンドが並んでいることを見る。
   * (将来 generate.ts を world-setup.ts へ寄せたらこのテストは消せる)
   */
  it('generate.ts の列と一致している', () => {
    const src = readFileSync(join(runnerDir, 'generate.ts'), 'utf-8')
    const body = src.slice(src.indexOf('function ensureWorldSetup'))
    for (const cmd of WORLD_SETUP_COMMANDS) {
      const line = cmd.map(a => `'${a}'`).join(', ')
      expect(body.includes(`[${line}]`), `generate.ts に無い: ${cmd.join(' ')}`).toBe(true)
    }
  })

  it('観測範囲を forceload して freeze で終わる', () => {
    const flat = WORLD_SETUP_COMMANDS.map(c => c.join(' '))
    expect(flat).toContain('forceload add -16 -16 47 31')
    expect(flat[flat.length - 1]).toBe('tick freeze')
  })
})
