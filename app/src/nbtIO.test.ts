import { describe, it, expect } from 'vitest'
import {
  NbtFile, NbtCompound, NbtList, NbtInt, NbtString,
} from 'deepslate/nbt'
import type { BlockState } from '@redstone/sim'
import { mcToSim, slotsFromCount } from '@redstone/sim'
import { blockStateToMinecraftStr } from '@redstone/viewer'
import { exportToNbtBytes, importFromNbtBytes } from './nbtIO'

// ============================================================
// nbtIO: ボタン専用型の往復 (#54)
//
// 従来 *_button は import でレバー近似していたが、sim に button_stone /
// button_wood が実装されたため専用型で往復する。export は面 = floor 固定
// (stone_button / oak_button)、import は面情報を捨てて facing='up' に正規化。
// ============================================================

const GRID = 16

/** 単一ブロックを export → import して往復後の BlockState を得る */
async function roundTrip(block: BlockState): Promise<BlockState | undefined> {
  const src = new Map<string, BlockState>([['0,0,0', block]])
  const bytes = exportToNbtBytes(src, GRID, GRID)
  return (await importFromNbtBytes(bytes, { maxLayers: 8 })).blocks.get('0,0,0')
}

/** 任意の vanilla ブロック名 + props を持つ最小構造 NBT を組み立てて import する */
async function importVanilla(name: string, props: Record<string, string> = {}): Promise<BlockState | undefined> {
  const air = new NbtCompound().set('Name', new NbtString('minecraft:air'))
  const target = new NbtCompound().set('Name', new NbtString(name))
  if (Object.keys(props).length > 0) {
    const p = new NbtCompound()
    for (const [k, v] of Object.entries(props)) p.set(k, new NbtString(v))
    target.set('Properties', p)
  }
  const palette = new NbtList<NbtCompound>([air, target])
  const blockEntry = new NbtCompound()
    .set('state', new NbtInt(1))
    .set('pos', new NbtList<NbtInt>([new NbtInt(0), new NbtInt(0), new NbtInt(0)]))
  const root = new NbtCompound()
    .set('size', new NbtList<NbtInt>([new NbtInt(1), new NbtInt(1), new NbtInt(1)]))
    .set('palette', palette)
    .set('blocks', new NbtList<NbtCompound>([blockEntry]))
    .set('entities', new NbtList<NbtCompound>([]))
  const bytes = new NbtFile('', root, 'gzip', false, undefined).write()
  return (await importFromNbtBytes(bytes, { maxLayers: 8 })).blocks.get('0,0,0')
}

/**
 * palette[1] のブロックを pos 群に配置した構造 NBT を組み立てる。
 * size は内容を収める最小値を自動計算する (deepslate は size 外の pos を弾くため)。
 */
function buildStructure(name: string, positions: Array<[number, number, number]>): Uint8Array {
  const air = new NbtCompound().set('Name', new NbtString('minecraft:air'))
  const target = new NbtCompound().set('Name', new NbtString(name))
  const palette = new NbtList<NbtCompound>([air, target])
  const blocks = new NbtList<NbtCompound>(
    positions.map(([x, y, z]) =>
      new NbtCompound()
        .set('state', new NbtInt(1))
        .set('pos', new NbtList<NbtInt>([new NbtInt(x), new NbtInt(y), new NbtInt(z)]))
    )
  )
  const sx = Math.max(1, ...positions.map((p) => p[0] + 1))
  const sy = Math.max(1, ...positions.map((p) => p[1] + 1))
  const sz = Math.max(1, ...positions.map((p) => p[2] + 1))
  const root = new NbtCompound()
    .set('size', new NbtList<NbtInt>([new NbtInt(sx), new NbtInt(sy), new NbtInt(sz)]))
    .set('palette', palette)
    .set('blocks', blocks)
    .set('entities', new NbtList<NbtCompound>([]))
  return new NbtFile('', root, 'gzip', false, undefined).write()
}

