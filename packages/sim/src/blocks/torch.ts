import type { Dir6, HDir, TorchState, WallTorchState, WireState } from '../types.js'
import type { SimWorld } from '../world.js'
import type { Pos3D } from '../types.js'
import { OPPOSITE } from '../types.js'

/**
 * トーチが信号を出力する方向を返す。
 * - 床置きトーチ (facing=up): 上方向 'up' に出力
 * - wall_torch: facing = 土台の方向（取り付いているブロックの方向）
 *   出力は facing の逆方向。例: facing='south'（土台が南） → 北向きに出力
 */
export function getTorchOutputFacing(block: TorchState | WallTorchState): Dir6 {
  if (block.type === 'torch') {
    return block.facing === 'down' ? 'down' : 'up'
  }
  // wall_torch: 出力方向 = facing の逆（土台の逆方向）
  return OPPOSITE[block.facing] as Dir6
}

/**
 * トーチの「土台ブロック」の座標を返す。
 * 土台が充電されるとトーチは消灯する。
 * - 床置きトーチ: 真下のブロック
 * - wall_torch: facing 方向にあるブロック（facing=south なら南 = 土台）
 */
export function getTorchBasePos(pos: Pos3D, block: TorchState | WallTorchState): Pos3D {
  const [x, y, z] = pos
  if (block.type === 'torch') {
    return [x, y - 1, z]
  }
  // wall_torch: 土台は facing 方向のブロック
  const baseDir = block.facing as HDir
  const dirs: Record<HDir, [number, number, number]> = {
    north: [x, y, z - 1],
    south: [x, y, z + 1],
    east:  [x + 1, y, z],
    west:  [x - 1, y, z],
  }
  return dirs[baseDir]
}

/**
 * トーチの土台ブロックが動力を持っているか判定する。
 * 動力があるとき → トーチは消灯スケジュールを受ける。
 *
 * 固体ブロックが土台の場合:
 *   - 強充電（レバー・リピーターなど直接出力）: solid.powered = true
 *   - 弱充電（ワイヤーが隣接）: 隣接ワイヤーの power > 0
 *     ※ ワイヤーは固体ブロックを「弱充電」し、その固体の上にあるトーチを消灯できる
 */
export function isBasePowered(pos: Pos3D, world: SimWorld): boolean {
  const block = world.getBlockAt(pos)
  if (!block || (block.type !== 'torch' && block.type !== 'wall_torch')) return false
  const basePos = getTorchBasePos(pos, block)
  const base = world.getBlockAt(basePos)
  if (!base) return false

  if (base.type === 'solid') {
    // 強充電
    if (base.powered) return true
    // 弱充電: 固体ブロックに隣接するワイヤーに電力があるか
    const [bx, by, bz] = basePos
    const adjacent: Pos3D[] = [
      [bx + 1, by, bz], [bx - 1, by, bz],
      [bx, by + 1, bz], [bx, by - 1, bz],
      [bx, by, bz + 1], [bx, by, bz - 1],
    ]
    for (const nPos of adjacent) {
      const n = world.getBlockAt(nPos)
      if (n?.type === 'wire' && (n as WireState).power > 0) return true
    }
    return false
  }
  if (base.type === 'lever' || base.type === 'button_stone' || base.type === 'button_wood') {
    return (base as { powered: boolean }).powered
  }
  return false
}
