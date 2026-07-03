// ============================================================
// トレース出力のスナップショットテスト (I10 #18)。
//
// docs/research/08 §5 の方式: 代表 fixture のトレース (verbose=false) を
// packages/sim/test/traces/<name>.trace としてコミットし、実装変更で
// トレースが変わったら diff で検出する。
//
// トレースは状態遷移そのものではなく「schedule / execute / update 発行」の
// 系列を記録するため、fixtures.test.ts (最終状態の実機一致) と直交する。
// トレース発行はイベント発行点に副作用を入れないので、状態系列は不変
// (回帰は fixtures.test.ts が担保)。
//
// スナップショットを意図的に更新するとき:
//   npx tsx tools/mc-harness/runner/run.ts <fixture> --trace   で新トレースを確認し、
//   packages/sim/test/traces/<name>.trace を手で更新する。
// ============================================================

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { traceFixtureOnSim, type Fixture } from './fixture-runner.js'

const here = dirname(fileURLToPath(import.meta.url))
const fixturesDir = join(here, 'fixtures')
const tracesDir = join(here, 'traces')

/** '#' コメント行と空行を除いた実イベント行のみを返す */
function eventLines(text: string): string[] {
  return text
    .split('\n')
    .map(l => l.replace(/\r$/, ''))
    .filter(l => l.trim().length > 0 && !l.startsWith('#'))
}

const cases = [
  'lever-wire-lamp',
  'repeater-delay-2',
  'piston-basic',
  'short-pulse-repeater',
]

describe('トレース記法スナップショット (docs/research/08)', () => {
  for (const name of cases) {
    it(`${name}: .trace スナップショットと一致する`, () => {
      const fx = JSON.parse(
        readFileSync(join(fixturesDir, `${name}.json`), 'utf-8'),
      ) as Fixture
      const expected = eventLines(readFileSync(join(tracesDir, `${name}.trace`), 'utf-8'))
      const actual = traceFixtureOnSim(fx)
      expect(actual).toEqual(expected)
    })
  }

  it('lever-wire-lamp: ON 経路は即時派生のみ ([PI] 1 行)', () => {
    // ランプ点灯・dust 伝播は schedule を伴わない即時派生値なので
    // トレースには PlayerInput の 1 行しか出ない (08 §5 の粒度確認)。
    const fx = JSON.parse(
      readFileSync(join(fixturesDir, 'lever-wire-lamp.json'), 'utf-8'),
    ) as Fixture
    expect(traceFixtureOnSim(fx)).toEqual(['2gt[PI]: Le{n.0}'])
  })

  it('verbose=true では updateFormula (bu) 行が追加される', () => {
    const fx = JSON.parse(
      readFileSync(join(fixturesDir, 'short-pulse-repeater.json'), 'utf-8'),
    ) as Fixture
    const plain = traceFixtureOnSim(fx)
    const verbose = traceFixtureOnSim(fx, { verbose: true })
    // verbose は process 行を全て含み、かつ bu を含む updateFormula 行が増える
    expect(verbose.length).toBeGreaterThan(plain.length)
    expect(verbose.some(l => l.includes('; {bu('))).toBe(true)
    // process 行 (gt 接頭辞付き) は verbose でも全て残る
    for (const line of plain) expect(verbose).toContain(line)
  })
})