describe('nbtIO: ボタン専用型の往復', () => {
  it('button_stone は往復しても button_stone (レバーにならない)', async () => {
    expect(await roundTrip({ type: 'button_stone', facing: 'up', powered: false }))
      .toMatchObject({ type: 'button_stone', facing: 'up', powered: false })
  })

  it('button_wood は往復しても button_wood', async () => {
    expect(await roundTrip({ type: 'button_wood', facing: 'up', powered: false }))
      .toMatchObject({ type: 'button_wood', facing: 'up', powered: false })
  })
})

describe('nbtIO: vanilla ボタン名 → 専用型 import', () => {
  it('stone_button / polished_blackstone_button は button_stone', async () => {
    expect(await importVanilla('minecraft:stone_button', { face: 'floor', facing: 'south', powered: 'false' }))
      .toMatchObject({ type: 'button_stone', facing: 'up', powered: false })
    expect(await importVanilla('minecraft:polished_blackstone_button'))
      .toMatchObject({ type: 'button_stone', facing: 'up' })
  })

  it('oak_button / bamboo_button など木材系は button_wood', async () => {
    expect(await importVanilla('minecraft:oak_button')).toMatchObject({ type: 'button_wood', facing: 'up' })
    expect(await importVanilla('minecraft:bamboo_button')).toMatchObject({ type: 'button_wood', facing: 'up' })
  })
})

describe('nbtIO: コンテナ / 重量板の既存往復が壊れていない', () => {
  it('container は barrel として export → container(signal=0) で import', async () => {
    // signal は NBT に現れないため 0 で戻る
    expect(await roundTrip({ type: 'container', signal: 5 }))
      .toMatchObject({ type: 'container', signal: 0 })
  })

  it('重量板(金)は往復後も専用型で powered=false に正規化される', async () => {
    // pressedPower は現状 import 時に既定 15 へ戻る (entity 由来のため OFF 正規化)。
    // ここではボタン変更でこの既存挙動が壊れていないことを確認する。
    expect(await roundTrip({ type: 'weighted_pressure_plate_light', pressedPower: 6, powered: true }))
      .toMatchObject({ type: 'weighted_pressure_plate_light', powered: false })
  })
})

describe('nbtIO: ホッパー / ドロッパーの往復 (#65)', () => {
  // #194 で中身も往復するようになった (以前は count が 0 に戻っていた)。
  // 中身を落とすとコンパレーター強度の微調整が失われるため
  it('hopper は facing/enabled と**中身**を保持して往復する (#194)', async () => {
    const src = {
      type: 'hopper', facing: 'east', enabled: true,
      slots: slotsFromCount('hopper', 12),
    } as BlockState
    const back = await roundTrip(src) as { slots: readonly ({ count: number } | null)[] }
    expect(back).toMatchObject({ type: 'hopper', facing: 'east', enabled: true })
    expect(back.slots.reduce((a, s) => a + (s?.count ?? 0), 0)).toBe(12)
  })

  it('dropper も中身を保持して往復する (#194)', async () => {
    const src = {
      type: 'dropper', facing: 'up', triggered: false,
      slots: slotsFromCount('dropper', 5),
    } as BlockState
    const back = await roundTrip(src) as { slots: readonly ({ count: number } | null)[] }
    expect(back).toMatchObject({ type: 'dropper', facing: 'up', triggered: false })
    expect(back.slots.reduce((a, s) => a + (s?.count ?? 0), 0)).toBe(5)
  })

  it('vanilla hopper[facing=down] → hopper 型 import', async () => {
    expect(await importVanilla('minecraft:hopper', { enabled: 'true', facing: 'down' }))
      .toMatchObject({ type: 'hopper', facing: 'down', enabled: true })
  })

  it('vanilla dropper[facing=north,triggered=false] → dropper 型 import', async () => {
    expect(await importVanilla('minecraft:dropper', { facing: 'north', triggered: 'false' }))
      .toMatchObject({ type: 'dropper', facing: 'north', triggered: false })
  })
})

