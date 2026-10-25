import type { Pos3D, BlockState, WireState } from '../types.js'
import type { SimWorld } from '../world.js'
import { H_DIRS, H_DIR_VEC, ALL_DIRS } from '../types.js'
import { getSignal, getStrongPower, relative, isConductor } from '../power.js'

/**
 * ワイヤーの上下斜め接続を切る (= 導体の) ブロックか。
 * 上りステップは「自分の直上」、下りステップは「下側ワイヤーの直上 (= 横のセル)」に
 * 導体があると切れる。
 *
 * **isConductor (power.ts) そのもの**。vanilla は真上の判定も横の判定も
 * isRedstoneConductor で決めるので、別の一覧は持たない
 * [確定: 1.21.1 RedStoneWireBlock#getConnectingSide / #calculateTargetStrength]。
 * 以前は別の一覧を持っていて slime_block / lodestone / soul_sand が抜けていた (R-2)。
 * stone / target / note_block / dropper / dispenser / crafter / lamp が切り、
 * glass / chest / observer / hopper / 銅の電球が切らないのは実機で測ってある
 * [実機 fixture wire-cut-conductor]。樽は導体なので切る [実機 fixture barrel-chest-conductor:
 * 強充電が隣のランプへ通る]。redstone_block は非導体なので切らない [確定: 1.21.1 Blocks.REDSTONE_BLOCK]。
 */
export function isWireCutBlock(block: BlockState | null): boolean {
  return isConductor(block)
}

/**
 * 指定座標のワイヤーと物理的に接続している (= 1 つの網をなす) 隣接ワイヤー座標の一覧。
 * **連結成分の収集と、増加 BFS で再計算する相手を決めるためのもので、電力の入力には使わない**
 * (入力は getWireInputNeighbors。接続形状は wire-shape.ts が別に導出する)。
 * - 同レイヤー: 隣接ワイヤー
 * - 上りステップ: 自分の直上が導体でないとき、水平隣の 1 段上のワイヤー
 * - 下りステップ: 水平隣のセルが導体でないとき、その 1 段下のワイヤー
 *
 * 直上・直下のワイヤーは vanilla では発生しない配置 (支持要件で不可能) のため
 * 接続しない。上り/下りの判定は同じセル (下側ワイヤーの直上) を見るので関係は対称で、
 * 入力の関係 (getWireInputNeighbors) を両向きに含む。propagateWireBFS はこの性質に
 * 頼っている (起点のワイヤーから入力の関係で辿れるワイヤーは必ず同じ成分に入り、
 * 入力が増えたワイヤーは必ずこの近傍から再計算される。起点そのものの集め方は
 * world.ts の collectWireStarts)。
 */
export function getConnectedWireNeighbors(pos: Pos3D, world: SimWorld): Pos3D[] {
  const block = world.getBlockAt(pos)
  if (!block || block.type !== 'wire') return []
  const [x, y, z] = pos
  const result: Pos3D[] = []

  const aboveSelfOpen = !isConductor(world.getBlockAt([x, y + 1, z]))

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
    if (!isConductor(side)) {
      const downPos: Pos3D = [x + dx, y - 1, z + dz]
      if (world.getBlockAt(downPos)?.type === 'wire') result.push(downPos)
    }
  }

  return result
}

