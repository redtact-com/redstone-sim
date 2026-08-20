import type {
  WallSide,
  Pos3D, Dir6, HDir, BlockState, WorldSnapshot, ScheduledTick, TickResult,
  WireState, RepeaterState, ComparatorState, LeverState, ButtonState, TargetState,
  ObserverState, PressurePlateState, WeightedPressurePlateState, MovingPistonState,
  RailShape, BlockType, DetectorRailState, DoorLikeState,
} from './types.js'
import { noteInstrumentFor } from './blocks/noteInstrument.js'
import {
  OPPOSITE, ALL_DIRS, MAX_PUSH_DEPTH, isStickyBlock, canStickToEachOther, isRailSlope,
  isStraightRailShape,
} from './types.js'
import {
  shouldRailBePowered, planRailPlacement, isRail, isPoweredRail,
  countPotentialConnections, railConnections,
} from './rail.js'
import {
  isBasePowered as isTorchBasePowered,
  pruneToggles, MAX_RECENT_TOGGLES, RESTART_DELAY,
} from './blocks/torch.js'
import { computeWirePower, getConnectedWireNeighbors } from './blocks/wire.js'
import {
  refreshWireShape, wireShapeCandidates, sameConnections,
} from './wire-shape.js'
import { getRepeaterLockDirs } from './blocks/repeater.js'
import {
  isContainerType, effectiveContainerSignal, HOPPER_COOLDOWN, DROPPER_TICK_DELAY,
  WATER_TICK_DELAY,
  takeOne, putOne, totalItems, containerSlotsOf, slotsForSignal, emptySlots,
} from './blocks/container.js'
import { stackSizeOf } from './blocks/itemStacks.js'
import { NC_UPDATE_ORDER, PP_UPDATE_ORDER, CU_UPDATE_ORDER, dustUpdateOrigins } from './updates.js'
import type {
  BlockEvent, PistonState, NoteBlockState, HopperState, DropperState, ContainerState, ItemStack,
} from './types.js'

/** 音符ブロック発音イベント (C5 #38)。BE フェーズの triggerEvent 相当で発火する */
export interface NotePlayEvent {
  pos: Pos3D
  /** 音程 0-24 (vanilla NOTE) */
  note: number
}
import {
  getSignal, getDirectSignal, getSolidPower,
  isBlockPowered, isFacePowered, isSolidPowered, isConductor, isSignalSourceType,
} from './power.js'
import {
  Tracer, abbrOf, pendingAction, elemDelay,
} from './trace.js'
import type { TraceOptions, TracePhase, TraceAction } from './trace.js'

// ============================================================
// ユーティリティ
// ============================================================

export function posKey(pos: Pos3D): `${number},${number},${number}` {
  return `${pos[0]},${pos[1]},${pos[2]}`
}

export function keyToPos(key: string): Pos3D {
  const [x, y, z] = key.split(',').map(Number)
  return [x, y, z]
}

function neighbor(pos: Pos3D, dir: Dir6): Pos3D {
  const [x, y, z] = pos
  switch (dir) {
    case 'north': return [x, y, z - 1]
    case 'south': return [x, y, z + 1]
    case 'east':  return [x + 1, y, z]
    case 'west':  return [x - 1, y, z]
    case 'up':    return [x, y + 1, z]
    case 'down':  return [x, y - 1, z]
  }
}

/** pos から dir へ n マス進んだ座標 (n=0 は pos 自身) */
function offset(pos: Pos3D, dir: Dir6, n: number): Pos3D {
  let cur = pos
  for (let i = 0; i < n; i++) cur = neighbor(cur, dir)
  return cur
}

// NC 更新 DFS 機械のエントリ (single = 1 マス通知 / multi = 6 方向一括、1 方向ずつ中断可)。
// origin は vanilla の `updateNeighborsAt` が第 2 引数で運ぶ **更新元ブロック**。
// 通常レールの向き再計算がこれを門番に使う (更新元が信号源のときだけ走る。#142)
type UpdateEntry =
  | { kind: 'single'; target: Pos3D; origin: BlockType }
  | { kind: 'multi'; around: Pos3D; skip: Dir6 | null; idx: number; origin: BlockType }

// ============================================================
// SimWorld 実装
// ============================================================

/**
 * コンパレーターが読む「アナログ出力」 (vanilla の hasAnalogOutputSignal / getAnalogOutputSignal)。
 * 持たないブロックは null。**直後と導体 1 個越しの両方で同じ判定を使う**
 * [確定: 26.2 ComparatorBlock.calculateOutputSignal]。
 */
function analogOutputOf(block: BlockState | null | undefined): number | null {
  if (!block) return null
  // コンテナ (hopper/dropper/dispenser/barrel 等) は充填率 → 信号
  if (isContainerType(block.type)) return effectiveContainerSignal(block)
  // クラフターは「埋まっているスロット数」0-9 (充填率ではない)
  // [確定: 26.2 CrafterBlockEntity.getRedstoneSignal]
  if (block.type === 'crafter') return block.occupiedSlots
  // 銅の電球が読ませるのは **lit** で powered ではない
  // [確定: 26.2 CopperBulbBlock.getAnalogOutputSignal / 実機 fixture copper-bulb-output]
  if (block.type === 'copper_bulb') return block.lit ? 15 : 0
  // 水入り大釜 / コンポスターは LEVEL をそのまま返す (#234)
  // [確定: 26.2 LayeredCauldronBlock / ComposterBlock の getAnalogOutputSignal]
  if (block.type === 'cauldron' || block.type === 'composter') return block.level
  // 書見台はページ番号を読む (#240)
  // [確定: 26.2 LecternBlock.getAnalogOutputSignal / LecternBlockEntity.getRedstoneSignal]
  if (block.type === 'lectern') return lecternSignal(block)
  return null
}

/**
 * 書見台のコンパレーター出力 (#240)。
 *
 * [確定: 26.2 LecternBlockEntity.getRedstoneSignal — ページ進捗は「ページ数が 2 以上なら
 *  現在ページ ÷ (ページ数 - 1)、1 以下なら 1.0」。出力は進捗 × 14 の切り捨てに、
 *  本の実体を持つなら +1]
 * 呼び出し元 (getAnalogOutputSignal) が **blockstate の has_book で先に 0 を返す**ので、
 * has_book=false は 0。`pages === 0` は「blockstate だけ has_book=true で中身が無い」状態で、
 * ページ数 2 以上の分岐に入らず進捗 1.0・本の実体も無しと判定されるので **14** になる
 * (実機で確認: 本無し 14 / 5 ページ本は Page 0→1, 1→4, 2→8, 3→11, 4→15)。
 */
function lecternSignal(b: { hasBook: boolean; page: number; pages: number }): number {
  if (!b.hasBook) return 0
  const progress = b.pages > 1 ? b.page / (b.pages - 1) : 1
  return Math.floor(Math.min(1, Math.max(0, progress)) * 14) + (b.pages > 0 ? 1 : 0)
}

/** 泡柱の状態が同じか (水 ⇔ 泡柱 / drag 違いを区別する) */
function sameColumnState(a: BlockState, b: BlockState): boolean {
  if (a.type !== b.type) return false
  if (a.type === 'bubble_column' && b.type === 'bubble_column') return a.drag === b.drag
  return true
}

/**
 * 見た目がフルキューブか (塀の接続判定 / 側面の tall 判定に使う)。
 * vanilla の `isFaceSturdy` 相当の近似 [確定: 26.2 WallBlock.connectsTo]。
 */
/** 塀の指定辺の値を取り出す */
function sideValue(w: { north: WallSide; east: WallSide; south: WallSide; west: WallSide }, dir: Dir6): WallSide {
  switch (dir) {
    case 'north': return w.north
    case 'south': return w.south
    case 'east':  return w.east
    case 'west':  return w.west
    default:      return 'none'
  }
}

/**
 * 塀が横に繋がる相手か (#244)。
 *
 * **実機で全数測った** (塀の隣にブロックを置いて side を読む):
 *
 * | 繋がる | 繋がらない |
 * |---|---|
 * | 石・ガラス・二重ハーフ・階段・フェンスゲート・音符ブロック・ランプ・ピストン・オブザーバー・塀・磁鉄鉱・ソウルサンド・樽 | 下ハーフ・**トラップドア (開閉とも)**・書見台 |
 * | **ドア (向き 4 種 × 開閉 2 種すべて)** | |
 *
 * ドアは**向きにも開閉にもよらず必ず繋がる**。ここを落としていたため、
 * ドアが隣にある塀の柱が sim だけ up=true に反転し、
 * **140 段まるごと**食い違っていた (エレベーターで実測)。
 */
/** 上から見て時計回り (北 → 東 → 南 → 西) */
const CW: Record<HDir, HDir> = { north: 'east', east: 'south', south: 'west', west: 'north' }
/** 上から見て反時計回り */
const CCW: Record<HDir, HDir> = { north: 'west', west: 'south', south: 'east', east: 'north' }

/**
 * ドアの板がどの辺に張り付いているか (#262)。
 *
 * 閉じているときは `facing` の**反対側**の辺。開くと 90° 回り、
 * **hinge=left は時計回り / hinge=right は反時計回り**。
 *
 * [実機実測 2026-08-21: 塀の南にドアを置き 4 向き × 開閉 × 蝶番 の 16 通りで
 *  塀の south を読んだ。繋がったのは
 *  facing=south/閉 (板=北) / facing=east/開/left (板=北) / facing=west/開/right (板=北) の 3 通りだけ]
 */
function doorPanelSide(b: { facing: HDir; open: boolean; hinge: 'left' | 'right' }): HDir {
  const closed = OPPOSITE[b.facing as Dir6] as HDir
  if (!b.open) return closed
  return b.hinge === 'left' ? CW[closed] : CCW[closed]
}

/**
 * 塀が `dir` 方向の隣へ繋がるか (#234 / #262)。
 * `dir` は**塀から見た隣の方向**。
 */
function connectsToWall(b: BlockState | null | undefined, dir: HDir): boolean {
  if (!b) return false
  if (b.type === 'wall') return true
  if (b.type === 'fence_gate') return true          // 向きによらず繋がる (実機で確認)
  if (b.type === 'door_wood' || b.type === 'door_iron') {
    // **板が塀の側を向いているときだけ繋がる**。開いたドアは板が横へ逃げるので
    // 繋がらなくなり、塀の up が連鎖して**柱ごと反転する** (#244 の下方向伝播)
    return doorPanelSide(b) === OPPOSITE[dir as Dir6]
  }
  return isFullCube(b)
}

function isFullCube(b: BlockState | null | undefined): boolean {
  if (!b) return false
  switch (b.type) {
    case 'solid': case 'lodestone': case 'soul_sand': case 'note_block': case 'target':
    case 'glass': case 'redstone_block': case 'lamp': case 'copper_bulb':
    case 'dropper': case 'dispenser': case 'crafter': case 'slime_block': case 'observer':
    case 'piston': case 'sticky_piston':
      return true
    default:
      return false
  }
}

export class SimWorld {
  private blocks = new Map<string, BlockState>()
  private scheduledTicks: ScheduledTick[] = []
  /**
   * この tick 分として取り出した予約 (`posKey|blockType`)。
   * vanilla の `LevelTicks.toRunThisTick` に相当し、`hasScheduledTick` が見る (#264)
   */
  private runningThisTick = new Set<string>()
  private currentTick = 0
  private seqCounter = 0

  // ── NC 更新の DFS 機械 (02 §4.2 CollectingNeighborUpdater [確定]) ──
  // 実行中に発生した更新は addedThisLayer に積まれ、逆順 push で
  // 「挿入順に、現在の更新より先に」実行される (プッシュ型 DFS)。
  // 6 方向一括 (multi) は 1 方向ごとに中断判定される。
  private updateStack: UpdateEntry[] = []
  private addedThisLayer: UpdateEntry[] = []
  private updating = false
  private updateCount = 0

  // ── ブロックイベントキュー (02 §3 [確定]) ──
  // 挿入順 FIFO + (pos, blockType, param) 重複排除。BE フェーズで空になるまで処理
  private blockEvents: BlockEvent[] = []

  // ── 音符ブロック発音コールバック (C5 #38) ──
  // BE フェーズで note block の triggerEvent (発音) が走ったとき呼ばれる。
  // sim は音を鳴らさず、UI 通知や検証のためにこのフックへ発音イベントを流す。
  // clone() では引き継がない (投機シミュレーションで二重発火させないため)。
  private noteHook: ((e: NotePlayEvent) => void) | null = null

  // ── トレース (I10 #18)。docs/research/08 記法 ──
  // tracer が null の間はフックはすべて no-op (副作用なし)。
  // traceBuf は verbose の updateFormula 収集用 (非 null の間 bu トークンを溜める)。
  private tracer: Tracer | null = null
  private traceBuf: string[] | null = null
  private traceSrc: Pos3D | null = null

  // ── トレース公開 API (I10 #18) ───────────────────────────

  /** トレース収集を有効化する。opts.verbose で updateFormula 行も出す */
  enableTrace(opts?: TraceOptions): void {
    this.tracer = new Tracer(opts)
  }

  /** トレース収集を無効化する (以降フックは no-op) */
  disableTrace(): void {
    this.tracer = null
    this.traceBuf = null
    this.traceSrc = null
  }

  /** 収集済みトレースを 08 記法の 1 行 1 イベント文字列配列で返す */
  getTrace(): string[] {
    return this.tracer?.getLines() ?? []
  }

  /** 収集済みトレースイベント (構造化) を返す */
  getTraceEvents() {
    return this.tracer?.getEvents() ?? []
  }

  /** 収集済みトレースを消去する (初期 settle 後の起点合わせに使う) */
  clearTrace(): void {
    this.tracer?.clear()
  }

  // ── 音符ブロック発音フック (C5 #38) ──────────────────────

  /**
   * 音符ブロックの発音コールバックを登録する (null で解除)。
   * BE フェーズで note block の発音イベント (26.2 triggerEvent 相当) が
   * 実行されるたびに呼ばれる。sim は音自体を鳴らさない。
   */
  onNotePlay(cb: ((e: NotePlayEvent) => void) | null): void {
    this.noteHook = cb
  }

  // ── トレース内部フック ───────────────────────────────────

  /** processFormula 行 (実行) を発行する */
  private traceProcess(
    phase: TracePhase, abbr: string, action: TraceAction, delay: number | 's',
    opts?: { failed?: boolean; abnormal?: boolean },
  ): void {
    if (!this.tracer) return
    this.tracer.push({
      kind: 'process', gt: this.currentTick, phase, abbr, action, delay,
      reserve: false, failed: opts?.failed, abnormal: opts?.abnormal,
    })
  }

  /** processFormula 行 (予約) を発行する */
  private traceReserve(
    phase: TracePhase, abbr: string, action: TraceAction, delay: number | 's',
    priority?: number,
  ): void {
    if (!this.tracer) return
    this.tracer.push({
      kind: 'process', gt: this.currentTick, phase, abbr, action, delay,
      reserve: true, priority,
    })
  }

  /** verbose 時、これ以降の NC 発行を updateFormula 用に収集し始める */
  private traceOpenUpdate(src: Pos3D): void {
    if (this.tracer?.verbose) {
      this.traceBuf = []
      this.traceSrc = src
    }
  }

  /** 収集した bu トークンで updateFormula 行を発行し、収集を閉じる */
  private traceCloseUpdate(
    abbr: string, action: TraceAction, delay: number | 's', phase: TracePhase,
  ): void {
    if (this.tracer?.verbose && this.traceBuf) {
      this.tracer.push({
        kind: 'update', gt: this.currentTick, phase, abbr, action, delay,
        reserve: false, updates: this.traceBuf,
      })
    }
    this.traceBuf = null
    this.traceSrc = null
  }

  /** bu 発行対象を発行元 (traceSrc) からの相対座標トークンにする */
  private relToken(pos: Pos3D): string {
    const s = this.traceSrc
    if (!s) return 'o'
    const dx = pos[0] - s[0], dy = pos[1] - s[1], dz = pos[2] - s[2]
    if (dx === 0 && dy === 0 && dz === 0) return 'o'
    const ax = (v: number, c: string) =>
      v === 0 ? '' : `${v > 0 ? '+' : '-'}${Math.abs(v) > 1 ? Math.abs(v) : ''}${c}`
    return `${ax(dx, 'x')}${ax(dy, 'y')}${ax(dz, 'z')}`
  }
  // ── PP (updateShape / SU) 発行の抑止フラグ ──
  // initialize() の初期組み立て中は PP を発行しない (シミュレーション中の状態変化
  // のみがオブザーバーを起動する。初期安定状態は authored 相当で発火させない)。
  private suppressPP = false

  // ── ブロックアクセス ─────────────────────────────────────

  getBlock(x: number, y: number, z: number): BlockState | null {
    return this.blocks.get(posKey([x, y, z])) ?? null
  }

  /** wire-shape.ts の BlockGrid3D 実装 (接続形状導出用) */
  getBlock3(x: number, y: number, z: number): BlockState | null {
    return this.getBlock(x, y, z)
  }

  getBlockAt(pos: Pos3D): BlockState | null {
    return this.blocks.get(posKey(pos)) ?? null
  }

  setBlock(x: number, y: number, z: number, block: BlockState): void {
    const key = posKey([x, y, z])
    if (block.type === 'air') {
      this.blocks.delete(key)
    } else {
      this.blocks.set(key, block)
    }
  }

  setBlockAt(pos: Pos3D, block: BlockState): void {
    this.setBlock(pos[0], pos[1], pos[2], block)
  }

  // ── スケジュール ─────────────────────────────────────────

  /**
   * tile tick を予約する (02 §2 [確定])。
   * - 同 pos + 同ブロック種の予約が既にあれば無視 (vanilla LevelChunkTicks.schedule)
   * - action は持たない。実行時に executeScheduledTick がブロック種別に応じて
   *   世界状態を再評価して動作を決める
   */
  schedule(pos: Pos3D, delay: number, priority: number): void {
    const block = this.getBlockAt(pos)
    if (!block) return
    if (this.hasScheduledTick(pos, block.type)) return
    this.scheduledTicks.push({
      pos,
      blockType: block.type,
      dueTick: this.currentTick + delay,
      priority,
      seq: this.seqCounter++,
    })
    // トレース: ST 予約 (08 §1 の "()")。action は予約意図を状態から推定。
    this.traceReserve('ST', abbrOf(block), pendingAction(block), delay, priority)
  }

  /**
   * 同 pos + ブロック種の予約が既にあるか。
   *
   * **この tick に走る分も「ある」と数える** (#264)。
   * [確定: 26.2 LevelTicks.willTickThisTick — 収集済み (toRunThisTick) も見る]。
   * vanilla のトーチやダイオードは近隣更新を受けたとき
   * `!willTickThisTick(...)` を条件に予約するので、**すでに今 tick 分として
   * 取り出された予約は二重に積まれない**。
   *
   * ここを見落とすと、同じ tick に
   *   「近隣更新 → 2gt 後を予約」→「取り出し済みの予約が発火して状態が変わる」
   * の順で走ったときに**余計な予約が 1 本残り**、2 tick 後に空撃ちして
   * 実機より早く遷移してしまう
   * (ガラスエレベーターでトーチが実機より 2gt 早く点いていた原因)。
   */
  hasScheduledTick(pos: Pos3D, blockType: BlockState['type']): boolean {
    const key = posKey(pos)
    return this.scheduledTicks.some(t => posKey(t.pos) === key && t.blockType === blockType)
  }

