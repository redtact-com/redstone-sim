// deepslate の固定 FOV (top-down 専用座標変換)
const FOV_Y = 70 * (Math.PI / 180)
export const FOV_F = 1 / Math.tan(FOV_Y / 2) // ≈ 1.4281

/**
 * canvas ピクセル座標をワールドのブロック座標に変換する（top-down モード専用）。
 * @param px - canvas 上の X ピクセル座標
 * @param py - canvas 上の Y ピクセル座標
 * @param canvasW - canvas の幅 (px)
 * @param canvasH - canvas の高さ (px)
 * @param size - Structure のサイズ [X, Y, Z]
 * @param camDist - カメラ距離
 * @param targetY - 配置対象の Y レイヤー
 * @param panX - カメラパンオフセット X（ワールド座標）
 * @param panZ - カメラパンオフセット Z（ワールド座標）
 * @returns ブロック座標 [x, y, z]、範囲外なら null
 */
export function canvasPixelToBlock(
  px: number,
  py: number,
  canvasW: number,
  canvasH: number,
  size: [number, number, number],
  camDist: number,
  targetY: number,
  panX = 0,
  panZ = 0,
): [number, number, number] | null {
  const [sx, sy, sz] = size
  const aspect = canvasW / canvasH

  const ndcX = (2 * px / canvasW) - 1
  const ndcY = 1 - (2 * py / canvasH)

  const depth = camDist + sy / 2 - targetY
  if (depth <= 0) return null

  const worldX = ndcX * aspect * depth / FOV_F + sx / 2 + panX
  const worldZ = sz / 2 - ndcY * depth / FOV_F + panZ

  const bx = Math.floor(worldX)
  const bz = Math.floor(worldZ)
  if (bx < 0 || bx >= sx || bz < 0 || bz >= sz) return null

  return [bx, targetY, bz]
}
