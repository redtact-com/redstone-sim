// ============================================================
// compare.ts (実機キャプチャ vs sim) の回帰。
//
// 実機サーバは要らない。piston-basic の ground truth をキャプチャ形式へ
// 手写しした小さな合成キャプチャで、
//   - 一致すること
//   - 1 tick ずらすと「最初の」食い違い tick が出ること
//   - moving_piston 座標が比較から外れること
// を見る。
// ============================================================

import { describe, it, expect } from 'vitest'
import {
  captureToFixture, compareCapture, formatReport,
  type Capture,
} from './compare.js'

/**
 * piston-basic (packages/sim/test/fixtures/piston-basic.json) の実機 ground truth を
 * キャプチャ形式へ手写ししたもの。レバー → ピストンで石 1 個を押して引く。
 * moving_piston が 3,1,0 / 4,1,0 (伸長) と 2,1,0 (収縮) に出るので除外の検証に使える。
 */
const PISTON: Capture = {
  name: 'piston-basic-capture',
  source: 'piston-basic.litematic',
  mcVersion: '1.21.1',
  region: { from: [0, 0, 0], to: [5, 1, 1] },
  authored: {
    '0,0,0': 'stone', '1,0,0': 'stone', '2,0,0': 'stone',
    '3,0,0': 'stone', '4,0,0': 'stone', '5,0,0': 'stone',
    '0,0,1': 'stone', '1,0,1': 'stone',
    '0,1,0': 'lever[face=floor,facing=north,powered=false]',
    '1,1,0': 'redstone_wire[east=side,north=none,power=0,south=none,west=side]',
    '2,1,0': 'piston[extended=false,facing=east]',
    '3,1,0': 'stone',
  },
  inputs: [
    { tick: 2, pos: [0, 1, 0], action: 'use' },
    { tick: 10, pos: [0, 1, 0], action: 'use' },
  ],
  ticks: 16,
  frames: [
    { tick: 2, changes: [
      { pos: [0, 1, 0], block: 'lever[face=floor,facing=north,powered=true]' },
      { pos: [1, 1, 0], block: 'redstone_wire[east=side,north=none,power=15,south=none,west=side]' },
    ] },
    { tick: 3, changes: [
      { pos: [2, 1, 0], block: 'piston[extended=true,facing=east]' },
      { pos: [3, 1, 0], block: 'moving_piston[facing=east,type=normal]' },
      { pos: [4, 1, 0], block: 'moving_piston[facing=east,type=normal]' },
    ] },
    { tick: 5, changes: [
      { pos: [3, 1, 0], block: 'piston_head[facing=east,short=false,type=normal]' },
      { pos: [4, 1, 0], block: 'stone' },
    ] },
    { tick: 10, changes: [
      { pos: [0, 1, 0], block: 'lever[face=floor,facing=north,powered=false]' },
      { pos: [1, 1, 0], block: 'redstone_wire[east=side,north=none,power=0,south=none,west=side]' },
    ] },
    { tick: 11, changes: [
      { pos: [2, 1, 0], block: 'moving_piston[facing=east,type=normal]' },
      { pos: [3, 1, 0], block: 'air' },
    ] },
    { tick: 13, changes: [
      { pos: [2, 1, 0], block: 'piston[extended=false,facing=east]' },
    ] },
  ],
  players: [{ tick: 0, name: 'gt', pos: [0.5, 1.0, 1.5], onGround: true }],
  generated: { at: '2026-08-20T00:00:00.000Z', mc: '1.21.1', carpet: '1.21-1.4.147+v240613' },
}

/** 構造を壊さずに深いコピーを作る (各テストが独立にいじれるように) */
const clone = (c: Capture): Capture => JSON.parse(JSON.stringify(c)) as Capture