  /**
   * **この tick に走る分も含めて**予約があるか
   * [確定: 26.2 LevelTicks.willTickThisTick — 収集済み (toRunThisTick) も見る]。
   *
   * `hasScheduledTick` との違いは「取り出し済みの予約を数えるか」だけ。
   * vanilla は素子ごとに使い分けていて、**トーチの近隣更新はこちら**を見る
   * [確定: 26.2 RedstoneTorchBlock.neighborChanged —
   *  `LIT != hasNeighborSignal && !willTickThisTick` のときだけ 2gt を予約する]。
   *
   * 見落とすと、同じ tick に
   *   「近隣更新 → 2gt 後を予約」→「取り出し済みの予約が発火して状態が変わる」
   * の順で走ったときに**余計な予約が 1 本残り**、2gt 後に空撃ちして実機より早く遷移する
   * (ガラスエレベーターでトーチが実機より 2gt 早く点いていた原因 — #264)。
   *
   * **数えるのは「まだ走っていない」分だけ**。これは vanilla からの逸脱ではなく同型で、
   * `LevelTicks.runCollectedTicks` は取り出した予約をその場で `toRunThisTickSet` から外す
   * [確定: 26.2]。数え続けると自分の発火のあとに戻ってきた近隣更新まで抑止してしまい、
   * トーチクロックが止まる (実機 fixture torch-clock)。
   *
   * vanilla の `willTickThisTick` は `hasScheduledTick` を含まないが、
   * `scheduleTick` 側が `LevelChunkTicks` で (pos, type) の先勝ち dedup をするので、
   * ここの「取り出し済み ∪ 未実行の予約」は合成として等価。
   *
   * **`hasScheduledTick` の側を広げてはいけない**。オブザーバー・泡柱・ピストンは
   * vanilla でも取り出し済みを数えないので、まとめて変えると 58 本のテストが落ちる。
   *
   * **これを見るのはトーチ・リピーター・コンパレーターの 3 つだけ** (#264)。
   * 26.2 でブロック側から `willTickThisTick` を呼ぶのは
   * `RedstoneTorchBlock` / `DiodeBlock` / `ComparatorBlock` の 3 クラスに限られる。
   */
  willTickThisTick(pos: Pos3D, blockType: BlockState['type']): boolean {
    if (this.runningThisTick.has(`${posKey(pos)}|${blockType}`)) return true
    return this.hasScheduledTick(pos, blockType)
  }

  /** ブロックイベントを予約する (同一 (pos, blockType, param) は重複登録しない) */
  scheduleBlockEvent(pos: Pos3D, param: BlockEvent['param']): void {
    const block = this.getBlockAt(pos)
    if (!block) return
    const key = posKey(pos)
    if (this.blockEvents.some(e =>
      posKey(e.pos) === key && e.blockType === block.type && e.param === param)) return
    this.blockEvents.push({ pos, blockType: block.type, param })
    // トレース: BE 予約 (08 §1 の delay='s')。extend=push / retract=retract /
    // play=note block 発音 (立ち上がりで鳴るので turn oN = 'n')。
    const beAction: TraceAction = param === 'extend' ? 'p' : param === 'retract' ? 'r' : 'n'
    this.traceReserve('BE', abbrOf(block), beAction, 's')
  }

  getBlockEvents(): readonly BlockEvent[] {
    return this.blockEvents
  }

  getScheduledTicks(): readonly ScheduledTick[] {
    return this.scheduledTicks
  }

  // ── シミュレーション ─────────────────────────────────────

  /**
   * 1 ゲームティック進める。
   * 処理順: ST（ScheduledTick）フェーズのみ。
   * PI（PlayerInput）は activateBlock() で手動実行。
   */
  tick(): TickResult {
    this.currentTick++
    const changed = new Set<string>()

    // collect-then-execute (02 §2.1 [確定]): 期限が来た予約を先に収集してから
    // 実行する。実行中に積まれた予約は dueTick > currentTick になるため
    // 同 tick では走らない (次 tick 送り)。
    const toExecute = this.scheduledTicks
      .filter(t => t.dueTick <= this.currentTick)
      .sort((a, b) => a.priority - b.priority || a.seq - b.seq)
    this.scheduledTicks = this.scheduledTicks.filter(t => t.dueTick > this.currentTick)
    // **取り出した分も「予約あり」として数える** (#264)。tick の最後まで保持する
    this.runningThisTick.clear()
    for (const t of toExecute) this.runningThisTick.add(`${posKey(t.pos)}|${t.blockType}`)

    for (const tick of toExecute) {
      // **走らせたら「これから走る」集合から外す** (#264)。
      // 走る前のものだけを willTickThisTick が数えるようにしないと、
      // 自分の発火のあとに戻ってきた近隣更新まで抑止してしまい
      // トーチクロックが止まる (実機 fixture torch-clock が落ちる)
      this.runningThisTick.delete(`${posKey(tick.pos)}|${tick.blockType}`)
      const affectedKeys = this.executeScheduledTick(tick)
      for (const k of affectedKeys) changed.add(k)
    }

    // ── BE フェーズ (02 §3 [確定]): キューが空になるまで処理。
    // 処理中に追加されたイベントも同一 tick 内で実行される (ピストン連鎖)
    let beGuard = 0
    while (this.blockEvents.length > 0) {
      if (++beGuard > 65_536) {
        console.warn('[sim] BlockEvent 数が上限を超過。以降を破棄します')
        this.blockEvents.length = 0
        break
      }
      const ev = this.blockEvents.shift()!
      for (const k of this.executeBlockEvent(ev)) changed.add(k)
    }

    // ── BlockEntity フェーズ (02 §1.2 phase10 [確定]): ホッパー転送。
    // ST (phase4) → BE (phase8) → BlockEntity (phase10) の順は vanilla と一致
    // (ST は runBlockEvents の前、BlockEntity は後)。ドロッパーは ST フェーズの
    // tile tick で発火するためここでは扱わない (piston/dispenser と同じ BEC/STC 系)。
    this.tickBlockEntities(changed)

    return {
      changedPositions: [...changed].map(keyToPos),
      currentTick: this.currentTick,
    }
  }

  /**
   * BlockEntity フェーズ (phase10) — ホッパーの転送 (C6' #65)。
   *
   * [確定: 26.2 HopperBlockEntity]: 毎 gt、クールダウン (8gt) 明け かつ enabled の
   * ホッパーが、(1) facing 先コンテナへ 1 個 eject、(2) 直上コンテナから 1 個 suck
   * を試みる (eject が先。両方成立し得る)。いずれか成功でクールダウン 8gt 再設定。
   * コンテナ内容が変わったら CU (emitComparatorUpdate) で隣接コンパレーターへ通知。
   *
   * **走査順 = BE 登録順 (#91)**: vanilla の BlockEntity tick 順は登録順 (= 設置順)
   * で観測可能。sim は `this.blocks` (Map) の **挿入順 = 設置順** で走査してこれを再現する。
   * 縦チェーンの流下は配置順で変わる: top-down 配置 (上を先に設置) は上流先処理で
   * 1 tick 素通り、bottom-up 配置は下流先処理でバッファする — どちらも実機の設置順と
   * 一致 (実機 rcon で両配置を採取して確認。旧実装の座標順 y↓ は top-down 相当だった)。
   * **クールダウン -1 補正 (#89)**: 押し込み先ホッパーは受信で実効 7gt になる
   * (vanilla HopperBlockEntity.add の setCooldown(8-k) + 自 tick の -1 が相補的)。
   * 2 ホッパー clock の 14gt 周期はこれで実機一致する。
   */
  private tickBlockEntities(changed: Set<string>): void {
    // #80: moving_piston の確定 (phase10 PistonMovingBlockEntity.tick 相当)。
    // BE フェーズ (phase8) の後に確定するため、確定ブロックが下流ピストンを
    // 起動する連鎖の下流 BE は翌 tick 発火する (vanilla 一致、rblock-piston-chain)。
    // 単独ピストンなど下流 BEC の無い場合は確定 gt が変わらないので観測不変。
    const dueMoving: Pos3D[] = []
    for (const [key, b] of this.blocks) {
      if (b.type === 'moving_piston' && b.finalizeDue <= this.currentTick) {
        dueMoving.push(keyToPos(key))
      }
    }
    // 同 tick 確定は seq 順 (旧 ST 相 tile tick の予約順を再現)
    dueMoving.sort((a, b) =>
      (this.getBlockAt(a) as MovingPistonState).seq - (this.getBlockAt(b) as MovingPistonState).seq)
    for (const pos of dueMoving) {
      const mp = this.getBlockAt(pos)
      if (mp?.type !== 'moving_piston') continue
      this.finalizeMovingPiston(pos, mp, changed)
    }

    // #91: BE 登録順 (= 設置順 = Map 挿入順) で走査する。座標順ソートは top-down 配置
    // 相当で、bottom-up 等の配置では実機と乖離するため、実際の設置順を反映する
    // (this.blocks の for..of は挿入順。既存 fixture は全て座標順配置なので挙動不変)。
    const hoppers: Pos3D[] = []
    for (const [key, b] of this.blocks) {
      if (b.type === 'hopper') hoppers.push(keyToPos(key))
    }

    for (const pos of hoppers) {
      let h = this.getBlockAt(pos)
      if (h?.type !== 'hopper') continue
      const key = posKey(pos)
      // ロック中 / クールダウン中はスキップ (vanilla: !enabled or isOnCooldown)
      if (!h.enabled || this.currentTick < (h.cooldownUntil ?? 0)) continue
      let moved = false

      // (1) 送り込み (eject): facing 先のコンテナへ 1 個 (h が空でないとき)
      const taken = takeOne(h.slots)
      if (taken) {
        const destPos = neighbor(pos, h.facing)
        const dest = this.getBlockAt(destPos)
        const destSlots = containerSlotsOf(dest)
        const put = destSlots !== undefined ? putOne(destSlots, taken.item) : null
        if (dest && put) {
          const d = dest as HopperState | DropperState | ContainerState
          this.setBlockAt(destPos, { ...d, slots: put } as BlockState)
          h = { ...h, slots: taken.slots }
          this.setBlockAt(pos, h)
          // #89/#91: 押し込み先ホッパーのクールダウンを再設定 (vanilla HopperBlockEntity.add)。
          // vanilla の条件は「受信スロットが空だった (bl) かつ 押込先がホッパー かつ
          //   カスタムクールダウン中でない」ときに限り クールダウンを 8-k に設定する:
          //   bl = 受信スロットが空だった / k=1: 押込先が同gt 既 tick / k=0: 未 tick。
          //   k=0 でも押込先は自 serverTick で -1 され結局 **実効 7gt**。よって空受信時は
          //   一律 currentTick+7 (残留クールダウン中でもリセット。旧実装は off-cooldown 時
          //   のみ再設定で 7/8 desync→bounce/stall し 2-clock が 16gt にズレた: #89)。
          // ★ bl 条件が要 (#91): bottom-up 縦チェーンでは受信側が先に suck して非空に
          //   なってから push されるため bl=false → -1 を効かせず既存 cooldown(+8) を保つ。
          //   これを怠ると bottom-up 配置で位相が 1gt ずれる。
          if (d.type === 'hopper' && totalItems(destSlots!) === 0) {  // bl: 受信側が空だった
            const cur = this.getBlockAt(destPos) as HopperState
            const remaining = (cur.cooldownUntil ?? 0) - this.currentTick
            if (remaining <= HOPPER_COOLDOWN) {  // !isOnCustomCooldown (残り>8gt でない)
              this.setBlockAt(destPos, { ...cur, cooldownUntil: this.currentTick + HOPPER_COOLDOWN - 1 })
            }
          }
          this.emitComparatorUpdate(destPos)
          changed.add(posKey(destPos))
          moved = true
        }
      }

      // (2) 吸い出し (suck): 直上コンテナから 1 個 (受け入れ余地があるとき)
      {
        const srcPos: Pos3D = [pos[0], pos[1] + 1, pos[2]]
        const src = this.getBlockAt(srcPos)
        const srcSlots = containerSlotsOf(src)
        const pulled = srcSlots !== undefined ? takeOne(srcSlots) : null
        const merged = pulled ? putOne(h.slots, pulled.item) : null
        if (src && pulled && merged) {
          const s = src as HopperState | DropperState | ContainerState
          this.setBlockAt(srcPos, { ...s, slots: pulled.slots } as BlockState)
          h = { ...h, slots: merged }
          this.setBlockAt(pos, h)
          this.emitComparatorUpdate(srcPos)
          changed.add(posKey(srcPos))
          moved = true
        }
      }

      if (moved) {
        this.setBlockAt(pos, { ...h, cooldownUntil: this.currentTick + HOPPER_COOLDOWN })
        this.emitComparatorUpdate(pos)
        changed.add(key)
      }
    }
  }

  /**
   * moving_piston を into へ確定させる (#80、旧 executeScheduledTick の moving_piston 分岐)。
   * BlockEntity 相 (phase10) で呼ぶ。setBlock 相当の PP (観測面オブザーバー起動) +
   * NC 伝播を行う。トレースは確定先の abbr で TE (TileEntity) フェーズとして記録。
   */
  private finalizeMovingPiston(pos: Pos3D, mp: MovingPistonState, changed: Set<string>): void {
    const into = mp.into
    this.setBlockAt(pos, into)
    changed.add(posKey(pos))
    this.traceProcess('TE', abbrOf(into), 'c', 2)
    this.traceOpenUpdate(pos)
    if (observableChanged(mp, into)) this.emitShapeUpdate(pos)
    // 設置されたオブザーバーは 1 回発火する [確定: 26.2 ObserverBlock.onPlace +
    // 実機 fixture observer-pushed — 着地 (t5) の 2gt 後 t7 に powered=true]。
    // 監視先が変わったかではなく「置かれたこと」が起動条件なので、ここで予約する (#119)
    if (into.type === 'observer' && !into.powered && !this.hasScheduledTick(pos, 'observer')) {
      this.schedule(pos, 2, 0)
    }
    // **点灯したまま運ばれてきた**場合は即消灯する (#221)
    // [確定: 26.2 ObserverBlock.onPlace — POWERED かつ scheduledTick が無ければ
    //  flag 18 の setBlock で POWERED を false に落とし、updateNeighborsInFront を呼ぶ]。
    // 消灯 tick は移動前の座標に予約されていて移動で失われるため、これが無いと
    // **二度と消えない**。ユーザ提供の 2 幅ドアで、押されて戻ったオブザーバーが
    // 点きっぱなしになり 2 往復目が動かなくなっていた
    if (into.type === 'observer' && into.powered && !this.hasScheduledTick(pos, 'observer')) {
      this.setBlockAt(pos, { ...into, powered: false })
      // 前方更新は末尾の propagateChange(pos) が担う (observer の NC 発行経路)
    }
    // 着地したレールは onPlace が movedByPiston でも走るので、
    //   (1) updateDir(first=true) で形状を決め直し (隣のレールも connectTo で張り替わる)
    //   (2) isStraight なので自分自身に neighborChanged が掛かり powered が再計算される
    // [確定: 26.2 BaseRailBlock.java:64-77,111-118]
    // [実機 fixture rail-piston-push-connect (着地先の隣のレールに繋がって north_south へ) /
    //  rail-piston-push-powered (電源から押し離すと着地の時点で off)]
    if (isRail(into)) {
      for (const p of this.applyRailPlacement(pos, into.shape)) changed.add(posKey(p))
      this.neighborChanged(pos)
    }
    // 着地したピストンは**自分自身を再判定する** (#231)
    // [確定: 26.2 PistonBaseBlock.onPlace — 置き換え前が別ブロック種で、かつその位置に
    //  BlockEntity がまだ無いときだけ checkIfExtend を呼ぶ]。
    // 着地は moving_piston → piston の差し替えなので条件を満たす。
    // 隣接 6 マスへの NC (下の submitMultiNC) は**自分には飛ばない**ので、
    // これが無いと「運ばれて着地した直後に受電しているピストン」が伸びない
    // (5×5 ドアの t=299 で実機だけが伸びていた原因)
    if (into.type === 'piston' || into.type === 'sticky_piston') {
      this.neighborChanged(pos)
    }
    // 着地は vanilla では **UPDATE_ALL flag の setBlock** なので**隣接 6 マスへ NC が飛ぶ**
    // [確定: 26.2 PistonMovingBlockEntity.finalTick → Level.setBlock を UPDATE_ALL で呼ぶ]。
    // これが無いと「移動中 (moving_piston) で押せなかったピストンが、着地後も
    // 再評価されず伸びないまま」になる (#213 のドアで tick 135 の押し上げが
    // 起きなかった原因)。実機 fixture door-2wide-open-to-close が回帰を守る
    this.submitMultiNC(pos)
    // **導体 1 個越しに読んでいるコンパレーターにも知らせる** (#259)。
    // submitMultiNC は隣接 6 マスにしか届かないので、
    // 「コンパレーター → 導体 → 着地したブロック」の並びだと通知が届かない。
    // 同じ tick に複数のブロックが着地するとき、確定の順番によっては
    // コンパレーターが「まだ moving_piston のままの中身」を読んでしまい、
    // **二度と再評価されない**
    // (ガラスエレベーターの搬器が階に着いたとき、コンパレーター → スライム →
    //  コンポスター の並びで階数表示が動かなくなっていた)
    this.emitComparatorUpdate(pos)
    this.propagateChange(pos)
    this.traceCloseUpdate(abbrOf(into), 'c', 2, 'TE')
  }

  /**
   * CU (updateNeighbourForOutputSignal 相当。02 §4.1/§4.2 [確定])。
   * コンテナ内容が変わったとき水平隣接 (北→東→南→西) のコンパレーターへ通知する。
   * 直接隣接のコンパレーター、または導体 1 個越しのコンパレーターが対象
   * (readComparatorBack の背面直読 / 導体越し読みに対応)。neighborChanged を直接
   * 呼び、コンパレーターは出力変化時に 2gt tile tick を予約する。
   */
  private emitComparatorUpdate(pos: Pos3D): void {
    for (const dir of CU_UPDATE_ORDER) {
      const nPos = neighbor(pos, dir)
      const nb = this.getBlockAt(nPos)
      if (nb?.type === 'comparator') { this.neighborChanged(nPos); continue }
      if (isConductor(nb)) {
        const fPos = neighbor(nPos, dir)
        if (this.getBlockAt(fPos)?.type === 'comparator') this.neighborChanged(fPos)
      }
    }
  }

  /**
   * ドロッパー/ディスペンサーの起動判定 (通常受電 ∪ QC の 1 個上受電)。
   * [確定: 26.2 DispenserBlock.neighborChanged — 自身 6 面の受電 または
   *  1 個上のマスの受電 の OR]。QC は 02 §5.3 の 3 クラスの 1 つ。
   */
  private isDropperPowered(pos: Pos3D): boolean {
    if (isBlockPowered(this, pos)) return true
    return isBlockPowered(this, [pos[0], pos[1] + 1, pos[2]])
  }

  /**
   * 安定状態になるまで tick を繰り返す（最大 4096 tick）。
   * ループ回路には使わないこと。
   */
  flush(maxTicks = 4096): void {
    for (let i = 0; i < maxTicks; i++) {
      if (this.scheduledTicks.length === 0) break
      this.tick()
    }
  }

  /**
   * これ以上「自力で」変化しない状態か (#113)。
   *
   * flush() が見ている予約 tick だけでは足りない。ピストンの押し出し確定は
   * tile tick でなく BlockEntity 相 (moving_piston の finalizeDue) で進むため、
   * 予約が尽きた瞬間に止めると押し出し途中の世界を「安定」と誤判定する。
   *
   * 対象外: ホッパー/ドロッパーの物流は BE 相のクールダウンで動き続けるため
   * ここでは見ない (アイテムが流れている限り静止しないのが正しいが、
   * settle の停止条件としては maxTicks で切る)。
   */
  isQuiescent(): boolean {
    if (this.scheduledTicks.length > 0) return false
    if (this.blockEvents.length > 0) return false
    for (const block of this.blocks.values()) {
      if (block.type === 'moving_piston') return false
    }
    return true
  }

  /**
   * 安定するまで進める (#113)。flush より安全側で、押し出し中のピストンも確定させる。
   *
   * @param maxTicks 上限。発振回路はここで打ち切られる
   * @param quietTicks 静止と判定するのに必要な連続 tick 数。既定 1
   * @returns 進めた tick 数と、静止して終わったか (false = 発振または打ち切り)
   */
  settle(maxTicks = 4096, quietTicks = 1): { ticks: number; quiescent: boolean } {
    let quiet = 0
    for (let i = 0; i < maxTicks; i++) {
      if (this.isQuiescent()) {
        quiet++
        if (quiet >= quietTicks) return { ticks: i, quiescent: true }
      } else {
        quiet = 0
      }
      this.tick()
    }
    return { ticks: maxTicks, quiescent: this.isQuiescent() }
  }

