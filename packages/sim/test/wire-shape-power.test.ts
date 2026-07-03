import { describe, it, expect } from 'vitest'
import { SimWorld } from '../src/world.js'
import { isBlockPowered } from '../src/power.js'
import type { BlockState, WireConnections, WireState, Dir6 } from '../src/types.js'

// ============================================================
// ダスト形状 × 隣接給電マトリクス (issue #44)
//
// [確定: 26.2 デコンパイル net/minecraft/world/level/block/RedStoneWireBlock]:
//   getSignal(state, level, pos, direction):
//     - direction == DOWN                       → 0   (真上のブロックには給電しない)
//     - power == 0                              → 0
//     - direction == UP                         → power (足元ブロックへ給電)
//     - それ以外 (水平) は getConnectionState の
//       PROPERTY_BY_DIRECTION[direction.opposite].isConnected() のときのみ power
//   getDirectSignal は shouldSignal 中は getSignal と同値 (足元/接続方向を強充電)。
//
// 重要: vanilla は単一接続のダストを直線に自動拡張する
//   (getConnectionState: 接続 0 本→ cross / 1 本→反対側も SIDE = 直線)。
//   → 直線ダストは「接続していない垂直方向」には給電しないが、
//     物理接続の無い延長端 (自動拡張された SIDE 方向) には給電する。
//   sim ではこの拡張を接続導出層 (mcstate.mcToSim は vanilla 拡張済み文字列を
//   そのまま取り込み、editor.computeWireConnections も 0→cross / 1→直線を適用) で
//   済ませ、power.ts の getEmittedSignal は WireState.connections をそのまま読む。
//   本テストは connections を直接与えて power.ts の給電規則のみを検証する。
//
// 詳細は docs/research/11_dust-shape-powering.md 参照。
// ============================================================

const shapes: Record<string, WireConnections> = {
  cross:  { north: true,  south: true,  east: true,  west: true  },
  lineEW: { north: false, south: false, east: true,  west: true  },
  lineNS: { north: true,  south: true,  east: false, west: false },
  bendNE: { north: true,  south: false, east: true,  west: false },
  T_NES:  { north: true,  south: true,  east: true,  west: false },
  dot:    { north: false, south: false, east: false, west: false },
}

const relOf: Record<Dir6, [number, number, number]> = {
  east:  [1, 0, 0],
  west:  [-1, 0, 0],
  north: [0, 0, -1],
  south: [0, 0, 1],
  up:    [0, 1, 0],
  down:  [0, -1, 0],
}

/**
 * wire(0,0,0) power=15 を固定し、相対位置 rel の「機構が動力を受けるか」を
 * isBlockPowered で判定する (initialize しない = 電力再計算を挟まない純クエリ検証)。
 */
function emits(conn: WireConnections, dir: Dir6): boolean {
  const w = new SimWorld()
  const wire: WireState = { type: 'wire', connections: conn, power: 15 }
  w.setBlock(0, 0, 0, wire)
  return isBlockPowered(w, relOf[dir])
}

// 期待マトリクス [確定: 26.2 RedStoneWireBlock.getSignal]
// 各方向へ給電するか (true=給電)
const expectedMatrix: Record<string, Record<Dir6, boolean>> = {
  cross:  { east: true,  west: true,  north: true,  south: true,  up: false, down: true },
  lineEW: { east: true,  west: true,  north: false, south: false, up: false, down: true },
  lineNS: { east: false, west: false, north: true,  south: true,  up: false, down: true },
  bendNE: { east: true,  west: false, north: true,  south: false, up: false, down: true },
  T_NES:  { east: true,  west: false, north: true,  south: true,  up: false, down: true },
  dot:    { east: false, west: false, north: false, south: false, up: false, down: true },
}

describe('ダスト形状×隣接給電マトリクス [確定: 26.2 RedStoneWireBlock]', () => {
  for (const [name, conn] of Object.entries(shapes)) {
    const exp = expectedMatrix[name]
    for (const dir of Object.keys(relOf) as Dir6[]) {
      it(`${name} → ${dir}: ${exp[dir] ? '給電する' : '給電しない'}`, () => {
        expect(emits(conn, dir)).toBe(exp[dir])
      })
    }
  }

  it('直線 (lineEW) は延長端 (east/west) に給電し、垂直方向 (north/south) には給電しない', () => {
    // issue #44 の核心。observer-piston fixture で疑われた「単一接続=直線ダストの
    // 隣接給電」を切り分けたもの: 直線は自動拡張された両端にのみ給電する。
    expect(emits(shapes.lineEW, 'east')).toBe(true)
    expect(emits(shapes.lineEW, 'west')).toBe(true)
    expect(emits(shapes.lineEW, 'north')).toBe(false)
    expect(emits(shapes.lineEW, 'south')).toBe(false)
  })

  it('全形状で真上には給電しない / 足元には給電する', () => {
    for (const conn of Object.values(shapes)) {
      expect(emits(conn, 'up')).toBe(false)
      expect(emits(conn, 'down')).toBe(true)
    }
  })
})

// ============================================================
// 読み手側の検証 (ランプ点灯 / トーチ消灯 / ピストン起動)
//   redstone_block を直下 (down は接続にならない) に置いてダストへ 15 を供給し、
//   形状ごとに検知器の反応を確認する。
// ============================================================

function rblock(): BlockState { return { type: 'redstone_block' } }
function wireWith(conn: WireConnections): WireState {
  return { type: 'wire', connections: conn, power: 0 }
}
function lamp(): BlockState { return { type: 'lamp', lit: false } }
function solid(): BlockState { return { type: 'solid', powered: false } }
function torch(): BlockState { return { type: 'torch', facing: 'up', lit: true } }

