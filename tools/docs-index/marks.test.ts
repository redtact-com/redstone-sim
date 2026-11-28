import { describe, it, expect } from 'vitest'
import { buildDocsFromRepoCached, repoRoot } from './build.js'
import { FIXTURE_EMBED_MAX_BLOCKS, fixturesIn, loadFixtures, parseFixtureTag } from './fixtures.js'
import { countMarks, findMarks, stripMarks } from './marks.js'

const KNOWN = new Set(['piston-basic', 'torch-clock', 'observer-4tick-clock', 'rail-powered-chain'])

describe('印 (#434)', () => {
  it('決めた語だけを拾い、添字や状態の角括弧は拾わない', () => {
    const text = '値は a[t] と b[4] と lever[powered=true]。[26.3 読解: DiodeBlock#tick] [要実機] [版差 1.21.1: 出る] [推定] [ライブラリ実測] [要検証: 版による]'
    expect(findMarks(text).map(h => h.kind)).toEqual(['read', 'need', 'ver', 'guess', 'meas', 'check'])
    expect(findMarks('[t] [4] [0, 1, 2] [API] [実機で確かめた] [確定申告]')).toEqual([])
  })

  it('印の中の文と位置を返す', () => {
    const [h] = findMarks('前 [実機 1.21.1: piston-basic] 後')
    expect(h).toEqual({ kind: 'fx', inner: '実機 1.21.1: piston-basic', start: 2, end: 27 })
  })

  it('見出しから印を外す', () => {
    expect(stripMarks('2.1.1 全体 [確定: get_catalog_overview、2026-11-26]')).toBe('2.1.1 全体')
    expect(stripMarks('P-11 撤去 [版差 1.21.1] の時点')).toBe('P-11 撤去 の時点')
    expect(stripMarks('配列 a[t] の読み方')).toBe('配列 a[t] の読み方')
  })

  it('コードフェンスの中は数えない', () => {
    expect(countMarks('[要実機]\n```\n[要実機]\n```\n[要実機] [版差 26.2]')).toEqual({ need: 2, ver: 1 })
  })

  it('実物: 印の数', () => {
    const { manifest } = buildDocsFromRepoCached()
    const total: Record<string, number> = {}
    for (const p of manifest.pages) for (const [k, n] of Object.entries(p.marks)) total[k] = (total[k] ?? 0) + n
    // 凡例の印 (メモの頭の「確かさの表記は次のとおり」の箇条書きや表・README §4) は数えない
    expect(total).toEqual(TOTAL)
  })

  it('実物: 凡例の印はバッジにするが、節の印には入れない', () => {
    const build = buildDocsFromRepoCached()
    // メモの前置きの節は、凡例のほかに [要実機]・[版差]・[実機] を持たない
    const intros = build.records.filter(r => r.level === 1)
    expect(intros).toHaveLength(24)
    for (const r of intros) {
      for (const kind of ['need', 'ver', 'fx'] as const) expect(r.marks, `${r.id} ${kind}`).not.toContain(kind)
    }
    expect(build.records.find(r => r.id === 'v-readme/4')!.marks).toEqual([])
    // バッジは残る (v07 の前置きの 4 行・v09 と v11 は表)
    for (const id of ['v07/0', 'v09/0', 'v11/0']) {
      expect(build.pages.get(id)!.html, id).toContain('<span class="mk mk-need">要実機</span>')
      expect(build.pages.get(id)!.marks, id).toEqual({})
    }
    // 凡例でない前置きの印は数える (00 の「すべて 26.3 のコードを読んで確かめた」)
    expect(build.pages.get('v00/0')!.marks).toEqual({ read: 1 })
    // 本文の印は変わらない
    expect(build.records.find(r => r.id === 'v07/4.3')!.marks).toContain('read')
  })
})

/** 印の数 (凡例を除く) */
const TOTAL = { read: 632, need: 236, fx: 189, ver: 122, sure: 21, meas: 21, guess: 11, check: 14 }