describe('nbtIO: bounds 検証と warnings 集約 (#97)', () => {
  it('盤面範囲外 (x/z) のブロックは省略され警告を返す', async () => {
    // 16×16 グリッド外 (x=16, z=16) を含む 17×1×17 構造
    const bytes = buildStructure('minecraft:redstone_lamp', [
      [0, 0, 0], [15, 0, 15], [16, 0, 0], [0, 0, 16],
    ])
    const { blocks, warnings, size } = await importFromNbtBytes(bytes, { gridW: 16, gridH: 16, maxLayers: 8 })
    expect(blocks.size).toBe(2) // (0,0,0) と (15,0,15) のみ
    expect(warnings.some((w) => w.includes('盤面範囲外') && w.includes('2'))).toBe(true)
    expect(size).toEqual([16, 1, 16]) // 取り込めた分の bounding box
  })

  it('高さ上限超過 (Y≥maxLayers) は省略され警告を返す', async () => {
    const bytes = buildStructure('minecraft:redstone_lamp', [[0, 0, 0], [0, 8, 0], [0, 20, 0]])
    const { blocks, warnings } = await importFromNbtBytes(bytes, { gridW: 16, gridH: 16, maxLayers: 8 })
    expect(blocks.size).toBe(1)
    expect(warnings.some((w) => w.includes('高さ上限') && w.includes('2'))).toBe(true)
  })

  it('非対応ブロックは種類ごとに集約して 1 警告にまとめる', async () => {
    const bytes = buildStructure('minecraft:tnt', [[0, 0, 0], [1, 0, 0], [2, 0, 0]])
    const { blocks, warnings } = await importFromNbtBytes(bytes, { gridW: 16, gridH: 16, maxLayers: 8 })
    expect(blocks.size).toBe(0)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('未対応ブロック 3 個')
    expect(warnings[0]).toContain('tnt')
  })

  it('全て範囲外/非対応なら blocks は空・size は [0,0,0]', async () => {
    const bytes = buildStructure('minecraft:tnt', [[0, 0, 0]])
    const { blocks, size } = await importFromNbtBytes(bytes, { gridW: 16, gridH: 16, maxLayers: 8 })
    expect(blocks.size).toBe(0)
    expect(size).toEqual([0, 0, 0])
  })

  it('air 亜種 (cave_air / void_air) は空セル扱いで無警告', async () => {
    for (const air of ['minecraft:cave_air', 'minecraft:void_air']) {
      const bytes = buildStructure(air, [[0, 0, 0]])
      const { blocks, warnings } = await importFromNbtBytes(bytes, { gridW: 16, gridH: 16, maxLayers: 8 })
      expect(blocks.size).toBe(0)
      expect(warnings).toHaveLength(0) // 未対応ブロック警告を出さない
    }
  })
})

describe('nbtIO: レバー/ボタンの取付面 (#111)', () => {
  // sim の facing = レバーが向く方向。vanilla の face(floor|wall|ceiling)+facing と 1:1
  const dirs = ['up', 'down', 'north', 'south', 'east', 'west'] as const

  it.each(dirs)('レバーの facing=%s が往復で保たれる', async dir => {
    expect(await roundTrip({ type: 'lever', facing: dir, powered: false } as BlockState))
      .toMatchObject({ type: 'lever', facing: dir })
  })

  it.each(dirs)('石ボタンの facing=%s が往復で保たれる', async dir => {
    expect(await roundTrip({ type: 'button_stone', facing: dir, powered: false } as BlockState))
      .toMatchObject({ type: 'button_stone', facing: dir })
  })

  it('vanilla の壁レバーを取付面つきで読み込む', async () => {
    expect(await importVanilla('minecraft:lever', { face: 'wall', facing: 'east', powered: 'true' }))
      .toMatchObject({ type: 'lever', facing: 'east', powered: true })
  })

  it('vanilla の天井レバー → facing=down', async () => {
    expect(await importVanilla('minecraft:lever', { face: 'ceiling', facing: 'north', powered: 'false' }))
      .toMatchObject({ type: 'lever', facing: 'down' })
  })

  it('vanilla の壁ボタン → 取付面つき (押下状態は momentary なので常に OFF)', async () => {
    expect(await importVanilla('minecraft:oak_button', { face: 'wall', facing: 'west', powered: 'true' }))
      .toMatchObject({ type: 'button_wood', facing: 'west', powered: false })
  })

  it('face が無い古い保存データは床置き扱い', async () => {
    expect(await importVanilla('minecraft:lever', { powered: 'false' })).toMatchObject({ facing: 'up' })
  })

  it('face=wall で facing が壊れていても水平へ落とす (up にはしない)', async () => {
    expect(await importVanilla('minecraft:lever', { face: 'wall', facing: 'diagonal' }))
      .toMatchObject({ type: 'lever', facing: 'north' })
  })
})

