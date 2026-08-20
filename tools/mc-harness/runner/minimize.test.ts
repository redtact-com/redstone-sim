// ============================================================
// minimize.ts のうち **実機を呼ばない部分** の回帰。
//
//   - 署名判定 (対象座標が食い違うか)
//   - 候補の並べ方 (対象からの距離順)
//   - 引数の解釈
//   - 縮んだキャプチャ → fixture の書き出し
//
// 縮め方のループ本体は delta-debug.test.ts。
//
// 変異で確かめてあること:
//   - signatureHolds を常に true にする → '別の座標では署名にならない' が落ちる
//   - fixture の expect / blocks を写さない → '書き出した fixture が食い違いを再現する' が落ちる
// ============================================================

import { describe, it, expect } from 'vitest'
import {
  parseArgs, normalizePosKey, signatureHolds, sortByDistance,
  buildMinimizedFixture, divergenceDetail, fmtMs, DEFAULT_SKIP_UNTIL,
} from './minimize.js'
import { compareCapture, type Capture } from './compare.js'
import { diffFixtureAgainstSim } from '../../../packages/sim/test/fixture-runner.js'

/**
 * 樽 → コンパレーター → ダスト。compare.test.ts で sim と一致することを確認済みの形。
 * ここではこれを**壊して**食い違いを作り、署名判定の材料にする。
 */
const BASE: Capture = {
  name: 'container-input', mcVersion: '1.21.1',
  region: { from: [0, 0, 0], to: [2, 1, 0] },
  authored: {
    '0,0,0': 'stone', '1,0,0': 'stone', '2,0,0': 'stone',
    '0,1,0': 'barrel[facing=north,open=false]',
    '1,1,0': 'comparator[facing=west,mode=compare,powered=false]',
    '2,1,0': 'redstone_wire[east=none,north=none,power=0,south=none,west=side]',
  },
  inputs: [{ tick: 2, pos: [0, 1, 0], action: 'container', signal: 5 }],
  ticks: 8,
  frames: [{
    tick: 4,
    changes: [
      { pos: [1, 1, 0], block: 'comparator[facing=west,mode=compare,powered=true]' },
      { pos: [2, 1, 0], block: 'redstone_wire[east=none,north=none,power=5,south=none,west=side]' },
    ],
  }],
  players: [],
  generated: { at: '2026-08-20T00:00:00.000Z', mc: '1.21.1', carpet: '1.21-1.4.147+v240613' },
}

const clone = (c: Capture): Capture => JSON.parse(JSON.stringify(c)) as Capture

/** ダスト (2,1,0) の実機値だけを壊したキャプチャ (= その座標が食い違う) */
function withDivergence(): Capture {
  const cap = clone(BASE)
  cap.frames![0].changes[1].block = 'redstone_wire[east=none,north=none,power=9,south=none,west=side]'
  return cap
}

describe('signatureHolds — 署名は「その座標が食い違うこと」', () => {
  it('一致しているキャプチャではどの座標も署名にならない', () => {
    const r = compareCapture(BASE)
    expect(r.ok, JSON.stringify(r.first)).toBe(true)
    expect(signatureHolds(r, '2,1,0')).toBe(false)
  })

  it('食い違った座標では true', () => {
    const r = compareCapture(withDivergence())
    expect(signatureHolds(r, '2,1,0')).toBe(true)
  })

  it('**別の座標では署名にならない** (「どこかが不一致」で判定していない証拠)', () => {
    const r = compareCapture(withDivergence())
    expect(r.ok).toBe(false)          // 回路のどこかは食い違っている
    expect(signatureHolds(r, '1,1,0')).toBe(false)
    expect(signatureHolds(r, '0,0,0')).toBe(false)
  })

  it('first に載りきらない座標でも divergentPositions で拾える', () => {
    // first は先頭 tick の先頭 8 座標しか載せない。署名はそちらを見てはいけない
    const r = compareCapture(withDivergence())
    expect(r.divergentPositions).toContain('2,1,0')
    expect(r.divergentPositions).toEqual([...r.divergentPositions].sort())
  })
})

describe('divergenceDetail — 説明文の材料', () => {
  it('最初に食い違う tick と実機・sim の値を返す', () => {
    const d = divergenceDetail(withDivergence(), '2,1,0', false)
    expect(d?.tick).toBe(4)
    expect(d?.mc).toContain('power=9')
    expect(d?.sim).toContain('power=5')
  })

  it('食い違わない座標なら null', () => {
    expect(divergenceDetail(BASE, '2,1,0', false)).toBeNull()
  })
})

describe('sortByDistance — 近い順に並べる (落とすのは遠い側から)', () => {
  it('対象からの距離が近いものが先頭', () => {
    const keys = ['10,0,0', '1,0,0', '0,1,0', '3,0,0']
    // 距離 1 の 2 つ (1,0,0 / 0,1,0) は同距離なのでキー順で決まる
    expect(sortByDistance(keys, '0,0,0')).toEqual(['0,1,0', '1,0,0', '3,0,0', '10,0,0'])
  })

  it('同距離はキー順で決定的 (撮り直しても同じ順序)', () => {
    const keys = ['0,0,1', '1,0,0', '0,1,0']
    const once = sortByDistance(keys, '0,0,0')
    expect(once).toEqual(sortByDistance([...keys].reverse(), '0,0,0'))
    expect(once).toEqual(['0,0,1', '0,1,0', '1,0,0'])
  })
})

