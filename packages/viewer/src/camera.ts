/**
 * カメラの寄り (distance) を回路の大きさから決める (#238)。
 *
 * 従来は `max(幅, 高さ, 奥行) * 1.5` を距離にしていたが、これは
 * **視野角も画面比も回転も見ていない**ので、細長い回路がまったく収まらなかった。
 * 147 段の回路 (エレベーター) を撮ると、画面の高さの 3 割しか使わない糸のような柱になる。
 *
 * ここでは**外接球**で考える。半径 R の球が視野に収まる距離は `R / sin(視野角/2)`。
 * 縦横で視野角が違う (横は画面比のぶん広い) ので、**狭い方**に合わせる。
 * 回転しても外接球は変わらないので、これなら向きを変えても収まったままになる。
 */

/** deepslate の Renderer が使う垂直視野角 (度)。ライブラリ側の固定値 */
export const VIEWER_FOV_DEG = 70

/** deepslate の far クリップ面。これを超えると描画が切れる */
export const VIEWER_FAR = 500

export interface FitOptions {
  /** 画面の横 / 縦。1 未満なら縦長 (スマホ) */
  aspect?: number
  /** 余白の取り方。1.0 でぴったり、1.1 で 1 割の余白 */
  margin?: number
  /** 垂直視野角 (度) */
  fovDeg?: number
}

/**
 * 回路全体が収まるカメラ距離を返す。
 *
 * @param size 回路の大きさ [x, y, z] (ブロック数)
 */
export function fitDistance(size: readonly [number, number, number], opts: FitOptions = {}): number {
  const aspect = opts.aspect ?? 1
  const margin = opts.margin ?? 1.08
  const fov = ((opts.fovDeg ?? VIEWER_FOV_DEG) * Math.PI) / 180

  // 外接球の半径。中心からいちばん遠い角までの距離
  const radius = Math.hypot(size[0], size[1], size[2]) / 2
  if (radius === 0) return 1

  // 垂直視野角はそのまま。水平は画面比のぶん広がる (縦長画面では逆に狭くなる)
  const halfV = fov / 2
  const halfH = Math.atan(Math.tan(halfV) * aspect)
  const half = Math.min(halfV, halfH)

  const d = (radius / Math.sin(half)) * margin
  // far クリップ面を越えると奥側が消えるので、球が収まる範囲で頭打ちにする
  return Math.min(d, Math.max(1, VIEWER_FAR - radius - 1))
}

/**
 * ホイールやピンチで引ける上限。
 *
 * 固定値 (従来は 200) だと**大きい回路で引ききれない**。かといって無制限にすると
 * far クリップ面の外へ出て回路が消える。「収まる距離の 3 倍」と far の内側の小さい方にする。
 */
export function maxZoomOut(size: readonly [number, number, number], opts: FitOptions = {}): number {
  const radius = Math.hypot(size[0], size[1], size[2]) / 2
  return Math.max(200, Math.min(fitDistance(size, opts) * 3, VIEWER_FAR - radius - 1))
}