// ============================================================
// 固体ブロック (redstone conductor) の取り込み (#170)
//
// 実在の回路 (Runa.S_1wide.nbt) で 73 ブロックが落ちていた。固定リスト方式で
// 羊毛 16 色・smooth_quartz などが漏れており、**導体が消える = 回路の導通が
// 変わる**ため実害があった。素材の違いはレッドストーン挙動に影響しないので
// 全部 solid 1 種に集約する。
//
// 一方**フルブロックでも非導体**のもの (ガラス系) は solid にすると誤って
// 導通するので、sim に型ができるまでは拾わない。ここでその線引きを固定する。
// ============================================================

describe('固体ブロックの取り込み (#170)', () => {
  const solid = { type: 'solid' }

  it.each([
    'minecraft:white_wool', 'minecraft:light_blue_wool', 'minecraft:black_wool',
  ])('羊毛は導体なので solid になる: %s', async (name) => {
    expect(await importVanilla(name)).toMatchObject(solid)
  })

  it.each([
    'minecraft:smooth_quartz', 'minecraft:quartz_bricks', 'minecraft:chiseled_quartz_block',
  ])('石英の各バリアントも solid: %s', async (name) => {
    expect(await importVanilla(name)).toMatchObject(solid)
  })

  it.each([
    'minecraft:stone_bricks', 'minecraft:deepslate_bricks', 'minecraft:end_stone_bricks',
    'minecraft:red_sandstone', 'minecraft:smooth_sandstone',
    'minecraft:oak_log', 'minecraft:stripped_birch_wood', 'minecraft:crimson_stem',
    'minecraft:iron_ore', 'minecraft:deepslate_redstone_ore',
    'minecraft:oxidized_copper', 'minecraft:waxed_exposed_cut_copper',
    'minecraft:hay_block', 'minecraft:packed_ice', 'minecraft:blue_ice',
    'minecraft:soul_sand', 'minecraft:mud', 'minecraft:magma_block', 'minecraft:shroomlight',
  ])('その他の導体フルブロックも solid: %s', async (name) => {
    expect(await importVanilla(name)).toMatchObject(solid)
  })

  it('従来から solid だったものは維持される', async () => {
    for (const name of ['minecraft:stone', 'minecraft:oak_planks', 'minecraft:white_concrete',
                        'minecraft:obsidian', 'minecraft:quartz_block']) {
      expect(await importVanilla(name), name).toMatchObject(solid)
    }
  })

  // ── 非導体フルブロック (#184) ────────────────────────────────────────
  //
  // どれが導体かは**見た目や名前では判別できない**。実機ハーネスで 1 つずつ測って
  // 確定させた (fixture nonconductor-glass-slab)。実際、事前の推測は半分外れていて
  // soul_sand / mud / magma_block は導体、ice は非導体だった。
  // **ice と packed_ice で結果が割れる**のがこの手の推測の危うさを一番よく表している。

  it.each([
    'minecraft:glass', 'minecraft:white_stained_glass', 'minecraft:tinted_glass',
    'minecraft:glowstone', 'minecraft:sea_lantern', 'minecraft:ice',
  ])('非導体フルブロックは solid にしない: %s', async (name) => {
    expect(await importVanilla(name)).toMatchObject({ type: 'glass' })
  })

  it('ice は非導体だが packed_ice / blue_ice は導体 (名前で仲間にしない)', async () => {
    expect(await importVanilla('minecraft:ice')).toMatchObject({ type: 'glass' })
    expect(await importVanilla('minecraft:packed_ice')).toMatchObject({ type: 'solid' })
    expect(await importVanilla('minecraft:blue_ice')).toMatchObject({ type: 'solid' })
  })

  it.each([
    'minecraft:melon_stem', 'minecraft:attached_pumpkin_stem',
  ])('_stem の接尾辞に引っかかる作物は solid にしない: %s', async (name) => {
    expect(await importVanilla(name)).toBeUndefined()
  })

  // ── ハーフブロック (#184) ──────────────────────────────────────────────
  //
  // 単体スラブは**非導体**。#170 では既存挙動を変えないため solid に落としていたが、
  // 実機で導通しないことを確定させた (fixture nonconductor-glass-slab) ので専用型へ移した。
  // **二重スラブだけは当たり判定がフルブロック = 導体**で、これも実機で確認済み。

  it.each([
    ['minecraft:smooth_stone_slab', 'bottom'],
    ['minecraft:oak_slab', 'top'],
    ['minecraft:cut_copper_slab', 'bottom'],   // _copper 接尾辞より優先されること
  ])('単体スラブは非導体の slab になる: %s[type=%s]', async (name, half) => {
    expect(await importVanilla(name, { type: half })).toMatchObject({ type: 'slab', half })
  })

  it('二重スラブは導体なので solid になる', async () => {
    expect(await importVanilla('minecraft:smooth_stone_slab', { type: 'double' }))
      .toMatchObject({ type: 'solid' })
  })

  it('type プロパティが無いスラブは bottom として扱う', async () => {
    // 壊れたファイルや簡略化された palette でも落ちないこと
    expect(await importVanilla('minecraft:stone_brick_slab'))
      .toMatchObject({ type: 'slab', half: 'bottom' })
  })

  it('専用型を持つブロックは接尾辞判定より優先される', async () => {
    // slime_block / honey_block は上流で専用型に落ちる (固体一覧には入れない)
    expect(await importVanilla('minecraft:slime_block')).toMatchObject({ type: 'slime_block' })
    expect(await importVanilla('minecraft:honey_block')).toMatchObject({ type: 'honey_block' })
    // redstone_block は信号源。_block を接尾辞で拾わないことの回帰テスト
    expect(await importVanilla('minecraft:redstone_block')).toMatchObject({ type: 'redstone_block' })
  })

  it('装飾ブロックは従来どおり省略される', async () => {
    expect(await importVanilla('minecraft:oak_wall_sign', { facing: 'north' })).toBeUndefined()
  })
})

