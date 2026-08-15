import { describe, it, expect } from 'vitest'
import { SimWorld } from '../src/world'
import type { BlockState, Pos3D } from '../src/types'

/**
 * #155 銅の電球。**1 ブロックで T フリップフロップ**になる素子。
 *
 * 要点は 3 つ:
 *   1. 立ち上がりでのみ lit が反転する (立ち下がりでは powered だけ追随)
 *   2. tile tick を持たないので遅延 0gt — 入力と同じ tick で確定する
 *   3. コンパレーターは **lit** を読む。非導体なので給電は素通りしない
 * [確定: 26.2 CopperBulbBlock / 実機 fixture copper-bulb-toggle・copper-bulb-output]
 */

const solid = (): BlockState => ({ type: 'solid', powered: false })
const bulb = (lit = false, powered = false): BlockState =>
  ({ type: 'copper_bulb', lit, powered })

/** レバー(0) → 銅の電球(1) を並べた世界 */
function bulbWorld(): SimWorld {
  const w = new SimWorld()
  w.setBlockAt([0, -1, 0], solid())
  w.setBlockAt([1, -1, 0], solid())
  w.setBlockAt([0, 0, 0], { type: 'lever', facing: 'up', powered: false } as BlockState)
  w.setBlockAt([1, 0, 0], bulb())
  w.initialize()
  return w
}

const state = (w: SimWorld, pos: Pos3D = [1, 0, 0]): { lit: boolean; powered: boolean } => {
  const b = w.getBlockAt(pos)
  if (b?.type !== 'copper_bulb') throw new Error(`copper_bulb ではない: ${b?.type}`)
  return { lit: b.lit, powered: b.powered }
}

describe('銅の電球のトグル (#155)', () => {
  it('立ち上がりで lit が反転し、同じ tick で確定する', () => {
    const w = bulbWorld()
    expect(state(w)).toEqual({ lit: false, powered: false })

    w.activateBlock(0, 0, 0)                    // ON
    expect(state(w), 'tick を進めずに確定する').toEqual({ lit: true, powered: true })
  })

  it('立ち下がりでは lit が変わらず powered だけ落ちる', () => {
    const w = bulbWorld()
    w.activateBlock(0, 0, 0)
    w.activateBlock(0, 0, 0)                    // OFF
    expect(state(w)).toEqual({ lit: true, powered: false })
  })

  it('ON にした回数の偶奇が lit に残る (T フリップフロップ)', () => {
    const w = bulbWorld()
    const seen: boolean[] = []
    for (let i = 0; i < 4; i++) {
      w.activateBlock(0, 0, 0)                  // ON
      seen.push(state(w).lit)
      w.activateBlock(0, 0, 0)                  // OFF
    }
    expect(seen).toEqual([true, false, true, false])
  })

  it('入力が変わらなければ何も起きない (近隣更新が来ても no-op)', () => {
    const w = bulbWorld()
    w.activateBlock(0, 0, 0)
    const before = state(w)
    // 別の場所にブロックを置いて近隣更新だけ発生させる
    w.setBlockAt([1, 1, 0], solid())
    w.setBlockCommand([1, -1, 1], solid())
    w.settle(16)
    expect(state(w)).toEqual(before)
  })
})

describe('銅の電球の出力 (#155)', () => {
  it('非導体なので給電が素通りしない', () => {
    const w = new SimWorld()
    for (const p of [[0, -1, 0], [1, -1, 0], [2, -1, 0]] as Pos3D[]) w.setBlockAt(p, solid())
    w.setBlockAt([0, 0, 0], { type: 'lever', facing: 'up', powered: false } as BlockState)
    w.setBlockAt([1, 0, 0], bulb())
    w.setBlockAt([2, 0, 0], {
      type: 'wire', power: 0,
      connections: { north: false, south: false, east: false, west: true },
    } as BlockState)
    w.initialize()

    w.activateBlock(0, 0, 0)
    w.settle(16)
    expect(state(w).lit, '電球は点く').toBe(true)
    const wire = w.getBlockAt([2, 0, 0])
    expect(wire?.type === 'wire' && wire.power, 'ダストには給電されない').toBe(0)
  })

  it('コンパレーターは powered ではなく lit を読む', () => {
    const w = new SimWorld()
    for (const p of [[0, -1, 0], [1, -1, 0], [2, -1, 0]] as Pos3D[]) w.setBlockAt(p, solid())
    w.setBlockAt([0, 0, 0], { type: 'lever', facing: 'up', powered: false } as BlockState)
    w.setBlockAt([1, 0, 0], bulb())
    // sim の facing は出力方向。西の電球を読んで東へ出す
    w.setBlockAt([2, 0, 0], {
      type: 'comparator', facing: 'east', mode: 'compare',
      powered: false, outputPower: 0,
    } as BlockState)
    w.initialize()

    w.activateBlock(0, 0, 0)          // 点灯
    w.settle(16)
    const on = w.getBlockAt([2, 0, 0])
    expect(on?.type === 'comparator' && on.outputPower).toBe(15)

    w.activateBlock(0, 0, 0)          // レバーを切る (lit は保持される)
    w.settle(16)
    const still = w.getBlockAt([2, 0, 0])
    expect(state(w).lit, 'lit は保持される').toBe(true)
    expect(still?.type === 'comparator' && still.outputPower, 'コンパレーターも 15 のまま').toBe(15)

    w.activateBlock(0, 0, 0)          // 2 回目の ON で lit が反転
    w.settle(16)
    const off = w.getBlockAt([2, 0, 0])
    expect(state(w).lit).toBe(false)
    expect(off?.type === 'comparator' && off.outputPower).toBe(0)
  })
})
