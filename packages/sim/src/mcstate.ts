// ============================================================
// Minecraft blockstate 文字列 <-> sim BlockState の相互変換
//
// 実機 ground truth ハーネス (tools/mc-harness) の fixture は
// Minecraft の blockstate 文字列 (例: 'repeater[delay=1,facing=west,...]')
// を正とする。ここでは:
//   - canonicalize: 名前空間除去 + プロパティのキー昇順ソート
//   - mcToSim:      blockstate 文字列 → sim BlockState
//   - simToMc:      sim BlockState → blockstate 文字列
//                   (authored 文字列に動的プロパティのみパッチする方式。
//                    face/facing/mode 等の静的プロパティは sim 側に完全な
//                    情報がないため authored の値を保持する)
//
// facing 変換の要注意点 [確定: 1.21.1 DiodeBlock デコンパイル]:
//   - MC の repeater/comparator の facing は「入力側」を指す
//     (getInputSignal が FACING 方向の隣を読む)。
//     sim の facing は「出力方向」なので相互に OPPOSITE 変換する。
//   - MC の redstone_wall_torch の facing は「壁から離れる方向」。
//     sim の wall_torch facing は「壁の方向」なので OPPOSITE 変換する。
// ============================================================

import { toNoteInstrument } from './blocks/noteInstrument.js'
import type {
  BlockState, HDir, Dir6, WireConnectionValue, RailShape, StraightRailShape,
} from './types.js'
import { OPPOSITE } from './types.js'
import { emptySlots } from './blocks/container.js'
import { classifyPlainBlock } from './blocks/blockNames.js'

export interface ParsedMcState {
  name: string
  props: Record<string, string>
}

/** 'minecraft:name[k=v,...]' をパースする。名前空間は除去 */
export function parseMcState(state: string): ParsedMcState {
  const m = /^([a-z0-9_:]+)(?:\[(.*)\])?$/.exec(state.trim())
  if (!m) throw new Error(`blockstate 文字列をパースできない: ${state}`)
  const name = m[1].replace(/^minecraft:/, '')
  const props: Record<string, string> = {}
  if (m[2]) {
    for (const kv of m[2].split(',')) {
      const [k, v] = kv.split('=')
      if (!k || v === undefined) throw new Error(`プロパティが不正: ${state}`)
      props[k.trim()] = v.trim()
    }
  }
  return { name, props }
}

/** name + props を正規化文字列にする (キー昇順、名前空間なし) */
export function formatMcState(name: string, props: Record<string, string>): string {
  const keys = Object.keys(props).sort()
  if (keys.length === 0) return name
  return `${name}[${keys.map(k => `${k}=${props[k]}`).join(',')}]`
}

/** blockstate 文字列を正規形へ (scarpet 側 _canon() と同一形式) */
export function canonicalize(state: string): string {
  const { name, props } = parseMcState(state)
  // sim は導体フルブロックを材質ごと `solid` 1 種に潰す (13 §2 の既知の抽象化)。
  // ピストンで動いた先には authored が無く `stone` として合成されるため、
  // **実機側の材質も stone に寄せて比較する** (#214)。
  // 非導体 (glass / slab) も同様に代表名へ寄せる
  const plain = classifyPlainBlock(name, props)
  if (plain) {
    // **押せる導体と押せない導体は別の代表名へ寄せる** (#253)。
    // 同じ stone に潰すと「黒曜石をピストンで押した」ような食い違いが見えなくなる
    if (plain.type === 'solid') {
      if (plain.immovable === true) return 'obsidian'
      // 押せるが引けない (#255)。stone に潰すと「引けたかどうか」が比較で見えなくなる
      if (plain.pushOnly === true) return formatMcState('gray_glazed_terracotta', { facing: 'north' })
      return 'stone'
    }
    if (plain.type === 'glass') return 'glass'
    if (plain.type === 'slab') return formatMcState('smooth_stone_slab', { type: plain.half })
  }
  return formatMcState(name, props)
}


function wireConn(v: string): WireConnectionValue {
  if (v === 'none') return false
  if (v === 'side') return true
  if (v === 'up') return 'up'
  throw new Error(`ワイヤー接続値が不正: ${v}`)
}

/**
 * MC blockstate 文字列 → sim BlockState。
 * sim が表現できないブロックは例外を投げる (fixture 側の書き間違い検出)。
 */
