import { describe, it, expect } from 'vitest'
import {
  FIXTURE_NOTE_ENTITIES, FIXTURE_NOTE_SKIP, FIXTURE_NOTE_TOO_BIG, fixtureCardHtml, fixtureCardsHtml, fixtureDataPath,
} from '../../packages/docs-kit/src/index.js'
import { FixtureRunner } from '../../packages/sim/src/index.js'
import type { Fixture } from '../../packages/sim/src/index.js'
import { buildDocs, buildDocsFromRepoCached } from './build.js'
import { FIXTURE_EMBED_MAX_BLOCKS } from './fixtures.js'
import type { FixtureMeta } from './fixtures.js'
import type { SourceFile } from './split.js'

const FIXTURES = new Map<string, FixtureMeta>([
  ['piston-basic', { blocks: 12, ticks: 16, embed: true }],
  ['torch-clock', { blocks: 11, ticks: 22, embed: true }],
  ['big-door', { blocks: 476, ticks: 120, embed: false }],
  ['odd-one', { blocks: 6, ticks: 12, embed: true, skip: '支持ブロックは "未実装" <後で>', entities: true }],
])

/** 小さな md 1 本を描いて、先頭の `##` のページの HTML を返す */
function render(body: string): string {
  const src: SourceFile = { key: 'v07', kind: 'vanilla', num: '07', file: 'docs/vanilla/07_x.md', text: `# 07. 題\n\n## 1. 節\n\n${body}\n` }
  return buildDocs([src], FIXTURES).pages.get('v07/1')!.html
}

const CARD = (name: string, meta: string) =>
  `<div class="fx-card" data-fx-card="${name}"><div class="fx-row"><span class="fx-name">${name}</span><span class="fx-meta">${meta}</span>`
  + `<button type="button" class="fx-open" data-fx-open="${name}" aria-expanded="false">表示</button></div><div class="fx-view" hidden></div></div>`

describe('fixture の札 (#434)', () => {
  it('札 1 枚: 名前・ブロック数・tick 数・「表示」と、開いた時だけ使う置き場', () => {
    expect(fixtureCardHtml('piston-basic', FIXTURES.get('piston-basic')!)).toBe(CARD('piston-basic', '12 ブロック・16 tick'))
  })

  it('上限を超える fixture の札は開けない (ボタンも置き場も無い)', () => {
    const html = fixtureCardHtml('big-door', FIXTURES.get('big-door')!)
    expect(html).toContain(`<span class="fx-big">${FIXTURE_NOTE_TOO_BIG}</span>`)
    expect(html).toContain('476 ブロック・120 tick')
    expect(html).not.toMatch(/<button|fx-view|data-fx-open/)
  })

  it('注記: skip つきは理由つき、エンティティは 1 語。理由の字は HTML として読ませない', () => {
    const html = fixtureCardHtml('odd-one', FIXTURES.get('odd-one')!)
    expect(html).toContain(`<span class="fx-note fx-note-skip" title="支持ブロックは &quot;未実装&quot; &lt;後で&gt;">${FIXTURE_NOTE_SKIP}</span>`)
    expect(html).toContain(`<span class="fx-note">${FIXTURE_NOTE_ENTITIES}</span>`)
    expect(html).toContain('data-fx-open="odd-one"')
  })

  it('札が無ければ何も出さない', () => {
    expect(fixtureCardsHtml([])).toBe('')
    expect(fixtureCardsHtml([], true)).toBe('')
  })

  it('タグのある段落の直後に札を置く。同じ段落の同じ名前は 1 枚', () => {
    const html = render('前の文 [実機 1.21.1: piston-basic] と [実機 1.21.1: piston-basic・torch-clock]。\n\n次の段落')
    expect(html).toContain(
      `</span>。</p>\n<div class="fx-cards">${CARD('piston-basic', '12 ブロック・16 tick')}${CARD('torch-clock', '11 ブロック・22 tick')}</div>\n<p>次の段落</p>`)
    // タグは小さなチップのまま
    expect(html).toContain('<span class="mk mk-fx" data-fx="piston-basic">実機 1.21.1: piston-basic</span>')
  })

  it('箇条書きは、全体が閉じた後にまとめて置く (項目の間に挟まない)', () => {
    const html = render('- 1 つ目 [実機 1.21.1: piston-basic]\n  - 子 [実機 1.21.1: torch-clock]\n- 2 つ目\n\n後ろ')
    expect(html.match(/class="fx-cards"/g)).toHaveLength(1)
    expect(html).toMatch(/<\/ul>\n<div class="fx-cards"><div class="fx-card" data-fx-card="piston-basic">.*data-fx-card="torch-clock".*<\/div>\n<p>後ろ<\/p>/s)
  })

  it('表の中のタグはチップだけで、札は表の後ろの 1 つの折りたたみにまとめる', () => {
    const html = render('| a | b |\n|---|---|\n| x [実機 1.21.1: piston-basic] | y |\n| z | [実機 1.21.1: torch-clock, piston-basic] |\n\n後ろ')
    expect(html).toMatch(/<\/table><\/div>\n<details class="fx-cards fx-fold"><summary>この表の fixture \(2 本\)<\/summary>/)
    expect(html.match(/class="fx-card"/g)).toHaveLength(2)
    // 表の中には札を入れない
    const table = html.slice(html.indexOf('<table>'), html.indexOf('</table>'))
    expect(table).not.toContain('fx-card')
    expect(table).toContain('data-fx="piston-basic"')
  })

  it('別の段落に同じ名前があれば、それぞれの直後に札を置く', () => {
    const html = render('1 [実機 1.21.1: piston-basic]\n\n2 [実機 1.21.1: piston-basic]')
    expect(html.match(/data-fx-card="piston-basic"/g)).toHaveLength(2)
  })

  it('タグの無いページには札が無い', () => {
    expect(render('本文 [要実機] だけ')).not.toContain('fx-card')
  })
})

