// ============================================================
// 基本型
// ============================================================

export type Pos3D = [number, number, number]

/** 水平4方向 */
export type HDir = 'north' | 'south' | 'east' | 'west'

/** 上下含む6方向 */
export type Dir6 = HDir | 'up' | 'down'

/** 方向の逆引き */
export const OPPOSITE: Record<Dir6, Dir6> = {
  north: 'south', south: 'north',
  east: 'west',   west: 'east',
  up: 'down',     down: 'up',
}

/** 水平方向ベクトル */
export const H_DIR_VEC: Record<HDir, [number, number]> = {
  north: [0, -1],
  south: [0,  1],
  east:  [1,  0],
  west:  [-1, 0],
}

export const H_DIRS: HDir[] = ['north', 'south', 'east', 'west']
export const ALL_DIRS: Dir6[] = ['north', 'south', 'east', 'west', 'up', 'down']

// ============================================================
// ブロック状態型
// ============================================================

/**
 * ワイヤーの接続値。
 * - false: 接続なし
 * - true:  side 接続（同レイヤー / 下りステップ）
 * - 'up':  上りステップ接続（隣接ブロックの面を登る。vanilla blockstate の 'up' に対応）
 */
export type WireConnectionValue = boolean | 'up'

export interface WireConnections {
  north: WireConnectionValue
  south: WireConnectionValue
  east:  WireConnectionValue
  west:  WireConnectionValue
}

export interface WireState {
  type: 'wire'
  /** 接続形状 — 配置時に確定し、シミュレーション中は変更しない */
  connections: WireConnections
  /** 信号強度 0–15 */
  power: number
}

export interface TorchState {
  type: 'torch'
  /** 床置きトーチは facing='up' */
  facing: Dir6
  lit: boolean
  /**
   * 消灯 (LIT true→false) が起きた game tick の履歴 (burnout 用)。
   * [確定: 02 §6 torch — RedstoneTorchBlock.RECENT_TOGGLES]。
   * tick 実行時に 60gt (RECENT_TOGGLE_TIMER) より古い記録を破棄し、
   * 8 件 (MAX_RECENT_TOGGLES) 到達で焼き切れる。省略時は空履歴とみなす。
   */
  recentToggles?: number[]
  /**
   * 焼き切れ中フラグ。true の間は消灯固定で NC に反応せず、
   * 160gt (RESTART_DELAY) 後の復帰 tile tick でのみ解除される。
   */
  burnedOut?: boolean
}

export interface WallTorchState {
  type: 'wall_torch'
  /** 取り付いている壁の方向（トーチが向いている方向の逆） */
  facing: HDir
  lit: boolean
  /** burnout 用の消灯履歴 (TorchState.recentToggles と同義)。 */
  recentToggles?: number[]
  /** 焼き切れ中フラグ (TorchState.burnedOut と同義)。 */
  burnedOut?: boolean
}

export interface RepeaterState {
  type: 'repeater'
  facing: HDir
  delay: 1 | 2 | 3 | 4
  powered: boolean
  locked: boolean
}

export interface ComparatorState {
  type: 'comparator'
  facing: HDir
  mode: 'compare' | 'subtract'
  powered: boolean
  outputPower: number
}

export interface LeverState {
  type: 'lever'
  facing: Dir6
  powered: boolean
}

export interface ButtonState {
  type: 'button_stone' | 'button_wood'
  facing: Dir6
  powered: boolean
}

export interface LampState {
  type: 'lamp'
  lit: boolean
}

/**
 * 音符ブロック (note block)。回路には信号を出力しない [確定: 26.2 NoteBlock は
 * isSignalSource 非 override = 非信号源]。ただし full-cube 導体なので solid 同等に
 * 隣接ワイヤーの上下斜め接続を切り、直接充電されると隣を活性化しうる (10 §C5)。
 *
 * 発音は BE (block event) 経由 [確定: 26.2 NoteBlock.neighborChanged / triggerEvent]:
 *   - neighborChanged で hasNeighborSignal を再評価し、POWERED と食い違えば
 *     立ち上がり (false→true) のときのみ playNote → level.blockEvent(pos, 0, 0) を
 *     キューし、POWERED を signal に更新 (setBlock flag3)。
 *   - BE フェーズの triggerEvent で実発音 (sim は音を鳴らさず発音イベントを
 *     trace / onNotePlay コールバックへ流す。I7 の BE キューに相乗り)。
 * instrument (音色) は直下/直上ブロック依存だが sim では省略 (常に BASE_BLOCK 相当)。
 * 被覆条件は「直上が空気」のみで近似する (10 §C5 注記)。
 */
