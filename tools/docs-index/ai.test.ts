import { describe, it, expect } from 'vitest'
import { DOCS_DATA_VERSION } from '../../packages/docs-kit/src/index.js'
import {
  BLOCKS_FILE, loadBlocksTable, lookupBlock, lookupClass, lookupFixture, normalizeKey,
  NOT_IN_BLOCK_TABLE, NOT_IN_CLASS_TABLE,
} from './ai.js'
import type { ByBlock, ByClass, ByFixture, JsonlRow } from './ai.js'
import { buildDocsFromRepoCached, readSectionIds, repoRoot } from './build.js'

/** AI 向けの索引 (#434): JSONL・逆引き 3 本・README・ブロックの手書きの表 */

describe('sections.jsonl', () => {
  const build = buildDocsFromRepoCached()
  const lines = build.files.get('ai/sections.jsonl')!.split('\n').filter(Boolean)
  const rows = lines.map(l => JSON.parse(l) as JsonlRow)

  it('1,383 行で、ID が節の ID の一覧と一致する', () => {
    expect(rows).toHaveLength(1383)
    expect(rows.map(r => r.id)).toEqual(readSectionIds(repoRoot))
  })

  it('欄がそろっていて、本文は md のまま', () => {
    for (const r of rows) {
      expect(Object.keys(r), r.id).toEqual([
        'id', 'page', 'file', 'line', 'level', 'title', 'path', 'text',
        'classes', 'fixtures', 'skipFixtures', 'marks', 'refs', 'blocks', 'summary', 'aliases',
      ])
    }
    const r = rows.find(x => x.id === 'v07/4.3')!
    expect(r.file).toBe('docs/vanilla/07_diodes.md')
    expect(r.text).toContain('shouldTurnOn')
    expect(r.text).toContain('|')            // 表は md のまま
    expect([r.summary, r.aliases]).toEqual(['', []])
    // 1 行 1 件 (本文の改行は JSON の中で逃がしてある)
    expect(lines.every(l => l.startsWith('{"id":"') && l.endsWith('}'))).toBe(true)
  })

  it('skip つきの fixture を引く節には印が入る (6 本)', () => {
    const byFixture = JSON.parse(build.files.get('ai/by-fixture.json')!) as ByFixture
    const skipped = Object.entries(byFixture.fixtures).filter(([, f]) => f.skip !== undefined).map(([n]) => n).sort()
    expect(skipped).toHaveLength(6)
    const marked = rows.filter(r => r.skipFixtures.length > 0)
    expect([...new Set(marked.flatMap(r => r.skipFixtures))].sort()).toEqual(skipped)
    // 印は fixtures の中の名前だけで、skip つきを引く節は全部印を持つ
    for (const r of rows) {
      expect(r.skipFixtures, r.id).toEqual(r.fixtures.filter(n => skipped.includes(n)))
    }
    expect(marked.map(r => r.id).sort()).toEqual([...new Set(skipped.flatMap(n => byFixture.fixtures[n].sections))].sort())
  })

  it('節にクラスとブロックが入る。メモ全体が担当の物は前置きの節', () => {
    const intro = rows.find(x => x.id === 'v07/0')!
    expect(intro.classes).toEqual(expect.arrayContaining(['RepeaterBlock', 'ComparatorBlock', 'DiodeBlock']))
    expect(intro.blocks).toEqual(expect.arrayContaining(['repeater', 'comparator']))
    expect(rows.find(x => x.id === 'v14/4.10')!.classes).toEqual(expect.arrayContaining(['AbstractFurnaceBlock', 'BarrelBlock']))
    expect(rows.find(x => x.id === 'v13/4.6')!.fixtures.length).toBeGreaterThan(0)
    expect(rows.filter(r => r.classes.length > 0).length).toBeGreaterThan(150)
  })
})

