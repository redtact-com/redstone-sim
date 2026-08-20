// ============================================================
// delta-debug.ts — 「署名を保つ最小の部分集合」を探すループ (実機に触らない純関数)
//
// 実機と sim の食い違いは 6393 ブロックの機械のまま出てくる。そのままでは
// 原因も分からず fixture にもできないので、**署名 (= 見たい食い違いが出ること)
// を保ったまま候補を削る**。ここに置くのは削り方だけで、
//   - 何を署名とするか  … minimize.ts (対象座標が差分に出るか)
//   - 実際に確かめる手段 … 実機キャプチャ + compare
// は呼び出し側 (oracle) の仕事。だから実機なしでテストできる。
//
// 削り方は delta debugging (ddmin) の「補集合を試さない」版:
//
//   1. 塊の大きさ k = ceil(n/2) から始める
//   2. 候補列の**末尾 (= 呼び出し側が「遠い」と並べた側) から** k 個ずつ落として試す。
//      署名が保たれたら採用 (本当に消す)、消えたら戻す
//   3. 端まで舐めたら k を半分にして最初から。k=1 のパスを終えたら停止
//
// オラクル呼び出し回数は k=n/2, n/4, …, 1 の各パスで高々 ceil(n/k) 回なので
// 合計 2+4+…+n ≒ 2n。**候補数に対して線形**で、1 回が実機キャプチャ (数秒〜25 秒)
// でも現実的な時間に収まる。n^2 になるやり方 (1 個ずつ全通り試す) は選ばない。
//
// oracle が単調 (集合が大きいほど署名を保ちやすい) なら、k=1 のパスを終えた
// 時点の結果は **1-minimal** (どれ 1 つ落としても署名が消える) になる。
// ============================================================

/** 1 回のオラクル試行の記録 (ログ出力用) */
export interface DeltaDebugTrial<T> {
  /** 何回目の試行か (1 始まり) */
  index: number
  /** そのパスの塊の大きさ */
  chunkSize: number
  /** 落としてみた要素 */
  dropped: readonly T[]
  /** 落とした後に残る候補数 */
  remaining: number
  /** 署名が保たれたか (true なら採用) */
  held: boolean
  /** オラクルに掛かった時間 (ms) */
  ms: number
}

/** 塊の大きさ 1 段分 (1 パス) の記録 */
export interface DeltaDebugPass {
  chunkSize: number
  /** パス開始時の候補数 */
  before: number
  /** パス終了時の候補数 */
  after: number
  /** そのパスでのオラクル呼び出し回数 */
  trials: number
  ms: number
}

export interface DeltaDebugResult<T> {
  /** 署名を保った最小の候補集合 (入力の並び順を保つ) */
  kept: T[]
  /** オラクル呼び出し回数の合計 */
  trials: number
  /** 実行したパス数 */
  passes: number
  /**
   * 'converged'  … k=1 のパスまで終えた (1-minimal)
   * 'maxTrials'  … 予算切れ。kept は「署名を保つ集合」ではあるが最小とは限らない
   */
  stoppedBy: 'converged' | 'maxTrials'
}

export interface DeltaDebugOptions<T> {
  /**
   * 落としてよい候補。**呼び出し側が優先順に並べておく** (minimize.ts は
   * 対象座標から近い順に並べ、遠い側から落とす)。
   * 絶対に落としてはいけないもの (対象座標・入力の当たり先) はここに入れず、
   * oracle の中で足すこと
   */
  candidates: readonly T[]
  /** 部分集合で署名が保たれるか。true なら「落としてよい」 */
  oracle: (subset: readonly T[]) => boolean | Promise<boolean>
  /** オラクル呼び出しの上限 (実機だと 1 回が数秒なので予算を切れるようにする) */
  maxTrials?: number
  onTrial?: (t: DeltaDebugTrial<T>) => void
  onPass?: (p: DeltaDebugPass) => void
  /** 時刻源 (テストで固定するための差し替え口) */
  now?: () => number
}

/**
 * 署名を保つ最小の部分集合を探す。
 *
 * oracle は「その部分集合だけで署名が保たれるか」を返す。
 * **oracle が false を返した要素は戻す**ので、途中で予算が尽きても
 * kept は必ず「署名を保つと確認済み」の集合になっている。
 */
export async function minimizeSubset<T>(opts: DeltaDebugOptions<T>): Promise<DeltaDebugResult<T>> {
  const now = opts.now ?? (() => Date.now())
  const maxTrials = opts.maxTrials ?? Number.POSITIVE_INFINITY
  let cur: T[] = [...opts.candidates]
  let trials = 0
  let passes = 0
  let stoppedBy: DeltaDebugResult<T>['stoppedBy'] = 'converged'

  let chunk = Math.max(1, Math.ceil(cur.length / 2))
  while (cur.length > 0) {
    const passStart = now()
    const before = cur.length
    // **集合が一気に縮んだら塊も追従させる**。追従しないと候補が 2 個しか無いのに
    // k=99 → 49 → 24 … と「全部落とす」を撮り直すだけの空振りが続く
    // (実測で全試行の 30% が無駄になった)
    if (chunk > cur.length) chunk = Math.max(1, Math.ceil(cur.length / 2))
    let passTrials = 0
    // 末尾 (遠い側) から k 個ずつ。落とした後も「まだ触っていない範囲」は
    // 常に [0, end) の側に残るので、採用・却下どちらでも end = start でよい
    let end = cur.length
    while (end > 0) {
      if (trials >= maxTrials) { stoppedBy = 'maxTrials'; break }
      const start = Math.max(0, end - chunk)
      const dropped = cur.slice(start, end)
      const trial = [...cur.slice(0, start), ...cur.slice(end)]
      const t0 = now()
      const held = await opts.oracle(trial)
      trials++
      passTrials++
      opts.onTrial?.({ index: trials, chunkSize: chunk, dropped, remaining: trial.length, held, ms: now() - t0 })
      if (held) cur = trial
      end = start
    }
    passes++
    opts.onPass?.({ chunkSize: chunk, before, after: cur.length, trials: passTrials, ms: now() - passStart })
    if (stoppedBy === 'maxTrials') break
    if (chunk === 1) break
    const next = Math.max(1, Math.floor(chunk / 2))
    // 塊が縮まないなら打ち切る (縮小をやめる改変で無限ループにしないための保険)
    if (next === chunk) break
    chunk = next
  }
  return { kept: cur, trials, passes, stoppedBy }
}
