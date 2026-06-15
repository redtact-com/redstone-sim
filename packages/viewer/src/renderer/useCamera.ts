import { useEffect, useRef } from 'react'

export interface Camera {
  rotX: number
  rotY: number
  distance: number
  /** 2D モードのパンオフセット（ワールド座標系） */
  panX: number
  panZ: number
}

const DEFAULT_CAMERA: Camera = { rotX: 45, rotY: 45, distance: 20, panX: 0, panZ: 0 }
const TOPDOWN_CAMERA: Camera = { rotX: 90, rotY: 0, distance: 25, panX: 0, panZ: 0 }

export function useCamera(topDown: boolean) {
  const cameraRef = useRef<Camera>({ ...DEFAULT_CAMERA })
  // 3D モード用ドラッグ
  const dragRef = useRef<{ x: number; y: number } | null>(null)
  // 2D モード用パンドラッグ（右クリック）
  const panDragRef = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    cameraRef.current = topDown
      ? { ...TOPDOWN_CAMERA, distance: cameraRef.current.distance }
      : { ...DEFAULT_CAMERA, distance: cameraRef.current.distance }
  }, [topDown])

  // ── 3D モード: 左クリックドラッグで回転 ──────────────────────
  const onMouseDown = (e: React.MouseEvent) => {
    if (topDown) return
    dragRef.current = { x: e.clientX, y: e.clientY }
  }

  const onMouseMove = (e: React.MouseEvent) => {
    if (!dragRef.current || topDown) return
    const dx = e.clientX - dragRef.current.x
    const dy = e.clientY - dragRef.current.y
    dragRef.current = { x: e.clientX, y: e.clientY }
    cameraRef.current.rotY += dx * 0.5
    cameraRef.current.rotX = Math.max(5, Math.min(175, cameraRef.current.rotX + dy * 0.5))
  }

  const onMouseUp = () => { dragRef.current = null }

  // ── 2D モード: 右クリックドラッグでパン ──────────────────────
  /**
   * panScale: canvas ピクセル → ワールド座標の変換係数。
   * distance が大きいほど 1px の移動量が大きい。
   * FOV_F ≈ 1.4281 (70° FOV)
   */
  const getPanScale = (canvasH: number) => {
    const FOV_F = 1 / Math.tan((70 * Math.PI / 180) / 2)
    return cameraRef.current.distance / (FOV_F * canvasH / 2)
  }

  const onRightMouseDown = (e: React.MouseEvent, canvasEl: HTMLCanvasElement | null) => {
    if (!topDown || !canvasEl) return
    e.preventDefault()
    panDragRef.current = { x: e.clientX, y: e.clientY }
  }

  const onRightMouseMove = (e: React.MouseEvent, canvasEl: HTMLCanvasElement | null) => {
    if (!panDragRef.current || !topDown || !canvasEl) return
    const dx = e.clientX - panDragRef.current.x
    const dy = e.clientY - panDragRef.current.y
    panDragRef.current = { x: e.clientX, y: e.clientY }
    const scale = getPanScale(canvasEl.clientHeight)
    // 右ドラッグで視点が動く方向（マップが追従する向き）
    cameraRef.current.panX -= dx * scale
    cameraRef.current.panZ -= dy * scale
  }

  const onRightMouseUp = () => { panDragRef.current = null }

  // ── 3D モード用ホイール（フォールバック） ──────────────────────
  const onWheel3D = (e: React.WheelEvent) => {
    if (topDown) return
    const d = cameraRef.current.distance
    cameraRef.current.distance = Math.max(3, Math.min(200, d + e.deltaY * 0.05))
  }

  return {
    cameraRef,
    onMouseDown, onMouseMove, onMouseUp,
    onRightMouseDown, onRightMouseMove, onRightMouseUp,
    onWheel3D,
    getPanScale,
  }
}
