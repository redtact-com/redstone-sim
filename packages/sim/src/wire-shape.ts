// ============================================================
// ワイヤー接続形状の導出 (#51)。
//
// vanilla の「接続の真実」は保持 blockstate ではなく毎 query の
// getConnectionState 再計算にある (docs/research/11 §1.2 [確定: 26.2])。
// sim では「トポロジー変化点 (propagateChange / afterPistonMove /
// initialize) で保持値を本モジュールの導出値へ同期張り替え」することで
// 案 A (クエリ時導出) と等価な意味論を実現する — 全クエリは張り替え後に
// 走るため、保持値 = 導出値が常に成り立つ (PR #55 方針コメント)。
//
// 接続対象は 26.2 RedStoneWireBlock.shouldConnectTo に完全準拠:
//   - wire → true
//   - repeater → FACING が direction またはその逆 (前後面)
//   - observer → direction == FACING (= ワイヤーがオブザーバーの背面
//     = 出力側にあるときのみ接続)
//   - それ以外 → isSignalSource() (lever / button / torch / wall_torch /
//     redstone_block / target / comparator / 感圧板 4 種)
// 形状の自動拡張 (0 本→cross / 1 本→直線) と dot 保持ガード
// (wasDot && isDot(再計算) → dot 維持) も 26.2 getConnectionState と同じ。
//
// 元は packages/editor/src/wire-connect.ts にあった配置時導出を sim へ
// 一本化したもの (editor は本モジュールを再エクスポートして使う)。
// ============================================================

import type { HDir, WireConnections, WireConnectionValue, BlockState, Pos3D } from './types.js'
import { H_DIRS, H_DIR_VEC } from './types.js'
import { isWireCutBlock } from './blocks/wire.js'

/** 3D ブロック読み取りインターフェース (SimWorld / EditorGrid が実装) */
export interface BlockGrid3D {
  getBlock3(x: number, y: number, z: number): BlockState | null
}

function oppositeHDir(dir: HDir): HDir {
  const map: Record<HDir, HDir> = {
    north: 'south', south: 'north', east: 'west', west: 'east',
  }
  return map[dir]
}

/** 26.2 shouldConnectTo(blockState, direction)。dir = ワイヤー→隣接ブロックの方向 */
function shouldConnectTo(nb: BlockState, dir: HDir): boolean {
  switch (nb.type) {
    case 'wire':
      return true
    case 'repeater':
      // 前後面のみ (FACING == direction || FACING.opposite == direction)
      return nb.facing === dir || nb.facing === oppositeHDir(dir)
    case 'observer':
      // direction == FACING = ワイヤーがオブザーバーの背面 (出力側) にある
      return nb.facing === dir
    // 以下 isSignalSource() 群。wall_torch は vanilla に壁面の除外規則が無い
    // (isSignalSource で全 4 面接続。実機では壁面セルは支持ブロックで埋まる
    //  ため観測不能だが、支持要件の無い sim でも vanilla の規則に従う)
    case 'lever':
    case 'button_stone':
    case 'button_wood':
    case 'torch':
    case 'wall_torch':
    case 'comparator':
    case 'redstone_block':
    case 'target':
    case 'pressure_plate_wood':
    case 'pressure_plate_stone':
    case 'weighted_pressure_plate_light':
    case 'weighted_pressure_plate_heavy':
      return true
    default:
      return false
  }
}

/**
 * 隣接ブロックだけから決まる「生の」接続形状 (26.2 getMissingConnections 相当)。
 * 自動拡張は行わない — 全方向 false は「物理接続なし」を表す。
 * 各方向の値: false=なし / true=side (同レイヤー・下りステップ) / 'up'=上りステップ
 */
export function computeRawWireConnections(
  x: number,
  y: number,
  z: number,
  grid: BlockGrid3D,
): WireConnections {
  const conn: WireConnections = { north: false, south: false, east: false, west: false }
  const aboveSelfOpen = !isWireCutBlock(grid.getBlock3(x, y + 1, z))

  for (const dir of H_DIRS) {
    const [dx, dz] = H_DIR_VEC[dir]
    const nb = grid.getBlock3(x + dx, y, z + dz)
    let v: WireConnectionValue = false

    if (nb && shouldConnectTo(nb, dir)) v = true

    // 上りステップ: 自分の直上が開いていて、隣の 1 段上にワイヤー
    if (!v && aboveSelfOpen && grid.getBlock3(x + dx, y + 1, z + dz)?.type === 'wire') {
      v = 'up'
    }

    // 下りステップ: 隣のセルが不透過 (導体) でなく、その 1 段下にワイヤー (表示は side)
    if (!v && !isWireCutBlock(nb) && grid.getBlock3(x + dx, y - 1, z + dz)?.type === 'wire') {
      v = true
    }

    conn[dir] = v
  }

  return conn
}

