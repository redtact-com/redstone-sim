/**
 * メモを引く CLI (#434)。AI と人が、リポの中から節を探すのに使う。
 * md からその場で索引を作るので、ビルド (`npm run docs:index`) は要らない。
 *
 *   npm run docs:search -- リピーター ロック         … 語で探す (ID・見出し・file:line・抜粋)
 *   npm run docs:search -- --id v07/4.3             … 節の本文 (下の節も含む)。メモの ID なら見出しの一覧
 *   npm run docs:search -- --block repeater         … ブロック ID・和名 → クラス → 節
 *   npm run docs:search -- --class RepeaterBlock    … クラス → 節 (00 の網羅表)
 *   npm run docs:search -- --fixture piston-basic   … fixture → 節
 *   npm run docs:search -- --mark need ピストン      … 印で絞る (語が無ければ、その印のある節の一覧)
 *   npm run docs:search -- --doc v13 押せる          … メモで絞る
 *
 * `--json` で JSON を出す (パイプで受ける時は `npm run --silent docs:search -- --json …`)。
 * `--limit N` で件数 (既定は検索 10・一覧 50)。
 *
 * 表に無いブロック・クラス・fixture は、空ではなく「表に無い」と返す (`found: false`)。
 * 「メモに記述が無い」とは別なので、その時は語で検索する。
 */

import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MARK_KINDS, MARK_LABELS } from '../../packages/docs-kit/src/types.js'
import type { MarkKind, SectionRecord } from '../../packages/docs-kit/src/types.js'
import { docOf } from '../../packages/docs-kit/src/ids.js'
import { makeSnippet, openSearchIndex, plainText } from '../../packages/docs-kit/src/search.js'
import { lookupBlock, lookupClass, lookupFixture, pointer } from './ai.js'
import type { SectionPointer } from './ai.js'
import { buildDocsFromRepo, repoRoot } from './build.js'
import type { DocsBuild } from './build.js'

export const SEARCH_CLI_LIMIT = 10
export const LIST_CLI_LIMIT = 50

export interface CliResult {
  /** 終了コード。0 = 答えた (「表に無い」も答え)・1 = その ID が無い・2 = 使い方の誤り */
  code: number
  /** 標準出力へ出す文 (末尾の改行なし) */
  out: string
}

export interface CliArgs {
  json: boolean
  help: boolean
  limit: number | null
  id: string | null
  class: string | null
  block: string | null
  fixture: string | null
  mark: string | null
  doc: string | null
  query: string
}

const VALUE_FLAGS = ['id', 'class', 'block', 'fixture', 'mark', 'doc', 'limit'] as const

/** 引数を読む。`--id v07/4.3` と `--id=v07/4.3` の両方を受ける。知らない旗は誤りにする */
export function parseArgs(argv: readonly string[]): CliArgs | { error: string } {
  const args: CliArgs = {
    json: false, help: false, limit: null, id: null, class: null, block: null, fixture: null, mark: null, doc: null, query: '',
  }
  const words: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--') { words.push(...argv.slice(i + 1)); break }
    if (a === '--json') { args.json = true; continue }
    if (a === '--help' || a === '-h') { args.help = true; continue }
    const m = /^--([a-z]+)(?:=(.*))?$/.exec(a)
    if (!m) { words.push(a); continue }
    const name = VALUE_FLAGS.find(f => f === m[1])
    if (!name) return { error: `知らない旗: ${a}` }
    const value = m[2] ?? argv[++i]
    if (value === undefined || value === '') return { error: `--${name} に値が要る` }
    if (name === 'limit') {
      const n = Number(value)
      if (!Number.isInteger(n) || n < 1) return { error: `--limit は 1 以上の整数: ${value}` }
      args.limit = n
    } else args[name] = value
  }
  args.query = words.join(' ').trim()
  return args
}

export const USAGE = `使い方: npm run docs:search -- [旗] [語 …]

  語 …                  語で探す (節の見出しと本文。空白で区切る)
  --id <ID>             節の本文 (v07/4.3・「V07 §4.3」)。メモの ID (v07) なら見出しの一覧
  --block <ID か和名>    ブロック → クラス → 節 (repeater・リピーター・minecraft:repeater)
  --class <クラス名>     クラス → 節 (00 の網羅表の担当欄)
  --fixture <名前>       fixture → 節
  --mark <印>           印で絞る (${MARK_KINDS.map(k => `${k} = ${MARK_LABELS[k]}`).join('・')})
  --doc <メモの ID>      メモで絞る (v07・r19)
  --limit <数>          件数 (既定は検索 ${SEARCH_CLI_LIMIT}・一覧 ${LIST_CLI_LIMIT})
  --json                JSON で出す

表に無いブロック・クラス・fixture は「表に無い」と返す (メモに無いという意味ではない)。`