// ============================================================
// 向き規約の突き合わせ (#189)
//
// `facing` の意味は素子によって sim と vanilla で逆になる。この変換は**3 箇所**に
// 独立して実装されている:
//   1. `app/src/nbtIO.ts`                        — ファイル取り込み / 書き出し
//   2. `packages/sim/src/mcstate.ts`             — 実機ハーネスとの変換 (規約の正)
//   3. `packages/viewer/src/world-to-structure.ts` — 3D 描画
//
// #189 では 1 だけが repeater / comparator を反転しておらず、取り込むと 180° 逆を
// 向いた。**書き出し側にも同じ漏れがあったため export → import の往復では誤りが
// 打ち消し合い、`nbt-roundtrip.spec.ts` は通ってしまっていた**。
// 往復ではなく「3 箇所が同じ規約か」を直接見る。
// ============================================================

describe('向き規約: nbtIO と mcstate が一致する (#189)', () => {
  const mcStr = (name: string, props: Record<string, string>): string =>
    `${name}[${Object.entries(props).map(([k, v]) => `${k}=${v}`).join(',')}]`

  const CASES: [string, Record<string, string>][] = [
    ['repeater',   { facing: 'north', delay: '1', locked: 'false', powered: 'false' }],
    ['repeater',   { facing: 'east',  delay: '2', locked: 'false', powered: 'false' }],
    ['comparator', { facing: 'south', mode: 'compare',  powered: 'false' }],
    ['comparator', { facing: 'west',  mode: 'subtract', powered: 'false' }],
    ['observer',   { facing: 'north', powered: 'false' }],
    ['piston',     { facing: 'east',  extended: 'false' }],
    ['redstone_wall_torch', { facing: 'north', lit: 'true' }],
    ['lever',      { face: 'wall', facing: 'north', powered: 'false' }],
    ['stone_button', { face: 'wall', facing: 'east', powered: 'false' }],
    ['hopper',     { facing: 'north', enabled: 'true' }],
    ['dropper',    { facing: 'south', triggered: 'false' }],
    ['dispenser',  { facing: 'west',  triggered: 'false' }],
  ]

  it.each(CASES)('%s の facing が mcstate と一致する: %o', async (name, props) => {
    const viaNbt = await importVanilla(`minecraft:${name}`, props)
    const viaHarness = mcToSim(mcStr(name, props))
    expect(viaNbt, `${name} が取り込めていない`).toBeDefined()
    expect((viaNbt as { facing?: string }).facing)
      .toBe((viaHarness as { facing?: string } | null)?.facing)
  })

  // 取り込み → 描画で元の blockstate に戻ること。上のテストが nbtIO と mcstate の
  // 一致を見るのに対し、こちらは nbtIO と viewer の一致を見る (両方揃って初めて
  // 「ファイルで見た向き = 画面で見える向き」になる)
  it.each([
    ['minecraft:repeater',   { facing: 'north', delay: '1', locked: 'false', powered: 'false' }],
    ['minecraft:comparator', { facing: 'east',  mode: 'compare', powered: 'false' }],
  ] as [string, Record<string, string>][])(
    '取り込んで描画すると元の向きに戻る: %s', async (name, props) => {
      const b = await importVanilla(name, props)
      expect(blockStateToMinecraftStr(b as BlockState)).toContain(`facing=${props.facing}`)
    })
})

