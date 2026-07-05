import type {
  Pos3D, Dir6, HDir, BlockState, WorldSnapshot, ScheduledTick, TickResult,
  WireState, RepeaterState, ComparatorState, LeverState, ButtonState, TargetState,
  ObserverState, PressurePlateState, WeightedPressurePlateState, MovingPistonState,
} from './types.js'
import { OPPOSITE, ALL_DIRS } from './types.js'
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
  containerCapacity, canContainerAccept, containerParticipates,
  isContainerType, effectiveContainerSignal, HOPPER_COOLDOWN, DROPPER_TICK_DELAY,
} from './blocks/container.js'
import { NC_UPDATE_ORDER, PP_UPDATE_ORDER, CU_UPDATE_ORDER, dustUpdateOrigins } from './updates.js'
import type {
  BlockEvent, PistonState, NoteBlockState, HopperState, DropperState, ContainerState,
} from './types.js'

/** 音符ブロック発音イベント (C5 #38)。BE フェーズの triggerEvent 相当で発火する */
export interface NotePlayEvent {
  pos: Pos3D
  /** 音程 0-24 (vanilla NOTE) */
  note: number
}
import {
  getSignal, getDirectSignal, getSolidPower,
  isBlockPowered, isFacePowered, isSolidPowered, isConductor,
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

// NC 更新 DFS 機械のエントリ (single = 1 マス通知 / multi = 6 方向一括、1 方向ずつ中断可)
type UpdateEntry =
  | { kind: 'single'; target: Pos3D }
  | { kind: 'multi'; around: Pos3D; skip: Dir6 | null; idx: number }

// ============================================================
// SimWorld 実装
// ============================================================

export class SimWorld {
  private blocks = new Map<string, BlockState>()
  private scheduledTicks: ScheduledTick[] = []
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

  /** 同 pos + ブロック種の予約が既にあるか (vanilla hasScheduledTick 相当) */
  hasScheduledTick(pos: Pos3D, blockType: BlockState['type']): boolean {
    const key = posKey(pos)
    return this.scheduledTicks.some(t => posKey(t.pos) === key && t.blockType === blockType)
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

    for (const tick of toExecute) {
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
      if (h.count > 0) {
        const destPos = neighbor(pos, h.facing)
        const dest = this.getBlockAt(destPos)
        if (canContainerAccept(dest)) {
          const d = dest as HopperState | DropperState | ContainerState
          this.setBlockAt(destPos, { ...d, count: (d.count ?? 0) + 1 } as BlockState)
          h = { ...h, count: h.count - 1 }
          this.setBlockAt(pos, h)
          // #89/#91: 押し込み先ホッパーのクールダウンを再設定 (vanilla HopperBlockEntity.add)。
          // vanilla は `if (bl && dest is hopper && !isOnCustomCooldown) setCooldown(8-k)`:
          //   bl = 受信スロットが空だった / k=1: 押込先が同gt 既 tick / k=0: 未 tick。
          //   k=0 でも押込先は自 serverTick で -1 され結局 **実効 7gt**。よって空受信時は
          //   一律 currentTick+7 (残留クールダウン中でもリセット。旧実装は off-cooldown 時
          //   のみ再設定で 7/8 desync→bounce/stall し 2-clock が 16gt にズレた: #89)。
          // ★ bl 条件が要 (#91): bottom-up 縦チェーンでは受信側が先に suck して非空に
          //   なってから push されるため bl=false → -1 を効かせず既存 cooldown(+8) を保つ。
          //   これを怠ると bottom-up 配置で位相が 1gt ずれる。
          if (d.type === 'hopper' && (d.count ?? 0) === 0) {  // bl: 受信スロットが空だった
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

      // (2) 吸い出し (suck): 直上コンテナから 1 個 (h が満杯でないとき)
      if (h.count < containerCapacity('hopper')) {
        const srcPos: Pos3D = [pos[0], pos[1] + 1, pos[2]]
        const src = this.getBlockAt(srcPos)
        if (containerParticipates(src) && (src as { count?: number }).count! > 0) {
          const s = src as HopperState | DropperState | ContainerState
          this.setBlockAt(srcPos, { ...s, count: (s.count ?? 0) - 1 } as BlockState)
          h = { ...h, count: h.count + 1 }
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
   * [確定: 26.2 DispenserBlock.neighborChanged — hasNeighborSignal(pos) ||
   *  hasNeighborSignal(pos.above())]。QC は 02 §5.3 の 3 クラスの 1 つ。
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
  initialize(): void {
    this.scheduledTicks = []
    this.blockEvents = []
    this.seqCounter = 0
    // 初期組み立て中は PP を抑止 (オブザーバーは authored 安定状態のまま発火しない)
    this.suppressPP = true

    // Step 1: 動的状態をリセット
    for (const [key, block] of this.blocks) {
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
      } else if (
        block.type === 'pressure_plate_wood' || block.type === 'pressure_plate_stone' ||
        block.type === 'weighted_pressure_plate_light' || block.type === 'weighted_pressure_plate_heavy'
      ) {
        // 感圧板は entity が乗って初めて powered になる。手動モデルでは
        // authored の powered/POWER>0 (乗った状態) は初期安定状態では entity 不在の
        // ため OFF から始める (target/observer の onPlace リセットと同趣旨。決定論)
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
    let changed = true
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
    for (const [key, block] of this.blocks) {
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
      } else if (block.type === 'dropper') {
        // 受電で triggered を確定するが initialize では発火しない (tile tick 予約なし。
        // authored 安定状態は「既に発火済み」相当。runtime の立ち上がりでのみ発火)。
        const powered = this.isDropperPowered(pos)
        if (block.triggered !== powered) this.blocks.set(key, { ...block, triggered: powered })
      }
    }

    // Step 4: トーチ・リピーター・コンパレーターの初期スケジュール登録。
    // 土台が充電されているトーチは消灯を、後面に動力が来ているリピーターは
    // turn_on を、入力のあるコンパレーターは出力を schedule する。
    // ここを抜くとクロック回路（torch + repeater のフィードバック）が
    // tick=0 で何もスケジュールされず発振開始しない。
    for (const [key] of this.blocks) {
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

    // Step 5: スケジュール済みティックを処理して安定化（クロック回路では呼ばない）
    // initialize() 後は tick=0 の初期状態から手動で進める想定のため flush は行わない

    // 初期組み立て完了。以降 (tick / flush / activateBlock) の状態変化は PP を発行する
    this.suppressPP = false
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
    }
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
    } else if (block.type === 'dropper') {
      // vanilla DropperBlock.dispenseFrom (ST フェーズ) [確定: 26.2]:
      // ランダムスロットの 1 個を前方コンテナへ挿入。sim は種別なしなので count を移す。
      if (block.count > 0) {
        const destPos = neighbor(pos, block.facing)
        const dest = this.getBlockAt(destPos)
        if (canContainerAccept(dest)) {
          // 前方コンテナに空きあり → 1 個挿入
          const d = dest as HopperState | DropperState | ContainerState
          this.setBlockAt(destPos, { ...d, count: (d.count ?? 0) + 1 } as BlockState)
          this.setBlockAt(pos, { ...block, count: block.count - 1 })
          changed.push(posKey(pos), posKey(destPos))
          this.emitComparatorUpdate(destPos)
          this.emitComparatorUpdate(pos)
        } else if (!isContainerType(dest?.type)) {
          // 前方が非コンテナ → vanilla は発射 (アイテムエンティティ生成)。
          // エンティティ境界原則 (13 §4.2) により 1 個消費して何も出さない。
          this.setBlockAt(pos, { ...block, count: block.count - 1 })
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
    if (block.type === 'solid' || block.type === 'lamp') return true
    if (block.type === 'redstone_block' || block.type === 'target' || block.type === 'note_block') return true
    if ((block.type === 'piston' || block.type === 'sticky_piston') && !block.extended) return true
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
    pos: Pos3D, facing: Dir6,
  ): { toPush: Pos3D[]; toDestroy: Pos3D[] } | null {
    const toPush: Pos3D[] = []
    const toDestroy: Pos3D[] = []
    let cur = neighbor(pos, facing)
    for (;;) {
      const b = this.getBlockAt(cur)
      if (!b) return { toPush, toDestroy }   // 空きに到達 → 押せる
      if (this.isPushDestroy(b)) {
        toDestroy.push(cur)                  // 破壊して終端 (連鎖はここまで)
        return { toPush, toDestroy }
      }
      if (!this.isMovable(b)) return null
      if (toPush.length >= 12) return null   // 13 個目 = 押せない
      toPush.push(cur)
      cur = neighbor(cur, facing)
    }
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

    const setMoving = (pos: Pos3D, kind: 'normal' | 'sticky', into: BlockState) => {
      // #80: 確定は ST 相の tile tick でなく BlockEntity 相 (finalizeDue) で行う。
      // ST (phase4) は BE (phase8) の前なので、旧実装では確定ブロックが同 tick 内で
      // 下流ピストンを起動していた (実機と 1tick ズレ)。vanilla は
      // PistonMovingBlockEntity.tick (phase10) で確定するため下流 BE は翌 tick 発火。
      this.setBlockAt(pos, {
        type: 'moving_piston', facing: piston.facing, kind, into,
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
        setMoving(neighbor(pushList[i], piston.facing), 'normal', payloads[i])
      }
      // head セル (= 最近接 src と同座標) を head 行きの moving に
      setMoving(headPos, sticky ? 'sticky' : 'normal', {
        type: 'piston_head', facing: piston.facing, sticky,
      })
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
        const pullFrom = neighbor(headPos, piston.facing)
        const target = this.getBlockAt(pullFrom)
        if (target && this.isMovable(target)) {
          // 引かれるブロック: src 即時 air、head セルに moving(into=ブロック)
          this.setBlockAt(pullFrom, { type: 'air' })
          changed.push(posKey(pullFrom))
          setMoving(headPos, 'normal', target)
          affected.push(pullFrom)
        }
      }
      // base 自体が moving になり 2gt 後に縮んだ piston へ戻る (実機系列で確認)
      setMoving(ev.pos, sticky ? 'sticky' : 'normal', { ...piston, extended: false })
      this.traceOpenUpdate(ev.pos)
      this.afterPistonMove(affected)
      this.traceCloseUpdate('Pi', 'r', 0, 'BE')
    }

    return changed
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
      case 'pressure_plate_wood':
      case 'pressure_plate_stone':
      case 'weighted_pressure_plate_light':
      case 'weighted_pressure_plate_heavy': {
        // updateNeighbours: 自身の隣接 6 + 直下 (取り付け面) の隣接 6
        // [確定: 26.2 BasePressurePlateBlock.updateNeighbours =
        //  updateNeighborsAt(pos) + updateNeighborsAt(pos.below())]
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

  // ── NC 更新の DFS 実行 ───────────────────────────────────

  private submitSingleNC(target: Pos3D): void {
    if (this.traceBuf) this.traceBuf.push(`bu(${this.relToken(target)})`)
    this.submitUpdate({ kind: 'single', target })
  }

  private submitMultiNC(around: Pos3D, skip: Dir6 | null = null): void {
    if (this.traceBuf) {
      this.traceBuf.push(`bu(${this.relToken(around)}${skip ? `\\${skip}` : ''})`)
    }
    this.submitUpdate({ kind: 'multi', around, skip, idx: 0 })
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
        this.neighborChanged(top.target)
      } else {
        while (top.idx < NC_UPDATE_ORDER.length && NC_UPDATE_ORDER[top.idx] === top.skip) top.idx++
        if (top.idx >= NC_UPDATE_ORDER.length) {
          this.updateStack.pop()
          continue
        }
        this.neighborChanged(neighbor(top.around, NC_UPDATE_ORDER[top.idx++]))
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
    const increaseQueue: Pos3D[] = []
    const visited = new Set<string>()

    for (const key of connected) {
      const pos = keyToPos(key)
      const power = computeWirePower(pos, this)
      if (power > 0) {
        const block = this.getBlockAt(pos) as WireState
        this.setBlockAt(pos, { ...block, power })
        if (!visited.has(key)) {
          visited.add(key)
          increaseQueue.push(pos)
        }
      }
    }

    while (increaseQueue.length > 0) {
      const pos = increaseQueue.shift()!
      const block = this.getBlockAt(pos) as WireState
      if (!block || block.type !== 'wire') continue

      for (const nPos of getConnectedWireNeighbors(pos, this)) {
        const nKey = posKey(nPos)
        if (!connected.has(nKey) || visited.has(nKey)) continue
        const nBlock = this.getBlockAt(nPos)
        if (nBlock?.type !== 'wire') continue

        const newPower = computeWirePower(nPos, this)
        if (newPower > (nBlock as WireState).power) {
          this.setBlockAt(nPos, { ...nBlock, power: newPower })
          visited.add(nKey)
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
  private neighborChanged(pos: Pos3D): void {
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
      case 'note_block': {
        // vanilla NoteBlock.neighborChanged を忠実に再現 (C5 #38 [確定: 26.2]):
        //   signal = hasNeighborSignal(pos)
        //   if (signal != POWERED) {
        //     if (signal) playNote(...)      ← 立ち上がり (false→true) でのみ発音
        //     setBlock(POWERED=signal, flag3) ← POWERED 更新 + PP/NC
        //   }
        // note block は信号を出力しないため下流への NC 伝播は不要 (lamp と同じく
        // emitShapeUpdate = オブザーバー起動用の PP のみ発行する。G15)。
        const signal = isBlockPowered(this, pos)
        if (signal !== block.powered) {
          if (signal) this.playNote(pos, block)   // 発音 BE を予約 (被覆条件つき)
          this.setBlockAt(pos, { ...block, powered: signal })
          this.emitShapeUpdate(pos)               // POWERED 変化 → PP (flag3 相当)
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
        if (block.lit === basePowered) {
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
        if (inputPowered !== cur.powered) {
          this.schedule(pos, cur.delay * 2, this.diodeTickPriority(pos, cur, cur.powered))
        }
        break
      }
      case 'comparator': {
        // 出力に変化が生じていたら 2gt 後の再評価を予約。
        // キャンセル・再予約はしない (02 §2 [確定]: 予約は pos+block で常に 1 件)
        const newOutput = this.computeComparatorOutput(pos, block)
        const newPowered = newOutput > 0
        if (newOutput !== block.outputPower || newPowered !== block.powered) {
          this.schedule(pos, 2, this.diodeTickPriority(pos, block, false))
        }
        break
      }
      case 'piston':
      case 'sticky_piston': {
        // NC 受信時のみ再評価 (BUD の根拠)。状態不一致なら BE を予約
        const should = this.shouldExtend(pos, block)
        if (should && !block.extended) {
          this.scheduleBlockEvent(pos, 'extend')
        } else if (!should && block.extended) {
          this.scheduleBlockEvent(pos, 'retract')
        }
        break
      }
      case 'hopper': {
        // vanilla HopperBlock.neighborChanged → checkPoweredState:
        // enabled = !hasNeighborSignal(pos)。受電で enabled=false = ロック。
        // [確定: 26.2 HopperBlock]。setBlock flag2 相当だが blockstate 変化なので
        // オブザーバー検知用に PP も発行する。
        const enabled = !isBlockPowered(this, pos)
        if (block.enabled !== enabled) {
          this.setBlockAt(pos, { ...block, enabled })
          this.emitShapeUpdate(pos)
        }
        break
      }
      case 'dropper': {
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
      default:
        break
    }
  }

  /**
   * 音符ブロックの発音を予約する (26.2 NoteBlock.playNote 相当。C5 #38)。
   * vanilla の被覆条件は `INSTRUMENT.worksAboveNoteBlock() || 直上が空気`。
   * sim は instrument を省略 (常に BASE_BLOCK = worksAboveNoteBlock()=false) するため
   * 「直上が空気」のみで判定する (直上が塞がれていれば発音しない。10 §C5 注記)。
   * 条件を満たすとき level.blockEvent(pos, 0, 0) 相当の 'play' BE をキューする。
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

    // 1. 背面直後のコンテナ (hopper/dropper/barrel 等) は通常信号を上書きする
    //    (hasAnalogOutputSignal。充填率→信号は effectiveContainerSignal)
    if (isContainerType(back?.type)) return effectiveContainerSignal(back)

    // 2. 通常信号
    let i = getSignal(this, pos, backDir)
    if (back?.type === 'wire') i = Math.max(i, back.power)
    else if (isConductor(back)) i = Math.max(i, getSolidPower(this, backPos))

    // 3. 導体 1 個越しのコンテナ読み
    if (i < 15 && isConductor(back)) {
      const far = this.getBlockAt(neighbor(backPos, backDir))
      if (isContainerType(far?.type)) i = Math.max(i, effectiveContainerSignal(far))
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
    case 'pressure_plate_wood':
    case 'pressure_plate_stone': return 'powered' in a && (a as { powered: boolean }).powered !== b.powered
    case 'weighted_pressure_plate_light':
    case 'weighted_pressure_plate_heavy':
      // POWER プロパティ (= powered ? pressedPower : 0) の変化が観測対象
      return (a.type === 'weighted_pressure_plate_light' || a.type === 'weighted_pressure_plate_heavy') &&
        (a.powered ? a.pressedPower : 0) !== (b.powered ? b.pressedPower : 0)
    case 'lamp':        return a.type === 'lamp' && a.lit !== b.lit
    case 'note_block':  return a.type === 'note_block' && (a.powered !== b.powered || a.note !== b.note)
    case 'target':      return a.type === 'target' && a.outputPower !== b.outputPower
    case 'observer':    return a.type === 'observer' && a.powered !== b.powered
    case 'piston':
    case 'sticky_piston': return (a.type === 'piston' || a.type === 'sticky_piston') &&
                                 (a.extended !== b.extended || a.facing !== b.facing)
    // hopper.enabled / dropper.triggered は blockstate プロパティ → 観測対象。
    // count (内容) は BE で非観測 (コンパレーターのみ CU で読む)。
    case 'hopper':      return a.type === 'hopper' && a.enabled !== b.enabled
    case 'dropper':     return a.type === 'dropper' && a.triggered !== b.triggered
    // solid.powered / container.signal / *.count は blockstate ではない → 非観測
    default:            return false
  }
}
