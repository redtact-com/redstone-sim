import { describe, it, expect } from 'vitest'
import { SimWorld } from '../src/world'
import type { BlockState, Pos3D } from '../src/types'

/**
 * #159 ドア。**上下 2 マスにまたがる素子**で、sim では half を持つ独立した
 * 2 ブロックとして表現する (ピストン + ピストンヘッドと同じ前例)。
 *
 * 要点は 3 つ:
 *   1. 受電判定は **自分 または 相方の半分** の OR (疑似接続の変種)
 *   2. 状態が変わったら相方へミラーする (vanilla の updateShape 相当)
 *   3. 素手の開閉は open だけを動かし、相方にも伝わる
 * [確定: 26.2 DoorBlock / 実機 fixture door-redstone・door-desync]
 */

const solid = (): BlockState => ({ type: 'solid', powered: false })
type DoorType = 'door_wood' | 'door_iron'
const door = (type: DoorType, half: 'lower' | 'upper'): BlockState =>
  ({ type, half, facing: 'north', open: false, powered: false })

const LOWER: Pos3D = [1, 0, 0]
const UPPER: Pos3D = [1, 1, 0]

/** レバーの位置を選べるドアの世界 (下半分の隣 / 上半分の隣) */
function doorWorld(type: DoorType, leverAt: 'lower' | 'upper'): SimWorld {
  const w = new SimWorld()
  w.setBlockAt([0, -1, 0], solid())
  w.setBlockAt([1, -1, 0], solid())
  w.setBlockAt(LOWER, door(type, 'lower'))
  w.setBlockAt(UPPER, door(type, 'upper'))
  // レバーは下半分の西隣 (0,0,0) か、上半分の西隣 (0,1,0)
  w.setBlockAt(leverAt === 'lower' ? [0, 0, 0] : [0, 1, 0],
    { type: 'lever', facing: 'up', powered: false } as BlockState)
  w.initialize()
  return w
}
const at = (w: SimWorld, pos: Pos3D): { open: boolean; powered: boolean } => {
  const b = w.getBlockAt(pos)
  if (b?.type !== 'door_wood' && b?.type !== 'door_iron') throw new Error(`door ではない: ${b?.type}`)
  return { open: b.open, powered: b.powered }
}

describe('ドアの受電は上下の OR (#159)', () => {
  it('下半分だけに給電しても両方が開く', () => {
    const w = doorWorld('door_wood', 'lower')
    w.activateBlock(0, 0, 0)
    expect(at(w, LOWER)).toEqual({ open: true, powered: true })
    expect(at(w, UPPER), '相方にもミラーされる').toEqual({ open: true, powered: true })
  })

  it('上半分だけに給電しても両方が開く', () => {
    const w = doorWorld('door_wood', 'upper')
    w.activateBlock(0, 1, 0)
    expect(at(w, LOWER)).toEqual({ open: true, powered: true })
    expect(at(w, UPPER)).toEqual({ open: true, powered: true })
  })

  it('給電を切ると両方閉じる', () => {
    const w = doorWorld('door_wood', 'lower')
    w.activateBlock(0, 0, 0)
    w.activateBlock(0, 0, 0)
    expect(at(w, LOWER)).toEqual({ open: false, powered: false })
    expect(at(w, UPPER)).toEqual({ open: false, powered: false })
  })

  it('鉄のドアもレッドストーンでは同じに動く', () => {
    const w = doorWorld('door_iron', 'upper')
    w.activateBlock(0, 1, 0)
    expect(at(w, LOWER)).toEqual({ open: true, powered: true })
    expect(at(w, UPPER)).toEqual({ open: true, powered: true })
  })

  it('開閉では近隣更新を出さない (flag 2)', () => {
    const w = new SimWorld()
    w.setBlockAt([0, -1, 0], solid())
    w.setBlockAt([1, -1, 0], solid())
    w.setBlockAt(LOWER, door('door_wood', 'lower'))
    w.setBlockAt(UPPER, door('door_wood', 'upper'))
    w.setBlockAt([0, 0, 0], { type: 'lever', facing: 'up', powered: false } as BlockState)
    // ドアの南隣にピストン。quasi セルを通電させておくが更新は届いていない
    w.setBlockAt([1, 0, 1], { type: 'piston', facing: 'south', extended: false } as BlockState)
    w.setBlockAt([1, 1, 1], solid())
    w.initialize()
    w.setBlockAt([2, 1, 1], { type: 'redstone_block' } as BlockState)
    w.settle(16)
    const before = w.getBlockAt([1, 0, 1])
    expect(before?.type === 'piston' && before.extended, '前提: BUD 状態').toBe(false)

    w.activateBlock(0, 0, 0)
    w.settle(16)
    expect(at(w, LOWER).open).toBe(true)
    const after = w.getBlockAt([1, 0, 1])
    expect(after?.type === 'piston' && after.extended, '近隣更新が出ないので伸びない').toBe(false)
  })
})

describe('ドアの素手操作 (#159)', () => {
  it('素手では open だけが動き、相方にも伝わる', () => {
    const w = doorWorld('door_wood', 'lower')
    w.activateBlock(1, 0, 0)          // 下半分を素手で開ける
    expect(at(w, LOWER)).toEqual({ open: true, powered: false })
    expect(at(w, UPPER), '相方も開く').toEqual({ open: true, powered: false })
  })

  it('上半分を押しても両方が開く', () => {
    const w = doorWorld('door_wood', 'lower')
    w.activateBlock(1, 1, 0)
    expect(at(w, LOWER)).toEqual({ open: true, powered: false })
    expect(at(w, UPPER)).toEqual({ open: true, powered: false })
  })

  it('信号が変わるまで補正されない', () => {
    const w = doorWorld('door_wood', 'lower')
    w.activateBlock(1, 0, 0)          // 素手で開ける (powered=false)
    w.activateBlock(0, 0, 0)          // レバー ON → powered だけ追随
    expect(at(w, LOWER)).toEqual({ open: true, powered: true })
    w.activateBlock(0, 0, 0)          // レバー OFF → ここで閉じる
    expect(at(w, LOWER)).toEqual({ open: false, powered: false })
    expect(at(w, UPPER)).toEqual({ open: false, powered: false })
  })

  it('鉄のドアは素手で開かない', () => {
    const w = doorWorld('door_iron', 'lower')
    w.activateBlock(1, 0, 0)
    expect(at(w, LOWER)).toEqual({ open: false, powered: false })
    w.activateBlock(0, 0, 0)          // レバーでなら開く
    expect(at(w, LOWER)).toEqual({ open: true, powered: true })
  })
})
