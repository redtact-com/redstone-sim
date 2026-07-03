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
//     (getInputSignal が pos.relative(FACING) を読む)。
//     sim の facing は「出力方向」なので相互に OPPOSITE 変換する。
//   - MC の redstone_wall_torch の facing は「壁から離れる方向」。
//     sim の wall_torch facing は「壁の方向」なので OPPOSITE 変換する。
// ============================================================

import type { BlockState, HDir, Dir6, WireConnectionValue } from './types.js'
import { OPPOSITE } from './types.js'

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
      // 木/石 感圧板。POWERED ? 15 : 0 [確定: 26.2 PressurePlateBlock]
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
      // instrument は sim で保持しない (発音は BE フックで通知するのみ)。
      // note (0-24) と powered のみ取り込む [確定: 26.2 NoteBlock]
      return { type: 'note_block', powered: props.powered === 'true', note: Number(props.note ?? '0') }
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
      // count (内容) は blockstate に無いため 0 で取り込む (BE の中身)。
      return {
        type: 'hopper',
        facing: (props.facing ?? 'down') as Dir6,
        count: 0,
        enabled: props.enabled !== 'false',
        cooldownUntil: 0,
      }
    case 'dropper':
      // vanilla の facing = 出力方向 (6 方向) = sim と同一 (非反転)。
      return {
        type: 'dropper',
        facing: (props.facing ?? 'north') as Dir6,
        count: 0,
        triggered: props.triggered === 'true',
      }
    case 'stone':
    case 'smooth_stone':
    case 'cobblestone':
      return { type: 'solid', powered: false }
    default:
      throw new Error(`sim が扱えないブロック: ${name}`)
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
        return 'stone'
      case 'redstone_block':
        // #51 で可動化 (ピストン移動先に authored が無い) ため合成対象に追加
        return 'redstone_block'
      case 'target':
        return formatMcState('target', { power: String(sim.outputPower) })
      case 'hopper':
        return formatMcState('hopper', { enabled: String(sim.enabled), facing: sim.facing })
      case 'dropper':
        return formatMcState('dropper', { facing: sim.facing, triggered: String(sim.triggered) })
      case 'lamp':
        return formatMcState('redstone_lamp', { lit: String(sim.lit) })
      case 'note_block':
        // instrument は authored に無いため harp 既定で合成する (発音音色は sim 無関係)
        return formatMcState('note_block',
          { instrument: 'harp', note: String(sim.note), powered: String(sim.powered) })
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
    case 'note_block':
      // 動的プロパティは powered のみ (note は tune で変わるが sim は tune しない)。
      // authored の instrument/note は保持する
      props.powered = String(sim.powered)
      break
    case 'piston':
    case 'sticky_piston':
      props.extended = String(sim.extended)
      break
    case 'piston_head':
    case 'moving_piston':
      break // 出現/消滅が動的要素 (合成パスで処理)
    case 'redstone_block':
      break // 状態を持たない (常時通電)
    case 'target':
      props.power = String(sim.outputPower)
      break
    case 'observer':
      props.powered = String(sim.powered)
      break
    case 'container':
      break // signal/count は blockstate に現れない (authored 名 barrel/chest を保持)
    case 'hopper':
      // count は BE で blockstate に無い。enabled のみ動的に上書き
      props.enabled = String(sim.enabled)
      break
    case 'dropper':
      props.triggered = String(sim.triggered)
      break
    case 'solid':
      break // powered は blockstate に現れない
    case 'air':
      return 'air'
  }
  return formatMcState(name, props)
}
