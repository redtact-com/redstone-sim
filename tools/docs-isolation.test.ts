import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 読む用の Web (docs-web) が本番に出ないことを、構造で見張る (#434)。
 *
 * 本番 (rdsim.com) と develop は `npm run build` の app/dist をそのまま出す。
 * エディタ (app) が docs-web・docs-kit を import しなければ、メモの本文も索引も
 * app/dist には入らない。旗で落とすのではないので、旗の漏れが起きない。
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (f: string) => readFileSync(join(repoRoot, f), 'utf-8')
const tracked = (dir: string) =>
  execFileSync('git', ['ls-files', dir], { cwd: repoRoot, encoding: 'utf-8' }).split('\n').filter(Boolean)

describe('docs-web は本番のビルドに入らない (#434)', () => {
  it('app と、app が使う packages のソースが docs-web・docs-kit を import していない', () => {
    const files = [...tracked('app'), ...tracked('packages/sim'), ...tracked('packages/editor'), ...tracked('packages/viewer')]
      .filter(f => /\.(ts|tsx|js|mjs|json|html)$/.test(f))
    const hits: string[] = []
    for (const f of files) {
      read(f).split('\n').forEach((line, i) => {
        if (/docs-kit|docs-web/.test(line)) hits.push(`${f}:${i + 1} ${line.trim().slice(0, 100)}`)
      })
    }
    expect(hits, `エディタの側から読む用の Web を参照しない\n${hits.join('\n')}`).toEqual([])
  })

  it('本番のビルド (npm run build) は app だけを作る', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> }
    expect(pkg.scripts.build).toBe('npm run build -w app')
    const app = JSON.parse(read('app/package.json')) as { scripts: Record<string, string> }
    expect(app.scripts.build).not.toMatch(/docs/)
  })

  it('deploy.yml は読む用の Web をビルドも写しもしない', () => {
    const y = read('.github/workflows/deploy.yml')
    expect(y).not.toMatch(/build:docs|stage:docs|docs-web/)
  })

  it('読む用の Web の入口は検索に載せず、拡大を止めない', () => {
    const html = read('docs-web/index.html')
    expect(html).toMatch(/<meta name="robots" content="noindex/)
    expect(html).not.toMatch(/user-scalable=no|maximum-scale/)
  })
})