/** 全方向 false (= dot / 物理接続なし) か */
export function isDotConnections(conn: WireConnections): boolean {
  return !conn.north && !conn.south && !conn.east && !conn.west
}

/**
 * ワイヤーの接続形状を現在のグリッド状態から導出する (26.2 getConnectionState 相当)。
 * - dot 保持ガード: prev が dot (全 false) かつ再計算後も物理接続 0 本なら dot を維持
 *   [確定: 26.2 — wasDot && isDot(getMissingConnections) で拡張スキップ]
 * - 自動拡張: 物理接続 0 本→cross (4 方向 side) / 1 本→反対側も side (直線)
 * prev を省略した場合 (新規配置) はガード無しで拡張する = 孤立ダストは cross。
 */
export function deriveWireConnections(
  x: number,
  y: number,
  z: number,
  grid: BlockGrid3D,
  prev?: WireConnections,
): WireConnections {
  const conn = computeRawWireConnections(x, y, z, grid)

  if (prev && isDotConnections(prev) && isDotConnections(conn)) {
    return conn  // dot 維持
  }

  const connCount = H_DIRS.filter(d => conn[d]).length
  if (connCount === 0) {
    conn.north = true
    conn.south = true
    conn.east = true
    conn.west = true
  }
  if (connCount === 1) {
    const connDir = H_DIRS.find(d => conn[d])!
    if (!conn[oppositeHDir(connDir)]) conn[oppositeHDir(connDir)] = true
  }

  return conn
}

/**
 * (x, y, z) のブロック変化で接続形状の再導出が必要になり得る周辺ワイヤー座標。
 * 対象 = 自身・水平 4 近傍 (±1 レイヤー含む)・直上直下
 * (上下斜め接続のカット判定・ステップ相手が変わり得る範囲)。
 */
export function wireShapeCandidates(pos: Pos3D): Pos3D[] {
  const [x, y, z] = pos
  const out: Pos3D[] = [[x, y, z], [x, y - 1, z], [x, y + 1, z]]
  for (const dir of H_DIRS) {
    const [dx, dz] = H_DIR_VEC[dir]
    for (const dy of [-1, 0, 1]) out.push([x + dx, y + dy, z + dz])
  }
  return out
}

/** 2 つの接続形状が同値か */
export function sameConnections(a: WireConnections, b: WireConnections): boolean {
  return a.north === b.north && a.south === b.south && a.east === b.east && a.west === b.west
}

/** 接続の有無 (isConnected) が全方向で一致するか (side/up の形の違いは無視) */
export function sameConnectivity(a: WireConnections, b: WireConnections): boolean {
  return H_DIRS.every(d => !!a[d] === !!b[d])
}

/** 全 4 方向が接続 (cross) か */
export function isCrossConnections(c: WireConnections): boolean {
  return !!c.north && !!c.south && !!c.east && !!c.west
}

/**
 * 近傍変化を受けた「保持値」の更新規則 (26.2 RedStoneWireBlock.updateShape 相当)。
 * vanilla は保持 blockstate を自動拡張の対象にしない (拡張は getConnectionState =
 * query 側のみ) ため、保持値の更新は次の 3 通りに分かれる:
 *   1. dot ガード: 保持が dot かつ生接続も 0 本 → 保持のまま (dot 維持)
 *   2. 接続の有無が全方向で不変 かつ cross でない → 形 (side/up) だけ生値へ
 *      追随し、接続していない方向の保持値は触らない (per-side 更新)
 *   3. 接続の有無が変わった or cross → 全再計算 + 自動拡張 (getConnectionState)
 * 実機 dump との一致検証: authored の「拡張されていない」保持値 (例: 片側 side
 * のみ) は近傍が変わらない限り実機でもそのまま残る — fixture 比較はこの規則で
 * 初めて一致する (#51)。
 */
export function refreshWireShape(
  x: number,
  y: number,
  z: number,
  grid: BlockGrid3D,
  stored: WireConnections,
): WireConnections {
  const raw = computeRawWireConnections(x, y, z, grid)

  // 1. dot ガード
  if (isDotConnections(stored) && isDotConnections(raw)) return stored

  // 2. 接続有無が不変 (cross を除く) → 形のみ per-side 追随
  if (sameConnectivity(stored, raw) && !isCrossConnections(stored)) {
    const next: WireConnections = { ...stored }
    for (const d of H_DIRS) {
      if (raw[d]) next[d] = raw[d]   // side ↔ up の形を生値に合わせる
    }
    return next
  }

  // 3. 全再計算 + 自動拡張 (vanilla は crossState シードで dot ガード無し)
  return deriveWireConnections(x, y, z, grid)
}