describe('実物: 札と埋め込む fixture (#434)', () => {
  const build = buildDocsFromRepoCached()
  const html = [...build.pages.values()].map(p => p.html).join('\n')

  it(`出した物は全部 ${FIXTURE_EMBED_MAX_BLOCKS} ブロック以下で、目録の埋め込める物 (109 本) と同じ`, () => {
    const written = [...build.files.keys()].filter(k => k.startsWith('fixtures/')).sort()
    expect(written).toEqual(build.stats.fixturesEmbeddable.map(fixtureDataPath).sort())
    expect(written).toHaveLength(109)
    expect(build.stats.fixturesWritten).toEqual(build.stats.fixturesEmbeddable)
    for (const rel of written) {
      const fx = JSON.parse(build.files.get(rel)!) as Fixture
      expect(fx.blocks.length, rel).toBeLessThanOrEqual(FIXTURE_EMBED_MAX_BLOCKS)
      expect(fixtureDataPath(fx.name), rel).toBe(rel)
      expect(fx.blocks.length).toBe(build.manifest.fixtures[fx.name].blocks)
      expect(fx.ticks).toBe(build.manifest.fixtures[fx.name].ticks)
    }
    // 上限を超える 1 本は出さない
    expect(build.files.has(fixtureDataPath('door-5x5-kurigohan'))).toBe(false)
  })

  it('大きさ: 1 本ずつ軽い (詰めた JSON)', () => {
    const b = build.stats.bytes
    expect(b.fixturesTotal).toBeLessThan(400 * 1024)
    expect(b.fixtureMedian).toBeLessThan(4 * 1024)
    expect(b.fixtureMax).toBeLessThan(20 * 1024)
  })

  it('109 本の札が開ける。476 ブロックの 1 本は開けない', () => {
    const open = new Set([...html.matchAll(/data-fx-open="([^"]+)"/g)].map(m => m[1]))
    expect([...open].sort()).toEqual(build.stats.fixturesEmbeddable)
    expect(open.size).toBe(109)
    const big = [...html.matchAll(/<div class="fx-card" data-fx-card="([^"]+)"><div class="fx-row">(?:(?!<\/div>).)*fx-big/g)].map(m => m[1])
    expect([...new Set(big)]).toEqual(['door-5x5-kurigohan'])
    expect(html).not.toContain('data-fx-open="door-5x5-kurigohan"')
    // 開ける札の数だけ置き場がある
    expect(html.match(/<div class="fx-view" hidden>/g)!.length).toBe(html.match(/data-fx-open=/g)!.length)
  })

  it('札はタグのあるページにだけあり、ページの fixture を全部持つ', () => {
    for (const p of build.pages.values()) {
      const cards = [...new Set([...p.html.matchAll(/data-fx-card="([^"]+)"/g)].map(m => m[1]))].sort()
      expect(cards, p.id).toEqual([...p.fixtures].sort())
    }
  })

  it('注記: skip つきの 6 本とエンティティの 5 本', () => {
    const names = (re: RegExp) => [...new Set([...html.matchAll(re)].map(m => m[1]))].sort()
    const skip = names(/data-fx-card="([^"]+)"><div class="fx-row">(?:(?!<\/div>).)*fx-note-skip/g)
    const ent = names(new RegExp(`data-fx-card="([^"]+)"><div class="fx-row">(?:(?!</div>).)*<span class="fx-note">${FIXTURE_NOTE_ENTITIES}`, 'g'))
    const info = build.manifest.fixtures
    expect(skip).toEqual(Object.keys(info).filter(n => info[n].skip !== undefined).sort())
    expect(skip).toHaveLength(6)
    expect(ent).toEqual(Object.keys(info).filter(n => info[n].entities).sort())
    expect(ent).toHaveLength(5)
  })

  it('札が本文を押し流さない: 札は 1 ページに多くて 8 枚 (1 枚は 1 行)', () => {
    const perPage = [...build.pages.values()].map(p => (p.html.match(/class="fx-card"/g) ?? []).length)
    expect(Math.max(...perPage)).toBeLessThanOrEqual(8)
  })

  it('出した fixture は、全部このエンジンで最後の tick まで再生できる', () => {
    for (const name of build.stats.fixturesWritten) {
      const fx = JSON.parse(build.files.get(fixtureDataPath(name))!) as Fixture
      const runner = new FixtureRunner(fx)
      expect(() => { while (!runner.done) runner.step() }, name).not.toThrow()
      expect(runner.tick, name).toBe(fx.ticks)
      expect(runner.worldSnapshot().bounds.y, name).toEqual([fx.region.from[1], fx.region.to[1]])
    }
  })
})
