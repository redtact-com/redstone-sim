import type {
  Pos3D, RailShape, StraightRailShape, BlockState,
  PoweredRailState, PlainRailState, DetectorRailState, PoweredRailType,
} from './types.js'
import type { SimWorld } from './world.js'
import { isBlockPowered } from './power.js'

// ============================================================
// レール (#127, #138, #140)
//
// 26.2 の RailState (形状の自動接続) と PoweredRailBlock.findPoweredRailSignal
// (動力の連鎖伝播) の移植。sim が持つのは
//   - powered_rail / activator_rail / detector_rail: 直線 6 形状のみ (isStraight=true)
//   - rail (通常レール): 曲線 4 形状も取る (isStraight=false)
// で、曲線分岐と hasSignal による優先順位の反転は通常レールにだけ効く。
//
// 支持ブロック要件 (canSurvive / shouldBeRemoved) は**実装しない**。sim 全体が
// 支持要件を持たない方針 (wire-shape.ts §「支持要件の無い sim でも」) で、
// レールだけ落下破壊を入れると「レバーは浮くのにレールは落ちる」不整合になるため。
//
// ただし実機の仕様は fixture として記録してある (#144 / #328。すべて skipUntil 付き):
//   - rail-support-break       … 給電中の連鎖の途中で床を抜くとレールが消え、
//                                下流の powered が落ちる (連鎖が分断される)
//   - rail-slope-support-break … 坂は真下だけでなく**登る側の水平隣接**も要求する
//                                [確定: 26.2 BaseRailBlock.java:94-106]
//   - lever-support-break      … **レバー側も同じ**。ホッパーの上に置いた床レバーは
//                                更新が届いた時点で壊れて消える (実機は air / sim は残る)
// 実装したくなったら skipUntil を外すだけで検証できる。
// **入れるなら全部まとめて**入れること (一部だけだと不整合が増えるだけ)。
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

/** sim が持つレール全種 (#140, #146) */
export type AnyRailState = PoweredRailState | PlainRailState | DetectorRailState

/**
 * レール系ブロックか [確定: 26.2 BaseRailBlock.isRail = BlockTags.RAILS]。
 * sim が持つのは rail / powered_rail / activator_rail の 3 種。
 * **形状の接続はこの判定 (種別をまたぐ)**、動力の連鎖は同種限定なので
 * isSameRailWithPower 側で別途 type を突き合わせる (#138)。
 */
export function isRail(block: BlockState | null): block is AnyRailState {
  return !!block && (
    block.type === 'rail' || block.type === 'powered_rail'
    || block.type === 'activator_rail' || block.type === 'detector_rail'
  )
}

/**
 * 曲線を取れるレールか (vanilla の `BaseRailBlock.isStraight` の否定)。
 * 通常レールだけが false [確定: 26.2 RailBlock はこのフラグを立てず、
 * PoweredRailBlock / DetectorRailBlock は立てる]。
 */
export function isStraightRail(block: AnyRailState): boolean {
  return block.type !== 'rail'
}

