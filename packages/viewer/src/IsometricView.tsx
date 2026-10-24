/**
 * IsometricView — WorldSnapshot を deepslate で描画する React コンポーネント。
 *
 * snapshot が変化するたびに setStructure() で GPU バッファを再構築する。
 */

import { useEffect, useRef, useState, useCallback } from 'react'
import { Structure, StructureRenderer } from 'deepslate/render'
import type { WorldSnapshot } from '@redstone/sim'
import type { Pos3D } from '@redstone/sim'
import {
  worldSnapshotToStructure,
  VIEWER_PRELOAD_BLOCKS,
  extraPreloadNames,
} from './world-to-structure.js'
import { buildResources } from './renderer/buildResources.js'
import { fitDistance, maxZoomOut } from './camera.js'
import { useCamera } from './renderer/useCamera.js'
import { canvasPixelToBlock, FOV_F } from './renderer/coordUtils.js'
import {
  viewMatrixOf, projMatrixOf, canvasRay, pointToCanvas, pickCell, pickRoleOf, pickNearest,
  TOUCH_PICK_RADII,
} from './renderer/picking.js'

// ─── 3D のクリック・タップの見分け (#397) ────────────────────────────────────

/** クリック・タップとみなす動きの上限 (CSS px)。越えたらドラッグ (カメラ回転) */
const CLICK_SLOP_MOUSE = 5
const CLICK_SLOP_TOUCH = 10
/** タッチでこれより長く押したらタップにしない (長押し)。マウスは時間を見ない */
const TAP_MAX_MS_TOUCH = 500

// ─── Props ────────────────────────────────────────────────────────────────────

/**
 * 2 つのスナップショットが**中身として同じ**か (#272)。
 *
 * `EditorPage` の snapshot は毎レンダ新しいオブジェクトリテラルなので参照比較は効かない。
 * ブロックは sim / editor のどちらも**書き換えず新しいオブジェクトを作る**ので、
 * エントリごとの参照比較で十分 (深い比較は 6000 ブロックで重すぎる)。
 */
function sameSnapshot(a: WorldSnapshot | null, b: WorldSnapshot): boolean {
  if (a === b) return true
  if (a === null) return false
  const ab = a.bounds, bb = b.bounds
  if (ab.x[0] !== bb.x[0] || ab.x[1] !== bb.x[1]
    || ab.y[0] !== bb.y[0] || ab.y[1] !== bb.y[1]
    || ab.z[0] !== bb.z[0] || ab.z[1] !== bb.z[1]) return false
  if (a.blocks.size !== b.blocks.size) return false
  for (const [k, v] of a.blocks) if (b.blocks.get(k) !== v) return false
  return true
}

export interface CameraState {
  distance: number
  panX: number
  panZ: number
}

/** 外部からカメラを 1 回だけ上書きするためのパッチ (デモの fitCamera 用)。 */
export interface CameraInput {
  distance?: number
  panX?: number
  panZ?: number
  rotX?: number
  rotY?: number
}

/** IsometricView を外から命令的に使う口 (#397)。`viewRef` に入る */
export interface IsometricViewHandle {
  /**
   * ブロックの中心が画面のどこに描かれているか (clientX/Y)。座標は snapshot の座標。
   * 描画の準備ができていない・カメラの後ろなら null。
   * e2e が実際の座標をクリック・タップして確かめるために使う
   */
  blockToClient: (pos: Pos3D) => { x: number; y: number } | null
}

export interface IsometricViewProps {
  /** 表示対象のスナップショット */
  snapshot: WorldSnapshot
  /** true にすると真上からの 2D ビュー */
  topDown?: boolean
  /**
   * クリック・タップされたブロック座標を通知するコールバック。
   *
   * - topDown=true: 左右クリックを区別して返す。座標の x/z は**構造ローカル**
   *   (snapshot の bounds の min が原点)、y は placementY
   * - topDown=false (3D, #397): 押せる素子 (isTriggerableType) に当たったときだけ 'left' で返す。
   *   座標は **snapshot の座標** (bounds の min を足してある) なので、そのまま sim に渡せる。
   *   ドラッグ (カメラ回転)・ピンチ・タッチの長押しでは呼ばない。
   *   渡さなければ、3D ではピックもカーソルの変更もしない
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
  /**
   * 外部からカメラを命令的に上書きするための ref。値をセットすると次フレームで
   * 適用され null に消費される (デモの fitCamera など)。
   */
  cameraInputRef?: React.MutableRefObject<CameraInput | null>
  /** テクスチャ読込 + 初回 Structure 構築が完了して描画可能になった時に一度呼ぶ。 */
  onReady?: () => void
  /** 命令的な口 (#397)。ref を渡すと、マウント中は中身が入る (cameraInputRef と同じ形) */
  viewRef?: React.MutableRefObject<IsometricViewHandle | null>
}