export interface NoteBlockState {
  type: 'note_block'
  /** 立ち上がり検出用の受電フラグ (vanilla POWERED) */
  powered: boolean
  /** 音程 0-24 (vanilla NOTE)。sim は発音しないが blockstate として保持する */
  note: number
}

/**
 * 感圧板 (木 / 石)。エンティティが乗ると POWERED になり全方向へ weak 15、
 * 直下 (取り付け面) へ strong 15 を出す入力装置。本 sim はエンティティを
 * 持たないため activateBlock で手動 ON にし、持続 gt の tile tick で自動 OFF
 * する折衷モデルで扱う (レバーの手動トグルではなく、ボタンの自動 OFF に近い)。
 * [確定: 26.2 PressurePlateBlock / BasePressurePlateBlock]:
 *   - getSignalForState = POWERED ? 15 : 0 (全方向 weak / getDirectSignal は UP のみ)。
 *   - getPressedTime = 20gt (BasePressurePlateBlock 既定。PressurePlateBlock は非 override)。
 *   - updateNeighbours = updateNeighborsAt(pos) + updateNeighborsAt(pos.below())。
 * material は判定差 (wood=全 entity / stone=mob) と描画にのみ効き、手動モデルの
 * 論理では両者とも 15 出力・20gt 持続で同一 (判定差は再現対象外)。
 */
export interface PressurePlateState {
  type: 'pressure_plate_wood' | 'pressure_plate_stone'
  powered: boolean
}

/**
 * 重量感圧板 (light=金 / heavy=鉄)。乗ったエンティティ数に比例したアナログ信号を
 * 出す。本 sim はエンティティ計数を持たないため、editor 設定値 pressedPower を
 * そのまま出力する (計数式は通さない)。持続 gt は 10gt。
 * [確定: 26.2 WeightedPressurePlateBlock]:
 *   - getSignalStrength = count>0 ? ceil(min(count,maxWeight)/maxWeight * 15) : 0
 *     (light maxWeight=15 / heavy maxWeight=150。手動モデルでは非適用)。
 *   - getPressedTime = 10gt (override)。POWER プロパティ 0-15。
 *   - 給電形状は wooden/stone と同じ (全方向 weak / 直下 strong / self+below の NC)。
 */
export interface WeightedPressurePlateState {
  type: 'weighted_pressure_plate_light' | 'weighted_pressure_plate_heavy'
  /** 踏まれたとき出力する信号強度 (editor 設定値, 1-15)。計数式は通さず直接出力 */
  pressedPower: number
  /** 現在踏まれているか。出力信号 = powered ? pressedPower : 0 */
  powered: boolean
}

/**
 * コンテナ (チェスト / バレル等) の簡易モデル。
 *
 * 2 つのモード (blocks/container.ts で吸収。移行方法は 02 §6 に注記):
 *   1. 手動計測モード (C6, #13): count 未定義。コンパレーターが背面から読む
 *      「実効 signal」(0-15) を signal に直接保持する。物流には不参加。
 *   2. 物流モード (C6', #65): count 定義。個数を保持し、コンパレーター信号は
 *      fillSignal(count, スロット数×64) で導出する (signal は無視)。ホッパー/
 *      ドロッパーの転送先/元になれる。
 *
 * 充填率 → 強度の変換式 [確定: 02 §6 comparator —
 *   AbstractContainerMenu.getRedstoneSignalFromContainer]:
 *     f = (Σ 各スロットの count / maxStackSize) / スロット数
 *     signal = Mth.lerpDiscrete(f, 0, 15) = floor(f * 14) + (f > 0 ? 1 : 0)
 *   (空 = 0、非空は最低 1)。
 *
 * nbtIO は barrel/chest 系を signal=0 (手動モード) で import し、viewer は
 * minecraft:barrel として描画する。
 */
export interface ContainerState {
  type: 'container'
  /** 手動計測モードでコンパレーター背面から読まれる実効出力 (0-15) */
  signal: number
  /** 物流モードの個数 (定義時は signal より優先。容量 = 27×64 = 1728) */
  count?: number
}