describe('向き規約: 書き出しが vanilla 互換になる (#189)', () => {
  /** 単一ブロックを書き出して palette[1] の blockstate 文字列を得る */
  function exportOne(block: BlockState): string {
    const bytes = exportToNbtBytes(new Map([['0,0,0', block]]), GRID, GRID)
    const root = NbtFile.read(bytes).root
    const entry = root.getList('palette').get(1) as NbtCompound
    const name = entry.getString('Name')
    const props = entry.get('Properties') as NbtCompound | undefined
    if (!props) return name
    const kv = [...props.keys()].sort().map(k => `${k}=${props.getString(k)}`).join(',')
    return `${name}[${kv}]`
  }

  // 往復テストは**書き出しと取り込みの両方で同じ反転漏れがあると打ち消し合う** (#189
  // がまさにそれで通り抜けた)。ここでは書き出した blockstate 単体を、実機準拠の
  // simToMc と突き合わせて片側だけで固定する。
  it.each([
    [{ type: 'repeater', facing: 'south', delay: 1, locked: false, powered: false }, 'north'],
    [{ type: 'repeater', facing: 'west',  delay: 1, locked: false, powered: false }, 'east'],
    [{ type: 'comparator', facing: 'north', mode: 'compare', powered: false, outputPower: 0 }, 'south'],
  ] as [BlockState, string][])(
    'sim の facing=出力方向 が vanilla の facing=入力側 として書き出される (期待 %#s)',
    (block, expectedVanillaFacing) => {
      const exported = exportOne(block)
      expect(exported).toContain(`facing=${expectedVanillaFacing}`)
      // 実機準拠の変換器で読み戻すと元の sim state に戻ること。
      // (simToMc は repeater に authored 文字列を要求するため逆向きに突き合わせる)
      expect((mcToSim(exported) as { facing?: string } | null)?.facing)
        .toBe((block as { facing?: string }).facing)
    })
})
