import type {
  StackSize,
  BlockState, BlockType, Dir6, HDir, WorldSnapshot,
} from '@redstone/sim'
import { SimWorld, slotsFromCount } from '@redstone/sim'
import { EditorGrid } from './grid.js'
import { defaultFacing, isFacingAllowed, toHDir } from './facing.js'
import { normalizePlaceOptions } from './placeable.js'

export type PlaceableType = Exclude<BlockType, 'air'>

export interface PlaceOptions {
  /** 取付面つきの素子 (レバー・ボタン等) は up/down も取る。素子ごとの許容は facing.ts (#111) */
  facing?: Dir6
  /**
   * コンテナに入れるアイテムのスタック上限 (#194)。既定 64。
   * エディタはスタック種別ごとに代表アイテム 1 種だけを扱う
   */
  stack?: StackSize
  delay?: 1 | 2 | 3 | 4
  mode?: 'compare' | 'subtract'
  /** 重量感圧板が踏まれたとき出力する信号強度 (1-15)。既定 15 */
  pressedPower?: number
  /** コンテナがコンパレーター背面から読まれる実効出力 (0-15)。既定 0 */
  signal?: number
  /** ホッパー/ドロッパーの内容個数。既定 0 */
  count?: number
}

type ChangeHandler = (snapshot: WorldSnapshot) => void

export class CircuitEditor {
  private grid: EditorGrid
  private listeners = new Set<ChangeHandler>()

  constructor(layer: number) {
    this.grid = new EditorGrid(layer)
  }

  get layer(): number { return this.grid.layer }

  /** 現在編集対象の Y レイヤー */
  get activeLayer(): number { return this.grid.activeLayer }

  /** 編集対象の Y レイヤーを切り替える（配置・削除・選択の対象になる） */
  setActiveLayer(y: number): void {
    this.grid.activeLayer = y
  }

  // ── ブロック操作 ──────────────────────────────────────────

  placeBlock(x: number, z: number, type: PlaceableType, opts: PlaceOptions = {}): void {
    const block = buildBlockState(type, opts)
    if (!block) return
    this.grid.placeBlock(x, z, block)
    this.emit()
  }

  removeBlock(x: number, z: number): void {
    this.grid.removeBlock(x, z)
    this.emit()
  }

  /** レイヤー指定の削除（クリア等、activeLayer 外の操作に使用） */
  removeBlock3(x: number, y: number, z: number): void {
    this.grid.removeBlock3(x, y, z)
    this.emit()
  }

  /**
   * **今の盤面が取り込み由来か** (#317)。
   *
   * Minecraft から保存したファイルは blockstate が整合しているので、
   * シミュレーション開始時に**そのまま出発点にする** (`initialize({ trustAuthored: true })`)。
   * 計算し直すと、blockstate に出ない値 (コンパレーターの保持出力・予約 tick・
   * ホッパーのクールダウン) が復元できず**矛盾した状態**になり、
   * 何も操作していないのに回路が動き出す。
   *
   * 手で組んだ回路は逆に計算し直さないと初期状態が出ない (ダストの power は 0 で置かれる)
   * ので、取り込み由来のときだけ true にする。
   */
  private importedSnapshot = false

  isImportedSnapshot(): boolean {
    return this.importedSnapshot
  }

  /**
   * インポート等でグリッド全体を差し替える。履歴はリセットされる。
   * @param imported 取り込み由来なら true (#317)
   */
  resetToBlocks(blocks: Map<string, BlockState>, imported = false): void {
    this.grid.resetToBlocks(blocks)
    this.importedSnapshot = imported
    this.emit()
  }

  getAllBlocks(): Map<string, BlockState> {
    return this.grid.getAllBlocks()
  }

  rotateBlock(x: number, z: number, dir: Dir6): void {
    this.grid.rotateBlock(x, z, dir)
    this.emit()
  }

  /**
   * ワイヤーの dot ⇄ cross 形状をトグルする（C8 #38）。
   * トグルが起きたら true を返し change を発火する。
   */
  toggleWireDot(x: number, z: number): boolean {
    const changed = this.grid.toggleWireDot(x, z)
    if (changed) this.emit()
    return changed
  }