describe('captureToFixture', () => {
  it('authored / frames / inputs を Fixture へ写す', () => {
    const fx = captureToFixture(PISTON)
    expect(fx.name).toBe('piston-basic-capture')
    expect(fx.ticks).toBe(16)
    expect(fx.region).toEqual({ from: [0, 0, 0], to: [5, 1, 1] })
    // authored 12 件がそのまま blocks に写り、座標順に並ぶ
    expect(fx.blocks).toHaveLength(12)
    expect(fx.blocks[0]).toEqual({ pos: [0, 0, 0], block: 'stone' })
    expect(fx.blocks.find(b => b.pos.join(',') === '2,1,0')?.block)
      .toBe('piston[extended=false,facing=east]')
    // frames はそのまま expect に、inputs もそのまま
    expect(fx.expect).toEqual(PISTON.frames)
    expect(fx.inputs).toEqual(PISTON.inputs)
    expect(fx.generated).toEqual(PISTON.generated)
  })

  it('items をブロックの中身へ写す', () => {
    const cap: Capture = {
      name: 'hopper', mcVersion: '1.21.1',
      region: { from: [0, 0, 0], to: [1, 1, 1] },
      authored: { '1,1,0': 'hopper[enabled=true,facing=down]' },
      items: [{ pos: [1, 1, 0], slots: [{ slot: 0, id: 'cobblestone', count: 26 }] }],
      ticks: 1,
    }
    const fx = captureToFixture(cap)
    expect(fx.blocks[0].items).toEqual([{ slot: 0, id: 'cobblestone', count: 26 }])
    // 中身の無いブロックには items を付けない (旧形式の数値と混ざらないように)
    expect(captureToFixture(PISTON).blocks.every(b => b.items === undefined)).toBe(true)
  })

  it('items の座標に authored が無ければ警告する (黙って捨てない)', () => {
    const cap = clone(PISTON)
    cap.items = [{ pos: [5, 1, 1], slots: [{ slot: 0, id: 'cobblestone', count: 1 }] }]
    const r = compareCapture(cap)
    expect(r.warnings.join('\n')).toContain('5,1,1')
  })

  it('コンパレーターの保持出力は trustAuthored のときだけ持ち込む (#249)', () => {
    // **blockstate に出ない値**なので、これを落とすと sim は「今の入力から計算し直す」
    // しかなくなり、周回しながら減衰する機械が止まる。
    // 静的モード (実機の状態を組み直せるかを見る側) では逆に持ち込んではいけない
    const cap = clone(PISTON)
    cap.comparators = [{ pos: [1, 1, 0], output: 7 }]
    expect(captureToFixture(cap, true).comparators).toEqual([{ pos: [1, 1, 0], output: 7 }])
    expect(captureToFixture(cap, false).comparators).toBeUndefined()
    // 実機に 1 つも無ければ空配列 (undefined と取り違えない)
    expect(captureToFixture(clone(PISTON), true).comparators).toEqual([])
  })

  it('座標キーが壊れていたら投げる', () => {
    const cap = clone(PISTON)
    cap.authored = { '0,1': 'stone' }
    expect(() => captureToFixture(cap)).toThrow(/座標キーが不正/)
  })
})

describe('compareCapture — 一致', () => {
  it('実機 ground truth 由来のキャプチャは sim と一致する', () => {
    const r = compareCapture(PISTON)
    expect(r.first).toBeNull()
    expect(r.ok).toBe(true)
    expect(r.divergentTickCount).toBe(0)
    expect(r.totalDiffs).toBe(0)
    expect(r.warnings).toEqual([])
    // region 6*2*2 = 24 座標から moving_piston の 3 座標を引いて比較している
    expect(r.regionPositions).toBe(24)
    expect(r.comparedPositions).toBe(24 - r.excluded.count)
  })
})

