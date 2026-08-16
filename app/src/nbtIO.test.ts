import { describe, it, expect } from 'vitest'
import {
  NbtFile, NbtCompound, NbtList, NbtInt, NbtString,
} from 'deepslate/nbt'
import type { BlockState } from '@redstone/sim'
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
  it('hopper は facing/enabled を保持し count=0 で戻る (中身は NBT に無い)', async () => {
    expect(await roundTrip({ type: 'hopper', facing: 'east', count: 12, enabled: true }))
      .toMatchObject({ type: 'hopper', facing: 'east', enabled: true, count: 0 })
  })

  it('dropper は facing/triggered を保持し count=0 で戻る', async () => {
    expect(await roundTrip({ type: 'dropper', facing: 'up', count: 5, triggered: false }))
      .toMatchObject({ type: 'dropper', facing: 'up', triggered: false, count: 0 })
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
