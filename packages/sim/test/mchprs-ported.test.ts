// ============================================================
// MCHPRS 移植テスト (I10 #18)
//
// 出典: https://github.com/MCHPR/MCHPRS  (MIT License)
//   Copyright (c) 2020 StackDoubleFlow and MCHPRS contributors
//   tests/components.rs (9 件) + tests/timings.rs (3 件) を @redstone/sim へ移植。
//   MIT ライセンスの下で再配布・改変している (元コードは Rust。回路配置と
//   期待挙動のみを TypeScript へ書き起こした)。
//
// 注意 (docs/research/04 §2.4):
//   MCHPRS はワイヤ更新順の典拠には使わない。ここでは「素子の ON/OFF タイミングと
//   到達距離」の挙動照合のみに使う。sim と期待値が食い違うケースは it.skip +
//   理由コメントで報告する (勝手に sim を変えない)。今は 12 件すべて通る。
//
// ── 移植上の対応付け ──
//   * TestWorld の tick() = 1 redstone tick = **2 game tick**。sim は game tick 駆動
//     なので tick() は world.tick() を 2 回呼ぶ。
//     (MCHPRS の repeater delay=1 → 1 tick / lamp off → 2 tick / torch off → 1 tick は
//      すべて「1 MCHPRS tick = 2 gt」で vanilla と一致する。)
//   * use_block(pos) = activateBlock(pos) (即時反映)。
//   * check_block_powered(pos) = 対象素子の powered/lit を読む。
//     検出器は MCHPRS と同じく鉄のトラップドアを置き、その powered を読む。
//     素子でないマスを読むとテストを落とす (MCHPRS も同じ)。
//   * make_wire = 全方向 side の cross ダスト (MCHPRS make_cross(0) と同じ)。
//   * make_lever/make_repeater/make_comparator = place_on_block 相当 (下に stone)。
//   * repeater/comparator の MC facing は入力側なので sim へは mcToSim が OPPOSITE 変換する。
// ============================================================

import { describe, it, expect } from 'vitest'
import { SimWorld, mcToSim } from '@redstone/sim'
import type { Pos3D, BlockState } from '@redstone/sim'

// ── 移植ハーネス ─────────────────────────────────────────

/** MCHPRS BlockDirection (= MC facing 文字列) */
type Dir = 'north' | 'south' | 'east' | 'west'

/** MCHPRS trapdoor(): 検出器に使う鉄のトラップドア (閉じている・受電なし) */
const TRAPDOOR = 'iron_trapdoor[facing=north,half=bottom,open=false,powered=false,waterlogged=false]'

class Harness {
  readonly world = new SimWorld()

  /** MC blockstate 文字列を置く (mcToSim 経由。air は空マス) */
  private place(pos: Pos3D, mc: string): void {
    const b = mcToSim(mc)
    if (b) this.world.setBlockAt(pos, b)
  }

  /** place_on_block: 対象の 1 マス下に stone を敷いてから設置する */
  placeOn(pos: Pos3D, mc: string): void {
    this.place([pos[0], pos[1] - 1, pos[2]], 'stone')
    this.place(pos, mc)
  }

  setBlock(pos: Pos3D, mc: string): void {
    this.place(pos, mc)
  }

  makeLever(pos: Pos3D): void {
    this.placeOn(pos, 'lever[face=floor,facing=west,powered=false]')
  }

  makeWire(pos: Pos3D): void {
    // make_cross(0): 全 4 方向 side の十字ダスト
    this.placeOn(pos, 'redstone_wire[east=side,north=side,south=side,west=side,power=0]')
  }

  makeRepeater(pos: Pos3D, delay: number, facing: Dir): void {
    this.placeOn(pos, `repeater[delay=${delay},facing=${facing},locked=false,powered=false]`)
  }

  makeComparator(pos: Pos3D, mode: 'compare' | 'subtract', facing: Dir): void {
    this.placeOn(pos, `comparator[facing=${facing},mode=${mode},powered=false]`)
  }

  /** 初期安定化 (実機 settle 相当)。以後 use/tick で駆動する */
  settle(): void {
    this.world.initialize()
    this.world.flush(64)
  }

  useBlock(pos: Pos3D): void {
    this.world.activateBlock(pos[0], pos[1], pos[2])
  }

  /** 1 MCHPRS tick = 2 game tick */
  tick(): void {
    this.world.tick()
    this.world.tick()
  }

