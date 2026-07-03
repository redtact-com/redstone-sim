import type {
  Pos3D, Dir6, HDir, TorchState, WallTorchState, BlockState,
} from './types.js'
import type { SimWorld } from './world.js'
import { OPPOSITE, ALL_DIRS } from './types.js'

// ============================================================
// 電力クエリ関数群 (issue #10 / I2)
//
// 充電状態のキャッシュを持たず、vanilla 同様に「その場で隣接を
// 見に行く」純クエリとして weak/strong 動力モデルを実装する。
// 意味論は docs/research/02 §5 の weak/strong モデル (wiki 準拠):
//   - 動力部品の weak 信号は隣接する機構 (lamp/torch/repeater 等) を
//     作動させ、ダストにも給電する
//   - 固体 (導体) を充電できるのは strong 信号源 (リピーター/
//     コンパレーター出力・トーチ直上・レバー/ボタン取り付け面) と
//     ダスト (弱充電) のみ。レバーやトーチの weak 信号は固体を
//     充電しない [確定: 02 §5.2]
//   - 弱充電された固体は隣接機構を作動させるが、ダストには給電しない
//   - 強充電された固体はダストにも給電する
// ============================================================

/**
 * 導体 (被充電され得るブロック) か。
 * [確定: 1.21.1 Blocks.java] target は isRedstoneConductor 非 override
 * (既定フルキューブ = 導体)。redstone_block は isRedstoneConductor(never) で
 * 非導体。sim では solid / target の 2 種が導体。
 * 導体は strong 源 (getStrongPower) とダスト (getWireWeakCharge) で充電され、
 * 充電状態は隣接機構・ダイオード入力に伝わる (getSolidPower / isFacePowered)。
 */
export function isConductor(block: BlockState | null): boolean {
  // note_block は既定フルキューブで isRedstoneConductor=true (solid 同等)。
  // 直接充電されると隣を活性化しうる (10 §C5)。信号は出さない [確定: 26.2]。
  return !!block && (block.type === 'solid' || block.type === 'target' || block.type === 'note_block')
}

