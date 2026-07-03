import { describe, it, expect } from 'vitest'
import { SimWorld } from '../src/world.js'
import type { BlockState, WireConnections } from '../src/types.js'

// ============================================================
// ワイヤ接続形状の動的再計算 (#51)
//
// ピストン伸縮で信号源やカットブロックがダスト隣に出現・消滅したとき、
// 接続形状 (と給電・網トポロジー) が vanilla の updateShape 張り替えどおり
// 追随することを検証する。実機系列は fixture dynamic-connect-push /
// dynamic-step-cut が正 (本テストは sim 単体の挙動 pin)。
// ============================================================

function wire(conn: Partial<WireConnections> = {}): BlockState {
  return {
    type: 'wire',
    connections: { north: false, south: false, east: false, west: false, ...conn },
    power: 0,
  }
}
const solid = (): BlockState => ({ type: 'solid', powered: false })
const rblock = (): BlockState => ({ type: 'redstone_block' })
const lever = (powered = false): BlockState => ({ type: 'lever', facing: 'up', powered })

function ticks(w: SimWorld, n: number): void {
  for (let i = 0; i < n; i++) w.tick()
}

describe('動的接続再計算: ピストンが redstone_block をダスト隣へ押し込む (#51)', () => {
  function build(): SimWorld {
    const w = new SimWorld()
    // ダスト線 (E-W): 実接続で直線
    w.setBlock(1, 0, 0, wire({ east: true, west: true }))
    w.setBlock(2, 0, 0, wire({ east: true, west: true }))
    w.setBlock(3, 0, 0, wire({ east: true, west: true }))
    // 南から北向きに rblock を押し込む粘着ピストン
    w.setBlock(2, 0, 3, { type: 'sticky_piston', facing: 'north', extended: false })
    w.setBlock(2, 0, 2, rblock())
    w.setBlock(2, 0, 4, lever(false))
    w.initialize()
    return w
  }

  it('押し込みで dust が south 接続を得て給電され、引き抜きで元の直線に戻る', () => {
    const w = build()
    // 初期: 直線 E-W、電力 0
    expect(w.getBlock(2, 0, 0)).toMatchObject({
      type: 'wire', power: 0,
      connections: { east: true, west: true, north: false, south: false },
    })

    w.activateBlock(2, 0, 4)   // lever ON → extend
    ticks(w, 6)                 // BE 実行 + 2gt 確定まで

    // rblock が (2,0,1) に確定 → 中央 dust は T 字 (south 接続追加) + 15
    expect(w.getBlock(2, 0, 1)).toMatchObject({ type: 'redstone_block' })
    expect(w.getBlock(2, 0, 0)).toMatchObject({
      type: 'wire', power: 15,
      connections: { east: true, west: true, north: false, south: true },
    })
    expect(w.getBlock(1, 0, 0)).toMatchObject({ type: 'wire', power: 14 })
    expect(w.getBlock(3, 0, 0)).toMatchObject({ type: 'wire', power: 14 })

    w.activateBlock(2, 0, 4)   // lever OFF → retract (sticky が rblock を引き戻す)
    ticks(w, 6)

    expect(w.getBlock(2, 0, 2)).toMatchObject({ type: 'redstone_block' })
    expect(w.getBlock(2, 0, 1) ?? { type: 'air' }).toMatchObject({ type: 'air' })
    expect(w.getBlock(2, 0, 0)).toMatchObject({
      type: 'wire', power: 0,
      connections: { east: true, west: true, north: false, south: false },
    })
    expect(w.getBlock(1, 0, 0)).toMatchObject({ type: 'wire', power: 0 })
  })
})

describe('動的接続再計算: 上りステップのカット (#51)', () => {
  function build(): SimWorld {
    const w = new SimWorld()
    // A(1,1,0) -- 上りステップ --> B(2,2,0) on solid(2,1,0)。B は真上の rblock で 15
    w.setBlock(1, 1, 0, wire({ east: 'up', west: true }))
    w.setBlock(2, 1, 0, solid())
    w.setBlock(2, 2, 0, wire({ east: true, west: true }))
    w.setBlock(2, 3, 0, rblock())
    // A の真上 (1,2,0) へ solid を押し込む粘着ピストン (y=2 の南側)
    w.setBlock(1, 2, 2, { type: 'sticky_piston', facing: 'north', extended: false })
    w.setBlock(1, 2, 1, solid())
    w.setBlock(1, 1, 3, solid())
    w.setBlock(1, 2, 3, lever(false))
    w.initialize()
    return w
  }

  it('直上へ solid が来ると up 接続が切れて網から外れ、引き抜きで復帰する', () => {
    const w = build()
    // 初期: A は up ステップで B と連結し 14
    expect(w.getBlock(1, 1, 0)).toMatchObject({
      type: 'wire', power: 14,
      connections: { east: 'up', west: true, north: false, south: false },
    })

    w.activateBlock(1, 2, 3)   // lever ON → solid が (1,2,0) = A の真上へ
    ticks(w, 6)

    // カット: A は物理接続 0 → cross 化 + 網から外れて 0 (vanilla の張り替えどおり)
    expect(w.getBlock(1, 2, 0)).toMatchObject({ type: 'solid' })
    expect(w.getBlock(1, 1, 0)).toMatchObject({
      type: 'wire', power: 0,
      connections: { east: true, west: true, north: true, south: true },
    })
    // B 側は影響なし
    expect(w.getBlock(2, 2, 0)).toMatchObject({ type: 'wire', power: 15 })

    w.activateBlock(1, 2, 3)   // lever OFF → solid を引き戻す
    ticks(w, 6)

    expect(w.getBlock(1, 1, 0)).toMatchObject({
      type: 'wire', power: 14,
      connections: { east: 'up', west: true, north: false, south: false },
    })
  })
})

describe('動的接続再計算: dot ガード (#51)', () => {
  function buildDotWithPiston(payload: BlockState): SimWorld {
    const w = new SimWorld()
    // dot (真上の rblock で 15 に給電)
    w.setBlock(0, 0, 0, wire())
    w.setBlock(0, 1, 0, rblock())
    // 東から西向きに payload を押し込む粘着ピストン
    w.setBlock(3, 0, 0, { type: 'sticky_piston', facing: 'west', extended: false })
    w.setBlock(2, 0, 0, payload)
    w.setBlock(3, 0, 1, lever(false))
    w.initialize()
    return w
  }

  it('solid が隣に来ても dot は維持される (wasDot && isDot ガード)', () => {
    const w = buildDotWithPiston(solid())
    w.activateBlock(3, 0, 1)
    ticks(w, 6)

    expect(w.getBlock(1, 0, 0)).toMatchObject({ type: 'solid' })
    expect(w.getBlock(0, 0, 0)).toMatchObject({
      type: 'wire', power: 15,
      connections: { north: false, south: false, east: false, west: false },
    })
  })

  it('redstone_block が隣に来ると接続が生えて dot でなくなる (直線化)', () => {
    const w = buildDotWithPiston(rblock())
    w.activateBlock(3, 0, 1)
    ticks(w, 6)

    expect(w.getBlock(1, 0, 0)).toMatchObject({ type: 'redstone_block' })
    // raw east=true (信号源) → ガード不成立 → 1 本 → 直線 E-W へ拡張
    expect(w.getBlock(0, 0, 0)).toMatchObject({
      type: 'wire', power: 15,
      connections: { north: false, south: false, east: true, west: true },
    })
  })
})