describe('by-class.json (00 の網羅表)', () => {
  const build = buildDocsFromRepoCached()
  const { coverage } = build.ai
  const byClass = JSON.parse(build.files.get('ai/by-class.json')!) as ByClass
  const ids = new Set(build.records.map(r => r.id))
  const docs = new Set(build.manifest.docs.map(d => d.key))

  it('担当欄の参照を全部解く', () => {
    // 方針の調査では 740 件中 739 件。番号だけのメモ (`07`・`04・05`) を 1 件ずつ数えると 752 件で、全部解ける
    expect(coverage.missing).toEqual([])
    expect(coverage.resolved).toBe(coverage.refs)
    expect(coverage.refs).toBeGreaterThanOrEqual(739)
    expect(byClass.v).toBe(DOCS_DATA_VERSION)
    expect(byClass.source).toBe('docs/vanilla/00_coverage.md')
  })

  it('行は 582。記述済は必ず節かメモを引き、対象外は引かない', () => {
    const all = Object.entries(byClass.classes)
    expect(all).toHaveLength(582)
    expect(coverage.rows.map(r => r.name).filter((n, i, a) => a.indexOf(n) !== i)).toEqual([])
    const done = all.filter(([, c]) => c.state === '記述済')
    expect(done).toHaveLength(511)
    expect(done.filter(([, c]) => c.docs.length + c.sections.length === 0).map(([n]) => n)).toEqual([])
    expect(all.filter(([, c]) => c.state !== '記述済' && c.docs.length + c.sections.length > 0).map(([n]) => n)).toEqual([])
    expect(new Set(all.map(([, c]) => c.state))).toEqual(new Set(['記述済', '対象外']))
  })

  it('引いた ID は全部実在する (節・メモ・補助)', () => {
    const bad: string[] = []
    for (const [name, c] of Object.entries(byClass.classes)) {
      for (const d of c.docs) if (!docs.has(d)) bad.push(`${name}: ${d}`)
      for (const s of [...c.sections, ...c.mentions, c.row]) if (!ids.has(s)) bad.push(`${name}: ${s}`)
    }
    expect(bad).toEqual([])
  })

  it('読み方: 番号だけ = メモ全体・連結の引き継ぎ・付録・パスつきの行', () => {
    const c = byClass.classes
    expect(c.RepeaterBlock).toMatchObject({ docs: ['v07'], sections: [], state: '記述済', owner: '07', row: 'v00/4.1' })
    expect(c.Block.docs).toEqual(['v04', 'v05'])
    expect(c.AbstractFurnaceBlock.sections).toEqual(['v14/4.10', 'v14/4.1', 'v14/4.9'])
    expect(c.BarrelBlock.sections).toEqual(['v14/4.10', 'v02/4.9', 'v03/4.8'])
    expect(c.AttachedStemBlock.sections).toEqual(['v05/app-B.13', 'v05/app-C.1', 'v11/app-F.2'])
    expect(c.HopperBlockEntity).toMatchObject({ written: 'entity/HopperBlockEntity', docs: ['v14'], sections: ['v12/4.12', 'v17/4.9'] })
    // 網羅表の行は md の行を指す
    const src = build.model.docs.find(d => d.source.key === 'v00')!.source.text.split('\n')
    expect(src[c.RepeaterBlock.line - 1]).toMatch(/^\| RepeaterBlock \|/)
    expect(src[c.HopperBlockEntity.line - 1]).toMatch(/^\| entity\/HopperBlockEntity \|/)
  })

  it('族: 裸の F4 は 00 §1.4 の節に開く。括弧の中の族は注記なので開かない', () => {
    const c = byClass.classes
    expect([...coverage.families.keys()]).toEqual(['F1', 'F2', 'F3', 'F4', 'F5', 'F6'])
    expect(coverage.families.get('F4')).toEqual(['v02/4.9', 'v16/4.11'])
    expect(c.BarrierBlock).toMatchObject({ families: ['F4'], sections: ['v02/4.9', 'v16/4.11'] })
    // 「05 付録 C.1 (F3: …)・F4」: F3 は開かず、F4 だけ開く
    expect(c.AmethystClusterBlock).toMatchObject({ families: ['F4'], sections: ['v05/app-C.1', 'v02/4.9', 'v16/4.11'] })
  })

  it('補助の欄は、担当の節と網羅表を含まない', () => {
    const c = byClass.classes.RepeaterBlock
    expect(c.mentions).toContain('v07/4.3')
    expect(c.mentions.some(id => id.startsWith('v00/'))).toBe(false)
    const f = byClass.classes.AbstractFurnaceBlock
    expect(f.mentions.filter(id => f.sections.includes(id))).toEqual([])
  })
})

