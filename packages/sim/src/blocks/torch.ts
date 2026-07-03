import type { Dir6, HDir, TorchState, WallTorchState } from '../types.js'
import type { SimWorld } from '../world.js'
import type { Pos3D } from '../types.js'
import { OPPOSITE } from '../types.js'
import { getTorchAttachFace, isFacePowered } from '../power.js'

// ── burnout 定数 [確定: 02 §6 torch — RedstoneTorchBlock] ──────────────
/** この gt より古い消灯記録は tick 実行時に破棄する (RECENT_TOGGLE_TIMER) */
export const RECENT_TOGGLE_TIMER = 60
/** 窓内の消灯記録がこの件数に達すると焼き切れる (MAX_RECENT_TOGGLES) */
export const MAX_RECENT_TOGGLES = 8
/** 焼き切れから復帰を試みるまでの遅延 gt (RESTART_DELAY) */
export const RESTART_DELAY = 160

/**
 * 消灯履歴から 60gt (RECENT_TOGGLE_TIMER) より古い記録を落とす。
 * vanilla は tick 冒頭で `while (now - list[0].when > 60) remove(0)` と
 * ワールド単位の共有リストを先頭から刈るが、burnout 判定は pos 単位の件数で
 * 決まるため、本 sim ではトーチ単位の履歴を同じ時間窓で刈れば等価。
 */
export function pruneToggles(toggles: readonly number[] | undefined, now: number): number[] {
  if (!toggles || toggles.length === 0) return []
  return toggles.filter(t => now - t <= RECENT_TOGGLE_TIMER)
}

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
 * トーチの土台ブロック（取り付け面）が動力を持っているか判定する。
 * 動力があるとき → トーチは消灯スケジュールを受ける。
 *
 * 実装は power.ts の isFacePowered へ委譲する (G14):
 *   - 土台が固体: 強充電またはダストによる弱充電（足元 + 接続方向のみ）で true
 *   - 土台が動力部品: トーチ側へ weak 信号を出していれば true
 */
export function isBasePowered(pos: Pos3D, world: SimWorld): boolean {
  const block = world.getBlockAt(pos)
  if (!block || (block.type !== 'torch' && block.type !== 'wall_torch')) return false
  return isFacePowered(world, pos, getTorchAttachFace(block))
}
