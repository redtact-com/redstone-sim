export { CircuitEditor } from './editor.js'
export type { PlaceableType, PlaceOptions } from './editor.js'
export { EditorGrid } from './grid.js'
export type { Pos2D, EditAction } from './grid.js'
export { computeWireConnections, collectWireConnectionUpdates } from './wire-connect.js'
export type { GridPos, BlockGrid3D } from './wire-connect.js'
export { allowedFacings, isFacingAllowed, defaultFacing } from './facing.js'
export { SimSession } from './session.js'
export type { SessionOptions, SettleOutcome } from './session.js'
export { PLACEABLE_TYPES, isPlaceableType, PLACE_OPTION_RANGES, maxCount, normalizePlaceOptions } from './placeable.js'
export { decideTap, decideCellTap, nextFacing } from './tap.js'
export type { TapAction, TapOptions, TapPhase, SameTypePolicy, CellTapAction } from './tap.js'
export {
  DEFAULT_BOARD, BOARD_MIN, BOARD_MAX, normalizeBoardSize, isInsideBoard, blocksExtent, boundsWithBlocks,
} from './board.js'
export type { BoardSize, SnapshotBoundsLike } from './board.js'
export {
  translateBlocks, normalizeToOrigin, clipToBoard, countOutside, requiredBoardSize, offsetToFitBoard,
  growthProposal,
} from './transform.js'
export type { BlockMap, ClipResult } from './transform.js'