  /**
   * 現在のブロック配置から初期の安定状態を計算する。
   * buildSimWorld() 後に一度呼ぶことで、最初から置いてあるトーチや
   * 電源が入った回路の初期状態を正しく反映させる。
   *
   * アルゴリズム:
   * 1. ワイヤー電力・ランプ・固体充電状態をリセット
   * 2. ワイヤー電力を繰り返し計算（安定するまで最大100パス）
   * 3. ランプ・固体ブロックの状態を更新
   * 4. トーチ・リピーター・コンパレーターの遷移を「予約」（schedule）する
   *
   * 事後条件（呼び出し側との契約。docs/research/04 T1 で仕様化） [確定]:
   * - ワイヤー / 固体 (powered) / ランプ (lit) は安定値に確定している
   *   （Step 2-3 で収束計算済み。これらは遅延を持たない即時派生値）。
   * - トーチ / リピーター / コンパレーターなど tile tick を持つ素子は
   *   遷移を scheduledTicks に「予約」するのみで、状態自体はまだ遷移していない
   *   （flush() を呼ばないため。Step 4 の updateBlock は schedule だけ行う）。
   * - currentTick は 0 のまま。呼び出し後は tick() / flush() で手動で進める。
   *
   * flush しない理由: torch + repeater のクロック回路のように永久に安定しない
   * 回路では flush() が maxTicks まで空回りしてしまう。初期の予約だけ整えて
   * tick=0 の起点を呼び出し側に委ねることで、発振回路も正しく駆動できる
   * （fixture-runner は initialize() 後に flush(64) を明示的に呼んで settle する）。
   */
  initialize(opts: {
    trustAuthored?: boolean
    /**
     * 実機のコンパレーターが保持していた出力強度 (#249)。key は posKey。
     * 与えられた座標は Step 4b で**計算し直さずこの値をそのまま使う**
     */
    comparatorOutputs?: ReadonlyMap<string, number>
  } = {}): void {
    // trustAuthored: **動いている機械のスナップショットをそのまま出発点にする** (#240)。
    // 既定 (false) は「静止した authored 状態」を前提に動的値を捨てて組み直す。
    // クロックが回っている実機を撮ると、コンパレーターの powered などは
    // 「予約 tick が実行された結果」なので、捨てると tick 0 から実機と食い違う
    const trust = opts.trustAuthored === true
    this.scheduledTicks = []
    this.runningThisTick.clear()
    this.blockEvents = []
    this.seqCounter = 0
    // 初期組み立て中は PP を抑止 (オブザーバーは authored 安定状態のまま発火しない)
    this.suppressPP = true

    // Step 1: 動的状態をリセット (trustAuthored なら丸ごと飛ばす)
    for (const [key, block] of trust ? [] : this.blocks) {
      if (block.type === 'wire') {
        this.blocks.set(key, { ...block, power: 0 })
      } else if (block.type === 'lamp') {
        this.blocks.set(key, { ...block, lit: false })
      } else if (block.type === 'solid') {
        this.blocks.set(key, { ...block, powered: false })
      } else if (block.type === 'comparator') {
        this.blocks.set(key, { ...block, powered: false, outputPower: 0 })
      } else if (block.type === 'torch' || block.type === 'wall_torch') {
        // 初期安定状態では burnout 履歴を空にする (決定論のため)
        this.blocks.set(key, { ...block, recentToggles: [], burnedOut: false })
      } else if (block.type === 'target') {
        // vanilla TargetBlock.onPlace: POWER>0 かつ pending tick 無しの設置は
        // 0 に戻る。初期化時点で pending tick は無いため常に消灯状態から始める
        if (block.outputPower !== 0) this.blocks.set(key, { ...block, outputPower: 0 })
      } else if (block.type === 'observer') {
        // vanilla ObserverBlock.onPlace: POWERED で設置された場合は flag 18
        // (更新なし) で消灯する。authored の powered=true は無視して off から始める
        if (block.powered) this.blocks.set(key, { ...block, powered: false })
      } else if (block.type === 'detector_rail') {
        // カート検出でしか powered にならない素子。初期安定状態では不在なので
        // authored の powered=true は無視して OFF から始める (感圧板と同趣旨。#146)
        if (block.powered) this.blocks.set(key, { ...block, powered: false })
      } else if (
        block.type === 'pressure_plate_wood' || block.type === 'pressure_plate_stone' ||
        block.type === 'weighted_pressure_plate_light' || block.type === 'weighted_pressure_plate_heavy'
      ) {
        // 感圧板は entity が乗って初めて powered になる。手動モデルでは
        // authored の powered/POWER>0 (乗った状態) は初期安定状態では entity 不在の
        // ため OFF から始める (target/observer の onPlace リセットと同趣旨。決定論)
        if (block.powered) this.blocks.set(key, { ...block, powered: false })
      } else if (isPoweredRail(block)) {
        // 連鎖伝播 (isSameRailWithPower) は「隣が powered であること」を条件に
        // するため、authored 値から始めると根拠のない powered が自己維持し得る。
        // 一旦 false に落とし、Step 3 の収束ループで単調増加として組み直す。
        // shape は authored のまま (ワイヤーの接続形状と同じ方針。#51 注記)。
        // 通常レールは動力を持たないので対象外 (#140)
        if (block.powered) this.blocks.set(key, { ...block, powered: false })
      }
    }

    // (#51 注記: 保持値の接続形状は initialize では触らない — vanilla は
    //  構造ロード時に updateShape を発行せず、authored の「拡張されていない」
    //  保持値もそのまま残る。給電判定は power.ts が query 時に導出するため
    //  機能面は保持値に依存しない)

    // Step 2: ワイヤー電力を収束するまで繰り返し計算
    // （BFS だと処理順依存になるため、全体パスを繰り返す。
    //   固体の充電状態は power.ts の純クエリで都度計算されるため
    //   反復対象はワイヤーのみでよい）
    let changed = !trust
    let pass = 0
    while (changed && pass < 100) {
      changed = false
      pass++
      for (const [key, block] of this.blocks) {
        const pos = keyToPos(key)
        if (block.type === 'wire') {
          const newPower = computeWirePower(pos, this)
          if (block.power !== newPower) {
            this.blocks.set(key, { ...block, power: newPower })
            changed = true
          }
        }
      }
    }

    // Step 3: ランプと固体（表示用 powered）の状態を更新
    for (const [key, block] of trust ? [] : this.blocks) {
      const pos = keyToPos(key)
      if (block.type === 'lamp') {
        const lit = isBlockPowered(this, pos)
        if (block.lit !== lit) this.blocks.set(key, { ...block, lit })
      } else if (block.type === 'solid') {
        const powered = isSolidPowered(this, pos)
        if (block.powered !== powered) this.blocks.set(key, { ...block, powered })
      } else if (block.type === 'note_block') {
        // 音符ブロックの POWERED は authored 安定状態に合わせるだけで発音しない
        // (初期状態は既に鳴り終わった相当。26.2 も onPlace で発音しない)。
        const powered = isBlockPowered(this, pos)
        if (block.powered !== powered) this.blocks.set(key, { ...block, powered })
      } else if (block.type === 'hopper') {
        // 受電で enabled を確定 (ロック)。cooldownUntil は 0 にリセットして即転送可に。
        // count (内容) は authored 保持 (物流の初期条件)。
        const enabled = !isBlockPowered(this, pos)
        this.blocks.set(key, { ...block, enabled, cooldownUntil: 0 })
      } else if (block.type === 'dropper' || block.type === 'dispenser') {
        // 受電で triggered を確定するが initialize では発火しない (tile tick 予約なし。
        // authored 安定状態は「既に発火済み」相当。runtime の立ち上がりでのみ発火)。
        const powered = this.isDropperPowered(pos)
        if (block.triggered !== powered) this.blocks.set(key, { ...block, triggered: powered })
      }
    }

    // Step 3b: パワードレールの powered を収束するまで繰り返し計算。
    // 連鎖は「隣接レールが powered」を条件にするため 1 パスでは広がらない。
    // Step 1 で false に落としてあるので単調増加として収束する (ワイヤーと同趣旨)。
    let railChanged = !trust
    let railPass = 0
    while (railChanged && railPass < 100) {
      railChanged = false
      railPass++
      for (const [key, block] of this.blocks) {
        if (!isPoweredRail(block)) continue
        const powered = shouldRailBePowered(this, keyToPos(key), block.shape, block.type)
        if (block.powered !== powered) {
          this.blocks.set(key, { ...block, powered })
          railChanged = true
        }
      }
    }

    // Step 4: トーチ・リピーター・コンパレーターの初期スケジュール登録。
    // 土台が充電されているトーチは消灯を、後面に動力が来ているリピーターは
    // turn_on を、入力のあるコンパレーターは出力を schedule する。
    // ここを抜くとクロック回路（torch + repeater のフィードバック）が
    // tick=0 で何もスケジュールされず発振開始しない。
    // trustAuthored のときはここも飛ばす。**実機から読んだ予約を後から積む**ので、
    // sim が自前で予約を組み直すと二重になる
    for (const [key] of trust ? [] : this.blocks) {
      const pos = keyToPos(key)
      const b = this.getBlockAt(pos)
      if (
        b?.type === 'torch' ||
        b?.type === 'wall_torch' ||
        b?.type === 'repeater' ||
        b?.type === 'comparator' ||
        b?.type === 'piston' ||
        b?.type === 'sticky_piston'
      ) {
        this.neighborChanged(pos)
      }
    }

    // Step 4b: **blockstate に出ない値だけは trustAuthored でも組み直す** (#240)。
    //
    // コンパレーターの出力強度は BlockEntity の OutputSignal で、blockstate には
    // powered (0 か否か) しか出ない。実機のスナップショットを読んでも強度が分からず、
    // 0 のままだと下流のダストが丸ごと 0 になる
    // (実機の最小再現 elevator-observer-min: 実機 15 / sim 0 で発覚)。
    //
    // **実機から読めた値があればそれを使う** (#249)。計算し直しでよいのは
    // 止まっている回路だけで、信号が周回しながら 1 ずつ減っていく機械では
    // コンパレーターが「まだ書き換わっていない古い値」を持っている。
    // 計算し直すと最初から新しい値になり、予約が発火しても何も変わらず**機械が止まる**
    // (実機 fixture elev-dust-decay-min: 実機は 15→14→13、sim は 15 のまま不動)。
    // 読めなかった座標は従来どおり今の入力から計算する
    if (trust) {
      for (const [key, block] of this.blocks) {
        if (block.type !== 'comparator') continue
        const captured = opts.comparatorOutputs?.get(key)
        const out = captured !== undefined
          ? captured
          : block.powered ? this.computeComparatorOutput(keyToPos(key), block) : 0
        if (block.outputPower !== out) this.blocks.set(key, { ...block, outputPower: out })
      }
    }

    // Step 5: スケジュール済みティックを処理して安定化（クロック回路では呼ばない）
    // initialize() 後は tick=0 の初期状態から手動で進める想定のため flush は行わない

    // 初期組み立て完了。以降 (tick / flush / activateBlock) の状態変化は PP を発行する
    this.suppressPP = false
  }

  /**
   * 実機から読んだ予約 tick をそのまま積む (#240)。
   *
   * **ブロック状態だけでは動いている機械を再現できない**。リピーターの
   * 「あと 5gt で ON」のような予約は blockstate に出ないため、実機のスナップショットを
   * そのまま読ませても出発点が揃わない。実機側は保存データ (チャンク NBT の
   * `block_ticks`) から残り遅延と優先度を読める
   * [確定: 26.2 SavedTick — codec は i=type / t=delay / p=priority、
   *  unpack が `currentTick + delay` を発火 tick にする]。
   *
   * `initialize()` の**後**に呼ぶこと (initialize は予約を空にする)。
   */
  seedScheduledTick(pos: Pos3D, delay: number, priority: number): boolean {
    const block = this.getBlockAt(pos)
    if (!block || block.type === 'air') return false
    this.scheduledTicks.push({
      pos: [...pos] as Pos3D,
      blockType: block.type,
      dueTick: this.currentTick + Math.max(0, Math.floor(delay)),
      priority,
      seq: this.seqCounter++,
    })
    return true
  }

  /**
   * `/setblock` 相当のブロック差し替え (#127)。**BUD の検証に使う**。
   *
   * vanilla の SetBlockCommand は **flag 2 | 256** で置く。
   * flag に **UPDATE_NEIGHBORS (1) が立っていない**ので置いた瞬間は近隣更新を出さず、
   * そのあと `updateNeighboursOnBlockSet` → `updateNeighborsAt` で
   * **周囲 6 方向にだけ**更新を配る (自分自身には配らない)
   * [確定: 26.2 SetBlockCommand.setBlock / ServerLevel.updateNeighboursOnBlockSet]。
   *
   * **置いた位置自身も再評価する**。`BaseRailBlock.onPlace` は「置き換え前と同じブロック種の
   * 上書きなら updateState を呼ばない」ように読めるが、**実機 1.21.1 で試すと同種上書きでも powered は保持されず
   * 即座に再計算される** (リピーターの powered / ランプの lit も同様に落ちる)。
   * `/setblock ... strict` (onPlace を飛ばす flag 512) は 1.21.1 には無く、carpet の
   * scarpet `set()` でも同じだった。実機の観測に合わせてここでも自身を再評価する。
   * [実測: 2026-08-12 / 26.2 のデコンパイルとは読みが食い違うため要追調査]
   *
   * ∴ 実機ハーネスでは「更新を伴わないブロック差し替え」は作れない。BUD の検証は
   * 「既に on のレールは値が変わらないので近隣更新を再送しない」性質を使って行う
   * (fixture powered-rail-bud)。
   *
   * 既知の限定: onPlace の形状決定はレールのみ再現。他の素子を setblock する fixture を
   * 書くときはここに追加すること。
   */
  setBlockCommand(pos: Pos3D, block: BlockState): void {
    const old = this.getBlockAt(pos)
    this.setBlockAt(pos, block)

    // 形状の決め直しは「種が変わったとき」だけ (BaseRailBlock.updateState の updateDir 相当)
    if (isRail(block) && !isRail(old)) {
      this.applyRailPlacement(pos, block.shape)
    }

    this.neighborChanged(pos)   // 置いた位置自身の再評価 (上記の実測に合わせる)
    this.emitShapeUpdate(pos)   // flag に UPDATE_KNOWN_SHAPE(16) が無い → updateShape は飛ぶ
    this.submitMultiNC(pos)     // updateNeighborsAt 相当 — 周囲 6 方向のみ
    // **ワイヤーの電力も配り直す** (#259)。sim ではダストは neighborChanged に
    // 反応せず propagateChange 経由でしか更新されないので、これが無いと
    // `/setblock redstone_block` を置いてもダストが 0 のままになる
    // (vanilla は RedStoneWireBlock.neighborChanged → updateSurroundingRedstone で更新する)
    this.propagateChange(pos)
  }

  /**
   * レールを置いた (または押されて着地した) ときの形状決定を世界へ適用する。
   * vanilla の `BaseRailBlock.updateDir` → `RailState.place` に対応する
   * [確定: 26.2 BaseRailBlock.java:111-118]。
   *
   * **形状を書いた各レールが更新源になる** (#132)。vanilla は RailState.place も
   * connectTo も **flag 3 の setBlock** で書く [確定: 26.2 RailState.java:205,333]。
   * flag 3 = UPDATE_NEIGHBORS(1) | UPDATE_CLIENTS(2) なので
   *   - flag 1  → そのレールが周囲 6 方向へ近隣更新を配る
   *   - 16 が無い → updateNeighbourShapes が走り隣接オブザーバーが発火する
   * [実機 fixture rail-shape-update: 張り替わった隣レールの近隣にある BUD ピストンが
   *  伸び、真上のオブザーバーも発火する。置いた本人以外が更新源になることの直接証拠]
   *
   * 書き込みと発行は **1 件ずつ交互に** 行う。vanilla も自分の setBlock を済ませてから
   * 隣の connectTo に入るので、自分の近隣更新が走る時点では隣はまだ旧形状のままになる。
   * planRailPlacement は副作用を持たない (計算結果を返すだけ) 設計を維持し、
   * 更新の発行は適用側であるここが担う。
   *
   * @returns 実際に形状を書いた座標 (呼び出し側が changed セットに積むため)
   */
  private applyRailPlacement(pos: Pos3D, defaultShape: RailShape, first = true): Pos3D[] {
    const written: Pos3D[] = []
    // hasSignal は通常レールの曲線の優先順位にだけ効く [確定: 26.2 BaseRailBlock.updateDir
    // が「その位置が受電しているか」を place へ渡す]。
    // first=false は実行中の再計算 (RailBlock.updateState) 経路で、形状が変わらなければ
    // ワールドへの書き込みごと起きない = 更新も出ない (#142)
    for (const c of planRailPlacement(this, pos, defaultShape, isBlockPowered(this, pos), first)) {
      const b = this.getBlockAt(c.pos)
      if (!isRail(b)) continue
      // 曲線を取れるのは通常レールだけ。直線レールに曲線が割り当たることは
      // RailConnector の straight ガードにより起こらないが、型でも守っておく
      if (b.type === 'rail') this.setBlockAt(c.pos, { ...b, shape: c.shape })
      else if (isStraightRailShape(c.shape)) this.setBlockAt(c.pos, { ...b, shape: c.shape })
      else continue
      written.push(c.pos)
      this.emitShapeUpdate(c.pos)
      this.submitMultiNC(c.pos)
    }
    return written
  }

  // ── プレイヤー操作（PIフェーズ相当） ────────────────────

