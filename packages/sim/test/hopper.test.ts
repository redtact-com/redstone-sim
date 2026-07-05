// ============================================================
// ホッパー・ドロッパー物流 (C6' #65) の単体テスト。
//
// アイテムは「コンテナ内の数値 count」として動く (エンティティ境界原則 13 §2)。
// count は blockstate に現れない BE 内容なので、ここでは world.getBlockAt で
// 直接検証する (実機 fixture は blockstate = コンパレーター powered / hopper enabled
// で観測。tools/mc-harness/fixtures/ の hopper-* を後段で親が生成)。
//
// 定数 [確定: 26.2]: ホッパー転送クールダウン 8gt / ドロッパー発火遅延 4gt /
// eject(送り込み)→suck(吸い出し) の順 / 1 回 1 個 / NC 受電で enabled=false ロック。
// ============================================================

import { describe, it, expect } from 'vitest'
import { SimWorld } from '../src/world.js'
import { fillSignal, containerCapacity } from '../src/blocks/container.js'
import type {
  HopperState, DropperState, ComparatorState, LeverState,
} from '../src/types.js'

function hopper(facing: HopperState['facing'], count: number): HopperState {
  return { type: 'hopper', facing, count, enabled: true }
}
function dropper(facing: DropperState['facing'], count: number): DropperState {
  return { type: 'dropper', facing, count, triggered: false }
}
function getHopper(w: SimWorld, x: number, y: number, z: number): HopperState {
  const b = w.getBlock(x, y, z)
  expect(b?.type).toBe('hopper')
  return b as HopperState
}

describe('container.fillSignal (充填率→信号 02 §6)', () => {
  it('空=0 / 満杯=15 / 非空は最低 1', () => {
    expect(fillSignal(0, 320)).toBe(0)
    expect(fillSignal(320, 320)).toBe(15)
    expect(fillSignal(1, 320)).toBe(1)
  })
  it('lerpDiscrete = floor(f*14)+1', () => {
    // 64 個 / 容量 320 → f=0.2 → floor(2.8)+1 = 3
    expect(fillSignal(64, 320)).toBe(3)
    // 半分 (160/320) → f=0.5 → floor(7)+1 = 8
    expect(fillSignal(160, 320)).toBe(8)
    // ドロッパー容量 576 の満杯
    expect(fillSignal(576, 576)).toBe(15)
  })
  it('容量ヘルパ', () => {
    expect(containerCapacity('hopper')).toBe(320)
    expect(containerCapacity('dropper')).toBe(576)
    expect(containerCapacity('container')).toBe(1728)
  })
})

describe('ホッパー転送 (eject/クールダウン 8gt)', () => {
  it('facing 先ホッパーへ送り込む (#89 -1 補正で受信側は実効 7gt)', () => {
    const w = new SimWorld()
    // A(上) が下の B へ送り込む。B は south 向き (行き先なし)。B は上の A も suck する。
    w.setBlockAt([0, 1, 0], hopper('down', 10))
    w.setBlockAt([0, 0, 0], hopper('south', 0))
    w.initialize()

    // tick1: A→B 1 個 (eject)。B は受信で cooldown 実効 7gt (#89 vanilla -1 補正)
    w.tick()
    expect(getHopper(w, 0, 1, 0).count).toBe(9)
    expect(getHopper(w, 0, 0, 0).count).toBe(1)

    // tick8: B の 7gt cooldown 明け → B が A を suck (A=8, B=2)
    for (let t = 2; t <= 8; t++) w.tick()
    expect(getHopper(w, 0, 1, 0).count).toBe(8)
    expect(getHopper(w, 0, 0, 0).count).toBe(2)

    // tick9: A の 8gt cooldown 明け → A→B eject (A=7, B=3)
    w.tick()
    expect(getHopper(w, 0, 1, 0).count).toBe(7)
    expect(getHopper(w, 0, 0, 0).count).toBe(3)
    // 注: 縦ペアの eject+suck 二重経路の厳密な実機一致は別途 #91 で追跡 (本テストは sim 挙動 pin)
  })

  it('空ホッパーは送り込まない / 満杯は受け取らない', () => {
    const w = new SimWorld()
    w.setBlockAt([0, 1, 0], hopper('down', 0))           // 空
    w.setBlockAt([0, 0, 0], hopper('south', containerCapacity('hopper'))) // 満杯
    w.initialize()
    for (let t = 0; t < 20; t++) w.tick()
    expect(getHopper(w, 0, 1, 0).count).toBe(0)
    expect(getHopper(w, 0, 0, 0).count).toBe(containerCapacity('hopper'))
  })
})

