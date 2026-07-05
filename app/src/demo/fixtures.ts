/**
 * fixture デモの読み込み。
 *
 * packages/sim/test/fixtures/*.json を import.meta.glob でビルド時に同梱する
 * (eager)。fixture がそのままデモの回路 + 入力 + tick 数になる — 実機検証済みの
 * 資産を再利用するのがこのデモ基盤の設計意図 (issue #70)。
 */

import type { Fixture } from '@redstone/sim'

// eager import: JSON はバンドルへインライン化され、実行時 fetch 不要。
const modules = import.meta.glob('../../../packages/sim/test/fixtures/*.json', {
  eager: true,
}) as Record<string, { default: Fixture }>

/** fixture 名 → Fixture のマップ (ファイル名の basename をキーにする) */
export const FIXTURES: Record<string, Fixture> = (() => {
  const out: Record<string, Fixture> = {}
  for (const [path, mod] of Object.entries(modules)) {
    const name = path.split('/').pop()!.replace(/\.json$/, '')
    out[name] = mod.default
  }
  return out
})()

/** 利用可能な fixture 名の一覧 (ソート済み) */
export const FIXTURE_NAMES: string[] = Object.keys(FIXTURES).sort()

/**
 * 名前 or fixture JSON から Fixture を解決する。
 * - 文字列で FIXTURES に一致すればそれを返す
 * - 文字列が JSON ならパースして返す
 * - オブジェクトならそのまま Fixture とみなす
 */
export function resolveFixture(nameOrJson: string | Fixture): Fixture | null {
  if (typeof nameOrJson !== 'string') return nameOrJson
  if (FIXTURES[nameOrJson]) return FIXTURES[nameOrJson]
  const trimmed = nameOrJson.trim()
  if (trimmed.startsWith('{')) {
    try {
      return JSON.parse(trimmed) as Fixture
    } catch {
      return null
    }
  }
  return null
}