  /**
   * 対象マスが powered か。素子は自身のプロパティを読む。
   * 素子でないマスは例外にする (MCHPRS is_block_powered の None と同じ)。
   * 検出器の置き忘れを、黙って通さないため
   */
  powered(pos: Pos3D): boolean {
    const b: BlockState | null = this.world.getBlockAt(pos)
    if (b) {
      switch (b.type) {
        case 'lever':
        case 'button_stone':
        case 'button_wood':
        case 'repeater':
        case 'comparator':
        case 'solid':
        case 'trapdoor_iron':
          return b.powered
        case 'torch':
        case 'wall_torch':
        case 'lamp':
          return b.lit
      }
    }
    throw new Error(`${pos} は検出できる素子ではない: ${JSON.stringify(b)}`)
  }

  check(pos: Pos3D, powered: boolean): void {
    expect(this.powered(pos), `at ${pos} expected powered=${powered}`).toBe(powered)
  }

  /** ticks 回、毎回 powered を確認してから tick する (MCHPRS check_powered_for) */
  checkPoweredFor(pos: Pos3D, powered: boolean, ticks: number): void {
    for (let i = 0; i < ticks; i++) {
      this.check(pos, powered)
      this.tick()
    }
  }
}

const pos = (x: number, y: number, z: number): Pos3D => [x, y, z]

// ── components.rs (9 件) ──────────────────────────────────

describe('MCHPRS components.rs (移植)', () => {
  it('lever_on_off', () => {
    const h = new Harness()
    const lever = pos(0, 1, 0)
    h.makeLever(lever)
    h.settle()
    h.check(lever, false)
    h.useBlock(lever)
    h.check(lever, true)
    h.useBlock(lever)
    h.check(lever, false)
  })

  it('trapdoor_on_off', () => {
    const h = new Harness()
    const lever = pos(0, 1, 0)
    const detector = pos(1, 0, 0)
    h.makeLever(lever)
    h.setBlock(detector, TRAPDOOR)
    h.settle()
    h.check(detector, false)
    h.useBlock(lever)
    h.check(detector, true)
    h.useBlock(lever)
    h.check(detector, false)
  })

  it('lamp_on_off', () => {
    const h = new Harness()
    const lever = pos(0, 1, 0)
    const lamp = pos(1, 0, 0)
    h.makeLever(lever)
    h.setBlock(lamp, 'redstone_lamp[lit=false]')
    h.settle()
    h.check(lamp, false)
    h.useBlock(lever)
    h.check(lamp, true)
    h.useBlock(lever)
    h.checkPoweredFor(lamp, true, 2)
    h.check(lamp, false)
  })

  it('wall_torch_on_off', () => {
    const h = new Harness()
    const lever = pos(0, 1, 0)
    const torch = pos(1, 0, 0)
    h.makeLever(lever)
    h.setBlock(torch, 'redstone_wall_torch[facing=east,lit=true]')
    h.settle()
    h.check(torch, true)
    h.useBlock(lever)
    h.checkPoweredFor(torch, true, 1)
    h.check(torch, false)
    h.useBlock(lever)
    h.checkPoweredFor(torch, false, 1)
    h.check(torch, true)
  })

  it('torch_on_off', () => {
    const h = new Harness()
    const lever = pos(0, 2, 0)
    const torch = pos(2, 2, 0)
    h.makeLever(lever)
    h.makeWire(pos(1, 1, 0))
    h.placeOn(torch, 'redstone_torch[lit=true]')
    h.settle()
    h.check(torch, true)
    h.useBlock(lever)
    h.checkPoweredFor(torch, true, 1)
    h.check(torch, false)
    h.useBlock(lever)
    h.checkPoweredFor(torch, false, 1)
    h.check(torch, true)
  })

  it('repeater_on_off (delay 1..4, 1t パルス + 0t パルス)', () => {
    const lever = pos(0, 2, 0)
    const detector = pos(2, 1, 0)
    for (let delay = 1; delay <= 4; delay++) {
      const h = new Harness()
      h.makeLever(lever)
      h.makeRepeater(pos(1, 1, 0), delay, 'west')
      h.setBlock(detector, TRAPDOOR)
      h.settle()
      h.check(detector, false)

      // 1 tick パルス
      h.useBlock(lever)
      h.checkPoweredFor(detector, false, delay)
      h.check(detector, true)
      h.useBlock(lever)
      h.checkPoweredFor(detector, true, delay)
      h.check(detector, false)

      // 0 tick パルス
      h.useBlock(lever)
      h.useBlock(lever)
      h.checkPoweredFor(detector, false, delay)
      h.checkPoweredFor(detector, true, delay)
      h.check(detector, false)
    }
  })

  it('wire_barely_reaches (15 マスで到達)', () => {
    const h = new Harness()
    const lever = pos(0, 1, 0)
    const detector = pos(16, 1, 0)
    h.makeLever(lever)
    for (let x = 1; x <= 15; x++) h.makeWire(pos(x, 1, 0))
    h.setBlock(detector, TRAPDOOR)
    h.settle()
    h.check(detector, false)
    h.useBlock(lever)
    h.check(detector, true)
    h.useBlock(lever)
    h.check(detector, false)
  })

  it('wire_no_reach (16 マスで到達せず)', () => {
    const h = new Harness()
    const lever = pos(0, 1, 0)
    const detector = pos(17, 1, 0)
    h.makeLever(lever)
    for (let x = 1; x <= 16; x++) h.makeWire(pos(x, 1, 0))
    h.setBlock(detector, TRAPDOOR)
    h.settle()
    h.check(detector, false)
    h.useBlock(lever)
    h.check(detector, false)
    h.useBlock(lever)
    h.check(detector, false)
  })

  it('ground_torch_does_not_power_block_below (MCHPRS #218)', () => {
    // 床置きトーチは直上のみ強充電し、真下のブロックは充電しない。
    // MCHPRS 原典は lamp を tile tick で消灯させて確認するが、sim は
    // initialize() が「点灯=入力あり」を再計算するため、settle 後に
    // 「トーチは点灯・真下ランプは消灯」を直接確認する形で移植する。
    const h = new Harness()
    const torch = pos(0, 1, 0)
    const lamp = pos(0, 0, 0)
    h.setBlock(lamp, 'redstone_lamp[lit=true]')
    h.setBlock(torch, 'redstone_torch[lit=true]')
    h.settle()
    h.check(lamp, false)   // トーチは真下を充電しない → ランプ消灯
    h.check(torch, true)   // トーチ自身は点灯のまま
  })
})