describe('compareCapture — 最初の食い違い', () => {
  /** frames を丸ごと 1 tick 後ろへずらす (実機の記録が 1 tick 遅れた状況) */
  function shifted(): Capture {
    const cap = clone(PISTON)
    cap.frames = (cap.frames ?? []).map(f => ({ ...f, tick: f.tick + 1 }))
    return cap
  }

  it('1 tick ずらすと最初の食い違い tick が出る', () => {
    const r = compareCapture(shifted())
    expect(r.ok).toBe(false)
    // レバーを引くのは tick 2。ずらした実機側は tick 2 でまだ OFF なのでそこが最初
    expect(r.first?.tick).toBe(2)
    expect(r.first?.tick).toBe(Math.min(...r.divergentTicks))
    // 「最後」ではないこと。ずれは後続 tick にも波及している
    expect(r.divergentTickCount).toBeGreaterThan(1)
    expect(Math.max(...r.divergentTicks)).toBeGreaterThan(2)
  })

  it('食い違った座標の実機・sim の値を両方出す', () => {
    const r = compareCapture(shifted())
    const lever = r.first?.positions.find(p => p.pos === '0,1,0')
    expect(lever?.mc).toBe('lever[face=floor,facing=north,powered=false]')
    expect(lever?.sim).toBe('lever[face=floor,facing=north,powered=true]')
  })

  it('周囲 6 方向を実機・sim 両方で添える', () => {
    const r = compareCapture(shifted())
    const lever = r.first?.positions.find(p => p.pos === '0,1,0')
    expect(lever?.neighbors.map(n => n.dir).sort())
      .toEqual(['down', 'east', 'north', 'south', 'up', 'west'])
    const down = lever?.neighbors.find(n => n.dir === 'down')
    expect(down).toMatchObject({ pos: '0,0,0', mc: 'stone', sim: 'stone' })
    // east は dust。実機はまだ power=0、sim はもう 15 になっている
    const east = lever?.neighbors.find(n => n.dir === 'east')
    expect(east?.mc).toContain('power=0')
    expect(east?.sim).toContain('power=15')
    // region 外の隣は「実機の観測が無いだけ」と分かるよう印を付ける
    expect(lever?.neighbors.find(n => n.dir === 'north')?.outside).toBe(true)
    expect(lever?.neighbors.find(n => n.dir === 'south')?.outside).toBeUndefined()
  })

  it('レポートは JSON 直列化でき、表示にも最初の tick が出る', () => {
    const r = compareCapture(shifted())
    expect(JSON.parse(JSON.stringify(r)).first.tick).toBe(2)
    expect(formatReport(r)).toContain('最初の食い違い: tick 2')
  })
})

