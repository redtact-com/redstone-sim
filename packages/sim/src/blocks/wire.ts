import type { Pos3D, HDir, WireState, RepeaterState, ComparatorState, TorchState, WallTorchState, LeverState, ButtonState } from '../types.js'
import type { SimWorld } from '../world.js'
import { H_DIRS, H_DIR_VEC, OPPOSITE } from '../types.js'
import { getTorchOutputFacing } from './torch.js'
import { getRepeaterOutputFacing } from './repeater.js'

/**
 * 指定座標のワイヤーが受け取る信号強度を計算する。
 *
 * 入力源（優先順）:
 * 1. 隣接する動力源（レバー・ボタン・トーチ・リピーター）から直接 → 15
 * 2. 接続している隣接ワイヤーの power - 1
 * 3. 上のブロックからの降下信号（動力源が真上にある場合）
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

  // 真上のブロックからの信号（ワイヤーは上から降りてくる信号も受け取る）
  const abovePos: Pos3D = [pos[0], pos[1] + 1, pos[2]]
  const above = world.getBlockAt(abovePos)
  if (above?.type === 'wire') {
    maxPower = Math.max(maxPower, (above as WireState).power - 1)
  }

  return Math.max(0, maxPower)
}