// ── timings.rs (3 件) ─────────────────────────────────────

describe('MCHPRS timings.rs (移植)', () => {
  it('repeater_t_flip_flop', () => {
    const h = new Harness()
    const output = pos(1, 1, 2)
    const lever = pos(0, 1, 0)

    h.makeLever(lever)
    h.makeWire(pos(1, 1, 0))
    h.makeWire(pos(2, 1, 0))
    h.makeRepeater(pos(1, 1, 1), 1, 'north')
    h.makeRepeater(pos(2, 1, 1), 1, 'north')
    h.makeRepeater(output, 1, 'east')
    h.makeWire(pos(2, 1, 2))
    h.settle()

    h.useBlock(lever)
    h.checkPoweredFor(output, false, 2)

    h.useBlock(lever)
    h.checkPoweredFor(output, false, 2)
    h.useBlock(lever)
    h.checkPoweredFor(output, true, 10)

    h.useBlock(lever)
    h.checkPoweredFor(output, true, 2)
    h.useBlock(lever)
    h.checkPoweredFor(output, false, 10)
  })

  it('pulse_gen_2t', () => {
    const h = new Harness()
    const output = pos(4, 1, 1)
    const lever = pos(0, 1, 1)

    h.makeWire(pos(1, 1, 0))
    h.makeRepeater(pos(2, 1, 0), 2, 'west')
    h.makeWire(pos(3, 1, 0))

    h.makeLever(lever)
    h.makeWire(pos(1, 1, 1))
    h.makeWire(pos(2, 1, 1))
    h.makeComparator(pos(3, 1, 1), 'subtract', 'west')
    h.placeOn(output, TRAPDOOR)
    h.settle()

    h.useBlock(lever)
    h.checkPoweredFor(output, false, 1)
    h.checkPoweredFor(output, true, 2)
    h.checkPoweredFor(output, false, 10)
  })

  it('pulse_gen_1t', () => {
    const h = new Harness()
    const output = pos(5, 1, 1)
    const lever = pos(0, 1, 1)

    h.makeWire(pos(1, 1, 0))
    h.makeRepeater(pos(2, 1, 0), 2, 'west')
    h.makeWire(pos(3, 1, 0))
    h.makeWire(pos(4, 1, 0))

    h.makeLever(lever)
    h.makeWire(pos(1, 1, 1))
    h.makeWire(pos(2, 1, 1))
    h.makeComparator(pos(3, 1, 1), 'subtract', 'west')
    h.placeOn(pos(4, 1, 1), 'stone')          // コンパレーター出力を通す固体
    h.placeOn(output, TRAPDOOR)
    h.settle()

    h.useBlock(lever)
    h.checkPoweredFor(output, false, 1)
    h.checkPoweredFor(output, true, 1)
    h.checkPoweredFor(output, false, 10)
  })
})