describe('compareCapture — moving_piston の除外', () => {
  it('一致するキャプチャでは除外も差分も出ない', () => {
    const r = compareCapture(PISTON)
    expect(r.ok).toBe(true)
    expect(r.excluded.suppressedDiffs).toBe(0)
    expect(r.excluded.reason).toContain('moving_piston')
  })

  it('moving_piston になっている tick の食い違いだけを捨てる', () => {
    const cap = clone(PISTON)
    // 3,1,0 が moving_piston になる tick の値をわざと壊す → 捨てられる
    const moving = (cap.frames ?? []).find(f =>
      f.changes.some(c => c.pos.join(',') === '3,1,0' && c.block.startsWith('moving_piston')))
    expect(moving, '前提: moving_piston になる frame がある').toBeDefined()
    moving!.changes = moving!.changes.map(c =>
      c.pos.join(',') === '3,1,0' ? { ...c, block: 'moving_piston[facing=west,type=normal]' } : c)

    const r = compareCapture(cap)
    expect(r.excluded.suppressedDiffs).toBeGreaterThan(0)
  })

  it('名前空間つき (minecraft:moving_piston) も初期状態にあれば同じく弾く', () => {
    // 実機ダンプ由来の authored は minecraft: が付き得る。
    // 付いていても isMovingPiston が拾えていないと、mcToSim の
    // 「復元不能」例外がそのままスタックトレースで出て原因が分からなくなる
    const cap = clone(PISTON)
    cap.authored['4,1,0'] = 'minecraft:moving_piston[facing=east,type=normal]'
    expect(() => compareCapture(cap)).toThrow(/初期状態に moving_piston/)
  })

  it('コンテナ入力 (action=container) は指定した強度になる', () => {
    // 'use' に落ちると **+1 段** (#236 の手動トリガ) になってしまい、
    // 指定した 5 ではなく 1 が出る。実機と食い違う
    const cap: Capture = {
      name: 'container-input', mcVersion: '1.21.1',
      region: { from: [0, 0, 0], to: [2, 1, 0] },
      authored: {
        '0,0,0': 'stone', '1,0,0': 'stone', '2,0,0': 'stone',
        '0,1,0': 'barrel[facing=north,open=false]',
        '1,1,0': 'comparator[facing=west,mode=compare,powered=false]',
        '2,1,0': 'redstone_wire[east=none,north=none,power=0,south=none,west=side]',
      },
      inputs: [{ tick: 2, pos: [0, 1, 0], action: 'container', signal: 5 }],
      ticks: 8,
      // コンパレーターは 2gt 後に出力し、コンパレーター → ダストは減衰しない
      frames: [{
        tick: 4,
        changes: [
          { pos: [1, 1, 0], block: 'comparator[facing=west,mode=compare,powered=true]' },
          { pos: [2, 1, 0], block: 'redstone_wire[east=none,north=none,power=5,south=none,west=side]' },
        ],
      }],
      players: [],
      generated: { at: '', mc: '1.21.1', carpet: '' },
    }
    const r = compareCapture(cap)
    expect(r.ok, JSON.stringify(r.first)).toBe(true)
  })

  it('**ピストンが実機で動かなかったキャプチャは不一致として出る** (座標ごと捨てない)', () => {
    // 検証で見つかった偽陰性。座標単位で全 tick 除外すると、
    // 「実機ではピストンが一切動かなかったのに sim では動いた」が消えてしまう
    const cap = clone(PISTON)
    cap.frames = (cap.frames ?? []).filter(f =>
      !f.changes.some(c => ['2,1,0', '3,1,0', '4,1,0'].includes(c.pos.join(','))))

    const r = compareCapture(cap)
    expect(r.ok, 'ピストンが動かない実機記録なのに一致になっている').toBe(false)
    expect(r.first).not.toBeNull()
  })

  it('除外されていない座標を壊せばちゃんと落ちる (上のテストが空振りでない証拠)', () => {
    const cap = clone(PISTON)
    const f2 = (cap.frames ?? []).find(f => f.tick === 2)!
    f2.changes = f2.changes.map(c =>
      c.pos.join(',') === '1,1,0'
        ? { ...c, block: 'redstone_wire[east=side,north=none,power=9,south=none,west=side]' }
        : c)

    const r = compareCapture(cap)
    expect(r.ok).toBe(false)
    expect(r.first?.tick).toBe(2)
    expect(r.first?.positions.map(p => p.pos)).toContain('1,1,0')
  })

  it('キャプチャが過渡状態を撮り損ねても sim 側の moving_piston で除外する', () => {
    // 実機の dump が伸縮の 2gt を跨いでしまい moving_piston を記録できなかった状況。
    // 実機側の記録には moving_piston が 1 つも無いが、sim は出すので除外は要る。
    const cap = clone(PISTON)
    cap.frames = (cap.frames ?? []).map(f => ({
      ...f,
      changes: f.changes.filter(c => !c.block.startsWith('moving_piston')),
    }))
    expect(JSON.stringify(cap.frames)).not.toContain('moving_piston')

    const r = compareCapture(cap)
    expect(r.excluded.positions).toEqual(['2,1,0', '3,1,0', '4,1,0'])
    expect(r.ok).toBe(true)
    expect(r.excluded.suppressedDiffs).toBeGreaterThan(0)
  })

  it('**初期状態の moving_piston は黙って除外せずエラーにする** (#248)', () => {
    // 以前はここで world 構築から外し「どのみち比較不能座標なので影響しない」と
    // していたが、**影響する**。外された座標が導体なら給電経路がまるごと消え、
    // 食い違いは**その座標ではなく下流**に出る。
    // 実機のエレベーターではコンパレーターが 5 ブロック先で食い違い、
    // tick 内の順序の問題だと 1 周誤診した。座標が分からないと直せないので
    // メッセージに載せる
    const cap = clone(PISTON)
    cap.authored['4,1,0'] = 'moving_piston[facing=east,type=normal]'
    expect(() => compareCapture(cap)).toThrow(/4,1,0/)
  })

  it('初期状態に moving_piston が無ければ従来どおり比較できる', () => {
    // 上の 2 件が「常に throw する」だけの空振りでない証拠
    expect(() => compareCapture(clone(PISTON))).not.toThrow()
  })
})

