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
/**
 * スライムブロック / 蜂蜜ブロック (#121)。ピストンで動かすと**くっついている塊も一緒に動く**
 * (PushReaction STICKY)。互いにはくっつかない [確定: 26.2 PistonStructureResolver]。
 *
 * **スライムは導体、蜂蜜は非導体** [確定: 26.2 — isRedstoneConductor の既定は
 * isCollisionShapeFullBlock。SLIME_BLOCK は noOcclusion() のみで当たり判定はフルブロック、
 * HoneyBlock.SHAPE = column(14,0,15) はフルブロックでない]。フライングマシンは
 * オブザーバーの出力がスライム越しにピストンへ届くことで動く (#123)。
 *
 * 既知の抽象化: 落下ダメージ無効化・跳ね返り・移動速度低下といったエンティティ側の効果は
 * 持たない (13 §2 エンティティ境界原則)。
 */
export interface SlimeBlockState {
  type: 'slime_block'
}

export interface HoneyBlockState {
  type: 'honey_block'
}

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

/**
 * 直線レール形状 (直線 2 + 坂 4)。powered_rail / activator_rail / detector_rail が
 * 取れるのはこの 6 種だけで、曲線は持たない
 * [確定: 26.2 PoweredRailBlock.SHAPE = BlockStateProperties.RAIL_SHAPE_STRAIGHT]。
 */
export type StraightRailShape =
  | 'north_south' | 'east_west'
  | 'ascending_north' | 'ascending_south' | 'ascending_east' | 'ascending_west'

/**
 * 曲線レール形状 (#140)。通常レール `rail` だけが取る 4 種
 * [確定: 26.2 RailBlock.SHAPE = BlockStateProperties.RAIL_SHAPE (10 種)]。
 * 名前は「繋がる 2 方向」を表す (south_east なら南と東に繋がる)。
 */
export type CurvedRailShape = 'south_east' | 'south_west' | 'north_west' | 'north_east'

/** レール形状 10 種。曲線を取れるのは通常レールのみ (#127, #140) */
export type RailShape = StraightRailShape | CurvedRailShape

export const RAIL_SHAPES_STRAIGHT: StraightRailShape[] = [
  'north_south', 'east_west',
  'ascending_north', 'ascending_south', 'ascending_east', 'ascending_west',
]

export const RAIL_SHAPES_CURVED: CurvedRailShape[] = [
  'south_east', 'south_west', 'north_west', 'north_east',
]

const CURVED_SET: ReadonlySet<string> = new Set(RAIL_SHAPES_CURVED)

/** 曲線形状か。通常レール以外に代入する前のガードに使う (#140) */
export function isCurvedRailShape(shape: RailShape): shape is CurvedRailShape {
  return CURVED_SET.has(shape)
}

export function isStraightRailShape(shape: RailShape): shape is StraightRailShape {
  return !CURVED_SET.has(shape)
}

/**
 * 坂形状か [確定: 26.2 RailShape.isSlope]。
 * **曲線を坂と誤判定しない**よう、直線 2 種の否定ではなくホワイトリストで判定する
 * (曲線 4 種が加わった #140 以降はこの区別が要る)。
 */
export function isRailSlope(shape: RailShape): boolean {
  return shape === 'ascending_north' || shape === 'ascending_south'
    || shape === 'ascending_east' || shape === 'ascending_west'
}

/**
 * 動力を持つレールの種別 (#138)。26.2 に ActivatorRailBlock は**存在せず**、
 * activator_rail は powered_rail と同じ PoweredRailBlock を別インスタンスとして
 * 登録しているだけ [確定: 26.2 Blocks.java:690 / :2893 — どちらも PoweredRailBlock::new]。
 * レッドストーン挙動の差は**連鎖が同種のレール間でしか繋がらない**ことだけで
 * [確定: 26.2 PoweredRailBlock.isSameRailWithPower の `!state.is(this)` ガード]、
 * activator = トロッコを起動する側面はエンティティなのでスコープ外 (13 §2)。
 */
export type PoweredRailType = 'powered_rail' | 'activator_rail'

export const POWERED_RAIL_TYPES: PoweredRailType[] = ['powered_rail', 'activator_rail']

/**
 * パワードレール / アクティベーターレール (#127, #138)。トロッコを持たないため
 * エンティティ側の加速・起動効果は実装せず、**レッドストーン素子としての側面のみ**を
 * 扱う (13 §2 エンティティ境界原則):
 *   - powered = 自身6面の受電 (hasNeighborSignal) **または**
 *     繋がった**同種の**レールを前後方向に最大 8 個たどった先での受電
 *     [確定: 26.2 PoweredRailBlock.findPoweredRailSignal — searchDepth >= 8 で打ち切り]
 *   - powered が変化したら**真下のブロック**へ近隣更新を出す (坂なら真上へも)
 *     [確定: 26.2 PoweredRailBlock.updateState]
 *   - 自身は信号を出さず (getSignal 非 override)、導体でもない (非フルブロック)
 * shape は設置時に隣接レールから自動決定される (RailState.place。rail.ts)。
 * 形状の接続は種別をまたぐ (BlockTags.RAILS) が、**動力の連鎖はまたがない**。
 */
