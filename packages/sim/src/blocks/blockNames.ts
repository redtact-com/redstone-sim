// ============================================================
// ブロック名 → sim の「素材ブロック」判定 (#214)
//
// **この分類は 2 つの変換器で共有する**:
//   - `app/src/nbtIO.ts`        … ファイル取り込み
//   - `packages/sim/src/mcstate.ts` … 実機ハーネス
//
// 以前は nbtIO 側にしか無く、mcstate は fixture で使う分だけを個別に列挙して
// 未知は例外にしていた。そのため**実キャプチャをそのまま実機 fixture にできず**
// (#213 のドア fixture が light_blue_wool で落ちた)、#189 で踏んだ
// 「2 つの変換器がドリフトする」構図そのものだった。
// ============================================================

import { noteInstrumentOfBlockName } from './noteInstrument.js'
import type { BlockState, HDir } from '../types.js'

// ── 非導体ブロック (#184) ────────────────────────────────────────────────────
//
// 「フルブロックだが `isRedstoneConductor` が false」のもの。solid に落とすと
// **存在しない導通が生まれる**ため、専用の型に割り当てる。

/**
 * `glass` 型 (= 非導体フルブロック) に集約する名前。
 *
 * **実機ハーネスで 1 つずつ測って確定させた** (#184)。見た目や直感では判別できず、
 * 実際に半分外した:
 *   - 非導体: glass 系 / glowstone / sea_lantern / **ice**
 *   - 導体:   **packed_ice** / **blue_ice** / soul_sand / mud / magma_block / shroomlight
 * ice と packed_ice で結果が割れるので、名前の似ているものを勝手に仲間にしないこと。
 */
const GLASS_EXACT = new Set([
  'glass', 'tinted_glass',
  'glowstone', 'sea_lantern', 'ice',
])
/** 無色ガラスに集約するもの (色は sim で保持しない) */
const GLASS_SUFFIXES = ['_stained_glass']

export function toNonConductiveBlockState(
  name: string, props: Record<string, string>,
): BlockState | null {
  const id = name.startsWith('minecraft:') ? name.slice('minecraft:'.length) : name

  if (GLASS_EXACT.has(id) || GLASS_SUFFIXES.some(s => id.endsWith(s))) {
    // ガラス板 (_pane) はフルブロックではないので対象外 (この分岐にも来ない)
    return { type: 'glass' }
  }

  if (id.endsWith('_slab')) {
    // **二重スラブだけは導体**。当たり判定がフルブロックになるため
    // isRedstoneConductor の既定 (isCollisionShapeFullBlock) が true になる
    if (props.type === 'double') return { type: 'solid', powered: false }
    return { type: 'slab', half: props.type === 'top' ? 'top' : 'bottom' }
  }

  return null
}

// ── 固体ブロック (redstone conductor) の判定 ──────────────────────────────────
//
// レッドストーン的に効くのは「**導体のフルブロック**か」だけ (ダストが乗る /
// 強充電を受けて隣へ配る / ピストンに押される)。素材の違いは挙動に影響しない
// ので、該当するものは全部 solid 1 種に集約する。
//
// 逆に**フルブロックでも非導体**のもの (ガラス・色付きガラス・ハーフブロックなど。
// vanilla では `isRedstoneConductor` が false) は solid にすると**誤って導通する**。
// これらは toNonConductiveBlockState が専用の型 (glass / slab) に割り当てるので、
// ここには来ない (#184)。鉄格子のようにフルブロックですらないものは対象外で、
// 従来どおり未対応ブロックとして警告に出る。

/** 名前がそのまま一致する導体フルブロック */
const SOLID_EXACT = new Set([
  // 石・岩系
  'stone', 'cobblestone', 'mossy_cobblestone', 'smooth_stone',
  'granite', 'polished_granite', 'diorite', 'polished_diorite',
  'andesite', 'polished_andesite',
  'deepslate', 'cobbled_deepslate', 'polished_deepslate', 'chiseled_deepslate',
  'reinforced_deepslate', 'tuff', 'polished_tuff', 'chiseled_tuff',
  'calcite', 'dripstone_block', 'netherrack', 'end_stone', 'bedrock',
  'obsidian', 'crying_obsidian',
  'blackstone', 'polished_blackstone', 'chiseled_polished_blackstone', 'gilded_blackstone',
  'basalt', 'polished_basalt', 'smooth_basalt', 'magma_block',
  // 土・砂・氷系
  'dirt', 'coarse_dirt', 'rooted_dirt', 'grass_block', 'podzol', 'mycelium',
  'mud', 'packed_mud', 'clay', 'sand', 'red_sand', 'gravel',
  'soul_sand', 'soul_soil', 'snow_block', 'moss_block',
  // ice は非導体 (実機確認済み)。packed_ice / blue_ice は**導体**で挙動が違う
  'packed_ice', 'blue_ice',
  // 鉱物・金属ブロック (redstone_block は信号源なので上流で処理済み)
  'iron_block', 'gold_block', 'diamond_block', 'emerald_block', 'lapis_block',
  'coal_block', 'netherite_block', 'copper_block', 'amethyst_block',
  'raw_iron_block', 'raw_gold_block', 'raw_copper_block',
  // 石英・プルプァ・プリズマリン
  'quartz_block', 'smooth_quartz', 'quartz_bricks', 'quartz_pillar', 'chiseled_quartz_block',
  'purpur_block', 'purpur_pillar',
  'prismarine', 'prismarine_bricks', 'dark_prismarine',   // sea_lantern は非導体
  // 砂岩 (red_sandstone 等は接尾辞側で拾う)
  'sandstone',
  // 有機・その他フルブロック
  'bookshelf', 'chiseled_bookshelf', 'hay_block', 'dried_kelp_block', 'bone_block',
  'sponge', 'wet_sponge', 'melon', 'pumpkin', 'carved_pumpkin', 'jack_o_lantern',
  'nether_wart_block', 'warped_wart_block', 'shroomlight',   // glowstone は非導体
  'brown_mushroom_block', 'red_mushroom_block', 'mushroom_stem',
])