/**
 * ホッパー (物流。C6' #65)。アイテムは「個数 count」1 本の数値で持つ
 * (スタック種別・スロットなし。容量 = 5×64 = 320)。
 *
 * [確定: 26.2 HopperBlockEntity / HopperBlock]:
 *   - BlockEntity フェーズ (02 §1.2 phase10) で毎 gt tick。転送クールダウン
 *     8gt (HOPPER_COOLDOWN)。1 回の転送で 1 個。
 *   - tryMoveItems: **送り込み (facing 先コンテナへ eject) を先に**、続いて
 *     **吸い出し (直上コンテナから suck)** を行う。両方が同 gt に起き得る
 *     (それぞれ 1 個)。いずれか成功でクールダウンを 8 に再設定。
 *   - ENABLED: HopperBlock.neighborChanged で `enabled = !hasNeighborSignal`。
 *     受電中 (enabled=false) は転送しない = ロック (setBlock flag2)。
 *   - コンテナ内容変化は CU (updateNeighbourForOutputSignal) で隣接コンパレーターへ。
 * facing = vanilla FACING = 送り込み方向 (既定 down。piston/observer と同じ非反転)。
 */
export interface HopperState {
  type: 'hopper'
  /** 送り込み方向 (vanilla FACING。down または水平)。up は取らない */
  facing: Dir6
  /** 内容個数 (0..320) */
  count: number
  /** 転送可能か (= !受電)。false でロック */
  enabled: boolean
  /**
   * このホッパーが次に転送可能になる絶対 gt (currentTick >= cooldownUntil で可)。
   * vanilla cooldownTime のデクリメント意味論を絶対時刻で表す。省略時 0 (即可)。
   */
  cooldownUntil?: number
}

/**
 * ドロッパー (物流。C6' #65)。前方がコンテナのときのみ 1 個挿入する。
 * 前方が非コンテナ (vanilla は発射 = アイテムエンティティ生成) の場合は
 * エンティティ境界原則 (13 §4.2) により **アイテムを 1 個消費して何も出さない**
 * (前方が満杯コンテナのときは vanilla 同様 no-op でアイテムは残る)。
 *
 * [確定: 26.2 DropperBlock / DispenserBlock]:
 *   - neighborChanged: `hasNeighborSignal(pos) || hasNeighborSignal(pos.above())`
 *     (QC。02 §5.3 の 3 クラス) の立ち上がりで TRIGGERED を立て
 *     scheduleTick(pos, this, 4) を予約 (setBlock flag2)。立ち下がりで TRIGGERED 解除。
 *   - tick (ST フェーズ): dispenseFrom — ランダムスロットの 1 個を前方コンテナへ
 *     HopperBlockEntity.addItem で挿入 (sim は種別なしなので count を 1 移す)。
 * facing = vanilla FACING = 出力方向 (6 方向。既定 north。非反転)。
 */
export interface DropperState {
  type: 'dropper'
  facing: Dir6
  /** 内容個数 (0..576) */
  count: number
  /** 受電エッジ検出フラグ (vanilla TRIGGERED)。 */
  triggered: boolean
}

/**
 * レッドストーンブロック。常時 weak 15 を全 6 方向に出す定数動力源。
 * [確定: 1.21.1 PoweredBlock — getSignal=15 / isSignalSource=true /
 *   getDirectSignal 非 override (=0, 固体を強充電しない) /
 *   Blocks.REDSTONE_BLOCK は isRedstoneConductor(never) = 非導体]。
 * 状態を持たない (常時通電)。
 */
export interface RedstoneBlockState {
  type: 'redstone_block'
}

/**
 * ターゲットブロック。投射物命中で発火する信号源だが、本 sim は投射物系を
 * 持たないため「手動トリガ + 持続 gt + 全方向 weak」の折衷モデルで扱う。
 * [確定: 1.21.1 TargetBlock — getSignal=OUTPUT_POWER(全方向 weak) /
 *   getDirectSignal 非 override (=0) / isSignalSource=true /
 *   持続 = 矢 20gt / その他 8gt / tick で POWER=0 / 既存 tick 中は再発火無視 /
 *   POWER>0 で pending tick 無しの設置は onPlace が 0 に戻す]。
 * activateBlock で命中を模し、outputPower=15 (中心命中相当) + 20gt 持続。
 */
export interface TargetState {
  type: 'target'
  /** 現在の出力信号強度 (0-15)。トリガ中は 15、消灯後 0 */
  outputPower: number
}

/** 信号を充電・遮断する不透過ブロック（石・丸石など） */
export interface SolidState {
  type: 'solid'
  /**
   * このブロックが充電されているか（弱/強を問わない）。
   * 表示用の派生値であり、判定ロジックは power.ts の純クエリ
   * (isSolidPowered / getStrongPower) を使う。伝播処理の最後に更新される。
   */
  powered: boolean
}