/** 印の指定を種類に直す (`need`・`要実機`・`[要実機]`) */
export function parseMark(raw: string): MarkKind | null {
  const s = raw.normalize('NFKC').replace(/^\[|\]$/g, '').trim()
  return MARK_KINDS.find(k => k === s.toLowerCase() || MARK_LABELS[k] === s) ?? null
}

/** ID の書き方をそろえる (`V07 §4.3`・`07 §4.3`・`v07/4.3/` → `v07/4.3`) */
export function normalizeId(raw: string): string {
  const s = raw.normalize('NFKC').trim().replace(/\/+$/, '')
  const m = /^([VvRr])?(\d{2})\s*§\s*(\S+)$/.exec(s)
  if (m) return `${(m[1] ?? 'v').toLowerCase()}${m[2]}/${m[3]}`
  return /^[VR]\d{2}(\/|$)/.test(s) ? s[0].toLowerCase() + s.slice(1) : s
}

const line = (p: SectionPointer) => `${p.id}  ${p.title}${p.whole ? '  (メモ全体)' : ''}\n    ${p.where}`

function listText(title: string, list: readonly SectionPointer[], limit: number): string[] {
  if (list.length === 0) return []
  const out = [`${title} (${list.length} 件${list.length > limit ? `・先頭 ${limit} 件` : ''}):`]
  for (const p of list.slice(0, limit)) out.push(`  ${line(p)}`)
  return out
}