/** 接尾辞で一致する導体フルブロック */
const SOLID_SUFFIXES = [
  '_planks', '_log', '_wood', '_stem', '_hyphae',
  '_wool', '_concrete', '_concrete_powder', '_terracotta',
  '_bricks', '_sandstone', '_ore',
  '_copper', 'cut_copper',   // 酸化・蝋引きの各段階
]

/** 接尾辞に引っかかるが**フルブロックではない**ので除外するもの */
const NOT_SOLID_EXACT = new Set([
  'melon_stem', 'pumpkin_stem', 'attached_melon_stem', 'attached_pumpkin_stem',
])

/**
 * 導体フルブロックのうち**ピストンで押せない**もの (#253)。
 * [確定: 26.2 — いずれも pushReaction(BLOCK)]
 *
 * sim は材質を潰しているのでここだけ名前で割る。**lodestone は別型**なので入れない。
 * [実機実測: ピストンの正面が黒曜石 → 伸びない / スライムの横が黒曜石 → 伸びる]
 */
const IMMOVABLE_SOLID = new Set([
  'obsidian', 'crying_obsidian', 'bedrock', 'reinforced_deepslate',
  'respawn_anchor', 'spawner', 'trial_spawner', 'vault', 'budding_amethyst',
  'command_block', 'chain_command_block', 'repeating_command_block',
  'structure_block', 'jigsaw', 'barrier', 'end_portal_frame',
])

/** ピストンで押せない導体フルブロックか (#253) */
export function isImmovableSolidName(name: string): boolean {
  return IMMOVABLE_SOLID.has(stripNs(name))
}

/**
 * **押せるが引けない**導体フルブロックか (#255)。
 * [確定: 26.2 — 釉薬テラコッタ 16 色は pushReaction(PUSH_ONLY)]
 */
export function isPushOnlySolidName(name: string): boolean {
  return stripNs(name).endsWith('_glazed_terracotta')
}

export function isSolidBlockName(name: string): boolean {
  const id = name.startsWith('minecraft:') ? name.slice('minecraft:'.length) : name
  if (NOT_SOLID_EXACT.has(id)) return false
  if (SOLID_EXACT.has(id)) return true
  if (SOLID_SUFFIXES.some(s => id.endsWith(s))) return true
  // ハーフブロックは #184 で非導体の slab 型に移した (二重スラブのみここへ来る前に
  // toNonConductiveBlockState が solid を返す)
  return false
}

/**
 * ブロック名 + プロパティ → sim の素材ブロック。該当しなければ null。
 *
 * 判定順は **非導体が先**。`_slab` は `_planks` 等の接尾辞判定に引っかかるため、
 * 先に見ないと誤って solid になる。
 */
/**
 * レッドストーン的に何もしない装飾ブロック (#234)。
 * **非導体・非信号源・ワイヤーを切らない**性質が同じものをここへ集約する。
 * 見た目だけは区別したいので取り込み元の文字列を保持する (判断 E)。
 *
 * `lectern` は本来コンパレーターで読める (階数指定に使われている) が、
 * 読み取りは未実装のため当面ここに入れる。
 */
const DECOR_SUFFIXES = ['_stairs', '_hanging_sign', '_sign', '_banner', '_carpet']
const DECOR_EXACT = new Set([
  'end_rod', 'lectern', 'lightning_rod', 'flower_pot', 'chain', 'ladder',
])

/**
 * 頭・頭蓋 (`player_head` / `zombie_wall_head` / `skeleton_skull` …)。
 * 1.20.3 以降 `powered` プロパティを持つが**レッドストーン出力は無い**ので装飾でよい
 * [確定: 26.2 SkullBlock — getSignal を持たない]。
 * `piston_head` だけは名前が `_head` で終わるが**まったくの別物**なので必ず外す。
 */
const isHeadOrSkull = (id: string): boolean =>
  id !== 'piston_head' && (id.endsWith('_head') || id.endsWith('_skull'))

const stripNs = (name: string): string =>
  name.startsWith('minecraft:') ? name.slice('minecraft:'.length) : name

