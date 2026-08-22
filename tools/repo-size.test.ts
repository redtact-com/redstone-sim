import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * PR 用の素材でリポジトリが膨らむのを止める (#326)。
 *
 * `.github/pr-assets/` は PR 本文から raw URL で参照する画像置き場で、
 * **消すと過去の PR が壊れる**ため後から整理が効かない。追跡ファイル 33MB のうち
 * 24MB (約 7 割) がここだった。1 枚ずつは小さく見えても PR ごとに積み上がる。
 *
 * `npm run demo-gif` は差分フレームで書くようになったので (#326)、
 * 180 フレームの回路デモでも 450KB 程度に収まる。これを超えるものは
 * 撮り方 (`--every` でフレームを間引く / `--width` を落とす) を見直す合図。
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const LIMIT_BYTES = 2 * 1024 * 1024

/**
 * #326 以前に撮った素材。**消すと過去の PR の画像が壊れる**ので残す。
 * 新しく足すものは上限を守ること (ここに書き足して回避しない)
 */
const GRANDFATHERED = new Set([
  '.github/pr-assets/292-piston-land-front-resolve/piston-land-front-land.gif',
])

describe('リポジトリ容量の衛生 (#326)', () => {
  it(`PR 素材は 1 枚 ${LIMIT_BYTES / 1024 / 1024}MB 以内`, () => {
    const tracked = execFileSync('git', ['ls-files', '.github/pr-assets'], {
      cwd: repoRoot, encoding: 'utf-8',
    }).split('\n').filter(Boolean)
    const over = tracked
      .filter(f => !GRANDFATHERED.has(f))
      .map(f => ({ f, size: statSync(join(repoRoot, f)).size }))
      .filter(x => x.size > LIMIT_BYTES)
      .map(x => `${x.f} (${(x.size / 1024 / 1024).toFixed(1)}MB)`)
    expect(over, 'PR 素材が大きすぎる。--every でフレームを間引くか --width を落として撮り直す')
      .toEqual([])
  })

  it('据え置き扱いのファイルは実在する (消えたら一覧から外す)', () => {
    const tracked = new Set(execFileSync('git', ['ls-files', '.github/pr-assets'], {
      cwd: repoRoot, encoding: 'utf-8',
    }).split('\n').filter(Boolean))
    expect([...GRANDFATHERED].filter(f => !tracked.has(f))).toEqual([])
  })
})
