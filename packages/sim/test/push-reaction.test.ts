import { describe, it, expect } from 'vitest'
import { SimWorld } from '../src/world.js'
import { mcToSim } from '../src/mcstate.js'
import { pushReactionOf, hasBlockEntity } from '../src/blocks/pushReaction.js'
import type { BlockState } from '../src/types.js'

// ============================================================
// ピストンの押し反応の表 (R-9 / R-10)。
// [確定: 26.2 PistonBaseBlock.isPushable の判定順と Blocks の登録]。
// 実機の系列は fixture piston-push-normal / piston-push-destroy / piston-push-fluid-be が正。
// ここでは表そのものと、押し構造の解決がその表に従うことを見る。
// ============================================================

const st = (s: string): BlockState => mcToSim(s)!

describe('押し反応の表 (blocks/pushReaction.ts)', () => {
  it('R-9: 検知レール・銅の電球・トラップドア・フェンスゲート・塀・板は normal (押せる)', () => {
    for (const s of [
      'detector_rail[powered=false,shape=east_west,waterlogged=false]',
      'copper_bulb[lit=false,powered=false]',
      'oak_trapdoor[facing=north,half=bottom,open=false,powered=false,waterlogged=false]',
      'iron_trapdoor[facing=north,half=bottom,open=false,powered=false,waterlogged=false]',
      'oak_fence_gate[facing=north,in_wall=false,open=false,powered=false]',
      'stone_brick_wall[east=none,north=none,south=none,up=true,waterlogged=false,west=none]',
      'glass_pane[east=false,north=false,south=false,waterlogged=false,west=false]',
    ]) {
      expect(pushReactionOf(st(s)), s).toBe('normal')
      expect(hasBlockEntity(st(s)), s).toBe(false)
    }
  })

  it('R-9: 扉と budding_amethyst は destroy (壊れる)。クラフターは BlockEntity 持ちで動かない', () => {
    expect(pushReactionOf(st('oak_door[facing=north,half=lower,hinge=left,open=false,powered=false]'))).toBe('destroy')
    expect(pushReactionOf(st('iron_door[facing=north,half=upper,hinge=left,open=false,powered=false]'))).toBe('destroy')
    expect(pushReactionOf(st('budding_amethyst'))).toBe('destroy')
    const crafter = st('crafter[crafting=false,orientation=north_up,triggered=false]')
    expect(pushReactionOf(crafter)).toBe('normal')
    expect(hasBlockEntity(crafter)).toBe(true)
  })

  it('R-10: 水・泡柱・シュルカー・カボチャ類・苔・植木鉢・はしご・頭・苔のカーペットは destroy', () => {
    for (const s of [
      'water[level=0]', 'bubble_column[drag=false]', 'shulker_box[facing=up]', 'red_shulker_box[facing=north]',
      'pumpkin', 'melon', 'carved_pumpkin[facing=north]', 'jack_o_lantern[facing=north]', 'moss_block',
      'flower_pot', 'ladder[facing=west,waterlogged=false]', 'player_head[powered=false,rotation=0]',
      'zombie_wall_head[facing=north,powered=false]', 'skeleton_skull[powered=false,rotation=0]',
      'moss_carpet',
    ]) {
      expect(pushReactionOf(st(s)), s).toBe('destroy')
    }
  })

  it('R-10: 看板・旗・彫刻された本棚は normal だが BlockEntity 持ちで動かない。羊毛のカーペットは押せる', () => {
    for (const s of [
      'oak_sign[rotation=0,waterlogged=false]', 'oak_wall_sign[facing=north,waterlogged=false]',
      'white_banner[rotation=0]', 'white_wall_banner[facing=north]',
      'chiseled_bookshelf[facing=north]',
    ]) {
      expect(pushReactionOf(st(s)), s).toBe('normal')
      expect(hasBlockEntity(st(s)), s).toBe(true)
    }
    expect(pushReactionOf(st('white_carpet'))).toBe('normal')
    expect(hasBlockEntity(st('white_carpet'))).toBe(false)
  })

  it('#253 / #255: 黒曜石・岩盤は block、釉薬テラコッタは push_only。コンテナ・ホッパーは BE 持ち', () => {
    expect(pushReactionOf(st('obsidian'))).toBe('block')
    expect(pushReactionOf(st('bedrock'))).toBe('block')
    expect(pushReactionOf(st('gray_glazed_terracotta[facing=north]'))).toBe('push_only')
    expect(pushReactionOf(st('lodestone'))).toBe('block')
    expect(pushReactionOf(st('piston_head[facing=east,short=false,type=normal]'))).toBe('block')
    for (const s of ['barrel[facing=up,open=false]', 'chest[facing=north,type=single,waterlogged=false]', 'hopper[enabled=true,facing=down]']) {
      expect(pushReactionOf(st(s)), s).toBe('normal')
      expect(hasBlockEntity(st(s)), s).toBe(true)
    }
  })
})