/**
 * 指定座標のワイヤーが電力を読む隣接ワイヤー座標の一覧 (入力用)。
 * [確定: 1.21.1 RedStoneWireBlock#calculateTargetStrength / 26.2
 *  RedstoneWireEvaluator#getIncomingWireSignal — 水平 4 方向それぞれで次を読む]
 * - 同レイヤー: 横のセルがワイヤーなら読む (接続形状は見ない)
 * - 上り: 横のセルが導体で、かつ自分の直上が導体でないとき、横の 1 段上のワイヤー
 * - 下り: 横のセルが導体でないとき、横の 1 段下のワイヤー
 *
 * getConnectedWireNeighbors との違いは上りの「横のセルが導体」の条件だけで、
 * 結果は常にその部分集合になる。ガラス・上付きハーフ・グロウストーンなど非導体の段では、
 * 上段は下段を読む (下り) が下段は上段を読まない。つまり信号は上りにしか流れない
 * (段を一方向のダイオードとして使える) [実機 fixture wire-step-nonconductor-down:
 * 上から給電すると中段・下段とも 0。石の段は 14 / 13。下から給電したガラスの段は 14 / 13]。
 * 以前は getConnectedWireNeighbors をそのまま入力にしていたので、非導体の段を下向きにも
 * 流れていた (R-1)。
 */
export function getWireInputNeighbors(pos: Pos3D, world: SimWorld): Pos3D[] {
  const block = world.getBlockAt(pos)
  if (!block || block.type !== 'wire') return []
  const [x, y, z] = pos
  const result: Pos3D[] = []

  const aboveSelfOpen = !isConductor(world.getBlockAt([x, y + 1, z]))

  for (const dir of H_DIRS) {
    const [dx, dz] = H_DIR_VEC[dir]
    const sidePos: Pos3D = [x + dx, y, z + dz]
    const side = world.getBlockAt(sidePos)

    if (side?.type === 'wire') {
      result.push(sidePos)
    }

    if (isConductor(side)) {
      // 上り: 横が導体のときだけ 1 段上を読む (自分の直上が導体なら読まない)
      if (aboveSelfOpen) {
        const upPos: Pos3D = [x + dx, y + 1, z + dz]
        if (world.getBlockAt(upPos)?.type === 'wire') result.push(upPos)
      }
    } else {
      // 下り: 横が導体でないときだけ 1 段下を読む
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
 * 3. 入力になる隣接ワイヤー (getWireInputNeighbors。同レイヤー・上り/下りステップ) の power - 1
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
    if (src.type === 'target') {
      // target は導体かつ信号源 [確定: 1.21.1 Blocks.TARGET は
      // isRedstoneConductor 非 override + TargetBlock.isSignalSource=true]。
      // ダストから見える値は max(自身の outputPower, 強充電)。
      // ダスト由来の弱充電は他のダストに見えない (shouldSignal=false 相当)
      // 点は solid と同じ [確定: RedStoneWireBlock.calculateTargetStrength]
      maxPower = Math.max(maxPower, getStrongPower(world, nPos), getSignal(world, pos, dir))
      continue
    }
    if (isConductor(src)) {
      // **強充電された導体はダストに給電する**。弱充電はダストに見えない
      // [確定: docs/research/02 §5.2]。
      //
      // ここは以前 `solid` だけを見ていたが、**導体は材質ごとに型が分かれている**ので
      // スライム / 音符ブロック / ロードストーン / ソウルサンドが素通りしていた (#259)。
      // [実機実測 2026-08-21: リピーター → X → ダスト の X を差し替えて計測 —
      //  stone / slime_block / lodestone / soul_sand / note_block はいずれもダスト 15。
      //  honey_block だけ 0 (非導体)]
      // ガラスエレベーターは**オブザーバーの出力をスライム越しにダストへ渡す**ので、
      // ここが抜けていると搬器脇の制御線が丸ごと 0 のままになる
      maxPower = Math.max(maxPower, getStrongPower(world, nPos))
      continue
    }
    maxPower = Math.max(maxPower, getSignal(world, pos, dir))
  }

  // 入力になるワイヤー（同レイヤー + 上り/下りステップ）からの減衰伝播。
  // 連結成分の近傍 (getConnectedWireNeighbors) ではなく入力の近傍を使う (R-1)
  for (const nPos of getWireInputNeighbors(pos, world)) {
    const src = world.getBlockAt(nPos)
    if (src?.type === 'wire') {
      maxPower = Math.max(maxPower, (src as WireState).power - 1)
    }
  }

  return Math.max(0, maxPower)
}
