// pane を含む構造 NBT を手で組む (アプリの書き出しは pane を air に潰すため)
import { NbtFile, NbtCompound, NbtList, NbtInt, NbtString } from 'deepslate/nbt'
import { writeFileSync } from 'node:fs'

const palette = []
const idx = new Map()
const add = (name, props) => {
  const key = name + JSON.stringify(props ?? {})
  if (idx.has(key)) return idx.get(key)
  const c = new NbtCompound()
  c.set('Name', new NbtString(name))
  if (props && Object.keys(props).length) {
    const p = new NbtCompound()
    for (const [k, v] of Object.entries(props)) p.set(k, new NbtString(v))
    c.set('Properties', p)
  }
  idx.set(key, palette.length); palette.push(c); return palette.length - 1
}
const blocks = []
const put = (x, y, z, name, props) => {
  const c = new NbtCompound()
  c.set('pos', new NbtList([new NbtInt(x), new NbtInt(y), new NbtInt(z)]))
  c.set('state', new NbtInt(add(name, props)))
  blocks.push(c)
}
// 床 + レバー + ピストン(up) + 板 + オブザーバー (pane-shape-observer の左列の縮小版)
put(0,0,0,'minecraft:stone')
put(1,0,0,'minecraft:stone')
put(2,0,0,'minecraft:stone')
put(3,0,0,'minecraft:stone')
put(0,1,0,'minecraft:lever',{face:'floor',facing:'north',powered:'false'})
put(1,1,0,'minecraft:piston',{extended:'false',facing:'up'})
put(2,1,0,'minecraft:light_blue_stained_glass_pane',{east:'false',north:'false',south:'false',waterlogged:'false',west:'true'})
put(3,1,0,'minecraft:iron_bars',{east:'false',north:'false',south:'false',waterlogged:'false',west:'true'})
put(2,2,0,'minecraft:observer',{facing:'down',powered:'false'})
put(2,0,1,'minecraft:stone')
put(2,1,1,'minecraft:glass_pane',{east:'false',north:'true',south:'false',waterlogged:'false',west:'false'})

const root = new NbtCompound()
root.set('DataVersion', new NbtInt(3955))
root.set('size', new NbtList([new NbtInt(4), new NbtInt(3), new NbtInt(2)]))
root.set('palette', new NbtList(palette))
root.set('blocks', new NbtList(blocks))
root.set('entities', new NbtList([]))
const file = NbtFile.create({ compression: 'gzip', bedrockHeader: false })
file.root = root
const bytes = file.write()
writeFileSync(process.argv[2], bytes)
console.log('wrote', process.argv[2], bytes.length, 'bytes')
