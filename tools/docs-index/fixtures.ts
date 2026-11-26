/**
 * 本文の `[実機 1.21.1: 名前]` を fixture の名前に解く (#434)。
 *
 * - 読む元は packages/sim/test/fixtures (タグのある fixture がそろうのはここだけ)
 * - 複数名は `・` `,` `、` `/` で割る
 * - 凡例の「名前」「fixture 名」や `rail-*` のまとめ書きは名前の形をしていないので外す
 * - 名前の形 (英小文字・数字・ハイフン) なのに実在しない物は「知らない名前」として返す。
 *   単体テストが 0 件であることを見る (md の書き間違いをここで拾う)
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { FixtureInfo } from '../../packages/docs-kit/src/types.js'
import { FIXTURE_ENTITY_ACTIONS } from '../../packages/docs-kit/src/fixture-card.js'
import { findMarks, stripFences } from './marks.js'

/** 記事に埋め込むブロックの数の上限。超える fixture は「大きいので埋め込まない」と出す */
export const FIXTURE_EMBED_MAX_BLOCKS = 200

/** fixture の置き場 (リポ相対) */
export const FIXTURE_DIR = 'packages/sim/test/fixtures'

/** fixture の JSON のうち、目録に要る所だけ */
interface FixtureFile {
  ticks: number
  blocks: unknown[]
  inputs?: { action?: string }[]
  skipReason?: string
  skipUntil?: string
}

/** 目録に載せる前の fixture の情報 (`sections` は後で埋める) */
export type FixtureMeta = Omit<FixtureInfo, 'sections'>

/** エンティティを出し入れする入力。ビューアはエンティティを描かない */
const ENTITY_ACTIONS = new Set(FIXTURE_ENTITY_ACTIONS)

/** fixture を全部読んで、名前 → 情報にする */
export function loadFixtures(root: string): Map<string, FixtureMeta> {
  const dir = join(root, FIXTURE_DIR)
  const out = new Map<string, FixtureMeta>()
  for (const f of readdirSync(dir).filter(f => f.endsWith('.json')).sort()) {
    const fx = JSON.parse(readFileSync(join(dir, f), 'utf-8')) as FixtureFile
    const meta: FixtureMeta = {
      blocks: fx.blocks.length,
      ticks: fx.ticks,
      embed: fx.blocks.length <= FIXTURE_EMBED_MAX_BLOCKS,
    }
    const skip = fx.skipReason ?? fx.skipUntil
    if (skip) meta.skip = skip
    if ((fx.inputs ?? []).some(i => i.action !== undefined && ENTITY_ACTIONS.has(i.action))) meta.entities = true
    out.set(f.slice(0, -'.json'.length), meta)
  }
  return out
}

/**
 * 記事に埋め込める fixture の中身 (名前 → 詰めた JSON)。上限を超える物は入れない。
 * 生成器はこのうち本文が引く物だけを `data/fixtures/<名前>.json` に出す
 */
export function loadFixtureFiles(root: string): Map<string, string> {
  const dir = join(root, FIXTURE_DIR)
  const out = new Map<string, string>()
  for (const f of readdirSync(dir).filter(f => f.endsWith('.json')).sort()) {
    const fx = JSON.parse(readFileSync(join(dir, f), 'utf-8')) as FixtureFile
    if (fx.blocks.length > FIXTURE_EMBED_MAX_BLOCKS) continue
    out.set(f.slice(0, -'.json'.length), JSON.stringify(fx))
  }
  return out
}

export interface FixtureTag {
  /** 実在する名前 (出てくる順・重複を除く) */
  names: string[]
  /** 名前の形なのに実在しない物 */
  unknown: string[]
}

const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** 凡例で名前の代わりに書いてある語。fixture の名前としては読まない */
const LEGEND = new Set(['name', 'fixture'])

/**
 * 印の中の文 (`実機 1.21.1: a・b`) を名前に割る。
 * `実機` の印でなければ空を返す。版の前置き (`1.21.1:`) は無くてもよい。
 */
export function parseFixtureTag(inner: string, known: ReadonlySet<string> | ReadonlyMap<string, unknown>): FixtureTag {
  const out: FixtureTag = { names: [], unknown: [] }
  const m = /^実機\s+(?:[\d.]+\s*[:：]\s*)?(.*)$/.exec(inner)
  if (!m) return out
  for (const raw of m[1].split(/[・、,/]/)) {
    // 後ろの注記 (`name (t5 で着地)`) と、コードの印を落とす
    const name = raw.replace(/\s*[(（].*$/, '').replace(/`/g, '').trim()
    if (!NAME.test(name)) continue          // 凡例 (「名前」「fixture 名」)・`rail-*`・`x 名`
    if (!/[a-z]/.test(name)) continue       // 数字だけ (`1.21.1` の切れ端) は名前ではない
    if (LEGEND.has(name)) continue          // 凡例の英字の置き字 (`[実機 1.21.1: name]`)
    if (known.has(name)) { if (!out.names.includes(name)) out.names.push(name) }
    else if (!out.unknown.includes(name)) out.unknown.push(name)
  }
  return out
}

/** md の文 (フェンスの中を除く) が引く fixture を拾う */
export function fixturesIn(text: string, known: ReadonlySet<string> | ReadonlyMap<string, unknown>): FixtureTag {
  const out: FixtureTag = { names: [], unknown: [] }
  for (const h of findMarks(stripFences(text))) {
    if (h.kind !== 'fx') continue
    const t = parseFixtureTag(h.inner, known)
    for (const n of t.names) if (!out.names.includes(n)) out.names.push(n)
    for (const n of t.unknown) if (!out.unknown.includes(n)) out.unknown.push(n)
  }
  return out
}