describe('by-fixture.json', () => {
  const build = buildDocsFromRepoCached()
  const byFixture = JSON.parse(build.files.get('ai/by-fixture.json')!) as ByFixture

  it('110 本・引く節は 103。skip つきの 6 本には理由が入る', () => {
    const all = Object.entries(byFixture.fixtures)
    expect(all).toHaveLength(110)
    expect(new Set(all.flatMap(([, f]) => f.sections)).size).toBe(103)
    const skipped = all.filter(([, f]) => f.skip !== undefined)
    expect(skipped).toHaveLength(6)
    expect(skipped.every(([, f]) => typeof f.skip === 'string' && f.skip.length > 0)).toBe(true)
    expect(all.filter(([, f]) => f.entities).length).toBe(5)
    expect(all.filter(([, f]) => !f.embed).map(([n]) => n)).toEqual(['door-5x5-kurigohan'])
    expect(byFixture.fixtures['piston-basic']).toMatchObject({ file: 'packages/sim/test/fixtures/piston-basic.json' })
    expect(byFixture.fixtures['piston-basic'].sections).toContain('v03/2.3')
  })

  it('目次の fixture の目録と同じ中身', () => {
    for (const [name, f] of Object.entries(byFixture.fixtures)) {
      expect(f, name).toMatchObject(build.manifest.fixtures[name])
    }
  })
})