  activateBlock(x: number, y: number, z: number): void {
    const pos: Pos3D = [x, y, z]
    const block = this.getBlockAt(pos)
    if (!block) return

    if (block.type === 'lever') {
      const next: LeverState = { ...block, powered: !block.powered }
      this.setBlockAt(pos, next)
      const action: TraceAction = next.powered ? 'n' : 'f'
      this.traceProcess('PI', 'Le', action, 0)
      this.traceOpenUpdate(pos)
      this.emitShapeUpdate(pos)
      this.propagateChange(pos)
      this.traceCloseUpdate('Le', action, 0, 'PI')
    } else if (block.type === 'button_stone' || block.type === 'button_wood') {
      if (block.powered) return  // 既に押されている
      const next: ButtonState = { ...block, powered: true }
      this.setBlockAt(pos, next)
      this.traceProcess('PI', 'Bu', 'n', 0)
      this.traceOpenUpdate(pos)
      this.emitShapeUpdate(pos)
      this.propagateChange(pos)
      this.traceCloseUpdate('Bu', 'n', 0, 'PI')
      // ボタン持続 [確定: 02 §6 lever/button — Blocks.java の ticksToStayPressed を
      // 1.21.1 デコンパイルで確認]: 石系 20 gt / 木系 30 gt。schedule の delay は
      // game tick 単位なのでそのまま渡す。
      const delay = block.type === 'button_stone' ? 20 : 30
      // ボタンは delay gt 後にオフ (実行時再評価: powered なら消す)
      this.schedule(pos, delay, 0)
    } else if (block.type === 'target') {
      // ターゲットは投射物系を持たないため activateBlock で命中を手動トリガする。
      // [確定: 1.21.1 TargetBlock.updateRedstoneOutput] 既存 tick 中の再発火は無視。
      // 中心命中相当の 15 を出し、矢の持続 20gt (ACTIVATION_TICKS_ARROWS) 後に
      // tile tick (priority 0) で消灯する。
      if (this.hasScheduledTick(pos, 'target')) return
      const next: TargetState = { ...block, outputPower: 15 }
      this.setBlockAt(pos, next)
      this.traceProcess('PI', 'Tg', 'n', 0)
      this.traceOpenUpdate(pos)
      this.emitShapeUpdate(pos)
      this.propagateChange(pos)
      this.traceCloseUpdate('Tg', 'n', 0, 'PI')
      this.schedule(pos, 20, 0)
    } else if (block.type === 'door_wood') {
      // 素手で開閉する [確定: 26.2 DoorBlock.useWithoutItem — canOpenByHand]。
      // トラップドアと同じく **open だけ**動き powered は据え置かれる。
      // vanilla は押した半分だけを書き換え、相方は updateShape で追従するので
      // sim では両方に反映する。鉄のドアはここに来ない
      const open = !block.open
      this.setBlockAt(pos, { ...block, open })
      this.emitShapeUpdate(pos)
      const otherPos: Pos3D = block.half === 'lower'
        ? [pos[0], pos[1] + 1, pos[2]]
        : [pos[0], pos[1] - 1, pos[2]]
      const other = this.getBlockAt(otherPos)
      if (other?.type === 'door_wood' && other.half !== block.half) {
        this.setBlockAt(otherPos, { ...other, open })
        this.emitShapeUpdate(otherPos)
      }
      this.traceProcess('PI', 'Do', open ? 'n' : 'f', 0)
      this.traceOpenUpdate(pos)
      this.traceCloseUpdate('Do', open ? 'n' : 'f', 0, 'PI')
    } else if (block.type === 'trapdoor_wood' || block.type === 'fence_gate') {
      // 素手で開閉する [確定: 26.2 TrapDoorBlock.useWithoutItem — canOpenByHand]。
      // **open だけが動き powered は据え置かれる**ので、給電中に手で閉めると
      // 信号が変わるまで閉じたまま残る (意図的なデシンク)。
      // 鉄のトラップドアは canOpenByHand=false なのでここに来ない
      const next: DoorLikeState = { ...block, open: !block.open }
      this.setBlockAt(pos, next)
      this.traceProcess('PI', abbrOf(next), next.open ? 'n' : 'f', 0)
      this.traceOpenUpdate(pos)
      this.emitShapeUpdate(pos)
      this.traceCloseUpdate(abbrOf(next), next.open ? 'n' : 'f', 0, 'PI')
    } else if (block.type === 'detector_rail') {
      // マインカートの「乗り込み」を手動トリガする (#146)。既に powered なら no-op
      // [確定: 26.2 DetectorRailBlock.entityInside — POWERED が既に true なら何もしないガード付き]。
      // ON → 20gt (PRESSED_CHECK_PERIOD) 後の tile tick で checkPressed が
      // カート不在と再評価して自動 OFF する (感圧板と同型の折衷モデル)。
      // [実機 fixture detector-rail-cart-pulse: t3 検出 → t23 OFF]
      if (block.powered) return
      const next: DetectorRailState = { ...block, powered: true }
      this.setBlockAt(pos, next)
      this.traceProcess('PI', 'Dt', 'n', 0)
      this.traceOpenUpdate(pos)
      this.emitShapeUpdate(pos)
      this.propagateChange(pos)
      this.traceCloseUpdate('Dt', 'n', 0, 'PI')
      this.schedule(pos, 20, 0)  // [確定: 26.2 PRESSED_CHECK_PERIOD = 20]
    } else if (block.type === 'pressure_plate_wood' || block.type === 'pressure_plate_stone') {
      // 感圧板の「踏まれ」を手動トリガする。既に踏まれていれば no-op
      // (vanilla entityInside の signal==0 ガード相当)。ON → 20gt (getPressedTime)
      // 後の tile tick で checkPressed が entity=0 と再評価して自動 OFF する。
      if (block.powered) return
      const next: PressurePlateState = { ...block, powered: true }
      this.setBlockAt(pos, next)
      this.traceProcess('PI', 'Pp', 'n', 0)
      this.traceOpenUpdate(pos)
      this.emitShapeUpdate(pos)
      this.propagateChange(pos)
      this.traceCloseUpdate('Pp', 'n', 0, 'PI')
      this.schedule(pos, 20, 0)  // [確定: 26.2 BasePressurePlateBlock.getPressedTime]
    } else if (
      block.type === 'weighted_pressure_plate_light' ||
      block.type === 'weighted_pressure_plate_heavy'
    ) {
      // 重量板: 設定信号 pressedPower を出力。0 以下は vanilla の count==0 相当で no-op。
      // ON → 10gt (getPressedTime) 後の tile tick で自動 OFF。
      if (block.powered || block.pressedPower <= 0) return
      const next: WeightedPressurePlateState = { ...block, powered: true }
      this.setBlockAt(pos, next)
      this.traceProcess('PI', 'Wp', 'n', 0)
      this.traceOpenUpdate(pos)
      this.emitShapeUpdate(pos)
      this.propagateChange(pos)
      this.traceCloseUpdate('Wp', 'n', 0, 'PI')
      this.schedule(pos, 10, 0)  // [確定: 26.2 WeightedPressurePlateBlock.getPressedTime]
    } else if (block.type === 'lectern') {
      // ページをめくる (#240)。実機では最終ページの次はめくれないが、
      // **UI から任意の階を選べるようにする**ため 0 に戻す折衷にする
      // (樽の +1 と同型。信号の伝わり方 = CU だけ実機と揃える)
      if (!block.hasBook || block.pages <= 1) return
      const page = (block.page + 1) % block.pages
      this.setBlockAt(pos, { ...block, page })
      this.traceProcess('PI', 'Lc', 'n', 0)
      this.traceOpenUpdate(pos)
      this.emitComparatorUpdate(pos)
      this.traceCloseUpdate('Lc', 'n', 0, 'PI')
    } else if (block.type === 'container') {
      // 樽/チェストの中身を手で 1 段階増やす (#236)。15 の次は 0 に戻る。
      // vanilla に「1 回叩くと 1 段上がる」操作は無く、これは**プレイヤーが
      // 中身を出し入れする行為の折衷**。信号の変わり方 (CU) だけは実物と揃える
      this.setContainerSignal(x, y, z, (effectiveContainerSignal(block) + 1) % 16)
    }
  }

  /**
   * コンテナの中身を差し替えて、コンパレーターに伝える (#236)。
   *
   * [確定: 26.2 BlockEntity.setChanged → Level.updateNeighbourForOutputSignal]
   * 中身は BlockEntity の情報なので **blockstate は変わらない**。したがって
   * PP (オブザーバー起動) も NC も出ず、**水平 4 方向のコンパレーターにだけ**
   * 更新が飛ぶ (直接隣接、または導体 1 個越し)。真上のコンパレーターは反応しない。
   *
   * `slots` を持つコンテナ (物流モード) は、その信号になる最小個数へ組み替える。
   */
  /**
   * コンテナの 1 スロットを差し替える (`/item replace block <pos> container.<n>` 相当。#236)。
   *
   * [確定: 26.2 ItemCommands.setBlockItem → Container.setItem →
   *  BaseContainerBlockEntity.setItem — 末尾で setChanged を呼ぶ]
   * プレイヤーが GUI でアイテムを動かしたときと**同じ経路**なので、実機 fixture の
   * 入力にこれを使える。伝わるのは `setContainerSignal` と同じ CU だけ。
   */
  setContainerSlot(x: number, y: number, z: number, slot: number, item: ItemStack | null): void {
    const pos: Pos3D = [x, y, z]
    const block = this.getBlockAt(pos)
    if (!block || !isContainerType(block.type)) return
    const slots = (containerSlotsOf(block) ?? emptySlots(block.type)).slice()
    if (slot < 0 || slot >= slots.length) return
    slots[slot] = item
    this.setBlockAt(pos, { ...block, slots } as BlockState)
    this.traceProcess('PI', abbrOf(block), 'n', 0)
    this.traceOpenUpdate(pos)
    this.emitComparatorUpdate(pos)
    this.traceCloseUpdate(abbrOf(block), 'n', 0, 'PI')
  }

  /** 書見台のページを直接指定する (#240)。実機の `/data modify block ... Page` に対応 */
  setLecternPage(x: number, y: number, z: number, page: number): void {
    const pos: Pos3D = [x, y, z]
    const block = this.getBlockAt(pos)
    if (!block || block.type !== 'lectern') return
    const p = Math.max(0, Math.min(Math.max(0, block.pages - 1), Math.floor(page)))
    if (p === block.page) return
    this.setBlockAt(pos, { ...block, page: p })
    this.traceProcess('PI', 'Lc', 'n', 0)
    this.traceOpenUpdate(pos)
    this.emitComparatorUpdate(pos)
    this.traceCloseUpdate('Lc', 'n', 0, 'PI')
  }

  setContainerSignal(x: number, y: number, z: number, signal: number): void {
    const pos: Pos3D = [x, y, z]
    const block = this.getBlockAt(pos)
    if (!block || block.type !== 'container') return
    const s = Math.max(0, Math.min(15, Math.floor(signal)))
    // 値が変わらなくても CU は飛ばす。vanilla の setChanged は**中身が動いたら
    // 無条件**に updateNeighbourForOutputSignal を呼ぶ (同じ強度のまま 1 個入れ替えても
    // 呼ばれる)。コンパレーター側が出力差分で予約するので観測結果は変わらない
    const next: ContainerState = block.slots !== undefined
      ? { ...block, slots: slotsForSignal('container', s) }
      : { ...block, signal: s }
    this.setBlockAt(pos, next)
    this.traceProcess('PI', 'Cn', s > 0 ? 'n' : 'f', 0)
    this.traceOpenUpdate(pos)
    this.emitComparatorUpdate(pos)
    this.traceCloseUpdate('Cn', s > 0 ? 'n' : 'f', 0, 'PI')
  }

  // ── 状態クエリ ───────────────────────────────────────────

  isPowered(x: number, y: number, z: number): boolean {
    return this.getPowerLevel(x, y, z) > 0
  }

  /**
   * 指定座標の「受信している信号強度」を返す。
   * ワイヤーは power プロパティ、それ以外は powered フラグ (0 or 15)。
   */
  getPowerLevel(x: number, y: number, z: number): number {
    const block = this.getBlock(x, y, z)
    if (!block) return 0
    switch (block.type) {
      case 'wire':          return block.power
      case 'lever':         return block.powered ? 15 : 0
      case 'button_stone':
      case 'button_wood':   return block.powered ? 15 : 0
      case 'pressure_plate_wood':
      case 'pressure_plate_stone': return block.powered ? 15 : 0
      case 'detector_rail':  return block.powered ? 15 : 0
      case 'weighted_pressure_plate_light':
      case 'weighted_pressure_plate_heavy': return block.powered ? block.pressedPower : 0
      case 'lamp':          return block.lit ? 15 : 0
      case 'solid':         return block.powered ? 15 : 0
      case 'redstone_block': return 15
      case 'target':        return block.outputPower
      case 'observer':      return block.powered ? 15 : 0
      default:              return 0
    }
  }

  // ── スナップショット ─────────────────────────────────────

  snapshot(): WorldSnapshot {
    const blocks = new Map(this.blocks) as WorldSnapshot['blocks']
    let minX = Infinity, maxX = -Infinity
    let minY = Infinity, maxY = -Infinity
    let minZ = Infinity, maxZ = -Infinity
    for (const key of this.blocks.keys()) {
      const [x, y, z] = keyToPos(key)
      if (x < minX) minX = x; if (x > maxX) maxX = x
      if (y < minY) minY = y; if (y > maxY) maxY = y
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z
    }
    if (!isFinite(minX)) { minX = 0; maxX = 0; minY = 0; maxY = 0; minZ = 0; maxZ = 0 }
    return { blocks, bounds: { x: [minX, maxX], y: [minY, maxY], z: [minZ, maxZ] } }
  }

  clone(): SimWorld {
    const w = new SimWorld()
    w.blocks = new Map(this.blocks)
    w.scheduledTicks = this.scheduledTicks.map(t => ({ ...t, pos: [...t.pos] as Pos3D }))
    w.runningThisTick = new Set(this.runningThisTick)
    w.blockEvents = this.blockEvents.map(e => ({ ...e, pos: [...e.pos] as Pos3D }))
    w.currentTick = this.currentTick
    w.seqCounter = this.seqCounter
    return w
  }

  // ── 内部: ScheduledTick 実行 ─────────────────────────────

  /**
   * tile tick の実行。action は予約に含まれず、**実行時に世界状態を再評価**して
   * 動作を決める (02 §2 [確定]。G1 の短パルス永久ラッチはこれで構造的に解消)。
   */
  private executeScheduledTick(tick: ScheduledTick): string[] {
    const { pos } = tick
    const block = this.getBlockAt(pos)
    // 実行時検証: ブロック種が予約時と違えば no-op (vanilla 準拠)
    if (!block || block.type !== tick.blockType) return []

    const changed: string[] = []
    const apply = (next: BlockState, action: TraceAction) => {
      this.setBlockAt(pos, next)
      changed.push(posKey(pos))
      // トレース: ST 実行 (08 §1 の "{}")。abbr は確定先 (moving_piston は into)。
      this.traceProcess('ST', abbrOf(next), action, elemDelay(block))
      this.traceOpenUpdate(pos)
      // vanilla の setBlock 相当: 観測可能な blockstate 変化があれば PP を発行し
      // (オブザーバー起動)、続いて NC を伝播する
      if (observableChanged(block, next)) this.emitShapeUpdate(pos)
      this.propagateChange(pos)
      this.traceCloseUpdate(abbrOf(next), action, elemDelay(block), 'ST')
    }

    if (block.type === 'torch' || block.type === 'wall_torch') {
      // vanilla RedstoneTorchBlock.tick を忠実に再現 (02 §6 torch [確定])。
      // tick 冒頭で 60gt (RECENT_TOGGLE_TIMER) より古い消灯記録を刈る。
      // burnedOut は「窓内 8 件で点灯が抑止される」状態を表す表示用の計算値。
      // 抑止判定・復帰判定はすべて tick 実行時のトグル件数ゲートで行い、
      // 復帰用の 160gt (RESTART_DELAY) tile tick は消灯遷移時に予約する
      // (vanilla の tick() に対応: LIT かつ基給電→消灯+8件で焼き切れ160予約、
      //  非 LIT かつ基無給電かつ 8 件未満→点灯)。
      const now = this.currentTick
      const toggles = pruneToggles(block.recentToggles, now)
      const basePowered = isTorchBasePowered(pos, this)
      const prevLen = block.recentToggles?.length ?? 0
      const wasBurned = block.burnedOut ?? false

      if (block.lit && basePowered) {
        // 点灯中に基が給電 → 消灯。消灯のたび記録を 1 件追加し、
        // 同 pos の記録が 8 件 (MAX_RECENT_TOGGLES) に達したら焼き切れ。
        const next = [...toggles, now]
        const tooFrequent = next.length >= MAX_RECENT_TOGGLES
        apply({ ...block, lit: false, recentToggles: next, burnedOut: tooFrequent }, 'f')
        if (tooFrequent) {
          // 焼き切れ復帰用に 160gt の tile tick を予約する。
          // ただし自励発振では上の apply 伝播中に基が無給電化し、自 NC が 2gt を
          // 先取り予約するため、重複予約デデュープでこの 160gt は無視される
          // (= vanilla 同様「自励クロックは焼き切れると復帰しない」)。
          // 外部駆動 (基が給電され続ける) では自 NC が起きず 160gt が生き、
          // 基開放後に復帰する。音/パーティクル (levelEvent 1502) は対象外。
          this.schedule(pos, RESTART_DELAY, 0)
        }
      } else if (!block.lit) {
        // 消灯中: 基が無給電かつ窓内 8 件未満なら点灯 (記録は追加しない)。
        // 8 件あれば点灯抑止 = 焼き切れの実体 (vanilla の !isToggledTooFrequently)。
        const tooFrequent = toggles.length >= MAX_RECENT_TOGGLES
        if (!basePowered && !tooFrequent) {
          apply({ ...block, lit: true, recentToggles: toggles, burnedOut: false }, 'n')
        } else if (toggles.length !== prevLen || wasBurned !== tooFrequent) {
          // 遷移なし。刈った履歴と burnedOut 表示だけ整える (出力不変なので伝播しない)。
          this.setBlockAt(pos, { ...block, recentToggles: toggles, burnedOut: tooFrequent })
        }
      } else if (toggles.length !== prevLen || wasBurned) {
        // 点灯中で基無給電 (遷移なし)。刈った履歴と burnedOut 表示を整える。
        this.setBlockAt(pos, { ...block, recentToggles: toggles, burnedOut: false })
      }
    } else if (block.type === 'bubble_column') {
      // [確定: 26.2 BubbleColumnBlock.tick → updateColumn]
      // 予約が来たら柱を評価し直す。書き換えは updateBubbleColumn が同期で行う
      for (const k of this.updateBubbleColumn(pos)) changed.push(k)
      for (const k of this.updateWaterFlow(pos)) changed.push(k)
    } else if (block.type === 'water') {
      for (const k of this.updateWaterFlow(pos)) changed.push(k)
    } else if (block.type === 'lamp') {
      // vanilla RedstoneLampBlock.tick: 消灯 tick は「LIT かつ無入力」なら消灯。
      // 点灯は neighborChanged で即時なので、ここでは消灯のみ扱う。
      // tick 時点で再点灯 (再入力) されていれば no-op (vanilla 準拠)。
      if (block.lit && !isBlockPowered(this, pos)) apply({ ...block, lit: false }, 'f')
    } else if (block.type === 'repeater') {
      // vanilla DiodeBlock.tick: ロック中は何もしない。ロック判定は保持している
      // LOCKED プロパティではなく実行時に再評価する (isLocked を毎回問い合わせる)
      // [確定: 02 §6 repeater / G9]。
      // オン遷移は入力が既に消えていても行い、その場で自身のオフを予約する
      // (最小パルス幅 = 遅延の根拠。02 §6 repeater [確定])
      if (!this.isRepeaterLocked(pos, block)) {
        const input = this.isRepeaterInputPowered(pos, block)
        if (block.powered && !input) {
          apply({ ...block, powered: false }, 'f')
        } else if (!block.powered) {
          apply({ ...block, powered: true }, 'n')
          if (!input) {
            this.schedule(pos, block.delay * 2, this.diodeTickPriority(pos, block, true))
          }
        }
      }
    } else if (block.type === 'comparator') {
      // 出力を今再計算して適用 (キャンセル API は廃止済み)
      const newOutputPower = this.computeComparatorOutput(pos, block)
      const newPowered = newOutputPower > 0
      if (block.powered !== newPowered || block.outputPower !== newOutputPower) {
        apply({ ...block, powered: newPowered, outputPower: newOutputPower }, 'c')
      }
    } else if (block.type === 'button_stone' || block.type === 'button_wood') {
      if (block.powered) apply({ ...block, powered: false }, 'f')
    } else if (block.type === 'detector_rail') {
      // vanilla DetectorRailBlock.tick → checkPressed: powered のときカートを数え直す。
      // 折衷モデルは entity を持たないので常に 0 = OFF (再予約もしない)。#146
      if (block.powered) apply({ ...block, powered: false }, 'f')
    } else if (
      block.type === 'pressure_plate_wood' || block.type === 'pressure_plate_stone' ||
      block.type === 'weighted_pressure_plate_light' || block.type === 'weighted_pressure_plate_heavy'
    ) {
      // vanilla BasePressurePlateBlock.tick → checkPressed: signal>0 のとき
      // getSignalStrength を再評価する。手動モデルは entity を持たないため
      // 再評価値は常に 0 = OFF (isPressed false → reschedule なし)。ボタンと同型
      if (block.powered) apply({ ...block, powered: false }, 'f')
    } else if (block.type === 'target') {
      // vanilla TargetBlock.tick: OUTPUT_POWER != 0 なら 0 に戻す (消灯)
      if (block.outputPower !== 0) apply({ ...block, outputPower: 0 }, 'f')
    } else if (block.type === 'observer') {
      // vanilla ObserverBlock.tick [確定: 02 §2.4/§6 observer]。
      // apply を使わず順序を明示制御する:
      //   OFF→ON: powered=true → 自身の OFF tick(2gt) を「近傍更新より先に」予約
      //           → 背面へ NC (updateNeighborsInFront)
      //   ON→OFF: powered=false → 背面へ NC
      //   いずれも setBlock (flag2) 相当の PP を先に発行 (オブザーバー連鎖の根拠)。
      // OFF 予約を propagateChange (背面 NC) より前に置くことが §2.4 の
      // 「コンパレーターがオブザーバー単体のパルスを飲み込む」順序の要。
      const next: ObserverState = { ...block, powered: !block.powered }
      this.setBlockAt(pos, next)
      changed.push(posKey(pos))
      // #75: 他の STC 素子と対称に実行トレース (Ob{n.2}/Ob{f.2}) を出す。
      // 従来は apply() を経由せず手動で setBlock していたため実行行が欠落していた。
      this.traceProcess('ST', 'Ob', next.powered ? 'n' : 'f', 2)
      this.traceOpenUpdate(pos)
      this.emitShapeUpdate(pos)          // setBlock flag2 → PP (連鎖先オブザーバーを起動)
      if (next.powered) this.schedule(pos, 2, 0)  // OFF tick を背面 NC より先に予約
      this.propagateChange(pos)          // 背面 1 マスへ strong 15 の NC
      this.traceCloseUpdate('Ob', next.powered ? 'n' : 'f', 2, 'ST')
    } else if (block.type === 'dropper' || block.type === 'dispenser') {
      // vanilla DropperBlock.dispenseFrom (ST フェーズ) [確定: 26.2]:
      // ランダムスロットの 1 個を前方コンテナへ挿入。sim は種別なしなので count を移す。
      //
      // **ディスペンサーは挿入しない**。26.2 で DropperBlock だけが dispenseFrom を
      // override しており [確定: DropperBlock.java:48]、ディスペンサーは常にワールドへ
      // 射出する = 前方がコンテナでも入らない
      // [実機 fixture dispenser-no-insert: 同じ配置でドロッパー側だけコンパレーターが反応]
      // 既知の抽象化 (#194): vanilla の dispenseFrom は**ランダムな非空スロット**を
      // 選ぶが、sim は決定性が要るので takeOne (先頭の非空スロット) で代用する。
      // 単一種のドロッパーでは差が出ない
      const taken = takeOne(block.slots)
      if (taken) {
        const destPos = neighbor(pos, block.facing)
        const dest = this.getBlockAt(destPos)
        // **バケツはワールドを書き換える** (#252)。射出ではなく前方のブロックを
        // 置く / 汲み上げるので、通常の射出経路より先に処理する
        // [確定: 26.2 DispenseItemBehavior — バケツは専用の DispenseItemBehavior を持ち、
        //  失敗したときだけ既定の射出に落ちる]
        if (block.type === 'dispenser' && (taken.item.id === 'water_bucket' || taken.item.id === 'bucket')) {
          const swapped = this.dispenseBucket(destPos, taken.item.id)
          if (swapped !== null) {
            // **スタック上限も持ち替える** (bucket=16 / water_bucket=1)。
            // これを間違えるとコンパレーターの読みがずれる
            const slots = putOne(taken.slots,
              { ...taken.item, id: swapped, stack: stackSizeOf(swapped).stack })
            // 入れ替え先が無い (満杯) ことは 1 個抜いた直後なので起きないが、
            // 起きたら何もしなかったことにする (バケツを消さない)
            if (slots !== null) {
              this.setBlockAt(pos, { ...block, slots })
              changed.push(posKey(pos), posKey(destPos))
              this.emitComparatorUpdate(pos)
            }
            return changed
          }
          // 置けない / 汲めない → 既定の射出へ落ちる (vanilla と同じ)
        }
        const destSlots = containerSlotsOf(dest)
        const put = destSlots !== undefined ? putOne(destSlots, taken.item) : null
        if (block.type === 'dropper' && dest && put) {
          // 前方コンテナに空きあり → 1 個挿入
          const d = dest as HopperState | DropperState | ContainerState
          this.setBlockAt(destPos, { ...d, slots: put } as BlockState)
          this.setBlockAt(pos, { ...block, slots: taken.slots })
          changed.push(posKey(pos), posKey(destPos))
          this.emitComparatorUpdate(destPos)
          this.emitComparatorUpdate(pos)
        } else if (block.type === 'dispenser' || !isContainerType(dest?.type)) {
          // 射出 → vanilla はアイテムエンティティを生成する。
          // エンティティ境界原則 (13 §4.2) により 1 個消費して何も出さない。
          // ディスペンサーは前方がコンテナでも常にこちら
          this.setBlockAt(pos, { ...block, slots: taken.slots })
          changed.push(posKey(pos))
          this.emitComparatorUpdate(pos)
        }
        // 前方が満杯コンテナ (canContainerAccept=false かつコンテナ種) は
        // vanilla の挿入失敗と同じく no-op (アイテムは残る)。
      }
    }

    return changed
  }

