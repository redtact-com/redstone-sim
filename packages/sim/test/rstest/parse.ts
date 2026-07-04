// ============================================================
// 回路テスト DSL (.rstest) パーサ (#71)
//
// 記法の正: このファイル冒頭のブロック定義 + docs/research/08 (trace 記法)。
// tests/circuits/**/*.rstest を 1 ファイル = 1 テストケースとして記述する。
//
// ブロック構成 (行指向。ブロックは自分の行だけの '}' で閉じる):
//   meta { name: <必須> / <任意キー>: <値> }
//   fixture <名前>                     packages/sim/test/fixtures/<名前>.json を取込
//   circuit { (x,y,z) <blockstate> [items=N] / (a)..(b) <blockstate> (範囲 fill) }
//   inputs  { t<N> use|step (x,y,z) }
//   ticks   <N>
//   trace        { <トレース行> ... }   部分一致 (順序保存部分列, verbose 行も可)
//   trace strict { <トレース行> ... }   完全一致 (verbose=false の全行)。trace と排他
//   state   { t<N> (x,y,z) <blockstate> }  state[t] の blockstate 断言
//
// コメントは行頭または空白後の '#' から行末まで。空行は無視。
// blockstate は mcstate.parseMcState / canonicalize で構文検証する。
// 構文エラーは「ファイル名:行番号: 原因」で報告する。
// ============================================================

import { canonicalize, mcToSim } from '@redstone/sim'
import type { Pos3D } from '@redstone/sim'

export interface CircuitEntry {
  /** 単点なら from===to。範囲 fill は直方体 [from..to] */
  from: Pos3D
  to: Pos3D
  block: string
  items?: number
  line: number
}

export interface InputEntry {
  tick: number
  action: 'use' | 'step'
  pos: Pos3D
  line: number
}

export interface StateEntry {
  tick: number
  pos: Pos3D
  block: string
  line: number
}

export interface TraceSpec {
  strict: boolean
  lines: string[]
}

export interface ParsedRstest {
  meta: { name: string } & Record<string, string>
  fixture?: string
  circuit: CircuitEntry[]
  inputs: InputEntry[]
  ticks?: number
  trace?: TraceSpec
  state: StateEntry[]
}

/** 構文エラー。message は「ファイル名:行番号: 原因」形式 */
export class RstestParseError extends Error {}

/** 行頭または空白後の '#' 以降をコメントとして除去する */
function stripComment(line: string): string {
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '#' && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i)
  }
  return line
}

const COORD = String.raw`\(\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*\)`

interface Line {
  no: number
  text: string
  trimmed: string
}