/** CLI の本体。`build` は md から組み立てた物 (テストは使い回しを渡す) */
export function run(argv: readonly string[], build: DocsBuild): CliResult {
  const args = parseArgs(argv)
  if ('error' in args) return { code: 2, out: `${args.error}\n\n${USAGE}` }
  if (args.help) return { code: 0, out: USAGE }
  const { ai, model } = build
  const json = (value: unknown, code = 0): CliResult => ({ code, out: JSON.stringify(value, null, 2) })

  // 絞り込み (--mark・--doc)
  let mark: MarkKind | null = null
  if (args.mark) {
    mark = parseMark(args.mark)
    if (!mark) return { code: 2, out: `知らない印: ${args.mark}\n\n${USAGE}` }
  }
  let doc: string | null = null
  if (args.doc) {
    doc = normalizeId(args.doc)
    if (!model.docs.some(d => d.source.key === doc)) {
      return { code: 2, out: `知らないメモ: ${args.doc} (${model.docs.map(d => d.source.key).join(' ')})` }
    }
  }

  // --id
  if (args.id) {
    const id = normalizeId(args.id)
    const memo = model.docs.find(d => d.source.key === id)
    if (memo) {
      const sections = ai.records.filter(r => docOf(r.id) === id).map(r => ({ ...pointer(r), level: r.level }))
      if (args.json) return json({ id, found: true, kind: 'doc', label: memo.label, title: memo.title, file: memo.source.file, sections })
      return {
        code: 0,
        out: [
          `${id}  ${memo.label} ${memo.title}`, `    ${memo.source.file}`, '',
          ...sections.map(s => `${'  '.repeat(Math.max(0, s.level - 1))}${s.id}  ${s.title}  :${s.line}`),
        ].join('\n'),
      }
    }
    const head = model.sectionById.get(id)
    if (!head) {
      const stem = id.includes('/') ? id.slice(0, Math.max(id.lastIndexOf('.'), id.lastIndexOf('/'))) : id
      const near = ai.records.filter(r => r.id.startsWith(stem)).slice(0, 12).map(r => r.id)
      if (args.json) return json({ id, found: false, note: 'その ID の節は無い', near }, 1)
      return { code: 1, out: [`その ID の節は無い: ${id}`, ...(near.length ? [`近い ID: ${near.join(' ')}`] : [])].join('\n') }
    }
    // その節と、下の節 (md の順で続く、より深い見出し)
    const at = model.sections.indexOf(head)
    let end = at + 1
    while (end < model.sections.length && model.sections[end].doc === head.doc && model.sections[end].level > head.level) end++
    const subtree = model.sections.slice(at, end)
    const last = subtree[subtree.length - 1]
    const source = model.docs.find(d => d.source.key === head.doc)!.source.text.split('\n')
    const text = source.slice(head.line - 1, last.endLine).join('\n').replace(/\s+$/, '')
    const recs = subtree.map(s => ai.byId.get(s.id)!)
    const union = (f: (r: SectionRecord) => readonly string[]) => [...new Set(recs.flatMap(f))]
    const rec = recs[0]
    if (args.json) {
      return json({
        id, found: true, kind: 'section', page: rec.page, title: rec.title, path: rec.path,
        file: rec.file, line: head.line, endLine: last.endLine, where: `${rec.file}:${head.line}`,
        marks: union(r => r.marks), fixtures: union(r => r.fixtures), classes: union(r => r.classes),
        blocks: union(r => r.blocks), refs: union(r => r.refs),
        sections: recs.map(r => r.id), text,
      })
    }
    return {
      code: 0,
      out: [`${id}  ${rec.path.join(' › ')}`, `    ${rec.file}:${head.line}-${last.endLine}`, '', text].join('\n'),
    }
  }

  // 逆引き (--block・--class・--fixture)。語があれば、引いた節の中だけを探す
  const scope = { on: false, ids: new Set<string>(), docs: new Set<string>() }
  const lookups: { text: string[]; data: Record<string, unknown> }[] = []
  const limit = args.limit ?? LIST_CLI_LIMIT
  const widen = (sections: readonly SectionPointer[], mentions: readonly SectionPointer[] = []) => {
    scope.on = true
    for (const p of sections) {
      if (p.whole) scope.docs.add(docOf(p.id))
      else scope.ids.add(p.id)
    }
    for (const p of mentions) scope.ids.add(p.id)
  }
  if (args.block) {
    const r = lookupBlock(ai, model, args.block)
    if (!r.found) lookups.push({ text: [`ブロック ${r.block}: ${r.note}`, `(表にあるのは ${r.known} 行)`], data: { block: r } })
    else {
      widen(r.sections, r.mentions)
      lookups.push({
        text: [
          `ブロック ${r.block}  ${r.entry.ja.join('・')}  (ID: ${r.entry.ids.join(' ')}${r.entry.suffix ? ` ほか *${r.entry.suffix}` : ''})`,
          `クラス: ${r.entry.classes.join(' ')}`,
          ...listText('担当の節', r.sections, limit),
          ...listText('補助: クラス名が出る節', r.mentions, Math.min(limit, 15)),
        ],
        data: {
          block: {
            found: true, block: r.block, ids: r.entry.ids, suffix: r.entry.suffix ?? null, ja: r.entry.ja,
            classes: r.entry.classes, sections: r.sections, mentions: r.mentions,
          },
        },
      })
    }
  }
  if (args.class) {
    const r = lookupClass(ai, model, args.class)
    if (!r.found) {
      lookups.push({
        text: [`クラス ${r.class}: ${r.note}`, ...(r.near.length ? [`名前の近いクラス: ${r.near.join(' ')}`] : [])],
        data: { class: r },
      })
    } else {
      widen(r.sections, r.mentions)
      lookups.push({
        text: [
          `クラス ${r.class}  (${r.entry.written}・${r.entry.state})`,
          `網羅表: ${build.ai.byClass.source}:${r.entry.line}  担当欄: ${r.entry.owner}`,
          ...(r.entry.state === '記述済' ? [] : ['対象外: 担当の節は無い (担当欄が理由)']),
          ...listText('担当の節', r.sections, limit),
          ...listText('補助: クラス名が出る節', r.mentions, Math.min(limit, 15)),
        ],
        data: {
          class: {
            found: true, class: r.class, written: r.entry.written, state: r.entry.state, owner: r.entry.owner,
            row: r.entry.row, where: `${build.ai.byClass.source}:${r.entry.line}`, families: r.entry.families,
            sections: r.sections, mentions: r.mentions,
          },
        },
      })
    }
  }
  if (args.fixture) {
    const r = lookupFixture(ai, args.fixture)
    if (!r.found) {
      lookups.push({
        text: [`fixture ${r.fixture}: ${r.note}`, ...(r.near.length ? [`名前の近い fixture: ${r.near.join(' ')}`] : [])],
        data: { fixture: r },
      })
    } else {
      widen(r.sections)
      const e = r.entry
      lookups.push({
        text: [
          `fixture ${r.fixture}  ${e.file}  (${e.blocks} ブロック・${e.ticks} tick)`,
          ...(e.skip ? [`skip つき: 今のエンジンは実機と違う — ${e.skip}`] : []),
          ...(e.entities ? ['エンティティの入力 (summon・item・kill) を含む'] : []),
          ...listText('引いている節', r.sections, limit),
        ],
        data: {
          fixture: {
            found: true, fixture: r.fixture, file: e.file, blocks: e.blocks, ticks: e.ticks, embed: e.embed,
            skip: e.skip ?? null, entities: e.entities ?? false, sections: r.sections,
          },
        },
      })
    }
  }

  const keep = (r: SectionRecord) =>
    (!mark || r.marks.includes(mark))
    && (!doc || docOf(r.id) === doc)
    && (!scope.on || scope.ids.has(r.id) || scope.docs.has(docOf(r.id)))
  const filters = { mark, doc }

  // 語で探す
  if (args.query) {
    const n = args.limit ?? SEARCH_CLI_LIMIT
    const engine = openSearchIndex(build.search)
    const filtered = mark || doc || scope.on
    const res = engine.search(args.query, { limit: n, filter: filtered ? h => keep(ai.byId.get(h.id)!) : undefined })
    const hits = res.hits.map((h, i) => {
      const r = ai.byId.get(h.id)!
      const s = makeSnippet(plainText(r.text), args.query, 140)
      return {
        rank: i + 1, ...pointer(r), path: r.path, marks: r.marks, fixtures: r.fixtures, classes: r.classes, blocks: r.blocks,
        score: Math.round(h.score * 100) / 100,
        snippet: `${s.head ? '…' : ''}${s.text}${s.tail ? '…' : ''}`,
      }
    })
    if (args.json) {
      return json({ query: args.query, filters, ...Object.assign({}, ...lookups.map(l => l.data)), total: res.total, hits })
    }
    const out = lookups.flatMap(l => [...l.text, ''])
    out.push(res.total === 0
      ? `「${args.query}」に当てはまる節は無い (語を減らすか、絞り込みを外す)`
      : `「${args.query}」 ${res.total} 件${res.total > hits.length ? `のうち上位 ${hits.length} 件` : ''}`)
    for (const h of hits) {
      out.push('', `${h.rank}. ${h.id}  ${h.title}${h.marks.length ? `  [${h.marks.map(k => MARK_LABELS[k]).join('] [')}]` : ''}`)
      if (h.path.length > 1) out.push(`   ${h.path.slice(0, -1).join(' › ')}`)
      out.push(`   ${h.where}`)
      if (h.snippet) out.push(`   ${h.snippet}`)
    }
    return { code: 0, out: out.join('\n') }
  }

  // 逆引きだけ
  if (lookups.length > 0 && !mark && !doc) {
    if (args.json) return json(Object.assign({}, ...lookups.map(l => l.data)))
    return { code: 0, out: lookups.map(l => l.text.join('\n')).join('\n\n') }
  }

  // 絞り込みだけ: 当てはまる節の一覧 (md の順)
  if (mark || doc || lookups.length > 0) {
    const all = ai.records.filter(keep)
    const list = all.slice(0, limit).map(r => pointer(r))
    if (args.json) return json({ filters, ...Object.assign({}, ...lookups.map(l => l.data)), total: all.length, sections: list })
    const what = [mark ? `[${MARK_LABELS[mark]}] のある節` : '節', doc ? `(${doc})` : ''].filter(Boolean).join(' ')
    return {
      code: 0,
      out: [
        ...lookups.flatMap(l => [...l.text, '']),
        `${what}: ${all.length} 件${all.length > list.length ? `・先頭 ${list.length} 件 (--limit で増やす)` : ''}`,
        ...list.map(p => `  ${line(p)}`),
      ].join('\n'),
    }
  }

  return { code: 2, out: USAGE }
}

function main(): void {
  const res = run(process.argv.slice(2), buildDocsFromRepo(repoRoot))
  process.stdout.write(`${res.out}\n`)
  process.exitCode = res.code
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