// ─── コンポーネント ────────────────────────────────────────────────────────────

export function IsometricView({
  snapshot,
  topDown = false,
  onBlockClick,
  placementY = 1,
  cameraStateRef,
  panMode = false,
  cameraInputRef,
  onReady,
  viewRef,
}: IsometricViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // init effect は deps=[] で一度だけ張るため、最新の onReady を ref 経由で読む
  const onReadyRef = useRef(onReady)
  onReadyRef.current = onReady
  const rendererRef = useRef<StructureRenderer | null>(null)
  const structureRef = useRef<Structure | null>(null)
  const prevSnapshotRef = useRef<WorldSnapshot | null>(null)
  const animFrameRef = useRef<number>(0)
  /** 最後に寄りを合わせたときの回路サイズ ("x,y,z")。変わったら合わせ直す (#238) */
  const fittedSizeRef = useRef<string>('')
  /**
   * 外部 (デモの setCamera 等) がカメラを指定したか (#238)。
   *
   * **自動フィットはテクスチャ読み込みを待ってから走る**ので、外から距離を指定しても
   * あとから上書きされて効かなかった。一度でも外部指定があったら自動フィットは譲る
   */
  const externalCameraRef = useRef(false)

  /** 引ける上限。**回路の大きさに追従させる** — 固定 200 だと大きい回路で引ききれない (#238) */
  const zoomLimit = (): number => {
    const s = structureRef.current?.getSize()
    return s === undefined ? 200 : maxZoomOut(s as [number, number, number])
  }

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

  // ─── 3D の 1 回の操作 (#397) ───────────────────────────────────────────────
  /**
   * 押してから離すまで。**押した時点ではまだ何もしない**。
   * 動いた量がしきい値を越えたらドラッグ (カメラ回転)、越えずに離したらクリック・タップ。
   *  - press: 押したまま、しきい値の内側
   *  - drag:  しきい値を越えた。カメラを回している
   *  - pinch: 2 本目の指が触れた。指を全部離すまで何もしない
   */
  const gestureRef = useRef<{
    id: number
    x: number
    y: number
    /** 押した時刻 (event.timeStamp) */
    t: number
    touch: boolean
    /** クリックになりうるボタンか (左ボタン / 1 本目の指) */
    canTap: boolean
    phase: 'press' | 'drag' | 'pinch'
  } | null>(null)
  /** マウスが押せる素子の上にあるか (カーソルを pointer にする)。変わったときだけ state を変える */
  const hoverTargetRef = useRef(false)
  const [hoverTarget, setHoverTarget] = useState(false)

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

  // ─── ピック (3D モード, #397) ──────────────────────────────────────────────

  /**
   * 今描いている絵の行列と盤面。ピックと blockToClient が使う。描画の準備前は null。
   *
   * ブロックは**今描いている構造を作った snapshot** (prevSnapshotRef) から引く。
   * props の snapshot は 1 レンダ先に進んでいることがある。
   */
  const currentView = useCallback(() => {
    const canvas = canvasRef.current
    const structure = structureRef.current
    const snap = prevSnapshotRef.current
    if (!canvas || !structure || !snap || !rendererRef.current) return null
    const rect = canvas.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0 || canvas.clientHeight <= 0) return null
    const size = structure.getSize()
    return {
      left: rect.left,
      top: rect.top,
      // 画面の点 ↔ NDC は表示された大きさで、画面比は deepslate と同じ clientWidth/Height で
      w: rect.width,
      h: rect.height,
      size,
      snap,
      vm: viewMatrixOf(cameraRef.current, size),
      pm: projMatrixOf(canvas.clientWidth / canvas.clientHeight),
    }
  }, [cameraRef])

  /** 画面の点 (clientX/Y) の光線で、最初に当たる押せる素子。座標は snapshot の座標 */
  const pick3D = useCallback(
    (clientX: number, clientY: number): Pos3D | null => {
      const view = currentView()
      if (!view) return null
      const ray = canvasRay(clientX - view.left, clientY - view.top, view.w, view.h, view.vm, view.pm)
      if (!ray) return null
      const { snap } = view
      const [minX] = snap.bounds.x, [minY] = snap.bounds.y, [minZ] = snap.bounds.z
      const hit = pickCell(ray, view.size, (x, y, z) =>
        pickRoleOf(snap.blocks.get(`${x + minX},${y + minY},${z + minZ}`)))
      return hit ? [hit[0] + minX, hit[1] + minY, hit[2] + minZ] : null
    },
    [currentView],
  )

  const blockToClient = useCallback(
    (pos: Pos3D): { x: number; y: number } | null => {
      const view = currentView()
      if (!view) return null
      const { snap } = view
      const p = [
        pos[0] - snap.bounds.x[0] + 0.5,
        pos[1] - snap.bounds.y[0] + 0.5,
        pos[2] - snap.bounds.z[0] + 0.5,
      ]
      const c = pointToCanvas(p, view.w, view.h, view.vm, view.pm)
      return c ? { x: view.left + c.x, y: view.top + c.y } : null
    },
    [currentView],
  )

  /** クリック・タップした点のピック。タッチは外れても周り (半径 6px と 12px) を探す */
  const pickForTap = useCallback(
    (clientX: number, clientY: number, touch: boolean): Pos3D | null =>
      pickNearest(clientX, clientY, pick3D, blockToClient, touch ? TOUCH_PICK_RADII : []),
    [pick3D, blockToClient],
  )

  const updateHover = useCallback(
    (clientX: number, clientY: number) => {
      const over = !!onBlockClick && pick3D(clientX, clientY) !== null
      if (over === hoverTargetRef.current) return
      hoverTargetRef.current = over
      setHoverTarget(over)
    },
    [onBlockClick, pick3D],
  )

  useEffect(() => {
    if (!viewRef) return
    const handle: IsometricViewHandle = { blockToClient }
    viewRef.current = handle
    return () => {
      if (viewRef.current === handle) viewRef.current = null
    }
  }, [viewRef, blockToClient])

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
        // 3D: ピンチになった操作はクリックにもドラッグにもしない (指を全部離すまで)
        if (gestureRef.current) gestureRef.current.phase = 'pinch'
        const pts = [...activePointers.current.values()]
        lastPinchDist.current = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y)
        lastPinchMid.current  = {x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2}
        return
      }

      // 1本指
      if (!topDown) {
        // 3D: 押した時点ではまだ回さない。動いた量で、ドラッグかクリックかを決める (#397)
        gestureRef.current = {
          id: e.pointerId,
          x: e.clientX,
          y: e.clientY,
          t: e.timeStamp,
          touch: e.pointerType === 'touch',
          canTap: e.button === 0 && e.isPrimary,
          phase: 'press',
        }
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
    [topDown, panMode, onBlockClick, hitBlock, onRightMouseDown],
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
          const newDist = Math.max(3, Math.min(zoomLimit(), cam.distance * scale))

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

      // 1本指
      if (!topDown) {
        const g = gestureRef.current
        if (!g) {
          // 押していないマウス: 押せる素子の上ならカーソルを変える
          if (e.pointerType === 'mouse') updateHover(e.clientX, e.clientY)
          return
        }
        if (g.id !== e.pointerId || g.phase === 'pinch') return
        if (g.phase === 'press') {
          const slop = g.touch ? CLICK_SLOP_TOUCH : CLICK_SLOP_MOUSE
          if (Math.hypot(e.clientX - g.x, e.clientY - g.y) <= slop) return
          // しきい値を越えた: ここから回し始める。越えた位置を起点にするので絵は跳ばない
          g.phase = 'drag'
          setIsPanning(true)
          onMouseDown(e as unknown as React.MouseEvent)
          return
        }
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
    [topDown, panMode, onBlockClick, hitBlock, onMouseDown, onMouseMove, onRightMouseMove, placementY, cameraRef, getPanScale, updateHover],
  )

  /** pointerup に加えて pointerleave と pointercancel でも呼ぶ */
  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      // 3D: しきい値の内側で離したらクリック・タップ (#397)
      const g = gestureRef.current
      if (!topDown && g && g.id === e.pointerId) {
        gestureRef.current = null
        // pointerleave / pointercancel では押さない。押す位置は押した時の座標
        // (クリックではカメラが回らないので、押した時と離した時でカメラは同じ)
        if (e.type === 'pointerup' && g.phase === 'press' && g.canTap && onBlockClick
          && (!g.touch || e.timeStamp - g.t <= TAP_MAX_MS_TOUCH)) {
          const pos = pickForTap(g.x, g.y, g.touch)
          if (pos) onBlockClick(pos, 'left')
        }
      }
      activePointers.current.delete(e.pointerId)
      if (activePointers.current.size < 2) {
        lastPinchDist.current = null
        lastPinchMid.current  = null
      }
      isPainting.current = false
      setIsPanning(false)
      onRightMouseUp()
      if (!topDown) onMouseUp()
      // pointercancel の後や、タッチの pointerup 後の pointerleave では捕捉が外れている
      else if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    },
    [topDown, onBlockClick, pickForTap, onMouseUp, onRightMouseUp],
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
        cam.distance = Math.max(3, Math.min(zoomLimit(), cam.distance + e.deltaY * 0.05))
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
      cam.distance = Math.max(3, Math.min(zoomLimit(), oldDist * factor))

      const newDepth = cam.distance + sy / 2 - placementY
      const wx1 = ndcX * aspect * newDepth / FOV_F + sx / 2 + cam.panX
      const wz1 = sz / 2 - ndcY * newDepth / FOV_F + cam.panZ

      cam.panX += wx0 - wx1
      cam.panZ += wz0 - wz1
    }

    canvas.addEventListener('wheel', handleWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', handleWheel)
  }, [topDown, placementY, cameraRef])

  // ─── プリロードに無いブロック名の収集 (#234) ──────────────────────────────
  // 装飾は取り込み元の名前をそのまま持つので固定表に列挙できない。ここで拾って
  // buildResources に渡さないと**エラーも出さずに消えて見える**。名前が増えたときだけ
  // extraKey を動かし、下の初期化を作り直す
  const extraNamesRef = useRef<string[]>([])
  const [extraKey, setExtraKey] = useState('')

  useEffect(() => {
    const found = extraPreloadNames(snapshot)
    const merged = [...new Set([...extraNamesRef.current, ...found])].sort()
    const key = merged.join(',')
    if (key !== extraNamesRef.current.join(',')) {
      extraNamesRef.current = merged
      setExtraKey(key)
    }
  }, [snapshot])

  // ─── WebGL 初期化（マウント時 + 未知ブロック名が増えたとき） ─────────────

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

        const resources = await buildResources(
          [...VIEWER_PRELOAD_BLOCKS, ...extraNamesRef.current])
        if (cancelled) return

        // 初回スナップショットで Structure を構築
        const { structure } = worldSnapshotToStructure(snapshot)
        structureRef.current = structure
        prevSnapshotRef.current = snapshot

        // **見えない mesh を作らせない** (#272)。deepslate の StructureRenderer は
        // options 未指定だと useInvisibleBlockBuffer が既定 true になり、
        // setStructure のたびに**盤面の空セル 1 個につき 12 本の線**を積んだ mesh を作り直す。
        // 描画するコードはこのリポジトリに 1 件も無いので、作った直後に捨てている。
        // 盤面の**体積**に比例するので、16x147x17 で 606ms / 64³ で 11.5 秒かかっていた
        // (実測。盤面上限は BOARD_MAX=256 なのでそこまで行くとメモリで死ぬ)
        const renderer = new StructureRenderer(gl, structure, resources,
          { useInvisibleBlockBuffer: false })
        rendererRef.current = renderer

        // アトラステクスチャの MIN_FILTER を NEAREST に（UV ブリード防止）
        const internal = renderer as unknown as { atlasTexture: WebGLTexture | null }
        if (internal.atlasTexture) {
          gl.bindTexture(gl.TEXTURE_2D, internal.atlasTexture)
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
          gl.bindTexture(gl.TEXTURE_2D, null)
        }

        const size = structure.getSize()
        // **回路の大きさに合わせて寄る** (#238)。
        // 旧: max(幅,高さ,奥行) * 1.5 は視野角も画面比も見ていないため、
        // 147 段の回路が画面の高さの 3 割しか使わない糸のような柱になっていた
        fittedSizeRef.current = `${size[0]},${size[1]},${size[2]}`
        // 外から指定されていたらそちらを尊重する (上書きしない)
        if (!externalCameraRef.current) {
          cameraRef.current.distance = fitDistance(size as [number, number, number], {
            aspect: canvas.clientWidth / Math.max(1, canvas.clientHeight),
          })
        }

        setStatus('ready')
        let readyFired = false

        const draw = () => {
          if (!structureRef.current || !rendererRef.current) return
          const cam = cameraRef.current

          // 外部からのカメラ上書き (fitCamera 等) を消費する
          if (cameraInputRef?.current) {
            const ci = cameraInputRef.current
            if (ci.distance !== undefined) {
              cam.distance = ci.distance
              externalCameraRef.current = true    // 以後の自動フィットは譲る
            }
            if (ci.panX !== undefined) cam.panX = ci.panX
            if (ci.panZ !== undefined) cam.panZ = ci.panZ
            if (ci.rotX !== undefined) cam.rotX = ci.rotX
            if (ci.rotY !== undefined) cam.rotY = ci.rotY
            cameraInputRef.current = null
          }

          const w = canvas.clientWidth
          const h = canvas.clientHeight
          if (canvas.width !== w || canvas.height !== h) {
            canvas.width = w
            canvas.height = h
            renderer.setViewport(0, 0, w, h)
          }

          // ピック (#397) と同じ関数で作る。片方だけ変えると押した所と違うマスが切り替わる
          const vm = viewMatrixOf(cam, structureRef.current.getSize())

          // カメラ状態を外部に公開（グリッドオーバーレイ等に使用）
          if (cameraStateRef) {
            cameraStateRef.current = { distance: cam.distance, panX: cam.panX, panZ: cam.panZ }
          }

          gl.clearColor(0.1, 0.1, 0.12, 1)
          gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
          renderer.drawStructure(vm)
          renderer.drawGrid(vm)

          // 初回描画が済んだ時点で ready 通知 (デモの window.__demo.ready 用)
          if (!readyFired) {
            readyFired = true
            onReadyRef.current?.()
          }

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
  }, [extraKey]) // 初回マウント時 + 未知ブロック名が増えたとき (#234)

  // ─── snapshot 変化時に構造を再構築 ──────────────────────────────────────

  useEffect(() => {
    const renderer = rendererRef.current
    if (!renderer) return
    // **中身で比べる** (#272)。EditorPage の snapshot は毎レンダ新しい
    // オブジェクトリテラルなので、参照比較のガードは一度も効かない。
    // ブロックが 1 個も変わらないパレット選択でも構造を作り直していた (実測 0.5-0.7 秒)。
    // sim も editor も BlockState を書き換えず必ず新しいオブジェクトを作るので、
    // **エントリごとの参照比較で変更を取りこぼさない**
    // (in-place で書き換える経路を生やすとここが効かなくなる)
    if (sameSnapshot(prevSnapshotRef.current, snapshot)) {
      prevSnapshotRef.current = snapshot
      return
    }

    const { structure: newStructure } = worldSnapshotToStructure(snapshot)
    // **大きさが変わったら寄り直す** (#238)。取り込みで盤面が伸びても
    // マウント時の距離のままだと、収まらない / 豆粒になる
    const ns = newStructure.getSize()
    const key = `${ns[0]},${ns[1]},${ns[2]}`
    if (key !== fittedSizeRef.current) {
      fittedSizeRef.current = key
      if (!externalCameraRef.current) {
        const canvas = canvasRef.current
        cameraRef.current.distance = fitDistance(ns as [number, number, number], {
          aspect: canvas ? canvas.clientWidth / Math.max(1, canvas.clientHeight) : 1,
        })
      }
    }
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
          // 3D: 押せる素子の上で pointer、回している間は grabbing (#397)
          cursor: isPanning ? 'grabbing' : topDown ? (panMode ? 'grab' : editable ? 'crosshair' : 'grab')
            : (hoverTarget && onBlockClick ? 'pointer' : 'grab'),
          touchAction: 'none',
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        onPointerCancel={handlePointerUp}
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
