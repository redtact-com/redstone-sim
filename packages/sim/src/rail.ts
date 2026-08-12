import type { Pos3D, RailShape, BlockState, PoweredRailState } from './types.js'
import type { SimWorld } from './world.js'
import { isBlockPowered } from './power.js'

// ============================================================
// レール (#127)
//
// 26.2 の RailState (形状の自動接続) と PoweredRailBlock.findPoweredRailSignal
// (動力の連鎖伝播) の移植。対象は powered_rail のみで、通常レールの曲線 4 形状は
// 扱わない (isStraight=true 固定なので vanilla の curved 分岐は落としてある)。
//
// 支持ブロック要件 (canSurvive / shouldBeRemoved) は**実装しない**。sim 全体が
// 支持要件を持たない方針 (wire-shape.ts §「支持要件の無い sim でも」) で、
// レールだけ落下破壊を入れると「レバーは浮くのにレールは落ちる」不整合になるため。
// レッドストーン挙動には影響しない (#127 のコメント参照)。
// ============================================================

/** 探索の打ち切り深度 [確定: 26.2 PoweredRailBlock.findPoweredRailSignal — searchDepth >= 8] */
export const MAX_RAIL_SEARCH_DEPTH = 8

const north = (p: Pos3D): Pos3D => [p[0], p[1], p[2] - 1]
const south = (p: Pos3D): Pos3D => [p[0], p[1], p[2] + 1]
const west  = (p: Pos3D): Pos3D => [p[0] - 1, p[1], p[2]]
const east  = (p: Pos3D): Pos3D => [p[0] + 1, p[1], p[2]]
const above = (p: Pos3D): Pos3D => [p[0], p[1] + 1, p[2]]
const below = (p: Pos3D): Pos3D => [p[0], p[1] - 1, p[2]]

const sameColumn = (a: Pos3D, b: Pos3D): boolean => a[0] === b[0] && a[2] === b[2]

/** レール系ブロックか [確定: 26.2 BaseRailBlock.isRail]。sim では powered_rail のみ */
export function isRail(block: BlockState | null): block is PoweredRailState {
  return !!block && block.type === 'powered_rail'
}

/**
 * shape が繋がる 2 マス [確定: 26.2 RailState.updateConnections]。
 * 坂は「登った先」が 1 段上になる。
 */
export function railConnections(pos: Pos3D, shape: RailShape): [Pos3D, Pos3D] {
  switch (shape) {
    case 'north_south':      return [north(pos), south(pos)]
    case 'east_west':        return [west(pos), east(pos)]
    case 'ascending_east':   return [west(pos), above(east(pos))]
    case 'ascending_west':   return [above(west(pos)), east(pos)]
    case 'ascending_north':  return [above(north(pos)), south(pos)]
    case 'ascending_south':  return [north(pos), above(south(pos))]
  }
}

/**
 * 形状計算が読み書きする最小のグリッド。SimWorld も EditorGrid も満たすので
 * 「sim の初期化」と「エディタでの設置」の両方から同じロジックを呼べる。
 */
export interface RailGrid {
  getBlock3(x: number, y: number, z: number): BlockState | null
}

/**
 * 形状計算中の書き換えを溜める作業領域。vanilla の RailState は place/connectTo で
 * level を直接書き換えるが、ここでは変更を pending に積み、呼び出し側が
 * それぞれの方法 (SimWorld.setBlockAt / EditorGrid.placeBlock3) で適用する。
 * 計算途中の読み取りは pending を優先するので vanilla と同じ逐次的な見え方になる。
 */
class RailWorkspace {
  private pending = new Map<string, RailShape>()
  private readonly grid: RailGrid

  constructor(grid: RailGrid) {
    this.grid = grid
  }

  get(pos: Pos3D): PoweredRailState | null {
    const b = this.grid.getBlock3(pos[0], pos[1], pos[2])
    if (!isRail(b)) return null
    const shape = this.pending.get(`${pos[0]},${pos[1]},${pos[2]}`)
    return shape === undefined ? b : { ...b, shape }
  }

  set(pos: Pos3D, shape: RailShape): void {
    this.pending.set(`${pos[0]},${pos[1]},${pos[2]}`, shape)
  }

  isRailAt(pos: Pos3D): boolean {
    return this.get(pos) !== null
  }

  changes(): { pos: Pos3D; shape: RailShape }[] {
    return [...this.pending].map(([key, shape]) => {
      const [x, y, z] = key.split(',').map(Number)
      return { pos: [x, y, z] as Pos3D, shape }
    })
  }
}

