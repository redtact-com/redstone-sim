import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ABSOLUTE } from '../ip-hygiene-patterns.js'
import { buildDocsFromRepoCached, repoRoot } from './build.js'
import { normalizeId, parseArgs, parseMark, run, SEARCH_CLI_LIMIT, USAGE } from './cli.js'

/** メモを引く CLI (`npm run docs:search`・#434) */

const cli = (...argv: string[]) => run(argv, buildDocsFromRepoCached())
const data = (...argv: string[]) => {
  const res = cli('--json', ...argv)
  return { code: res.code, json: JSON.parse(res.out) }
}

describe('引数', () => {
  it('旗と語を分ける。`--id=値` も受ける', () => {
    expect(parseArgs(['リピーター', 'ロック', '--json', '--limit', '3'])).toMatchObject({ query: 'リピーター ロック', json: true, limit: 3 })
    expect(parseArgs(['--id=v07/4.3'])).toMatchObject({ id: 'v07/4.3', query: '' })
    expect(parseArgs(['--block', 'repeater', '--json'])).toMatchObject({ block: 'repeater', json: true })
    expect(parseArgs(['--', '--json'])).toMatchObject({ query: '--json', json: false })
  })

  it('知らない旗・値の無い旗・変な件数は誤り', () => {
    expect(parseArgs(['--nope'])).toEqual({ error: '知らない旗: --nope' })
    expect(parseArgs(['--id'])).toEqual({ error: '--id に値が要る' })
    expect(parseArgs(['--limit', '0'])).toHaveProperty('error')
    expect(cli('--nope').code).toBe(2)
    expect(cli().code).toBe(2)
    expect(cli().out).toBe(USAGE)
    expect(cli('--help')).toEqual({ code: 0, out: USAGE })
  })

  it('印と ID の書き方を寄せる', () => {
    expect(parseMark('need')).toBe('need')
    expect(parseMark('要実機')).toBe('need')
    expect(parseMark('[版差]')).toBe('ver')
    expect(parseMark('x')).toBeNull()
    expect(normalizeId('V07 §4.3')).toBe('v07/4.3')
    expect(normalizeId('07 §4.3')).toBe('v07/4.3')
    expect(normalizeId('R19 §3.9')).toBe('r19/3.9')
    expect(normalizeId('v07/4.3/')).toBe('v07/4.3')
    expect(normalizeId('V05/app-C.1')).toBe('v05/app-C.1')
  })
})

describe('語で探す', () => {
  it('ID・見出し・file:line・抜粋を出す', () => {
    const res = cli('リピーター', 'ロック')
    expect(res.code).toBe(0)
    const lines = res.out.split('\n')
    expect(lines[0]).toMatch(/^「リピーター ロック」 \d+ 件のうち上位 10 件$/)
    expect(lines[2]).toBe('1. v07/4.3  4.3 リピーターの点灯条件とロック  [26.3 読解]')
    expect(lines[3]).toBe('   07. リピーター・コンパレーター (ダイオード) › 4. 処理の詳細')
    expect(lines[4]).toMatch(/^ {3}docs\/vanilla\/07_diodes\.md:\d+$/)
    expect(lines[5]).toContain('リピーター')
    expect(res.out.match(/^\d+\. /gm)).toHaveLength(SEARCH_CLI_LIMIT)
  })

  it('--json は同じ結果を機械で読める形で出す', () => {
    const { code, json } = data('リピーター', 'ロック', '--limit', '3')
    expect(code).toBe(0)
    expect(json.query).toBe('リピーター ロック')
    expect(json.hits).toHaveLength(3)
    expect(json.total).toBeGreaterThan(3)
    expect(json.hits[0]).toMatchObject({
      rank: 1, id: 'v07/4.3', page: 'v07/4.3', title: '4.3 リピーターの点灯条件とロック',
      file: 'docs/vanilla/07_diodes.md', marks: ['read'],
    })
    expect(json.hits[0].where).toBe(`docs/vanilla/07_diodes.md:${json.hits[0].line}`)
    expect(typeof json.hits[0].snippet).toBe('string')
    // file:line は、その見出しの行を指す
    const src = readFileSync(join(repoRoot, json.hits[0].file), 'utf-8').split('\n')
    expect(src[json.hits[0].line - 1]).toBe('### 4.3 リピーターの点灯条件とロック')
  })

  it('--mark と --doc で絞る', () => {
    const need = data('ピストン', '--mark', 'need')
    expect(need.json.filters).toEqual({ mark: 'need', doc: null })
    expect(need.json.hits.length).toBeGreaterThan(0)
    expect(need.json.hits.every((h: { marks: string[] }) => h.marks.includes('need'))).toBe(true)
    const doc = data('ピストン', '--doc', 'V13', '--mark', '版差')
    expect(doc.json.filters).toEqual({ mark: 'ver', doc: 'v13' })
    expect(doc.json.hits.every((h: { id: string; marks: string[] }) => h.id.startsWith('v13/') && h.marks.includes('ver'))).toBe(true)
    expect(doc.json.total).toBeLessThan(need.json.total)
    expect(cli('x', '--mark', 'nope').code).toBe(2)
    expect(cli('x', '--doc', 'v99').code).toBe(2)
  })

  it('語が無く絞り込みだけなら、当てはまる節の一覧', () => {
    const { json } = data('--mark', 'need', '--doc', 'v07')
    expect(json.total).toBeGreaterThan(0)
    expect(json.sections.length).toBe(Math.min(json.total, 50))
    expect(json.sections.every((s: { id: string }) => s.id.startsWith('v07/'))).toBe(true)
    expect(cli('--mark', 'need', '--doc', 'v07').out).toMatch(/^\[要実機\] のある節 \(v07\): \d+ 件/)
  })

  it('当たらない問いは 0 件と言う', () => {
    expect(cli('zzzqqq').out).toContain('当てはまる節は無い')
    expect(data('zzzqqq').json).toMatchObject({ total: 0, hits: [] })
  })
})