/**
 * 初期安定化 + 数 tick 進める。initialize() は BlockEvent (ピストン伸長) を
 * 予約するだけで実行しないため、flush() では処理されない。tick() を数回回して
 * BE フェーズ (ピストン) と 2gt tile tick (トーチ消灯) を確定させる。
 */
function settle(w: SimWorld): void {
  w.initialize()
  for (let i = 0; i < 10; i++) w.tick()
}

describe('読み手側: 直線ダストの給電 (lineEW)', () => {
  it('ランプ: 延長端 (east) は点灯 / 垂直 (north) は消灯のまま', () => {
    const w = new SimWorld()
    w.setBlock(0, -1, 0, rblock())      // 直下から 15 供給
    w.setBlock(0, 0, 0, wireWith(shapes.lineEW))
    w.setBlock(1, 0, 0, lamp())          // east: 延長端
    w.setBlock(0, 0, -1, lamp())         // north: 垂直
    settle(w)

    expect(w.getBlock(0, 0, 0)).toMatchObject({ type: 'wire', power: 15 })
    expect(w.getBlock(1, 0, 0)).toMatchObject({ type: 'lamp', lit: true })
    expect(w.getBlock(0, 0, -1)).toMatchObject({ type: 'lamp', lit: false })
  })

  it('トーチ: 延長端の固体上は消灯 / 垂直の固体上は点灯のまま', () => {
    const w = new SimWorld()
    w.setBlock(0, -1, 0, rblock())
    w.setBlock(0, 0, 0, wireWith(shapes.lineEW))
    w.setBlock(1, 0, 0, solid())         // east: 弱充電される固体
    w.setBlock(1, 1, 0, torch())         // その上のトーチ → 消灯
    w.setBlock(0, 0, -1, solid())        // north: 充電されない固体
    w.setBlock(0, 1, -1, torch())        // その上のトーチ → 点灯のまま
    settle(w)

    expect(w.getBlock(1, 0, 0)).toMatchObject({ type: 'solid', powered: true })
    expect(w.getBlock(1, 1, 0)).toMatchObject({ type: 'torch', lit: false })
    expect(w.getBlock(0, 0, -1)).toMatchObject({ type: 'solid', powered: false })
    expect(w.getBlock(0, 1, -1)).toMatchObject({ type: 'torch', lit: true })
  })

  it('ピストン: 延長端 (east) は伸長 / 垂直 (north) は伸長しない', () => {
    const w = new SimWorld()
    w.setBlock(0, -1, 0, rblock())
    w.setBlock(0, 0, 0, wireWith(shapes.lineEW))
    // east: 延長端。ピストンは wire と反対 (east) を向け、押し先 (2,0,0) は空
    w.setBlock(1, 0, 0, { type: 'piston', facing: 'east', extended: false })
    // north: 垂直。ピストンは wire と反対 (north) を向け、押し先 (0,0,-2) は空
    w.setBlock(0, 0, -1, { type: 'piston', facing: 'north', extended: false })
    settle(w)

    expect(w.getBlock(1, 0, 0)).toMatchObject({ type: 'piston', extended: true })
    expect(w.getBlock(0, 0, -1)).toMatchObject({ type: 'piston', extended: false })
  })
})

describe('読み手側: cross / dot ', () => {
  it('cross: 水平4方向すべてのランプが点灯し、真上は消灯のまま', () => {
    const w = new SimWorld()
    w.setBlock(0, -1, 0, rblock())
    w.setBlock(0, 0, 0, wireWith(shapes.cross))
    w.setBlock(1, 0, 0, lamp())    // east
    w.setBlock(-1, 0, 0, lamp())   // west
    w.setBlock(0, 0, -1, lamp())   // north
    w.setBlock(0, 0, 1, lamp())    // south
    w.setBlock(0, 1, 0, lamp())    // up
    settle(w)

    expect(w.getBlock(1, 0, 0)).toMatchObject({ type: 'lamp', lit: true })
    expect(w.getBlock(-1, 0, 0)).toMatchObject({ type: 'lamp', lit: true })
    expect(w.getBlock(0, 0, -1)).toMatchObject({ type: 'lamp', lit: true })
    expect(w.getBlock(0, 0, 1)).toMatchObject({ type: 'lamp', lit: true })
    expect(w.getBlock(0, 1, 0)).toMatchObject({ type: 'lamp', lit: false })
  })

  it('dot: 水平4方向すべて消灯 / 足元 (下) のランプのみ点灯', () => {
    const w = new SimWorld()
    // dot は水平接続ゼロ。redstone_block を east に置いて 15 を供給し (接続は張らない)、
    // 足元 (下) の lamp のみ点灯することを見る
    w.setBlock(1, 0, 0, rblock())   // east 隣から 15 供給 (dot は接続しない)
    w.setBlock(0, 0, 0, wireWith(shapes.dot))
    w.setBlock(0, -1, 0, lamp())    // down: 足元 → 点灯
    w.setBlock(0, 0, -1, lamp())    // north: 消灯
    w.setBlock(-1, 0, 0, lamp())    // west: 消灯
    settle(w)

    expect(w.getBlock(0, 0, 0)).toMatchObject({ type: 'wire', power: 15 })
    expect(w.getBlock(0, -1, 0)).toMatchObject({ type: 'lamp', lit: true })
    expect(w.getBlock(0, 0, -1)).toMatchObject({ type: 'lamp', lit: false })
    expect(w.getBlock(-1, 0, 0)).toMatchObject({ type: 'lamp', lit: false })
  })
})
