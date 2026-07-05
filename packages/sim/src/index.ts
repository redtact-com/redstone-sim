// 型定義
export type {
  Pos3D, HDir, Dir6,
  BlockState, BlockType,
  WireState, WireConnections, WireConnectionValue,
  TorchState, WallTorchState,
  RepeaterState, ComparatorState,
  LeverState, ButtonState,
  LampState, NoteBlockState, ContainerState, HopperState, DropperState,
  RedstoneBlockState, TargetState, SolidState,
  PressurePlateState, WeightedPressurePlateState,
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
export type { NotePlayEvent } from './world.js'

// トレース (I10 #18。記法は docs/research/08)
export {
  Tracer, formatTraceEvent, abbrOf, pendingAction, elemDelay,
} from './trace.js'
export type { TraceEvent, TraceOptions, TracePhase, TraceAction } from './trace.js'

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
  computeRawWireConnections, deriveWireConnections, isDotConnections,
  wireShapeCandidates, sameConnections,
} from './wire-shape.js'
export type { BlockGrid3D } from './wire-shape.js'
export {
  getTorchOutputFacing, getTorchBasePos, isBasePowered,
  pruneToggles, RECENT_TOGGLE_TIMER, MAX_RECENT_TOGGLES, RESTART_DELAY,
} from './blocks/torch.js'
export { getRepeaterOutputFacing, isInputFaceOfRepeater, getRepeaterLockDirs } from './blocks/repeater.js'
export {
  HOPPER_COOLDOWN, DROPPER_TICK_DELAY, STACK_SIZE,
  HOPPER_SLOTS, DROPPER_SLOTS, CONTAINER_SLOTS,
  isContainerType, containerSlots, containerCapacity, fillSignal,
  containerCount, containerParticipates, canContainerAccept, effectiveContainerSignal,
} from './blocks/container.js'

// fixture 再生ドライバ (CI 回帰 fixture-runner とデモページ ?demo= の共通基盤)
export {
  buildFixtureWorld, fixtureInputsAt, applyFixtureInputsAt,
  snapshotFixtureRegion, runFixtureOnSim, FixtureRunner,
} from './fixture-driver.js'
export type {
  Fixture, FixtureInput, FixtureChange, FixtureExpectEntry,
  StateMap, FixtureRunnerOptions,
} from './fixture-driver.js'
