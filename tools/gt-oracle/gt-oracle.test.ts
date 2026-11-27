import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  buildDatapack, buildPlan, definitionsDir, FROZEN_RULES, harnessDefinitionsDir, resolveDefinition, unsupported,
  type Definition,
} from './gen-datapack.js'
import { resultToFixture, type OracleResult } from './to-fixture.js'
import { diffAgainstBaseline, diffRuns, formatBaselineReport } from './compare.js'
import { parseBundleList } from './fetch-jar.js'
import type { Fixture } from '../../packages/sim/test/fixture-runner.js'

// 実機 (26.3 の jar) を使わずに確かめられる部分だけを見る。
// 撮る所は tools/gt-oracle/run.sh を手元で回して確かめる (CI では動かさない。EULA の同意が要る)

const lamp = resolveDefinition('lamp-off-delay')

describe('定義 (tools/gt-oracle/definitions)', () => {
  it('1.21.1 の定義と player と mcVersion のほかは同じ (同じ回路で比べる)', () => {
    for (const f of readdirSync(definitionsDir).filter(n => n.endsWith('.json'))) {
      const ours = JSON.parse(readFileSync(join(definitionsDir, f), 'utf-8')) as Definition
      const theirs = JSON.parse(readFileSync(join(harnessDefinitionsDir, f), 'utf-8')) as Definition
      const { player: _p, mcVersion: _a, ...a } = theirs
      const { mcVersion: _b, ...b } = ours
      expect(b, f).toEqual(a)
      expect(ours.mcVersion, f).toBe('26.3')
    }
  })

  it('gt-oracle の定義を先に探し、無ければ今のハーネスの定義を使う', () => {
    expect(lamp.source).toBe('tools/gt-oracle/definitions/lamp-off-delay.json')
    expect(resolveDefinition('repeater-chain-off').source).toBe('tools/mc-harness/fixtures/repeater-chain-off.json')
    expect(() => resolveDefinition('no-such-fixture')).toThrow('定義が無い')
  })
})

describe('O1 で撮れない定義を先に止める', () => {
  const base = lamp.def
  it('縦切りの 2 本は撮れる', () => {
    expect(unsupported(base)).toEqual([])
    expect(unsupported(resolveDefinition('lever-wire-lamp').def)).toEqual([])
  })
  it('step・lectern・レバーの setblock・注入は止める', () => {
    expect(unsupported({ ...base, inputs: [{ tick: 1, pos: [0, 1, 0], action: 'step' }] })[0]).toContain('step')
    expect(unsupported({
      ...base, inputs: [{ tick: 1, pos: [0, 1, 0], action: 'setblock', block: 'lever[face=floor,facing=north,powered=true]' }],
    })[0]).toContain('支えブロック')
    expect(unsupported({
      ...base, inputs: [{ tick: 1, pos: [0, 1, 0], action: 'setblock', block: 'redstone_block' }],
    })).toEqual([])
    expect(unsupported({ ...base, blocks: [{ pos: [0, 0, 0], block: 'lectern', lectern: { page: 0, pages: 3 } }] })).toHaveLength(1)
    expect(unsupported({ ...base, trustAuthored: true })).toHaveLength(1)
  })
})

describe('データパック', () => {
  const plan = buildPlan('26.3', [lamp])
  const pack = buildDatapack(121, plan.maxTicks)

  it('pack.mcmeta は min_format と max_format で書く', () => {
    expect(pack['pack.mcmeta']).toMatchObject({ pack: { min_format: 121, max_format: 121 } })
  })
  it('テスト環境で時刻・天気・湧き・ランダム tick・延焼を止める', () => {
    expect(pack['data/gt_oracle/test_environment/frozen.json']).toEqual({ type: 'minecraft:game_rules', rules: FROZEN_RULES })
    expect(FROZEN_RULES['minecraft:random_tick_speed']).toBe(0)
  })
  it('テストは Java の関数を 1 本呼び、時間切れは Driver の予算より後に来る', () => {
    const inst = pack['data/gt_oracle/test_instance/drive.json'] as Record<string, unknown>
    expect(inst).toMatchObject({ type: 'minecraft:function', function: 'gt_oracle:drive', structure: 'minecraft:empty', required: true })
    expect(inst.max_ticks as number).toBeGreaterThan(plan.budgetTicks)
  })
  it('計画は定義から player を外し、どこから読んだかを持つ', () => {
    expect(plan.fixtures[0]).not.toHaveProperty('player')
    expect(plan.fixtures[0].source).toBe(lamp.source)
    expect(plan.wallLimitMs).toBeGreaterThan(0)
  })
})

describe('bundler の一覧', () => {
  it('sha256・ID・パスのタブ区切りを読む', () => {
    expect(parseBundleList('aa\tcom.example:x:1\tcom/example/x-1.jar\n')).toEqual([
      { sha256: 'aa', id: 'com.example:x:1', path: 'com/example/x-1.jar' },
    ])
    expect(() => parseBundleList('aa com.example:x:1')).toThrow()
  })
})

