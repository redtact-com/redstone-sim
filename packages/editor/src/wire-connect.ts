/**
 * ワイヤー接続形状の計算（配置・削除時のみ実行）。
 * シミュレーション実行中には呼ばれない。
 *
 * 3D 対応: 同レイヤー接続に加え、上りステップ ('up') と下りステップ (side) を
 * 判定する。上下斜めの接続は間のセルが不透過ブロック (solid/lamp) だと切れる。
 */

import type { HDir, WireConnections, WireConnectionValue, BlockState } from '@redstone/sim'
import { H_DIRS, H_DIR_VEC } from '@redstone/sim'

export type GridPos = [number, number, number]  // [x, y, z]

/** 3D ブロック読み取りインターフェース（EditorGrid が実装） */
export interface BlockGrid3D {
  getBlock3(x: number, y: number, z: number): BlockState | null
}

/** ワイヤーの上下斜め接続をカットする不透過ブロックか（sim 側 isWireCutBlock と同義） */
function isCutBlock(b: BlockState | null): boolean {
  return !!b && (b.type === 'solid' || b.type === 'lamp')
}

/**
 * 指定座標にあるワイヤーの接続形状を現在のグリッド状態から計算する。
 * 各方向の値: false=なし / true=side（同レイヤー・下りステップ） / 'up'=上りステップ
 */
export function computeWireConnections(
  x: number,
  y: number,
  z: number,
  grid: BlockGrid3D,
): WireConnections {
  const conn: WireConnections = { north: false, south: false, east: false, west: false }
  let connCount = 0
  const aboveSelfOpen = !isCutBlock(grid.getBlock3(x, y + 1, z))

  for (const dir of H_DIRS) {
    const [dx, dz] = H_DIR_VEC[dir]
    const nb = grid.getBlock3(x + dx, y, z + dz)
    let v: WireConnectionValue = false

    if (nb) {
      if (nb.type === 'wire') {
        v = true
      } else if (nb.type === 'repeater') {
        // リピーターの前後面にのみ接続
        const opp = oppositeDir(dir)
        if (nb.facing === opp || nb.facing === dir) v = true
      } else if (nb.type === 'comparator') {
        // コンパレーターは全4面で接続
        v = true
      } else if (
        nb.type === 'lever' ||
        nb.type === 'button_stone' ||
        nb.type === 'button_wood' ||
        nb.type === 'torch'
      ) {
        // 全方向動力源は接続
        v = true
      } else if (nb.type === 'wall_torch') {
        // facing = 壁方向。壁方向以外の3方向でダストと接続する
        if (oppositeDir(dir) !== nb.facing) v = true
      }
    }

    // 上りステップ: 自分の直上が開いていて、隣の1段上にワイヤー
    if (!v && aboveSelfOpen && grid.getBlock3(x + dx, y + 1, z + dz)?.type === 'wire') {
      v = 'up'
    }

    // 下りステップ: 隣のセルが不透過でなく、その1段下にワイヤー（表示は side）
    if (!v && !isCutBlock(nb) && grid.getBlock3(x + dx, y - 1, z + dz)?.type === 'wire') {
      v = true
    }

    conn[dir] = v
    if (v) connCount++
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
    if (!conn[oppositeDir(connDir)]) conn[oppositeDir(connDir)] = true
  }

  return conn
}

/**
 * (x, y, z) のブロックが変化した後に、接続形状の再計算が必要な周辺ワイヤーの
 * 更新一覧を返す。対象は同レイヤーの水平4近傍・その上下レイヤー・直上直下
 * （上下斜め接続のカット判定が変わり得る範囲）。
 */
export function collectWireConnectionUpdates(
  x: number,
  y: number,
  z: number,
  grid: BlockGrid3D,
): Array<{ pos: GridPos; connections: WireConnections }> {
  const updates: Array<{ pos: GridPos; connections: WireConnections }> = []

  const offsets: GridPos[] = [[0, -1, 0], [0, 1, 0]]
  for (const dir of H_DIRS) {
    const [dx, dz] = H_DIR_VEC[dir]
    for (const dy of [-1, 0, 1]) offsets.push([dx, dy, dz])
  }

  for (const [dx, dy, dz] of offsets) {
    const nx = x + dx
    const ny = y + dy
    const nz = z + dz
    const nb = grid.getBlock3(nx, ny, nz)
    if (nb?.type !== 'wire') continue
    updates.push({ pos: [nx, ny, nz], connections: computeWireConnections(nx, ny, nz, grid) })
  }

  return updates
}

function oppositeDir(dir: HDir): HDir {
  const map: Record<HDir, HDir> = {
    north: 'south', south: 'north', east: 'west', west: 'east',
  }
  return map[dir]
}