describe('parseArgs', () => {
  it('既定は動的モード + skipUntil つき', () => {
    const a = parseArgs(['def.json', '--pos', '1,2,3'])
    expect(a).toEqual({
      defPath: 'def.json', pos: '1,2,3', out: undefined,
      trustAuthored: true, maxTrials: 400, skipUntil: DEFAULT_SKIP_UNTIL, force: false,
    })
  })

  it('--force を付けたときだけ既存 fixture を置き換えられる', () => {
    expect(parseArgs(['d', '--pos', '0,0,0']).force).toBe(false)
    expect(parseArgs(['d', '--pos', '0,0,0', '--force']).force).toBe(true)
  })

  it('--static / --out / --max-trials / --skip-until / --no-skip', () => {
    const a = parseArgs(['--pos', ' 4, 5 ,6 ', 'def.json', '--static', '--out', 'foo', '--max-trials', '12'])
    expect(a).toMatchObject({ defPath: 'def.json', pos: '4,5,6', out: 'foo', trustAuthored: false, maxTrials: 12 })
    expect(parseArgs(['d', '--pos', '0,0,0', '--skip-until', '#251']).skipUntil).toBe('#251')
    expect(parseArgs(['d', '--pos', '0,0,0', '--no-skip']).skipUntil).toBeNull()
  })

  it('--pos が無ければ落とす (何を残すか決まらないので実行してはいけない)', () => {
    expect(() => parseArgs(['def.json'])).toThrow(/--pos/)
  })

  it('壊れた引数は投げる', () => {
    expect(() => parseArgs(['def.json', '--pos', '1,2'])).toThrow(/x,y,z/)
    expect(() => parseArgs(['def.json', '--pos', '1,2,3', '--max-trials', '0'])).toThrow(/1 以上/)
    expect(() => parseArgs(['def.json', '--pos', '1,2,3', '--out'])).toThrow(/値が要る/)
    expect(() => parseArgs(['a.json', 'b.json', '--pos', '1,2,3'])).toThrow(/1 つ渡す/)
    expect(() => parseArgs(['def.json', '--pos', '1,2,3', '--nope'])).toThrow(/知らないオプション/)
  })

  it('normalizePosKey は空白を落として正規化する', () => {
    expect(normalizePosKey(' -1 , 0,2 ')).toBe('-1,0,2')
    expect(() => normalizePosKey('1,2,3,4')).toThrow()
  })
})

describe('buildMinimizedFixture — 縮んだ結果を fixture にする', () => {
  it('**書き出した fixture がそのまま食い違いを再現する** (回帰として使える)', () => {
    const fx = buildMinimizedFixture(withDivergence(), {
      name: 'min-demo', pos: '2,1,0', trustAuthored: false, skipUntil: null,
    })
    // JSON を経由しても壊れないこと (実際はファイルに書いて run.ts / npm test が読む)
    const roundTripped = JSON.parse(JSON.stringify(fx)) as typeof fx
    const diffs = diffFixtureAgainstSim(roundTripped)
    expect(diffs.flatMap(d => d.diffs.map(x => x.pos))).toContain('2,1,0')
  })

  it('blocks / inputs / expect / region を落とさずに写す', () => {
    const cap = withDivergence()
    const fx = buildMinimizedFixture(cap, {
      name: 'min-demo', pos: '2,1,0', trustAuthored: false, skipUntil: null,
    })
    expect(fx.name).toBe('min-demo')
    expect(fx.region).toEqual(cap.region)
    expect(fx.blocks.map(b => b.pos.join(','))).toEqual(Object.keys(cap.authored).sort())
    expect(fx.inputs).toEqual(cap.inputs)
    expect(fx.expect).toEqual(cap.frames)
    expect(fx.ticks).toBe(cap.ticks)
    expect(fx.generated).toEqual(cap.generated)
  })

  it('既定では skipUntil を付ける (縮めた結果は必ず食い違うので CI を赤くしない)', () => {
    const fx = buildMinimizedFixture(withDivergence(), {
      name: 'min-demo', pos: '2,1,0', trustAuthored: false, skipUntil: DEFAULT_SKIP_UNTIL,
    })
    expect(fx.skipUntil).toBe(DEFAULT_SKIP_UNTIL)
    // 何が食い違うのかを理由に書く (後から読む人が実機の答えを追えるように)
    expect(fx.skipReason).toContain('2,1,0')
    expect(fx.skipReason).toContain('tick 4')
    expect(fx.skipReason).toContain('power=9')
  })

  it('--no-skip では skipUntil を付けない (直った後の回帰用)', () => {
    const fx = buildMinimizedFixture(withDivergence(), {
      name: 'min-demo', pos: '2,1,0', trustAuthored: false, skipUntil: null,
    })
    expect(fx.skipUntil).toBeUndefined()
    expect(fx.skipReason).toBeUndefined()
  })

  it('動的モードでは trustAuthored と実機の予約 tick を持ち込む', () => {
    const cap = withDivergence()
    cap.scheduled = [{ pos: [1, 1, 0], delay: 2, priority: 0, block: 'minecraft:comparator' }]
    const fx = buildMinimizedFixture(cap, {
      name: 'min-demo', pos: '2,1,0', trustAuthored: true, skipUntil: null,
    })
    expect(fx.trustAuthored).toBe(true)
    expect(fx.scheduled).toEqual(cap.scheduled)
  })
})

describe('fmtMs', () => {
  it('分をまたぐと m/s 表記になる', () => {
    expect(fmtMs(12_340)).toBe('12.3s')
    expect(fmtMs(123_400)).toBe('2m03s')
  })
})