export interface PoweredRailState {
  type: PoweredRailType
  shape: StraightRailShape
  powered: boolean
}

/**
 * 通常レール `rail` (#140)。動力を持たず信号も出さないが、**曲線 4 形状**を取り
 * [確定: 26.2 RailBlock.SHAPE = BlockStateProperties.RAIL_SHAPE]、
 * 「両軸に隣接がある (= 3 方向以上) ジャンクション」では**給電の有無で曲がる先が
 * 反転する** [確定: 26.2 RailState.place の第三段。hasSignal=true なら NW>NE>SW>SE、
 * false なら SE>SW>NE>NW]。これが通常レールをレッドストーン素子たらしめている。
 * 名前は vanilla の形状計算クラス `RailState` と紛らわしいため `PlainRailState`
 * とした (ブロック ID は `rail`)。形状計算そのものは rail.ts の RailConnector。
 */
export interface PlainRailState {
  type: 'rail'
  shape: RailShape
}

/**
 * ディテクターレール (#146)。レール 4 種で**唯一信号を出す**ブロック。
 * トリガはマインカートの検出だけ (entityInside / 20gt ごとの tick / onPlace)
 * [確定: 26.2 DetectorRailBlock.java:56-79] なので、エンティティを持たない sim では
 * **感圧板・ターゲットと同じ折衷モデル** (手動トリガ + 持続 gt で auto-off) を採る
 * (13 §2 エンティティ境界原則)。
 *   - 出力: 全方向へ weak 15 / 強充電は **真下のブロックのみ**
 *     [確定: 26.2 DetectorRailBlock.ownSignal / getDirectSignal (UP のみ)]
 *   - 持続: 20gt [確定: 26.2 PRESSED_CHECK_PERIOD]
 *     [実機 fixture detector-rail-cart-pulse: t3 検出 → t23 OFF]
 *   - 形状は直線 6 種のみ。実行中の形状再計算はしない (4 引数 updateState 非 override)
 *   - コンパレーター出力は空カート相当で常に 0
 */
export interface DetectorRailState {
  type: 'detector_rail'
  shape: StraightRailShape
  powered: boolean
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
  | SlimeBlockState
  | HoneyBlockState
  | ObserverState
  | PistonState
  | PistonHeadState
  | MovingPistonState
  | PoweredRailState
  | PlainRailState
  | DetectorRailState
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

/** ピストンが動かせるブロック数の上限 [確定: 26.2 PistonStructureResolver.MAX_PUSH_DEPTH] */
export const MAX_PUSH_DEPTH = 12

/** スライム/蜂蜜ブロックか (26.2 PistonStructureResolver.isSticky) */
export function isStickyBlock(block: BlockState): boolean {
  return block.type === 'slime_block' || block.type === 'honey_block'
}

/**
 * 互いにくっつくか (26.2 canStickToEachOther)。
 * **蜂蜜とスライムは互いにくっつかない**のが要点。
 */
export function canStickToEachOther(a: BlockState, b: BlockState): boolean {
  if (a.type === 'honey_block' && b.type === 'slime_block') return false
  if (a.type === 'slime_block' && b.type === 'honey_block') return false
  return isStickyBlock(a) || isStickyBlock(b)
}

/**
 * 手動トリガ (`SimWorld.activateBlock`) を受け付けるブロックか (#153)。
 *
 * **Record<BlockType, boolean> にしてあるのは網羅を型で強制するため**。
 * 新しいブロック種を BlockState union に足すと、ここを埋めるまでビルドが通らない
 * = 「トリガできる素子なのに UI から触れない」という追加漏れが起きなくなる。
 *
 * 実体は world.ts の activateBlock の分岐と 1 対 1 で、`app/src/palette.ts` の
 * TRIGGER_META もこの一覧と一致することをテストで突き合わせている
 * (#146 detector_rail で実際に取りこぼしたのがきっかけ)。
 */
const IS_TRIGGERABLE: Record<BlockType, boolean> = {
  // 手動トリガできる素子
  lever: true,
  button_stone: true,
  button_wood: true,
  pressure_plate_wood: true,
  pressure_plate_stone: true,
  weighted_pressure_plate_light: true,
  weighted_pressure_plate_heavy: true,
  target: true,          // 投射物命中の折衷
  detector_rail: true,   // トロッコ検出の折衷 (#146)

  // 受電・観測でしか動かない素子
  wire: false,
  torch: false,
  wall_torch: false,
  repeater: false,
  comparator: false,
  lamp: false,
  note_block: false,
  observer: false,
  redstone_block: false,
  piston: false,
  sticky_piston: false,
  piston_head: false,
  moving_piston: false,
  rail: false,
  powered_rail: false,
  activator_rail: false,
  container: false,
  hopper: false,
  dropper: false,
  solid: false,
  slime_block: false,
  honey_block: false,
  air: false,
}

/** 手動トリガできるブロック種の一覧 (#153)。UI 側のリストはこれと一致させる */
export const TRIGGERABLE_TYPES: BlockType[] =
  (Object.keys(IS_TRIGGERABLE) as BlockType[]).filter(t => IS_TRIGGERABLE[t])

export function isTriggerableType(type: BlockType): boolean {
  return IS_TRIGGERABLE[type]
}