describe('fixture のタグ (#434)', () => {
  it('複数名のタグを割る (・ , 、 /)', () => {
    expect(parseFixtureTag('実機 1.21.1: piston-basic・torch-clock', KNOWN).names).toEqual(['piston-basic', 'torch-clock'])
    expect(parseFixtureTag('実機 1.21.1: piston-basic, torch-clock', KNOWN).names).toEqual(['piston-basic', 'torch-clock'])
    expect(parseFixtureTag('実機 1.21.1: piston-basic / torch-clock、observer-4tick-clock', KNOWN).names)
      .toEqual(['piston-basic', 'torch-clock', 'observer-4tick-clock'])
    expect(parseFixtureTag('実機 1.21.1: piston-basic (t5 で着地)', KNOWN).names).toEqual(['piston-basic'])
  })

  it('凡例とまとめ書きは外し、実在しない名前は別に返す', () => {
    for (const legend of ['実機 1.21.1: 名前', '実機 1.21.1: fixture 名', '実機 1.21.1: name', '実機 1.21.1: rail-* 名', '実機 1.21.1: rail-*']) {
      expect(parseFixtureTag(legend, KNOWN), legend).toEqual({ names: [], unknown: [] })
    }
    expect(parseFixtureTag('実機 1.21.1: piston-basik', KNOWN)).toEqual({ names: [], unknown: ['piston-basik'] })
    // 実機の印でなければ何も返さない
    expect(parseFixtureTag('要実機: piston-basic', KNOWN)).toEqual({ names: [], unknown: [] })
  })

  it('本文から拾う (添字とフェンスの中は拾わない)', () => {
    const text = 'a[t] は [実機 1.21.1: piston-basic]。\n```\n[実機 1.21.1: torch-clock]\n```\n[実機 1.21.1: piston-basic・rail-powered-chain]'
    expect(fixturesIn(text, KNOWN)).toEqual({ names: ['piston-basic', 'rail-powered-chain'], unknown: [] })
  })

  it('実物: 実在しない名前は 0', () => {
    expect(buildDocsFromRepoCached().stats.unknownFixtures).toEqual([])
  })

  it(`実物: 埋め込む fixture の一覧 (109 本) は固定で、全部 ${FIXTURE_EMBED_MAX_BLOCKS} ブロック以下`, () => {
    const { stats, manifest } = buildDocsFromRepoCached()
    expect(stats.fixturesTagged.length).toBe(110)
    expect(stats.fixturesEmbeddable).toEqual(EMBEDDABLE)
    for (const n of stats.fixturesEmbeddable) expect(manifest.fixtures[n].blocks, n).toBeLessThanOrEqual(FIXTURE_EMBED_MAX_BLOCKS)
    // 超える 1 本は「大きいので埋め込まない」と出す
    const big = stats.fixturesTagged.filter(n => !manifest.fixtures[n].embed)
    expect(big).toEqual(['door-5x5-kurigohan'])
    expect(manifest.fixtures['door-5x5-kurigohan'].blocks).toBe(476)
  })

  it('実物: skip つきとエンティティの注記', () => {
    const { manifest, stats } = buildDocsFromRepoCached()
    const tagged = stats.fixturesTagged
    expect(tagged.filter(n => manifest.fixtures[n].skip !== undefined).length).toBe(SKIPPED)
    expect(tagged.filter(n => manifest.fixtures[n].entities).length).toBe(WITH_ENTITIES)
    // fixture を引く節 (重複を除く)
    expect(new Set(tagged.flatMap(n => manifest.fixtures[n].sections)).size).toBe(SECTIONS_WITH_FIXTURE)
    for (const n of tagged) expect(manifest.fixtures[n].sections.length, n).toBeGreaterThan(0)
  })

  it('fixture の置き場を全部読める', () => {
    const all = loadFixtures(repoRoot)
    expect(all.size).toBe(150)
    expect(all.get('piston-basic')).toEqual({ blocks: 12, ticks: 16, embed: true })
  })
})

