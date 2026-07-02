// ============================================================
// 実機 ground truth fixture 回帰テスト
//
// packages/sim/test/fixtures/*.json は tools/mc-harness で
// 実機 Minecraft (Fabric 1.21.1 + fabric-carpet) から生成した
// tick 単位の期待状態系列。ここでは実機なしで sim との一致を検証する。
//
// skipUntil 付き fixture は既知の未実装ギャップ (docs/research/04 §3 の
// issue ID) で不一致になることが実機で確認済みのもの。該当 issue の
// 実装時に skipUntil を外して通過させる。
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
})
