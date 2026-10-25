import { describe, it, expect } from 'vitest'
import { SimWorld } from '../src/world.js'
import { isConductor, relative } from '../src/power.js'
import { getConnectedWireNeighbors, getWireInputNeighbors } from '../src/blocks/wire.js'
import type { BlockState, Pos3D, WireState } from '../src/types.js'
import { H_DIRS, H_DIR_VEC, ALL_DIRS } from '../src/types.js'

/**
 * ダストの電力は「増分の 2 段 BFS」(world.propagateWireBFS) で更新する。値の計算に使う
 * 入力の近傍 (getWireInputNeighbors。非導体の段は上りしか読まない) と、成分の収集に使う
 * 近傍 (getConnectedWireNeighbors。対称) が別物なので (R-1)、増分更新が定義どおりの値に
 * 収束するかを、ランダムな小さい盤面で「一から計算した値」と突き合わせる。
 *
 * 一から計算する側は blocks/wire.ts を使わず、vanilla の規則をここに書き直したもの
 * [確定: 1.21.1 RedStoneWireBlock.calculateTargetStrength — 隣のワイヤー最大 −1。
 *  横が導体かつ直上が非導体なら 1 段上を、横が非導体なら 1 段下を読む]。
 * 動力源は redstone_block だけにする (6 方向に 15。導体を強充電しない) ので、
 * 源の規則もここに閉じる。
 *
 * 盤面は 4×3×4 (y が 3 層)。vanilla では置けない配置 (支えの無いダスト) も混ぜる。
 * 増分更新の正しさは配置の現実性に依らないはずなので、そのまま検査対象にする。
 */

/** 決定的な乱数 (mulberry32)。seed が同じなら同じ盤面になる */
function makeRng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const SX = 4, SY = 3, SZ = 4

const crossWire = (): WireState => ({
  type: 'wire',
  connections: { north: true, south: true, east: true, west: true },
  power: 0,
})

/** 空気 35% / ダスト 30% / 石 15% / ガラス 8% / ハーフ 6% / レッドストーンブロック 6% */
function randomBlock(r: () => number): BlockState | null {
  const v = r()
  if (v < 0.35) return null
  if (v < 0.65) return crossWire()
  if (v < 0.80) return { type: 'solid', powered: false }
  if (v < 0.88) return { type: 'glass' }
  if (v < 0.94) return { type: 'slab', half: r() < 0.5 ? 'top' : 'bottom' }
  return { type: 'redstone_block' }
}

function* cells(): Generator<Pos3D> {
  for (let x = 0; x < SX; x++) for (let y = 0; y < SY; y++) for (let z = 0; z < SZ; z++) yield [x, y, z]
}

/** 仕様どおりの入力 (blocks/wire.ts を使わない) */
function specInputs(world: SimWorld, [x, y, z]: Pos3D): Pos3D[] {
  const out: Pos3D[] = []
  const aboveConductor = isConductor(world.getBlock(x, y + 1, z))
  for (const dir of H_DIRS) {
    const [dx, dz] = H_DIR_VEC[dir]
    const side = world.getBlock(x + dx, y, z + dz)
    if (side?.type === 'wire') out.push([x + dx, y, z + dz])
    if (isConductor(side)) {
      if (!aboveConductor && world.getBlock(x + dx, y + 1, z + dz)?.type === 'wire') {
        out.push([x + dx, y + 1, z + dz])
      }
    } else if (world.getBlock(x + dx, y - 1, z + dz)?.type === 'wire') {
      out.push([x + dx, y - 1, z + dz])
    }
  }
  return out
}

/** 源: 6 方向に redstone_block があれば 15 */
function specSource(world: SimWorld, pos: Pos3D): number {
  return ALL_DIRS.some(d => world.getBlockAt(relative(pos, d))?.type === 'redstone_block') ? 15 : 0
}

/** 全ダストの電力を 0 から単調に上げて不動点を求める (入力 −1 の規則なので不動点は 1 つ) */
function specPowers(world: SimWorld): Map<string, number> {
  const wires = [...cells()].filter(p => world.getBlockAt(p)?.type === 'wire')
  const power = new Map<string, number>(wires.map(p => [p.join(','), 0]))
  for (let pass = 0; pass < 64; pass++) {
    let changed = false
    for (const p of wires) {
      let v = specSource(world, p)
      for (const q of specInputs(world, p)) v = Math.max(v, (power.get(q.join(',')) ?? 0) - 1)
      if (v !== power.get(p.join(','))) { power.set(p.join(','), v); changed = true }
    }
    if (!changed) return power
  }
  throw new Error('不動点に収束しない')
}

