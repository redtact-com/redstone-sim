import { describe, it, expect } from 'vitest'
import { isConductor } from '@redstone/sim'
import {
  NbtFile, NbtCompound, NbtList, NbtInt, NbtString, NbtLongArray,
} from 'deepslate/nbt'
import type { BlockState } from '@redstone/sim'
import { mcToSim, slotsFromCount, SimWorld } from '@redstone/sim'
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
    'minecraft:mud', 'minecraft:magma_block', 'minecraft:shroomlight',
  ])('その他の導体フルブロックも solid: %s', async (name) => {
    expect(await importVanilla(name)).toMatchObject(solid)
  })

  it('soul_sand は導体だが独立した型 (#234)', async () => {
    // 泡柱の源になるので solid に潰さない。導体であることは変わらない
    // (実機ハーネスで測定済み)
    const b = await importVanilla('minecraft:soul_sand')
    expect(b).toMatchObject({ type: 'soul_sand' })
    expect(isConductor(b as BlockState)).toBe(true)
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

  it('装飾ブロックは decor として取り込む (#234)', async () => {
    // 以前は省略していた。レッドストーン的には無関係だが、
    // **見た目が欠けると回路の理解を損ねる**ので 1 型に集約して取り込む。
    // 元のブロック名は保持する (判断 E)
    const sign = await importVanilla('minecraft:oak_wall_sign', { facing: 'north' })
    expect(sign).toMatchObject({ type: 'decor' })
    expect((sign as { name: string }).name).toContain('oak_wall_sign')
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

// ============================================================
// 素材ブロックの分類が 2 つの変換器で一致する (#214)
//
// 固体 / ガラス / スラブの判定は #214 で `packages/sim/src/blocks/blockNames.ts`
// に集約し、`nbtIO` と `mcstate` (実機ハーネス) の両方から使うようにした。
//
// それ以前は mcstate 側が fixture で使う分だけを個別に列挙し、未知は例外にして
// いたため**実キャプチャをそのまま実機 fixture にできなかった** (#213 のドア
// fixture が light_blue_wool で落ちた)。#189 の「2 つの変換器がドリフトする」
// のと同じ構図なので、同じ形で突き合わせる。
// ============================================================

describe('素材ブロックの分類: nbtIO と mcstate が一致する (#214)', () => {
  const CASES: [string, Record<string, string>][] = [
    // 実キャプチャ (Runa.S の 2 幅ドア) に出てくるもの
    ['light_blue_wool', {}], ['white_stained_glass', {}], ['black_stained_glass', {}],
    ['light_blue_stained_glass', {}], ['diamond_block', {}], ['smooth_quartz', {}],
    ['stone', {}], ['smooth_stone_slab', { type: 'bottom' }],
    // #184 で実機測定した割れどころ
    ['glowstone', {}], ['sea_lantern', {}], ['ice', {}],
    ['packed_ice', {}], ['blue_ice', {}], ['soul_sand', {}], ['magma_block', {}],
    ['smooth_stone_slab', { type: 'double' }], ['oak_slab', { type: 'top' }],
    // 接尾辞判定
    ['oak_planks', {}], ['deepslate_bricks', {}], ['waxed_exposed_cut_copper', {}],
  ]

  it.each(CASES)('%s %o が両方で同じ型になる', async (name, props) => {
    const viaNbt = await importVanilla(`minecraft:${name}`, props)
    const kv = Object.entries(props).map(([k, v]) => `${k}=${v}`).join(',')
    const viaHarness = mcToSim(kv ? `${name}[${kv}]` : name)
    expect(viaNbt, `${name} が nbtIO で取り込めていない`).toBeDefined()
    expect(viaHarness, `${name} が mcstate で扱えない`).not.toBeNull()
    expect(viaHarness!.type).toBe((viaNbt as BlockState).type)
  })

  it('**実キャプチャのブロックで mcToSim が例外を投げない** (#213 の fixture が落ちた原因)', () => {
    for (const [name, props] of CASES) {
      const kv = Object.entries(props).map(([k, v]) => `${k}=${v}`).join(',')
      expect(() => mcToSim(kv ? `${name}[${kv}]` : name), name).not.toThrow()
    }
  })

  it('本当に未対応のブロックは従来どおり例外にする (typo 検知を残す)', () => {
    expect(() => mcToSim('definitely_not_a_block')).toThrow(/扱えないブロック/)
  })
})

// ============================================================
// 書見台の本の取り込み (#240)
//
// ガラスエレベーターの**階数指定は書見台**で、コンパレーターがページ番号を読む
// (実機の本文がそのまま操作説明: 「15-階数(1F~14F) =1ページ」)。ページと
// ページ数は blockstate ではなく block entity 側にあるため、**取り込みで本を
// 落とすと出力が常に 14 に潰れて階を選べない**。
//
// 本の形式は 2 つある。署名済みの written_book_content と未署名の
// writable_book_content で、実ファイルは各階の 10 台が前者、地上の 1 台が後者だった。
// [確定: 26.2 LecternBlockEntity — Book / Page、ページ数は上記 2 component の
//  ページ列の長さ (どちらも無ければ 0)]
// ============================================================

/** ページ n 枚のページ列。1 件は raw つき compound でも素の文字列でもよい */
function pageList(n: number, form: 'raw' | 'string' = 'raw'): NbtList {
  const texts = Array.from({ length: n }, (_, i) => `p${i}`)
  return form === 'raw'
    ? new NbtList<NbtCompound>(texts.map(t => new NbtCompound().set('raw', new NbtString(t))))
    : new NbtList<NbtString>(texts.map(t => new NbtString(t)))
}

/** ページ n 枚の本アイテム (1.20.5 以降の component 形式) */
function bookItem(component: string, n: number, form: 'raw' | 'string' = 'raw'): NbtCompound {
  const id = component.includes('writable') ? 'minecraft:writable_book' : 'minecraft:written_book'
  return new NbtCompound()
    .set('id', new NbtString(id))
    .set('count', new NbtInt(1))
    .set('components', new NbtCompound().set(component, new NbtCompound().set('pages', pageList(n, form))))
}

/** ページ n 枚の本アイテム (1.20.4 以前の tag 形式) */
function legacyBookItem(n: number): NbtCompound {
  return new NbtCompound()
    .set('id', new NbtString('minecraft:written_book'))
    .set('Count', new NbtInt(1))
    .set('tag', new NbtCompound().set('pages', pageList(n, 'string')))
}

/** 書見台の block entity (Book を省くと**本の中身なし**) */
function lecternNbt(book: NbtCompound | undefined, page: number): NbtCompound {
  const c = new NbtCompound().set('id', new NbtString('minecraft:lectern'))
  if (book) c.set('Book', book).set('Page', new NbtInt(page))
  return c
}

/** block entity NBT つきの単一ブロックを構造 NBT (.nbt) に組んで取り込む */
async function importWithBlockEntity(
  name: string, props: Record<string, string>, be: NbtCompound | undefined,
): Promise<BlockState | undefined> {
  const air = new NbtCompound().set('Name', new NbtString('minecraft:air'))
  const target = new NbtCompound().set('Name', new NbtString(name))
  const p = new NbtCompound()
  for (const [k, v] of Object.entries(props)) p.set(k, new NbtString(v))
  target.set('Properties', p)
  const blockEntry = new NbtCompound()
    .set('state', new NbtInt(1))
    .set('pos', new NbtList<NbtInt>([new NbtInt(0), new NbtInt(0), new NbtInt(0)]))
  if (be) blockEntry.set('nbt', be)
  const root = new NbtCompound()
    .set('size', new NbtList<NbtInt>([new NbtInt(1), new NbtInt(1), new NbtInt(1)]))
    .set('palette', new NbtList<NbtCompound>([air, target]))
    .set('blocks', new NbtList<NbtCompound>([blockEntry]))
    .set('entities', new NbtList<NbtCompound>([]))
  const bytes = new NbtFile('', root, 'gzip', false, undefined).write()
  return (await importFromNbtBytes(bytes, { maxLayers: 8 })).blocks.get('0,0,0')
}

const LECTERN_PROPS = { facing: 'west', has_book: 'true', powered: 'false' }

/** 書見台を .nbt 経由で取り込む (本つき) */
const importLectern = (book: NbtCompound | undefined, page = 0) =>
  importWithBlockEntity('minecraft:lectern', LECTERN_PROPS, lecternNbt(book, page))

describe('書見台の本の取り込み: 構造 NBT (#240)', () => {
  it('署名済みの本 (written_book_content) のページ数と現在ページを読む', async () => {
    expect(await importLectern(bookItem('minecraft:written_book_content', 15), 3))
      .toMatchObject({ type: 'lectern', hasBook: true, page: 3, pages: 15 })
  })

  it('**未署名の本 (writable_book_content)** も読む — 実ファイルでは地上の 1 台だけがこちら', async () => {
    expect(await importLectern(bookItem('minecraft:writable_book_content', 15), 4))
      .toMatchObject({ type: 'lectern', hasBook: true, page: 4, pages: 15 })
  })

  it('ページ 1 件が素の文字列でも要素数で数える', async () => {
    expect(await importLectern(bookItem('minecraft:writable_book_content', 5, 'string'), 2))
      .toMatchObject({ page: 2, pages: 5 })
  })

  it('1.20.4 以前の tag.pages 形式も読む', async () => {
    expect(await importLectern(legacyBookItem(15), 3)).toMatchObject({ page: 3, pages: 15 })
  })

  it('本が無ければ pages=0 のまま (= 出力 14 の既存の挙動)', async () => {
    // block entity ごと無い場合と、block entity はあるが Book が無い場合
    expect(await importWithBlockEntity('minecraft:lectern', LECTERN_PROPS, undefined))
      .toMatchObject({ type: 'lectern', hasBook: true, page: 0, pages: 0 })
    expect(await importLectern(undefined)).toMatchObject({ page: 0, pages: 0 })
  })

  it('ページ数が読めない本も pages=0 (中身なし扱いにフォールバック)', async () => {
    // component も tag も持たない本 (別 mod / 壊れたファイル)
    const odd = new NbtCompound().set('id', new NbtString('minecraft:written_book'))
    expect(await importLectern(odd, 3)).toMatchObject({ page: 0, pages: 0 })
  })

  it('Page がページ数を超えていたら最終ページへ丸める', async () => {
    // [確定: 26.2 LecternBlockEntity — 読み込み時に Page をページ数の範囲へ収める]
    expect(await importLectern(bookItem('minecraft:writable_book_content', 5), 99))
      .toMatchObject({ page: 4, pages: 5 })
    expect(await importLectern(bookItem('minecraft:writable_book_content', 5), -3))
      .toMatchObject({ page: 0, pages: 5 })
  })

  it('取り込んだ本で階数指定が効く (コンパレーター出力 = ページ + 1)', async () => {
    // 15 ページ本なら進捗 = page/14 なので **出力はページ + 1**。
    // 本を落とすと pages=0 → 常に 14 で、どの階も選べなくなる
    const read = (b: BlockState): number => {
      const w = new SimWorld()
      w.setBlockAt([0, -1, 0], { type: 'solid', powered: false })
      w.setBlockAt([1, -1, 0], { type: 'solid', powered: false })
      w.setBlockAt([0, 0, 0], b)
      // sim の facing は出力方向なので、西隣の書見台を読むには east 向き
      w.setBlockAt([1, 0, 0], {
        type: 'comparator', facing: 'east', mode: 'compare', powered: false, outputPower: 0,
      } as BlockState)
      w.initialize()
      w.settle(8)
      const c = w.getBlockAt([1, 0, 0])
      return c?.type === 'comparator' ? c.outputPower : -1
    }
    for (const page of [0, 4, 14]) {
      const b = await importLectern(bookItem('minecraft:writable_book_content', 15), page)
      expect(read(b as BlockState), `Page=${page}`).toBe(page + 1)
    }
  })
})

// ── litematic 経由 (実ファイルはこの経路) ──────────────────────────────────────
//
// litematic は変換で block entity が落ちるため `Regions.<name>.TileEntities` を
// 元ファイルから直接読んで貼り直している (#197 と同じ経路)。

/** ブロック 1 個 + TileEntity 1 件の litematic。パレットは air + 1 種 = 2 bit 固定 */
function litematicOne(name: string, tile: NbtCompound | undefined): Uint8Array {
  const xyz = (x: number, y: number, z: number) =>
    new NbtCompound().set('x', new NbtInt(x)).set('y', new NbtInt(y)).set('z', new NbtInt(z))
  const region = new NbtCompound()
    .set('Position', xyz(0, 0, 0))
    .set('Size', xyz(1, 1, 1))
    .set('BlockStatePalette', new NbtList<NbtCompound>(
      ['minecraft:air', name].map(n => new NbtCompound().set('Name', new NbtString(n)))))
    .set('BlockStates', new NbtLongArray([1n]))   // 添字 1 (= name) が 1 個だけ
    .set('TileEntities', new NbtList<NbtCompound>(tile ? [tile.set('x', new NbtInt(0))
      .set('y', new NbtInt(0)).set('z', new NbtInt(0))] : []))
  return new NbtFile('', new NbtCompound()
    .set('Version', new NbtInt(6))
    .set('MinecraftDataVersion', new NbtInt(3700))
    .set('Metadata', new NbtCompound())
    .set('Regions', new NbtCompound().set('Unnamed', region)), 'gzip', false, undefined).write()
}

describe('書見台の本の取り込み: litematic (#240)', () => {
  it('TileEntities から本を貼る (変換で落ちる分を元ファイルから補う)', async () => {
    const bytes = litematicOne(
      'minecraft:lectern',
      lecternNbt(bookItem('minecraft:writable_book_content', 15), 4),
    )
    const r = await importFromNbtBytes(bytes, { gridW: 16, gridH: 16, maxLayers: 16 })
    expect(r.blocks.get('0,0,0')).toMatchObject({ type: 'lectern', page: 4, pages: 15 })
    expect(r.warnings).toEqual([])
  })

  it('TileEntity が無ければ pages=0 のまま (= 出力 14)', async () => {
    const r = await importFromNbtBytes(litematicOne('minecraft:lectern', undefined),
      { gridW: 16, gridH: 16, maxLayers: 16 })
    expect(r.blocks.get('0,0,0')).toMatchObject({ type: 'lectern', page: 0, pages: 0 })
    expect(r.warnings).toEqual([])
  })

  it('貼り先が書見台でなければ**黙って捨てず警告する**', async () => {
    // 座標系の解釈がずれて石を指してしまった状況 (#197 のコンテナと同じ扱い)
    const bytes = litematicOne(
      'minecraft:stone', lecternNbt(bookItem('minecraft:writable_book_content', 15), 4))
    const r = await importFromNbtBytes(bytes, { gridW: 16, gridH: 16, maxLayers: 16 })
    expect(r.warnings.some(w => w.includes('対応付けられませんでした'))).toBe(true)
  })
})

describe('ガラス板の往復 (#303)', () => {
  // pane 型を足したとき nbtIO の書き出し分岐を落としており、
  // **保存するとガラス板が air になって消えていた** (取り込みは通るので気づきにくい)。
  // 実ファイル (Runa.S_closed) で 9 枚が 0 枚になる回帰だった
  it('取り込んで書き出すと同じ板が戻る', async () => {
    const src = 'minecraft:light_blue_stained_glass_pane[east=true,north=false,south=true,'
      + 'waterlogged=false,west=false]'
    const sim = mcToSim(src)
    expect(sim?.type).toBe('pane')
    const bytes = exportToNbtBytes(new Map([['0,0,0', sim!]]), GRID, GRID)
    const back = await importFromNbtBytes(bytes)
    const got = back.blocks.get('0,0,0')
    expect(got).toEqual(sim)
  })
})
