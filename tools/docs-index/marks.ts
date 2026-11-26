/**
 * 確かさの印 (`[26.3 読解]`・`[要実機]`・`[実機 …]`・`[版差 …]` ほか) を拾う (#434)。
 *
 * 語は決め打ちにする。メモには `[t]`・`[4]`・`[powered=true]` のような添字や状態の角括弧も
 * あるので、「角括弧なら印」とは読まない。凡例は docs/vanilla/README.md の §4。
 */

import type { MarkCounts, MarkKind } from '../../packages/docs-kit/src/types.js'

/** 印の頭の語 → 種類。長い語を先に並べる (`ライブラリ実測` を `実測` より先に見る) */
const KEYWORDS: [string, MarkKind][] = [
  ['26.3 読解', 'read'],
  ['ライブラリ実測', 'meas'],
  ['要実機', 'need'],
  ['要確認', 'check'],
  ['要検証', 'check'],
  ['実機', 'fx'],
  ['版差', 'ver'],
  ['確定', 'sure'],
  ['実測', 'meas'],
  ['推定', 'guess'],
]

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const KW = KEYWORDS.map(([w]) => esc(w)).join('|')

/**
 * 印の開き。語の直後は `]`・空白・`:`・`。` のどれか (`[実機で確かめた…]` のような文は印にしない)。
 * 閉じの `]` は別に探す (中の URL がリンクになって、文が途中で切れることがある)。
 */
export const MARK_OPEN = new RegExp(`\\[(${KW})(?=[\\]\\s:：。])`, 'g')

/** 1 つの文の中で閉じている印 (見出しと節の本文を数えるのに使う) */
const MARK_WHOLE = new RegExp(`\\[(${KW})(?=[\\]\\s:：。])([^\\]\\n]*)\\]`, 'g')

export function markKind(keyword: string): MarkKind {
  const hit = KEYWORDS.find(([w]) => w === keyword)
  if (!hit) throw new Error(`印の語ではない: ${keyword}`)
  return hit[1]
}

export interface MarkHit {
  kind: MarkKind
  /** 角括弧の中の文 (`実機 1.21.1: piston-basic`) */
  inner: string
  /** 文の中の位置 (`[` から `]` の次まで) */
  start: number
  end: number
}

/** 文の中の印を全部拾う */
export function findMarks(text: string): MarkHit[] {
  const out: MarkHit[] = []
  MARK_WHOLE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = MARK_WHOLE.exec(text))) {
    out.push({ kind: markKind(m[1]), inner: m[1] + m[2], start: m.index, end: m.index + m[0].length })
  }
  return out
}

/** 見出しから印を外す (目次・検索の題に使う)。印の前後の空白は 1 つに寄せる */
export function stripMarks(title: string): string {
  MARK_WHOLE.lastIndex = 0
  return title.replace(MARK_WHOLE, ' ').replace(/\s+/g, ' ').trim()
}

/** md の文 (フェンスの中を除く) の印を種類ごとに数える */
export function countMarks(text: string): MarkCounts {
  const out: MarkCounts = {}
  for (const h of findMarks(stripFences(text))) out[h.kind] = (out[h.kind] ?? 0) + 1
  return out
}

/** コードフェンスの中身を空行にする (行の数は変えない) */
export function stripFences(text: string): string {
  let fence = false
  return text.split('\n').map(line => {
    if (/^\s*(```|~~~)/.test(line)) { fence = !fence; return '' }
    return fence ? '' : line
  }).join('\n')
}
