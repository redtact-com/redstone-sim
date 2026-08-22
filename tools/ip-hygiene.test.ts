import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * デコンパイル由来の **Java コードの逐語引用**が入り込んでいないかを見張る。
 *
 * このプロジェクトは Minecraft の挙動を別実装したもので、無料の非公式ツールとして公開する。
 * 挙動を自分の言葉で書くのは問題にならない (著作権法 10 条 3 項が「解法」を保護外にしている) が、
 * **コードそのものの写しは別**。コメント・ドキュメントに Java の字面を貼らないこと。
 *
 * 典拠は「クラス名・メソッド名・バージョン + 自分の言葉」で書く。運用は docs/ip-policy.md。
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Java の**文そのもの**に見えるパターン (説明文には出ない形) */
const VERBATIM: { name: string; re: RegExp }[] = [
  { name: 'java コードフェンス', re: /```java/ },
  // `level.setBlock(...);` のような呼び出し文 (末尾セミコロン付き)
  { name: 'Java の呼び出し文', re: /\b(level|state|this|world)\.[A-Za-z]\w*\([^)]*\)\s*;/ },
  // クラス名・メソッド名そのものは**事実**なので許す (典拠として必要)。
  // 落とすのは「文の写し」だけにする
  // メソッドシグネチャの写し
  { name: 'Java のメソッドシグネチャ', re: /\b(public|protected|private)\s+(static\s+)?[\w<>[\]]+\s+\w+\s*\([^)]*\)\s*\{/ },
]

/** 走査対象。生成物・fixture・デコンパイル作業ディレクトリは除く */
const SCAN_EXT = ['.ts', '.tsx', '.md', '.sc', '.mjs']
const SKIP = [
  'tools/ip-hygiene.test.ts',        // このファイル自身 (パターンを持っている)
  'docs/ip-policy.md',               // 書き方の見本として ✗ 例を載せている
  'docs/research/03_legal-decompile.md', // 規約の逐語引用 (これは規約文であってコードではない)
]

function trackedFiles(): string[] {
  return execFileSync('git', ['ls-files'], { cwd: repoRoot, encoding: 'utf-8' })
    .split('\n').filter(Boolean)
    .filter(f => SCAN_EXT.some(e => f.endsWith(e)))
    .filter(f => !SKIP.includes(f))
}

describe('著作権まわりの衛生 (docs/ip-policy.md)', () => {
  it('デコンパイルした Java の逐語引用が入っていない', () => {
    const hits: string[] = []
    for (const f of trackedFiles()) {
      let text: string
      try { text = readFileSync(join(repoRoot, f), 'utf-8') } catch { continue }
      const isMd = f.endsWith('.md')
      text.split('\n').forEach((line, i) => {
        // ソースは**コメント行だけ**を見る。実装の TypeScript が
        // `this.neighborChanged(pos);` のような形で誤検知するため
        const t = line.trim()
        if (!isMd && !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'))) return
        for (const p of VERBATIM) {
          if (p.re.test(line)) hits.push(`${f}:${i + 1} [${p.name}] ${t.slice(0, 100)}`)
        }
      })
    }
    expect(hits, `Java の字面を貼らないこと (典拠はクラス名・メソッド名 + 自分の言葉で書く)\n${hits.join('\n')}`)
      .toEqual([])
  })

  it('手元の絶対パスがコミットされていない (#322)', () => {
    // 公開リポなので **Windows / Linux のユーザ名がそのまま読める**状態を作らない。
    // 回路ファイルは配布物ではないため、パスを残しても再現の助けにならない
    const ABSOLUTE: { name: string; re: RegExp }[] = [
      { name: 'WSL 経由の Windows パス', re: /\/mnt\/[a-z]\/Users\// },
      { name: 'Windows パス', re: /[A-Za-z]:\\Users\\/ },
      { name: 'ホームディレクトリ', re: /\/(home|Users)\/[A-Za-z0-9._-]+\// },
    ]
    const tracked = execFileSync('git', ['ls-files'], { cwd: repoRoot, encoding: 'utf-8' })
      .split('\n').filter(Boolean)
      .filter(f => !f.startsWith('.github/pr-assets/'))   // 画像は中身を見ない
      .filter(f => f !== 'tools/ip-hygiene.test.ts')      // このファイル自身 (パターンを持っている)
    const hits: string[] = []
    for (const f of tracked) {
      let text: string
      try { text = readFileSync(join(repoRoot, f), 'utf-8') } catch { continue }
      if (text.includes('\0')) continue                   // バイナリ
      text.split('\n').forEach((line, i) => {
        for (const p of ABSOLUTE) {
          if (p.re.test(line)) hits.push(`${f}:${i + 1} [${p.name}] ${line.trim().slice(0, 100)}`)
        }
      })
    }
    expect(hits, `絶対パスをコミットしないこと (回路ファイルは circuits/ に置き source はファイル名だけ書く)\n${hits.join('\n')}`)
      .toEqual([])
  })

  it('デコンパイル済みソースがコミットされていない', () => {
    const tracked = execFileSync('git', ['ls-files', 'tools/decompile'], { cwd: repoRoot, encoding: 'utf-8' })
      .split('\n').filter(Boolean)
    // 追跡してよいのは取得スクリプトと監視リストだけ (out/ jars/ work/ は .gitignore 済み)
    const bad = tracked.filter(f => /\/(out|jars|work)\//.test(f) || f.endsWith('.java'))
    expect(bad, 'デコンパイル結果はコミットしない').toEqual([])
  })
})
