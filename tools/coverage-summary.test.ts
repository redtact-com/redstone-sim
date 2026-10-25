import { describe, it, expect } from 'vitest'
// @ts-expect-error 型定義の無い .mjs (tools/coverage-summary.mjs)
import { summarize } from './coverage-summary.mjs'

/**
 * coverage ジョブの job summary に出す表 (#420)。
 * coverage-summary.json のキーは絶対パスなので、root からの相対で領域に振り分ける。
 */

const n = (covered: number, total: number) => ({ covered, total, skipped: 0, pct: 0 })
const entry = (l: [number, number], b: [number, number], f: [number, number]) => ({
  lines: n(...l), statements: n(...l), branches: n(...b), functions: n(...f),
})

describe('tools/coverage-summary.mjs (#420)', () => {
  const root = '/repo'
  const summary = {
    total: entry([13, 20], [5, 8], [3, 6]),
    '/repo/packages/sim/src/world.ts': entry([8, 10], [3, 4], [2, 3]),
    '/repo/packages/sim/src/rail.ts': entry([2, 2], [1, 1], [1, 1]),
    '/repo/app/src/App.tsx': entry([0, 5], [0, 2], [0, 1]),
    '/repo/tools/mc-harness/runner/run.ts': entry([3, 3], [1, 1], [0, 1]),
    // 領域に当たらないファイルは表に足さない (合計は total をそのまま使う)
    '/repo/other/x.ts': entry([0, 100], [0, 100], [0, 100]),
  }

  it('領域ごとにファイル数と行・分岐・関数を足し上げる', () => {
    const lines: string[] = summarize(summary, root)
    expect(lines.slice(0, 4)).toEqual([
      '### カバレッジ (vitest)',
      '',
      '| 領域 | ファイル | 行 | 分岐 | 関数 |',
      '|---|---:|---:|---:|---:|',
    ])
    expect(lines.slice(4)).toEqual([
      '| packages/sim/ | 2 | 83.3% (10/12) | 80.0% (4/5) | 75.0% (3/4) |',
      '| packages/editor/ | 0 | - | - | - |',
      '| packages/viewer/ | 0 | - | - | - |',
      '| app/ | 1 | 0.0% (0/5) | 0.0% (0/2) | 0.0% (0/1) |',
      '| tools/mc-harness/ | 1 | 100.0% (3/3) | 100.0% (1/1) | 0.0% (0/1) |',
      '| 合計 | 4 | 65.0% (13/20) | 62.5% (5/8) | 50.0% (3/6) |',
    ])
  })
})