describe('ホッパー ロック (NC 受電で enabled=false)', () => {
  it('受電中は転送しない。解除で再開する', () => {
    const w = new SimWorld()
    // 横方向の送り込み A(east)→B にして、B が A を吸い出せない配置にする
    // (縦だと下段が上段ロックと無関係に吸い出してしまうため)
    w.setBlockAt([0, 0, 0], hopper('east', 10))
    w.setBlockAt([1, 0, 0], hopper('south', 0))
    // A の直上にレバー (ON) → A を受電 → enabled=false
    const lever: LeverState = { type: 'lever', facing: 'up', powered: true }
    w.setBlockAt([0, 1, 0], lever)
    w.initialize()
    expect(getHopper(w, 0, 0, 0).enabled).toBe(false)

    // ロック中は何 tick 進めても転送しない
    for (let t = 0; t < 20; t++) w.tick()
    expect(getHopper(w, 0, 0, 0).count).toBe(10)
    expect(getHopper(w, 1, 0, 0).count).toBe(0)

    // レバー OFF → enabled=true → 次 tick で転送再開
    w.activateBlock(0, 1, 0)
    expect(getHopper(w, 0, 0, 0).enabled).toBe(true)
    w.tick()
    expect(getHopper(w, 0, 0, 0).count).toBe(9)
    expect(getHopper(w, 1, 0, 0).count).toBe(1)
  })
})

describe('ホッパー チェーン (吸い出し + 送り込み)', () => {
  it('3 段縦チェーンで最下段へ流下する', () => {
    const w = new SimWorld()
    w.setBlockAt([0, 2, 0], hopper('down', 3))   // X 上
    w.setBlockAt([0, 1, 0], hopper('down', 0))   // Y 中
    w.setBlockAt([0, 0, 0], hopper('south', 0))  // Z 下 (受け皿)
    w.initialize()

    // 上から順に処理 (y 降順) するため、先頭アイテムは 1 tick で X→Y→Z へ流れる。
    // ※ 実機は Y がバッファし素通りしない (BE tick 順の乖離)。厳密な実機一致は #91 で追跡。
    w.tick()
    expect(getHopper(w, 0, 0, 0).count).toBe(1)  // Z が受領
    expect(getHopper(w, 0, 2, 0).count).toBe(2)  // X から 1 個減

    // 次の 1 個 (#89 -1 補正で受信側 7gt。X は 8gt eject + Y の suck で 2 個目が流下)
    for (let t = 2; t <= 9; t++) w.tick()
    expect(getHopper(w, 0, 0, 0).count).toBe(2)
    expect(getHopper(w, 0, 2, 0).count).toBe(0)
  })
})