export function isDecorBlockName(name: string): boolean {
  const id = stripNs(name)
  return DECOR_EXACT.has(id) || isHeadOrSkull(id)
    || DECOR_SUFFIXES.some(sfx => id.endsWith(sfx))
}

/** blockstate の数値プロパティを範囲内に収めて取り込む */
function clampLevel(v: string | undefined, min: number, max: number): number {
  const n = Number(v ?? min)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : min
}

export function classifyPlainBlock(
  name: string, props: Record<string, string> = {},
): BlockState | null {
  // #234 ガラスエレベーターで要るもの。**取り込みの入口はここ 1 か所**にする
  // (nbtIO と mcstate に別々の変換器があり、#189 / #214 で 2 回ドリフト事故を起こしている)
  const id = stripNs(name)
  if (id === 'lodestone') {
    // 石 (導体) だがピストンで押せない [確定: 26.2 pushReaction(BLOCK)]
    return { type: 'lodestone', powered: false }
  }
  if (id === 'water_cauldron') {
    // コンパレーターは LEVEL をそのまま読む [確定: 26.2 LayeredCauldronBlock]
    return { type: 'cauldron', level: clampLevel(props.level, 0, 3) }
  }
  if (id === 'composter') {
    // 同上 [確定: 26.2 ComposterBlock]
    return { type: 'composter', level: clampLevel(props.level, 0, 8) }
  }
  if (id.endsWith('_wall') && !id.endsWith('_wall_sign') && !id.endsWith('_wall_hanging_sign')
    && !id.endsWith('_wall_torch') && !id.endsWith('_wall_fan') && !id.endsWith('_wall_head')
    && !id.endsWith('_wall_banner') && !id.endsWith('_wall_skull')) {
    // 塀 (#234)。材質は潰す (レッドストーン的な差は無い)
    const side = (v: string | undefined): 'none' | 'low' | 'tall' =>
      v === 'low' || v === 'tall' ? v : 'none'
    return {
      type: 'wall',
      north: side(props.north), east: side(props.east),
      south: side(props.south), west: side(props.west),
      up: props.up !== 'false',
      waterlogged: props.waterlogged === 'true',
    }
  }
  if (id === 'soul_sand') {
    // 導体だが泡柱の源なので solid に潰さない (#234)
    return { type: 'soul_sand', powered: false }
  }
  if (id === 'water') {
    // 持つのは水源 (0) と落下水 (8) だけ。**横に広がる流水 (1-7) は実装しない** (#252)。
    // 1-7 が来たら落下水と同じ「泡柱が立たない水」として扱う (どちらも水源ではない)
    const level = Number(props.level ?? 0)
    return { type: 'water', level: level === 0 ? 0 : 8 }
  }
  if (id === 'bubble_column') {
    // 縦の無遅延バス [確定: 26.2 BubbleColumnBlock]
    return { type: 'bubble_column', drag: props.drag === 'true' }
  }
  if (id === 'lectern') {
    // コンパレーターがページを読む (#240)。ページ数・現在ページは BE 側なので
    // 取り込み元が持っていれば nbtIO が後から差し込む (既定は本の中身なし = 出力 14)
    return {
      type: 'lectern',
      facing: (props.facing ?? 'north') as HDir,
      hasBook: props.has_book === 'true',
      page: 0,
      pages: 0,
    }
  }
  // ガラス板 / 鉄格子 (#303)。**接続が隣の出入りで変わり、オブザーバーが検知する**ので
  // 装飾に潰せない [確定: 26.2 IronBarsBlock — 非導体・非信号源だが CrossCollisionBlock で
  //  north/east/south/west の接続を持つ]
  if (id.endsWith('_pane') || id === 'iron_bars') {
    return {
      type: 'pane', name: id,
      north: props.north === 'true', east: props.east === 'true',
      south: props.south === 'true', west: props.west === 'true',
      waterlogged: props.waterlogged === 'true',
    }
  }
  if (isDecorBlockName(id)) return { type: 'decor', name: formatDecorName(id, props) }

  // sim は材質を潰すが、**上の音符ブロックの音色は材質で決まる** ので
  // ここで拾って state に載せる (#231)。羊毛=guitar / 木=bass など
  const instrument = noteInstrumentOfBlockName(name)
  const withInstrument = <T extends BlockState>(b: T): T =>
    instrument === 'harp' ? b : { ...b, instrument }

  const nonConductive = toNonConductiveBlockState(name, props)
  if (nonConductive) return withInstrument(nonConductive)
  if (isSolidBlockName(name)) {
    if (isImmovableSolidName(name)) {
      return withInstrument({ type: 'solid', powered: false, immovable: true })
    }
    if (isPushOnlySolidName(name)) {
      return withInstrument({ type: 'solid', powered: false, pushOnly: true })
    }
    return withInstrument({ type: 'solid', powered: false })
  }
  return null
}

/** 装飾の描画用に blockstate 文字列を組み立て直す (プロパティはキー昇順) */
function formatDecorName(id: string, props: Record<string, string>): string {
  const keys = Object.keys(props).sort()
  return keys.length === 0 ? id : `${id}[${keys.map(k => `${k}=${props[k]}`).join(',')}]`
}