export function mcToSim(state: string): BlockState | null {
  const { name, props } = parseMcState(state)
  switch (name) {
    case 'air':
      return null
    case 'redstone_wire': {
      const connections = {
        north: wireConn(props.north ?? 'none'),
        south: wireConn(props.south ?? 'none'),
        east: wireConn(props.east ?? 'none'),
        west: wireConn(props.west ?? 'none'),
      }
      return { type: 'wire', connections, power: Number(props.power ?? '0') }
    }
    case 'repeater':
      return {
        type: 'repeater',
        facing: OPPOSITE[props.facing as HDir] as HDir,
        delay: Number(props.delay ?? '1') as 1 | 2 | 3 | 4,
        powered: props.powered === 'true',
        locked: props.locked === 'true',
      }
    case 'comparator':
      return {
        type: 'comparator',
        facing: OPPOSITE[props.facing as HDir] as HDir,
        mode: (props.mode ?? 'compare') as 'compare' | 'subtract',
        powered: props.powered === 'true',
        // outputPower は blockstate に現れない (BE の OutputSignal)。
        // initialize() + flush() で再計算されるため 0 で構わない
        outputPower: 0,
      }
    case 'redstone_torch':
      return { type: 'torch', facing: 'up', lit: props.lit === 'true' }
    case 'redstone_wall_torch':
      return {
        type: 'wall_torch',
        facing: OPPOSITE[props.facing as HDir] as HDir,
        lit: props.lit === 'true',
      }
    case 'lever': {
      const face = props.face ?? 'wall'
      const facing =
        face === 'floor' ? 'up' :
        face === 'ceiling' ? 'down' :
        (props.facing as HDir)
      return { type: 'lever', facing, powered: props.powered === 'true' }
    }
    case 'stone_button':
    case 'oak_button': {
      const face = props.face ?? 'wall'
      const facing =
        face === 'floor' ? 'up' :
        face === 'ceiling' ? 'down' :
        (props.facing as HDir)
      return {
        type: name === 'stone_button' ? 'button_stone' : 'button_wood',
        facing,
        powered: props.powered === 'true',
      }
    }
    case 'oak_pressure_plate':
    case 'stone_pressure_plate':
      // 木/石 感圧板。POWERED なら出力 15、でなければ 0 [確定: 26.2 PressurePlateBlock]
      return {
        type: name === 'stone_pressure_plate' ? 'pressure_plate_stone' : 'pressure_plate_wood',
        powered: props.powered === 'true',
      }
    case 'light_weighted_pressure_plate':
    case 'heavy_weighted_pressure_plate': {
      // 重量感圧板。POWER (0-15) = 現在出力。手動モデルは設定値 pressedPower を
      // 保持する。authored の POWER>0 は乗った状態なので pressedPower に採用し、
      // rest (POWER=0) では既定値 15 とする [確定: 26.2 WeightedPressurePlateBlock]
      const power = Number(props.power ?? '0')
      return {
        type: name === 'heavy_weighted_pressure_plate'
          ? 'weighted_pressure_plate_heavy' : 'weighted_pressure_plate_light',
        pressedPower: power > 0 ? power : 15,
        powered: power > 0,
      }
    }
    case 'redstone_lamp':
      return { type: 'lamp', lit: props.lit === 'true' }

    case 'note_block':
      // instrument も取り込む。**直下のブロックで決まり、変化はオブザーバーに
      // 検知される**ので blockstate として持つ必要がある (#231)。
      // 取り込み時は文字列をそのまま採る (実機の「まだ再計算されていない古い音色」を
      // 再現するため。ここで計算し直すと authored 照合が合わなくなる)
      return {
        type: 'note_block',
        powered: props.powered === 'true',
        note: Number(props.note ?? '0'),
        instrument: toNoteInstrument(props.instrument),
      }
    case 'piston':
    case 'sticky_piston':
      // vanilla の facing = 伸長方向 = sim と同一 (反転不要)
      return { type: name as 'piston' | 'sticky_piston',
               facing: (props.facing ?? 'north') as Dir6,
               extended: props.extended === 'true' }
    case 'observer':
      // vanilla の facing = 観測方向 (顔のある面) = sim と同一 (反転不要)。
      // powered は BE ではなく blockstate。outputPower は持たない (常に 15/0)
      return { type: 'observer', facing: (props.facing ?? 'south') as Dir6,
               powered: props.powered === 'true' }
    case 'piston_head':
      return { type: 'piston_head', facing: (props.facing ?? 'north') as Dir6,
               sticky: props.type === 'sticky' }
    case 'moving_piston':
      // 実機 dump にのみ現れる過渡状態。payload (into) は BE 内で不可視のため
      // sim へは復元できない (fixture の authored には使わないこと)
      throw new Error('moving_piston は authored に使えません (過渡状態)')
    case 'redstone_block':
      return { type: 'redstone_block' }
    case 'slime_block':
      return { type: 'slime_block' }
    case 'honey_block':
      return { type: 'honey_block' }
    case 'powered_rail':
    case 'activator_rail':
      // SHAPE は RAIL_SHAPE_STRAIGHT (直線2+坂4)。曲線は取らない [確定: 26.2]。
      // activator_rail は powered_rail と同じ PoweredRailBlock なので状態も同形 (#138)
      return { type: name, shape: (props.shape ?? 'north_south') as StraightRailShape,
               powered: props.powered === 'true' }
    case 'rail':
      // SHAPE は RAIL_SHAPE (直線2+坂4+曲線4 の 10 種)。動力は持たない (#140)
      return { type: 'rail', shape: (props.shape ?? 'north_south') as RailShape }
    case 'detector_rail':
      // SHAPE は RAIL_SHAPE_STRAIGHT。powered はカート検出で立つ (#146)
      return { type: 'detector_rail', shape: (props.shape ?? 'north_south') as StraightRailShape,
               powered: props.powered === 'true' }
    case 'oak_door':
    case 'spruce_door':
    case 'birch_door':
    case 'jungle_door':
    case 'acacia_door':
    case 'dark_oak_door':
    case 'mangrove_door':
    case 'cherry_door':
    case 'bamboo_door':
    case 'crimson_door':
    case 'warped_door':
    case 'iron_door':
      // 樹種は挙動に影響しないので木/鉄の 2 種に集約する (#159)
      return {
        type: name === 'iron_door' ? 'door_iron' : 'door_wood',
        half: (props.half === 'upper' ? 'upper' : 'lower'),
        facing: (props.facing ?? 'north') as HDir,
        open: props.open === 'true', powered: props.powered === 'true',
        hinge: props.hinge === 'right' ? 'right' : 'left',
      }
    case 'oak_trapdoor':
    case 'spruce_trapdoor':
    case 'birch_trapdoor':
    case 'jungle_trapdoor':
    case 'acacia_trapdoor':
    case 'dark_oak_trapdoor':
    case 'mangrove_trapdoor':
    case 'cherry_trapdoor':
    case 'bamboo_trapdoor':
    case 'crimson_trapdoor':
    case 'warped_trapdoor':
      // 木のトラップドアは樹種を問わず挙動が同じなので 1 種に集約する (#157)
      return { type: 'trapdoor_wood', facing: (props.facing ?? 'north') as HDir,
               open: props.open === 'true', powered: props.powered === 'true' }
    case 'iron_trapdoor':
      return { type: 'trapdoor_iron', facing: (props.facing ?? 'north') as HDir,
               open: props.open === 'true', powered: props.powered === 'true' }
    case 'oak_fence_gate':
    case 'spruce_fence_gate':
    case 'birch_fence_gate':
    case 'jungle_fence_gate':
    case 'acacia_fence_gate':
    case 'dark_oak_fence_gate':
    case 'mangrove_fence_gate':
    case 'cherry_fence_gate':
    case 'bamboo_fence_gate':
    case 'crimson_fence_gate':
    case 'warped_fence_gate':
      return { type: 'fence_gate', facing: (props.facing ?? 'north') as HDir,
               open: props.open === 'true', powered: props.powered === 'true' }
    case 'copper_bulb':
    case 'exposed_copper_bulb':
    case 'weathered_copper_bulb':
    case 'oxidized_copper_bulb':
    case 'waxed_copper_bulb':
    case 'waxed_exposed_copper_bulb':
    case 'waxed_weathered_copper_bulb':
    case 'waxed_oxidized_copper_bulb':
      // 酸化 8 バリアントはレッドストーン挙動が同一なので 1 種に集約する (#155)
      return { type: 'copper_bulb', lit: props.lit === 'true', powered: props.powered === 'true' }
    case 'target':
      // OUTPUT_POWER = BlockStateProperties.POWER ('power'), 0-15
      return { type: 'target', outputPower: Number(props.power ?? '0') }
    case 'barrel':
    case 'chest':
    case 'trapped_chest':
      // コンテナ: 充填率 (signal) は blockstate に現れないため 0 で取り込む
      // [02 §6 comparator。実効 signal は BE の中身に依存する]
      return { type: 'container', signal: 0 }
    case 'hopper':
      // vanilla の facing = 送り込み方向 (down または水平) = sim と同一 (非反転)。
      // 中身は blockstate に無いため空スロットで取り込む (BE の中身)。
      return {
        type: 'hopper',
        facing: (props.facing ?? 'down') as Dir6,
        slots: emptySlots('hopper'),
        enabled: props.enabled !== 'false',
        cooldownUntil: 0,
      }
    case 'crafter':
      // orientation は "front_top" の組。sim は front だけを持つ (#163)。
      // 中身はレシピ非対応なので occupiedSlots は 0 から始め、items で上書きする
      return {
        type: 'crafter',
        facing: ((props.orientation ?? 'north_up').split('_')[0]) as Dir6,
        triggered: props.triggered === 'true',
        occupiedSlots: 0,
      }
    case 'dropper':
    case 'dispenser':
      // vanilla の facing = 出力方向 (6 方向) = sim と同一 (非反転)。
      return {
        type: name,
        facing: (props.facing ?? 'north') as Dir6,
        slots: emptySlots(name),
        triggered: props.triggered === 'true',
      }
    default: {
      // 素材ブロック (固体 / ガラス / スラブ) は nbtIO と**同じ表**で判定する (#214)。
      // 以前はここで fixture 用に個別列挙し未知は例外にしていたため、実キャプチャを
      // そのまま fixture にできなかった
      const plain = classifyPlainBlock(name, props)
      if (plain) return plain
      throw new Error(`sim が扱えないブロック: ${name}`)
    }
  }
}

