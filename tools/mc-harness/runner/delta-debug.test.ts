// ============================================================
// delta-debug.ts (縮め方のループ) の回帰。**実機は呼ばない**。
//
// オラクルは「特定の 3 個が残っていれば true」という偽物を差す。
// これで見るのは 2 つだけ:
//   - ちゃんとその 3 個まで縮むか (= 塊を半分ずつ縮めて最後まで舐めているか)
//   - オラクル呼び出しが候補数に対して線形で収まるか (実機だと 1 回が数秒〜25 秒)
//
// 変異で確かめてあること (どれかを壊すとここが落ちる):
//   - 塊の縮小 (chunk = floor(chunk/2)) をやめる → 3 個まで縮まず落ちる
//   - 署名判定を常に true にする → 何も残らず落ちる ('全部落とせる' の裏返し)
//   - 遠い側ではなく近い側から落とす → '遠い側から' が落ちる
// ============================================================

import { describe, it, expect } from 'vitest'
import { minimizeSubset, type DeltaDebugPass, type DeltaDebugTrial } from './delta-debug.js'

/** 'b0'..'b{n-1}' */
const seq = (n: number): string[] => Array.from({ length: n }, (_, i) => `b${i}`)

describe('minimizeSubset — 偽オラクルで縮め方だけを見る', () => {
  const N = 200
  const all = seq(N)
  // 「この 3 個が残っていれば食い違いが再現する」という想定の署名
  const required = ['b3', 'b77', 'b198']
  const oracle = (subset: readonly string[]) => required.every(r => subset.includes(r))

  it('署名を保つ 3 個まで縮む', async () => {
    const r = await minimizeSubset({ candidates: all, oracle })
    expect(r.kept).toEqual(required)
    expect(r.stoppedBy).toBe('converged')
  })

  it('オラクル呼び出しが線形爆発しない (1 個ずつ全通りの n^2 にならない)', async () => {
    let calls = 0
    const r = await minimizeSubset({
      candidates: all,
      oracle: s => { calls++; return oracle(s) },
    })
    expect(calls).toBe(r.trials)
    // k=n/2, n/4, …, 1 の各パスで高々 ceil(n/k) 回 → 合計 ≒ 2n。
    // 実測 (n=200) は 300 回台。3n で十分な余裕があり、n^2/10 = 4000 とは桁が違う
    expect(r.trials).toBeLessThanOrEqual(3 * N)
    expect(r.trials).toBeLessThan((N * N) / 10)
  })

  it('残ったものは 1-minimal (どれ 1 つ落としても署名が消える)', async () => {
    const r = await minimizeSubset({ candidates: all, oracle })
    for (const k of r.kept) {
      expect(oracle(r.kept.filter(x => x !== k)), `${k} はまだ落とせる`).toBe(false)
    }
  })

  it('候補の並び順を保つ (レポートの再現性)', async () => {
    const r = await minimizeSubset({ candidates: all, oracle })
    expect(r.kept).toEqual([...r.kept].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))))
  })
})

describe('minimizeSubset — 落とす順序と塊の縮み方', () => {
  it('**遠い側 (末尾) から**塊で落とす', async () => {
    const dropped: string[][] = []
    await minimizeSubset({
      candidates: ['a', 'b', 'c', 'd'],
      oracle: () => false,   // 何も採用させず、試した順だけを見る
      onTrial: (t: DeltaDebugTrial<string>) => dropped.push([...t.dropped]),
    })
    // k=2: [c,d] → [a,b] / k=1: [d] [c] [b] [a]
    expect(dropped[0]).toEqual(['c', 'd'])
    expect(dropped[1]).toEqual(['a', 'b'])
    expect(dropped.slice(2)).toEqual([['d'], ['c'], ['b'], ['a']])
  })

  it('塊は半分ずつ縮んで k=1 で終わる', async () => {
    const passes: DeltaDebugPass[] = []
    const r = await minimizeSubset({
      candidates: seq(8),
      oracle: () => false,
      onPass: p => passes.push(p),
    })
    expect(passes.map(p => p.chunkSize)).toEqual([4, 2, 1])
    expect(r.passes).toBe(3)
  })

  it('全部落とせるオラクルなら空になる', async () => {
    const r = await minimizeSubset({ candidates: seq(16), oracle: () => true })
    expect(r.kept).toEqual([])
  })

  it('何も落とせないオラクルなら全部残る (それでも呼び出しは線形)', async () => {
    const n = 64
    const r = await minimizeSubset({
      candidates: seq(n),
      oracle: s => s.length === n,   // 1 個でも欠けたら署名が消える
    })
    expect(r.kept).toEqual(seq(n))
    expect(r.trials).toBeLessThanOrEqual(3 * n)
  })

  it('候補が空でもオラクルを呼ばずに終わる', async () => {
    let calls = 0
    const r = await minimizeSubset({ candidates: [], oracle: () => { calls++; return true } })
    expect(r.kept).toEqual([])
    expect(calls).toBe(0)
    expect(r.trials).toBe(0)
  })
})

describe('minimizeSubset — 予算', () => {
  it('maxTrials で打ち切っても kept は「署名を保つと確認済み」の集合', async () => {
    const required = ['b1', 'b40']
    const oracle = (s: readonly string[]) => required.every(r => s.includes(r))
    const r = await minimizeSubset({ candidates: seq(64), oracle, maxTrials: 3 })
    expect(r.trials).toBe(3)
    expect(r.stoppedBy).toBe('maxTrials')
    expect(oracle(r.kept)).toBe(true)
    // 3 回では最小まで行けないので、まだ削り残しがあること (打ち切りが効いている証拠)
    expect(r.kept.length).toBeGreaterThan(required.length)
  })

  it('非同期オラクルでも 1 回ずつ直列に呼ぶ (実機は並行に叩けない)', async () => {
    let running = 0
    let maxConcurrent = 0
    const r = await minimizeSubset({
      candidates: seq(16),
      oracle: async s => {
        running++
        maxConcurrent = Math.max(maxConcurrent, running)
        await new Promise(res => setTimeout(res, 0))
        running--
        return s.includes('b5')
      },
    })
    expect(maxConcurrent).toBe(1)
    expect(r.kept).toEqual(['b5'])
  })

  it('時刻源を差し替えれば所要時間を記録できる (ログ用)', async () => {
    let t = 0
    const trials: number[] = []
    await minimizeSubset({
      candidates: seq(4),
      oracle: () => { t += 10; return true },
      now: () => t,
      onTrial: x => trials.push(x.ms),
    })
    expect(trials.every(ms => ms === 10)).toBe(true)
  })
})