// lamp-off-delay の実機の結果を模した物。文字列は Driver が書く形 (名前空間つき・キーは状態の定義の順)
function fakeResult(overrides: { tick14Lamp?: string } = {}): OracleResult {
  const plan = buildPlan('26.3', [lamp])
  const def = plan.fixtures[0]
  const base: Record<string, string> = {}
  for (const b of def.blocks) base[b.pos.join(',')] = `minecraft:${b.block}`
  const wire = (p: number) => `minecraft:redstone_wire[east=side,north=none,power=${p},south=none,west=side]`
  const on = {
    ...base,
    '0,1,0': 'minecraft:lever[face=floor,facing=north,powered=true]',
    '1,1,0': wire(15), '2,1,0': wire(14), '3,1,0': wire(13),
    '4,1,0': 'minecraft:redstone_lamp[lit=true]',
  }
  const off = { ...on, '0,1,0': base['0,1,0'], '1,1,0': wire(0), '2,1,0': wire(0), '3,1,0': wire(0) }
  const ticks = []
  for (let t = -1; t <= def.ticks; t++) {
    let blocks: Record<string, string> = t < 2 ? base : t < 10 ? on : off
    if (t >= 14) blocks = { ...blocks, '4,1,0': overrides.tick14Lamp ?? 'minecraft:redstone_lamp[lit=false]' }
    ticks.push({ tick: t, gameTime: 1000 + t, blocks })
  }
  return {
    name: def.name, oracle: 'gt-oracle', mc: '26.3', dataVersion: 5023,
    placedGameTime: 991, startGameTime: 999, chunkWaitTicks: 0, chunkWaitMs: 0, wallMs: 1,
    inputs: [{ tick: 2, action: 'use', result: 'Success', gameTime: 1002 }], ticks,
  }
}

const baseline121 = JSON.parse(readFileSync(
  join(definitionsDir, '..', '..', '..', 'packages', 'sim', 'test', 'fixtures', 'lamp-off-delay.json'), 'utf-8')) as Fixture

describe('結果を fixture の形に写す', () => {
  const def = buildPlan('26.3', [lamp]).fixtures[0]
  const meta = { at: '2026-11-27T00:00:00.000Z', commit: 'abc1234' }

  it('expect は名前空間を外した書く形で、1.21.1 の expect と同じ形になる', () => {
    const { fixture, settle } = resultToFixture(def, fakeResult(), meta)
    expect(settle).toEqual([])
    expect(fixture.expect).toEqual(baseline121.expect)
    expect(fixture.blocks).toEqual(baseline121.blocks)
  })
  it('版と採取系と startGameTime を書く', () => {
    const { fixture } = resultToFixture(def, fakeResult(), meta)
    expect(fixture.mcVersion).toBe('26.3')
    expect(fixture.generated).toEqual({
      at: meta.at, mc: '26.3', carpet: 'none', oracle: { name: 'gt-oracle', commit: 'abc1234', dataVersion: 5023 },
    })
    expect(fixture.startGameTime).toBe(999)
    expect(fixture).not.toHaveProperty('source')
  })
  it('settle 後が定義と違えば座標つきで返す', () => {
    const r = fakeResult()
    r.ticks[0] = { ...r.ticks[0], blocks: { ...r.ticks[0].blocks, '4,1,0': 'minecraft:redstone_lamp[lit=true]' } }
    expect(resultToFixture(def, r, meta).settle).toEqual([
      { pos: '4,1,0', authored: 'redstone_lamp[lit=false]', settled: 'redstone_lamp[lit=true]' },
    ])
  })
  it('オラクルが失敗した結果は写さない', () => {
    expect(() => resultToFixture(def, { ...fakeResult(), error: 'boom' }, meta)).toThrow('失敗')
  })
})

describe('1.21.1 の expect と比べる', () => {
  const def = buildPlan('26.3', [lamp]).fixtures[0]
  const meta = { at: '2026-11-27T00:00:00.000Z', commit: 'abc1234' }

  it('差が無ければ「無い」と出る', () => {
    const { fixture } = resultToFixture(def, fakeResult(), meta)
    const rows = diffAgainstBaseline(baseline121, fixture as unknown as Fixture)
    expect(rows).toEqual([])
    expect(formatBaselineReport('lamp-off-delay', '1.21.1', '26.3', rows)).toContain('差は無い')
  })
  it('差は tick・座標・期待・実際で出る', () => {
    const { fixture } = resultToFixture(def, fakeResult({ tick14Lamp: 'minecraft:redstone_lamp[lit=true]' }), meta)
    const rows = diffAgainstBaseline(baseline121, fixture as unknown as Fixture)
    expect(rows[0]).toEqual({ tick: 14, pos: '4,1,0', expected: 'redstone_lamp[lit=false]', actual: 'redstone_lamp[lit=true]' })
    expect(rows).toHaveLength(def.ticks - 14 + 1)
    const text = formatBaselineReport('lamp-off-delay', '1.21.1', '26.3', rows)
    expect(text).toContain('| tick | 座標 | 期待 (1.21.1) | 実際 (26.3) |')
    expect(text).toContain('| 14 | 4,1,0 | redstone_lamp[lit=false] | redstone_lamp[lit=true] |')
  })
})

describe('2 回の結果を比べる', () => {
  it('ブロックと入力の効き方が同じなら一致。gameTime と所要時間は見ない', () => {
    const a = fakeResult()
    const b = { ...fakeResult(), wallMs: 99, startGameTime: 5, ticks: fakeResult().ticks.map(t => ({ ...t, gameTime: t.gameTime + 7 })) }
    b.inputs = b.inputs.map(i => ({ ...i, gameTime: 42 }))
    expect(diffRuns('lamp-off-delay', a, b)).toEqual([])
  })
  it('違う所を tick と座標で出す', () => {
    const rows = diffRuns('lamp-off-delay', fakeResult(), fakeResult({ tick14Lamp: 'minecraft:redstone_lamp[lit=true]' }))
    expect(rows[0]).toMatchObject({ tick: 14, what: '4,1,0' })
    expect(diffRuns('x', fakeResult(), undefined)[0].what).toBe('結果')
  })
})
