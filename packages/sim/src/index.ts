// 型定義
export type {
  Pos3D, HDir, Dir6,
  BlockState, BlockType,
  WireState, WireConnections,
  TorchState, WallTorchState,
  RepeaterState, ComparatorState,
  LeverState, ButtonState,
  LampState, SolidState, AirState,
  WorldSnapshot,
  ScheduledTick,
  TickResult,
} from './types.js'

export {
  OPPOSITE,
  H_DIRS,
  ALL_DIRS,
  H_DIR_VEC,
} from './types.js'

// World
export { SimWorld, posKey, keyToPos } from './world.js'

// ブロックユーティリティ
export { computeWirePower } from './blocks/wire.js'
export { getTorchOutputFacing, getTorchBasePos, isBasePowered } from './blocks/torch.js'
export { getRepeaterOutputFacing, isInputFaceOfRepeater, getRepeaterLockDirs } from './blocks/repeater.js'
