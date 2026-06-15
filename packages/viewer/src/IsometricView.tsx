/**
 * IsometricView — WorldSnapshot を deepslate で描画する React コンポーネント。
 *
 * snapshot が変化するたびに setStructure() で GPU バッファを再構築する。
 */

import { useEffect, useRef, useState, useCallback } from 'react'
import { mat4 } from 'gl-matrix'
import { Structure, StructureRenderer } from 'deepslate/render'
import type { WorldSnapshot } from '@redstone/sim'
import type { Pos3D } from '@redstone/sim'
import {
  worldSnapshotToStructure,
  VIEWER_PRELOAD_BLOCKS,
} from './world-to-structure.js'
import { buildResources } from './renderer/buildResources.js'
import { useCamera } from './renderer/useCamera.js'
import { canvasPixelToBlock, FOV_F } from './renderer/coordUtils.js'

// ─── Props ────────────────────────────────────────────────────────────────────

export interface CameraState {
  distance: number
  panX: number
  panZ: number
}

export interface IsometricViewProps {
  /** 表示対象のスナップショット */
  snapshot: WorldSnapshot
  /** true にすると真上からの 2D ビュー */
  topDown?: boolean
  /**
   * クリックされたブロック座標を通知するコールバック。
   * topDown=true のとき、左右クリックを区別して返す。
   */
  onBlockClick?: (pos: Pos3D, button: 'left' | 'right') => void
  /** 2D モード時にクリック判定に使う Y レイヤー */
  placementY?: number
  /**
   * topDown グリッドオーバーレイ用。
   * 毎フレームカメラ状態を書き込む ref を渡すと、外部からカメラ状態を参照できる。
   */
  cameraStateRef?: React.MutableRefObject<CameraState | null>
  /** true のとき左クリック/タッチドラッグで平面パン（移動ツール選択時） */
  panMode?: boolean
}

// ─── コンポーネント ────────────────────────────────────────────────────────────

