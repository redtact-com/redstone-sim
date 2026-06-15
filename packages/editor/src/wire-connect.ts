/**
 * ワイヤー接続形状の計算（配置・削除時のみ実行）。
 * シミュレーション実行中には呼ばれない。
 */

import type { HDir, WireConnections } from '@redstone/sim'
import { H_DIRS, H_DIR_VEC } from '@redstone/sim'
import type { EditorGrid } from './grid.js'

type Pos2D = [number, number]  // [x, z]

/**
 * 指定座標にワイヤーを配置したときの接続形状を計算する。
 * 隣接ブロックを見て、各方向の接続有無を返す。
 */
export function computeWireConnections(
  x: number,
  z: number,
  grid: EditorGrid,
): WireConnections {
  const conn: WireConnections = { north: false, south: false, east: false, west: false }
  let connCount = 0

  for (const dir of H_DIRS) {
    const [dx, dz] = H_DIR_VEC[dir]
    const nb = grid.getBlock(x + dx, z + dz)
    if (!nb) continue

    if (nb.type === 'wire') {
      conn[dir] = true
      connCount++
    } else if (nb.type === 'repeater') {
      // リピーターの前後面にのみ接続
      const opp = oppositeDir(dir)
      if (nb.facing === opp || nb.facing === dir) {
        conn[dir] = true
        connCount++
      }
    } else if (nb.type === 'comparator') {
      // コンパレーターは全4面で接続
      conn[dir] = true
      connCount++
    } else if (
      nb.type === 'lever' ||
      nb.type === 'button_stone' ||
      nb.type === 'button_wood' ||
      nb.type === 'torch'
    ) {
      // 全方向動力源は接続
      conn[dir] = true
      connCount++
    } else if (nb.type === 'wall_torch') {
      // facing = 壁方向。壁方向以外の3方向でダストと接続する
      const opp = oppositeDir(dir)
      if (opp !== nb.facing) {
        conn[dir] = true
        connCount++
      }
    }
  }

  // 接続が0本のとき: cross形状（4方向 side）
  if (connCount === 0) {
    conn.north = true
    conn.south = true
    conn.east = true
    conn.west = true
  }

  // 接続が1本のとき: 反対方向にも side を立てて直線にする
  if (connCount === 1) {
    const connDir = H_DIRS.find(d => conn[d])!
    conn[oppositeDir(connDir)] = true
  }

  return conn
}

/**
 * ワイヤーが削除されたとき、隣接ワイヤーの接続形状を再計算する。
 * 削除されたワイヤーへの接続を切り、隣接ワイヤーそれぞれの形状を返す。
 */
export function computeWireDeletionUpdates(
  x: number,
  z: number,
  grid: EditorGrid,
): Array<{ pos: Pos2D; connections: WireConnections }> {
  const updates: Array<{ pos: Pos2D; connections: WireConnections }> = []

  for (const dir of H_DIRS) {
    const [dx, dz] = H_DIR_VEC[dir]
    const nx = x + dx
    const nz = z + dz
    const nb = grid.getBlock(nx, nz)
    if (nb?.type !== 'wire') continue

    // 削除後のグリッド（仮）を使って接続を再計算
    const newConn = computeWireConnectionsExcluding(nx, nz, [x, z], grid)
    updates.push({ pos: [nx, nz], connections: newConn })
  }

  return updates
}

/**
 * 指定座標(excludeX, excludeZ)を除外してワイヤー接続を計算。
 * ワイヤー削除後の隣接ワイヤー更新に使う。
 */
function computeWireConnectionsExcluding(
  x: number,
  z: number,
  exclude: Pos2D,
  grid: EditorGrid,
): WireConnections {
  const conn: WireConnections = { north: false, south: false, east: false, west: false }
  let connCount = 0

  for (const dir of H_DIRS) {
    const [dx, dz] = H_DIR_VEC[dir]
    const nx = x + dx
    const nz = z + dz
    if (nx === exclude[0] && nz === exclude[1]) continue  // 削除対象をスキップ

    const nb = grid.getBlock(nx, nz)
    if (!nb) continue

    if (nb.type === 'wire') {
      conn[dir] = true
      connCount++
    } else if (nb.type === 'repeater') {
      const opp = oppositeDir(dir)
      if (nb.facing === opp || nb.facing === dir) {
        conn[dir] = true
        connCount++
      }
    } else if (nb.type === 'comparator') {
      conn[dir] = true
      connCount++
    } else if (
      nb.type === 'lever' ||
      nb.type === 'button_stone' ||
      nb.type === 'button_wood' ||
      nb.type === 'torch'
    ) {
      conn[dir] = true
      connCount++
    } else if (nb.type === 'wall_torch') {
      const opp = oppositeDir(dir)
      if (opp !== nb.facing) {
        conn[dir] = true
        connCount++
      }
    }
  }

  if (connCount === 0) {
    conn.north = true; conn.south = true; conn.east = true; conn.west = true
  }
  if (connCount === 1) {
    const connDir = H_DIRS.find(d => conn[d])!
    conn[oppositeDir(connDir)] = true
  }

  return conn
}

function oppositeDir(dir: HDir): HDir {
  const map: Record<HDir, HDir> = {
    north: 'south', south: 'north', east: 'west', west: 'east',
  }
  return map[dir]
}