  /**
   * ダイオード系の TickPriority (02 §2.2 [確定])。
   * 前方ブロックが別のダイオードで、その出力面がこちらを向いていない
   * (= 側面/背面に給電する) とき優先度が上がる。
   */
  private diodeTickPriority(
    pos: Pos3D,
    block: RepeaterState | ComparatorState,
    turningOff: boolean,
  ): number {
    const front = this.getBlockAt(neighbor(pos, block.facing))
    const frontIsDiode = front?.type === 'repeater' || front?.type === 'comparator'
    if (frontIsDiode && (front as RepeaterState | ComparatorState).facing !== OPPOSITE[block.facing]) {
      return block.type === 'repeater' ? -3 : -1
    }
    if (block.type === 'repeater') return turningOff ? -2 : -1
    return 0
  }

  // ── ピストン (I7) ────────────────────────────────────────

  /**
   * ピストンの起動判定: 通常受電 (facing 面を除く) ∪ QC (1 個上の受電、down 面を除く)。
   * isFacePowered (weak 信号 + 充電導体) を方向除外つきで使う — 以前は包括
   * isBlockPowered を併用しており facing 面 (QC 側は down 面) の信号源を
   * 除外できていなかった (#51 の dynamic-connect-push fixture で検出: 面に
   * redstone_block が直接触れるとレバー無しで伸びてしまう)。
   * [確定: 26.2 PistonBaseBlock.getNeighborSignal — facing を除く 6 方向の
   *  hasSignal + 1 個上の DOWN を除く hasSignal]
   */
  private shouldExtend(pos: Pos3D, piston: PistonState): boolean {
    for (const dir of ALL_DIRS) {
      if (dir === piston.facing) continue
      if (isFacePowered(this, pos, dir)) return true
    }
    // QC (準接続): 1 個上のマスが受電していれば「動力源化」する (02 §4.3 / 10)。
    // NC を受けるまで活性化しない = BUD は、判定がここでなく neighborChanged /
    // BE 実行時にしか走らないことで自然に成立する
    const above: Pos3D = [pos[0], pos[1] + 1, pos[2]]
    for (const dir of ALL_DIRS) {
      if (dir === 'down') continue
      if (isFacePowered(this, above, dir)) return true
    }
    return false
  }

  /**
   * 押せるブロックか。v1 の簡略化 (PR#39 方針): ワイヤー・トーチ等の壊れ物は
   * vanilla ではアイテム化するが、アイテムエンティティが無いため「移動不可」扱い。
   * コンテナ (BE 持ち)・extended ピストン・head は vanilla どおり不動。
   *
   * redstone_block / target / note_block は vanilla どおり可動 (PushReaction
   * NORMAL) [確定: 26.2]。0-tick 系 (rblock 押し) と #51 の動的トポロジー
   * 変化の前提。可動な動力源により 02 §6 の既知抽象化 (moving_piston 確定が
   * sim=ST 相 / vanilla=BlockEntity 相) が「確定ブロックが下流ピストンを直接
   * 起動する連鎖」で到達可能になる — 差が出る回路は 02 §6 参照。
   */
  private isMovable(block: BlockState): boolean {
    // 黒曜石・岩盤などは押せない (#253)。[確定: 26.2 pushReaction(BLOCK)]
    // sim は材質を潰しているので取り込み時に立てた immovable で割る
    if (block.type === 'solid') return block.immovable !== true
    if (block.type === 'lamp') return true
    // 非導体でもフルブロック / スラブは PushReaction 既定 = NORMAL で可動 (#184)
    if (block.type === 'glass' || block.type === 'slab') return true
    if (block.type === 'redstone_block' || block.type === 'target' || block.type === 'note_block') return true
    if ((block.type === 'piston' || block.type === 'sticky_piston') && !block.extended) return true
    // オブザーバーは vanilla どおり可動 (PushReaction NORMAL) [確定: 26.2 + 実機 fixture
    // observer-pushed]。着地時に自分で 1 回発火する — finalizeMovingPiston を参照 (#119)
    if (block.type === 'observer') return true
    // スライム/蜂蜜も可動 (PushReaction STICKY)。くっついた塊の収集は
    // resolvePushStructure が担当する (#121)
    if (isStickyBlock(block)) return true
    // レールも可動 (PushReaction NORMAL)。26.2 の登録はどのレールも pushReaction を
    // 指定していない = 既定の NORMAL [確定: 26.2 Blocks.java:689,692,2892]
    // [実機 fixture rail-piston-push: 押されて 1 マス動き、形状は保持される]。
    // 支持ブロック要件は sim 未実装なので「押した先に床が無い」ケースは実機と乖離する
    // (実機はドロップ、sim は浮く)。fixture は移動先に床を敷いたものに限定している (#134)
    if (isRail(block)) return true
    // 装飾・大釜・コンポスターは PushReaction 既定 = NORMAL で可動 (#234)。
    // **lodestone はここに入れない** — pushReaction(BLOCK) で押せない
    // [確定: 26.2 Blocks.LODESTONE]
    if (block.type === 'decor' || block.type === 'cauldron' || block.type === 'composter') return true
    // ソウルサンドは PushReaction 既定 = NORMAL
    if (block.type === 'soul_sand') return true
    return false
  }

  /**
   * PUSH_DESTROY (押されると壊れる) ブロックか。sim ではアイテム化させず
   * 消滅させる (13 §2 エンティティ境界原則、#64)。
   * [確定: 26.2 — 各 Block の PushReaction。dust/torch/lever/button/感圧板は
   *  DESTROY。piston_head・moving_piston は isPushable=false (障害物) のまま]
   */
  private isPushDestroy(block: BlockState): boolean {
    switch (block.type) {
      case 'wire':
      case 'torch':
      case 'wall_torch':
      case 'lever':
      case 'button_stone':
      case 'button_wood':
      case 'pressure_plate_wood':
      case 'pressure_plate_stone':
      case 'weighted_pressure_plate_light':
      case 'weighted_pressure_plate_heavy':
      case 'detector_rail':
      case 'crafter':
      case 'repeater':
      case 'comparator':
        return true
      default:
        return false
    }
  }

  /**
   * 伸長時の押し構造 (26.2 PistonStructureResolver.resolve/addBlockLine 相当)。
   * - toPush: 移動するブロック (近い順)。12 個上限 [確定: 26.2 —
   *   toPush.size()>=12 のチェックが add 前 = 破壊対象は上限にカウントされない]
   * - toDestroy: チェーン終端の PUSH_DESTROY ブロック (そこで連鎖が止まり、
   *   破壊して押し出せる)。sim ではアイテム化なしで air 化する (#64)
   * 押せなければ null。retract 時の破壊は無い (26.2 resolve — DESTROY 分岐は
   * extending 時のみ。sticky は引かずに置き去りにする = 既存挙動)。
   */
  private resolvePushStructure(
    pos: Pos3D, facing: Dir6, startAt?: Pos3D, extending = true,
  ): { toPush: Pos3D[]; toDestroy: Pos3D[] } | null {
    const toPush: Pos3D[] = []
    const toDestroy: Pos3D[] = []
    const key = (p: Pos3D): string => posKey(p)
    const inPush = (p: Pos3D): number => toPush.findIndex(q => key(q) === key(p))

    /**
     * 26.2 PistonBaseBlock.isPushable。allowDestroy=false の呼びで DESTROY は不可。
     *
     * `face` は**どの向きから動かそうとしているか**。PUSH_ONLY (釉薬テラコッタ) は
     * 押し方向と一致するときだけ動く (#255)。
     * [実機実測 2026-08-20: 正面から押す → 動く / 粘着で引く → 引けず置き去り /
     *  スライムの横に置く → 引き連れられずその場に残る]
     */
    const pushable = (p: Pos3D, allowDestroy: boolean, face: Dir6): boolean => {
      const b = this.getBlockAt(p)
      if (!b) return true                                   // 空気
      if (b.type === 'piston' || b.type === 'sticky_piston') return !b.extended
      if (this.isPushDestroy(b)) return allowDestroy
      if (b.type === 'solid' && b.pushOnly === true) return face === facing
      return this.isMovable(b)                              // それ以外は BLOCK 扱い
    }

    /** 26.2 PistonStructureResolver.addBlockLine */
    const addBlockLine = (start: Pos3D, face: Dir6): boolean => {
      const first = this.getBlockAt(start)
      if (!first) return true                               // 空気 → 何も足さない
      if (!pushable(start, false, face)) return true
      if (key(start) === key(pos)) return true
      if (inPush(start) > -1) return true

      // 粘着ブロックは「後ろ (押し方向の逆)」に繋がっている塊も連れていく
      let count = 1
      if (count + toPush.length > MAX_PUSH_DEPTH) return false
      let cur = first
      while (isStickyBlock(cur)) {
        const back = offset(start, OPPOSITE[facing], count)
        const prev = cur
        const next = this.getBlockAt(back)
        if (!next
            || !canStickToEachOther(prev, next)
            // 後ろに繋がる塊は「押し方向の逆」から足しに行くので PUSH_ONLY は入らない
            || !pushable(back, false, OPPOSITE[facing])
            || key(back) === key(pos)) break
        cur = next
        if (++count + toPush.length > MAX_PUSH_DEPTH) return false
      }

      let added = 0
      for (let i = count - 1; i >= 0; i--) {
        toPush.push(offset(start, OPPOSITE[facing], i))
        added++
      }

      // 前方へ伸ばす
      for (let i = 1; ; i++) {
        const p = offset(start, facing, i)
        const collision = inPush(p)
        if (collision > -1) {
          reorderAtCollision(added, collision)
          for (let j = 0; j <= collision + added; j++) {
            const b = this.getBlockAt(toPush[j])
            if (b && isStickyBlock(b) && !addBranchingBlocks(toPush[j])) return false
          }
          return true
        }
        const b = this.getBlockAt(p)
        if (!b) return true                                 // 空気に到達 → 押せる
        if (!pushable(p, true, facing) || key(p) === key(pos)) return false
        if (this.isPushDestroy(b)) { toDestroy.push(p); return true }
        if (toPush.length >= MAX_PUSH_DEPTH) return false
        toPush.push(p)
        added++
      }
    }

    /** 26.2 reorderListAtCollision — 衝突した行を先頭側へ並べ替える */
    const reorderAtCollision = (added: number, collision: number): void => {
      const head = toPush.slice(0, collision)
      const lastLine = toPush.slice(toPush.length - added)
      const collisionToLine = toPush.slice(collision, toPush.length - added)
      toPush.length = 0
      toPush.push(...head, ...lastLine, ...collisionToLine)
    }

    /** 26.2 addBranchingBlocks — 押し方向と直交する 4 方向の「くっついている」塊を足す */
    const addBranchingBlocks = (from: Pos3D): boolean => {
      const fromState = this.getBlockAt(from)
      if (!fromState) return true
      for (const dir of ALL_DIRS) {
        if (dir === facing || dir === OPPOSITE[facing]) continue   // 押し軸は対象外
        const nPos = neighbor(from, dir)
        const nb = this.getBlockAt(nPos)
        // **枝の向きを渡す**。glazed terracotta のような PUSH_ONLY は
        // 押し方向と一致する向きからしか動かないので、横からは引き連れない (#255)
        if (nb && canStickToEachOther(nb, fromState) && !addBlockLine(nPos, dir)) return false
      }
      return true
    }

    const start = startAt ?? neighbor(pos, facing)
    const startBlock = this.getBlockAt(start)
    // 収縮では facing が「引く向き」なので、対象から見た向きはその逆になる。
    // PUSH_ONLY はこれで**引けない**側に落ちる (#255)
    const startFace = extending ? facing : OPPOSITE[facing]
    if (!pushable(start, false, startFace)) {
      // 直前が壊れ物なら破壊して終端 (26.2 resolve の DESTROY 分岐)
      if (startBlock && this.isPushDestroy(startBlock)) {
        toDestroy.push(start)
        return { toPush, toDestroy }
      }
      return startBlock ? null : { toPush, toDestroy }
    }
    if (!addBlockLine(start, startFace)) return null
    for (let i = 0; i < toPush.length; i++) {
      const b = this.getBlockAt(toPush[i])
      if (b && isStickyBlock(b) && !addBranchingBlocks(toPush[i])) return null
    }
    return { toPush, toDestroy }
  }

  private executeBlockEvent(ev: BlockEvent): string[] {
    const block = this.getBlockAt(ev.pos)
    // 実行時検証 (02 §3 [確定])
    if (!block || block.type !== ev.blockType) return []

    // 音符ブロックの発音 BE (26.2 NoteBlock.triggerEvent 相当)。
    // sim は音を鳴らさず、発音イベントを trace とコールバックへ流す (C5 #38)。
    // blockstate 変化は無い (POWERED は NC で更新済み) ため changed は空。
    if (block.type === 'note_block' && ev.param === 'play') {
      this.traceProcess('BE', 'Nb', 'n', 0)
      this.noteHook?.({ pos: ev.pos, note: block.note })
      return []
    }

    if (block.type !== 'piston' && block.type !== 'sticky_piston') return []

    const changed: string[] = []
    const piston = block as PistonState
    const sticky = piston.type === 'sticky_piston'
    const headPos = neighbor(ev.pos, piston.facing)

    // 伸長の再入は base の extended=true で (下の extend 分岐で) 弾かれる。
    // 収縮が伸長中 (head=moving) に到達するケースは #82 で retract 分岐が finalTick
    // 相当を行うため、ここでの一律 no-op ガードは撤去した (mid-retract の base=moving は
    // ev.pos のブロック種チェック (block.type !== piston) で既に弾かれている)。

    const setMoving = (
      pos: Pos3D, kind: 'normal' | 'sticky', into: BlockState, extending: boolean,
    ) => {
      // #80: 確定は ST 相の tile tick でなく BlockEntity 相 (finalizeDue) で行う。
      // ST (phase4) は BE (phase8) の前なので、旧実装では確定ブロックが同 tick 内で
      // 下流ピストンを起動していた (実機と 1tick ズレ)。vanilla は
      // PistonMovingBlockEntity.tick (phase10) で確定するため下流 BE は翌 tick 発火。
      this.setBlockAt(pos, {
        type: 'moving_piston', facing: piston.facing, kind, into, extending,
        finalizeDue: this.currentTick + 2, seq: this.seqCounter++,
      })
      changed.push(posKey(pos))
    }

    if (ev.param === 'extend') {
      if (piston.extended) return []
      // 実行時再判定 (extend 要求だが既に電源なしなら中止 = vanilla triggerEvent)
      if (!this.shouldExtend(ev.pos, piston)) return []
      const structure = this.resolvePushStructure(ev.pos, piston.facing)
      if (structure === null) {
        // 押し切れない → 失敗 (状態不変)。トレース: BE 失敗 (08 §1 の "-")
        this.traceProcess('BE', 'Pi', 'p', 0, { failed: true })
        return []
      }
      const { toPush: pushList, toDestroy } = structure

      // トレース: BE 実行 (伸長)。afterPistonMove の bu を updateFormula に収集
      this.traceProcess('BE', 'Pi', 'p', 0)
      // 破壊対象 (チェーン終端の PUSH_DESTROY) を先に air 化する
      // [確定: 26.2 moveBlocks — toDestroy を遠い順に destroy してから移動]。
      // アイテム化 (ドロップ) はさせない (13 §2、#64)。NC/PP/接続張り替えは
      // afterPistonMove が破壊座標込みで追随する
      for (let i = toDestroy.length - 1; i >= 0; i--) {
        this.setBlockAt(toDestroy[i], { type: 'air' })
        changed.push(posKey(toDestroy[i]))
      }
      // 遠い順: 押される各ブロックの行き先を moving(into=そのブロック) に
      const payloads = pushList.map(p => this.getBlockAt(p)!)
      for (let i = pushList.length - 1; i >= 0; i--) {
        setMoving(neighbor(pushList[i], piston.facing), 'normal', payloads[i], true)
      }
      // 枝分かれ (スライム/蜂蜜の塊移動) では、元位置が「他のブロックの行き先」に
      // ならないものが出る。一直線の押しだけを想定していると取り残されるので明示的に空にする (#121)
      const destKeys = new Set(pushList.map(q => posKey(neighbor(q, piston.facing))))
      for (const src of pushList) {
        const k = posKey(src)
        if (destKeys.has(k) || k === posKey(headPos)) continue
        this.setBlockAt(src, { type: 'air' })
        changed.push(k)
      }
      // head セル (= 最近接 src と同座標) を head 行きの moving に
      setMoving(headPos, sticky ? 'sticky' : 'normal', {
        type: 'piston_head', facing: piston.facing, sticky,
      }, true)
      this.setBlockAt(ev.pos, { ...piston, extended: true })
      changed.push(posKey(ev.pos))
      this.traceOpenUpdate(ev.pos)
      this.afterPistonMove([
        ev.pos, headPos,
        ...pushList.map(p => neighbor(p, piston.facing)),
        ...toDestroy,
      ])
      this.traceCloseUpdate('Pi', 'p', 0, 'BE')
    } else {
      // retract
      if (!piston.extended) return []
      // **実行時再判定**: 収縮イベントが走る時点でまだ受電していれば収縮を取り消す (#231)
      // [確定: 26.2 PistonBaseBlock.triggerEvent — 伸長イベント (b0=1/2) の実行時にまだ
      //  受電していれば、extended=true の状態を **flag 2** で書き直して false を返し、
      //  イベント自体を取り消す。flag 2 なので NC は飛ばさない]。
      // 収縮予約は「受電が切れた」瞬間の NC で積まれるが、同じ tick の ST 相で
      // オブザーバー等が再点火すると BE 相の時点では受電が戻っている。
      // これが無いと**伸びたままのはずのピストンが縮んでしまう**
      // (5×5 ドアで t=20 に早縮みしていた原因)
      if (this.shouldExtend(ev.pos, piston)) {
        this.traceProcess('BE', 'Pi', 'r', 0, { failed: true })
        return []
      }
      // トレース: BE 実行 (収縮)
      this.traceProcess('BE', 'Pi', 'r', 0)
      // #82: 収縮 BE が伸長中 (head=moving) に到達したら、まず伸長を即確定させる
      // [確定: 26.2 PistonBaseBlock.triggerEvent (b0=1/2) — head の
      //  PistonMovingBlockEntity.finalTick() で伸長を完了させてから収縮に入る]。
      // head の moving を into (piston_head) へ確定させると以降の通常収縮が
      // それを除去/引く。押された payload の moving は phase10 (tickBlockEntities)
      // で自然に確定する (finalizeDue が同 tick)。実機 observer-piston-pulse と一致。
      const headMoving = this.getBlockAt(headPos)
      if (headMoving?.type === 'moving_piston') {
        this.setBlockAt(headPos, headMoving.into)
        changed.push(posKey(headPos))
      }
      // head セルは即時消去
      if (this.getBlockAt(headPos)?.type === 'piston_head') {
        this.setBlockAt(headPos, { type: 'air' })
        changed.push(posKey(headPos))
      }
      const affected: Pos3D[] = [ev.pos, headPos]
      if (sticky) {
        // 引き戻しも vanilla は PistonStructureResolver を通る (extending=false)。
        // 押し方向は facing の逆、開始位置は piston+facing*2 = head の 1 つ先 (#121)。
        // これでスライム/蜂蜜にくっついた塊ごと引き戻せる
        const pullDir = OPPOSITE[piston.facing]
        const pullFrom = neighbor(headPos, piston.facing)

        // #231: pos+2 が**同じ向きで伸長中**の moving なら、その場で確定させて
        // 引き戻しは行わない
        // [確定: 26.2 PistonBaseBlock.triggerEvent (b0=1/2) の isSticky 分岐 —
        //  pos+2 の PistonMovingBlockEntity の向きが自分の facing と同じで、かつ
        //  伸長中なら、その BlockEntity をその場で確定 (finalTick) させ、
        //  「ピストン片あり」と扱って引き戻し (moveBlocks) を飛ばす]。
        // **確定が BE 相で起きる**のが要点で、phase10 任せにすると
        // 「そのセルを押したい下流ピストン」が翌 tick までずれる。
        // ユーザ提供の 5×5 ドアで tick 18 の押し上げが 1 tick 遅れていた原因
        const twoBlock = this.getBlockAt(pullFrom)
        if (twoBlock?.type === 'moving_piston'
          && twoBlock.facing === piston.facing && twoBlock.extending) {
          const finalized = new Set<string>()
          this.finalizeMovingPiston(pullFrom, twoBlock, finalized)
          for (const k of finalized) changed.push(k)
          // pistonPiece 相当: 引き戻しはしない
          setMoving(ev.pos, sticky ? 'sticky' : 'normal', { ...piston, extended: false }, false)
          this.traceOpenUpdate(ev.pos)
          this.afterPistonMove(affected)
          this.traceCloseUpdate('Pi', 'r', 0, 'BE')
          return changed
        }

        const pulled = this.resolvePushStructure(ev.pos, pullDir, pullFrom, false)
        const pullList = pulled ? pulled.toPush : []
        if (pullList.length > 0) {
          const payloads = pullList.map(q => this.getBlockAt(q)!)
          // 近い順に行き先 (piston 側) へ moving を置く
          for (let i = 0; i < pullList.length; i++) {
            setMoving(neighbor(pullList[i], pullDir), 'normal', payloads[i], false)
          }
          const destKeys = new Set(pullList.map(q => posKey(neighbor(q, pullDir))))
          for (const src of pullList) {
            const k = posKey(src)
            if (destKeys.has(k)) continue
            this.setBlockAt(src, { type: 'air' })
            changed.push(k)
          }
          affected.push(...pullList, ...pullList.map(q => neighbor(q, pullDir)))
        }
      }
      // base 自体が moving になり 2gt 後に縮んだ piston へ戻る (実機系列で確認)
      setMoving(ev.pos, sticky ? 'sticky' : 'normal', { ...piston, extended: false }, false)
      this.traceOpenUpdate(ev.pos)
      this.afterPistonMove(affected)
      this.traceCloseUpdate('Pi', 'r', 0, 'BE')
    }

    return changed
  }

