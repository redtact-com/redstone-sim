import type { HDir, RepeaterState } from '../types.js'
import { OPPOSITE } from '../types.js'

/**
 * リピーターが信号を出力する方向 = facing 方向
 */
export function getRepeaterOutputFacing(block: RepeaterState): HDir {
  return block.facing
}

/**
 * リピーターが信号を入力として受け付ける面かどうか。
 * リピーターは後面（facing の逆）からのみ入力を受け付ける。
 */
export function isInputFaceOfRepeater(block: RepeaterState, fromDir: HDir): boolean {
  return fromDir === OPPOSITE[block.facing]
}

/**
 * リピーターがロックされるかどうか。
 * 左右面（facing に対して90度）から別のリピーターが出力しているとき lock される。
 * （今回 BUD・準接続は実装しないが、lock は通常動作なので実装する）
 */
export function getRepeaterLockDirs(block: RepeaterState): [HDir, HDir] {
  switch (block.facing) {
    case 'north': return ['east', 'west']
    case 'south': return ['east', 'west']
    case 'east':  return ['north', 'south']
    case 'west':  return ['north', 'south']
  }
}
