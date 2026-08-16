import { it } from 'vitest'
import { readFileSync } from 'node:fs'
import { importFromNbtBytes } from './nbtIO'
import { SimWorld } from '@redstone/sim'
import type { BlockState } from '@redstone/sim'

const F = (n: string) => `/mnt/c/Users/TN256/Downloads/Runa.S_2wide(${n}).nbt`
const load = async (n: string) => (await importFromNbtBytes(new Uint8Array(readFileSync(F(n))))).blocks

// NBT に現れない内部フィールドは比較しない (cooldownUntil / burnedOut / 派生 powered など)
const IGNORE = new Set(['cooldownUntil', 'burnedOut', 'recentToggles', 'lastToggleTick', 'outputPower'])
function sig(b: BlockState | null): string {
  if (!b) return '-'
  const o = b as unknown as Record<string, unknown>
  if (b.type === 'solid') return 'solid'                       // powered は派生値
  const parts: string[] = []
  for (const k of Object.keys(o).sort()) {
    if (k === 'type' || IGNORE.has(k)) continue
    if (k === 'slots') {                                        // 中身は総数だけ見る
      const n = (o[k] as ({ count: number } | null)[]).reduce((a, s) => a + (s?.count ?? 0), 0)
      parts.push(`items=${n}`); continue
    }
    parts.push(`${k}=${JSON.stringify(o[k])}`)
  }
  return `${b.type}{${parts.join(',')}}`
}

it('sim2', async () => {
  const opened = await load('opened'), closed = await load('closed')
  const w = new SimWorld()
  for (const [k, b] of opened) { const [x,y,z] = k.split(',').map(Number); w.setBlockAt([x,y,z], b) }
  w.initialize(); w.flush(64)

  const keys = new Set<string>([...closed.keys(), ...opened.keys()])
  const count = () => {
    let n = 0
    for (const k of keys) {
      const [x,y,z] = k.split(',').map(Number)
      if (sig(w.getBlock(x,y,z)) !== sig(closed.get(k as never) ?? null)) n++
    }
    return n
  }
  console.log('レバー ON 前の closed との差分:', count())
  w.activateBlock(4, 5, 5)
  const series: string[] = []
  for (let t = 1; t <= 240; t++) {
    w.tick()
    if (t % 10 === 0 || t <= 5) series.push(`${t}:${count()}`)
  }
  console.log('差分の推移 (tick:件数):', series.join(' '))

  const diffs: string[] = []
  for (const k of keys) {
    const [x,y,z] = k.split(',').map(Number)
    const g = sig(w.getBlock(x,y,z)), e = sig(closed.get(k as never) ?? null)
    if (g !== e) diffs.push(`  ${k.padEnd(8)} sim=${g.padEnd(52)} 実機=${e}`)
  }
  console.log(`\n=== 最終差分 ${diffs.length} 件 ===`)
  diffs.sort().forEach(d => console.log(d))
}, 120000)