export function IsometricView({
  snapshot,
  topDown = false,
  onBlockClick,
  placementY = 1,
  cameraStateRef,
  panMode = false,
}: IsometricViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<StructureRenderer | null>(null)
  const structureRef = useRef<Structure | null>(null)
  const prevSnapshotRef = useRef<WorldSnapshot | null>(null)
  const animFrameRef = useRef<number>(0)

  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [loadingMsg, setLoadingMsg] = useState('Loading textures...')
  const [errorMsg, setErrorMsg] = useState('')

  const isPainting = useRef(false)
  const [isPanning, setIsPanning] = useState(false)

  const {
    cameraRef,
    onMouseDown, onMouseMove, onMouseUp,
    onRightMouseDown, onRightMouseMove, onRightMouseUp,
    onWheel3D,
    getPanScale,
  } = useCamera(topDown)

  // ─── ピンチ状態 ────────────────────────────────────────────────────────────
  const activePointers = useRef<Map<number, {x: number; y: number}>>(new Map())
  const lastPinchDist = useRef<number | null>(null)
  const lastPinchMid  = useRef<{x: number; y: number} | null>(null)

  // ─── ヒットテスト (2D モード) ──────────────────────────────────────────────

  const hitBlock = useCallback(
    (clientX: number, clientY: number): Pos3D | null => {
      const canvas = canvasRef.current
      const structure = structureRef.current
      if (!canvas || !structure) return null
      const rect = canvas.getBoundingClientRect()
      const cam = cameraRef.current
      return canvasPixelToBlock(
        clientX - rect.left,
        clientY - rect.top,
        canvas.clientWidth,
        canvas.clientHeight,
        structure.getSize() as [number, number, number],
        cam.distance,
        placementY,
        cam.panX,
        cam.panZ,
      )
    },
    [cameraRef, placementY],
  )

  // ─── ポインターイベント ────────────────────────────────────────────────────

  const isPanButton = (button: number) => button === 2 || button === 1
  const isPanDrag = (buttons: number) => (buttons & 2) !== 0 || (buttons & 4) !== 0

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      activePointers.current.set(e.pointerId, {x: e.clientX, y: e.clientY})
      e.currentTarget.setPointerCapture(e.pointerId)

      // 2本指: ピンチ開始
      if (activePointers.current.size >= 2) {
        isPainting.current = false
        const pts = [...activePointers.current.values()]
        lastPinchDist.current = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y)
        lastPinchMid.current  = {x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2}
        return
      }

      // 1本指: 既存ロジック
      if (!topDown) {
        onMouseDown(e as unknown as React.MouseEvent)
        return
      }
      if (isPanButton(e.button) || (panMode && e.button === 0)) {
        onRightMouseDown(e as unknown as React.MouseEvent, canvasRef.current)
        setIsPanning(true)
        return
      }
      if (!onBlockClick) return
      isPainting.current = true
      const pos = hitBlock(e.clientX, e.clientY)
      if (pos) onBlockClick(pos, e.button === 2 ? 'right' : 'left')
    },
    [topDown, panMode, onBlockClick, hitBlock, onMouseDown, onRightMouseDown],
  )

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      activePointers.current.set(e.pointerId, {x: e.clientX, y: e.clientY})

      // 2本指: ピンチズーム + パン
      if (activePointers.current.size >= 2) {
        const pts = [...activePointers.current.values()]
        const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y)
        const mid  = {x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2}
        const cam  = cameraRef.current

        if (lastPinchDist.current !== null && lastPinchMid.current !== null) {
          const scale   = lastPinchDist.current / dist
          const newDist = Math.max(3, Math.min(200, cam.distance * scale))

          if (topDown && structureRef.current) {
            const canvas = canvasRef.current
            if (canvas) {
              // zoom-to-cursor（ピンチ中点を基準）
              const rect   = canvas.getBoundingClientRect()
              const px     = mid.x - rect.left
              const py     = mid.y - rect.top
              const w      = canvas.clientWidth
              const h      = canvas.clientHeight
              const [sx, sy, sz] = structureRef.current.getSize() as [number, number, number]
              const aspect = w / h
              const depth  = cam.distance + sy / 2 - placementY
              const ndcX   = (2 * px / w) - 1
              const ndcY   = 1 - (2 * py / h)
              const wx0    = ndcX * aspect * depth / FOV_F + sx / 2 + cam.panX
              const wz0    = sz / 2 - ndcY * depth / FOV_F + cam.panZ
              cam.distance = newDist
              const nd     = newDist + sy / 2 - placementY
              cam.panX    += wx0 - (ndcX * aspect * nd / FOV_F + sx / 2 + cam.panX)
              cam.panZ    += wz0 - (sz / 2 - ndcY * nd / FOV_F + cam.panZ)

              // 2本指パン（中点移動）
              const panScale = getPanScale(h)
              cam.panX -= (mid.x - lastPinchMid.current.x) * panScale
              cam.panZ -= (mid.y - lastPinchMid.current.y) * panScale
            }
          } else {
            cam.distance = newDist
          }
        }

        lastPinchDist.current = dist
        lastPinchMid.current  = mid
        return
      }

      // 1本指: 既存ロジック
      if (!topDown) {
        onMouseMove(e as unknown as React.MouseEvent)
        return
      }
      if (isPanDrag(e.buttons) || (panMode && (e.buttons & 1) !== 0)) {
        onRightMouseMove(e as unknown as React.MouseEvent, canvasRef.current)
        return
      }
      if (!isPainting.current || !onBlockClick) return
      const pos = hitBlock(e.clientX, e.clientY)
      if (pos) onBlockClick(pos, 'left')
    },
    [topDown, panMode, onBlockClick, hitBlock, onMouseMove, onRightMouseMove, placementY, cameraRef, getPanScale],
  )

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      activePointers.current.delete(e.pointerId)
      if (activePointers.current.size < 2) {
        lastPinchDist.current = null
        lastPinchMid.current  = null
      }
      isPainting.current = false
      setIsPanning(false)
      onRightMouseUp()
      if (!topDown) onMouseUp()
      else e.currentTarget.releasePointerCapture(e.pointerId)
    },
    [topDown, onMouseUp, onRightMouseUp],
  )

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      if (!topDown || !onBlockClick) return
      const pos = hitBlock(e.clientX, e.clientY)
      if (pos) onBlockClick(pos, 'right')
    },
    [topDown, onBlockClick, hitBlock],
  )

  // ─── ホイール (zoom-to-cursor 対応) ───────────────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault()
      const cam = cameraRef.current
      const structure = structureRef.current

      if (!topDown || !structure) {
        cam.distance = Math.max(3, Math.min(200, cam.distance + e.deltaY * 0.05))
        return
      }

      // zoom-to-cursor
      const rect = canvas.getBoundingClientRect()
      const px = e.clientX - rect.left
      const py = e.clientY - rect.top
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      const [sx, sy, sz] = structure.getSize() as [number, number, number]
      const aspect = w / h
      const oldDist = cam.distance

      const depth = oldDist + sy / 2 - placementY
      const ndcX = (2 * px / w) - 1
      const ndcY = 1 - (2 * py / h)
      const wx0 = ndcX * aspect * depth / FOV_F + sx / 2 + cam.panX
      const wz0 = sz / 2 - ndcY * depth / FOV_F + cam.panZ

      const factor = 1 + e.deltaY * 0.001
      cam.distance = Math.max(3, Math.min(200, oldDist * factor))

      const newDepth = cam.distance + sy / 2 - placementY
      const wx1 = ndcX * aspect * newDepth / FOV_F + sx / 2 + cam.panX
      const wz1 = sz / 2 - ndcY * newDepth / FOV_F + cam.panZ

      cam.panX += wx0 - wx1
      cam.panZ += wz0 - wz1
    }

    canvas.addEventListener('wheel', handleWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', handleWheel)
  }, [topDown, placementY, cameraRef])

  // ─── WebGL 初期化（マウント時に一度だけ） ─────────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const gl = canvas.getContext('webgl')
    if (!gl) {
      setStatus('error')
      setErrorMsg('WebGL not supported')
      return
    }

    let cancelled = false
    let rafId = 0

    ;(async () => {
      try {
        setStatus('loading')
        setLoadingMsg('Loading textures...')

        const resources = await buildResources(VIEWER_PRELOAD_BLOCKS)
        if (cancelled) return

        // 初回スナップショットで Structure を構築
        const { structure } = worldSnapshotToStructure(snapshot)
        structureRef.current = structure
        prevSnapshotRef.current = snapshot

        const renderer = new StructureRenderer(gl, structure, resources)
        rendererRef.current = renderer

        // アトラステクスチャの MIN_FILTER を NEAREST に（UV ブリード防止）
        const internal = renderer as unknown as { atlasTexture: WebGLTexture | null }
        if (internal.atlasTexture) {
          gl.bindTexture(gl.TEXTURE_2D, internal.atlasTexture)
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
          gl.bindTexture(gl.TEXTURE_2D, null)
        }

        const size = structure.getSize()
        cameraRef.current.distance = Math.max(size[0], size[1], size[2]) * 1.5

        setStatus('ready')

        const draw = () => {
          if (!structureRef.current || !rendererRef.current) return
          const cam = cameraRef.current
          const w = canvas.clientWidth
          const h = canvas.clientHeight
          if (canvas.width !== w || canvas.height !== h) {
            canvas.width = w
            canvas.height = h
            renderer.setViewport(0, 0, w, h)
          }

          const s = structureRef.current.getSize()
          const vm = mat4.create()
          mat4.translate(vm, vm, [0, 0, -cam.distance])
          mat4.rotateX(vm, vm, (cam.rotX * Math.PI) / 180)
          mat4.rotateY(vm, vm, (cam.rotY * Math.PI) / 180)
          mat4.translate(vm, vm, [-s[0] / 2 - cam.panX, -s[1] / 2, -s[2] / 2 - cam.panZ])

          // カメラ状態を外部に公開（グリッドオーバーレイ等に使用）
          if (cameraStateRef) {
            cameraStateRef.current = { distance: cam.distance, panX: cam.panX, panZ: cam.panZ }
          }

          gl.clearColor(0.1, 0.1, 0.12, 1)
          gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
          renderer.drawStructure(vm)
          renderer.drawGrid(vm)

          rafId = requestAnimationFrame(draw)
        }
        rafId = requestAnimationFrame(draw)
        animFrameRef.current = rafId
      } catch (err: unknown) {
        if (cancelled) return
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[IsometricView] init error', msg)
        setStatus('error')
        setErrorMsg(msg)
      }
    })()

    return () => {
      cancelled = true
      cancelAnimationFrame(rafId)
      rendererRef.current = null
      structureRef.current = null
      prevSnapshotRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // 初回マウント時のみ

  // ─── snapshot 変化時に構造を再構築 ──────────────────────────────────────

  useEffect(() => {
    const renderer = rendererRef.current
    console.log('[IsometricView] snapshot effect: renderer=', !!renderer, 'sameRef=', prevSnapshotRef.current === snapshot, 'blocks=', snapshot.blocks.size)
    if (!renderer) return
    if (prevSnapshotRef.current === snapshot) return

    const { structure: newStructure } = worldSnapshotToStructure(snapshot)
    console.log('[IsometricView] setStructure: blocks in structure=', newStructure.getBlocks().length)
    renderer.setStructure(newStructure)
    structureRef.current = newStructure
    prevSnapshotRef.current = snapshot
  }, [snapshot])

  // ─── レンダリング ──────────────────────────────────────────────────────────

  if (status === 'error') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', color: '#f87171', fontSize: 14 }}>
        Error: {errorMsg}
      </div>
    )
  }

  const editable = topDown && !!onBlockClick

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <canvas
        ref={canvasRef}
        style={{
          width: '100%',
          height: '100%',
          display: 'block',
          cursor: isPanning ? 'grabbing' : topDown ? (panMode ? 'grab' : editable ? 'crosshair' : 'grab') : 'grab',
          touchAction: 'none',
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        onWheel={topDown ? undefined : onWheel3D}
        onContextMenu={handleContextMenu}
      />
      {status === 'loading' && (
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(23,23,25,0.8)', color: '#a3a3a3', fontSize: 14,
        }}>
          {loadingMsg}
        </div>
      )}
    </div>
  )
}