describe('ブロックの手書きの表 (blocks.json) と by-block.json', () => {
  const build = buildDocsFromRepoCached()
  const { ai, model } = build
  const table = loadBlocksTable(repoRoot)
  const byBlock = JSON.parse(build.files.get('ai/by-block.json')!) as ByBlock
  const classes = build.ai.byClass.classes

  it('クラス名は全部 00 の網羅表にあり、記述済', () => {
    const bad: string[] = []
    for (const row of table.blocks) {
      for (const c of row.classes) {
        if (!classes[c]) bad.push(`${row.ids[0]}: ${c} は網羅表に無い`)
        else if (classes[c].state !== '記述済') bad.push(`${row.ids[0]}: ${c} は ${classes[c].state}`)
      }
    }
    expect(bad, `${BLOCKS_FILE}\n${bad.join('\n')}`).toEqual([])
  })

  it('レッドストーン部品だけ (60〜90 行)。ID と和名は行の間で重ならない', () => {
    expect(table.blocks.length).toBeGreaterThanOrEqual(60)
    expect(table.blocks.length).toBeLessThanOrEqual(90)
    // 同じ行の中の重なり (ID `tnt` と和名 `TNT`) は数えない
    const keys = table.blocks.flatMap(r => [...new Set([...r.ids, ...r.ja].map(normalizeKey))])
    expect(keys.filter((k, i) => keys.indexOf(k) !== i)).toEqual([])
    for (const row of table.blocks) {
      expect(row.ids.length, JSON.stringify(row)).toBeGreaterThan(0)
      expect(row.ja.length, row.ids[0]).toBeGreaterThan(0)
      expect(row.classes.length, row.ids[0]).toBeGreaterThan(0)
      for (const id of row.ids) expect(id).toMatch(/^[a-z0-9_]+$/)
      if (row.suffix !== undefined) expect(row.suffix).toMatch(/^_[a-z0-9_]+$/)
    }
    expect(Object.keys(byBlock.blocks)).toHaveLength(table.blocks.length)
  })

  it('どの行も、節かメモを 1 つ以上引く。引いた ID は実在する', () => {
    const ids = new Set(build.records.map(r => r.id))
    const docs = new Set(build.manifest.docs.map(d => d.key))
    for (const [name, b] of Object.entries(byBlock.blocks)) {
      expect(b.docs.length + b.sections.length, name).toBeGreaterThan(0)
      expect([...b.sections.filter(s => !ids.has(s)), ...b.docs.filter(d => !docs.has(d))], name).toEqual([])
    }
  })

  it('エディタが扱う部品 (README の対応ブロック) は表にある', () => {
    const want = [
      'lever', 'stone_button', 'oak_button', 'stone_pressure_plate', 'light_weighted_pressure_plate', 'target',
      'redstone_wire', 'redstone_torch', 'redstone_wall_torch', 'repeater', 'comparator',
      'redstone_lamp', 'note_block', 'piston', 'sticky_piston', 'observer', 'redstone_block',
      'slime_block', 'honey_block', 'rail', 'powered_rail', 'activator_rail', 'detector_rail',
      'hopper', 'dropper', 'chest', 'barrel',
    ]
    expect(want.filter(id => !lookupBlock(ai, model, id).found)).toEqual([])
  })

  it('ID・和名・minecraft: つき・語尾で引ける', () => {
    const name = (key: string) => { const r = lookupBlock(ai, model, key); return r.found ? r.block : null }
    expect(name('repeater')).toBe('repeater')
    expect(name('minecraft:repeater')).toBe('repeater')
    expect(name('Repeater')).toBe('repeater')
    expect(name('リピーター')).toBe('repeater')
    expect(name('レッドストーンリピーター')).toBe('repeater')
    expect(name('cherry_button')).toBe('stone_button')
    expect(name('waxed_oxidized_copper_bulb')).toBe('copper_bulb')
    expect(name('sticky piston')).toBe('sticky_piston')
    // 語尾より、ID の一致が先 (重量感圧板は `_pressure_plate` で終わる)
    expect(name('heavy_weighted_pressure_plate')).toBe('light_weighted_pressure_plate')
    expect(name('bamboo_pressure_plate')).toBe('stone_pressure_plate')
  })

  it('引いた結果は、節の ID と file:line を持つ', () => {
    const r = lookupBlock(ai, model, 'repeater')
    if (!r.found) throw new Error('repeater が表に無い')
    expect(r.entry.classes).toEqual(['RepeaterBlock', 'DiodeBlock'])
    expect(r.sections[0]).toEqual({
      id: 'v07/0', page: 'v07/0', title: '07. リピーター・コンパレーター (ダイオード)',
      file: 'docs/vanilla/07_diodes.md', line: 1, where: 'docs/vanilla/07_diodes.md:1', whole: true,
    })
    expect(r.mentions.map(p => p.id)).toContain('v07/4.3')
    const h = lookupBlock(ai, model, 'hopper')
    if (!h.found) throw new Error('hopper が表に無い')
    expect(h.sections.map(p => p.id)).toEqual(expect.arrayContaining(['v14/0', 'v12/4.12', 'v17/4.9']))
    for (const p of h.sections) expect(p.where).toMatch(/^docs\/vanilla\/[\w.-]+\.md:\d+$/)
  })

  it('表に無いブロックは、空ではなく「表に無い」を返す', () => {
    for (const key of ['dirt', 'minecraft:oak_planks', '土', '']) {
      const r = lookupBlock(ai, model, key)
      expect(r.found, key).toBe(false)
      if (!r.found) {
        expect(r.note).toBe(NOT_IN_BLOCK_TABLE)
        expect(r.note).toContain('表に無い')
        expect(r.note).toContain('メモに記述が無いという意味ではない')
        expect(r.known).toBe(table.blocks.length)
      }
    }
  })

  it('クラスと fixture も、無い時は「表に無い」を返す', () => {
    const c = lookupClass(ai, model, 'NoSuchBlock')
    expect(c).toMatchObject({ found: false, note: NOT_IN_CLASS_TABLE })
    const near = lookupClass(ai, model, 'Repeat')
    expect(near.found === false && near.near).toContain('RepeaterBlock')
    expect(lookupClass(ai, model, 'repeaterblock')).toMatchObject({ found: true, class: 'RepeaterBlock' })
    expect(lookupClass(ai, model, 'entity/HopperBlockEntity')).toMatchObject({ found: true, class: 'HopperBlockEntity' })
    // 対象外のクラスは「ある」が、節は引かない
    const out = lookupClass(ai, model, 'BeaconBlock')
    expect(out.found && out.entry.state).toBe('対象外')
    expect(out.found && out.sections).toEqual([])
    const f = lookupFixture(ai, 'no-such-fixture')
    expect(f.found).toBe(false)
    expect(lookupFixture(ai, 'piston-basic.json')).toMatchObject({ found: true, fixture: 'piston-basic' })
  })
})

describe('ai/README.md', () => {
  it('欄の説明と引き方がある。数は実物と合う', () => {
    const build = buildDocsFromRepoCached()
    const text = build.files.get('ai/README.md')!
    for (const word of ['sections.jsonl', 'by-class.json', 'by-fixture.json', 'by-block.json', '表に無い', 'npm run docs:search', '1383 行', '110 本']) {
      expect(text, word).toContain(word)
    }
    for (const key of ['id', 'page', 'file', 'level', 'title', 'path', 'text', 'classes', 'fixtures', 'marks', 'refs', 'blocks', 'summary']) {
      expect(text, key).toContain(`\`${key}\``)
    }
    expect([...build.files.keys()].filter(k => k.startsWith('ai/')).sort()).toEqual([
      'ai/README.md', 'ai/by-block.json', 'ai/by-class.json', 'ai/by-fixture.json', 'ai/sections.jsonl',
    ])
  })
})
