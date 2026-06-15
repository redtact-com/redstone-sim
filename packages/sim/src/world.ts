import type {
  Pos3D, Dir6, HDir, BlockState, WorldSnapshot, ScheduledTick, TickResult,
  WireState, TorchState, WallTorchState, RepeaterState, ComparatorState, LeverState, ButtonState, SolidState,
} from './types.js'
import { OPPOSITE, H_DIRS, ALL_DIRS, H_DIR_VEC } from './types.js'
import { getRepeaterOutputFacing, isInputFaceOfRepeater } from './blocks/repeater.js'
import { getTorchOutputFacing, isBasePowered as isTorchBasePowered } from './blocks/torch.js'
import { computeWirePower } from './blocks/wire.js'

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

// ============================================================
// SimWorld 実装
// ============================================================

export class SimWorld {
  private blocks = new Map<string, BlockState>()
  private scheduledTicks: ScheduledTick[] = []
  private currentTick = 0

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

  schedule(pos: Pos3D, action: 'turn_on' | 'turn_off', delay: number, priority: number): void {
    const key = posKey(pos)
    // 同じpos・actionが既にスケジュール済みなら上書きしない（Minecraft挙動）
    const existing = this.scheduledTicks.find(
      t => posKey(t.pos) === key && t.action === action
    )
    if (existing) return
    this.scheduledTicks.push({ pos, remainingTicks: delay, action, priority })
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

    // 残りティック数を 1 デクリメント
    for (const t of this.scheduledTicks) {
      t.remainingTicks--
    }

    // remainingTicks === 0 のものを priority 昇順で実行
    const toExecute = this.scheduledTicks
      .filter(t => t.remainingTicks <= 0)
      .sort((a, b) => a.priority - b.priority)
    this.scheduledTicks = this.scheduledTicks.filter(t => t.remainingTicks > 0)

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
   * 4. トーチの状態チェック（土台が充電されていれば消灯をスケジュール）
   * 5. flush() でスケジュール済みティックを処理
   */
  initialize(): void {
    this.scheduledTicks = []

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
      }
    }

    // Step 2: ワイヤー電力を収束するまで繰り返し計算
    // （BFS だと処理順依存になるため、全体パスを繰り返す）
    let changed = true
    let pass = 0
    while (changed && pass < 100) {
      changed = false
      pass++
      for (const [key, block] of this.blocks) {
        if (block.type !== 'wire') continue
        const pos = keyToPos(key)
        const newPower = computeWirePower(pos, this)
        if (block.power !== newPower) {
          this.blocks.set(key, { ...block, power: newPower })
          changed = true
        }
      }
    }

