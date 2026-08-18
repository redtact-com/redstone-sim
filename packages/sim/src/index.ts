// 型定義
export type {
  Pos3D, HDir, Dir6,
  BlockState, BlockType,
  WireState, WireConnections, WireConnectionValue,
  TorchState, WallTorchState,
  RepeaterState, ComparatorState,
  LeverState, ButtonState,
  LampState, NoteBlockState, ContainerState, HopperState, DropperState,
  StackSize, ItemStack, ContainerSlots,
  RedstoneBlockState, TargetState, SolidState,
  PressurePlateState, WeightedPressurePlateState,
  ObserverState, AirState,
  PoweredRailState, PlainRailState, PoweredRailType,
  RailShape, StraightRailShape, CurvedRailShape,
  WorldSnapshot,
  ScheduledTick,
  TickResult,
} from './types.js'

export {
  OPPOSITE,
  H_DIRS,
  ALL_DIRS,
  H_DIR_VEC,
  RAIL_SHAPES_STRAIGHT,
  RAIL_SHAPES_CURVED,
  isRailSlope,
  isCurvedRailShape,
  isStraightRailShape,
  TRIGGERABLE_TYPES,
  isTriggerableType,
} from './types.js'

// レール (#127, #138, #140)
export {
  isRail, isPoweredRail, isStraightRail, railConnections, planRailPlacement,
  findPoweredRailSignal, shouldRailBePowered, MAX_RAIL_SEARCH_DEPTH,
} from './rail.js'
export type { RailGrid, AnyRailState } from './rail.js'

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
  isContainerType, containerSlots, emptySlots, fillSignal, totalItems,
  takeOne, putOne, containerSlotsOf, canContainerAcceptItem, slotsFromCount,
  containerParticipates, effectiveContainerSignal, slotsForSignal,
} from './blocks/container.js'
export { stackSizeOf, REPRESENTATIVE_ITEM } from './blocks/itemStacks.js'
export { classifyPlainBlock, isSolidBlockName, toNonConductiveBlockState } from './blocks/blockNames.js'

// fixture 再生ドライバ (CI 回帰 fixture-runner とデモページ ?demo= の共通基盤)
export {
  buildFixtureWorld, fixtureInputsAt, applyFixtureInputsAt,
  snapshotFixtureRegion, runFixtureOnSim, FixtureRunner,
} from './fixture-driver.js'
export type {
  Fixture, FixtureInput, FixtureChange, FixtureExpectEntry,
  StateMap, FixtureRunnerOptions,
} from './fixture-driver.js'