/** 動力を持つレール (powered_rail / activator_rail) か。通常レールは持たない (#140) */
export function isPoweredRail(block: BlockState | null): block is PoweredRailState {
  return !!block && (block.type === 'powered_rail' || block.type === 'activator_rail')
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
    // 曲線は「名前が示す 2 方向」に繋がる。順序も vanilla に合わせる
    case 'south_east':       return [east(pos), south(pos)]
    case 'south_west':       return [west(pos), south(pos)]
    case 'north_west':       return [west(pos), north(pos)]
    case 'north_east':       return [east(pos), north(pos)]
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

  /**
   * その座標のレールの「形状計算に必要な情報だけ」を返す。ブロック状態そのもの
   * ではなく {shape, straight} に正規化するのは、通常レールと直線レールで
   * shape の型が違う (曲線を取れるのは通常レールだけ) ため (#140)。
   */
  get(pos: Pos3D): { shape: RailShape; straight: boolean } | null {
    const b = this.grid.getBlock3(pos[0], pos[1], pos[2])
    if (!isRail(b)) return null
    const shape = this.pending.get(`${pos[0]},${pos[1]},${pos[2]}`)
    return { shape: shape ?? b.shape, straight: isStraightRail(b) }
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
 * 26.2 RailState の移植。straight (powered/activator) は直線 6 形状しか取らず、
 * 通常レールだけが曲線 4 形状を取る [確定: 26.2 BaseRailBlock の isStraight]。
 *
 * vanilla は形状決定を place と connectTo の 2 か所に持っていて、**規則が違う**:
 *   - place    … 「片軸だけ」の排他条件で直線を決め、直交 2 方向なら曲線を確定させ、
 *                 どちらでもない (= 両軸に隣接がある) ときだけ既定形状に落ちてから
 *                 hasSignal で曲線の優先順位を決める
 *   - connectTo… 排他条件なし・後勝ち (両軸あれば EAST_WEST)・hasSignal を見ない
 * 1 つの関数にまとめると通常レールで実機と乖離するので、分けて写している (#140)。
 */
class RailConnector {
  private connections: Pos3D[]
  private readonly ws: RailWorkspace
  readonly pos: Pos3D
  private shape: RailShape
  /** 曲線を取れないレールか [確定: 26.2 BaseRailBlock.isStraight] */
  private readonly straight: boolean

  constructor(ws: RailWorkspace, pos: Pos3D, shape: RailShape, straight: boolean) {
    this.ws = ws
    this.pos = pos
    this.shape = shape
    this.straight = straight
    this.connections = [...railConnections(pos, shape)]
  }

  getShape(): RailShape { return this.shape }

  /** [確定: 26.2 RailState.getRail — 同じ高さ → 1 段上 → 1 段下 の順に探す] */
  private getRail(pos: Pos3D): RailConnector | null {
    for (const p of [pos, above(pos), below(pos)]) {
      const b = this.ws.get(p)
      if (b) return new RailConnector(this.ws, p, b.shape, b.straight)
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

  /**
   * [確定: 26.2 RailState.connectTo] — 相手を接続先に加えて自分の形状を張り替える。
   * place と違い排他条件が無く (後勝ちなので両軸あれば EAST_WEST)、hasSignal も見ない。
   */
  private connectTo(rail: RailConnector): void {
    this.connections.push(rail.pos)
    const n = this.hasConnection(north(this.pos))
    const s = this.hasConnection(south(this.pos))
    const w = this.hasConnection(west(this.pos))
    const e = this.hasConnection(east(this.pos))

    let shape: RailShape | null = null
    if (n || s) shape = 'north_south'
    if (w || e) shape = 'east_west'      // 後勝ち: 両軸あれば EAST_WEST

    if (!this.straight) {
      if (s && e && !n && !w) shape = 'south_east'
      if (s && w && !n && !e) shape = 'south_west'
      if (n && w && !s && !e) shape = 'north_west'
      if (n && e && !s && !w) shape = 'north_east'
    }

    this.applyShape(this.promoteSlope(shape) ?? 'north_south')
  }

  /**
   * 直線に決まったものだけを坂へ昇格させる [確定: 26.2 RailState.place / connectTo —
   * `if (shape == NORTH_SOUTH)` / `if (shape == EAST_WEST)` の 2 ブロックのみ]。
   * **曲線に決まった後は適用されない** [実機 fixture rail-curve-no-slope]。
   */
  private promoteSlope(shape: RailShape | null): RailShape | null {
    if (shape === 'north_south') {
      if (this.ws.isRailAt(above(north(this.pos)))) shape = 'ascending_north'
      if (this.ws.isRailAt(above(south(this.pos)))) shape = 'ascending_south'
    } else if (shape === 'east_west') {
      if (this.ws.isRailAt(above(east(this.pos)))) shape = 'ascending_east'
      if (this.ws.isRailAt(above(west(this.pos)))) shape = 'ascending_west'
    }
    return shape
  }

  /** 内部状態だけ更新する (vanilla の updateConnections + state.setValue 相当) */
  private setInternal(shape: RailShape): void {
    this.shape = shape
    this.connections = [...railConnections(this.pos, shape)]
  }

  /** 内部状態 + ワールドへの書き込み (vanilla の flag 3 の setBlock 相当) */
  private applyShape(shape: RailShape): void {
    this.setInternal(shape)
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
   *
   * hasSignal (= その位置が 6 面のどこかで受電しているか) が効くのは**第三段の内側だけ**で、
   * しかも通常レールのときだけ。両軸に隣接がある (3 方向以上の) ジャンクションで
   * 曲がる先が反転する [実機 fixture rail-junction-place: 非通電 south_east /
   * 通電 north_east]。
   */
  place(first: boolean, defaultShape: RailShape, hasSignal: boolean): RailShape {
    const n = this.hasNeighborRail(north(this.pos))
    const s = this.hasNeighborRail(south(this.pos))
    const w = this.hasNeighborRail(west(this.pos))
    const e = this.hasNeighborRail(east(this.pos))

    const northOrSouth = n || s
    const westOrEast = w || e
    let shape: RailShape | null = null

    // 第一段: 片軸だけに隣接があるときの直線 (排他条件)
    if (northOrSouth && !westOrEast) shape = 'north_south'
    if (westOrEast && !northOrSouth) shape = 'east_west'

    const sAndE = s && e, sAndW = s && w, nAndE = n && e, nAndW = n && w

    // 第二段: 直交ちょうど 2 方向の曲線 (排他条件)
    if (!this.straight) {
      if (sAndE && !n && !w) shape = 'south_east'
      if (sAndW && !n && !e) shape = 'south_west'
      if (nAndW && !s && !e) shape = 'north_west'
      if (nAndE && !s && !w) shape = 'north_east'
    }

    // 第三段: ここに来るのは「両軸に隣接がある」か「隣接ゼロ」のときだけ。
    // vanilla にはこのあと「南北軸だけ」「東西軸だけ」を見る分岐が続くが、
    // その条件は第一段で必ず確定済みなので**到達しない死コード**。
    // 写すと「片軸だけでも hasSignal が効く」誤実装になるので落としてある。
    if (shape === null) {
      if (northOrSouth && westOrEast) shape = defaultShape

      if (!this.straight) {
        // 後勝ちなので優先順位は hasSignal で反転する [確定: 26.2 RailState.java:269-303]
        if (hasSignal) {
          if (sAndE) shape = 'south_east'
          if (sAndW) shape = 'south_west'
          if (nAndE) shape = 'north_east'
          if (nAndW) shape = 'north_west'
        } else {
          if (nAndW) shape = 'north_west'
          if (nAndE) shape = 'north_east'
          if (sAndW) shape = 'south_west'
          if (sAndE) shape = 'south_east'
        }
      }
    }

    const decided = this.promoteSlope(shape) ?? defaultShape
    const changed = decided !== this.shape
    // 内部状態は必ず更新するが、**ワールドへの書き込みと隣への伝播は条件つき**
    // [確定: 26.2 RailState.place — 書き込むのは「設置時 (first) であるか、
    //  現在の blockstate と決定した state が異なる」ときだけ]。
    // first=false (実行中の再計算) で形状が変わらなければ setBlock ごと起きないので、
    // 近隣更新もオブザーバー通知も出ない (#142)
    this.setInternal(decided)
    if (first || changed) {
      this.ws.set(this.pos, decided)
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
 * 水平 4 方向のうち「同じ高さ / 1 段上 / 1 段下 のいずれかにレールがある」数
 * [確定: 26.2 RailState.countPotentialConnections + hasRail]。
 * 通常レールの実行中の向き再計算は、この値が**ちょうど 3** のときだけ走る
 * [確定: 26.2 RailBlock.updateState]
 * [実機 fixture rail-junction-gate: 4 方向ジャンクションは同じ給電操作でも動かない]。
 */
export function countPotentialConnections(grid: RailGrid, pos: Pos3D): number {
  let count = 0
  for (const dir of [north, south, west, east]) {
    const p = dir(pos)
    // hasRail は同じ高さ → 1 段上 → 1 段下 を見る
    if ([p, above(p), below(p)].some(q => isRail(grid.getBlock3(q[0], q[1], q[2])))) count++
  }
  return count
}

/**
 * レールを設置したときの形状張り替えを計算する。
 * 隣接レールに合わせて自身の形状を決め、繋がった相手の形状も張り替える
 * [確定: 26.2 BaseRailBlock.updateDir → RailState.place]。
 * 副作用は持たず、書き換えるべき (pos, shape) の一覧を返すので、
 * 呼び出し側が SimWorld / EditorGrid それぞれの方法で適用する。
 *
 * 返す一覧は vanilla が **flag 3 の setBlock** を呼ぶ座標と 1 対 1 に対応する
 * (形状が結果的に変わらなかった座標も含む — vanilla も first=true / connectTo では
 * 値の異同に関係なく setBlock する)。**flag 3 に伴う近隣更新とオブザーバー通知の
 * 発行は適用側の責務** で、SimWorld ではこの一覧の順に 1 件ずつ書いて発行する (#132)。
 */
export function planRailPlacement(
  grid: RailGrid, pos: Pos3D, defaultShape: RailShape, hasSignal = false, first = true,
): { pos: Pos3D; shape: RailShape }[] {
  const ws = new RailWorkspace(grid)
  const block = ws.get(pos)
  if (!block) return []
  new RailConnector(ws, pos, block.shape, block.straight).place(first, defaultShape, hasSignal)
  return ws.changes()
}

/**
 * [確定: 26.2 PoweredRailBlock.findPoweredRailSignal]。
 * shape の前後どちらか一方 (forward) へ 1 マス進み、そこ (と 1 段下) に
 * 「繋がる向きの powered な**同種の**レール」があれば、そのレールが受電しているか、
 * さらに先へ再帰する。深さ 8 で打ち切り。
 *
 * railType は連鎖の同一性を決める。vanilla の判定は**ブロックそのものの一致**
 * (自分と同じブロックか) なので、powered_rail の連鎖は activator_rail を
 * 通り抜けない (逆も同じ) [確定: 26.2 PoweredRailBlock.isSameRailWithPower]
 * [実機 fixture activator-rail-mixed-chain: 両方向とも境目で切れる] (#138)。
 */
export function findPoweredRailSignal(
  world: SimWorld, pos: Pos3D, shape: StraightRailShape, forward: boolean, searchDepth: number,
  railType: PoweredRailType,
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

  if (isSameRailWithPower(world, [x, y, z], forward, searchDepth, dir, railType)) return true
  return checkBelow
    && isSameRailWithPower(world, [x, y - 1, z], forward, searchDepth, dir, railType)
}

/** [確定: 26.2 PoweredRailBlock.isSameRailWithPower] */
function isSameRailWithPower(
  world: SimWorld, pos: Pos3D, forward: boolean, searchDepth: number,
  dir: 'north_south' | 'east_west', railType: PoweredRailType,
): boolean {
  const state = world.getBlockAt(pos)
  // vanilla の同一ブロック判定に対応 — 同じブロックでなければ連鎖しない (#138)。
  // 通常レールもここで弾かれる (動力を持たないので連鎖に参加しない)
  if (!isPoweredRail(state) || state.type !== railType) return false

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
  return findPoweredRailSignal(world, pos, myShape, forward, searchDepth + 1, railType)
}

/**
 * パワードレール / アクティベーターレールの powered をあるべき値として算出する
 * [確定: 26.2 PoweredRailBlock.updateState]:
 *   自身 6 面の受電 (hasNeighborSignal) / 前方向の連鎖 / 後方向の連鎖 のいずれか
 * 連鎖は同種のレールしかたどらない (#138)。
 */
export function shouldRailBePowered(
  world: SimWorld, pos: Pos3D, shape: StraightRailShape, railType: PoweredRailType,
): boolean {
  return isBlockPowered(world, pos)
    || findPoweredRailSignal(world, pos, shape, true, 0, railType)
    || findPoweredRailSignal(world, pos, shape, false, 0, railType)
}