  getBlock(x: number, z: number): BlockState | null {
    return this.grid.getBlock(x, z)
  }

  getBlock3(x: number, y: number, z: number): BlockState | null {
    return this.grid.getBlock3(x, y, z)
  }

  // ── undo/redo ─────────────────────────────────────────────

  undo(): boolean {
    const result = this.grid.undo()
    if (result) this.emit()
    return result
  }

  redo(): boolean {
    const result = this.grid.redo()
    if (result) this.emit()
    return result
  }

  canUndo(): boolean { return this.grid.canUndo() }
  canRedo(): boolean { return this.grid.canRedo() }

  // ── スナップショット / SimWorld ───────────────────────────

  getSnapshot(): WorldSnapshot {
    return this.grid.toSnapshot()
  }

  /**
   * 編集内容から SimWorld（3D）を構築して返す。
   * シミュレーション開始時に呼ぶ。
   */
  buildSimWorld(): SimWorld {
    const world = new SimWorld()
    const snapshot = this.grid.toSnapshot()

    for (const [key, block] of snapshot.blocks) {
      const [x, y, z] = key.split(',').map(Number)
      world.setBlock(x, y, z, block)
    }

    return world
  }

  // ── イベント ─────────────────────────────────────────────

  on(event: 'change', handler: ChangeHandler): () => void {
    if (event === 'change') {
      this.listeners.add(handler)
      return () => this.listeners.delete(handler)
    }
    return () => {}
  }

  private emit(): void {
    const snapshot = this.getSnapshot()
    for (const handler of this.listeners) handler(snapshot)
  }
}

// ── ブロック状態の初期値を生成 ──────────────────────────────