/** skip つき (今のエンジンは実機と違う)。注記つきで再生する */
const SKIPPED = 6
/** summon・item・kill の入力を含む (エンティティは描かない) */
const WITH_ENTITIES = 5
/** fixture を引く節の数 */
const SECTIONS_WITH_FIXTURE = 103

/** 埋め込む fixture (名前の順)。足す・消すときは、本文のタグと合わせてここを直す */
const EMBEDDABLE: string[] = [
  'activator-rail-chain', 'activator-rail-mixed-chain', 'barrel-comparator-input', 'bubble-column-cut',
  'bubble-column-refill', 'bubble-column-refill-fast', 'button-nc-before-shape-race', 'comparator-compare-front-nc',
  'comparator-nc-own-tick', 'comparator-side-redstone-block', 'comparator-side-reject',
  'comparator-through-conductor-replace', 'copper-bulb-output', 'copper-bulb-toggle', 'crafter-trigger',
  'destroy-push-dust', 'destroy-push-torch', 'detector-rail-cart-pulse', 'detector-rail-cart-stay',
  'detector-rail-comparator', 'dispenser-no-insert', 'door-desync', 'door-redstone', 'dropper-insert',
  'dropper-into-hopper-cooldown', 'dust-block-repeater', 'dust-cross-powering', 'dust-line-powering',
  'dust-reshape-stale-target', 'dynamic-connect-push', 'hopper-2clock', 'hopper-clock', 'hopper-lock',
  'hopper-mixed-stacks', 'instant-wire', 'lamp-off-delay', 'lever-nc-before-shape-race', 'lever-support-break',
  'nonconductor-glass-slab', 'observer-4tick-clock', 'observer-comparator-swallow', 'observer-detects-dust',
  'observer-dropper-conductor', 'observer-mutual-clock-setblock', 'observer-piston-pulse', 'observer-pulled',
  'observer-pushed', 'pane-shape-observer', 'piston-basic', 'piston-limit-12', 'piston-order-dust-locational',
  'piston-push-glazed', 'piston-push-obsidian', 'piston-transit-nc', 'powered-rail-bud', 'powered-rail-chain',
  'powered-rail-flat-step-live', 'powered-rail-priority', 'powered-rail-slope-update', 'powered-rail-step',
  'powered-rail-step-place', 'pressure-plate-stone', 'pressure-plate-wood', 'pulse-2gt-repeater-d2', 'qc-bud',
  'qc-noteblock-strong', 'rail-curve-no-slope', 'rail-curve-priority', 'rail-junction-gate',
  'rail-junction-nonsignal', 'rail-junction-place', 'rail-junction-toggle', 'rail-mixed-neighbor-shape',
  'rail-piston-push', 'rail-piston-push-connect', 'rail-piston-push-powered', 'rail-shape-chain-join',
  'rail-shape-update', 'rail-slope-support-break', 'rail-support-break', 'rblock-piston-chain',
  'redstone-block-static', 'repeater-lock', 'repeater-nc-own-tick', 'repeater-self-off-priority',
  'short-pulse-repeater', 'shulker-box-conductor', 'slime-beside-glazed', 'slime-beside-obsidian',
  'slime-pull-sticky', 'slime-push-branch', 'sticky-observer-pulse', 'sticky-pull', 'stone-button',
  'strong-charge-through-conductors', 'target-conduct', 'torch-burnout', 'torch-burnout-recovery', 'torch-clock',
  'torch-nc-own-tick', 'torch-not-floor', 'trapdoor-desync', 'trapdoor-redstone', 'two-piston-locational',
  'wall-post-cascade', 'wire-connect-detector-rail-lectern', 'wire-cut-conductor', 'wire-cut-conductor-power',
  'wire-step-nonconductor-down',
]
