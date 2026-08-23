import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { classifyPlainBlock } from '@redstone/sim'
import { blockStateToMinecraftStr } from './world-to-structure.js'
import { defaultPropsOf } from './renderer/buildResources.js'

/**
 * **描こうとした名前が本当に描けるか**を全ブロックで確かめる (#343)。
 *
 * deepslate の variant 選択は全プロパティ完全一致で、一致しないと
 * **例外にならずに何も描かれない**。塀 (#234) もガラス板 (#343) もこれで消えていて、
 * どちらも GIF や実機比較で偶然気づくまで放置されていた。ここで機械的に見張る。
 *
 * 判定データは PrismarineJS の blocks_states.json (mcAssets.ts が実際に使うもの) から
 * variant のキーだけ抜いたスナップショット。**MC_VERSION を上げたら取り直すこと**。
 */

const VARIANTS: Record<string, string[] | '*'> = JSON.parse(
  readFileSync(new URL('../test/blockstate-variants.1.21.4.json', import.meta.url), 'utf-8'),
)

function parseDrawn(str: string): { id: string; props: Record<string, string> } {
  const m = /^(?:minecraft:)?([a-z0-9_]+)(?:\[(.*)\])?$/.exec(str)
  if (!m) throw new Error(`描画名をパースできない: ${str}`)
  const props: Record<string, string> = {}
  for (const kv of (m[2] ?? '').split(',').filter(Boolean)) {
    const [k, v] = kv.split('=')
    props[k] = v
  }
  return { id: m[1], props }
}

/** deepslate の ChunkBuilder + BlockDefinition と同じ手順で「描けるか」を判定する */
function whyInvisible(drawn: string): string | null {
  const { id, props } = parseDrawn(drawn)
  const variants = VARIANTS[id]
  if (variants === undefined) return 'blockstate 定義が無い'
  if (variants === '*') return null                      // multipart は常に何か描く
  if (variants.length === 0) return 'variants が空'
  // ChunkBuilder は足りないプロパティだけを既定値で補う
  const filled = { ...defaultPropsOf({ variants: Object.fromEntries(variants.map(k => [k, {}])) }), ...props }
  for (const key of variants) {
    if (key === '') return null
    if (key.split(',').every(kv => {
      const [k, v] = kv.split('=')
      return filled[k] === v
    })) return null
  }
  return `variant 不一致 (必要: ${variants.slice(0, 3).join(' | ')} / 補完後: ${JSON.stringify(filled)})`
}

describe('取り込めるブロックは 3D でも描ける (#343)', () => {
  it('**sim が取り込む全ブロックが描ける** (消えるものが 1 つも無い)', () => {
    const invisible: string[] = []
    let checked = 0
    for (const id of Object.keys(VARIANTS)) {
      let sim = null
      try { sim = classifyPlainBlock(id, {}) } catch { /* 取り込めない名前は対象外 */ }
      if (!sim) continue
      checked++
      const drawn = blockStateToMinecraftStr(sim)
      const why = whyInvisible(drawn)
      if (why) invisible.push(`${sim.type} ${id} → ${drawn} : ${why}`)
    }
    expect(checked, '判定データが古いと 0 件になる').toBeGreaterThan(500)
    expect(invisible, '3D から静かに消えるブロック').toEqual([])
  })

  it('既定プロパティは variant の値から作る (原木は縦置き・雪は無し)', () => {
    expect(defaultPropsOf({ variants: { 'axis=x': {}, 'axis=y': {}, 'axis=z': {} } }))
      .toEqual({ axis: 'y' })
    expect(defaultPropsOf({ variants: { 'snowy=false': {}, 'snowy=true': {} } }))
      .toEqual({ snowy: 'false' })
    expect(defaultPropsOf({ variants: { 'facing=east': {}, 'facing=north': {}, 'facing=south': {} } }))
      .toEqual({ facing: 'north' })
  })

  it('好ましい値が無ければ最初の値を使う', () => {
    expect(defaultPropsOf({ variants: { 'level=1': {}, 'level=2': {} } })).toEqual({ level: '1' })
  })

  it('プロパティ不問の variant があれば補わない', () => {
    expect(defaultPropsOf({ variants: { '': {} } })).toEqual({})
  })
})