describe('--id', () => {
  it('節の本文を返す (見出しと、下の節も含む md のまま)', () => {
    const res = cli('--id', 'v07/4.3')
    expect(res.code).toBe(0)
    const lines = res.out.split('\n')
    expect(lines[0]).toBe('v07/4.3  07. リピーター・コンパレーター (ダイオード) › 4. 処理の詳細 › 4.3 リピーターの点灯条件とロック')
    expect(lines[1]).toMatch(/^ {4}docs\/vanilla\/07_diodes\.md:\d+-\d+$/)
    expect(lines[3]).toBe('### 4.3 リピーターの点灯条件とロック')
    expect(res.out).toContain('shouldTurnOn')
    // 次の節 (4.4) には入らない
    expect(res.out).not.toContain('### 4.4')
  })

  it('下の節を持つ節は、まとめて返す', () => {
    const { json } = data('--id', 'v06/4.12')
    expect(json).toMatchObject({ id: 'v06/4.12', found: true, kind: 'section', file: 'docs/vanilla/06_redstone-wire.md' })
    expect(json.sections.length).toBeGreaterThan(1)
    expect(json.sections.every((id: string) => id === 'v06/4.12' || id.startsWith('v06/4.12.') || id.startsWith('v06/4.12/'))).toBe(true)
    expect(json.text.startsWith('### 4.12 ')).toBe(true)
    expect(json.text).toContain('#### 4.12.1')
    expect(json.text).not.toContain('### 4.13')
    expect(json.endLine).toBeGreaterThan(json.line)
  })

  it('「V07 §4.3」の書き方でも引ける。メモの ID は見出しの一覧', () => {
    expect(data('--id', 'V07 §4.3').json.id).toBe('v07/4.3')
    const doc = data('--id', 'v07')
    expect(doc.json).toMatchObject({ id: 'v07', found: true, kind: 'doc', label: 'V07', file: 'docs/vanilla/07_diodes.md' })
    expect(doc.json.sections[0]).toMatchObject({ id: 'v07/0', level: 1, where: 'docs/vanilla/07_diodes.md:1' })
    expect(cli('--id', 'v07').out).toContain('v07/4.3  4.3 リピーターの点灯条件とロック')
  })

  it('無い ID は 1 で終わり、近い ID を挙げる', () => {
    const res = data('--id', 'v07/4.99')
    expect(res.code).toBe(1)
    expect(res.json).toMatchObject({ id: 'v07/4.99', found: false })
    expect(res.json.near).toContain('v07/4.3')
    expect(cli('--id', 'v07/4.99').out).toContain('その ID の節は無い')
  })
})