describe('divergentPositions は全 tick・全座標を拾う (#240)', () => {
  // 最小化の署名判定はこれを見る。`first` は先頭 tick の先頭 8 件しか載らないので、
  // ここが切り詰められると**署名を取り落として本命を削り落とす**
  it('9 座標以上・2 tick 以上ズレても全部載る', () => {
    const authored: Record<string, string> = {}
    for (let x = 0; x < 12; x++) {
      authored[`${x},0,0`] = 'stone'
      authored[`${x},1,0`] = 'redstone_lamp[lit=false]'
    }
    // 実機側だけ「tick 1 で 6 個、tick 2 でさらに 6 個点いた」ことにする
    const frames = [
      { tick: 1, changes: Array.from({ length: 6 }, (_, i) => ({ pos: [i, 1, 0] as [number, number, number], block: 'redstone_lamp[lit=true]' })) },
      { tick: 2, changes: Array.from({ length: 6 }, (_, i) => ({ pos: [i + 6, 1, 0] as [number, number, number], block: 'redstone_lamp[lit=true]' })) },
    ]
    const cap: Capture = {
      name: 'many', mcVersion: '1.21.1',
      region: { from: [0, 0, 0], to: [11, 1, 0] },
      authored, inputs: [], ticks: 4, frames, players: [],
      generated: { at: '', mc: '1.21.1', carpet: '' },
    }
    const r = compareCapture(cap)
    expect(r.ok).toBe(false)
    expect(r.divergentPositions).toHaveLength(12)
    // 先頭 tick に載らない座標 (tick 2 側) も拾えていること
    expect(r.divergentPositions).toContain('11,1,0')
    expect(r.first!.positions.length).toBeLessThan(12)   // first は切り詰められる
  })
})

describe('書見台の本がキャプチャから sim へ渡る (#239)', () => {
  // ページ数と現在ページは blockstate に出ない。載せ忘れると出力が 14 に張り付き、
  // 階数指定が丸ごと効かなくなる (エレベーターが動かなかった原因そのもの)。
  // 15 ページ本の Page=4 → 出力 5 [実機で確認: 信号 = ページ + 1]
  const base = (lecterns?: Capture['lecterns']): Capture => ({
    name: 'lectern', mcVersion: '1.21.1',
    region: { from: [0, 0, 0], to: [2, 1, 0] },
    authored: {
      '0,0,0': 'stone', '1,0,0': 'stone', '2,0,0': 'stone',
      '0,1,0': 'lectern[facing=east,has_book=true,powered=false]',
      '1,1,0': 'comparator[facing=west,mode=compare,powered=true]',
      '2,1,0': 'redstone_wire[east=none,north=none,power=5,south=none,west=side]',
    },
    ...(lecterns ? { lecterns } : {}),
    inputs: [], ticks: 6,
    frames: [],           // 実機は落ち着いていて何も変わらない
    players: [],
    generated: { at: '', mc: '1.21.1', carpet: '' },
  })

  it('本を載せると実機と一致する', () => {
    const r = compareCapture(base([{ pos: [0, 1, 0], page: 4, pages: 15 }]))
    expect(r.ok, JSON.stringify(r.first)).toBe(true)
  })

  it('**本を載せないと食い違う** (出力 14 に張り付く)', () => {
    const r = compareCapture(base())
    expect(r.ok, '本が無いのに一致してしまっている').toBe(false)
  })
})