  /**
   * 泡柱の評価 (#234)。[確定: 26.2 BubbleColumnBlock.updateColumn —
   * 起点が「占有できるマス」なら、真下と占有先から柱の状態を決めて起点に書き込み、
   * そのあと 1 マスずつ上へ進みながら占有できる限り同じ状態を書き続ける。
   * 書き込みが失敗した時点で打ち切る。書き込みフラグは 2 (近隣更新なし・形状更新あり)]
   *
   * **上へループで同期的に書き換える**ので、140 段でも 1 tick で全段が変わる
   * (これが「無遅延の縦バス」の正体)。flag 2 なので**近隣更新は出さないが
   * 形状更新は配られる** = 隣のオブザーバーは検知する。
   */
  private updateBubbleColumn(pos: Pos3D): string[] {
    const changed: string[] = []
    // 占有できるのは「泡柱」か「**水源**」。
    // **落下水 (level 8) には柱が立たない** (#252)。これがガラスエレベーターの
    // 階指定の正体で、ディスペンサーが水源を汲み上げると柱がそこで切れ、
    // 上から落ちてきた水では柱が戻らない。水源が置き直されるまで切れたまま
    const canOccupy = (b: BlockState | null): boolean =>
      b?.type === 'bubble_column' || (b?.type === 'water' && b.level === 0)
    if (!canOccupy(this.getBlockAt(pos))) return changed

    // 柱の状態は**真下**で決まる: ソウルサンド → 上向き / 泡柱 → 同じ向き /
    // それ以外 → 柱ではなくなる (水源に戻る)
    const below = this.getBlockAt([pos[0], pos[1] - 1, pos[2]])
    const next: BlockState = below?.type === 'soul_sand'
      ? { type: 'bubble_column', drag: false }
      : below?.type === 'bubble_column'
        ? { type: 'bubble_column', drag: below.drag }
        : { type: 'water', level: 0 }

    // 起点から上へ、占有できる限り同じ状態を書き込む
    const p: Pos3D = [pos[0], pos[1], pos[2]]
    for (;;) {
      const cur = this.getBlockAt(p)
      if (!canOccupy(cur)) break
      if (cur && !sameColumnState(cur, next)) {
        this.setBlockAt(p, next)
        changed.push(posKey(p))
        // flag 2 = 近隣更新なし・形状更新あり → オブザーバーだけが気づく
        this.emitShapeUpdate(p)
      }
      p[1] += 1
    }
    return changed
  }

  /** 泡柱を含む「水として振る舞うもの」か (落下水も含む) */
  private isWaterish(b: BlockState | null): boolean {
    return b?.type === 'water' || b?.type === 'bubble_column'
  }

  /** この位置の水が流動 tick を必要とするか (要らないなら予約しない) */
  private waterNeedsFlowTick(pos: Pos3D): boolean {
    const b = this.getBlockAt(pos)
    if (!this.isWaterish(b)) return false
    const below = this.getBlockAt([pos[0], pos[1] - 1, pos[2]])
    if (below === null || below.type === 'air') return true
    // 供給が絶たれた落下水は消える番
    return b?.type === 'water' && b.level === 8
      && !this.isWaterish(this.getBlockAt([pos[0], pos[1] + 1, pos[2]]))
  }

  /**
   * 水の流動 (#252)。**縦だけ**。
   *
   * ガラスエレベーターの階指定はこの経路そのもの:
   * ディスペンサーが水源を汲み上げる → 泡柱がそこで切れる →
   * 5gt 後に上から水が落ちてくるが、**落下水では柱が戻らない** →
   * 水源が置き直されるまで人が落ちる。
   *
   * 横方向の広がり (level 1-7) は実装していない (types.ts の WaterState 参照)。
   * [確定: 26.2 WaterFluid — 水の流動 tick は 5gt / FlowingFluid.spreadTo は flag 3 で置く]
   */
  private updateWaterFlow(pos: Pos3D): string[] {
    const changed: string[] = []
    const block = this.getBlockAt(pos)
    if (!this.isWaterish(block)) return changed

    // 供給が絶たれた落下水は消える (水源は消えない)
    if (block?.type === 'water' && block.level === 8
      && !this.isWaterish(this.getBlockAt([pos[0], pos[1] + 1, pos[2]]))) {
      this.setBlockAt(pos, { type: 'air' })
      changed.push(posKey(pos))
      this.emitShapeUpdate(pos)   // 下の「落下水は近隣更新を出さない」と同じ扱い
      return changed
    }

    // 下が空いていれば落とす
    const belowPos: Pos3D = [pos[0], pos[1] - 1, pos[2]]
    const below = this.getBlockAt(belowPos)
    if (below === null || below.type === 'air') {
      this.setBlockAt(belowPos, { type: 'water', level: 8 })
      changed.push(posKey(belowPos))
      // **落下水が来ても泡柱は予約し直さない**。形状更新だけ出す (泡柱と同じ flag 2 扱い)。
      // [実機 fixture bubble-column-refill-fast: 穴に落下水が来た t7 ではなく、
      //  水源を置き直した t8 の 5gt 後 = t13 に柱が戻る]。
      // 近隣更新まで出すと柱が t12 に戻ってしまい、実機と 1 tick ずれる
      // (ガラスエレベーターはディスペンサーが落下水の 1 tick 後に水源を置くので、
      //  ここがちょうど効く)。**消えるときも同じ扱いにしてある** (こちらは未測定)
      this.emitShapeUpdate(belowPos)
      // さらに下へ続く分は、この形状更新を受けた水自身が予約する
      this.neighborChanged(belowPos)
    }
    return changed
  }

  /**
   * ディスペンサーのバケツ (#252)。成功したら**入れ替わった後のアイテム ID**、
   * 何もできなければ null を返す (呼び出し側は既定の射出へ落ちる)。
   *
   * - `water_bucket` … 前が空気なら**水源**を置く → `bucket` になる
   * - `bucket` … 前が水源か泡柱なら汲み上げて空気にする → `water_bucket` になる
   *
   * ガラスエレベーターはこれで泡柱を切ったり戻したりして階を決めている
   * (実機 elev-ride: tick 52 に汲み上げ → 柱が即座に切れる)。
   * **落下水は汲めない** (水源ではないため)。
   */
  private dispenseBucket(destPos: Pos3D, itemId: string): string | null {
    const dest = this.getBlockAt(destPos)
    if (itemId === 'water_bucket') {
      // **落下水の上からでも置ける**。水は置き換え可能なので、汲み上げた穴に
      // 上から水が落ちてきた後でも水源を置き直せる
      // (実機 elev-ride: tick 1 に落下水 → tick 2 にディスペンサーが水源を置く)
      if (dest?.type === 'bubble_column') return 'bucket'   // 既に水源 → 空になるだけ
      if (dest !== null && dest.type !== 'air' && dest.type !== 'water') return null
      this.setBlockAt(destPos, { type: 'water', level: 0 })
    } else {
      const isSource = dest?.type === 'bubble_column' || (dest?.type === 'water' && dest.level === 0)
      if (!isSource) return null
      this.setBlockAt(destPos, { type: 'air' })
    }
    // vanilla は setBlock flag 3 相当。泡柱は近隣更新で 5gt の予約が入り、
    // 面しているオブザーバーは形状更新で気づく
    this.neighborChanged(destPos)
    this.emitShapeUpdate(destPos)
    this.submitMultiNC(destPos)
    return itemId === 'water_bucket' ? 'bucket' : 'water_bucket'
  }

  /**
   * 塀の形状を近傍から計算し直す (#234)。[確定: 26.2 WallBlock]
   *
   * - 各辺: 隣が塀 or フルブロックなら繋がる。**上にフルブロック/塀があれば tall**、無ければ low
   * - `up` (中央の柱): **上の塀が up=true なら自分も true**
   *   [確定: shouldRaisePost の先頭 `topNeighbourHasPost`] ← これが下方向の無遅延伝播の正体。
   *   次に「角がある」なら true、南北 or 東西が両方 tall なら false、
   *   それ以外は上のブロック次第
   *
   * 変わったら形状更新を出し (オブザーバーが検知)、**下の塀を再帰的に計算し直す**。
   * 実機では上端の 1 か所を変えると柱の全段が同じ tick で反転する。
   */
  private refreshWall(pos: Pos3D, depth = 0): void {
    if (depth > 512) return                       // 暴走よけ (実回路は 140 段)
    const w = this.getBlockAt(pos)
    if (w?.type !== 'wall') return

    const above = this.getBlockAt([pos[0], pos[1] + 1, pos[2]])
    /**
     * その辺を tall にするか。[確定: 26.2 WallBlock.makeWallState —
     * 上のブロックの当たり判定が**その辺の位置**を覆っていれば tall]。
     * 上がフルブロックなら全辺 tall。上が塀なら**同じ辺が繋がっているときだけ** tall
     * (塀の当たり判定は中央の柱 + 繋がっている辺だけなので、
     *  上の塀が none の辺は下の辺を持ち上げない)。実機で確認:
     * 上端の北を切ると、その 1 つ下だけ north=low に落ちる
     */
    const tallOn = (dir: Dir6): boolean => {
      if (isFullCube(above)) return true
      if (above?.type === 'wall') return sideValue(above, dir) !== 'none'
      return false
    }
    const sideOf = (dir: HDir): WallSide => {
      const nb = this.getBlockAt(neighbor(pos, dir))
      const connects = connectsToWall(nb, dir)
      return !connects ? 'none' : tallOn(dir) ? 'tall' : 'low'
    }
    const north = sideOf('north'), south = sideOf('south')
    const east = sideOf('east'), west = sideOf('west')

    // up の判定 [確定: shouldRaisePost]
    let up: boolean
    if (above?.type === 'wall' && above.up) {
      up = true                                   // ← 上の塀と同期する
    } else {
      const nN = north === 'none', nS = south === 'none'
      const nE = east === 'none', nW = west === 'none'
      const hasCorner = (nN && nS && nE && nW) || nN !== nS || nE !== nW
      if (hasCorner) up = true
      else if ((north === 'tall' && south === 'tall') || (east === 'tall' && west === 'tall')) up = false
      else up = isFullCube(above)
    }

    if (w.north === north && w.south === south && w.east === east && w.west === west && w.up === up) return
    this.setBlockAt(pos, { ...w, north, south, east, west, up })
    this.emitShapeUpdate(pos)                     // オブザーバーが検知する
    // 下と横の塀へ連鎖 (updateShape の伝播に相当)。**同じ tick で全段が変わる**
    this.refreshWall([pos[0], pos[1] - 1, pos[2]], depth + 1)
    for (const d of ['north', 'south', 'east', 'west'] as const) {
      this.refreshWall(neighbor(pos, d), depth + 1)
    }
  }

  /**
   * ピストン移動後の後処理: 影響座標の周辺ワイヤー網を再計算し、
   * 各座標から NC を発行する (移動は回路トポロジーを変える)
   */
  private afterPistonMove(positions: Pos3D[]): void {
    // 接続形状の同期張り替え (#51): ピストン移動はトポロジー変化の主経路。
    // moving_piston 化 (transit 中の切断) と確定 (再接続) の両方がここを通る
    const reshaped = this.refreshWireShapesAround(positions)
    const starts: Pos3D[] = [...reshaped]
    for (const p of positions) starts.push(...this.collectAdjacentWires(p))
    const changedWires = this.propagateWireBFS(starts)
    // ピストン移動で blockstate が変わった各座標 + power が変わったワイヤーの PP を発行
    // (押される/引かれるブロックの変化はオブザーバーの検知対象。02 §6 observer / wiki)。
    for (const p of positions) this.emitShapeUpdate(p)
    for (const w of changedWires) this.emitShapeUpdate(w)
    for (const p of positions) this.submitMultiNC(p)
    for (const w of changedWires) {
      for (const origin of dustUpdateOrigins(w)) this.submitMultiNC(origin)
    }
  }


  // ── 内部: 信号伝播 ───────────────────────────────────────

  /**
   * 素子の出力変化を vanilla 準拠の順序で周囲へ伝える (I6)。
   * 1) ワイヤー電力値を先に確定 (案 A: 値は 2 フェーズ BFS、発行順のみ vanilla)
   * 2) 素子別の送信形状 (02 §4.2 [確定]) で NC を発行
   * 3) 電力が変化したワイヤーからダスト多段送信 (Java HashSet 順 = locational)
   */
  private propagateChange(pos: Pos3D): void {
    // 接続形状の同期張り替え (#51 案 A): pos の変化が周辺ワイヤーの接続導出に
    // 影響し得るため、電力 BFS より先に保持値を導出値へ揃える。vanilla の
    // setBlock → updateNeighbourShapes (updateShape 張り替え) の位置に対応。
    // 形状が変わったワイヤーは電力も変わり得る (ステップ切断で網から外れる等)
    // ため BFS 起点に加える。
    const reshaped = this.refreshWireShapesAround([pos])
    const changedWires = this.propagateWireBFS(
      [...this.collectWireStarts(pos), ...reshaped])
    // ワイヤーの power 変化は blockstate 変化 = PP を発行 (観測面の隣接オブザーバー起動)。
    // vanilla のダスト setBlock (flag2 → updateNeighbourShapes) に相当し、多段 NC より先。
    for (const w of changedWires) this.emitShapeUpdate(w)
    this.emitOutputShape(pos)
    for (const w of changedWires) {
      for (const origin of dustUpdateOrigins(w)) this.submitMultiNC(origin)
    }
  }

  /**
   * 指定座標群の変化を受けて、周辺ワイヤーの接続形状を導出値へ張り替える (#51)。
   * 26.2 の「接続は毎 query 再計算」(11 §1.2) と等価な意味論を、トポロジー
   * 変化点での同期張り替えで実現する — 以降の全クエリ (BFS / 給電判定) は
   * 張り替え後に走るため保持値 = 導出値が常に成り立つ。
   * dot ガードは前の保持値を prev として deriveWireConnections が判定する。
   * 形状が変わったワイヤーは blockstate 変化として PP を発行 (オブザーバー検知)。
   * @returns 形状が変わったワイヤー座標
   */
  private refreshWireShapesAround(positions: Pos3D[]): Pos3D[] {
    const seen = new Set<string>()
    const changed: Pos3D[] = []
    for (const p of positions) {
      for (const cand of wireShapeCandidates(p)) {
        const key = posKey(cand)
        if (seen.has(key)) continue
        seen.add(key)
        const b = this.blocks.get(key)
        if (b?.type !== 'wire') continue
        const next = refreshWireShape(
          cand[0], cand[1], cand[2], this, (b as WireState).connections)
        if (sameConnections((b as WireState).connections, next)) continue
        this.blocks.set(key, { ...(b as WireState), connections: next })
        this.emitShapeUpdate(cand)
        changed.push(cand)
      }
    }
    return changed
  }

  /**
   * BFS の起点: 自身の隣接ワイヤー + 強充電され得る隣接導体 (solid / target) の
   * 隣接ワイヤー (dust→導体→dust は無いが、strong 源→導体→dust の 2 ホップは
   * 電源になる)
   */
  private collectWireStarts(pos: Pos3D): Pos3D[] {
    // 導体経由の 2 ホップ起点も NC_UPDATE_ORDER で集める (collectAdjacentWires と同規則)
    const starts = this.collectAdjacentWires(pos)
    for (const dir of NC_UPDATE_ORDER) {
      const nPos = neighbor(pos, dir)
      if (isConductor(this.getBlockAt(nPos))) {
        starts.push(...this.collectAdjacentWires(nPos))
      }
    }
    return starts
  }