/**
 * オブザーバー。facing = 観測方向 (vanilla FACING と同一 = 顔のある面が向く方向)。
 * 出力は背面 (OPPOSITE[facing]) の 1 ブロックへ strong 15 (diode 型)。
 * [確定: 02 §4.1/§2.4/§6 observer + ObserverBlock デコンパイル / minecraft.wiki]:
 *   - NC (neighborChanged) には反応しない (BlockBehaviour 既定 = 非 override)。
 *   - updateShape (PP/SU) が観測面 (facing 方向) から届き、かつ非 powered のとき
 *     2gt (priority 0) の tile tick を予約 (startSignal / hasScheduledTick ガード)。
 *   - tick: OFF→ON は powered=true + 自身の OFF tick (2gt) を「近傍更新より先に」
 *     予約 (§2.4 のパルス飲み込み順序の根拠)。ON→OFF は powered=false。
 *     いずれも背面へ updateNeighborsInFront (NC)。パルス幅 = 2gt。
 * mcstate/viewer/nbtIO とも facing は非反転 (piston と同じ。vanilla FACING = 観測方向)。
 */
export interface ObserverState {
  type: 'observer'
  facing: Dir6
  powered: boolean
}

/** ピストン本体。extended=true のとき facing 方向に piston_head が存在する */
export interface PistonState {
  type: 'piston' | 'sticky_piston'
  facing: Dir6
  extended: boolean
}

/** ピストンヘッド (base とは独立したブロックとして存在する。vanilla 準拠) */
export interface PistonHeadState {
  type: 'piston_head'
  facing: Dir6
  sticky: boolean
}

/**
 * 移動中ブロック (vanilla block 36 / moving_piston)。伸縮の 2gt 間だけ存在し、
 * tile tick で into のブロックに置き換わる。kind は表示用 (head 側のみ sticky)
 */
export interface MovingPistonState {
  type: 'moving_piston'
  facing: Dir6
  kind: 'normal' | 'sticky'
  into: BlockState
  /** 確定 (into へ遷移) する gt。移動開始 tick + 2gt [#80: BlockEntity 相で確定] */
  finalizeDue: number
  /** 同 tick に複数の moving_piston が確定するときの順序 (旧 ST 相 tile tick の seq 相当) */
  seq: number
}

export interface AirState {
  type: 'air'
}

export type BlockState =
  | WireState
  | TorchState
  | WallTorchState
  | RepeaterState
  | ComparatorState
  | LeverState
  | ButtonState
  | LampState
  | NoteBlockState
  | PressurePlateState
  | WeightedPressurePlateState
  | ContainerState
  | HopperState
  | DropperState
  | RedstoneBlockState
  | TargetState
  | SolidState
  | ObserverState
  | PistonState
  | PistonHeadState
  | MovingPistonState
  | AirState

export type BlockType = BlockState['type']

// ============================================================
// WorldSnapshot — sim / editor / viewer 間の共通受け渡し型
// ============================================================

export interface WorldSnapshot {
  blocks: ReadonlyMap<`${number},${number},${number}`, BlockState>
  bounds: {
    x: [number, number]
    y: [number, number]
    z: [number, number]
  }
}

// ============================================================
// ScheduledTick
// ============================================================

/**
 * tile tick の予約 (02 §2 [確定] の vanilla 意味論)。
 * action は持たない — 実行時にブロック自身が世界状態を読んで動作を決める。
 * 同 pos + blockType の予約は常に 1 件 (schedule 側でデデュープ)。
 */
export interface ScheduledTick {
  pos: Pos3D
  /** 予約時のブロック種。実行時に不一致なら no-op (vanilla の実行時検証) */
  blockType: BlockType
  /** 実行予定の絶対 game tick */
  dueTick: number
  /**
   * TickPriority (02 §2.2 [確定]。小さいほど先):
   * repeater -3/-2/-1 (前方ダイオード/オフ化/他)、comparator -1/0、他 0
   */
  priority: number
  /** 同 priority 内の安定実行順 (挿入順、vanilla の subTickOrder) */
  seq: number
}

// ============================================================
// TickResult
// ============================================================

/**
 * ブロックイベント (02 §3 [確定])。挿入順 FIFO + (pos, blockType, param) で重複排除。
 * ST と違いキューが空になるまで同 tick 内で処理される (ピストン連鎖の根拠)。
 */
export interface BlockEvent {
  pos: Pos3D
  blockType: BlockType
  /** extend/retract=ピストン (I7)。play=音符ブロック発音 (26.2 blockEvent b0=0) */
  param: 'extend' | 'retract' | 'play'
}

export interface TickResult {
  changedPositions: Pos3D[]
  currentTick: number
}