export function parseRstest(text: string, fileName: string): ParsedRstest {
  const raw = text.split('\n')
  const lines: Line[] = raw.map((r, i) => {
    const t = stripComment(r)
    return { no: i + 1, text: t, trimmed: t.trim() }
  })

  const fail = (no: number, reason: string): never => {
    throw new RstestParseError(`${fileName}:${no}: ${reason}`)
  }

  const validateBlock = (no: number, block: string, allowAir: boolean): void => {
    let canon: string
    try {
      canon = canonicalize(block)
    } catch (e) {
      fail(no, `blockstate の構文が不正: ${block} (${(e as Error).message})`)
    }
    if (canon! === 'air') {
      if (!allowAir) fail(no, `circuit に air は置けません: ${block}`)
      return
    }
    try {
      mcToSim(block)
    } catch (e) {
      fail(no, `sim が扱えない blockstate: ${block} (${(e as Error).message})`)
    }
  }

  // ヘッダ行 (末尾 '{') から自分の行だけの '}' までを本文として集める
  const readBlock = (headerIdx: number): { body: Line[]; endIdx: number } => {
    const body: Line[] = []
    for (let i = headerIdx + 1; i < lines.length; i++) {
      if (lines[i].trimmed === '}') return { body, endIdx: i }
      if (lines[i].trimmed !== '') body.push(lines[i])
    }
    return fail(lines[headerIdx].no, `ブロックが '}' で閉じられていません`)
  }

  const result: ParsedRstest = { meta: { name: '' }, circuit: [], inputs: [], state: [] }
  let sawMeta = false
  let sawTrace = false

  let i = 0
  while (i < lines.length) {
    const ln = lines[i]
    if (ln.trimmed === '') { i++; continue }
    if (ln.trimmed === '}') fail(ln.no, `対応するブロック開始がない '}'`)

    // ブロックヘッダ (末尾 '{') か 単一行ディレクティブか
    const isHeader = ln.trimmed.endsWith('{')
    const head = ln.trimmed.replace(/\{$/, '').trim()
    const tokens = head.split(/\s+/).filter(Boolean)
    const kw = tokens[0]

    if (isHeader) {
      const { body, endIdx } = readBlock(i)
      switch (kw) {
        case 'meta': {
          if (sawMeta) fail(ln.no, `meta ブロックが重複しています`)
          sawMeta = true
          for (const b of body) {
            const idx = b.trimmed.indexOf(':')
            if (idx < 0) fail(b.no, `meta は "キー: 値" 形式で書きます: ${b.trimmed}`)
            const key = b.trimmed.slice(0, idx).trim()
            const val = b.trimmed.slice(idx + 1).trim()
            if (!key) fail(b.no, `meta のキーが空です`)
            ;(result.meta as Record<string, string>)[key] = val
          }
          break
        }
        case 'circuit': {
          for (const b of body) parseCircuitLine(b)
          break
        }
        case 'inputs': {
          for (const b of body) parseInputLine(b)
          break
        }
        case 'state': {
          for (const b of body) parseStateLine(b)
          break
        }
        case 'trace': {
          const strict = tokens[1] === 'strict'
          if (tokens.length > 1 && !strict) fail(ln.no, `trace の修飾子は 'strict' のみ: ${head}`)
          if (tokens.length > 2) fail(ln.no, `trace ヘッダが不正: ${head}`)
          if (sawTrace) fail(ln.no, `trace ブロックは 1 つ (trace と trace strict は排他)`)
          sawTrace = true
          result.trace = { strict, lines: body.map(b => b.trimmed) }
          break
        }
        default:
          fail(ln.no, `未知のブロック: ${kw}`)
      }
      i = endIdx + 1
      continue
    }

    // 単一行ディレクティブ
    switch (kw) {
      case 'fixture': {
        if (tokens.length !== 2) fail(ln.no, `fixture は "fixture <名前>" で書きます: ${ln.trimmed}`)
        if (result.fixture) fail(ln.no, `fixture が重複しています`)
        result.fixture = tokens[1]
        break
      }
      case 'ticks': {
        if (tokens.length !== 2 || !/^\d+$/.test(tokens[1])) {
          fail(ln.no, `ticks は "ticks <整数>" で書きます: ${ln.trimmed}`)
        }
        result.ticks = Number(tokens[1])
        break
      }
      default:
        fail(ln.no, `未知のディレクティブ: ${ln.trimmed}`)
    }
    i++
  }

  if (!sawMeta) fail(1, `meta ブロックが必要です`)
  if (!result.meta.name) fail(1, `meta.name は必須です`)

  return result

  // --- 本文行パーサ ---

  function parseCircuitLine(b: Line): void {
    const m = new RegExp(
      String.raw`^${COORD}(?:\.\.${COORD})?\s+(.+)$`,
    ).exec(b.trimmed)
    if (!m) fail(b.no, `circuit 行が不正 ((x,y,z) [..(x,y,z)] <blockstate> [items=N]): ${b.trimmed}`)
    const from: Pos3D = [Number(m![1]), Number(m![2]), Number(m![3])]
    const hasTo = m![4] !== undefined
    const to: Pos3D = hasTo ? [Number(m![4]), Number(m![5]), Number(m![6])] : from
    let rest = m![7].trim()
    let items: number | undefined
    const im = /\s+items=(\d+)\s*$/.exec(rest)
    if (im) {
      items = Number(im[1])
      rest = rest.slice(0, im.index).trim()
    }
    validateBlock(b.no, rest, false)
    result.circuit.push({ from, to, block: rest, items, line: b.no })
  }

  function parseInputLine(b: Line): void {
    const m = new RegExp(String.raw`^t(\d+)\s+(use|step)\s+${COORD}$`).exec(b.trimmed)
    if (!m) fail(b.no, `inputs 行が不正 (t<N> use|step (x,y,z)): ${b.trimmed}`)
    result.inputs.push({
      tick: Number(m![1]),
      action: m![2] as 'use' | 'step',
      pos: [Number(m![3]), Number(m![4]), Number(m![5])],
      line: b.no,
    })
  }

  function parseStateLine(b: Line): void {
    const m = new RegExp(String.raw`^t(\d+)\s+${COORD}\s+(.+)$`).exec(b.trimmed)
    if (!m) fail(b.no, `state 行が不正 (t<N> (x,y,z) <blockstate>): ${b.trimmed}`)
    const block = m![5].trim()
    validateBlock(b.no, block, true)
    result.state.push({
      tick: Number(m![1]),
      pos: [Number(m![2]), Number(m![3]), Number(m![4])],
      block,
      line: b.no,
    })
  }
}