    // Step 3: ランプ・固体ブロックの状態を更新
    for (const [key, block] of this.blocks) {
      const pos = keyToPos(key)
      if (block.type === 'lamp') {
        const lit = this.isBlockReceivingPower(pos)
        if (block.lit !== lit) this.blocks.set(key, { ...block, lit })
      } else if (block.type === 'solid') {
        const powered = this.isBlockStronglyPowered(pos)
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
        this.updateBlock(pos)
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
      this.propagateFromSource(pos)
    } else if (block.type === 'button_stone' || block.type === 'button_wood') {
      if (block.powered) return  // 既に押されている
      const next: ButtonState = { ...block, powered: true }
      this.setBlockAt(pos, next)
      this.propagateFromSource(pos)
      const delay = block.type === 'button_stone' ? 5 : 10
      // ボタンは delay tick 後にオフ
      this.schedule(pos, 'turn_off', delay, 0)
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
    return w
  }

  // ── 内部: ScheduledTick 実行 ─────────────────────────────

  private executeScheduledTick(tick: ScheduledTick): string[] {
    const { pos, action } = tick
    const block = this.getBlockAt(pos)
    if (!block) return []

    const changed: string[] = []

    if (block.type === 'torch' || block.type === 'wall_torch') {
      const shouldBeLit = action === 'turn_on'
      if (block.lit === shouldBeLit) return []
      this.setBlockAt(pos, { ...block, lit: shouldBeLit })
      changed.push(posKey(pos))
      this.propagateFromTorch(pos, shouldBeLit)
    } else if (block.type === 'repeater') {
      const shouldBePowered = action === 'turn_on'
      if (block.powered === shouldBePowered) return []
      this.setBlockAt(pos, { ...block, powered: shouldBePowered })
      changed.push(posKey(pos))
      this.propagateFromRepeater(pos)
    } else if (block.type === 'comparator') {
      const shouldBePowered = action === 'turn_on'
      const newOutputPower = shouldBePowered ? this.computeComparatorOutput(pos, block) : 0
      if (block.powered === shouldBePowered && block.outputPower === newOutputPower) return []
      this.setBlockAt(pos, { ...block, powered: shouldBePowered, outputPower: newOutputPower })
      changed.push(posKey(pos))
      this.propagateFromComparator(pos)
    } else if (block.type === 'button_stone' || block.type === 'button_wood') {
      if (action === 'turn_off') {
        this.setBlockAt(pos, { ...block, powered: false })
        changed.push(posKey(pos))
        this.propagateFromSource(pos)
      }
    }

    return changed
  }

  // ── 内部: 信号伝播 ───────────────────────────────────────

  /**
   * レバー・ボタン・ターゲット等の全方向動力源からの伝播。
   * 隣接する全ブロックを更新キューに入れる。
   */
  private propagateFromSource(pos: Pos3D): void {
    const powered = this.getPowerLevel(pos[0], pos[1], pos[2]) > 0
    // 隣接6方向のワイヤー・ランプ・固体ブロックを再計算
    for (const dir of ALL_DIRS) {
      const nPos = neighbor(pos, dir)
      this.updateBlock(nPos)
    }
    // ワイヤー経由の伝播
    this.propagateWireBFS(this.collectAdjacentWires(pos))
    void powered  // 使用済みフラグ
  }

  private propagateFromTorch(pos: Pos3D, lit: boolean): void {
    const block = this.getBlockAt(pos)
    if (!block || (block.type !== 'torch' && block.type !== 'wall_torch')) return
    const outFacing = getTorchOutputFacing(block)
    const outPos = neighbor(pos, outFacing)
    this.updateBlock(outPos)
    this.propagateWireBFS(this.collectAdjacentWires(pos))
    void lit
  }

  private propagateFromRepeater(pos: Pos3D): void {
    const block = this.getBlockAt(pos) as RepeaterState
    const outPos = neighbor(pos, block.facing)
    this.updateBlock(outPos)
    this.propagateWireBFS(this.collectAdjacentWires(pos))
  }

  private propagateFromComparator(pos: Pos3D): void {
    const block = this.getBlockAt(pos) as ComparatorState
    const outPos = neighbor(pos, block.facing)
    this.updateBlock(outPos)
    this.propagateWireBFS(this.collectAdjacentWires(pos))
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
  private propagateWireBFS(startWires: Pos3D[]): void {
    // ── Phase 1: 連結成分を収集 & ゼロ化 ──────────────────────
    const connected = new Set<string>()
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

      // ゼロ化（接続情報はそのまま）
      if ((block as WireState).power !== 0) {
        this.setBlockAt(pos, { ...block, power: 0 })
      }

      // 物理接続しているワイヤーを収集
      const wire = block as WireState
      for (const dir of H_DIRS) {
        if (!wire.connections[dir]) continue
        const [dx, dz] = H_DIR_VEC[dir]
        const nPos: Pos3D = [pos[0] + dx, pos[1], pos[2] + dz]
        const nKey = posKey(nPos)
        if (!connected.has(nKey) && this.getBlockAt(nPos)?.type === 'wire') {
          connected.add(nKey)
          exploreQueue.push(nPos)
        }
      }
    }

    // ── Phase 2: 動力源に隣接するワイヤーから増加 BFS ──────────
    // 動力源に隣接して power > 0 になるワイヤーを起点にする
    const increaseQueue: Pos3D[] = []
    const visited = new Set<string>()

    for (const key of connected) {
      const pos = keyToPos(key)
      const power = computeWirePower(pos, this)
      if (power > 0) {
        const block = this.getBlockAt(pos) as WireState
        this.setBlockAt(pos, { ...block, power })
        this.updateLampsAroundWire(pos)
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

      for (const dir of H_DIRS) {
        if (!block.connections[dir]) continue
        const [dx, dz] = H_DIR_VEC[dir]
        const nPos: Pos3D = [pos[0] + dx, pos[1], pos[2] + dz]
        const nKey = posKey(nPos)
        if (!connected.has(nKey) || visited.has(nKey)) continue
        const nBlock = this.getBlockAt(nPos)
        if (nBlock?.type !== 'wire') continue

        const newPower = computeWirePower(nPos, this)
        if (newPower > (nBlock as WireState).power) {
          this.setBlockAt(nPos, { ...nBlock, power: newPower })
          this.updateLampsAroundWire(nPos)
          visited.add(nKey)
          increaseQueue.push(nPos)
        }
      }
    }

    // Phase 2 で電力が残らなかったワイヤー（消灯したワイヤー）の周囲を更新
    // ※ Phase 1 直後ではなく Phase 2 完了後に呼ぶことで、ゼロ化状態での誤トーチ評価を防ぐ
    for (const key of connected) {
      if (!visited.has(key)) {
        this.updateLampsAroundWire(keyToPos(key))
      }
    }
  }

  private updateBlock(pos: Pos3D): void {
    const block = this.getBlockAt(pos)
    if (!block) return

    switch (block.type) {
      case 'lamp': {
        const lit = this.isBlockReceivingPower(pos)
        if (block.lit !== lit) this.setBlockAt(pos, { ...block, lit })
        break
      }
      case 'solid': {
        const powered = this.isBlockStronglyPowered(pos)
        if (block.powered !== powered) {
          this.setBlockAt(pos, { ...block, powered })
          // 固体の powered 変化を取り付いている隣接トーチに伝播する。
          // これがないとリピーター出力 → stone → torch のチェーンで
          // 同 tick 内に他の repeater がまだ未処理だった場合に
          // updateLampsAroundWire 経由のトーチ更新で stone がまだ
          // powered=false に見えてしまい、片側のトーチしか消えない。
          for (const d of ALL_DIRS) {
            const nPos = neighbor(pos, d)
            const nb = this.getBlockAt(nPos)
            if (nb?.type === 'torch' || nb?.type === 'wall_torch') {
              this.updateBlock(nPos)
            }
          }
        }
        break
      }
      case 'torch':
      case 'wall_torch': {
        // トーチの入力（土台ブロック）が変化したか確認してスケジュール
        // Minecraft: トーチは 1 redstone tick = 2 game tick の遅延
        const basePowered = isTorchBasePowered(pos, this)
        if (basePowered && block.lit) {
          // 土台が動力あり → 消灯スケジュール
          this.schedule(pos, 'turn_off', 2, 1)
        } else if (!basePowered && !block.lit) {
          // 土台が動力なし → 点灯スケジュール
          this.schedule(pos, 'turn_on', 2, 1)
        }
        break
      }
      case 'repeater': {
        // Minecraft: リピーター delay 1〜4 (redstone tick) = ×2 game tick
        const inputPowered = this.isRepeaterInputPowered(pos, block)
        if (inputPowered && !block.powered) {
          this.schedule(pos, 'turn_on', block.delay * 2, -3)
        } else if (!inputPowered && block.powered) {
          this.schedule(pos, 'turn_off', block.delay * 2, -3)
        }
        break
      }
      case 'comparator': {
        // Minecraft: コンパレーターは 1 redstone tick = 2 game tick の遅延
        const newOutput = this.computeComparatorOutput(pos, block)
        const newPowered = newOutput > 0
        if (newOutput !== block.outputPower || newPowered !== block.powered) {
          // outputPower が変化する場合は既存スケジュールをキャンセルして再スケジュール
          const key = posKey(pos)
          this.scheduledTicks = this.scheduledTicks.filter(t => posKey(t.pos) !== key)
          this.scheduledTicks.push({ pos, remainingTicks: 2, action: newPowered ? 'turn_on' : 'turn_off', priority: -3 })
        }
        break
      }
      default:
        break
    }
  }

  private updateLampsAroundWire(pos: Pos3D): void {
    for (const dir of ALL_DIRS) {
      const nPos = neighbor(pos, dir)
      const b = this.getBlockAt(nPos)
      if (b?.type === 'lamp') {
        const lit = this.isBlockReceivingPower(nPos)
        if (b.lit !== lit) this.setBlockAt(nPos, { ...b, lit })
      } else if (b?.type === 'repeater') {
        // ワイヤー電力変化でリピーターを再評価（turn_on/turn_off をスケジュール）
        this.updateBlock(nPos)
      } else if (b?.type === 'comparator') {
        // ワイヤー電力変化でコンパレーターを再評価（outputPower 更新・クロック発振）
        this.updateBlock(nPos)
      } else if (b?.type === 'torch' || b?.type === 'wall_torch') {
        // ワイヤーに直接隣接するトーチを更新
        this.updateBlock(nPos)
      } else if (b?.type === 'solid') {
        // ワイヤーが固体ブロックを弱充電 → 固体に取り付いているトーチも更新
        for (const dir2 of ALL_DIRS) {
          const nnPos = neighbor(nPos, dir2)
          const nb = this.getBlockAt(nnPos)
          if (nb?.type === 'torch' || nb?.type === 'wall_torch') {
            this.updateBlock(nnPos)
          }
        }
      }
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

  /** ランプ・固体ブロックが隣接ブロックから動力を受けているか */
  private isBlockReceivingPower(pos: Pos3D): boolean {
    for (const dir of ALL_DIRS) {
      const nPos = neighbor(pos, dir)
      const src = this.getBlockAt(nPos)
      if (!src) continue
      if (this.doesBlockOutputToward(nPos, src, OPPOSITE[dir])) return true
    }
    return false
  }

  /** 固体ブロックが強信号で充電されているか（ワイヤーは強充電しない） */
  private isBlockStronglyPowered(pos: Pos3D): boolean {
    for (const dir of ALL_DIRS) {
      const nPos = neighbor(pos, dir)
      const src = this.getBlockAt(nPos)
      if (!src) continue
      // ワイヤーは固体ブロックを強充電しない
      if (src.type === 'wire') continue
      if (this.doesBlockOutputToward(nPos, src, OPPOSITE[dir])) return true
    }
    return false
  }

  /**
   * あるブロック(src)が、指定方向(toDir)に信号を出力しているか。
   * pos: src のある座標、toDir: src から見た出力方向。
   */
  private doesBlockOutputToward(_srcPos: Pos3D, src: BlockState, toDir: Dir6): boolean {
    switch (src.type) {
      case 'lever':
      case 'button_stone':
      case 'button_wood':
        return (src as LeverState | ButtonState).powered

      case 'torch': {
        const t = src as TorchState
        if (!t.lit) return false
        return getTorchOutputFacing(t) === toDir
      }
      case 'wall_torch': {
        const t = src as WallTorchState
        if (!t.lit) return false
        return getTorchOutputFacing(t) === toDir
      }
      case 'wire': {
        const w = src as WireState
        if (w.power === 0) return false
        // ワイヤーは水平方向にのみ信号を渡す
        if (toDir === 'up' || toDir === 'down') return false
        const hDir = toDir as HDir
        return w.connections[hDir]
      }
      case 'repeater': {
        const r = src as RepeaterState
        if (!r.powered) return false
        return getRepeaterOutputFacing(r) === toDir
      }
      case 'comparator': {
        const c = src as ComparatorState
        if (!c.powered) return false
        return c.facing === toDir
      }
      case 'solid': {
        const s = src as SolidState
        return s.powered
      }
      default:
        return false
    }
  }

  private isRepeaterInputPowered(pos: Pos3D, block: RepeaterState): boolean {
    const inputDir = OPPOSITE[block.facing] as Dir6
    const inputPos = neighbor(pos, inputDir)
    const src = this.getBlockAt(inputPos)
    if (!src) return false
    // リピーターの入力面に対して信号を出しているか
    if (!isInputFaceOfRepeater(block, inputDir as HDir)) return false
    return this.doesBlockOutputToward(inputPos, src, block.facing)
  }

  /**
   * コンパレーターの実際の出力信号強度 (0-15) を計算する。
   * - compare モード: back >= side かつ back > 0 → back の強度を返す
   * - subtract モード: max(0, back - side)
   */
  private computeComparatorOutput(pos: Pos3D, block: ComparatorState): number {
    const SIDES: Record<HDir, [HDir, HDir]> = {
      north: ['east', 'west'],
      south: ['west', 'east'],
      east:  ['north', 'south'],
      west:  ['south', 'north'],
    }
    const backDir = OPPOSITE[block.facing] as HDir
    const [side1, side2] = SIDES[block.facing]

    const getSignalPower = (srcPos: Pos3D): number => {
      const src = this.getBlockAt(srcPos)
      if (!src) return 0
      if (src.type === 'wire') return (src as WireState).power
      if (src.type === 'lever' || src.type === 'button_stone' || src.type === 'button_wood')
        return (src as LeverState | ButtonState).powered ? 15 : 0
      if (src.type === 'torch' || src.type === 'wall_torch')
        return (src as TorchState | WallTorchState).lit ? 15 : 0
      if (src.type === 'repeater')
        return (src as RepeaterState).powered ? 15 : 0
      if (src.type === 'comparator')
        return (src as ComparatorState).outputPower
      return 0
    }

    const backPower = getSignalPower(neighbor(pos, backDir))
    const sidePower = Math.max(
      getSignalPower(neighbor(pos, side1)),
      getSignalPower(neighbor(pos, side2)),
    )

    if (block.mode === 'subtract') {
      return Math.max(0, backPower - sidePower)
    }
    return (backPower > 0 && backPower >= sidePower) ? backPower : 0
  }

}