  /**
   * 素子別の NC 送信形状 (02 §4.2 素子別例外 [確定])。
   * トレース (I10) はこの発行点と neighborChanged にフックする。
   */
  private emitOutputShape(pos: Pos3D): void {
    const block = this.getBlockAt(pos)
    if (!block) return
    switch (block.type) {
      case 'lever':
      case 'button_stone':
      case 'button_wood': {
        // updateNeighbours: 自身の隣接 6 + 取り付けブロックの隣接 6
        this.submitMultiNC(pos)
        this.submitMultiNC(neighbor(pos, OPPOSITE[block.facing]))
        break
      }
      case 'detector_rail': {
        // checkPressed の更新一式 [確定: 26.2 DetectorRailBlock.java:88-113]:
        //   flag3 の setBlock → 自身 6 方向 / updatePowerToConnected → 繋がる 2 マスへ
        //   単発通知 / 自身から 6 方向 (重複) / 真下から 6 方向
        //   / 末尾で updateNeighbourForOutputSignal (コンパレーター)
        this.submitMultiNC(pos)
        for (const c of railConnections(pos, block.shape)) this.submitSingleNC(c, block.type)
        this.submitMultiNC(pos)
        this.submitMultiNC(neighbor(pos, 'down'))
        this.emitComparatorUpdate(pos)
        break
      }
      case 'pressure_plate_wood':
      case 'pressure_plate_stone':
      case 'weighted_pressure_plate_light':
      case 'weighted_pressure_plate_heavy': {
        // updateNeighbours: 自身の隣接 6 + 直下 (取り付け面) の隣接 6
        // [確定: 26.2 BasePressurePlateBlock.updateNeighbours —
        //  自身の位置と真下の位置の 2 か所から 6 方向へ配る]
        this.submitMultiNC(pos)
        this.submitMultiNC(neighbor(pos, 'down'))
        break
      }
      case 'torch':
      case 'wall_torch': {
        // onRemove → onPlace の 2 段送信 (各隣接 6 マスを基点にその隣接 6 へ) が
        // LIT 変化で 2 回走り、その後 flag3 の自身隣接 NC
        for (let i = 0; i < 2; i++) {
          for (const d of NC_UPDATE_ORDER) this.submitMultiNC(neighbor(pos, d))
        }
        this.submitMultiNC(pos)
        break
      }
      case 'repeater':
      case 'comparator': {
        // flag2 (自身隣接 NC なし) + updateNeighborsInFront:
        // 出力先 1 マス → 出力先の隣接 5 マス (自身方向を除く)
        const front = neighbor(pos, block.facing)
        this.submitSingleNC(front)
        this.submitMultiNC(front, OPPOSITE[block.facing])
        break
      }
      case 'observer': {
        // flag2 (自身隣接 NC なし) + updateNeighborsInFront: 出力は背面
        // (観測面 facing の反対) の 1 マス → その隣接 5 マス (自身方向を除く)。
        // skip = 背面ブロックから自身へ向かう方向 = facing [確定: §6 observer]。
        const back = neighbor(pos, OPPOSITE[block.facing])
        this.submitSingleNC(back)
        this.submitMultiNC(back, block.facing)
        break
      }
      case 'redstone_block':
      case 'target': {
        // 信号源の出力変化 → 自身の隣接 6 へ NC (vanilla setBlock flag3 の
        // updateNeighborsAt)。ダストは propagateChange 側の BFS で更新される。
        // redstone_block は静的だが、target はトリガ/消灯で変化する
        this.submitMultiNC(pos)
        break
      }
      default:
        // lamp は vanilla では NC を発するが読める素子が無いため発行しない (G15 参照)
        break
    }
  }

  /**
   * PP (updateShape / SU) の発行 (02 §4.1/§4.2 [確定])。
   * シミュレーション中に blockstate が変化した座標 pos から、隣接 6 マスへ
   * PP_UPDATE_ORDER (西東北南下上) 順に shape update を送る。
   *
   * 受信者はオブザーバーのみ (他ブロックの updateShape は結線形状の維持のみで、
   * 本 sim では接続形状を配置時固定にしているため no-op)。
   * オブザーバーは「観測面 (facing 方向) から PP を受け」かつ非 powered のとき
   * 2gt (priority 0) の tile tick を予約する (startSignal + hasScheduledTick ガード)。
   *
   * vanilla では flag16 が無い限り every setBlock で PP が飛ぶ (02 §4.2) が、
   * 本 sim では「観測可能な状態変化」の座標を呼び出し側が特定して発行する
   * (ワイヤーの 2 フェーズ BFS 過渡値などで過剰発火しないよう net 変化に限定)。
   */
  private emitShapeUpdate(pos: Pos3D): void {
    if (this.suppressPP) return

    // Y 軸で隣り合う音符ブロックは音色を引き直す (#231)。
    // [確定: 26.2 NoteBlock.updateShape — `directionToNeighbour.getAxis() == Y` なら
    //  setInstrument]。**上下どちらの隣が変わっても走る**ので両側を見る
    //  (音色そのものは常に「下のブロック」から決まるが、引き直しの契機は上下両方)。
    // **NC ではなく形状更新でしか走らない**。実機の settle (全ブロックへ update) を
    // 通しても音色は古いままで、最初の形状更新ではじめて更新される
    // — なので suppressPP (= settle 相当) の後に置く
    this.refreshNoteInstrument([pos[0], pos[1] + 1, pos[2]])
    this.refreshNoteInstrument([pos[0], pos[1] - 1, pos[2]])
    // 隣の塀は形状を計算し直す (#234)。自分自身も (置き換わった直後のため)
    for (const d of ALL_DIRS) this.refreshWall(neighbor(pos, d))
    this.refreshWall(pos)
    for (const dir of PP_UPDATE_ORDER) {
      const nPos = neighbor(pos, dir)
      const nb = this.getBlockAt(nPos)
      if (nb?.type !== 'observer') continue
      // 変化した pos は nPos から見て OPPOSITE[dir] 方向にある。
      // オブザーバーは自身の facing (観測方向) から来た PP でのみ起動する。
      if (nb.facing !== OPPOSITE[dir]) continue
      if (nb.powered) continue                       // powered 中は updateShape 無反応
      if (this.hasScheduledTick(nPos, 'observer')) continue
      this.schedule(nPos, 2, 0)                      // startSignal: 2gt / priority 0
    }
  }

  /**
   * 音符ブロックの音色を直下のブロックから引き直す (#231)。
   *
   * 変化したら blockstate が変わるので**オブザーバーに検知させる** (emitShapeUpdate)。
   * 音色は下のブロックの「種別」だけで決まるため連鎖しない (下が音符ブロックなら
   * その音色に関わらず bass)。
   */
  private refreshNoteInstrument(pos: Pos3D): void {
    const nb = this.getBlockAt(pos)
    if (nb?.type !== 'note_block') return
    const next = noteInstrumentFor(this.getBlockAt([pos[0], pos[1] - 1, pos[2]]))
    if (next === nb.instrument) return
    this.setBlockAt(pos, { ...nb, instrument: next })
    this.emitShapeUpdate(pos)
  }

  // ── NC 更新の DFS 実行 ───────────────────────────────────

  private submitSingleNC(target: Pos3D, origin?: BlockType): void {
    if (this.traceBuf) this.traceBuf.push(`bu(${this.relToken(target)})`)
    this.submitUpdate({ kind: 'single', target, origin: origin ?? this.getBlockAt(target)?.type ?? 'air' })
  }

  private submitMultiNC(around: Pos3D, skip: Dir6 | null = null, origin?: BlockType): void {
    if (this.traceBuf) {
      this.traceBuf.push(`bu(${this.relToken(around)}${skip ? `\\${skip}` : ''})`)
    }
    this.submitUpdate({
      kind: 'multi', around, skip, idx: 0,
      // 既定は「更新を出した座標にあるブロック」。vanilla も呼び出し側が Block を
      // 渡すが、ほとんどの経路で pos のブロック自身になる。異なる経路 (レールが
      // 真下へ配る更新など) は origin を明示する
      origin: origin ?? this.getBlockAt(around)?.type ?? 'air',
    })
  }

  private submitUpdate(entry: UpdateEntry): void {
    if (this.updating) {
      this.addedThisLayer.push(entry)
      return
    }
    this.updating = true
    this.updateStack.push(entry)
    while (this.updateStack.length > 0) {
      const top = this.updateStack[this.updateStack.length - 1]
      if (top.kind === 'single') {
        this.updateStack.pop()
        this.neighborChanged(top.target, top.origin)
      } else {
        while (top.idx < NC_UPDATE_ORDER.length && NC_UPDATE_ORDER[top.idx] === top.skip) top.idx++
        if (top.idx >= NC_UPDATE_ORDER.length) {
          this.updateStack.pop()
          continue
        }
        this.neighborChanged(neighbor(top.around, NC_UPDATE_ORDER[top.idx++]), top.origin)
      }
      if (++this.updateCount > 1_000_000) {
        // vanilla の maxChainedNeighborUpdates = 1,000,000 溢れ相当
        // (skip してエラーログのみ、02 §4.2)。以前は tile tick 上限 (§2.3 の
        // 65,536) と取り違えていた (12 §2a で検出、#59 で修正)。
        // カウント意味論は vanilla (提出数) と異なり実行 neighborChanged 数
        // (12 §2b の S2 = 任意対応、必要になったら別 issue)
        console.warn('[sim] NC 更新数が上限を超過。以降の更新を破棄します')
        this.updateStack.length = 0
        this.addedThisLayer.length = 0
        break
      }
      if (this.addedThisLayer.length > 0) {
        for (let i = this.addedThisLayer.length - 1; i >= 0; i--) {
          this.updateStack.push(this.addedThisLayer[i])
        }
        this.addedThisLayer.length = 0
      }
    }
    this.updating = false
    this.updateCount = 0
  }

  /**
   * ワイヤーの信号強度を Minecraft 方式の「ゼロ化 → 再増加」2 フェーズで更新する。
   *
   * ─ なぜ単純 BFS ではダメか ─
   *   lever OFF → wire(1) が wire(2)=14 を見て 13 に確定 → wire(2) が wire(1)=13 を
   *   見て 12 に確定 → 0 に収束しない（逆流フィードバック）。
   *
   * ─ アルゴリズム（O(n)、n = 連結ワイヤー数）─
   *   Phase 1: 起点ワイヤーから BFS でトポロジー上の連結成分を収集し全部 power=0 にリセット。
   *   Phase 2: 連結成分の中で動力源（レバー等）に直接隣接するワイヤーを起点に
   *            増加 BFS を実行し正しい電力値を書き込む。
   *            増加 BFS は単純 BFS で正しく収束する（各ワイヤーは最大値を受け取るため）。
   */
  private propagateWireBFS(startWires: Pos3D[]): Pos3D[] {
    // ── Phase 1: 連結成分を収集 & ゼロ化 ──────────────────────
    const connected = new Set<string>()
    const exploreOrder: string[] = []
    const initialPower = new Map<string, number>()
    const exploreQueue: Pos3D[] = []

    for (const p of startWires) {
      const key = posKey(p)
      if (!connected.has(key) && this.getBlockAt(p)?.type === 'wire') {
        connected.add(key)
        exploreQueue.push(p)
      }
    }

    while (exploreQueue.length > 0) {
      const pos = exploreQueue.shift()!
      const block = this.getBlockAt(pos)
      if (!block || block.type !== 'wire') continue

      exploreOrder.push(posKey(pos))
      initialPower.set(posKey(pos), (block as WireState).power)

      // ゼロ化（接続情報はそのまま）
      if ((block as WireState).power !== 0) {
        this.setBlockAt(pos, { ...block, power: 0 })
      }

      // 物理接続しているワイヤーを収集（同レイヤー + 上り/下りステップ + 直上直下）
      for (const nPos of getConnectedWireNeighbors(pos, this)) {
        const nKey = posKey(nPos)
        if (!connected.has(nKey)) {
          connected.add(nKey)
          exploreQueue.push(nPos)
        }
      }
    }

    // ── Phase 2: 動力源に隣接するワイヤーから増加 BFS ──────────
    // 動力源に隣接して power > 0 になるワイヤーを起点にする。
    // ※ このフェーズでは近傍機構 (リピーター・トーチ等) の更新は行わない。
    //   連結成分の一部がまだゼロ化されたままの過渡状態で updateBlock を呼ぶと、
    //   リピーターが「入力が消えた」と誤認して偽の turn_off を予約し
    //   発振する (実機 fixture repeater-delay-1/2/3 で検出したバグ)。
    // [#104] visited でセルを「1 度きり」にしてはいけない。シード走査は Set の反復順に
    // 値を書くため、弱い直結源から先に走ると低い値のまま凍結され、後から届く強い spread で
    // 昇圧されなくなる (実機 fixture dust-weak-source-mix: 15/14/13 が 15/11/12 に転落した)。
    // 代わりに「値が増えたときだけ再伝播する」単調緩和にする。power は 0..15 で単調増加
    // なので、再キューは高々 15×|connected| 回で必ず停止する。
    const increaseQueue: Pos3D[] = []

    for (const key of connected) {
      const pos = keyToPos(key)
      const power = computeWirePower(pos, this)
      if (power > 0) {
        const block = this.getBlockAt(pos) as WireState
        this.setBlockAt(pos, { ...block, power })
        increaseQueue.push(pos)
      }
    }

    while (increaseQueue.length > 0) {
      const pos = increaseQueue.shift()!
      const block = this.getBlockAt(pos)
      if (!block || block.type !== 'wire') continue

      for (const nPos of getConnectedWireNeighbors(pos, this)) {
        const nKey = posKey(nPos)
        if (!connected.has(nKey)) continue
        const nBlock = this.getBlockAt(nPos)
        if (nBlock?.type !== 'wire') continue

        const newPower = computeWirePower(nPos, this)
        if (newPower > (nBlock as WireState).power) {
          this.setBlockAt(nPos, { ...nBlock, power: newPower })
          increaseQueue.push(nPos)
        }
      }
    }

    // ── Phase 3: 電力が変化したワイヤーを探索順で返す ──
    // 周囲機構への通知は呼び出し側 (propagateChange) がダスト多段送信 (NC) で行う。
    // 値の確定と NC 発行を分離することで、過渡状態の観測 (誤発振) を防ぎつつ
    // 発行順を vanilla 準拠にできる (案 A)
    const changed: Pos3D[] = []
    for (const key of exploreOrder) {
      const b = this.getBlockAt(keyToPos(key))
      if (b?.type === 'wire' && (b as WireState).power !== initialPower.get(key)) {
        changed.push(keyToPos(key))
      }
    }
    return changed
  }

