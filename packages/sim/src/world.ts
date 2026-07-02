import type {
  Pos3D, Dir6, HDir, BlockState, WorldSnapshot, ScheduledTick, TickResult,
  WireState, RepeaterState, ComparatorState, LeverState, ButtonState, TargetState,
} from './types.js'
import { OPPOSITE, ALL_DIRS } from './types.js'
import { isBasePowered as isTorchBasePowered } from './blocks/torch.js'
import { computeWirePower, getConnectedWireNeighbors } from './blocks/wire.js'
import { getRepeaterLockDirs } from './blocks/repeater.js'
import { NC_UPDATE_ORDER, dustUpdateOrigins } from './updates.js'
import {
  getSignal, getDirectSignal, getSolidPower,
  isBlockPowered, isFacePowered, isSolidPowered,
} from './power.js'

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

  // ── ブロックアクセス ─────────────────────────────────────

  getBlock(x: number, y: number, z: number): BlockState | null {
    return this.blocks.get(posKey([x, y, z])) ?? null
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
  }

  /** 同 pos + ブロック種の予約が既にあるか (vanilla hasScheduledTick 相当) */
  hasScheduledTick(pos: Pos3D, blockType: BlockState['type']): boolean {
    const key = posKey(pos)
    return this.scheduledTicks.some(t => posKey(t.pos) === key && t.blockType === blockType)
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

    return {
      changedPositions: [...changed].map(keyToPos),
      currentTick: this.currentTick,
    }
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
    this.seqCounter = 0

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
      } else if (block.type === 'target') {
        // vanilla TargetBlock.onPlace: POWER>0 かつ pending tick 無しの設置は
        // 0 に戻る。初期化時点で pending tick は無いため常に消灯状態から始める
        if (block.outputPower !== 0) this.blocks.set(key, { ...block, outputPower: 0 })
      }
    }

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
        b?.type === 'comparator'
      ) {
        this.neighborChanged(pos)
      }
    }

    // Step 5: スケジュール済みティックを処理して安定化（クロック回路では呼ばない）
    // initialize() 後は tick=0 の初期状態から手動で進める想定のため flush は行わない
  }

  // ── プレイヤー操作（PIフェーズ相当） ────────────────────

  activateBlock(x: number, y: number, z: number): void {
    const pos: Pos3D = [x, y, z]
    const block = this.getBlockAt(pos)
    if (!block) return

    if (block.type === 'lever') {
      const next: LeverState = { ...block, powered: !block.powered }
      this.setBlockAt(pos, next)
      this.propagateChange(pos)
    } else if (block.type === 'button_stone' || block.type === 'button_wood') {
      if (block.powered) return  // 既に押されている
      const next: ButtonState = { ...block, powered: true }
      this.setBlockAt(pos, next)
      this.propagateChange(pos)
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
      this.propagateChange(pos)
      this.schedule(pos, 20, 0)
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
      case 'lamp':          return block.lit ? 15 : 0
      case 'solid':         return block.powered ? 15 : 0
      case 'redstone_block': return 15
      case 'target':        return block.outputPower
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
    const apply = (next: BlockState) => {
      this.setBlockAt(pos, next)
      changed.push(posKey(pos))
      this.propagateChange(pos)
    }

    if (block.type === 'torch' || block.type === 'wall_torch') {
      // 土台の充電状態を今読む
      const shouldBeLit = !isTorchBasePowered(pos, this)
      if (block.lit !== shouldBeLit) apply({ ...block, lit: shouldBeLit })
    } else if (block.type === 'repeater') {
      // vanilla DiodeBlock.tick: ロック中は何もしない。ロック判定は保持している
      // LOCKED プロパティではなく実行時に再評価する (isLocked を毎回問い合わせる)
      // [確定: 02 §6 repeater / G9]。
      // オン遷移は入力が既に消えていても行い、その場で自身のオフを予約する
      // (最小パルス幅 = 遅延の根拠。02 §6 repeater [確定])
      if (!this.isRepeaterLocked(pos, block)) {
        const input = this.isRepeaterInputPowered(pos, block)
        if (block.powered && !input) {
          apply({ ...block, powered: false })
        } else if (!block.powered) {
          apply({ ...block, powered: true })
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
        apply({ ...block, powered: newPowered, outputPower: newOutputPower })
      }
    } else if (block.type === 'button_stone' || block.type === 'button_wood') {
      if (block.powered) apply({ ...block, powered: false })
    } else if (block.type === 'target') {
      // vanilla TargetBlock.tick: OUTPUT_POWER != 0 なら 0 に戻す (消灯)
      if (block.outputPower !== 0) apply({ ...block, outputPower: 0 })
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

  // ── 内部: 信号伝播 ───────────────────────────────────────

  /**
   * 素子の出力変化を vanilla 準拠の順序で周囲へ伝える (I6)。
   * 1) ワイヤー電力値を先に確定 (案 A: 値は 2 フェーズ BFS、発行順のみ vanilla)
   * 2) 素子別の送信形状 (02 §4.2 [確定]) で NC を発行
   * 3) 電力が変化したワイヤーからダスト多段送信 (Java HashSet 順 = locational)
   */
  private propagateChange(pos: Pos3D): void {
    const changedWires = this.propagateWireBFS(this.collectWireStarts(pos))
    this.emitOutputShape(pos)
    for (const w of changedWires) {
      for (const origin of dustUpdateOrigins(w)) this.submitMultiNC(origin)
    }
  }

  /**
   * BFS の起点: 自身の隣接ワイヤー + 強充電され得る隣接固体の隣接ワイヤー
   * (dust→solid→dust は無いが、strong 源→solid→dust の 2 ホップは電源になる)
   */
  private collectWireStarts(pos: Pos3D): Pos3D[] {
    const starts = this.collectAdjacentWires(pos)
    for (const dir of ALL_DIRS) {
      const nPos = neighbor(pos, dir)
      if (this.getBlockAt(nPos)?.type === 'solid') {
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

  // ── NC 更新の DFS 実行 ───────────────────────────────────

  private submitSingleNC(target: Pos3D): void {
    this.submitUpdate({ kind: 'single', target })
  }

  private submitMultiNC(around: Pos3D, skip: Dir6 | null = null): void {
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
      if (++this.updateCount > 65_536) {
        // vanilla の maxChained 溢れ相当 (skip してエラーログのみ、02 §4.2)
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
        const lit = isBlockPowered(this, pos)
        if (block.lit !== lit) this.setBlockAt(pos, { ...block, lit })
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
      case 'torch':
      case 'wall_torch': {
        // 土台の充電と現在の lit が食い違っていたら遷移を予約 (2gt, priority 0)。
        // 動作は予約に固定せず実行時に再評価する
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
          // LOCKED の変化自体は出力を変えないため周囲へ再伝播しない
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
      default:
        break
    }
  }

  private collectAdjacentWires(pos: Pos3D): Pos3D[] {
    const result: Pos3D[] = []
    for (const dir of ALL_DIRS) {
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
   *      - 背面が導体(固体)なら強充電を読む (Level.getSignal の conductor 分岐)
   *   3. 通常信号 < 15 かつ背面が導体なら、さらに 1 マス先のコンテナを読む
   *      (固体 1 個越し。額縁は sim 未対応)。
   */
  private readComparatorBack(pos: Pos3D, backDir: Dir6): number {
    const backPos = neighbor(pos, backDir)
    const back = this.getBlockAt(backPos)

    // 1. 背面直後のコンテナは通常信号を上書きする
    if (back?.type === 'container') return back.signal

    // 2. 通常信号
    let i = getSignal(this, pos, backDir)
    if (back?.type === 'wire') i = Math.max(i, back.power)
    else if (back?.type === 'solid') i = Math.max(i, getSolidPower(this, backPos))

    // 3. 固体 1 個越しのコンテナ読み
    if (i < 15 && back?.type === 'solid') {
      const far = this.getBlockAt(neighbor(backPos, backDir))
      if (far?.type === 'container') i = Math.max(i, far.signal)
    }
    return i
  }

  /**
   * コンパレーター側面入力の信号強度 (0-15) (G8)。
   * [確定: 02 §6 comparator 側面 — SignalGetter.getControlInputSignal(diodesOnly=false)]:
   *   - ワイヤ → POWER を直読
   *   - レッドストーンブロック → 15 (sim 未実装。将来対応)
   *   - その他は direct signal (強出力) がこちらを向くもののみ
   *     = リピーター / コンパレーター / (将来) オブザーバー
   *   レバー・ボタン・トーチは水平方向へ direct signal を出さないため無効。
   *   getDirectSignal がこの弁別を担う (lever/button/torch は通常配置で side を
   *   向く direct signal を出さず 0 になる)。
   */
  private readComparatorSide(pos: Pos3D, sideDir: HDir): number {
    const side = this.getBlockAt(neighbor(pos, sideDir))
    if (side?.type === 'wire') return side.power
    return getDirectSignal(this, pos, sideDir)
  }

}

/** HDir facing に対して直交する水平 2 方向 (コンパレーター側面 / 素子の左右) */
function perpendicularHDirs(facing: HDir): [HDir, HDir] {
  return (facing === 'north' || facing === 'south') ? ['east', 'west'] : ['north', 'south']
}