/**
 * sim BlockState → 正規化 blockstate 文字列。
 * authoredState (fixture 定義の文字列) をベースに、sim が管理する
 * 動的プロパティ (power/powered/lit/locked) のみ上書きする。
 */
/** authored 文字列が sim の型と同種か (ピストン移動で型が変わった座標の検出) */
function authoredMatchesType(sim: BlockState, authoredState?: string): boolean {
  if (authoredState === undefined) return false
  try {
    const a = mcToSim(authoredState)
    return a !== null && a.type === sim.type
  } catch {
    return false
  }
}

export function simToMc(sim: BlockState | null, authoredState?: string): string {
  if (sim === null) return 'air'
  // ピストン移動などで authored の無い/型の違う座標にブロックが現れた場合は
  // sim 状態から blockstate を合成する (可動ブロックは stone 前提の規約)
  if (!authoredMatchesType(sim, authoredState)) {
    switch (sim.type) {
      case 'piston':
      case 'sticky_piston':
        return formatMcState(sim.type, { extended: String(sim.extended), facing: sim.facing })
      case 'observer':
        return formatMcState('observer', { facing: sim.facing, powered: String(sim.powered) })
      case 'piston_head':
        return formatMcState('piston_head', {
          facing: sim.facing, short: 'false', type: sim.sticky ? 'sticky' : 'normal',
        })
      case 'moving_piston':
        // payload (into) は blockstate に現れない (vanilla も BE 内)
        return formatMcState('moving_piston', { facing: sim.facing, type: sim.kind })
      case 'solid':
        // 押した先には authored が無いので合成する。canonicalize と代表名を揃える
        if (sim.immovable === true) return 'obsidian'    // #253 (そもそも動かない)
        if (sim.pushOnly === true) {                     // #255 (押されて動く先はある)
          return formatMcState('gray_glazed_terracotta', { facing: 'north' })
        }
        return 'stone'
      // 非導体フルブロックも可動 (#184)。色・素材は保持しないので代表名で合成する
      case 'glass':
        return 'glass'
      case 'slab':
        return formatMcState('smooth_stone_slab', { type: sim.half, waterlogged: 'false' })
      case 'redstone_block':
        // #51 で可動化 (ピストン移動先に authored が無い) ため合成対象に追加
        return 'redstone_block'
      case 'slime_block':
        return 'slime_block'
      case 'honey_block':
        return 'honey_block'
      case 'powered_rail':
      case 'activator_rail':
        return formatMcState(sim.type, {
          powered: String(sim.powered), shape: sim.shape, waterlogged: 'false',
        })
      case 'rail':
        // 通常レールは動力を持たないので shape だけ (#140)
        return formatMcState('rail', { shape: sim.shape, waterlogged: 'false' })
      case 'detector_rail':
        return formatMcState('detector_rail', {
          powered: String(sim.powered), shape: sim.shape, waterlogged: 'false',
        })
      case 'door_wood':
      case 'door_iron':
        return formatMcState(sim.type === 'door_iron' ? 'iron_door' : 'oak_door', {
          facing: sim.facing, half: sim.half, hinge: sim.hinge,
          open: String(sim.open), powered: String(sim.powered),
        })
      case 'trapdoor_wood':
      case 'trapdoor_iron':
        return formatMcState(sim.type === 'trapdoor_iron' ? 'iron_trapdoor' : 'oak_trapdoor', {
          facing: sim.facing, half: 'bottom', open: String(sim.open),
          powered: String(sim.powered), waterlogged: 'false',
        })
      case 'fence_gate':
        return formatMcState('oak_fence_gate', {
          facing: sim.facing, in_wall: 'false',
          open: String(sim.open), powered: String(sim.powered),
        })
      case 'copper_bulb':
        return formatMcState('copper_bulb', {
          lit: String(sim.lit), powered: String(sim.powered),
        })
      case 'target':
        return formatMcState('target', { power: String(sim.outputPower) })
      case 'hopper':
        return formatMcState('hopper', { enabled: String(sim.enabled), facing: sim.facing })
      case 'crafter':
        return formatMcState('crafter', {
          crafting: 'false', orientation: `${sim.facing}_up`, triggered: String(sim.triggered),
        })
      case 'dropper':
      case 'dispenser':
        return formatMcState(sim.type, { facing: sim.facing, triggered: String(sim.triggered) })
      case 'lamp':
        return formatMcState('redstone_lamp', { lit: String(sim.lit) })
      case 'lodestone':
        return 'lodestone'
      case 'wall':
        return formatMcState('stone_brick_wall', {
          east: sim.east, north: sim.north, south: sim.south, up: String(sim.up),
          waterlogged: String(sim.waterlogged), west: sim.west,
        })
      case 'soul_sand':
        return 'soul_sand'
      case 'water':
        return formatMcState('water', { level: String(sim.level) })
      case 'bubble_column':
        return formatMcState('bubble_column', { drag: String(sim.drag) })
      case 'decor':
        // 取り込み元の文字列をそのまま返す (判断 E: 名前を保持して描き分ける)
        return sim.name
      case 'cauldron':
        return formatMcState('water_cauldron', { level: String(sim.level) })
      case 'composter':
        return formatMcState('composter', { level: String(sim.level) })
      case 'note_block':
        return formatMcState('note_block',
          { instrument: sim.instrument, note: String(sim.note), powered: String(sim.powered) })
      case 'pressure_plate_wood':
        return formatMcState('oak_pressure_plate', { powered: String(sim.powered) })
      case 'pressure_plate_stone':
        return formatMcState('stone_pressure_plate', { powered: String(sim.powered) })
      case 'weighted_pressure_plate_light':
        return formatMcState('light_weighted_pressure_plate',
          { power: String(sim.powered ? sim.pressedPower : 0) })
      case 'weighted_pressure_plate_heavy':
        return formatMcState('heavy_weighted_pressure_plate',
          { power: String(sim.powered ? sim.pressedPower : 0) })
      case 'air':
        return 'air'
      default:
        throw new Error(`simToMc: authored (${authoredState ?? 'なし'}) と型不一致で合成不能: ${sim.type}`)
    }
  }
  const { name, props } = parseMcState(authoredState!)
  switch (sim.type) {
    case 'wire': {
      // #51 で接続形状が実行中に変わるようになったため、authored の
      // north/south/east/west を流用せず sim 状態から直列化する
      const val = (v: boolean | 'up') => v === 'up' ? 'up' : v ? 'side' : 'none'
      props.north = val(sim.connections.north)
      props.south = val(sim.connections.south)
      props.east = val(sim.connections.east)
      props.west = val(sim.connections.west)
      props.power = String(sim.power)
      break
    }
    case 'repeater':
      props.powered = String(sim.powered)
      props.locked = String(sim.locked)
      break
    case 'comparator':
      props.powered = String(sim.powered)
      break
    case 'torch':
    case 'wall_torch':
      props.lit = String(sim.lit)
      break
    case 'lever':
    case 'button_stone':
    case 'button_wood':
      props.powered = String(sim.powered)
      break
    case 'pressure_plate_wood':
    case 'pressure_plate_stone':
      props.powered = String(sim.powered)
      break
    case 'weighted_pressure_plate_light':
    case 'weighted_pressure_plate_heavy':
      props.power = String(sim.powered ? sim.pressedPower : 0)
      break
    case 'lamp':
      props.lit = String(sim.lit)
      break
    case 'cauldron':
    case 'composter':
      // level は固定 (汲む/入れる操作は sim のスコープ外。判断 D)
      props.level = String(sim.level)
      break
    case 'lectern':
      // ページは BE 側なので blockstate には出ない (has_book と facing だけ)
      props.facing = sim.facing
      props.has_book = String(sim.hasBook)
      props.powered = 'false'
      break
    case 'bubble_column':
      // drag は下のブロックで決まる (#234)
      props.drag = String(sim.drag)
      break
    case 'wall':
      // 形状は近傍で決まる (#234)。上の塀と同期する up が無遅延伝播の要
      props.north = sim.north; props.east = sim.east
      props.south = sim.south; props.west = sim.west
      props.up = String(sim.up); props.waterlogged = String(sim.waterlogged)
      break
    case 'water':
      // level は動く (水源 0 ⇄ 落下水 8)。#252
      props.level = String(sim.level)
      break
    case 'lodestone':
    case 'decor':
    case 'soul_sand':
      // 動的プロパティを持たない
      break
    case 'note_block':
      // note は tune で変わるが sim は tune しない (authored 保持)。
      // instrument は直下のブロックで動的に変わるので sim 側の値で上書きする (#231)
      props.powered = String(sim.powered)
      props.instrument = sim.instrument
      break
    case 'piston':
    case 'sticky_piston':
      // **向きも sim 側から書く** (#257)。ピストンは可動なので、
      // 別の向きのピストンがあった座標へ移動してくると authored の向きが残ってしまう
      // (エレベーターの搬器は上向きと下向きのピストンが背中合わせで昇降するため、
      //  座標だけ見ると同じ型で向きだけ違う。sim の世界は正しいのに
      //  **書き出しだけが古い向き**になり、実機と食い違って見えていた)
      props.facing = sim.facing
      props.extended = String(sim.extended)
      break
    case 'piston_head':
      // ヘッドも同じ理由で向き・粘着を sim 側から書く (#257)
      props.facing = sim.facing
      props.type = sim.sticky ? 'sticky' : 'normal'
      props.short = 'false'
      break
    case 'moving_piston':
      break // 出現/消滅が動的要素 (合成パスで処理)
    case 'redstone_block':
      break // 状態を持たない (常時通電)
    case 'target':
      props.power = String(sim.outputPower)
      break
    case 'observer':
      // オブザーバーも可動なので向きを sim 側から書く (#257)
      props.facing = sim.facing
      props.powered = String(sim.powered)
      break
    case 'powered_rail':
    case 'activator_rail':
      // shape は設置時に自動決定され実行中も張り替わり得る (rail.ts) ため
      // authored ではなく sim 状態から直列化する (wire の接続形状と同趣旨)
      props.powered = String(sim.powered)
      props.shape = sim.shape
      break
    case 'rail':
      // 通常レールは動力を持たない。shape だけ sim 状態から直列化する (#140)
      props.shape = sim.shape
      break
    case 'detector_rail':
      props.powered = String(sim.powered)
      props.shape = sim.shape
      break
    case 'door_wood':
    case 'door_iron':
    case 'trapdoor_wood':
    case 'trapdoor_iron':
    case 'fence_gate':
      // facing / half / hinge / in_wall は authored の値を保持し、動的な 2 つだけ差し替える
      props.open = String(sim.open)
      props.powered = String(sim.powered)
      break
    case 'copper_bulb':
      // authored が酸化バリアントでもプロパティだけ差し替える (名前は保持)
      props.lit = String(sim.lit)
      props.powered = String(sim.powered)
      break
    case 'container':
      break // signal/count は blockstate に現れない (authored 名 barrel/chest を保持)
    case 'hopper':
      // count は BE で blockstate に無い。enabled のみ動的に上書き
      props.enabled = String(sim.enabled)
      break
    case 'crafter':
      // orientation は authored の値を保持する。crafting はレシピ非対応で常に false
      props.triggered = String(sim.triggered)
      props.crafting = 'false'
      break
    case 'dropper':
    case 'dispenser':
      props.triggered = String(sim.triggered)
      break
    case 'solid':
      break // powered は blockstate に現れない
    case 'glass':
    case 'slab':
      break // 動的プロパティを持たない (#184)。authored の色・素材をそのまま残す
    case 'air':
      return 'air'
  }
  return formatMcState(name, props)
}