  /**
   * NC (neighborChanged) の受信ハンドラ。素子は tile tick を予約し、
   * 即時系 (lamp/solid 表示値) はその場で更新する。
   * ワイヤーは案 A では no-op (電力値は propagateChange 側で確定済み)。
   */
  private neighborChanged(pos: Pos3D, origin: BlockType = 'air'): void {
    const block = this.getBlockAt(pos)
    if (!block) return

    switch (block.type) {
      case 'lamp': {
        // vanilla RedstoneLampBlock.neighborChanged (02 §6 lamp [確定]):
        // LIT != 入力 のとき、点灯中(=消したい)なら 4gt の tile tick を予約し、
        // 消灯中(=点けたい)なら即時点灯する。消灯は tick 時に入力を再評価する
        // ため、4gt 未満の入力断では消灯しない。
        const powered = isBlockPowered(this, pos)
        if (block.lit !== powered) {
          if (block.lit) this.schedule(pos, 4, 0)
          else { this.setBlockAt(pos, { ...block, lit: true }); this.emitShapeUpdate(pos) }
        }
        break
      }
      case 'solid': {
        // 充電状態は power.ts の純クエリで都度計算されるため、ここでは
        // 表示用の派生値 powered を更新するだけでよい。
        // 隣接機構への「中継」は updateNeighborsAndThroughSolids /
        // updateAroundWire 側で行う (G4)。
        const powered = isSolidPowered(this, pos)
        if (block.powered !== powered) this.setBlockAt(pos, { ...block, powered })
        break
      }
      case 'bubble_column': {
        // [確定: 26.2 BubbleColumnBlock.updateShape —
        //  下から来た更新 / 上が塞がった等で 5gt の tile tick を予約する]
        // 5gt 後に柱を評価し直す。**即時に書き換えないのが要点**で、
        // 実機でも柱を断ち切ってから 5gt 後に崩れる
        if (!this.hasScheduledTick(pos, 'bubble_column')) this.schedule(pos, 5, 0)
        // 泡柱も水なので、下が空いたら落ちる (柱を汲み上げた直後の穴を埋めるのはこれ)
        if (this.waterNeedsFlowTick(pos) && !this.hasScheduledTick(pos, 'bubble_column')) {
          this.schedule(pos, WATER_TICK_DELAY, 0)
        }
        break
      }
      case 'water': {
        // [確定: 26.2 WaterFluid — 水の流動 tick は 5gt]。
        // **やるのは縦だけ** (#252)。下が空いたら落とし、供給が絶たれた落下水は消す
        if (this.waterNeedsFlowTick(pos) && !this.hasScheduledTick(pos, 'water')) {
          this.schedule(pos, WATER_TICK_DELAY, 0)
        }
        break
      }
      case 'note_block': {
        // vanilla NoteBlock.neighborChanged を忠実に再現 (C5 #38 [確定: 26.2]):
        //   自身 6 面の受電 (signal) を取り、保持中の POWERED と食い違うときだけ
        //   ・signal が真 (立ち上がり) なら playNote を呼ぶ
        //   ・POWERED を signal に更新して flag3 で書く (POWERED 更新 + PP/NC)
        // **flag 3 なので近隣更新 (NC) も飛ぶ** (#231)。以前は「音符ブロックは信号を
        // 出力しないから NC 不要」としていたが、UPDATE_NEIGHBORS は出力の有無と関係なく
        // 隣接 6 マスへ neighborChanged を配る。QC で音符ブロック越しに受電している
        // ピストンは**この NC でしか電源断を知れない**
        // (5×5 ドアで (2,8,6) の収縮が 1 tick 遅れていた原因)。
        // ランプは flag 2 なので NC を出さない [確定: 26.2 RedstoneLampBlock] — 揃えないこと
        const signal = isBlockPowered(this, pos)
        if (signal !== block.powered) {
          if (signal) this.playNote(pos, block)   // 発音 BE を予約 (被覆条件つき)
          this.setBlockAt(pos, { ...block, powered: signal })
          this.emitShapeUpdate(pos)               // POWERED 変化 → PP
          this.submitMultiNC(pos)                 // flag3 の UPDATE_NEIGHBORS 相当
        }
        break
      }
      case 'torch':
      case 'wall_torch': {
        // 土台の充電と現在の lit が食い違っていたら遷移を予約 (2gt, priority 0)。
        // 動作は予約に固定せず実行時に再評価する。焼き切れ (burnedOut) の点灯抑止は
        // ここではなく executeScheduledTick のトグル件数ゲートで行う (vanilla 準拠。
        // 自励クロックの焼き切れ→非復帰はこの 2gt 予約が 160gt を先取りすることで再現)。
        const basePowered = isTorchBasePowered(pos, this)
        // **この tick に走る分も予約とみなす** (#264)。取り出し済みの予約を
        // 数えないと、同じ tick 内で余計な 1 本が積まれて 2gt 後に空撃ちする
        if (block.lit === basePowered && !this.willTickThisTick(pos, block.type)) {
          this.schedule(pos, 2, 0)
        }
        break
      }
      case 'repeater': {
        // ロック状態を再評価して LOCKED を更新する (G9)。
        // vanilla では LOCKED は updateShape (PP) 経由で更新されるが、本 sim は
        // update 発行の仕組みを持たないため neighbor 更新でまとめて再評価する。
        // [確定: 02 §6 repeater — RepeaterBlock.isLocked]
        const nowLocked = this.isRepeaterLocked(pos, block)
        let cur: RepeaterState = block
        if (nowLocked !== block.locked) {
          cur = { ...block, locked: nowLocked }
          this.setBlockAt(pos, cur)
          // LOCKED の変化自体は出力を変えないため周囲へ再伝播しないが、
          // blockstate 変化なので PP は発行する (観測面のオブザーバー起動)
          this.emitShapeUpdate(pos)
        }
        // vanilla DiodeBlock.checkTickOnNeighbor: ロック中は予約しない。
        // ロック解除も含め、入力と出力が食い違っていたら delay×2gt 後の再評価を予約
        // (ロック解除時の入出力不整合はここで拾われる)
        if (nowLocked) break
        const inputPowered = this.isRepeaterInputPowered(pos, cur)
        if (inputPowered !== cur.powered && !this.willTickThisTick(pos, cur.type)) {
          this.schedule(pos, cur.delay * 2, this.diodeTickPriority(pos, cur, cur.powered))
        }
        break
      }
      case 'comparator': {
        // 出力に変化が生じていたら 2gt 後の再評価を予約。
        // キャンセル・再予約はしない (02 §2 [確定]: 予約は pos+block で常に 1 件)
        const newOutput = this.computeComparatorOutput(pos, block)
        const newPowered = newOutput > 0
        if (!this.willTickThisTick(pos, block.type)
          && (newOutput !== block.outputPower || newPowered !== block.powered)) {
          this.schedule(pos, 2, this.diodeTickPriority(pos, block, false))
        }
        break
      }
      case 'piston_head': {
        // **ヘッドが受けた NC は基部のピストンへ転送する** (#231)
        // [確定: 26.2 PistonHeadBlock.neighborChanged — ヘッドが存続可能 (canSurvive) なら、
        //  facing の反対側 1 マス = 基部の位置へ近隣更新を転送する]。
        // QC で受電しているピストンは、電源側の変化が「1 個上のマスの隣」で起きるため
        // 基部に直接 NC が届かない。ヘッド経由のこの転送が唯一の通知経路になる
        // (5×5 ドアで、電源が切れているのにピストンが縮まないままだった原因)
        const basePos = neighbor(pos, OPPOSITE[block.facing])
        const base = this.getBlockAt(basePos)
        // canSurvive 相当: 基部が同じ向きで伸びているピストンのときだけ転送する
        if ((base?.type === 'piston' || base?.type === 'sticky_piston')
          && base.extended && base.facing === block.facing) {
          this.neighborChanged(basePos)
        }
        break
      }
      case 'piston':
      case 'sticky_piston': {
        // NC 受信時のみ再評価 (BUD の根拠)。状態不一致なら BE を予約
        const should = this.shouldExtend(pos, block)
        if (should && !block.extended) {
          // **押せるかをこの時点で判定する** (#231)
          // [確定: 26.2 PistonBaseBlock.checkIfExtend — 押し構造の解決 (PistonStructureResolver)
          //  が成功したときに限って block event を発行する]。
          // 予約してから実行時に判定すると、その間に押し先の moving_piston が確定して
          // **本来押せないはずのタイミングで押せてしまう**
          // (5×5 ドアの t=220 で、実機が伸ばさないピストンを sim が伸ばしていた原因)
          if (this.resolvePushStructure(pos, block.facing) !== null) {
            this.scheduleBlockEvent(pos, 'extend')
          }
        } else if (!should && block.extended) {
          // 収縮側は vanilla も resolve を通さない (常に予約する)
          this.scheduleBlockEvent(pos, 'retract')
        }
        break
      }
      case 'hopper': {
        // vanilla HopperBlock.neighborChanged → checkPoweredState:
        // ENABLED は「自身 6 面が受電していない」ことと同値。受電で enabled=false = ロック。
        // [確定: 26.2 HopperBlock]。setBlock flag2 相当だが blockstate 変化なので
        // オブザーバー検知用に PP も発行する。
        const enabled = !isBlockPowered(this, pos)
        if (block.enabled !== enabled) {
          this.setBlockAt(pos, { ...block, enabled })
          this.emitShapeUpdate(pos)
        }
        break
      }
      case 'crafter': {
        // vanilla CrafterBlock.neighborChanged [確定: 26.2 CrafterBlock.java:73-88]:
        //   起動条件は自身 6 面の受電 (hasNeighborSignal) だけ ← **疑似接続を持たない**
        //   立ち上がり → 4gt の tile tick 予約 + TRIGGERED=true / 立ち下がり → false
        // ディスペンサーが真上 (1 マス上) も見る [確定: DispenserBlock.java:131] のと対照的
        // [実機 fixture crafter-trigger: 同じ配置でディスペンサーだけが起動する]
        const signal = isBlockPowered(this, pos)
        if (signal && !block.triggered) {
          this.setBlockAt(pos, { ...block, triggered: true })
          this.emitShapeUpdate(pos)
          // 4gt の tile tick。**レシピ非対応なので実行しても何も起きない**が、
          // vanilla と同じ機構に乗せておく (将来クラフトを足すときの受け皿)
          this.schedule(pos, 4, 0)
        } else if (!signal && block.triggered) {
          this.setBlockAt(pos, { ...block, triggered: false })
          this.emitShapeUpdate(pos)
        }
        break
      }
      case 'dropper':
      case 'dispenser': {
        // vanilla DispenserBlock.neighborChanged [確定: 26.2]:
        // 受電 (通常 ∪ QC) の立ち上がりで TRIGGERED を立て 4gt tick を予約、
        // 立ち下がりで TRIGGERED 解除。発火 (dispenseFrom) は ST フェーズの tick。
        const powered = this.isDropperPowered(pos)
        if (powered && !block.triggered) {
          this.setBlockAt(pos, { ...block, triggered: true })
          this.emitShapeUpdate(pos)
          this.schedule(pos, DROPPER_TICK_DELAY, 0)
        } else if (!powered && block.triggered) {
          this.setBlockAt(pos, { ...block, triggered: false })
          this.emitShapeUpdate(pos)
        }
        break
      }
      case 'door_wood':
      case 'door_iron': {
        // vanilla DoorBlock.neighborChanged [確定: 26.2 DoorBlock.java:225-238]:
        //   受電判定は「自分の位置の受電」と「相方の半分の位置の受電」の OR
        //   更新元が同じドアブロックなら無視する (2 つの半分が更新を往復しないガード)
        // [実機 fixture door-redstone: 下半分だけ / 上半分だけ どちらの給電でも両方開く]
        if (origin === block.type) break
        const otherPos: Pos3D = block.half === 'lower'
          ? [pos[0], pos[1] + 1, pos[2]]
          : [pos[0], pos[1] - 1, pos[2]]
        const signal = isBlockPowered(this, pos) || isBlockPowered(this, otherPos)
        if (signal !== block.powered) {
          this.setBlockAt(pos, { ...block, open: signal, powered: signal })
          this.emitShapeUpdate(pos)   // flag 2 なので近隣更新は出さない
          // 相方へミラーする。vanilla では updateShape が「相手の状態をコピー」して
          // 同期を保つ [確定: DoorBlock.java:104-106]。片方にしか近隣更新が届かない
          // ケース (レバーが下半分にだけ隣接する等) ではこれが無いと上半分が取り残される
          const other = this.getBlockAt(otherPos)
          if ((other?.type === 'door_wood' || other?.type === 'door_iron')
              && other.half !== block.half) {
            this.setBlockAt(otherPos, { ...other, open: signal, powered: signal })
            this.emitShapeUpdate(otherPos)
          }
        }
        break
      }
      case 'trapdoor_wood':
      case 'trapdoor_iron':
      case 'fence_gate': {
        // vanilla TrapDoorBlock / FenceGateBlock.neighborChanged [確定: 26.2]:
        //   signal != POWERED のとき open を signal に合わせ powered を追随させる。
        //   書き込みは **flag 2** (UPDATE_CLIENTS のみ) なので
        //     - UPDATE_NEIGHBORS が無い → **近隣更新を出さない**
        //     - 16 も無い → updateNeighbourShapes は走りオブザーバーには見える
        //   [実機 fixture trapdoor-redstone: 開閉では隣の BUD ピストンが伸びず、
        //    真上のオブザーバーは発火する]
        const signal = isBlockPowered(this, pos)
        if (signal !== block.powered) {
          this.setBlockAt(pos, { ...block, open: signal, powered: signal })
          this.emitShapeUpdate(pos)   // flag 2 でも updateShape は飛ぶ
          // submitMultiNC は **出さない** (flag 2 に UPDATE_NEIGHBORS が無いため)
        }
        break
      }
      case 'copper_bulb': {
        // vanilla CopperBulbBlock.checkAndFlip [確定: 26.2]:
        //   signal != POWERED のとき、**立ち上がりなら LIT を反転**し POWERED を追随。
        //   tile tick を使わないので遅延 0gt (近隣更新の処理中に同期確定する)
        //   [実機 fixture copper-bulb-toggle: レバーと同じ tick で確定し、
        //    立ち下がりでは lit が変わらず powered だけ落ちる]
        const signal = isBlockPowered(this, pos)
        if (signal !== block.powered) {
          const lit = block.powered ? block.lit : !block.lit   // 立ち上がりでのみ反転
          this.setBlockAt(pos, { ...block, lit, powered: signal })
          // flag 3 の setBlock: 周囲 6 方向へ近隣更新 + updateNeighbourShapes。
          // powered だけ変わった立ち下がりでもオブザーバーは発火する (実機で確認済み)
          this.emitShapeUpdate(pos)
          this.submitMultiNC(pos)
          // lit が変わるとコンパレーターの読み値が変わる
          if (lit !== block.lit) this.emitComparatorUpdate(pos)
        }
        break
      }
      case 'rail': {
        // 実行中の向き再計算 [確定: 26.2 RailBlock.updateState]:
        //   更新元が信号源 かつ 潜在接続がちょうど 3 のときだけ updateDir(first=false)
        // レバー ON/OFF で 3 方向ジャンクションの曲がる先が入れ替わる、通常レール
        // 本来の使い方がこれ [実機 fixture rail-junction-toggle]。
        // 門番はどちらも実機で分離済み:
        //   - 信号源でない更新 (石への差し替え) では再計算されず、通電時の向きが
        //     残ったまま固まる [fixture rail-junction-nonsignal]
        //   - 4 方向ジャンクションは給電しても動かない [fixture rail-junction-gate]
        if (!isSignalSourceType(origin)) break
        if (countPotentialConnections(this, pos) !== 3) break
        this.applyRailPlacement(pos, block.shape, false)
        break
      }
      case 'powered_rail':
      case 'activator_rail': {
        // vanilla PoweredRailBlock.updateState [確定: 26.2]:
        //   あるべき powered = 自身 6 面の受電 / 前方向の連鎖 / 後方向の連鎖 のいずれか
        //   変化したら flag3 で書き、さらに **真下**から 6 方向へ近隣更新を配る
        //   (坂のときは**真上**からも配る)
        // レール自身は信号を出さない (power.ts に case を持たない) ため、
        // 「真下のブロックへ更新を配る」ことがレッドストーン的な唯一の出力になる。
        const should = shouldRailBePowered(this, pos, block.shape, block.type)
        if (should !== block.powered) {
          this.setBlockAt(pos, { ...block, powered: should })
          this.emitShapeUpdate(pos)               // blockstate 変化 → PP (オブザーバー起動)
          // flag3 の UPDATE_NEIGHBORS = 自身の周囲 6 方向。隣のパワードレールが
          // NC を受けて再評価することで、連鎖 (最大 8) が伝わっていく
          this.submitMultiNC(pos)
          // 明示の「真下から 6 方向」の近隣更新 — 真下ブロックの「周囲」へ配る。
          // vanilla が運ぶのは **レール自身** なので origin を明示する (真下のブロック
          // ではない。既定に任せると信号源判定を取り違える。#142)
          this.submitMultiNC([pos[0], pos[1] - 1, pos[2]], null, block.type)
          if (isRailSlope(block.shape)) {
            this.submitMultiNC([pos[0], pos[1] + 1, pos[2]], null, block.type)
          }
        }
        break
      }
      default:
        break
    }
  }

  /**
   * 音符ブロックの発音を予約する (26.2 NoteBlock.playNote 相当。C5 #38)。
   * vanilla の被覆条件は「instrument が worksAboveNoteBlock を満たす」か「直上が空気」。
   * sim は instrument を省略 (常に BASE_BLOCK = worksAboveNoteBlock は偽) するため
   * 「直上が空気」のみで判定する (直上が塞がれていれば発音しない。10 §C5 注記)。
   * 条件を満たすとき BE (b0=0 / b1=0) 相当の 'play' をキューする。
   */
  private playNote(pos: Pos3D, _block: NoteBlockState): void {
    const above = this.getBlockAt([pos[0], pos[1] + 1, pos[2]])
    if (above && above.type !== 'air') return  // 直上が塞がれている → 発音しない
    this.scheduleBlockEvent(pos, 'play')
  }

  private collectAdjacentWires(pos: Pos3D): Pos3D[] {
    // NC_UPDATE_ORDER (W,E,D,U,N,S) で走査する。この順序が propagateWireBFS の
    // 探索順 = changedWires の順 = ダスト多段送信 (BE 投入) の順を決める。
    // vanilla では更新元の updateNeighborsAt が同順で隣接ダストをカスケードさせる
    // (実機 microTiming で BE 順 西→東 を確認、09_snapshots/two-piston-locational.md)
    const result: Pos3D[] = []
    for (const dir of NC_UPDATE_ORDER) {
      const nPos = neighbor(pos, dir)
      if (this.getBlockAt(nPos)?.type === 'wire') result.push(nPos)
    }
    return result
  }

  /**
   * リピーターの入力（後面）が動力を受けているか。
   * weak 信号の直接受信・充電された固体（弱充電含む）のどちらでも入力になる。
   */
  private isRepeaterInputPowered(pos: Pos3D, block: RepeaterState): boolean {
    return isFacePowered(this, pos, OPPOSITE[block.facing])
  }

  /**
   * リピーターがロックされているか (G9)。
   * [確定: 02 §6 repeater — RepeaterBlock.isLocked +
   *   SignalGetter.getControlInputSignal(diodesOnly=true)]:
   *   側面 (facing に対し 90°) の repeater / comparator が direct signal を
   *   こちら向きに出しているとき true。ワイヤ・レッドストーンブロック・
   *   オブザーバーではロックされない (diodesOnly=true フィルタで diode のみ受理)。
   */
  private isRepeaterLocked(pos: Pos3D, block: RepeaterState): boolean {
    for (const sideDir of getRepeaterLockDirs(block)) {
      const side = this.getBlockAt(neighbor(pos, sideDir))
      // diodesOnly: 側面がリピーター/コンパレーターのときだけ direct signal を見る
      if (side?.type !== 'repeater' && side?.type !== 'comparator') continue
      if (getDirectSignal(this, pos, sideDir) > 0) return true
    }
    return false
  }

  /**
   * コンパレーターの実際の出力信号強度 (0-15) を計算する。
   * - compare モード: back >= side かつ back > 0 → back の強度を返す
   * - subtract モード: max(0, back - side)
   * side = max(side_L, side_R) [確定: 02 §6 comparator — calculateOutputSignal]
   */
  private computeComparatorOutput(pos: Pos3D, block: ComparatorState): number {
    const backDir = OPPOSITE[block.facing]
    const [sideA, sideB] = perpendicularHDirs(block.facing)

    const backPower = this.readComparatorBack(pos, backDir)
    const sidePower = Math.max(
      this.readComparatorSide(pos, sideA),
      this.readComparatorSide(pos, sideB),
    )

    if (block.mode === 'subtract') {
      return Math.max(0, backPower - sidePower)
    }
    return (backPower > 0 && backPower >= sidePower) ? backPower : 0
  }

  /**
   * コンパレーター背面入力の信号強度 (0-15)。
   * [確定: 02 §6 comparator — ComparatorBlock.getInputSignal override]:
   *   1. 背面ブロックが hasAnalogOutputSignal (= コンテナ) なら**その signal で上書き**
   *      (通常信号より優先)。
   *   2. そうでなければ通常信号 = DiodeBlock.getInputSignal:
   *      - 背面からの weak 信号 (getSignal。lever/torch/repeater/comparator を
   *        向き込みで評価)
   *      - 背面がワイヤなら接続形状に関係なく POWER を直読
   *      - 背面が導体 (solid / target) なら充電レベルを読む (Level.getSignal の
   *        conductor 分岐。target の自身出力は getSignal 側で max 済み)
   *   3. 通常信号 < 15 かつ背面が導体なら、さらに 1 マス先のコンテナを読む
   *      (導体 1 個越し。target も isRedstoneConductor=true なので対象。
   *       額縁は sim 未対応)。
   */
  private readComparatorBack(pos: Pos3D, backDir: Dir6): number {
    const backPos = neighbor(pos, backDir)
    const back = this.getBlockAt(backPos)

    // 1. 背面直後の「アナログ出力を持つブロック」は通常信号を上書きする
    const direct = analogOutputOf(back)
    if (direct !== null) return direct

    // 2. 通常信号
    let i = getSignal(this, pos, backDir)
    if (back?.type === 'wire') i = Math.max(i, back.power)
    else if (isConductor(back)) i = Math.max(i, getSolidPower(this, backPos))

    // 3. 導体 1 個越しの読み。vanilla は**アナログ出力を持つブロック全般**を読む
    // [確定: 26.2 ComparatorBlock.calculateOutputSignal — hasAnalogOutputSignal を
    //  直後と導体 1 個越しの両方で見る]
    if (i < 15 && isConductor(back)) {
      const far = analogOutputOf(this.getBlockAt(neighbor(backPos, backDir)))
      if (far !== null) i = Math.max(i, far)
    }
    return i
  }

  /**
   * コンパレーター側面入力の信号強度 (0-15) (G8)。
   * [確定: 02 §6 comparator 側面 — 1.21.1 SignalGetter.getControlInputSignal
   *  (diodesOnly=false)。判定順もデコンパイルどおり]:
   *   1. レッドストーンブロック → 定数 15 (比較・減算どちらのモードでも側面 15)
   *   2. ワイヤ → POWER を直読
   *   3. その他は isSignalSource のみ direct signal (強出力) がこちらを向くもの
   *      = リピーター / コンパレーター / (将来) オブザーバー
   *   レバー・ボタン・トーチは水平方向へ direct signal を出さないため無効。
   *   target も getDirectSignal 非 override のため side 入力にならない
   *   (充電された導体の読み取りは背面限定)。getDirectSignal がこの弁別を担う。
   */
  private readComparatorSide(pos: Pos3D, sideDir: HDir): number {
    const side = this.getBlockAt(neighbor(pos, sideDir))
    if (side?.type === 'redstone_block') return 15
    if (side?.type === 'wire') return side.power
    return getDirectSignal(this, pos, sideDir)
  }

}

/** HDir facing に対して直交する水平 2 方向 (コンパレーター側面 / 素子の左右) */
function perpendicularHDirs(facing: HDir): [HDir, HDir] {
  return (facing === 'north' || facing === 'south') ? ['east', 'west'] : ['north', 'south']
}

/**
 * オブザーバーが検知する「観測可能な blockstate 変化」があったか (PP 発行の要否)。
 * vanilla では実 blockstate プロパティの変化のみが PP を飛ばすため、blockstate に
 * 現れない派生値は除外する:
 *   - solid.powered … 石等に powered プロパティは無い (充電は sim の表示用派生値)
 *   - comparator.outputPower … BE の OutputSignal (blockstate は powered のみ)
 *   - container.signal … BE の中身
 * それ以外 (wire.power / lit / powered / locked / extended / target.power / 型変化) は
 * blockstate 変化 = 観測対象。
 */
function observableChanged(a: BlockState, b: BlockState): boolean {
  if (a.type !== b.type) return true
  switch (b.type) {
    case 'wire':        return a.type === 'wire' && a.power !== b.power
    case 'torch':
    case 'wall_torch':  return (a.type === 'torch' || a.type === 'wall_torch') && a.lit !== b.lit
    case 'repeater':    return a.type === 'repeater' && (a.powered !== b.powered || a.locked !== b.locked)
    case 'comparator':  return a.type === 'comparator' && a.powered !== b.powered
    case 'lever':
    case 'button_stone':
    case 'button_wood': return 'powered' in a && (a as { powered: boolean }).powered !== b.powered
    case 'detector_rail':
    case 'pressure_plate_wood':
    case 'pressure_plate_stone': return 'powered' in a && (a as { powered: boolean }).powered !== b.powered
    case 'weighted_pressure_plate_light':
    case 'weighted_pressure_plate_heavy':
      // POWER プロパティ (powered のとき pressedPower、でなければ 0) の変化が観測対象
      return (a.type === 'weighted_pressure_plate_light' || a.type === 'weighted_pressure_plate_heavy') &&
        (a.powered ? a.pressedPower : 0) !== (b.powered ? b.pressedPower : 0)
    case 'lamp':        return a.type === 'lamp' && a.lit !== b.lit
    // 銅の電球は lit だけでなく powered も blockstate なので、立ち下がりでも観測される
    // [実機 fixture copper-bulb-toggle: レバーを切った tick でもオブザーバーが発火]
    case 'door_wood':
    case 'door_iron':
    case 'trapdoor_wood':
    case 'trapdoor_iron':
    case 'fence_gate': return 'open' in a
      && ((a as { open: boolean }).open !== b.open
        || (a as { powered: boolean }).powered !== b.powered)
    case 'copper_bulb': return a.type === 'copper_bulb'
      && (a.lit !== b.lit || a.powered !== b.powered)
    case 'note_block':  return a.type === 'note_block' && (a.powered !== b.powered || a.note !== b.note)
    case 'target':      return a.type === 'target' && a.outputPower !== b.outputPower
    case 'observer':    return a.type === 'observer' && a.powered !== b.powered
    case 'piston':
    case 'sticky_piston': return (a.type === 'piston' || a.type === 'sticky_piston') &&
                                 (a.extended !== b.extended || a.facing !== b.facing)
    // hopper.enabled / dropper.triggered は blockstate プロパティ → 観測対象。
    // count (内容) は BE で非観測 (コンパレーターのみ CU で読む)。
    case 'hopper':      return a.type === 'hopper' && a.enabled !== b.enabled
    case 'crafter':     return a.type === 'crafter' && a.triggered !== b.triggered
    case 'dropper':
    case 'dispenser':   return (a.type === 'dropper' || a.type === 'dispenser')
      && a.triggered !== b.triggered
    // solid.powered / container.signal / *.count は blockstate ではない → 非観測
    default:            return false
  }
}
