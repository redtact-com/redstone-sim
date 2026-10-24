import { describe, it, expect } from 'vitest'
import { BlockDefinition, BlockModel, type TextureAtlasProvider } from 'deepslate/render'
import { Identifier } from 'deepslate/core'
import {
  SOLID_NAMESPACE, solidId, solidBlockStateJson, solidModelJson, solidColor,
} from './solidResources'

/**
 * 簡易表示の単色の立方体 (#395)。JSON がどこからも取れないときに全ブロックをこれで描く。
 * deepslate が本当に面を出すかを、描画と同じ getMesh で確かめる。
 */

const atlas: TextureAtlasProvider = {
  getTextureAtlas: () => ({}) as ImageData,
  getTextureUV: () => [0, 0, 1, 1],
}
const models = {
  getBlockModel: (id: Identifier) =>
    id.namespace === SOLID_NAMESPACE
      ? BlockModel.fromJson(solidModelJson(id.path.replace(/^solid\//, '')))
      : null,
}
const noCull = { up: false, down: false, north: false, south: false, west: false, east: false }

function quads(name: string, props: Record<string, string>, cull = noCull): number {
  const def = BlockDefinition.fromJson(solidBlockStateJson(name))
  return def.getMesh(Identifier.create(name), props, atlas, models, cull).quads.length
}

describe('単色の立方体 (#395)', () => {
  it.each([
    ['lever', {}],
    ['lever', { face: 'wall', facing: 'east', powered: 'true' }],
    ['redstone_wire', { power: '15', north: 'side', east: 'up', south: 'none', west: 'none' }],
    ['repeater', { delay: '4', facing: 'north', locked: 'false', powered: 'true' }],
  ])('%s %j でも 6 面を返す (variant "" はどのプロパティにも当たる)', (name, props) => {
    expect(quads(name, props)).toBe(6)
  })

  it('隣に隠れる面は出さない (下面を隠すと 5 面)', () => {
    expect(quads('stone', {}, { ...noCull, down: true })).toBe(5)
  })

  it('モデルとテクスチャは redstone-sim の名前空間に置き、バニラの名前とぶつけない', () => {
    expect(solidId('stone')).toBe('redstone-sim:solid/stone')
    expect(solidModelJson('stone').textures.all).toBe('redstone-sim:solid/stone')
  })
})

describe('単色の色 (#395)', () => {
  it('色は名前で決まる (同じ名前なら同じ色、違う名前ならたいてい違う色)', () => {
    expect(solidColor('target')).toBe(solidColor('target'))
    expect(solidColor('target')).toBe(solidColor('minecraft:target'))
    const names = ['target', 'observer', 'piston', 'hopper', 'dropper', 'barrel', 'note_block', 'lodestone']
    expect(new Set(names.map(solidColor)).size).toBe(names.length)
  })

  it('赤石やレバーなど数種は手で決めた色。テクスチャのパスでも同じ色になる', () => {
    expect(solidColor('redstone_wire')).toBe('#a3241b')
    expect(solidColor('block/redstone_dust_dot')).toBe('#a3241b')
    expect(solidColor('lever')).toBe(solidColor('block/lever'))
    expect(solidColor('redstone_lamp')).toBe(solidColor('block/redstone_lamp_on'))
    expect(solidColor('glass')).toBe(solidColor('glass_pane'))
  })

  it('キャンバスにそのまま渡せる書式', () => {
    for (const name of ['target', 'minecraft:entity/chest/normal', 'block/water_still']) {
      expect(solidColor(name)).toMatch(/^(#[0-9a-f]{6}|hsl\(\d+, \d+%, \d+%\))$/)
    }
  })
})
