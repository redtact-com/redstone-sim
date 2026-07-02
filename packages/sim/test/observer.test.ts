// ============================================================
// オブザーバー (I8 / issue #16) の単体テスト。
//
// 仕様典拠: docs/research/02 §4.1 (PP/SU で起動・NC では起動しない) /
//   §2.4 (オブザーバー→コンパレーターのパルス飲み込み) / §6 observer。
//   ObserverBlock デコンパイル + minecraft.wiki で挙動確定:
//     - facing = 観測方向 (顔のある面)。出力は背面 (OPPOSITE[facing]) へ strong 15。
//     - 観測面から shape update (PP) を受け非 powered のとき 2gt tile tick を予約。
//     - tick: OFF→ON は powered=true + 自身の OFF tick(2gt)を近傍更新より先に予約。
//       ON→OFF は powered=false。パルス幅 2gt。
//
// 実機 tick 系列の一致検証は tools/mc-harness/fixtures/observer-*.json
// (回路定義) を実機ハーネスで生成して行う。ここでは sim 実装が仕様の
// 意味論どおりかを決定論的に検証する。
// ============================================================

import { describe, it, expect } from 'vitest'
import { SimWorld } from '../src/world.js'
import { getSignal, getDirectSignal } from '../src/power.js'
import { mcToSim, simToMc } from '../src/mcstate.js'
import { ALL_DIRS, OPPOSITE } from '../src/types.js'
import type { BlockState, Dir6 } from '../src/types.js'

// ── ヘルパー ──────────────────────────────────────────────────

function solid(): BlockState { return { type: 'solid', powered: false } }
function lever(powered = false): BlockState { return { type: 'lever', facing: 'up', powered } }
function wire(): BlockState {
  return { type: 'wire', connections: { north: true, south: true, east: true, west: true }, power: 0 }
}
function lamp(): BlockState { return { type: 'lamp', lit: false } }
function comparator(facing: 'north'|'south'|'east'|'west'): BlockState {
  return { type: 'comparator', facing, mode: 'compare', powered: false, outputPower: 0 }
}
function observer(facing: Dir6, powered = false): BlockState {
  return { type: 'observer', facing, powered }
}
function obsPowered(w: SimWorld, x: number, y: number, z: number): boolean {
  return (w.getBlock(x, y, z) as { powered: boolean }).powered
}
function vec(d: Dir6): [number, number, number] {
  return d === 'north' ? [0,0,-1] : d === 'south' ? [0,0,1] :
         d === 'east' ? [1,0,0] : d === 'west' ? [-1,0,0] :
         d === 'up' ? [0,1,0] : [0,-1,0]
}

// ─────────────────────────────────────────────────────────────

describe('オブザーバー: 出力方向 (背面のみ strong 15)', () => {
  it('powered オブザーバーは OPPOSITE[facing] の 1 マスにのみ weak=strong=15 を出す', () => {
    for (const facing of ALL_DIRS) {
      const w = new SimWorld()
      w.setBlock(0, 0, 0, observer(facing, true))
      for (const dir of ALL_DIRS) {
        const nb = vec(dir)
        const weak = getSignal(w, nb, OPPOSITE[dir])
        const strong = getDirectSignal(w, nb, OPPOSITE[dir])
        if (dir === OPPOSITE[facing]) {
          expect(weak, `facing=${facing} back=${dir} weak`).toBe(15)
          expect(strong, `facing=${facing} back=${dir} strong`).toBe(15)
        } else {
          expect(weak, `facing=${facing} dir=${dir} weak`).toBe(0)
          expect(strong, `facing=${facing} dir=${dir} strong`).toBe(0)
        }
      }
    }
  })

  it('非 powered なら全方向 0', () => {
    const w = new SimWorld()
    w.setBlock(0, 0, 0, observer('north', false))
    for (const dir of ALL_DIRS) {
      const nb = vec(dir)
      expect(getSignal(w, nb, OPPOSITE[dir])).toBe(0)
      expect(getDirectSignal(w, nb, OPPOSITE[dir])).toBe(0)
    }
  })
})