describe('逆引き', () => {
  it('--block repeater --json が節の ID と file:line を返す', () => {
    const { code, json } = data('--block', 'repeater')
    expect(code).toBe(0)
    expect(json.block).toMatchObject({ found: true, block: 'repeater', classes: ['RepeaterBlock', 'DiodeBlock'] })
    expect(json.block.ja).toContain('リピーター')
    expect(json.block.sections[0]).toMatchObject({ id: 'v07/0', where: 'docs/vanilla/07_diodes.md:1', whole: true })
    for (const p of [...json.block.sections, ...json.block.mentions]) {
      expect(p.id).toMatch(/^[vr][\w-]+\//)
      expect(p.where).toMatch(/^docs\/(vanilla|research)\/[\w.-]+\.md:\d+$/)
    }
    expect(json.block.mentions.map((p: { id: string }) => p.id)).toContain('v07/4.3')
    // 和名でも同じ
    expect(data('--block', 'リピーター').json.block.sections).toEqual(json.block.sections)
  })

  it('表に無いブロックは「表に無い」と返す (0 で終わる。空の結果にしない)', () => {
    const res = cli('--block', 'dirt')
    expect(res.code).toBe(0)
    expect(res.out).toContain('ブロック dirt: 表に無い')
    expect(res.out).toContain('メモに記述が無いという意味ではない')
    const { json } = data('--block', 'dirt')
    expect(json.block.found).toBe(false)
    expect(json.block.note).toContain('表に無い')
    expect(json.block).not.toHaveProperty('sections')
  })

  it('--class は担当の節と、網羅表の行を返す', () => {
    const { json } = data('--class', 'BarrelBlock')
    expect(json.class).toMatchObject({ found: true, class: 'BarrelBlock', state: '記述済', row: 'v00/4.1' })
    expect(json.class.sections.map((p: { id: string }) => p.id)).toEqual(['v14/4.10', 'v02/4.9', 'v03/4.8'])
    expect(json.class.where).toMatch(/^docs\/vanilla\/00_coverage\.md:\d+$/)
    expect(cli('--class', 'BarrelBlock').out).toContain('v14/4.10  4.10 ')
    expect(cli('--class', 'NoSuchBlock').out).toContain('クラス NoSuchBlock: 表に無い')
    expect(cli('--class', 'BeaconBlock').out).toContain('対象外')
  })

  it('--fixture は引いている節を返す。skip つきは理由を出す', () => {
    const { json } = data('--fixture', 'piston-basic')
    expect(json.fixture).toMatchObject({ found: true, fixture: 'piston-basic', file: 'packages/sim/test/fixtures/piston-basic.json', skip: null })
    expect(json.fixture.sections.map((p: { id: string }) => p.id)).toContain('v03/2.3')
    const build = buildDocsFromRepoCached()
    const skipped = Object.entries(build.manifest.fixtures).find(([, f]) => f.skip)![0]
    expect(cli('--fixture', skipped).out).toContain('skip つき: 今のエンジンは実機と違う')
    expect(cli('--fixture', 'no-such').out).toContain('fixture no-such: 表に無い')
  })

  it('逆引きと語を合わせると、引いた節の中だけを探す', () => {
    const { json } = data('--block', 'hopper', '待ち時間', '--limit', '50')
    expect(json.block.found).toBe(true)
    const allowed = new Set([...json.block.sections, ...json.block.mentions].map((p: { id: string }) => p.id))
    const whole = new Set(json.block.sections.filter((p: { whole?: boolean }) => p.whole).map((p: { id: string }) => p.id.split('/')[0]))
    expect(json.hits.length).toBeGreaterThan(0)
    expect(json.hits.every((h: { id: string }) => allowed.has(h.id) || whole.has(h.id.split('/')[0]))).toBe(true)
  })
})

describe('配線と衛生', () => {
  it('npm の script がある', () => {
    const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf-8')) as { scripts: Record<string, string> }
    expect(pkg.scripts['docs:search']).toBe('tsx tools/docs-index/cli.ts')
    expect(pkg.scripts['docs:index']).toBe('tsx tools/docs-index/build.ts')
  })

  it('出力に絶対パスが入らない (file はリポ相対)', () => {
    const outs = [
      cli('リピーター', 'ロック').out, cli('--id', 'v07/4.3').out, cli('--block', 'repeater', '--json').out,
      cli('--class', 'RepeaterBlock').out, cli('--fixture', 'piston-basic').out,
    ]
    for (const out of outs) for (const p of ABSOLUTE) expect(p.re.test(out), p.name).toBe(false)
  })
})
