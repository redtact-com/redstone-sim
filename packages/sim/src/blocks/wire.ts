import type { Pos3D, BlockState, WireState } from '../types.js'
import type { SimWorld } from '../world.js'
import { H_DIRS, H_DIR_VEC, ALL_DIRS } from '../types.js'
import { getSignal, getStrongPower, relative } from '../power.js'

/**
 * ワイヤーの上下斜め接続をカットする（不透過扱いの）ブロックか。
 * 上りステップは「自分の直上」、下りステップは「下側ワイヤーの直上（=横のセル）」に
 * このブロックがあると切断される。
 */
export function isWireCutBlock(block: BlockState | null): boolean {
  // target / note_block は既定フルキューブ導体 (isRedstoneConductor=true) なので
  // 上下斜め接続を切る。redstone_block は isRedstoneConductor(never) = 非導体なので
  // 切らない [確定: 1.21.1 Blocks.REDSTONE_BLOCK / TargetBlock、26.2 NoteBlock]。
  return !!block && (block.type === 'solid' || block.type === 'lamp'
    || block.type === 'target' || block.type === 'note_block')
}

/**
 * 指定座標のワイヤーと信号をやり取りできる隣接ワイヤー座標の一覧を返す。
 * - 同レイヤー: connections が立っている方向のワイヤー
 * - 上りステップ: 直上が不透過でないとき、水平隣の1段上のワイヤー
 * - 下りステップ: 水平隣のセルが不透過でないとき、その1段下のワイヤー
 *
 * 直上・直下のワイヤーは vanilla では発生しない配置（支持要件で不可能）のため
 * 接続しない。上り/下りのカット判定は同じセル（下側ワイヤーの直上）を見るため
 * 対称になり、BFS の連結成分収集にそのまま使える。
 */
export function getConnectedWireNeighbors(pos: Pos3D, world: SimWorld): Pos3D[] {
  const block = world.getBlockAt(pos)
  if (!block || block.type !== 'wire') return []
  const [x, y, z] = pos
  const result: Pos3D[] = []

  const aboveSelfOpen = !isWireCutBlock(world.getBlockAt([x, y + 1, z]))

  for (const dir of H_DIRS) {
    const [dx, dz] = H_DIR_VEC[dir]
    const sidePos: Pos3D = [x + dx, y, z + dz]
    const side = world.getBlockAt(sidePos)

    // 同レイヤー: 隣接ワイヤーは常に連結 (shouldConnectTo(wire)=true のため
    // 導出接続は必ず立つ。保持値は自動拡張されないため参照しない #51)
    if (side?.type === 'wire') {
      result.push(sidePos)
    }

    // 上りステップ: 直上が開いている場合のみ
    if (aboveSelfOpen) {
      const upPos: Pos3D = [x + dx, y + 1, z + dz]
      if (world.getBlockAt(upPos)?.type === 'wire') result.push(upPos)
    }

    // 下りステップ: 横のセル（=下側ワイヤーの直上）が開いている場合のみ
    if (!isWireCutBlock(side)) {
      const downPos: Pos3D = [x + dx, y - 1, z + dz]
      if (world.getBlockAt(downPos)?.type === 'wire') result.push(downPos)
    }
  }

  return result
}

/**
 * 指定座標のワイヤーが受け取る信号強度を計算する。
 *
 * 入力源:
 * 1. 隣接する動力部品の weak 信号 (power.ts の getSignal。6 方向) → その強度
 * 2. 強充電された隣接固体ブロック → 強充電レベル
 *    (弱充電された固体はダストに給電しない [確定: docs/research/02 §5.2])
 * 3. 接続している隣接ワイヤー（同レイヤー・上り/下りステップ）の power - 1
 */
export function computeWirePower(pos: Pos3D, world: SimWorld): number {
  const block = world.getBlockAt(pos)
  if (!block || block.type !== 'wire') return 0

  let maxPower = 0

  // 隣接する動力部品からの weak 信号（6方向）
  for (const dir of ALL_DIRS) {
    if (maxPower >= 15) break
    const nPos = relative(pos, dir)
    const src = world.getBlockAt(nPos)
    if (!src) continue
    if (src.type === 'wire') continue  // ワイヤー間は下の減衰伝播で扱う
    if (src.type === 'solid') {
      // 強充電された固体のみダストに給電（弱充電はダストに見えない）
      maxPower = Math.max(maxPower, getStrongPower(world, nPos))
      continue
    }
    if (src.type === 'target') {
      // target は導体かつ信号源 [確定: 1.21.1 Blocks.TARGET は
      // isRedstoneConductor 非 override + TargetBlock.isSignalSource=true]。
      // ダストから見える値は max(自身の outputPower, 強充電)。
      // ダスト由来の弱充電は他のダストに見えない (shouldSignal=false 相当)
      // 点は solid と同じ [確定: RedStoneWireBlock.calculateTargetStrength]
      maxPower = Math.max(maxPower, getStrongPower(world, nPos), getSignal(world, pos, dir))
      continue
    }
    maxPower = Math.max(maxPower, getSignal(world, pos, dir))
  }

  // 接続ワイヤー（同レイヤー + 上り/下りステップ）からの減衰伝播
  for (const nPos of getConnectedWireNeighbors(pos, world)) {
    const src = world.getBlockAt(nPos)
    if (src?.type === 'wire') {
      maxPower = Math.max(maxPower, (src as WireState).power - 1)
    }
  }

  return Math.max(0, maxPower)
}