/**
 * 26.2 RailState の移植 (isStraight=true 固定なので curved 分岐は落としてある)。
 */
class RailConnector {
  private connections: Pos3D[]
  private readonly ws: RailWorkspace
  readonly pos: Pos3D
  private shape: RailShape

  constructor(ws: RailWorkspace, pos: Pos3D, shape: RailShape) {
    this.ws = ws
    this.pos = pos
    this.shape = shape
    this.connections = [...railConnections(pos, shape)]
  }

  getShape(): RailShape { return this.shape }

  /** [確定: 26.2 RailState.getRail — 同じ高さ → 1 段上 → 1 段下 の順に探す] */
  private getRail(pos: Pos3D): RailConnector | null {
    for (const p of [pos, above(pos), below(pos)]) {
      const b = this.ws.get(p)
      if (b) return new RailConnector(this.ws, p, b.shape)
    }
    return null
  }

  /** [確定: 26.2 RailState.hasConnection — 高さは無視し x/z のみ一致を見る] */
  private hasConnection(railPos: Pos3D): boolean {
    return this.connections.some(c => sameColumn(c, railPos))
  }

  private connectsTo(rail: RailConnector): boolean {
    return this.hasConnection(rail.pos)
  }

  /** [確定: 26.2 RailState.removeSoftConnections] */
  private removeSoftConnections(): void {
    for (let i = 0; i < this.connections.length; i++) {
      const rail = this.getRail(this.connections[i])
      if (rail && rail.connectsTo(this)) {
        this.connections[i] = rail.pos
      } else {
        this.connections.splice(i--, 1)
      }
    }
  }

  /** [確定: 26.2 RailState.canConnectTo] */
  private canConnectTo(rail: RailConnector): boolean {
    return this.connectsTo(rail) || this.connections.length !== 2
  }

  /** [確定: 26.2 RailState.connectTo] — 相手を接続先に加えて自分の形状を張り替える */
  private connectTo(rail: RailConnector): void {
    this.connections.push(rail.pos)
    const shape = this.decideShape(
      this.hasConnection(north(this.pos)), this.hasConnection(south(this.pos)),
      this.hasConnection(west(this.pos)),  this.hasConnection(east(this.pos)),
      null,
    )
    this.applyShape(shape ?? 'north_south')
  }

  /**
   * 接続の有無から形状を決める共通部分。曲線は straight レールでは選ばれないため
   * vanilla の !isStraight 分岐は落としてある。fallback は連結が交差する場合のみ使う。
   */
  private decideShape(
    n: boolean, s: boolean, w: boolean, e: boolean, fallback: RailShape | null,
  ): RailShape | null {
    const northOrSouth = n || s
    const westOrEast = w || e
    let shape: RailShape | null = null
    if (northOrSouth) shape = 'north_south'
    if (westOrEast) shape = 'east_west'
    // 交差する場合だけ既定形状 (置いた向き) を優先する [確定: 26.2 RailState.place]
    if (northOrSouth && westOrEast && fallback) shape = fallback
    if (shape === null) return null

    // 隣の 1 段上にレールがあれば坂になる [確定: 26.2 RailState.place / connectTo]
    if (shape === 'north_south') {
      if (this.ws.isRailAt(above(north(this.pos)))) shape = 'ascending_north'
      if (this.ws.isRailAt(above(south(this.pos)))) shape = 'ascending_south'
    }
    if (shape === 'east_west') {
      if (this.ws.isRailAt(above(east(this.pos)))) shape = 'ascending_east'
      if (this.ws.isRailAt(above(west(this.pos)))) shape = 'ascending_west'
    }
    return shape
  }

  private applyShape(shape: RailShape): void {
    this.shape = shape
    this.connections = [...railConnections(this.pos, shape)]
    this.ws.set(this.pos, shape)
  }

  /** [確定: 26.2 RailState.hasNeighborRail] */
  private hasNeighborRail(railPos: Pos3D): boolean {
    const neighbor = this.getRail(railPos)
    if (!neighbor) return false
    neighbor.removeSoftConnections()
    return neighbor.canConnectTo(this)
  }

