// ============================================================
// 実機 ground truth fixture 回帰テスト
//
// packages/sim/test/fixtures/*.json は tools/mc-harness で
// 実機 Minecraft (Fabric 1.21.1 + fabric-carpet) から生成した
// tick 単位の期待状態系列。ここでは実機なしで sim との一致を検証する。
//
// skipUntil を付けた fixture は it.skip にする (理由は skipReason)。付ける場面は 3 つ:
//   - sim の未実装ギャップ (issue 番号や docs/research/04 §3 の ID)。直したら外す
//   - 意図的に実装しない挙動の記録 (#144・#146・#328)。実機の答えを残しておき、
//     方針を変えて実装するときに外す
//   - expect を持たない demo 用の placeholder (network-piston-be-order → R-20)
// 外すときは定義 (tools/mc-harness/fixtures/<name>.json) からも消す。生成済みだけ
// 消すと、作り直したときに skip が戻る (#216)。末尾のテストがこの食い違いを見る。
// ============================================================

import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  diffFixtureAgainstSim,
  type Fixture,
} from './fixture-runner.js'

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
/** fixture の定義 (expect なし)。generate.ts はこの項目をそのまま生成済みへ写す */
const defsDir = join(dirname(fileURLToPath(import.meta.url)), '../../../tools/mc-harness/fixtures')
const files = readdirSync(fixturesDir).filter(f => f.endsWith('.json')).sort()

describe('実機 ground truth fixtures', () => {
  it('fixture が 10 本以上コミットされている', () => {
    expect(files.length).toBeGreaterThanOrEqual(10)
  })

  for (const file of files) {
    const fx = JSON.parse(readFileSync(join(fixturesDir, file), 'utf-8')) as Fixture

    if (fx.skipUntil) {
      it.skip(`${fx.name} [skipUntil ${fx.skipUntil}] ${fx.skipReason ?? ''}`, () => {})
      continue
    }

    it(`${fx.name}: 実機の tick 系列と一致する`, () => {
      const diffs = diffFixtureAgainstSim(fx)
      const message = diffs
        .map(d =>
          `tick ${d.tick}:\n` +
          d.diffs.map(x => `  ${x.pos}: 実機=${x.expected} sim=${x.actual}`).join('\n'),
        )
        .join('\n')
      expect(diffs, message).toEqual([])
    })
  }

  it('定義のある fixture は skipUntil / skipReason が定義と同じ (作り直しで skip が戻らない)', () => {
    const keys = ['skipUntil', 'skipReason'] as const
    const mismatches = readdirSync(defsDir)
      .filter(f => f.endsWith('.json') && files.includes(f))
      .flatMap(f => {
        const def = JSON.parse(readFileSync(join(defsDir, f), 'utf-8')) as Partial<Fixture>
        const gen = JSON.parse(readFileSync(join(fixturesDir, f), 'utf-8')) as Fixture
        return keys
          .filter(k => def[k] !== gen[k])
          .map(k => `${f} の ${k}: 定義=${def[k] ?? '(なし)'} 生成済み=${gen[k] ?? '(なし)'}`)
      })
    expect(mismatches, '定義と生成済みを同じ値にする').toEqual([])
  })
})
