import { describe, it, expect } from 'vitest'
import { SimWorld } from '../src/world'
import type { BlockState, Pos3D } from '../src/types'

/**
 * #157 トラップドア / フェンスゲート。**受電で開閉する出力素子**。
 *
 * 要点は 3 つ:
 *   1. `signal != powered` のとき open を signal に合わせ powered を追随させる
 *   2. 書き込みは **flag 2** = 近隣更新を出さない (オブザーバーには見える)
 *   3. 素手の開閉は **open だけ**動かす → 信号が変わるまで補正されない (デシンク)
 * [確定: 26.2 TrapDoorBlock / FenceGateBlock / 実機 fixture trapdoor-redstone・-desync]
 */

const solid = (): BlockState => ({ type: 'solid', powered: false })
type DoorType = 'trapdoor_wood' | 'trapdoor_iron' | 'fence_gate'
const door = (type: DoorType, open = false, powered = false): BlockState =>
  ({ type, facing: 'north', open, powered })

/** レバー(0) → 対象(1) を並べた世界 */
function doorWorld(type: DoorType): SimWorld {
  const w = new SimWorld()
  w.setBlockAt([0, -1, 0], solid())
  w.setBlockAt([0, 0, 0], { type: 'lever', facing: 'up', powered: false } as BlockState)
  w.setBlockAt([1, 0, 0], door(type))
  w.initialize()
  return w
}
const at = (w: SimWorld, pos: Pos3D = [1, 0, 0]): { open: boolean; powered: boolean } => {
  const b = w.getBlockAt(pos)
  if (b?.type !== 'trapdoor_wood' && b?.type !== 'trapdoor_iron' && b?.type !== 'fence_gate') {
    throw new Error(`door 系ではない: ${b?.type}`)
  }
  return { open: b.open, powered: b.powered }
}

describe('トラップドア / フェンスゲートの受電 (#157)', () => {
  for (const type of ['trapdoor_wood', 'trapdoor_iron', 'fence_gate'] as DoorType[]) {
    it(`${type} はレバーで開閉する`, () => {
      const w = doorWorld(type)
      expect(at(w)).toEqual({ open: false, powered: false })
      w.activateBlock(0, 0, 0)
      expect(at(w), '同じ tick で開く').toEqual({ open: true, powered: true })
      w.activateBlock(0, 0, 0)
      expect(at(w)).toEqual({ open: false, powered: false })
    })
  }

  it('開閉では近隣更新を出さない (flag 2)', () => {
    // 更新を待っているピストンの隣で開閉しても伸びない
    const w = new SimWorld()
    w.setBlockAt([0, -1, 0], solid())
    w.setBlockAt([0, 0, 0], { type: 'lever', facing: 'up', powered: false } as BlockState)
    w.setBlockAt([1, 0, 0], door('trapdoor_wood'))
    // トラップドアの西隣にピストン。quasi セルを通電させておくが更新は届いていない
    w.setBlockAt([1, 0, 1], { type: 'piston', facing: 'south', extended: false } as BlockState)
    w.setBlockAt([1, 1, 1], solid())
    w.initialize()
    w.setBlockAt([2, 1, 1], { type: 'redstone_block' } as BlockState)   // 更新を出さない
    w.settle(16)
    const before = w.getBlockAt([1, 0, 1])
    expect(before?.type === 'piston' && before.extended, '前提: BUD 状態').toBe(false)

    w.activateBlock(0, 0, 0)          // トラップドアが開く
    w.settle(16)
    expect(at(w).open).toBe(true)
    const after = w.getBlockAt([1, 0, 1])
    expect(after?.type === 'piston' && after.extended, '近隣更新が出ないので伸びない').toBe(false)
  })

  it('開閉はオブザーバーには見える (updateShape は走る)', () => {
    const w = new SimWorld()
    w.setBlockAt([0, -1, 0], solid())
    w.setBlockAt([0, 0, 0], { type: 'lever', facing: 'up', powered: false } as BlockState)
    w.setBlockAt([1, 0, 0], door('trapdoor_wood'))
    w.setBlockAt([1, 1, 0], { type: 'observer', facing: 'down', powered: false } as BlockState)
    w.initialize()

    w.activateBlock(0, 0, 0)
    let fired = false
    for (let t = 0; t < 4; t++) {
      w.tick()
      const o = w.getBlockAt([1, 1, 0])
      if (o?.type === 'observer' && o.powered) fired = true
    }
    expect(fired).toBe(true)
  })
})

describe('素手の開閉とデシンク (#157)', () => {
  it('素手では open だけが動き powered は据え置かれる', () => {
    const w = doorWorld('trapdoor_wood')
    w.activateBlock(1, 0, 0)
    expect(at(w), '通電していないのに開く').toEqual({ open: true, powered: false })
  })

  it('信号が変わるまで補正されない', () => {
    const w = doorWorld('trapdoor_wood')
    w.activateBlock(1, 0, 0)          // 素手で開ける (powered=false のまま)
    w.activateBlock(0, 0, 0)          // レバー ON → powered だけ追随
    expect(at(w)).toEqual({ open: true, powered: true })
    w.activateBlock(0, 0, 0)          // レバー OFF → ここで閉じる
    expect(at(w)).toEqual({ open: false, powered: false })
  })

  it('鉄のトラップドアは素手で開かない', () => {
    const w = doorWorld('trapdoor_iron')
    w.activateBlock(1, 0, 0)
    expect(at(w)).toEqual({ open: false, powered: false })
    w.activateBlock(0, 0, 0)          // レバーでなら開く
    expect(at(w)).toEqual({ open: true, powered: true })
  })

  it('フェンスゲートも素手で開閉できる', () => {
    const w = doorWorld('fence_gate')
    w.activateBlock(1, 0, 0)
    expect(at(w)).toEqual({ open: true, powered: false })
  })
})