  /**
   * [確定: 26.2 RailState.place]。自身の形状を確定させ、繋がった相手の形状も
   * connectTo で張り替える。first は設置時 (形状が同じでも隣へ伝える) を意味する。
   */
  place(first: boolean, defaultShape: RailShape): RailShape {
    const n = this.hasNeighborRail(north(this.pos))
    const s = this.hasNeighborRail(south(this.pos))
    const w = this.hasNeighborRail(west(this.pos))
    const e = this.hasNeighborRail(east(this.pos))

    const shape = this.decideShape(n, s, w, e, defaultShape) ?? defaultShape
    const changed = shape !== this.shape
    this.applyShape(shape)

    if (first || changed) {
      for (const conn of [...this.connections]) {
        const neighbor = this.getRail(conn)
        if (!neighbor) continue
        neighbor.removeSoftConnections()
        if (neighbor.canConnectTo(this)) neighbor.connectTo(this)
      }
    }
    return this.shape
  }
}

/**
 * レールを設置したときの形状張り替えを計算する。
 * 隣接レールに合わせて自身の形状を決め、繋がった相手の形状も張り替える
 * [確定: 26.2 BaseRailBlock.updateDir → new RailState(...).place(...)]。
 * 副作用は持たず、書き換えるべき (pos, shape) の一覧を返すので、
 * 呼び出し側が SimWorld / EditorGrid それぞれの方法で適用する。
 */
export function planRailPlacement(
  grid: RailGrid, pos: Pos3D, defaultShape: RailShape,
): { pos: Pos3D; shape: RailShape }[] {
  const ws = new RailWorkspace(grid)
  const block = ws.get(pos)
  if (!block) return []
  new RailConnector(ws, pos, block.shape).place(true, defaultShape)
  return ws.changes()
}

/**
 * [確定: 26.2 PoweredRailBlock.findPoweredRailSignal]。
 * shape の前後どちらか一方 (forward) へ 1 マス進み、そこ (と 1 段下) に
 * 「繋がる向きの powered なパワードレール」があれば、そのレールが受電しているか、
 * さらに先へ再帰する。深さ 8 で打ち切り。
 */
export function findPoweredRailSignal(
  world: SimWorld, pos: Pos3D, shape: RailShape, forward: boolean, searchDepth: number,
): boolean {
  if (searchDepth >= MAX_RAIL_SEARCH_DEPTH) return false

  let [x, y, z] = pos
  let checkBelow = true
  // 坂は進行方向の片側だけ 1 段上がり、その側では「1 段下」を見ない
  let dir: 'north_south' | 'east_west'
  switch (shape) {
    case 'north_south':
      forward ? z++ : z--
      dir = 'north_south'
      break
    case 'east_west':
      forward ? x-- : x++
      dir = 'east_west'
      break
    case 'ascending_east':
      if (forward) { x-- } else { x++; y++; checkBelow = false }
      dir = 'east_west'
      break
    case 'ascending_west':
      if (forward) { x--; y++; checkBelow = false } else { x++ }
      dir = 'east_west'
      break
    case 'ascending_north':
      if (forward) { z++ } else { z--; y++; checkBelow = false }
      dir = 'north_south'
      break
    case 'ascending_south':
      if (forward) { z++; y++; checkBelow = false } else { z-- }
      dir = 'north_south'
      break
  }

  if (isSameRailWithPower(world, [x, y, z], forward, searchDepth, dir)) return true
  return checkBelow && isSameRailWithPower(world, [x, y - 1, z], forward, searchDepth, dir)
}

/** [確定: 26.2 PoweredRailBlock.isSameRailWithPower] */
function isSameRailWithPower(
  world: SimWorld, pos: Pos3D, forward: boolean, searchDepth: number,
  dir: 'north_south' | 'east_west',
): boolean {
  const state = world.getBlockAt(pos)
  if (!isRail(state)) return false

  // 進行軸と直交する向きのレールへは伝播しない
  const myShape = state.shape
  const isNorthSouthish =
    myShape === 'north_south' || myShape === 'ascending_north' || myShape === 'ascending_south'
  const isEastWestish =
    myShape === 'east_west' || myShape === 'ascending_east' || myShape === 'ascending_west'
  if (dir === 'east_west' && isNorthSouthish) return false
  if (dir === 'north_south' && isEastWestish) return false

  if (!state.powered) return false
  if (isBlockPowered(world, pos)) return true
  return findPoweredRailSignal(world, pos, myShape, forward, searchDepth + 1)
}

/**
 * パワードレールの powered をあるべき値として算出する
 * [確定: 26.2 PoweredRailBlock.updateState]:
 *   hasNeighborSignal(自身6面) || 前方向の連鎖 || 後方向の連鎖
 */
export function shouldRailBePowered(
  world: SimWorld, pos: Pos3D, shape: RailShape,
): boolean {
  return isBlockPowered(world, pos)
    || findPoweredRailSignal(world, pos, shape, true, 0)
    || findPoweredRailSignal(world, pos, shape, false, 0)
}
