// ============================================================
// 回路テスト DSL (.rstest) の vitest 統合 (#71)
//
// repo ルートの tests/circuits/**/*.rstest を fs で再帰探索し、
// 1 ファイル = 1 it(meta.name) として実行する。
// ファイルを追加するだけで CI が拾う (Bruno 風: フォルダ = コレクション)。
//
// 文法・書き方は tests/circuits/README.md、トレース記法は
// docs/research/08_trace-notation.md を参照。
// ============================================================

import { describe, it } from 'vitest'
import { readdirSync, readFileSync, type Dirent } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseRstest, type ParsedRstest } from './rstest/parse.js'
import { runRstest } from './rstest/runner.js'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..', '..', '..')
const circuitsDir = join(repoRoot, 'tests', 'circuits')

/** tests/circuits 以下の *.rstest を再帰収集する */
function discover(dir: string): string[] {
  let out: string[] = []
  let entries: Dirent[]
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out // ディレクトリ未作成なら空
  }
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out = out.concat(discover(p))
    else if (e.isFile() && e.name.endsWith('.rstest')) out.push(p)
  }
  return out
}

const files = discover(circuitsDir)

describe('回路テスト DSL (tests/circuits/**/*.rstest)', () => {
  it('tests/circuits に .rstest が 1 本以上ある', () => {
    if (files.length === 0) {
      throw new Error(`tests/circuits/**/*.rstest が見つかりません (${circuitsDir})`)
    }
  })

  for (const file of files) {
    const rel = relative(repoRoot, file)
    let parsed: ParsedRstest | undefined
    let parseErr: unknown
    try {
      parsed = parseRstest(readFileSync(file, 'utf-8'), rel)
    } catch (e) {
      parseErr = e
    }
    const title = parsed ? parsed.meta.name : rel
    it(title, () => {
      if (parseErr) throw parseErr
      runRstest(parsed!)
    })
  }
})