/** sim が持っている電力 */
function simPowers(world: SimWorld): Map<string, number> {
  const m = new Map<string, number>()
  for (const p of cells()) {
    const b = world.getBlockAt(p)
    if (b?.type === 'wire') m.set(p.join(','), b.power)
  }
  return m
}

function expectSame(actual: Map<string, number>, spec: Map<string, number>, label: string): void {
  const diffs: string[] = []
  for (const [k, v] of spec) if (actual.get(k) !== v) diffs.push(`${k}: sim=${actual.get(k)} spec=${v}`)
  for (const k of actual.keys()) if (!spec.has(k)) diffs.push(`${k}: sim だけにある`)
  expect(diffs, label).toEqual([])
}

describe('ダストの増分更新は一から計算した値と一致する (R-1 の非対称な近傍)', () => {
  it('入力の近傍は連結の近傍の部分集合', () => {
    const r = makeRng(7)
    for (let trial = 0; trial < 100; trial++) {
      const world = new SimWorld()
      for (const p of cells()) {
        const b = randomBlock(r)
        if (b) world.setBlockAt(p, b)
      }
      for (const p of cells()) {
        if (world.getBlockAt(p)?.type !== 'wire') continue
        const connected = new Set(getConnectedWireNeighbors(p, world).map(q => q.join(',')))
        for (const q of getWireInputNeighbors(p, world)) {
          expect(connected.has(q.join(',')), `trial ${trial} ${p.join(',')} の入力 ${q.join(',')} が連結の近傍に無い`).toBe(true)
        }
        // 入力の近傍そのものも仕様と一致する
        expect(getWireInputNeighbors(p, world).map(q => q.join(',')).sort())
          .toEqual(specInputs(world, p).map(q => q.join(',')).sort())
      }
    }
  })

  it('initialize と setBlockCommand の連続で、全ダストの電力が仕様の不動点と一致する', () => {
    const r = makeRng(20261024)
    let checks = 0
    for (let trial = 0; trial < 200; trial++) {
      const world = new SimWorld()
      for (const p of cells()) {
        const b = randomBlock(r)
        if (b) world.setBlockAt(p, b)
      }
      world.initialize()
      expectSame(simPowers(world), specPowers(world), `trial ${trial} initialize`)
      for (let step = 0; step < 24; step++) {
        const p: Pos3D = [Math.floor(r() * SX), Math.floor(r() * SY), Math.floor(r() * SZ)]
        world.setBlockCommand(p, randomBlock(r) ?? { type: 'air' })
        expectSame(simPowers(world), specPowers(world), `trial ${trial} step ${step} (${p.join(',')})`)
        checks++
      }
    }
    expect(checks).toBe(200 * 24)
  })

  it('同じ盤面を一から initialize した値とも一致する (増分更新に履歴依存が無い)', () => {
    const r = makeRng(99)
    for (let trial = 0; trial < 100; trial++) {
      const world = new SimWorld()
      const placed = new Map<string, BlockState>()
      for (const p of cells()) {
        const b = randomBlock(r)
        if (b) { world.setBlockAt(p, b); placed.set(p.join(','), b) }
      }
      world.initialize()
      for (let step = 0; step < 16; step++) {
        const p: Pos3D = [Math.floor(r() * SX), Math.floor(r() * SY), Math.floor(r() * SZ)]
        const b = randomBlock(r)
        world.setBlockCommand(p, b ?? { type: 'air' })
        if (b) placed.set(p.join(','), b); else placed.delete(p.join(','))
      }
      const fresh = new SimWorld()
      for (const [k, b] of placed) {
        const [x, y, z] = k.split(',').map(Number)
        fresh.setBlock(x, y, z, b.type === 'wire' ? crossWire() : b)
      }
      fresh.initialize()
      expectSame(simPowers(world), simPowers(fresh), `trial ${trial}`)
    }
  })
})