function buildBlockState(type: PlaceableType, rawOpts: PlaceOptions): BlockState | null {
  // 型が持たないオプションを落とし、数値を範囲へ丸める (#115)。
  // 壊れた保存データや外部入力をそのまま BlockState にしないための関所
  const opts = normalizePlaceOptions(type, rawOpts)
  // 素子ごとに許される向きが違う。許されない向きが来たら既定へ落とす (#111)
  const want = opts.facing
  const dir: Dir6 = want !== undefined && isFacingAllowed(type, want) ? want : defaultFacing(type)
  const facing: HDir = toHDir(dir)

  switch (type) {
    case 'wire':
      return { type: 'wire', connections: { north: true, south: true, east: true, west: true }, power: 0 }
    case 'torch':
      return { type: 'torch', facing: 'up', lit: true }
    case 'wall_torch':
      return { type: 'wall_torch', facing, lit: true }
    case 'repeater':
      return { type: 'repeater', facing, delay: opts.delay ?? 1, powered: false, locked: false }
    case 'comparator':
      return { type: 'comparator', facing, mode: opts.mode ?? 'compare', powered: false, outputPower: 0 }
    case 'lever':
      return { type: 'lever', facing: dir, powered: false }
    case 'button_stone':
      return { type: 'button_stone', facing: dir, powered: false }
    case 'button_wood':
      return { type: 'button_wood', facing: dir, powered: false }
    case 'pressure_plate_wood':
      return { type: 'pressure_plate_wood', powered: false }
    case 'pressure_plate_stone':
      return { type: 'pressure_plate_stone', powered: false }
    case 'weighted_pressure_plate_light':
      return { type: 'weighted_pressure_plate_light', pressedPower: opts.pressedPower ?? 15, powered: false }
    case 'weighted_pressure_plate_heavy':
      return { type: 'weighted_pressure_plate_heavy', pressedPower: opts.pressedPower ?? 15, powered: false }
    case 'lamp':
      return { type: 'lamp', lit: false }
    case 'note_block':
      // 発音は BE フック経由 (音自体はスコープ外)。初期は消灯・note=0。
      // instrument は置いた時点では harp で、直下のブロックに応じて sim 側が引き直す (#231)
      return { type: 'note_block', powered: false, note: 0, instrument: 'harp' }
    case 'piston':
    case 'sticky_piston':
      return { type, facing: dir, extended: false }
    case 'piston_head':
    case 'moving_piston':
      return null  // head / 移動中ブロックは sim が管理する (直接配置不可)
    case 'slime_block':
      return { type: 'slime_block' }
    case 'honey_block':
      return { type: 'honey_block' }
    case 'rail':
      // 通常レールは動力を持たない。曲線は隣接から自動で決まる (#140)
      return {
        type: 'rail',
        shape: facing === 'east' || facing === 'west' ? 'east_west' : 'north_south',
      }
    case 'door_wood':
    case 'door_iron':
      // 置いたマスが下半分。上半分は grid.placeBlock3 が同じ操作で足す (#159)
      return {
        type,
        half: 'lower',
        facing: facing === 'east' || facing === 'west' || facing === 'south' ? facing : 'north',
        open: false,
        powered: false,
        hinge: 'left',
      }
    case 'trapdoor_wood':
    case 'trapdoor_iron':
    case 'fence_gate':
      // 受電で開閉する出力素子。facing は描画用で回路挙動には影響しない (#157)
      return {
        type,
        facing: facing === 'east' || facing === 'west' || facing === 'south' ? facing : 'north',
        open: false,
        powered: false,
      }
    case 'copper_bulb':
      // 立ち上がりでのみ lit が反転する記憶素子。初期は消灯 (#155)
      return { type: 'copper_bulb', lit: false, powered: false }
    case 'detector_rail':
      // カート検出の折衷モデル。初期は非通電 (#146)
      return {
        type: 'detector_rail',
        shape: facing === 'east' || facing === 'west' ? 'east_west' : 'north_south',
        powered: false,
      }
    case 'powered_rail':
    case 'activator_rail':
      // facing は「置いた向き」= 孤立して置いたときの既定形状にだけ効く。
      // 隣にレールがあれば grid.placeBlock3 の自動接続が形状を上書きする (#127)
      return {
        type,
        shape: facing === 'east' || facing === 'west' ? 'east_west' : 'north_south',
        powered: false,
      }
    case 'redstone_block':
      // 定数動力源。石と同列にパレットへ追加 (常時通電)
      return { type: 'redstone_block' }
    case 'target':
      // 手動トリガの折衷モデル。初期は消灯 (outputPower=0)
      return { type: 'target', outputPower: 0 }
    case 'observer':
      // facing = 観測方向 (顔のある面)。出力は背面。初期は消灯
      return { type: 'observer', facing: dir, powered: false }
    case 'solid':
      return { type: 'solid', powered: false }
    case 'glass':
      return { type: 'glass' }
    case 'slab':
      // 上付きスラブは取り込みでしか現れない。エディタからは下付き固定で置く (#184)。
      // half は sim の挙動に影響しないため、置き分けの UI は用意していない
      return { type: 'slab', half: 'bottom' }
    case 'container':
      // コンパレーター背面から読まれる実効出力 (0-15) を editor で設定する (#54)。
      // エディタから置けるのは**樽** (フルキューブ = 導体) 扱い (#291)
      return { type: 'container', fullCube: true, signal: opts.signal ?? 0 }
    case 'hopper':
      // 物流ホッパー (#65)。facing = 送り込み方向 (editor は水平のみ。既定 down)。
      // 中身は「スタック種別ごとの代表アイテムを count 個、slot 0 から」(#194)。
      // enabled は initialize で受電から確定
      return {
        type: 'hopper', facing: dir, enabled: true,
        slots: slotsFromCount('hopper', opts.count ?? 0, opts.stack ?? 64),
      }
    case 'crafter':
      // 受電部分のみ実装。occupiedSlots はコンパレーターが読む手動値 (#163)
      return { type: 'crafter', facing: dir, triggered: false, occupiedSlots: opts.count ?? 0 }
    case 'dropper':
    case 'dispenser':
      // 物流ドロッパー (#65) / ディスペンサー (#161)。facing = 出力方向。
      // 差は「前方コンテナへ挿入するか」だけ
      return {
        type, facing: dir, triggered: false,
        slots: slotsFromCount(type, opts.count ?? 0, opts.stack ?? 64),
      }
    default:
      return null
  }
}