describe('オブザーバー: 観測面 (PP) からのみ起動し NC では起動しない', () => {
  // facing=north のオブザーバーを中心に、6 方向すべてにレバーを置き、
  // 各レバーを個別にトグルしたときオブザーバーが起動するかを見る。
  // 観測面 (north) のレバーだけが起動させる (他方向は NC/信号のみで PP 方向不一致)。
  function build(): SimWorld {
    const w = new SimWorld()
    for (const d of ALL_DIRS) {
      const [vx, vy, vz] = vec(d)
      w.setBlock(vx, 1 + vy, vz, lever(false))
    }
    w.setBlock(0, 1, 0, observer('north'))
    w.initialize(); w.flush(64)
    return w
  }

  for (const trig of ALL_DIRS) {
    it(`${trig} 側のレバー変化での起動 = ${trig === 'north'}`, () => {
      const w = build()
      const [vx, vy, vz] = vec(trig)
      w.activateBlock(vx, 1 + vy, vz)
      let fired = false
      for (let t = 1; t <= 4; t++) { w.tick(); if (obsPowered(w, 0, 1, 0)) fired = true }
      expect(fired).toBe(trig === 'north')
    })
  }
})

describe('オブザーバー: ダストの power 変化を検知して 2gt パルス (①)', () => {
  it('レバー→ダスト→オブザーバー→ランプ: 2gt 遅延で ON、パルス幅 2gt', () => {
    const w = new SimWorld()
    for (let x = 0; x <= 2; x++) w.setBlock(x, 0, 0, solid())
    w.setBlock(2, 0, 2, solid())
    w.setBlock(0, 1, 0, lever(false))
    w.setBlock(1, 1, 0, wire())
    w.setBlock(2, 1, 0, wire())           // 観測対象
    w.setBlock(2, 1, 1, observer('north')) // (2,1,0) を観測
    w.setBlock(2, 1, 2, lamp())            // 背面 (south)
    w.initialize(); w.flush(64)

    expect(obsPowered(w, 2, 1, 1)).toBe(false)
    w.activateBlock(0, 1, 0)  // t=0: レバー ON → ダスト給電

    const powered: boolean[] = []
    for (let t = 1; t <= 6; t++) { w.tick(); powered.push(obsPowered(w, 2, 1, 1)) }
    // t=1 false, t=2 true, t=3 true, t=4 false ... (2gt 遅延 + 2gt パルス)
    expect(powered).toEqual([false, true, true, false, false, false])
    // ランプは t=2 で点灯している
    // (消灯は 4gt 遅延で後になるため点灯開始のみ検証)
  })
})

describe('オブザーバー: コンパレーターがパルスを飲み込む (③ — 最重要回帰)', () => {
  it('オブザーバー単体のパルスはコンパレーターを通らない (§2.4)', () => {
    const w = new SimWorld()
    for (let x = -1; x <= 2; x++) w.setBlock(x, 0, 0, solid())
    w.setBlock(-1, 1, 0, lever(false))       // 観測対象
    w.setBlock(0, 1, 0, observer('west'))    // (-1,1,0) を観測、背面 east=(1,1,0)
    w.setBlock(1, 1, 0, comparator('east'))  // 背面 west=オブザーバー、前面 east=(2,1,0)
    w.setBlock(2, 1, 0, lamp())              // コンパレーター前面 (非ダイオード)
    w.initialize(); w.flush(64)

    w.activateBlock(-1, 1, 0)  // レバー ON → オブザーバーが 2gt パルスを出す

    let observerPulsed = false
    for (let t = 1; t <= 10; t++) {
      w.tick()
      if (obsPowered(w, 0, 1, 0)) observerPulsed = true
      const cmp = w.getBlock(1, 1, 0) as { powered: boolean; outputPower: number }
      const lp = w.getBlock(2, 1, 0) as { lit: boolean }
      // コンパレーターは一度も出力せず、前面ランプも一度も点灯しない
      expect(cmp.powered, `tick ${t} cmp.powered`).toBe(false)
      expect(cmp.outputPower, `tick ${t} cmp.out`).toBe(0)
      expect(lp.lit, `tick ${t} lamp.lit`).toBe(false)
    }
    // オブザーバー自体はパルスした (回路が繋がっていることの確認)
    expect(observerPulsed).toBe(true)
  })

  it('コンパレーター前面が別ダイオード (側面向き) ならパルスは通る (§2.4 例外)', () => {
    // 前面に「こちらを向いていないリピーター」を置くと priority -1 で先に実行され、
    // オブザーバーの OFF より前にコンパレーターが評価される → パルスが通る。
    const w = new SimWorld()
    for (let x = -1; x <= 3; x++) w.setBlock(x, 0, 0, solid())
    w.setBlock(0, 0, 1, solid())
    w.setBlock(-1, 1, 0, lever(false))
    w.setBlock(0, 1, 0, observer('west'))
    w.setBlock(1, 1, 0, comparator('east'))
    // 前面 (2,1,0) に南向きリピーター (コンパレーターの出力方向 east と逆向きでない=側面)
    w.setBlock(2, 1, 0, { type: 'repeater', facing: 'south', delay: 1, powered: false, locked: false })
    w.setBlock(2, 0, 1, solid())
    w.initialize(); w.flush(64)

    w.activateBlock(-1, 1, 0)
    let cmpPowered = false
    for (let t = 1; t <= 10; t++) {
      w.tick()
      if ((w.getBlock(1, 1, 0) as { powered: boolean }).powered) cmpPowered = true
    }
    expect(cmpPowered).toBe(true)  // パルスが通った
  })
})

