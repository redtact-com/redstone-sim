import type { Pos3D, HDir, BlockState, WireState, RepeaterState, ComparatorState, TorchState, WallTorchState, LeverState, ButtonState } from '../types.js'
import type { SimWorld } from '../world.js'
import { H_DIRS, H_DIR_VEC, ALL_DIRS, OPPOSITE } from '../types.js'
import { getTorchOutputFacing } from './torch.js'
import { getRepeaterOutputFacing } from './repeater.js'

/**
 * ワイヤーの上下斜め接続をカットする（不透過扱いの）ブロックか。
 * 上りステップは「自分の直上」、下りステップは「下側ワイヤーの直上（=横のセル）」に
 * このブロックがあると切断される。
 */
export function isWireCutBlock(block: BlockState | null): boolean {
  return !!block && (block.type === 'solid' || block.type === 'lamp')
}

/**
 * 指定座標のワイヤーと信号をやり取りできる隣接ワイヤー座標の一覧を返す。
 * - 同レイヤー: connections が立っている方向のワイヤー
 * - 上りステップ: 直上が不透過でないとき、水平隣の1段上のワイヤー
 * - 下りステップ: 水平隣のセルが不透過でないとき、その1段下のワイヤー
 *
 * 直上・直下のワイヤーは vanilla では発生しない配置（支持要件で不可能）のため
 * 接続しない。上り/下りのカット判定は同じセル（下側ワイヤーの直上）を見るため
 * 対称になり、BFS の連結成分収集にそのまま使える。
 */
export function getConnectedWireNeighbors(pos: Pos3D, world: SimWorld): Pos3D[] {
  const block = world.getBlockAt(pos)
  if (!block || block.type !== 'wire') return []
  const wire = block as WireState
  const [x, y, z] = pos
  const result: Pos3D[] = []

  const aboveSelfOpen = !isWireCutBlock(world.getBlockAt([x, y + 1, z]))

  for (const dir of H_DIRS) {
    const [dx, dz] = H_DIR_VEC[dir]
    const sidePos: Pos3D = [x + dx, y, z + dz]
    const side = world.getBlockAt(sidePos)

    // 同レイヤー（接続方向のみ）
    if (wire.connections[dir] && side?.type === 'wire') {
      result.push(sidePos)
    }

    // 上りステップ: 直上が開いている場合のみ
    if (aboveSelfOpen) {
      const upPos: Pos3D = [x + dx, y + 1, z + dz]
      if (world.getBlockAt(upPos)?.type === 'wire') result.push(upPos)
    }

    // 下りステップ: 横のセル（=下側ワイヤーの直上）が開いている場合のみ
    if (!isWireCutBlock(side)) {
      const downPos: Pos3D = [x + dx, y - 1, z + dz]
      if (world.getBlockAt(downPos)?.type === 'wire') result.push(downPos)
    }
  }

  return result
}

/**
 * 指定座標のワイヤーが受け取る信号強度を計算する。
 *
 * 入力源（優先順）:
 * 1. 隣接する動力源（レバー・ボタン・トーチ・リピーター）から直接 → 15
 * 2. 強充電された隣接固体ブロック → 15
 * 3. 接続している隣接ワイヤー（同レイヤー・上り/下りステップ・直上直下）の power - 1
 */
export function computeWirePower(pos: Pos3D, world: SimWorld): number {
  const block = world.getBlockAt(pos)
  if (!block || block.type !== 'wire') return 0
  const wire = block as WireState

  let maxPower = 0

  // 水平方向の信号源を確認
  // ワイヤー同士は接続方向のみ伝播、非ワイヤー信号源は接続なしでも隣接していれば伝達
  for (const dir of H_DIRS) {
    const [dx, dz] = H_DIR_VEC[dir]
    const nPos: Pos3D = [pos[0] + dx, pos[1], pos[2] + dz]
    const src = world.getBlockAt(nPos)
    if (!src) continue

    switch (src.type) {
      case 'wire':
        // ワイヤー間は接続方向のみ
        if (!wire.connections[dir]) break
        maxPower = Math.max(maxPower, (src as WireState).power - 1)
        break
      case 'lever':
      case 'button_stone':
      case 'button_wood':
        if ((src as LeverState | ButtonState).powered) maxPower = 15
        break
      case 'torch': {
        const t = src as TorchState
        if (t.lit && getTorchOutputFacing(t) === (OPPOSITE[dir] as HDir)) {
          maxPower = 15
        }
        break
      }
      case 'wall_torch': {
        const t = src as WallTorchState
        // 壁方向（t.facing）以外の3方向に信号を伝える
        if (t.lit && (OPPOSITE[dir] as HDir) !== t.facing) {
          maxPower = 15
        }
        break
      }
      case 'repeater': {
        const r = src as RepeaterState
        if (r.powered && getRepeaterOutputFacing(r) === OPPOSITE[dir]) {
          maxPower = 15
        }
        break
      }
      case 'comparator': {
        const c = src as ComparatorState
        if (c.powered && c.outputPower > 0 && c.facing === (OPPOSITE[dir] as HDir)) {
          maxPower = Math.max(maxPower, c.outputPower)
        }
        break
      }
    }
  }

  // 強充電された隣接固体ブロック（真下含む6方向）から受電
  for (const dir of ALL_DIRS) {
    if (maxPower >= 15) break
    const [x, y, z] = pos
    const nPos: Pos3D =
      dir === 'up'   ? [x, y + 1, z] :
      dir === 'down' ? [x, y - 1, z] :
      [x + H_DIR_VEC[dir as HDir][0], y, z + H_DIR_VEC[dir as HDir][1]]
    const src = world.getBlockAt(nPos)
    if (src?.type === 'solid' && src.powered) maxPower = 15
  }

  // 垂直方向（上り/下りステップ）のワイヤーから減衰伝播
  for (const nPos of getConnectedWireNeighbors(pos, world)) {
    if (nPos[1] === pos[1]) continue  // 同レイヤーは上の switch で処理済み
    const src = world.getBlockAt(nPos)
    if (src?.type === 'wire') {
      maxPower = Math.max(maxPower, (src as WireState).power - 1)
    }
  }

  return Math.max(0, maxPower)
}