/** pos から dir 方向に 1 進んだ座標 */
export function relative(pos: Pos3D, dir: Dir6): Pos3D {
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

/** トーチの取り付け面 (トーチから見て土台がある方向) */
export function getTorchAttachFace(block: TorchState | WallTorchState): Dir6 {
  if (block.type === 'wall_torch') return block.facing
  // 床置き (facing='up') → 土台は下。facing='down' は非バニラ配置だが対称に扱う
  return block.facing === 'down' ? 'up' : 'down'
}

/**
 * トーチが strong 信号 (固体の強充電) を出す方向。
 * 床置き・壁付けとも直上のブロックのみ強充電する [要検証: 02 §6 torch は
 * current 調査の記憶ベース。I1 デコンパイル確定後に要照合]。
 * facing='down' の非バニラ配置のみアナロジーで直下とする。
 */
function getTorchStrongFace(block: TorchState | WallTorchState): Dir6 {
  if (block.type === 'torch' && block.facing === 'down') return 'down'
  return 'up'
}

/** レバー/ボタンの取り付け面 (facing はブロックが向いている方向 = 壁の逆) */
function getAttachFace(facing: Dir6): Dir6 {
  return OPPOSITE[facing]
}

/**
 * srcPos のブロックが toDir 方向へ出す weak 信号 (0-15)。
 * 固体の充電状態はここには含めない (isFacePowered / getSolidPower で扱う)。
 *
 * - レバー/ボタン: 全 6 方向に 15 [要検証: 02 §6 lever/button]
 * - トーチ: 取り付け面以外の 5 方向に 15 (G3) [要検証: I1 確定後に要照合]
 * - リピーター/コンパレーター: facing 方向のみ
 * - レッドストーンブロック: 全 6 方向に 15 [確定: 1.21.1 PoweredBlock.getSignal]
 * - ターゲット: 全 6 方向に outputPower [確定: 1.21.1 TargetBlock.getSignal]
 *   (いずれも getDirectSignal 非 override のため強充電はしない = weak のみ)
 * - ワイヤー: 足元 (down) + 接続方向の水平。上方向へは給電しない (G5)
 *   [確定: 26.2 デコンパイル RedStoneWireBlock.getSignal — direction==DOWN で 0
 *    (真上は非給電)、power!=0 かつ (direction==UP または opposite 方向が接続) で power。
 *    給電判定は getConnectionState (0 本→cross / 1 本→直線 拡張済) を再計算する。
 *    sim は WireState.connections を静的に持つが、vanilla 拡張は接続導出層
 *    (mcstate.mcToSim / editor.computeWireConnections) で済ませているため等価。
 *    形状×方向マトリクスは docs/research/11。02 §5.4 と #44 で確定]。
 */
function getEmittedSignal(world: SimWorld, srcPos: Pos3D, toDir: Dir6): number {
  const src = world.getBlockAt(srcPos)
  if (!src) return 0
  switch (src.type) {
    case 'lever':
    case 'button_stone':
    case 'button_wood':
      return src.powered ? 15 : 0
    case 'pressure_plate_wood':
    case 'pressure_plate_stone':
      // 全方向へ weak 15 (BasePressurePlateBlock.ownSignal = getSignalForState)
      // [確定: 26.2]。強充電は直下のみ (getEmittedDirectSignal 側)
      return src.powered ? 15 : 0
    case 'weighted_pressure_plate_light':
    case 'weighted_pressure_plate_heavy':
      // 全方向へ weak = 設定信号強度 (手動モデルは計数式を通さず直接出力)
      return src.powered ? src.pressedPower : 0
    case 'redstone_block':
      return 15
    case 'target':
      return src.outputPower
    case 'torch':
    case 'wall_torch': {
      if (!src.lit) return 0
      return toDir === getTorchAttachFace(src) ? 0 : 15
    }
    case 'repeater':
      return src.powered && src.facing === toDir ? 15 : 0
    case 'comparator':
      return src.powered && src.facing === toDir ? src.outputPower : 0
    case 'observer':
      // 出力は背面 (観測面 facing の反対) の 1 マスのみに weak/strong 15。
      // getSignal は getDirectSignal に委譲されるため weak=strong=15 [確定: §6 observer]。
      return src.powered && toDir === OPPOSITE[src.facing] ? 15 : 0
    case 'wire': {
      if (src.power === 0) return 0
      if (toDir === 'down') return src.power
      if (toDir === 'up') return 0
      return src.connections[toDir as HDir] ? src.power : 0
    }
    default:
      return 0
  }
}

/**
 * srcPos のブロックが toDir 方向へ出す strong 信号 (0-15)。
 * strong 信号は固体を「強充電」し、強充電された固体はダストにも給電する。
 *
 * - レバー/ボタン: 取り付け面のみ (G13) [要検証: 02 §6]
 * - トーチ: 直上のみ (G3) [要検証: I1 確定後に要照合]
 * - リピーター/コンパレーター: facing 方向
 * - ワイヤー: strong 信号は出さない (足元弱充電は getWireWeakCharge で別扱い)
 */
function getEmittedDirectSignal(world: SimWorld, srcPos: Pos3D, toDir: Dir6): number {
  const src = world.getBlockAt(srcPos)
  if (!src) return 0
  switch (src.type) {
    case 'lever':
    case 'button_stone':
    case 'button_wood':
      return src.powered && toDir === getAttachFace(src.facing) ? 15 : 0
    case 'pressure_plate_wood':
    case 'pressure_plate_stone':
      // 取り付け面 = 直下ブロックのみを強充電 [確定: 26.2
      // BasePressurePlateBlock.getDirectSignal = (direction==UP) ? signal : 0。
      // vanilla の UP = 受信側→板 の向き = sim の板→受信側 'down' に対応]
      return src.powered && toDir === 'down' ? 15 : 0
    case 'weighted_pressure_plate_light':
    case 'weighted_pressure_plate_heavy':
      return src.powered && toDir === 'down' ? src.pressedPower : 0
    case 'torch':
    case 'wall_torch':
      return src.lit && toDir === getTorchStrongFace(src) ? 15 : 0
    case 'repeater':
      return src.powered && src.facing === toDir ? 15 : 0
    case 'comparator':
      return src.powered && src.facing === toDir ? src.outputPower : 0
    case 'observer':
      // 背面 1 マスを強充電する (diode 型)。getDirectSignal が FACING==direction で
      // 15 を返す = 観測面の反対 (OPPOSITE[facing]) へ direct 15 [確定: §6 observer]。
      return src.powered && toDir === OPPOSITE[src.facing] ? 15 : 0
    default:
      return 0
  }
}

/** pos の dir 面に入ってくる weak 信号 (0-15) = 隣接ブロックの weak 出力 */
export function getSignal(world: SimWorld, pos: Pos3D, dir: Dir6): number {
  return getEmittedSignal(world, relative(pos, dir), OPPOSITE[dir])
}

/** pos の dir 面に入ってくる strong 信号 (0-15)。固体の強充電判定に使う */
export function getDirectSignal(world: SimWorld, pos: Pos3D, dir: Dir6): number {
  return getEmittedDirectSignal(world, relative(pos, dir), OPPOSITE[dir])
}

/** 6 方向から入る weak 信号の最大値 */
export function getNeighborSignal(world: SimWorld, pos: Pos3D): number {
  let max = 0
  for (const dir of ALL_DIRS) {
    max = Math.max(max, getSignal(world, pos, dir))
    if (max >= 15) break
  }
  return max
}

/**
 * 導体ブロック (solid / target) pos の強充電レベル (0-15)。
 * 強充電された導体はダストにも隣接機構にも給電する。
 */
export function getStrongPower(world: SimWorld, pos: Pos3D): number {
  let max = 0
  for (const dir of ALL_DIRS) {
    max = Math.max(max, getDirectSignal(world, pos, dir))
    if (max >= 15) break
  }
  return max
}

/**
 * 導体ブロック (solid / target) pos がダストから受ける弱充電レベル (0-15)。
 * ダストは「足元のブロック + 接続方向のブロック」を弱充電する (G5, G14)
 * [確定: 02 §5.4 — RedStoneWireBlock.getDirectSignal は shouldSignal 中のみ
 * getSignal と同値。target も導体として同じ規則で充電される]。
 * 弱充電は他のダストには見えない (shouldSignal=false 相当は computeWirePower 側)。
 */
export function getWireWeakCharge(world: SimWorld, pos: Pos3D): number {
  let max = 0
  for (const dir of ALL_DIRS) {
    const nPos = relative(pos, dir)
    if (world.getBlockAt(nPos)?.type !== 'wire') continue
    max = Math.max(max, getEmittedSignal(world, nPos, OPPOSITE[dir]))
    if (max >= 15) break
  }
  return max
}

/**
 * 導体ブロック (solid / target) の充電レベル (強充電とダスト弱充電の最大)。
 * コンパレーターの背面読み取りや隣接機構の作動判定に使う。
 * [確定: 1.21.1 SignalGetter.getSignal — isRedstoneConductor なら
 * max(自身の getSignal, getDirectSignalTo)。target は自身も信号源のため
 * 呼び出し側で outputPower (getSignal 経由) と max を取ること]
 */
export function getSolidPower(world: SimWorld, pos: Pos3D): number {
  return Math.max(getStrongPower(world, pos), getWireWeakCharge(world, pos))
}

/** 導体ブロックが充電されているか (weak / strong を問わない) */
export function isSolidPowered(world: SimWorld, pos: Pos3D): boolean {
  return getSolidPower(world, pos) > 0
}

/**
 * pos の dir 面が動力を受けているか。
 * 隣が充電された導体 (solid / target。weak/strong 問わず) か、
 * weak 信号が入っていれば true。target は導体かつ信号源なので、
 * 充電と自身の outputPower (getSignal 経由) の両方を見る
 * [確定: 1.21.1 SignalGetter.getSignal の isRedstoneConductor 分岐]。
 */
export function isFacePowered(world: SimWorld, pos: Pos3D, dir: Dir6): boolean {
  const nPos = relative(pos, dir)
  const nb = world.getBlockAt(nPos)
  if (isConductor(nb) && isSolidPowered(world, nPos)) return true
  return getSignal(world, pos, dir) > 0
}

/**
 * ブロックが動力を受けているか (vanilla の hasNeighborSignal 相当)。
 * 機構 (lamp / repeater / comparator / torch 土台) の入力判定に使う。
 * 直接の weak 信号受信、または隣接固体の充電 (弱充電含む) で true。
 */
export function isBlockPowered(world: SimWorld, pos: Pos3D): boolean {
  for (const dir of ALL_DIRS) {
    if (isFacePowered(world, pos, dir)) return true
  }
  return false
}