describe('コンパレーターがホッパー充填率を読む (CU 連動)', () => {
  it('背面ホッパーの count に応じた信号を出す', () => {
    const w = new SimWorld()
    // H は inert (south 向き・上なし) で内容 160 (=信号 8)
    w.setBlockAt([0, 0, 0], hopper('south', 160))
    // コンパレーター (facing=east 出力) の背面 west = H
    const comp: ComparatorState = {
      type: 'comparator', facing: 'east', mode: 'compare', powered: false, outputPower: 0,
    }
    w.setBlockAt([1, 0, 0], comp)
    w.initialize()
    w.flush(64)
    const c = w.getBlock(1, 0, 0) as ComparatorState
    expect(c.outputPower).toBe(fillSignal(160, 320))  // 8
    expect(c.powered).toBe(true)
  })

  it('転送で充填率が変わるとコンパレーター出力が追従する', () => {
    const w = new SimWorld()
    // A(上,down,10) → B(下). B の背面にコンパレーターを置き B の充填を読む
    w.setBlockAt([0, 1, 0], hopper('down', 10))
    w.setBlockAt([0, 0, 0], hopper('south', 0))
    const comp: ComparatorState = {
      type: 'comparator', facing: 'east', mode: 'compare', powered: false, outputPower: 0,
    }
    // B は [0,0,0]。コンパレーター背面 (west) が B になるよう east 出力で [1,0,0] に置く
    w.setBlockAt([1, 0, 0], comp)
    w.initialize()
    w.flush(8)
    // B は空 → コンパレーター 0 (powered=false)
    expect((w.getBlock(1, 0, 0) as ComparatorState).powered).toBe(false)

    // 1 個転送 → B=1 → 信号 1 → 2gt 後にコンパレーター powered=true
    w.tick()  // BlockEntity フェーズで転送 + CU
    expect(getHopper(w, 0, 0, 0).count).toBe(1)
    w.tick(); w.tick()  // コンパレーターの 2gt tile tick を消化
    const c = w.getBlock(1, 0, 0) as ComparatorState
    expect(c.outputPower).toBe(1)
    expect(c.powered).toBe(true)
  })
})

describe('ドロッパー (前方コンテナへ挿入 / 4gt / QC エッジ)', () => {
  it('受電の立ち上がりで 4gt 後に前方ホッパーへ 1 個挿入する', () => {
    const w = new SimWorld()
    w.setBlockAt([0, 0, 0], dropper('east', 5))    // 前方 east = [1,0,0]
    w.setBlockAt([1, 0, 0], hopper('south', 0))    // 受け皿
    // ドロッパー直上のレバーで受電 (OFF から始める)
    const lever: LeverState = { type: 'lever', facing: 'up', powered: false }
    w.setBlockAt([0, 1, 0], lever)
    w.initialize()
    expect((w.getBlock(0, 0, 0) as DropperState).triggered).toBe(false)

    // レバー ON → triggered + 4gt tick 予約
    w.activateBlock(0, 1, 0)
    expect((w.getBlock(0, 0, 0) as DropperState).triggered).toBe(true)

    // 4gt 後の tick で dispenseFrom
    w.tick(); w.tick(); w.tick()
    expect((w.getBlock(0, 0, 0) as DropperState).count).toBe(5)  // まだ
    w.tick()  // 4 回目 = 発火
    expect((w.getBlock(0, 0, 0) as DropperState).count).toBe(4)
    expect(getHopper(w, 1, 0, 0).count).toBe(1)

    // 受電継続中は再発火しない (エッジトリガ)
    for (let t = 0; t < 10; t++) w.tick()
    expect((w.getBlock(0, 0, 0) as DropperState).count).toBe(4)
  })

  it('前方が非コンテナなら 1 個消費して何も出さない (境界原則 13 §4.2)', () => {
    const w = new SimWorld()
    w.setBlockAt([0, 0, 0], dropper('east', 3))    // 前方 east = 空気
    const lever: LeverState = { type: 'lever', facing: 'up', powered: false }
    w.setBlockAt([0, 1, 0], lever)
    w.initialize()
    w.activateBlock(0, 1, 0)
    for (let t = 0; t < 5; t++) w.tick()
    expect((w.getBlock(0, 0, 0) as DropperState).count).toBe(2)  // 1 個消費
    expect(w.getBlock(1, 0, 0)).toBe(null)                        // 何も出ない
  })
})
