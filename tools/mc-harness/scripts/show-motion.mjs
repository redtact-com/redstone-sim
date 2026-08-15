#!/usr/bin/env node
// fixture の expect 系列を「上から見た平面図」の時系列として表示する。
// フライングマシンのように構造が移動する回路を目で追うために使う (#123)。
//
//   node tools/mc-harness/scripts/show-motion.mjs <fixture名> [y]
//
// 記号: P=ピストン(粘着は S) H=head M=移動中 O=オブザーバー L=スライム N=蜂蜜
//       #=固体 r=ダスト /=レバー .=空気
import { readFileSync } from 'node:fs'

const name = process.argv[2]
const layer = Number(process.argv[3] ?? 1)
if (!name) { console.error('usage: show-motion.mjs <fixture名> [y]'); process.exit(1) }

const fx = JSON.parse(readFileSync(`packages/sim/test/fixtures/${name}.json`, 'utf8'))
const sym = (b) => {
  if (!b || b.startsWith('air')) return '.'
  if (b.startsWith('piston_head')) return 'H'
  if (b.startsWith('sticky_piston')) return 'S'
  if (b.startsWith('piston')) return 'P'
  if (b.startsWith('moving_piston')) return 'M'
  if (b.startsWith('observer')) return b.includes('powered=true') ? 'O' : 'o'
  if (b.startsWith('slime_block')) return 'L'
  if (b.startsWith('honey_block')) return 'N'
  if (b.startsWith('redstone_wire')) return 'r'
  if (b.startsWith('lever')) return b.includes('powered=true') ? '/' : '\\'
  if (b.startsWith('redstone_block')) return 'R'
  return '#'
}

const { from, to } = fx.region
const grid = new Map()                       // "x,y,z" → blockstate
for (const b of fx.blocks) grid.set(b.pos.join(','), b.block)

const render = (t) => {
  const rows = []
  for (let z = from[2]; z <= to[2]; z++) {
    let row = ''
    for (let x = from[0]; x <= to[0]; x++) row += sym(grid.get(`${x},${layer},${z}`))
    rows.push(row)
  }
  console.log(`t=${String(t).padStart(2)}  ` + rows.join('  |  '))
}

console.log(`# ${name}  y=${layer}  (x: ${from[0]}..${to[0]}, z: ${from[2]}..${to[2]} を | 区切りで表示)`)
render(-1)
for (const e of fx.expect ?? []) {
  for (const c of e.changes) grid.set(c.pos.join(','), c.block)
  render(e.tick)
}
