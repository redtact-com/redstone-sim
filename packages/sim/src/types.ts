import type { NoteInstrument } from './blocks/noteInstrument.js'

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
 *     立ち上がり (false→true) のときのみ playNote 経由で BE (b0=0 / b1=0) を
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
  /**
   * 音色。**直下のブロックで決まり、変わるとオブザーバーに検知される** (#231)。
   * 音そのものは sim の対象外だが blockstate なので保持する。
   * 決め方は blocks/noteInstrument.ts [確定: 26.2 NoteBlock.setInstrument]
   */
  instrument: NoteInstrument
}

/**
 * 感圧板 (木 / 石)。エンティティが乗ると POWERED になり全方向へ weak 15、
 * 直下 (取り付け面) へ strong 15 を出す入力装置。本 sim はエンティティを
 * 持たないため activateBlock で手動 ON にし、持続 gt の tile tick で自動 OFF
 * する折衷モデルで扱う (レバーの手動トグルではなく、ボタンの自動 OFF に近い)。
 * [確定: 26.2 PressurePlateBlock / BasePressurePlateBlock]:
 *   - getSignalForState は POWERED なら 15、そうでなければ 0 (全方向 weak /
 *     getDirectSignal は UP のみ)。
 *   - getPressedTime = 20gt (BasePressurePlateBlock 既定。PressurePlateBlock は非 override)。
 *   - updateNeighbours は**自身の位置と真下の位置の 2 か所**から 6 方向の近隣更新を配る
 *     (NC = 自身隣接 6 + 直下の隣接 6)。
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
 *   - 個数が 0 なら 0。1 個以上なら「個数を上限で頭打ちにして 15 段階へ切り上げ」
 *     (light maxWeight=15 / heavy maxWeight=150。手動モデルでは非適用)。
 *   - getPressedTime = 10gt (override)。POWER プロパティ 0-15。
 *   - 給電形状は wooden/stone と同じ (全方向 weak / 直下 strong / self+below の NC)。
 */
