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

import type { BlockState, HDir, WireConnectionValue } from './types.js'
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

const WIRE_DIRS: HDir[] = ['north', 'south', 'east', 'west']

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
    case 'redstone_lamp':
      return { type: 'lamp', lit: props.lit === 'true' }
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
export function simToMc(sim: BlockState | null, authoredState: string): string {
  const { name, props } = parseMcState(authoredState)
  if (sim === null) return 'air'
  switch (sim.type) {
    case 'wire':
      props.power = String(sim.power)
      break
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
    case 'lamp':
      props.lit = String(sim.lit)
      break
    case 'solid':
      break // powered は blockstate に現れない
    case 'air':
      return 'air'
  }
  return formatMcState(name, props)
}