function ticks(w: SimWorld, n: number): void {
  for (let i = 0; i < n; i++) w.tick()
}

/** レバー → ピストン (east) → 対象 の 1 レーン */
function lane(target: BlockState, extra: [number, number, number, BlockState][] = []): SimWorld {
  const w = new SimWorld()
  w.setBlock(0, 1, 0, { type: 'lever', facing: 'up', powered: false })
  w.setBlock(1, 1, 0, { type: 'piston', facing: 'east', extended: false })
  w.setBlock(2, 1, 0, target)
  for (const [x, y, z, b] of extra) w.setBlock(x, y, z, b)
  w.initialize()
  w.activateBlock(0, 1, 0)
  ticks(w, 6)
  return w
}

describe('押し構造の解決が表に従う', () => {
  it('検知レールは壊れずに 1 マス動く (修正前は壊していた)', () => {
    const w = lane(st('detector_rail[powered=false,shape=east_west,waterlogged=false]'),
      [[2, 0, 0, st('stone')], [3, 0, 0, st('stone')]])
    expect(w.getBlock(2, 1, 0)).toMatchObject({ type: 'piston_head' })
    expect(w.getBlock(3, 1, 0)).toMatchObject({ type: 'detector_rail', shape: 'east_west' })
  })

  it('クラフターの前ではピストンが伸びない (修正前は壊していた)', () => {
    const w = lane(st('crafter[crafting=false,orientation=north_up,triggered=false]'))
    expect(w.getBlock(1, 1, 0)).toMatchObject({ type: 'piston', extended: false })
    expect(w.getBlock(2, 1, 0)).toMatchObject({ type: 'crafter' })
  })

  it('扉の下半分を押すと上半分も消える', () => {
    const w = lane(st('oak_door[facing=north,half=lower,hinge=left,open=false,powered=false]'),
      [[2, 2, 0, st('oak_door[facing=north,half=upper,hinge=left,open=false,powered=false]')],
       [2, 0, 0, st('stone')]])
    expect(w.getBlock(2, 1, 0)).toMatchObject({ type: 'piston_head' })
    expect(w.getBlock(2, 2, 0)).toBeNull()
  })

  it('シュルカーボックスは BlockEntity を持つが壊れる。看板は動かない', () => {
    const a = lane(st('shulker_box[facing=up]'))
    expect(a.getBlock(2, 1, 0)).toMatchObject({ type: 'piston_head' })
    expect(a.getBlock(3, 1, 0)).toBeNull()
    const b = lane(st('oak_sign[rotation=0,waterlogged=false]'))
    expect(b.getBlock(1, 1, 0)).toMatchObject({ type: 'piston', extended: false })
    expect(b.getBlock(2, 1, 0)).toMatchObject({ type: 'decor' })
  })

  it('引き戻されて着地した銅の電球は受電を見直す (26.2 PistonMovingBlockEntity.finalTick の neighborChanged)', () => {
    // 押すときはヘッドが電球より後に着地し、その近隣更新が電球に届くので差が出ない。
    // 引き戻しでは電球がピストン本体より後に着地するので、自分への neighborChanged でしか
    // 受電に気づけない。着地先 (2,1,0) の南にレッドストーンブロックを置いておく
    const w = new SimWorld()
    w.setBlock(0, 1, 0, { type: 'lever', facing: 'up', powered: true })
    w.setBlock(1, 1, 0, { type: 'sticky_piston', facing: 'east', extended: true })
    w.setBlock(2, 1, 0, { type: 'piston_head', facing: 'east', sticky: true })
    w.setBlock(3, 1, 0, st('copper_bulb[lit=false,powered=false]'))
    w.setBlock(2, 1, 1, { type: 'redstone_block' })
    w.initialize()
    w.activateBlock(0, 1, 0)
    ticks(w, 6)
    expect(w.getBlock(1, 1, 0)).toMatchObject({ type: 'sticky_piston', extended: false })
    expect(w.getBlock(2, 1, 0)).toMatchObject({ type: 'copper_bulb', lit: true, powered: true })
  })
})