export interface WeightedPressurePlateState {
  type: 'weighted_pressure_plate_light' | 'weighted_pressure_plate_heavy'
  /** 踏まれたとき出力する信号強度 (editor 設定値, 1-15)。計数式は通さず直接出力 */
  pressedPower: number
  /** 現在踏まれているか。出力信号は powered のとき pressedPower、でなければ 0 */
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
 *     signal = lerpDiscrete(f, 0, 15) 相当 = f が 0 なら 0、それ以外は f × 14 の切り捨て + 1
 *   (空 = 0、非空は最低 1)。
 *
 * nbtIO は barrel/chest 系を signal=0 (手動モード) で import し、viewer は
 * minecraft:barrel として描画する。
 */
export interface ContainerState {
  type: 'container'
  /** 手動計測モードでコンパレーター背面から読まれる実効出力 (0-15) */
  signal: number
  /** 物流モードのスロット (定義時は signal より優先。長さ 27) */
  slots?: ContainerSlots
}

/**
 * アイテムのスタック上限 (#194)。
 *
 * レッドストーン的に効くのはこの値だけ [確定: 実機測定 — ホッパー 5 スロットで
 * `iron_axe` 1 個 = 強度 3 / `snowball` 1 個 = 1 / `gold_ingot` 1 個 = 1]。
 */
export type StackSize = 1 | 16 | 64

/**
 * スロット 1 枠の中身 (#194)。
 *
 * `id` は**マージ判定にのみ使う**。強度も転送順も `stack` しか見ないが、
 * ID を捨てると「上限が同じ別アイテム」が 1 スロットに統合されてしまい、
 * スロットを使い切るタイミングが実機とずれる。
 */
export interface ItemStack {
  /** アイテム ID (`minecraft:` 接頭辞なし)。マージ判定用 */
  id: string
  /** スタック上限 */
  stack: StackSize
  /** 個数 (1..stack) */
  count: number
}

/** コンテナのスロット列。空き枠は null。長さはコンテナ種で固定 */
export type ContainerSlots = readonly (ItemStack | null)[]

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
 *   - ENABLED: HopperBlock.neighborChanged が「自身 6 面が受電していない」ことを ENABLED に入れる。
 *     受電中 (enabled=false) は転送しない = ロック (setBlock flag2)。
 *   - コンテナ内容変化は CU (updateNeighbourForOutputSignal) で隣接コンパレーターへ。
 * facing = vanilla FACING = 送り込み方向 (既定 down。piston/observer と同じ非反転)。
 */
export interface HopperState {
  type: 'hopper'
  /** 送り込み方向 (vanilla FACING。down または水平)。up は取らない */
  facing: Dir6
  /** スロット (長さ 5)。空き枠は null (#194) */
  slots: ContainerSlots
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
 *   - neighborChanged: **自身 6 面の受電 または 1 個上のマスの受電** の OR
 *     (QC。02 §5.3 の 3 クラス) の立ち上がりで TRIGGERED を立て
 *     4gt の tile tick を予約 (setBlock flag2)。立ち下がりで TRIGGERED 解除。
 *   - tick (ST フェーズ): dispenseFrom — ランダムスロットの 1 個を前方コンテナへ
 *     HopperBlockEntity.addItem で挿入 (sim は種別なしなので count を 1 移す)。
 * facing = vanilla FACING = 出力方向 (6 方向。既定 north。非反転)。
 */
/**
 * ドロッパー / ディスペンサー (#65, #161)。26.2 で `DropperBlock extends DispenserBlock`
 * [確定: DropperBlock.java:23] なので**レッドストーン側は完全に共通**:
 * 疑似接続 (自分 または 直上) の立ち上がりで 4gt の tile tick を予約し TRIGGERED を立てる。
 *
 * 差は `dispenseFrom` だけで、**ドロッパーだけが前方コンテナへ挿入する** [確定: :48]。
 * ディスペンサーは override しないので常にワールドへ射出する = **前方がコンテナでも
 * 入れない** [実機 fixture dispenser-no-insert]。sim では射出をエンティティ境界原則で
 * 「1 個消費して何も出さない」に丸めるので、この違いだけが残る。
 */
export interface DropperState {
  type: 'dropper' | 'dispenser'
  facing: Dir6
  /** スロット (長さ 9)。空き枠は null (#194) */
  slots: ContainerSlots
  /** 受電エッジ検出フラグ (vanilla TRIGGERED)。 */
  triggered: boolean
}

/**
 * レッドストーンブロック。常時 weak 15 を全 6 方向に出す定数動力源。
 * [確定: 1.21.1 PoweredBlock — getSignal=15 / isSignalSource=true /
 *   getDirectSignal 非 override (=0, 固体を強充電しない) /
 *   Blocks.REDSTONE_BLOCK は isRedstoneConductor に常時 false を与える = 非導体]。
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
   * ピストンで押せないか (#253)。[確定: 26.2 — 黒曜石・岩盤などは pushReaction(BLOCK)]
   *
   * sim は導体フルブロックを材質ごと 1 種に潰しているが、**押せるかどうかだけは
   * 材質で割れる**ので、ここで持つ。
   * [実機実測 2026-08-20: ピストンの正面が黒曜石 → 伸びない /
   *  スライムの**横**が黒曜石 → 伸びる (押せない相手は引き連れずに素通りする)]
   */
  immovable?: boolean
  /**
   * **押せるが引けない**か (#255)。[確定: 26.2 — 釉薬テラコッタは pushReaction(PUSH_ONLY)]
   *
   * 押し方向と一致する向きからしか動かないので、
   * 粘着ピストンで引くことも、スライムが横から引き連れることもできない。
   * [実機実測 2026-08-20: 正面から押す → 動く / 粘着で引く → 引けず置き去り /
   *  スライムの横に置く → 引き連れられずその場に残る]
   */
  pushOnly?: boolean
  /**
   * 上の音符ブロックへ与える音色 (#231)。sim は材質を潰しているのでここで持つ。
   * 取り込み時に実ブロック名から載せる (羊毛=guitar / 木=bass など)。
   * 無ければ正規形 stone の basedrum
   */
  instrument?: NoteInstrument
  /**
   * このブロックが充電されているか（弱/強を問わない）。
   * 表示用の派生値であり、判定ロジックは power.ts の純クエリ
   * (isSolidPowered / getStrongPower) を使う。伝播処理の最後に更新される。
   */
  powered: boolean
}

/**
 * **非導体フルブロック** (#184)。代表がガラスなので型名は glass だが、
 * ガラス系 (glass / tinted_glass / *_stained_glass) のほか
 * **glowstone / sea_lantern / ice** もここに落ちる。
 *
 * [確定: 実機ハーネスで 1 つずつ測定。repeater で強充電して隣の dust を見る]。したがって
 *   - 充電されない・信号を通さない (isConductor=false)
 *   - ワイヤーの上下斜め接続を切らない (isWireCutBlock=false)
 *   - ピストンで押せる (PushReaction 既定 = NORMAL)
 * となり、レッドストーン的には**空気とほぼ同じ**。違いはピストンの押し対象になる点。
 *
 * 既知の抽象化: 色・素材を持たず、**すべて無色ガラスとして描画する**
 * (グロウストーンを取り込むとガラスに見える)。ガラス板 (glass_pane) は
 * フルブロックでないため対象外。
 *
 * 注意: **packed_ice / blue_ice は導体**で、ice とは挙動が違う (実機で確認済み)。
 * 名前が似ていても仲間にしないこと。
 */
export interface GlassState {
  type: 'glass'
  /** 上の音符ブロックへ与える音色 (#231)。取り込み時に実ブロック名から載せる */
  instrument?: NoteInstrument
}

/**
 * ハーフブロック (単体スラブ)。**非導体** (#184)。
 *
 * 単体スラブは当たり判定がフルブロックでないため `isRedstoneConductor` の既定
 * (isCollisionShapeFullBlock) が false になる。本リポジトリの
 * `docs/research/07_mojira-fixtures.md` (MC-3703 の再現手順) にも
 * 「グロウストーンやハーフブロック等の**透過ブロック**越しに下方向へダストが接続する」
 * とあり、透過扱いであることは確定している。
 *
 * **二重スラブ (`type=double`) は別物**で、当たり判定がフルブロック = 導体。
 * 取り込み時に `solid` へ振り分ける (nbtIO.ts)。
 *
 * half は sim の挙動に一切影響しない (支持ブロック要件が未実装のため)。
 * 3D で上付き / 下付きを描き分けるためだけに持つ。素材も持たず一律 smooth_stone。
 */
export interface SlabState {
  type: 'slab'
  half: 'top' | 'bottom'
  /** 上の音符ブロックへ与える音色 (#231)。取り込み時に実ブロック名から載せる */
  instrument?: NoteInstrument
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
  /**
   * 押し出し中か引き戻し中か [確定: 26.2 PistonMovingBlockEntity.isExtending]。
   * 収縮する粘着ピストンは pos+2 の**伸長中**の moving だけを強制確定するので、
   * 向きだけでは足りず区別が要る (#231)
   */
  extending: boolean
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
 * 登録しているだけ [確定: 26.2 Blocks.java:690 / :2893 — どちらも PoweredRailBlock として登録されている]。
 * レッドストーン挙動の差は**連鎖が同種のレール間でしか繋がらない**ことだけで
 * [確定: 26.2 PoweredRailBlock.isSameRailWithPower の**同一ブロック判定ガード** —
 * 別種のレールは連鎖対象から外れる]、
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

/**
 * 銅の電球 (#155)。**1 ブロックで T フリップフロップ**になる素子。
 *   - 近隣更新のたびに hasNeighborSignal を見て、それが保持中の powered と食い違うなら
 *     **立ち上がり (powered=false → signal=true) のときだけ lit を反転**し、
 *     powered を signal に追随させる [確定: 26.2 CopperBulbBlock.checkAndFlip]
 *   - **tile tick を持たない** = 遅延 0gt。近隣更新の処理中に同期確定する
 *     [実機 fixture copper-bulb-toggle: レバーと同じ tick で確定]
 *   - コンパレーターは **lit** を読む (powered ではない)。lit なら 15、でなければ 0
 *     [確定: 26.2 getAnalogOutputSignal / 実機 fixture copper-bulb-output]
 *   - **非導体** (isRedstoneConductor に常時 false を返す述語が渡されている [確定: 26.2 Blocks.java:5272])。
 *     フルブロックだが強充電を通さないので、給電の仕切りとして使える
 *   - 自身は信号を出さない (getSignal 非 override)
 *
 * 酸化 8 バリアント (素/exposed/weathered/oxidized × waxed) は
 * **レッドストーン挙動が完全に同一**で、違うのは明るさ (15/12/8/4) と
 * ランダムティックの酸化だけ。どちらも sim は非モデルなので 1 種に集約している。
 */
export interface CopperBulbState {
  type: 'copper_bulb'
  /** 点灯状態。立ち上がりでのみ反転する = 記憶ビット */
  lit: boolean
  /** 直前に見た入力。エッジ判定のために保持する */
  powered: boolean
}

/**
 * トラップドア / フェンスゲート (#157)。**受電で開閉する出力素子**。
 *
 * どちらも挙動はほぼ同一 [確定: 26.2 TrapDoorBlock.java:125-144 /
 * FenceGateBlock.java:182-201]:
 *   `signal != powered` のとき `open = signal` にして `powered` を追随させる。
 *
 * **書き込みは flag 2** (UPDATE_CLIENTS のみ) なのが要点で、
 *   - `UPDATE_NEIGHBORS` が無い → **近隣更新を出さない**
 *   - `UPDATE_KNOWN_SHAPE(16)` も無い → updateNeighbourShapes は走り
 *     **オブザーバーには見える**
 * [実機 fixture trapdoor-redstone: 開閉では隣の BUD ピストンが伸びず、
 *  真上のオブザーバーは発火する]。銅の電球 (flag 3) との対比になる。
 *
 * 木製は素手で開閉でき (`canOpenByHand`)、そのとき **open だけが動いて powered は
 * 据え置かれる**。信号が変わるまで補正されないので、意図的なデシンクを作れる。
 * **鉄のトラップドアは素手で開かない** = レッドストーン専用の出力素子。
 */
export interface DoorLikeState {
  type: 'trapdoor_wood' | 'trapdoor_iron' | 'fence_gate'
  /** 描画用。回路挙動には影響しない */
  facing: HDir
  open: boolean
  powered: boolean
}

/**
 * ドア (#159)。**上下 2 マスにまたがる素子**で、sim では half を持つ独立した
 * 2 ブロックとして表現する (ピストン + ピストンヘッドと同じ前例)。
 *
 *   - 受電判定は **自分の位置 または 相方の半分** の OR
 *     [確定: 26.2 DoorBlock.java:228-229]。ピストン・ディスペンサー以外で唯一の
 *     疑似接続の変種で、下半分だけに給電しても両方が開く
 *     [実機 fixture door-redstone]
 *   - **更新元が同じドアブロックなら無視する** [確定: :230 — 更新元ブロックが
 *     自分自身のブロック種と一致するかを見るガード]。2 つの半分が更新を往復しないため
 *   - 2 つの半分は updateShape で常に同期する [確定: :104-106 — 相手の状態を
 *     そのままコピーして HALF だけ自分のものにする] ので、sim では状態変化時に
 *     相方へミラーする
 *   - 書き込みは **flag 2** なので近隣更新を出さない (トラップドアと同じ)
 *   - 木製は素手で開閉でき、そのとき open だけが動く。**鉄のドアは素手で開かない**
 */
export interface DoorState {
  type: 'door_wood' | 'door_iron'
  half: 'lower' | 'upper'
  /** 描画用。回路挙動には影響しない */
  facing: HDir
  open: boolean
  powered: boolean
  /**
   * 蝶番の左右 (#262)。**塀が繋がるかに効く**。
   * 扉の板は閉じているとき facing の反対側に張り付いていて、開くと 90° 回る
   * (left = 時計回り / right = 反時計回り)。塀はその板が面している辺にしか繋がらない
   */
  hinge: 'left' | 'right'
}

/**
 * クラフター (#163)。**受電部分だけを実装し、レシピは非対応**。
 *
 *   - `triggered` は**自身 6 面の受電** (hasNeighborSignal) の立ち上がりで立ち、
 *     4gt の tile tick を予約する [確定: 26.2 CrafterBlock.java:73-88]
 *   - **疑似接続を持たない**。ディスペンサーが**1 個上のマス**も見る [確定:
 *     DispenserBlock.java:131] のに対し、クラフターは自分の位置しか見ない
 *     [実機 fixture crafter-trigger: 同じ配置でディスペンサーだけが起動する]
 *   - コンパレーターは **「空でない or 無効化されたスロット数」0-9** を読む
 *     [確定: 26.2 CrafterBlockEntity.getRedstoneSignal:251-262]。コンテナの
 *     充填率とは**別系統**の読み方
 *
 * **レシピ体系はアイテム種別を要求するのでスコープ外** (13 §2 の物流モデルは
 * 「コンテナ内の数値」までしか持たない)。したがって:
 *   - `crafting=true` の成功パルスは**出ない**
 *   - 9 スロットの中身・無効化スロットは持たず、`occupiedSlots` を手動指定の
 *     折衷値として扱う (コンテナの手動 `signal` と同じ前例。10 C6)
 */
export interface CrafterState {
  type: 'crafter'
  /** ORIENTATION の front。描画用で回路挙動には影響しない */
  facing: Dir6
  triggered: boolean
  /** コンパレーターが読む「埋まっているスロット数」0-9 (手動指定の折衷) */
  occupiedSlots: number
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
  | LodestoneState
  | DecorState
  | CauldronState
  | ComposterState
  | LecternState
  | StoneWallState
  | SoulSandState
  | WaterState
  | BubbleColumnState
  | ContainerState
  | HopperState
  | DropperState
  | RedstoneBlockState
  | TargetState
  | SolidState
  | GlassState
  | SlabState
  | SlimeBlockState
  | HoneyBlockState
  | ObserverState
  | PistonState
  | PistonHeadState
  | MovingPistonState
  | PoweredRailState
  | PlainRailState
  | DetectorRailState
  | CopperBulbState
  | DoorLikeState
  | DoorState
  | CrafterState
  | AirState

/**
 * ロードストーン (#234)。**石 (導体) だがピストンで押せない**
 * [確定: 26.2 Blocks.LODESTONE — pushReaction が BLOCK]。
 * スライムにもくっつかない (不動なので塊収集から自然に外れる)。
 * ガラスエレベーターはこの 3 点だけを使っている。
 */
export interface LodestoneState {
  type: 'lodestone'
  /** 充電されているか (表示用の派生値。solid と同じ扱い) */
  powered: boolean
}

/**
 * 装飾ブロック (#234)。レッドストーン的には**非導体・非可動源・信号に無関係**で、
 * 置いてあるだけのもの (end_rod / 階段 / 壁掛け看板 など) をここへ集約する。
 *
 * 見た目だけは区別したいので**取り込み元のブロック名を持つ** (判断 E)。
 * ピストンでは押せる (どれも PushReaction NORMAL)。
 */
export interface DecorState {
  type: 'decor'
  /** 取り込み元の blockstate 文字列 (例 `end_rod[facing=up]`)。描画に使う */
  name: string
}

/**
 * 水入り大釜 (#234)。**コンパレーターが中身の量を読む**
 * [確定: 26.2 LayeredCauldronBlock.getAnalogOutputSignal — LEVEL をそのまま返す]。
 * 汲む/注ぐ操作は sim のスコープ外なので level は取り込んだ値で固定 (判断 D)。
 */
export interface CauldronState {
  type: 'cauldron'
  /** 水位 1-3 (0 は空の大釜 = 別ブロック扱いだが取り込みでは 0 も許す) */
  level: number
}

/**
 * コンポスター (#234)。**コンパレーターが堆肥の量を読む**
 * [確定: 26.2 ComposterBlock.getAnalogOutputSignal — LEVEL をそのまま返す]。
 * 投入操作は sim のスコープ外なので level は取り込んだ値で固定 (判断 D)。
 */
export interface ComposterState {
  type: 'composter'
  /** 堆肥の量 0-8 */
  level: number
}

/**
 * 書見台 (#240)。**コンパレーターがページ番号を読む**ので階数指定に使われる。
 *
 * [確定: 26.2 LecternBlock.getAnalogOutputSignal → LecternBlockEntity.getRedstoneSignal —
 *  ページ進捗 = 本のページ数が 2 以上なら「現在ページ ÷ (ページ数 - 1)」、1 以下なら 1.0。
 *  出力 = 進捗 × 14 の切り捨て + (本の実体を持つなら 1)]
 * 実機で確認 (5 ページ本): Page=0→1 / 1→4 / 2→8 / 3→11 / 4→15。
 * **本を持たない has_book=true は 14** (pageCount=0 なので pageProgress=1.0、hasBook()=false)。
 * ページ数 1 以下の本は 15。has_book=false は 0。
 */
export interface LecternState {
  type: 'lectern'
  facing: HDir
  /** blockstate の has_book。false なら出力 0 */
  hasBook: boolean
  /** 開いているページ (0 始まり) */
  page: number
  /** 本のページ数。**0 = 本の中身が無い** (blockstate だけ has_book=true) */
  pages: number
}

/** 塀の 1 辺の高さ [確定: 26.2 WallSide] */
export type WallSide = 'none' | 'low' | 'tall'

/**
 * 塀 (#234)。**形状変化で下方向へ無遅延に信号を送る**のに使われる。
 *
 * 仕掛けは [確定: 26.2 WallBlock.shouldRaisePost — 判定の冒頭で真上のブロックを見て、
 *  それが塀でありかつ up が true なら、他の条件を一切見ずに true を返す]。
 * **上の塀が up=true なら自分も up=true** になる。updateShape は隣へ連鎖するので、
 * 上端の 1 か所を変えると柱の全段が同じ tick で反転する
 * (実機で確認: 7 段の柱が t=0 で全段 false → true、下端のオブザーバーが 2gt 後に発火)。
 */
export interface StoneWallState {
  type: 'wall'
  north: WallSide
  east: WallSide
  south: WallSide
  west: WallSide
  /** 中央の柱を立てるか。**上の塀と同期する**のが無遅延伝播の要 */
  up: boolean
  waterlogged: boolean
}

/**
 * ソウルサンド (#234)。**導体** (実機ハーネスで測定済み) だが、
 * 泡柱の源になるので `solid` に潰さず独立した型で持つ。
 * [確定: 26.2 SoulSandBlock.tick → BubbleColumnBlock.updateColumn で上へ柱を作る]
 */
export interface SoulSandState {
  type: 'soul_sand'
  /** 充電されているか (表示用の派生値。solid と同じ扱い) */
  powered: boolean
}

/**
 * 水 (#234 / #252)。レッドストーン的には何もしない (非導体・非信号源)。
 *
 * **流体としては最小限しか実装しない**。持つのは 2 種類だけ:
 *
 * | level | 何か | 泡柱が立つか |
 * |---|---|---|
 * | 0 | 水源 | **立つ** |
 * | 8 | 落下水 (上から落ちてきたもの) | **立たない** |
 *
 * **横方向の流水 (level 1-7) は実装しない**。ガラスエレベーターが使うのは
 * 「ディスペンサーが水源を汲む → 柱が切れる → 上から水が落ちてくる」の縦経路だけで、
 * シャフトはガラスで囲まれていて水が横に出る場所が無い (#252 でユーザが選んだ範囲)。
 * 水没・水源生成・氷や溶岩との相互作用も範囲外。
 */
export interface WaterState {
  type: 'water'
  /** 0 = 水源 / 8 = 落下水。1-7 (横に広がる流水) は実装していない */
  level: 0 | 8
}

/**
 * 泡柱 (ソウルサンド / マグマ + 水) (#234)。
 *
 * **縦の無遅延バス**として使われる。仕組みは
 * [確定: 26.2 BubbleColumnBlock.updateColumn] —
 * 起点セルから**上へループで同期的に flag 2 の setBlock を繰り返す**ので、
 * 柱の全段が同じ tick で書き換わる (140 段でも 1 tick)。flag 2 は近隣更新を出さないが
 * 形状更新は配られるため、**隣のオブザーバーが検知できる**。
 *
 * 乱されたときは [確定: updateShape] **5gt の tile tick を予約**して 5gt 後に評価する。
 */
export interface BubbleColumnState {
  type: 'bubble_column'
  /** true = 下向き (マグマ) / false = 上向き (ソウルサンド) */
  drag: boolean
}

export type BlockType = BlockState['type']

export type { NoteInstrument } from './blocks/noteInstrument.js'

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
  container: true,       // 樽/チェストの中身を手で出し入れする折衷 (#236)
  lectern: true,         // ページをめくる (#240)

