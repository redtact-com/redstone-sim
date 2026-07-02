// 型定義
export type {
  Pos3D, HDir, Dir6,
  BlockState, BlockType,
  WireState, WireConnections, WireConnectionValue,
  TorchState, WallTorchState,
  RepeaterState, ComparatorState,
  LeverState, ButtonState,
  LampState, ContainerState, RedstoneBlockState, TargetState, SolidState,
  ObserverState, AirState,
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

// MC blockstate 文字列変換 (実機 ground truth ハーネス用)
export {
  parseMcState, formatMcState, canonicalize, mcToSim, simToMc,
} from './mcstate.js'
export type { ParsedMcState } from './mcstate.js'

// 電力クエリ (weak/strong モデル)
export {
  getSignal, getDirectSignal, getNeighborSignal,
  getStrongPower, getWireWeakCharge, getSolidPower,
  isSolidPowered, isFacePowered, isBlockPowered, isConductor,
  getTorchAttachFace, relative,
} from './power.js'

// ブロックユーティリティ
export { computeWirePower, getConnectedWireNeighbors, isWireCutBlock } from './blocks/wire.js'
export {
  getTorchOutputFacing, getTorchBasePos, isBasePowered,
  pruneToggles, RECENT_TOGGLE_TIMER, MAX_RECENT_TOGGLES, RESTART_DELAY,
} from './blocks/torch.js'
export { getRepeaterOutputFacing, isInputFaceOfRepeater, getRepeaterLockDirs } from './blocks/repeater.js'