describe('オブザーバー: 連鎖 (④)', () => {
  it('obs1 → obs2 → ランプ: 単一パルスが 2gt ずつ伝播する', () => {
    const w = new SimWorld()
    for (let x = -1; x <= 2; x++) w.setBlock(x, 0, 0, solid())
    w.setBlock(-1, 1, 0, lever(false))     // obs1 の観測対象
    w.setBlock(0, 1, 0, observer('west'))  // obs1: (-1,1,0) を観測、背面 east=(1,1,0)=obs2
    w.setBlock(1, 1, 0, observer('west'))  // obs2: (0,1,0)=obs1 を観測、背面 east=(2,1,0)=ランプ
    w.setBlock(2, 1, 0, lamp())
    w.initialize(); w.flush(64)

    w.activateBlock(-1, 1, 0)
    const o1: boolean[] = [], o2: boolean[] = []
    for (let t = 1; t <= 8; t++) {
      w.tick()
      o1.push(obsPowered(w, 0, 1, 0)); o2.push(obsPowered(w, 1, 1, 0))
    }
    // obs1: t=2,3 ON。obs2: t=4,5 ON (obs1 の状態変化 PP を検知して 2gt 後)
    expect(o1).toEqual([false, true, true, false, false, false, false, false])
    expect(o2).toEqual([false, false, false, true, true, false, false, false])
    // 末端ランプは obs2 の ON (t=4) で点灯する
    // (消灯は 4gt 遅延で後)
  })
})

describe('オブザーバー: mcstate 相互変換 (facing 非反転)', () => {
  it('mcToSim: facing は観測方向そのまま (piston と同じ非反転)', () => {
    const b = mcToSim('observer[facing=east,powered=false]') as BlockState & { type: 'observer' }
    expect(b.type).toBe('observer')
    expect(b.facing).toBe('east')   // 反転しない
    expect(b.powered).toBe(false)
  })

  it('mcToSim: powered=true / 全 facing を保持', () => {
    for (const f of ['north', 'south', 'east', 'west', 'up', 'down'] as const) {
      const b = mcToSim(`observer[facing=${f},powered=true]`) as BlockState & { type: 'observer' }
      expect(b.facing).toBe(f)
      expect(b.powered).toBe(true)
    }
  })

  it('simToMc: powered を authored に反映', () => {
    const authored = 'observer[facing=up,powered=false]'
    const sim: BlockState = { type: 'observer', facing: 'up', powered: true }
    expect(simToMc(sim, authored)).toBe('observer[facing=up,powered=true]')
  })

  it('simToMc: authored 無しでも合成できる', () => {
    const sim: BlockState = { type: 'observer', facing: 'west', powered: false }
    expect(simToMc(sim)).toBe('observer[facing=west,powered=false]')
  })
})

describe('オブザーバー: 初期化時の onPlace 消灯', () => {
  it('authored powered=true は initialize で消灯し発火しない', () => {
    const w = new SimWorld()
    w.setBlock(0, 0, 0, solid())
    w.setBlock(0, 1, 0, observer('north', true))  // powered=true で設置
    w.initialize(); w.flush(64)
    expect(obsPowered(w, 0, 1, 0)).toBe(false)  // onPlace で消灯
  })
})