  // 受電・観測でしか動かない素子
  wire: false,
  torch: false,
  wall_torch: false,
  repeater: false,
  comparator: false,
  lamp: false,
  note_block: false,
  copper_bulb: false,   // 受電で反転するだけで手動トリガは無い
  trapdoor_wood: true,  // 素手で開閉できる (open だけ動く)
  fence_gate: true,
  trapdoor_iron: false, // レッドストーン専用。素手では開かない
  door_wood: true,      // 素手で開閉できる (open だけ動く)
  door_iron: false,     // レッドストーン専用
  observer: false,
  redstone_block: false,
  piston: false,
  sticky_piston: false,
  piston_head: false,
  moving_piston: false,
  rail: false,
  powered_rail: false,
  activator_rail: false,
  hopper: false,
  dropper: false,
  dispenser: false,
  crafter: false,
  solid: false,
  glass: false,
  slab: false,
  slime_block: false,
  honey_block: false,
  // #234 で追加。どれも手動トリガの対象ではない
  lodestone: false,
  decor: false,
  cauldron: false,
  composter: false,

  wall: false,
  soul_sand: false,
  water: false,
  bubble_column: false,
  air: false,
}

/** 手動トリガできるブロック種の一覧 (#153)。UI 側のリストはこれと一致させる */
export const TRIGGERABLE_TYPES: BlockType[] =
  (Object.keys(IS_TRIGGERABLE) as BlockType[]).filter(t => IS_TRIGGERABLE[t])

export function isTriggerableType(type: BlockType): boolean {
  return IS_TRIGGERABLE[type]
}
