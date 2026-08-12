/**
 * @redstone/editor + @redstone/sim + @redstone/viewer を使った回路エディター
 *
 * - 編集モード: topDown=true / パレットでブロック選択 → クリック配置、右クリック削除
 *   - 空セルをクリック → 新規配置
 *   - 既存ブロックをクリック → 選択（向き・遅延バーに現在値を反映）
 *   - 選択後バーを操作 → 選択ブロックに即時反映
 *   - 消しゴム選択 → 左クリック（ドラッグ含む）で削除
 * - シミュレーションモード: topDown=false の3Dビュー / tick実行 / レバークリック
 *
 * ── グリッド表示の仕組み ──
 * IsometricView の cameraStateRef でカメラ状態を取得し、
 * 透明 canvas オーバーレイに RAF ループでグリッド線を描画する。
 * topDown 座標変換: scale = FOV_F * canvasH / (2 * depth)
 * depth = camDist + GRID_LAYERS/2 - activeLayer (structureY=GRID_LAYERS)
 *
 * ── 3D 編集 ──
 * 2D の編集操作はそのままに、右側の高さパネルで編集対象レイヤー (Y) を
 * 切り替える。既定では activeLayer より上のレイヤーを非表示にして
 * 下層を編集しやすくする（トグルで全層表示可）。
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import { CircuitEditor } from '@redstone/editor'
import type { PlaceableType, PlaceOptions } from '@redstone/editor'
import { SimWorld } from '@redstone/sim'
import type { WorldSnapshot, BlockState } from '@redstone/sim'
import type { HDir, Pos3D } from '@redstone/sim'
import { IsometricView } from '@redstone/viewer'
import type { CameraState } from '@redstone/viewer'
import { MCMETA_BASE } from './mcAssets'
import { exportToNbtBytes, importFromNbtBytes, downloadNbt, readFileAsUint8Array } from './nbtIO'
import { decideCellTap } from './editorTap'

/**
 * E2E テスト用の命令的フック (issue #70)。
 * パレット/コントロールは data-testid で実クリックする一方、canvas 上のグリッド
 * 配置 (ピクセル校正が脆弱) と sim 状態読み取りだけをこの API 経由にして再現性を担保する。
 */
export interface EditorTestApi {
  placeAt: (x: number, y: number, z: number, type: PlaceableType, opts?: PlaceOptions) => void
  removeAt: (x: number, y: number, z: number) => void
  clearAll: () => void
  getEditorBlockAt: (x: number, y: number, z: number) => BlockState | null
  getSimStateAt: (x: number, y: number, z: number) => BlockState | null
  getMode: () => 'edit' | 'sim'
  /** アクティブレイヤーのセルを左クリック相当で叩く (canvas ピクセル校正を避けた #99 検証用) */
  tapCell: (x: number, z: number) => void
  /** パレット選択を切り替える (tapCell 前のツール指定用) */
  selectTool: (type: PaletteType) => void
}

declare global {
  interface Window {
    __editorTest?: EditorTestApi
  }
}

// ── 定数 ──────────────────────────────────────────────────────────────────────

const GRID_W = 16
const GRID_H = 16
/** 編集可能なレイヤー数 (Y = 0 .. GRID_LAYERS-1) */
const GRID_LAYERS = 8

// ── 型 ────────────────────────────────────────────────────────────────────────

/** パレットアイテムの型。PlaceableType + 消しゴム + 移動 */
type PaletteType = PlaceableType | 'eraser' | 'move'

/** sim モードでパネルから手動トリガできる素子 */
interface TriggerEntry {
  pos: [number, number, number]
  type: string
}

/** トリガパネルの対象素子と表示 (略号は trace の abbrOf と揃える) */
const TRIGGER_META: Record<string, { abbr: string; log: string; momentary: boolean }> = {
  lever:                           { abbr: 'Le', log: 'レバー',   momentary: false },
  button_stone:                    { abbr: 'Bu', log: 'ボタン(石) を押す', momentary: true },
  button_wood:                     { abbr: 'Bu', log: 'ボタン(木) を押す', momentary: true },
  pressure_plate_wood:             { abbr: 'Pp', log: '感圧板(木) を踏む', momentary: true },
  pressure_plate_stone:            { abbr: 'Pp', log: '感圧板(石) を踏む', momentary: true },
  weighted_pressure_plate_light:   { abbr: 'Wp', log: '重量板(金) を踏む', momentary: true },
  weighted_pressure_plate_heavy:   { abbr: 'Wp', log: '重量板(鉄) を踏む', momentary: true },
  target:                          { abbr: 'Tg', log: 'ターゲット発火',   momentary: true },
}
const TRIGGER_TYPES = new Set(Object.keys(TRIGGER_META))

/** トリガ素子の作動中表示 (lever/plate=powered, target=outputPower>0) */
function isTriggerOn(b: { type: string; powered?: boolean; outputPower?: number }): boolean {
  if (b.type === 'target') return (b.outputPower ?? 0) > 0
  return b.powered ?? false
}

// ── パレット定義 ──────────────────────────────────────────────────────────────

interface BlockMeta {
  type:       PaletteType
  label:      string
  /** mcmeta テクスチャパス。null のときは専用アイコンをレンダリング */
  texture:    string | null
  cssFilter?: string
  hasFacing:  boolean
  hasDelay:   boolean
  hasMode:    boolean
  /** 重量感圧板の踏まれ信号 (1-15) セレクタを表示するか */
  hasPressedPower?: boolean
  /** コンテナの背面読み信号 (0-15) セレクタを表示するか */
  hasSignal?: boolean
  /** ホッパー/ドロッパーの内容個数セレクタを表示するか (#65) */
  hasCount?: boolean
}

const BLOCK_PALETTE: BlockMeta[] = [
  // 移動ツール（特殊アイテム）
  { type: 'move',       label: '移動',          texture: null,                    hasFacing: false, hasDelay: false, hasMode: false },
  { type: 'wire',       label: 'ワイヤー',      texture: 'block/redstone_dust_dot',
    cssFilter: 'sepia(1) saturate(10) hue-rotate(320deg) brightness(0.8)',
    hasFacing: false, hasDelay: false, hasMode: false },
  { type: 'lever',      label: 'レバー',        texture: 'block/lever',           hasFacing: false, hasDelay: false, hasMode: false },
  { type: 'button_stone', label: 'ボタン(石)',  texture: 'block/stone',           hasFacing: false, hasDelay: false, hasMode: false },
  { type: 'button_wood',  label: 'ボタン(木)',  texture: 'block/oak_planks',      hasFacing: false, hasDelay: false, hasMode: false },
  { type: 'torch',      label: 'トーチ(床)',    texture: 'block/redstone_torch',  hasFacing: false, hasDelay: false, hasMode: false },
  { type: 'wall_torch', label: 'トーチ(壁)',    texture: 'block/redstone_torch',  hasFacing: true,  hasDelay: false, hasMode: false },
  { type: 'repeater',   label: 'リピーター',    texture: 'block/repeater',        hasFacing: true,  hasDelay: true,  hasMode: false },
  { type: 'comparator', label: 'コンパレーター', texture: 'block/comparator',      hasFacing: true,  hasDelay: false, hasMode: true  },
  { type: 'pressure_plate_wood',  label: '感圧板(木)', texture: 'block/oak_planks',   hasFacing: false, hasDelay: false, hasMode: false },
  { type: 'pressure_plate_stone', label: '感圧板(石)', texture: 'block/stone',        hasFacing: false, hasDelay: false, hasMode: false },
  { type: 'weighted_pressure_plate_light', label: '重量板(金)', texture: 'block/gold_block', hasFacing: false, hasDelay: false, hasMode: false, hasPressedPower: true },
  { type: 'weighted_pressure_plate_heavy', label: '重量板(鉄)', texture: 'block/iron_block', hasFacing: false, hasDelay: false, hasMode: false, hasPressedPower: true },
  { type: 'lamp',       label: 'ランプ',        texture: 'block/redstone_lamp',   hasFacing: false, hasDelay: false, hasMode: false },
  { type: 'note_block', label: '音符ブロック',  texture: 'block/note_block',      hasFacing: false, hasDelay: false, hasMode: false },
  { type: 'piston',     label: 'ピストン',      texture: 'block/piston_top',      hasFacing: true,  hasDelay: false, hasMode: false },
  { type: 'sticky_piston', label: '粘着ピストン', texture: 'block/piston_top_sticky', hasFacing: true, hasDelay: false, hasMode: false },
  { type: 'observer',   label: 'オブザーバー',  texture: 'block/observer_front',   hasFacing: true,  hasDelay: false, hasMode: false },
  { type: 'redstone_block', label: 'レッドストーンブロック', texture: 'block/redstone_block', hasFacing: false, hasDelay: false, hasMode: false },
  { type: 'target',     label: 'ターゲット',    texture: 'block/target_side',     hasFacing: false, hasDelay: false, hasMode: false },
  { type: 'container',  label: 'コンテナ',      texture: 'block/barrel_side',     hasFacing: false, hasDelay: false, hasMode: false, hasSignal: true },
  { type: 'hopper',     label: 'ホッパー',      texture: 'block/hopper_outside',  hasFacing: true,  hasDelay: false, hasMode: false, hasCount: true },
  { type: 'dropper',    label: 'ドロッパー',    texture: 'block/dropper_front',   hasFacing: true,  hasDelay: false, hasMode: false, hasCount: true },
  { type: 'solid',      label: '石',            texture: 'block/stone',           hasFacing: false, hasDelay: false, hasMode: false },
  // 消しゴム（特殊アイテム）
  { type: 'eraser',     label: '消しゴム',      texture: null,                    hasFacing: false, hasDelay: false, hasMode: false },
]

const PLACEHOLDER_IMG =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32'%3E%3Crect width='32' height='32' fill='%23555'/%3E%3C/svg%3E"

const H_DIRS: [HDir, string][] = [
  ['north', '↑北'],
  ['south', '↓南'],
  ['east',  '→東'],
  ['west',  '←西'],
]

// topDown 座標変換定数（coordUtils.ts の FOV_F と一致させる）
const FOV_F = 1 / Math.tan((70 * Math.PI / 180) / 2)

// ── メインコンポーネント ──────────────────────────────────────────────────────

interface EditorPageProps {
  onBack?: () => void
}

export function EditorPage({ onBack }: EditorPageProps) {
  const editorRef = useRef(new CircuitEditor(0))
  const [, forceUpdate] = useState(0)
  const rerender = useCallback(() => forceUpdate(n => n + 1), [])

  // モード
  const [mode, setMode] = useState<'edit' | 'sim'>('edit')

  // 編集レイヤー (Y) と上層カット表示
  const [activeLayer, setActiveLayer] = useState(0)
  const [cutUpper, setCutUpper] = useState(true)

  // シミュレーション
  const [simWorld, setSimWorld] = useState<SimWorld | null>(null)
  const [tick, setTick] = useState(0)
  const [running, setRunning] = useState(false)
  const runIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // 手動トリガ素子一覧 (レバー/感圧板/ターゲット)。ON 表示は world から導出する
  const [triggers, setTriggers] = useState<TriggerEntry[]>([])

  // チェックポイント（Initialize で保存した状態）
  const [checkpoint, setCheckpoint] = useState<Map<string, BlockState> | null>(null)
  const [checkpointTick, setCheckpointTick] = useState(0)

  // 選択・デフォルト設定
  const [selectedType, setSelectedType] = useState<PaletteType>('wire')
  const [facing, setFacing] = useState<HDir>('east')
  const [delay, setDelay]   = useState<1 | 2 | 3 | 4>(1)
  const [comparatorMode, setComparatorMode] = useState<'compare' | 'subtract'>('compare')
  // 重量感圧板の踏まれ信号 (1-15, 既定 15) / コンテナの背面読み信号 (0-15, 既定 0)
  const [pressedPower, setPressedPower] = useState(15)
  const [signal, setSignal] = useState(0)
  // ホッパー/ドロッパーの内容個数 (既定 0) (#65)
  const [count, setCount] = useState(0)

  // グリッド上の選択セル (x, z)
  const [selectedPos, setSelectedPos] = useState<[number, number] | null>(null)

  // ⋯ メニュー
  const [showMenu, setShowMenu] = useState(false)

  // ログ
  const [log, setLog] = useState<string[]>(['編集: 左クリックで配置/選択、右クリックで削除'])
  const addLog = useCallback((msg: string) => {
    setLog(prev => [...prev.slice(-49), msg])
  }, [])

  // ── 編集レイヤー切替 ─────────────────────────────────────────────────
  const changeLayer = useCallback((y: number) => {
    const clamped = Math.max(0, Math.min(GRID_LAYERS - 1, y))
    editorRef.current.setActiveLayer(clamped)
    setActiveLayer(clamped)
    setSelectedPos(null)
    addLog(`編集レイヤー Y=${clamped}`)
  }, [addLog])

  // ── カメラ状態 ref（グリッドオーバーレイ用） ─────────────────────────
  const cameraStateRef = useRef<CameraState | null>(null)
  const gridCanvasRef  = useRef<HTMLCanvasElement>(null)

  // ── スナップショット（表示用） ──────────────────────────────────────────

  // 実ブロックのスナップショット + bounds を GRID サイズに固定。
  // 編集モードで上層カットが有効なとき activeLayer より上を非表示にする。
  const rawSnapshot = simWorld?.snapshot() ?? editorRef.current.getSnapshot()
  let visibleBlocks = rawSnapshot.blocks
  if (mode === 'edit' && cutUpper) {
    const filtered = new Map<`${number},${number},${number}`, BlockState>()
    for (const [key, b] of rawSnapshot.blocks) {
      if (Number(key.split(',')[1]) <= activeLayer) filtered.set(key, b)
    }
    visibleBlocks = filtered
  }
  const snapshot: WorldSnapshot = {
    blocks: visibleBlocks,
    bounds: { x: [0, GRID_W - 1], y: [0, GRID_LAYERS - 1], z: [0, GRID_H - 1] },
  }

  // レイヤーごとのブロック数（高さパネルのインジケーター用）
  const layerCounts = (() => {
    const counts = new Array<number>(GRID_LAYERS).fill(0)
    for (const key of editorRef.current.getAllBlocks().keys()) {
      const y = Number(key.split(',')[1])
      if (y >= 0 && y < GRID_LAYERS) counts[y]++
    }
    return counts
  })()

  // ── グリッドオーバーレイ RAF ─────────────────────────────────────────

  useEffect(() => {
    if (mode !== 'edit') return
    let raf: number
    const draw = () => {
      const canvas = gridCanvasRef.current
      const cam = cameraStateRef.current
      if (!canvas || !cam) { raf = requestAnimationFrame(draw); return }
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      if (w === 0 || h === 0) { raf = requestAnimationFrame(draw); return }
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width  = w
        canvas.height = h
      }
      const ctx = canvas.getContext('2d')!
      ctx.clearRect(0, 0, w, h)
      // depth = camDist + sy/2 - placementY  (sy=GRID_LAYERS, placementY=activeLayer)
      const depth = cam.distance + GRID_LAYERS / 2 - activeLayer
      const scale = FOV_F * h / (2 * depth)
      const gridLeft = w / 2 - (GRID_W / 2 + cam.panX) * scale
      const gridTop  = h / 2 - (GRID_H / 2 + cam.panZ) * scale
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)'
      ctx.lineWidth = 0.5
      ctx.beginPath()
      for (let x = 0; x <= GRID_W; x++) {
        const cx = gridLeft + x * scale
        ctx.moveTo(cx, gridTop)
        ctx.lineTo(cx, gridTop + GRID_H * scale)
      }
      for (let z = 0; z <= GRID_H; z++) {
        const cy = gridTop + z * scale
        ctx.moveTo(gridLeft, cy)
        ctx.lineTo(gridLeft + GRID_W * scale, cy)
      }
      ctx.stroke()
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [mode, activeLayer])

  // ── グリッドの選択ブロック情報 ──────────────────────────────────────────

  // 表示専用 stone は含まない実ブロック
  const gridBlock = selectedPos
    ? editorRef.current.getBlock(selectedPos[0], selectedPos[1])
    : null

  // バーに表示する向き・遅延（選択ブロック優先、なければデフォルト）
  const barFacing: HDir = (
    gridBlock && 'facing' in gridBlock &&
    H_DIRS.some(([d]) => d === (gridBlock as unknown as Record<string, unknown>).facing)
  ) ? (gridBlock as unknown as Record<string, unknown>).facing as HDir : facing

  const barDelay: 1 | 2 | 3 | 4 =
    gridBlock?.type === 'repeater' ? gridBlock.delay : delay

  const barMode: 'compare' | 'subtract' =
    gridBlock?.type === 'comparator' ? gridBlock.mode : comparatorMode

  const barPressedPower: number =
    (gridBlock?.type === 'weighted_pressure_plate_light' ||
     gridBlock?.type === 'weighted_pressure_plate_heavy')
      ? gridBlock.pressedPower : pressedPower

  const barSignal: number =
    gridBlock?.type === 'container' ? gridBlock.signal : signal

  const barCount: number =
    (gridBlock?.type === 'hopper' || gridBlock?.type === 'dropper') ? gridBlock.count : count

  // 向き・遅延バーを表示するか
  const gridBlockHasFacing = !!gridBlock && 'facing' in gridBlock &&
    H_DIRS.some(([d]) => d === (gridBlock as unknown as Record<string, unknown>).facing)

  const selectedMeta = BLOCK_PALETTE.find(b => b.type === selectedType)
  const showFacingBar = mode === 'edit' && selectedType !== 'eraser' && (
    !!(selectedMeta?.hasFacing) ||
    !!(selectedMeta?.hasDelay) ||
    !!(selectedMeta?.hasMode) ||
    !!(selectedMeta?.hasPressedPower) ||
    !!(selectedMeta?.hasSignal) ||
    !!(selectedMeta?.hasCount) ||
    gridBlockHasFacing ||
    gridBlock?.type === 'repeater' ||
    gridBlock?.type === 'comparator' ||
    gridBlock?.type === 'weighted_pressure_plate_light' ||
    gridBlock?.type === 'weighted_pressure_plate_heavy' ||
    gridBlock?.type === 'container' ||
    gridBlock?.type === 'hopper' ||
    gridBlock?.type === 'dropper'
  )

  // ── ブロッククリック（edit + sim 共通） ─────────────────────────────────

  // useCallback の deps を最小化して IsometricView への参照を安定させる
  const stateRef = useRef({ mode, simWorld, selectedType, facing, delay, comparatorMode, pressedPower, signal, count })
  stateRef.current = { mode, simWorld, selectedType, facing, delay, comparatorMode, pressedPower, signal, count }

  const handleBlockClick = useCallback((pos: Pos3D, button: 'left' | 'right') => {
    const { mode, simWorld, selectedType, facing, delay, comparatorMode, pressedPower, signal, count } = stateRef.current
    const [x, , z] = pos

    // ── シミュレーションモード: レバーのみ操作 ──────────────────────────
    if (mode === 'sim') {
      if (simWorld) {
        const b = simWorld.getBlockAt(pos)
        if (b?.type === 'lever') {
          simWorld.activateBlock(x, pos[1], z)
          addLog(`レバートグル (${x}, ${pos[1]}, ${z})`)
          rerender()
        } else if (b?.type === 'button_stone' || b?.type === 'button_wood') {
          // ボタンは手動トリガ (押下 ON → 20/30gt 後に自動 OFF。作動中は no-op)
          simWorld.activateBlock(x, pos[1], z)
          addLog(`ボタンを押す (${x}, ${pos[1]}, ${z})`)
          rerender()
        } else if (b?.type === 'target') {
          // ターゲットは手動トリガ (中心命中相当の 15、20gt 持続)
          simWorld.activateBlock(x, pos[1], z)
          addLog(`ターゲット発火 (${x}, ${pos[1]}, ${z})`)
          rerender()
        } else if (
          b?.type === 'pressure_plate_wood' || b?.type === 'pressure_plate_stone' ||
          b?.type === 'weighted_pressure_plate_light' || b?.type === 'weighted_pressure_plate_heavy'
        ) {
          // 感圧板は手動トリガ (踏まれ ON → 持続 gt で自動 OFF)
          simWorld.activateBlock(x, pos[1], z)
          addLog(`感圧板を踏む (${x}, ${pos[1]}, ${z})`)
          rerender()
        }
      }
      return
    }

    // ── 編集モード ────────────────────────────────────────────────────

    // 消しゴム: 左右クリックどちらも削除
    if (selectedType === 'eraser' || button === 'right') {
      const before = editorRef.current.getBlock(x, z)
      if (before) {
        editorRef.current.removeBlock(x, z)
        setSelectedPos(null)
        addLog(`削除 (${x}, ${z})`)
        rerender()
      }
      return
    }

    // 左クリック（消しゴム以外）。別種ツール × 既存ブロックは「置き換え」= place (#99)
    const existing = editorRef.current.getBlock(x, z)
    const action = decideCellTap(existing, selectedType)

    // ワイヤーツールで既存ワイヤーをクリック → dot ⇄ cross 形状トグル (C8)
    if (action === 'wire-toggle') {
      if (editorRef.current.toggleWireDot(x, z)) {
        setSelectedPos([x, z])
        addLog(`ワイヤー形状トグル (${x}, ${z})`)
        rerender()
      }
      return
    }

    if (action === 'select' && existing) {
      // 同種ツールで既存ブロックをクリック → 選択して向き・遅延・モードを読み込む
      setSelectedPos([x, z])
      setSelectedType(existing.type as PlaceableType)
      if ('facing' in existing) {
        const f = (existing as unknown as Record<string, unknown>).facing as HDir
        if (H_DIRS.some(([d]) => d === f)) setFacing(f)
      }
      if ('delay' in existing) {
        setDelay((existing as unknown as Record<string, unknown>).delay as 1 | 2 | 3 | 4)
      }
      if (existing.type === 'comparator') {
        setComparatorMode((existing as unknown as Record<string, unknown>).mode as 'compare' | 'subtract')
      }
      if (existing.type === 'weighted_pressure_plate_light' ||
          existing.type === 'weighted_pressure_plate_heavy') {
        setPressedPower(existing.pressedPower)
      }
      if (existing.type === 'container') {
        setSignal(existing.signal)
      }
      if (existing.type === 'hopper' || existing.type === 'dropper') {
        setCount(existing.count)
      }
      addLog(`選択: ${existing.type} (${x}, ${z})`)
      return
    }

    // action === 'place': 空セル or 別種ブロック (別種は置き換え)
    const meta = BLOCK_PALETTE.find(b => b.type === selectedType)
    const opts: PlaceOptions = {}
    if (meta?.hasFacing) opts.facing = facing
    if (meta?.hasDelay)  opts.delay  = delay
    if (meta?.hasMode)   opts.mode   = comparatorMode
    if (meta?.hasPressedPower) opts.pressedPower = pressedPower
    if (meta?.hasSignal)       opts.signal       = signal
    if (meta?.hasCount)        opts.count        = count
    editorRef.current.placeBlock(x, z, selectedType as PlaceableType, opts)
    setSelectedPos([x, z])
    addLog(`${meta?.label ?? selectedType}${existing && existing.type !== 'air' ? ' で置き換え' : ' を配置'} (${x}, ${z})`)
    rerender()
  }, [addLog, rerender])

  // ── 向き変更 ────────────────────────────────────────────────────────

  const handleFacingChange = useCallback((newFacing: HDir) => {
    setFacing(newFacing)
    setSelectedPos(prev => {
      if (prev) {
        editorRef.current.rotateBlock(prev[0], prev[1], newFacing)
        rerender()
      }
      return prev
    })
  }, [rerender])

  // ── 遅延変更 ────────────────────────────────────────────────────────

  const handleDelayChange = useCallback((newDelay: 1 | 2 | 3 | 4) => {
    setDelay(newDelay)
    setSelectedPos(prev => {
      if (prev) {
        const block = editorRef.current.getBlock(prev[0], prev[1])
        if (block?.type === 'repeater') {
          const f = (block as unknown as Record<string, unknown>).facing as HDir
          editorRef.current.placeBlock(prev[0], prev[1], 'repeater', { facing: f, delay: newDelay })
          rerender()
        }
      }
      return prev
    })
  }, [rerender])

  // ── モード変更（コンパレーター） ─────────────────────────────────────

  const handleModeChange = useCallback((newMode: 'compare' | 'subtract') => {
    setComparatorMode(newMode)
    setSelectedPos(prev => {
      if (prev) {
        const block = editorRef.current.getBlock(prev[0], prev[1])
        if (block?.type === 'comparator') {
          const f = (block as unknown as Record<string, unknown>).facing as HDir
          editorRef.current.placeBlock(prev[0], prev[1], 'comparator', { facing: f, mode: newMode })
          rerender()
        }
      }
      return prev
    })
  }, [rerender])

  // ── 踏まれ信号変更（重量感圧板） ─────────────────────────────────────

  const handlePressedPowerChange = useCallback((newP: number) => {
    setPressedPower(newP)
    setSelectedPos(prev => {
      if (prev) {
        const block = editorRef.current.getBlock(prev[0], prev[1])
        if (block?.type === 'weighted_pressure_plate_light' ||
            block?.type === 'weighted_pressure_plate_heavy') {
          editorRef.current.placeBlock(prev[0], prev[1], block.type, { pressedPower: newP })
          rerender()
        }
      }
      return prev
    })
  }, [rerender])

  // ── 背面読み信号変更（コンテナ） ─────────────────────────────────────

  const handleSignalChange = useCallback((newSignal: number) => {
    setSignal(newSignal)
    setSelectedPos(prev => {
      if (prev) {
        const block = editorRef.current.getBlock(prev[0], prev[1])
        if (block?.type === 'container') {
          editorRef.current.placeBlock(prev[0], prev[1], 'container', { signal: newSignal })
          rerender()
        }
      }
      return prev
    })
  }, [rerender])

  // ── 内容個数変更（ホッパー/ドロッパー #65） ─────────────────────────

  const handleCountChange = useCallback((newCount: number) => {
    setCount(newCount)
    setSelectedPos(prev => {
      if (prev) {
        const block = editorRef.current.getBlock(prev[0], prev[1])
        if (block?.type === 'hopper' || block?.type === 'dropper') {
          const f = (block as unknown as Record<string, unknown>).facing as HDir
          editorRef.current.placeBlock(prev[0], prev[1], block.type, { facing: f, count: newCount })
          rerender()
        }
      }
      return prev
    })
  }, [rerender])

  // ── undo / redo / clear ─────────────────────────────────────────────

  const handleUndo = useCallback(() => {
    if (editorRef.current.undo()) {
      setSelectedPos(null)
      addLog('元に戻した')
      rerender()
    }
  }, [addLog, rerender])

  const handleRedo = useCallback(() => {
    if (editorRef.current.redo()) {
      setSelectedPos(null)
      addLog('やり直し')
      rerender()
    }
  }, [addLog, rerender])

  const handleClear = useCallback(() => {
    for (const key of editorRef.current.getAllBlocks().keys()) {
      const [x, y, z] = key.split(',').map(Number)
      editorRef.current.removeBlock3(x, y, z)
    }
    setSelectedPos(null)
    addLog('クリア（全レイヤー）')
    rerender()
  }, [addLog, rerender])

  // ── NBT エクスポート ────────────────────────────────────────────────────

  const handleExportNbt = useCallback(() => {
    const blocks = editorRef.current.getAllBlocks()
    const bytes = exportToNbtBytes(blocks, GRID_W, GRID_H)
    downloadNbt(bytes, 'circuit.nbt')
    addLog('NBT エクスポート完了')
  }, [addLog])

  // ── NBT インポート ────────────────────────────────────────────────────

  const importInputRef = useRef<HTMLInputElement>(null)

  const handleImportNbt = useCallback(async (file: File) => {
    try {
      const bytes = await readFileAsUint8Array(file)
      const { blocks, warnings } = importFromNbtBytes(bytes, { gridW: GRID_W, gridH: GRID_H, maxLayers: GRID_LAYERS })
      editorRef.current.resetToBlocks(blocks)
      setSelectedPos(null)
      rerender()
      if (warnings.length > 0) addLog(`インポート完了（警告: ${warnings.join(', ')}）`)
      else addLog(`インポート完了 (${blocks.size} ブロック)`)
    } catch (e) {
      addLog(`インポートエラー: ${e instanceof Error ? e.message : String(e)}`)
    }
  }, [addLog, rerender])

  // ── 手動トリガ一覧スキャン ────────────────────────────────────────────
  // sim の 3D ビューはカメラ回転優先でブロッククリックが届かないため、
  // 手動トリガ素子 (レバー/感圧板/ターゲット) はパネルのボタンから操作する

  const scanTriggers = useCallback((): TriggerEntry[] => {
    const found: TriggerEntry[] = []
    for (const [key, block] of editorRef.current.getAllBlocks()) {
      if (!TRIGGER_TYPES.has(block.type)) continue
      const [x, y, z] = key.split(',').map(Number)
      found.push({ pos: [x, y, z], type: block.type })
    }
    return found.sort((a, b) =>
      a.pos[1] - b.pos[1] || a.pos[2] - b.pos[2] || a.pos[0] - b.pos[0])
  }, [])

  // ── チェックポイント保存ヘルパー ────────────────────────────────────────

  const saveCheckpoint = useCallback((world: SimWorld, t: number) => {
    const snap = world.snapshot()
    setCheckpoint(new Map(snap.blocks))
    setCheckpointTick(t)
  }, [])

  // ── シミュレーション開始 ─────────────────────────────────────────────

  const handleStart = useCallback(() => {
    const world = editorRef.current.buildSimWorld()
    world.initialize()
    // 音符ブロックの発音イベント (BE フェーズ) をログへ可視化 (C5 #38)
    world.onNotePlay(e => addLog(`♪ 音符ブロック (${e.pos[0]}, ${e.pos[1]}, ${e.pos[2]}) note=${e.note}`))
    saveCheckpoint(world, 0)
    setSimWorld(world)
    setTick(0)
    setMode('sim')
    setSelectedPos(null)
    setTriggers(scanTriggers())
    addLog('シミュレーション開始 — tick=0 の初期状態。+1 または ▶ で進める')
    rerender()
  }, [addLog, rerender, scanTriggers, saveCheckpoint])

  // ── Initialize: 現在の状態をチェックポイントとして保存 ────────────────

  const handleInitialize = useCallback(() => {
    if (!simWorld) return
    setRunning(false)
    saveCheckpoint(simWorld, tick)
    addLog(`[sim] Initialize — tick ${tick} の状態を保存しました`)
  }, [simWorld, tick, addLog, saveCheckpoint])

  // ── Clear: チェックポイントに戻す ────────────────────────────────────

  const handleSimClear = useCallback(() => {
    if (!checkpoint) return
    setRunning(false)
    const world = new SimWorld()
    world.onNotePlay(e => addLog(`♪ 音符ブロック (${e.pos[0]}, ${e.pos[1]}, ${e.pos[2]}) note=${e.note}`))
    for (const [key, block] of checkpoint) {
      const [x, y, z] = key.split(',').map(Number)
      world.setBlock(x, y, z, block)
    }
    // ブロック状態から wire 電力・スケジュール済み tick を再計算する
    // クロック回路では flush しないため、トーチの ON/OFF 状態に合わせた
    // 次の tick のスケジュールのみが登録される
    world.initialize()
    setSimWorld(world)
    setTick(checkpointTick)
    addLog(`[sim] Clear — tick ${checkpointTick} の状態に戻しました`)
    rerender()
  }, [checkpoint, checkpointTick, addLog, rerender])

  // ── 個別トリガ操作 (レバー=トグル / 感圧板・ターゲット=単発) ──────────

  const handleTrigger = useCallback((x: number, y: number, z: number) => {
    if (!simWorld) return
    const b = simWorld.getBlockAt([x, y, z])
    const meta = b ? TRIGGER_META[b.type] : undefined
    if (!meta) return
    if (b!.type === 'lever') {
      simWorld.activateBlock(x, y, z)
      const on = (simWorld.getBlockAt([x, y, z]) as { powered?: boolean })?.powered ?? false
      addLog(`レバー (${x}, ${y}, ${z}): ${on ? 'ON' : 'OFF'}`)
    } else {
      // 単発系 (感圧板/ターゲット): 作動中は activateBlock が no-op
      const wasOn = isTriggerOn(b!)
      simWorld.activateBlock(x, y, z)
      addLog(wasOn ? `${meta.log} (${x}, ${y}, ${z}) — 作動中` : `${meta.log} (${x}, ${y}, ${z})`)
    }
    rerender()
  }, [simWorld, addLog, rerender])

  // ── Tick ─────────────────────────────────────────────────────────────

  const doTick = useCallback(() => {
    if (!simWorld) return
    const result = simWorld.tick()
    setTick(result.currentTick)
    if (!running) addLog(`tick ${result.currentTick}: ${result.changedPositions.length} ブロック変化`)
    rerender()
  }, [simWorld, running, addLog, rerender])

  // ── 連続実行 ─────────────────────────────────────────────────────────

  const handleToggleRun = useCallback(() => setRunning(prev => !prev), [])

  useEffect(() => {
    if (!running || !simWorld) {
      if (runIntervalRef.current) {
        clearInterval(runIntervalRef.current)
        runIntervalRef.current = null
      }
      return
    }
    runIntervalRef.current = setInterval(() => {
      const result = simWorld.tick()
      setTick(result.currentTick)
      rerender()  // snapshot を再計算させてビューアーを更新
    }, 100)
    return () => {
      if (runIntervalRef.current) clearInterval(runIntervalRef.current)
    }
  }, [running, simWorld, rerender])

  // ── 編集に戻る ───────────────────────────────────────────────────────

  const handleBackToEdit = useCallback(() => {
    setRunning(false)
    setSimWorld(null)
    setMode('edit')
    setTick(0)
    addLog('編集モードに戻りました')
    rerender()
  }, [addLog, rerender])

  // ── 全レバー一括トグル ───────────────────────────────────────────────

  const handleToggleLevers = useCallback(() => {
    if (!simWorld) return
    let found = false
    for (const t of triggers) {
      if (t.type !== 'lever') continue
      const b = simWorld.getBlockAt(t.pos)
      if (b?.type === 'lever') {
        simWorld.activateBlock(t.pos[0], t.pos[1], t.pos[2])
        found = true
      }
    }
    addLog(found ? '全レバートグル' : 'レバーなし')
    rerender()
  }, [simWorld, triggers, addLog, rerender])

  // ── パレット選択 ─────────────────────────────────────────────────────

  const handleSelectType = useCallback((type: PaletteType) => {
    setSelectedType(type)
    setSelectedPos(null)  // 選択解除（次の配置設定モードへ）
  }, [])

  // ── E2E テスト用フック (issue #70) ────────────────────────────────────
  const simWorldRef = useRef<SimWorld | null>(null)
  simWorldRef.current = simWorld
  const modeRef = useRef(mode)
  modeRef.current = mode

  useEffect(() => {
    window.__editorTest = {
      placeAt(x, y, z, type, opts) {
        const ed = editorRef.current
        const prev = ed.activeLayer
        ed.setActiveLayer(y)
        ed.placeBlock(x, z, type, opts ?? {})
        ed.setActiveLayer(prev)
        rerender()
      },
      removeAt(x, y, z) {
        editorRef.current.removeBlock3(x, y, z)
        rerender()
      },
      clearAll() { handleClear() },
      getEditorBlockAt: (x, y, z) => editorRef.current.getBlock3(x, y, z),
      getSimStateAt: (x, y, z) => simWorldRef.current?.getBlockAt([x, y, z]) ?? null,
      getMode: () => modeRef.current,
      tapCell: (x, z) => handleBlockClick([x, editorRef.current.activeLayer, z], 'left'),
      selectTool: (type) => handleSelectType(type),
    }
    return () => { delete window.__editorTest }
  }, [handleClear, handleBlockClick, handleSelectType, rerender])

  // ── render ───────────────────────────────────────────────────────────

  // ── シミュレーションモード ──────────────────────────────────────────────
  if (mode === 'sim') {
    return (
      <div className="flex flex-col h-full select-none" style={{ background: '#141414', color: '#f0f0f0' }}>

        {/* プライマリヘッダー */}
        <div className="shrink-0 flex items-center gap-2 px-2 py-2" style={{ background: '#2d2d2d', borderBottom: '2px solid #444' }}>
          {/* 編集に戻る */}
          <button onClick={handleBackToEdit} title="編集に戻る" data-testid="btn-edit"
                  className="mc-btn w-10 h-10 text-base">
            ✏
          </button>

          <div style={{ width: 1, alignSelf: 'stretch', background: '#444', margin: '0 4px' }} />

          {/* ティックカウンター */}
          <div className="flex items-center gap-2 px-3 h-10" style={{ background: '#1a1a1a', border: '2px solid #333' }}>
            <span className="font-pixel" style={{ fontSize: 11, color: '#666', letterSpacing: 2 }}>TICK</span>
            <span data-testid="tick-counter" className="font-pixel" style={{ fontSize: 18, color: '#ff9900', letterSpacing: 3, textShadow: '0 0 10px #cc6600' }}>
              {String(tick).padStart(4, '0')}
            </span>
          </div>

          {/* ステータスインジケーター */}
          <div className={`flex items-center gap-1.5 px-2 h-10 ${running ? 'rs-running' : ''}`}
               style={{ background: '#1a1a1a', border: `2px solid ${running ? '#cc2222' : '#333'}` }}>
            <span style={{
              display: 'inline-block', width: 9, height: 9, borderRadius: '50%',
              background: running ? '#ff4444' : simWorld ? '#336633' : '#333',
              boxShadow: running ? '0 0 8px #ff2222' : simWorld ? '0 0 4px #224422' : 'none',
              transition: 'all 0.2s',
            }} />
            <span className="font-pixel" style={{ fontSize: 12, color: running ? '#ff6666' : simWorld ? '#66cc66' : '#555' }}>
              {running ? 'RUN' : simWorld ? 'RDY' : '---'}
            </span>
          </div>

          <div className="flex-1" />

          {/* +1 ティック */}
          <button onClick={doTick} disabled={running || !simWorld} data-testid="btn-tick"
                  className="mc-btn w-10 h-10 font-mono text-sm font-bold">
            +1
          </button>

          {/* 連続/停止 */}
          <button onClick={handleToggleRun} disabled={!simWorld} data-testid="btn-run"
                  className="mc-btn h-10 px-5 font-bold text-xl"
                  style={{
                    background: !simWorld ? '#2a2a2a' : running ? '#7a3300' : '#1a4a1a',
                    borderColor: !simWorld ? '#444 #222 #222 #444'
                      : running ? '#cc6600 #442200 #442200 #cc6600'
                      : '#4a8a4a #0a2a0a #0a2a0a #4a8a4a',
                  }}>
            {running ? '⏸' : '▶'}
          </button>
        </div>

        {/* セカンダリバー（Init / Reset） */}
        <div className="shrink-0 flex items-center gap-2 px-2 py-1.5" style={{ background: '#1e1e1e', borderBottom: '1px solid #2a2a2a' }}>
          <button onClick={handleInitialize} disabled={!simWorld}
                  className="mc-btn text-xs px-3 h-8 font-mono"
                  style={{
                    background: !simWorld ? '#1a1a1a' : '#1a2a4a',
                    borderColor: !simWorld ? '#333 #111 #111 #333' : '#3a6aaa #0a1a3a #0a1a3a #3a6aaa',
                  }}>
            💾 Init
          </button>
          <button onClick={handleSimClear} disabled={!checkpoint}
                  className="mc-btn text-xs px-3 h-8 font-mono"
                  style={{
                    background: !checkpoint ? '#1a1a1a' : '#2a1a10',
                    borderColor: !checkpoint ? '#333 #111 #111 #333' : '#aa5522 #3a1a08 #3a1a08 #aa5522',
                  }}>
            ↩ Reset
          </button>
        </div>

        {/* 手動トリガパネル (レバー/感圧板/ターゲット。ON 表示は world から導出) */}
        {triggers.length > 0 && (
          <div className="shrink-0 flex items-center gap-1.5 px-2 py-2 overflow-x-auto"
               style={{ background: '#1a1a1a', borderBottom: '2px solid #2a2a2a', scrollbarWidth: 'none' }}>
            <span className="font-pixel shrink-0 mr-1" style={{ fontSize: 12, color: '#555' }}>TRIG</span>
            {triggers.map(({ pos: [x, y, z], type }) => {
              const b = simWorld?.getBlockAt([x, y, z])
              const on = b ? isTriggerOn(b) : false
              const abbr = TRIGGER_META[type]?.abbr ?? '?'
              return (
                <button key={`${x},${y},${z}`} onClick={() => handleTrigger(x, y, z)} disabled={!simWorld}
                        data-testid={`trigger-${x}-${y}-${z}`}
                        title={TRIGGER_META[type]?.log}
                        className="mc-btn shrink-0 h-10 px-3 flex items-center gap-2"
                        style={{
                          background: on ? '#7a4400' : '#2a2a2a',
                          borderColor: on ? '#cc8800 #553300 #553300 #cc8800' : '#555 #222 #222 #555',
                          opacity: !simWorld ? 0.4 : 1,
                        }}>
                  {/* LED */}
                  <span style={{
                    display: 'inline-block', width: 10, height: 10, borderRadius: '50%',
                    background: on ? '#ffcc00' : '#333',
                    boxShadow: on ? '0 0 8px #ffaa00, 0 0 2px #ff8800' : 'none',
                    border: `1px solid ${on ? '#ff9900' : '#222'}`,
                    transition: 'all 0.15s',
                  }} />
                  <span className="font-mono text-xs" style={{ color: on ? '#ffcc00' : '#666' }}>
                    {abbr} {x},{y},{z}
                  </span>
                </button>
              )
            })}
            {triggers.filter(t => t.type === 'lever').length > 1 && (
              <>
                <div style={{ width: 1, alignSelf: 'stretch', background: '#333' }} />
                <button onClick={handleToggleLevers} disabled={!simWorld}
                        className="mc-btn shrink-0 h-10 px-3 text-xs font-mono">
                  全ON/OFF
                </button>
              </>
            )}
          </div>
        )}

        {/* 3D ビュー */}
        <div className="flex-1 min-h-0 relative">
          <IsometricView
            snapshot={snapshot}
            topDown={false}
            placementY={activeLayer}
            onBlockClick={handleBlockClick}
          />
          {running && (
            <div className="rs-border-pulse" style={{
              position: 'absolute', inset: 0, pointerEvents: 'none',
            }} />
          )}
        </div>

        {/* ログパネル */}
        <div className="shrink-0 px-3 py-1.5 overflow-y-auto"
             style={{ background: '#0d0d0d', borderTop: '2px solid #2a2a2a', maxHeight: 72, scrollbarWidth: 'thin', scrollbarColor: '#2a2a2a transparent' }}>
          {log.slice(-6).map((l, i) => (
            <div key={i} className="font-mono" style={{ fontSize: 11, color: '#4a4a4a', lineHeight: '18px' }}>{l}</div>
          ))}
        </div>
      </div>
    )
  }

  // ── 編集モード ──────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full select-none" style={{ background: '#141414', color: '#f0f0f0' }}>

      {/* トップバー */}
      <div className="shrink-0 flex items-center gap-1 px-2 py-2" style={{ background: '#2d2d2d', borderBottom: '2px solid #444' }}>
        {onBack && (
          <button onClick={onBack} className="mc-btn w-10 h-10 text-lg">←</button>
        )}

        {/* EDIT バッジ */}
        <div className="h-10 flex items-center px-2 mx-1" style={{ background: '#1a1a1a', border: '2px solid #333' }}>
          <span className="font-pixel" style={{ fontSize: 14, color: '#ff4444', letterSpacing: 3 }}>EDIT</span>
        </div>

        <button onClick={handleUndo} disabled={!editorRef.current.canUndo()} title="元に戻す"
                className="mc-btn w-10 h-10 text-base">↩</button>
        <button onClick={handleRedo} disabled={!editorRef.current.canRedo()} title="やり直し"
                className="mc-btn w-10 h-10 text-base">↪</button>

        {/* ⋯ サブメニュー */}
        <div className="relative">
          <button onClick={() => setShowMenu(m => !m)} data-testid="btn-menu" className="mc-btn w-10 h-10 text-lg">⋯</button>
          {showMenu && (
            <div className="absolute left-0 top-full mt-1 z-50 flex flex-col py-1"
                 style={{ background: '#2d2d2d', border: '2px solid #555', minWidth: 164 }}>
              <McMenuBtn onClick={() => { handleClear(); setShowMenu(false) }} danger testid="menu-clear">クリア</McMenuBtn>
              <McMenuBtn onClick={() => { handleExportNbt(); setShowMenu(false) }} testid="menu-nbt-save">↓ NBT 保存</McMenuBtn>
              <McMenuBtn onClick={() => { importInputRef.current?.click(); setShowMenu(false) }} testid="menu-nbt-load">↑ NBT 読込</McMenuBtn>
            </div>
          )}
        </div>

        <input ref={importInputRef} type="file" accept=".nbt,.litematic,.schem" className="hidden"
          data-testid="nbt-file-input"
          onChange={e => { const f = e.target.files?.[0]; if (f) { handleImportNbt(f); e.target.value = '' } }} />

        <div className="flex-1" />

        <button onClick={handleStart} data-testid="btn-start"
                className="mc-btn h-10 px-4 font-pixel"
                style={{ background: '#1a4a1a', borderColor: '#4a8a4a #0a2a0a #0a2a0a #4a8a4a', fontSize: 15, letterSpacing: 2 }}>
          ▶ START
        </button>
      </div>

      {/* IsometricView（2D） */}
      <div className="flex-1 min-h-0" style={{ position: 'relative' }}>
        <IsometricView
          snapshot={snapshot}
          topDown={true}
          placementY={activeLayer}
          onBlockClick={selectedType === 'move' ? undefined : handleBlockClick}
          cameraStateRef={cameraStateRef}
          panMode={selectedType === 'move'}
        />
        <canvas
          ref={gridCanvasRef}
          style={{
            position: 'absolute', top: 0, left: 0,
            width: '100%', height: '100%',
            pointerEvents: 'none',
          }}
        />

        {/* 高さ操作パネル */}
        <HeightPanel
          activeLayer={activeLayer}
          layerCounts={layerCounts}
          cutUpper={cutUpper}
          onChangeLayer={changeLayer}
          onToggleCutUpper={() => setCutUpper(v => !v)}
        />
      </div>

      {/* 向き・遅延・モードバー */}
      {showFacingBar && (
        <FacingBar
          gridBlock={gridBlock}
          gridBlockHasFacing={gridBlockHasFacing}
          selectedType={selectedType}
          selectedPos={selectedPos}
          activeLayer={activeLayer}
          barFacing={barFacing}
          barDelay={barDelay}
          barMode={barMode}
          barPressedPower={barPressedPower}
          barSignal={barSignal}
          barCount={barCount}
          onFacingChange={handleFacingChange}
          onDelayChange={handleDelayChange}
          onModeChange={handleModeChange}
          onPressedPowerChange={handlePressedPowerChange}
          onSignalChange={handleSignalChange}
          onCountChange={handleCountChange}
        />
      )}

      {/* パレット */}
      <EditorPalette selected={selectedType} onSelect={handleSelectType} />

      {/* ログバー */}
      <div className="shrink-0 flex items-center gap-3 px-3 py-1 overflow-x-auto"
           style={{ background: '#0d0d0d', borderTop: '2px solid #1e1e1e', scrollbarWidth: 'none', minHeight: 26 }}>
        {log.slice(-3).map((l, i) => (
          <span key={i} className="font-mono shrink-0" style={{ fontSize: 11, color: '#3a3a3a' }}>{l}</span>
        ))}
      </div>
    </div>
  )
}

// ── FacingBar ────────────────────────────────────────────────────────────────

interface FacingBarProps {
  gridBlock:          ReturnType<CircuitEditor['getBlock']>
  gridBlockHasFacing: boolean
  selectedType:       PaletteType
  selectedPos:        [number, number] | null
  activeLayer:        number
  barFacing:          HDir
  barDelay:           1 | 2 | 3 | 4
  barMode:            'compare' | 'subtract'
  barPressedPower:    number
  barSignal:          number
  barCount:           number
  onFacingChange:     (f: HDir) => void
  onDelayChange:      (d: 1 | 2 | 3 | 4) => void
  onModeChange:       (m: 'compare' | 'subtract') => void
  onPressedPowerChange: (p: number) => void
  onSignalChange:     (s: number) => void
  onCountChange:      (c: number) => void
}

function FacingBar({
  gridBlock, gridBlockHasFacing, selectedType, selectedPos, activeLayer,
  barFacing, barDelay, barMode, barPressedPower, barSignal, barCount,
  onFacingChange, onDelayChange, onModeChange, onPressedPowerChange, onSignalChange, onCountChange,
}: FacingBarProps) {
  const meta = BLOCK_PALETTE.find(b => b.type === selectedType)

  const showFacing = !!(meta?.hasFacing) || gridBlockHasFacing
  const showDelay  = !!(meta?.hasDelay)  || gridBlock?.type === 'repeater'
  const showMode   = !!(meta?.hasMode)   || gridBlock?.type === 'comparator'
  const showPressedPower = !!(meta?.hasPressedPower) ||
    gridBlock?.type === 'weighted_pressure_plate_light' ||
    gridBlock?.type === 'weighted_pressure_plate_heavy'
  const showSignal = !!(meta?.hasSignal) || gridBlock?.type === 'container'
  const showCount = !!(meta?.hasCount) ||
    gridBlock?.type === 'hopper' || gridBlock?.type === 'dropper'
  const countMax = (gridBlock?.type === 'dropper' || selectedType === 'dropper') ? 576 : 320

  const label = selectedPos
    ? `(${selectedPos[0]}, ${selectedPos[1]}) Y=${activeLayer}`
    : `次の配置 Y=${activeLayer}`

  const dirLabel: Record<HDir, string> = { north: '北', south: '南', east: '東', west: '西' }

  return (
    <div className="shrink-0 flex items-center gap-5 px-4 py-2"
         style={{ background: '#1e1e1e', borderTop: '2px solid #3a3a3a' }}>
      {/* D-pad */}
      {showFacing && (
        <div className="grid grid-cols-3 shrink-0" style={{ gap: 3 }}>
          <div />
          <DPadBtn active={barFacing === 'north'} onClick={() => onFacingChange('north')}>↑</DPadBtn>
          <div />
          <DPadBtn active={barFacing === 'west'}  onClick={() => onFacingChange('west')}>←</DPadBtn>
          {/* 中央：現在の向き */}
          <div className="w-10 h-10 flex items-center justify-center font-pixel"
               style={{ background: '#111', border: '2px solid', borderColor: '#1c1c1c #5a5a5a #5a5a5a #1c1c1c', fontSize: 14, color: '#ff4444', userSelect: 'none' }}>
            {dirLabel[barFacing]}
          </div>
          <DPadBtn active={barFacing === 'east'}  onClick={() => onFacingChange('east')}>→</DPadBtn>
          <div />
          <DPadBtn active={barFacing === 'south'} onClick={() => onFacingChange('south')}>↓</DPadBtn>
          <div />
        </div>
      )}

      {showFacing && (showDelay || showMode) && (
        <div style={{ width: 1, alignSelf: 'stretch', background: '#3a3a3a' }} />
      )}

      {/* モード（コンパレーター） */}
      {showMode && (
        <div className="flex flex-col gap-1.5 shrink-0">
          <span className="font-pixel text-center" style={{ fontSize: 11, color: '#555' }}>MODE</span>
          <div className="flex gap-1">
            {(['compare', 'subtract'] as const).map(m => (
              <button key={m} onClick={() => onModeChange(m)}
                      className="mc-btn px-3 h-10 font-pixel text-xs"
                      style={{
                        background: barMode === m ? '#6b0000' : '#3a3a3a',
                        borderColor: barMode === m
                          ? '#ff4444 #440000 #440000 #ff4444'
                          : '#666 #222 #222 #666',
                        color: barMode === m ? '#ff8888' : '#aaa',
                        boxShadow: barMode === m ? '0 0 8px #cc2222' : 'none',
                      }}>
                {m === 'compare' ? '比較' : '差引'}
              </button>
            ))}
          </div>
        </div>
      )}

      {showMode && showDelay && (
        <div style={{ width: 1, alignSelf: 'stretch', background: '#3a3a3a' }} />
      )}

      {/* 遅延 */}
      {showDelay && (
        <div className="flex flex-col gap-1.5 shrink-0">
          <span className="font-pixel text-center" style={{ fontSize: 11, color: '#555' }}>DELAY</span>
          <div className="flex gap-1">
            {([1, 2, 3, 4] as const).map(d => (
              <button key={d} onClick={() => onDelayChange(d)}
                      className="mc-btn w-10 h-10 font-bold text-sm"
                      style={{
                        background: barDelay === d ? '#6b0000' : '#3a3a3a',
                        borderColor: barDelay === d
                          ? '#ff4444 #440000 #440000 #ff4444'
                          : '#666 #222 #222 #666',
                        color: barDelay === d ? '#ff8888' : '#aaa',
                        boxShadow: barDelay === d ? '0 0 8px #cc2222' : 'none',
                      }}>
                {d}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 踏まれ信号（重量感圧板 1-15） */}
      {showPressedPower && (
        <PowerSelect label="POWER" min={1} max={15} value={barPressedPower} onChange={onPressedPowerChange} />
      )}

      {/* 背面読み信号（コンテナ 0-15） */}
      {showSignal && (
        <PowerSelect label="SIGNAL" min={0} max={15} value={barSignal} onChange={onSignalChange} />
      )}

      {/* 内容個数（ホッパー/ドロッパー #65。範囲が広いため数値入力） */}
      {showCount && (
        <CountInput label="個数" max={countMax} value={barCount} onChange={onCountChange} />
      )}

      <div className="flex-1" />
      <span className="font-pixel shrink-0" style={{ fontSize: 11, color: '#444' }}>{label}</span>
    </div>
  )
}

// ── EditorPalette ─────────────────────────────────────────────────────────────

function EditorPalette({ selected, onSelect }: {
  selected:  PaletteType
  onSelect:  (type: PaletteType) => void
}) {
  return (
    <div className="shrink-0 flex justify-center py-2 px-2"
         style={{ background: '#111', borderTop: '2px solid #2a2a2a' }}>
      {/* ホットバー外枠 */}
      <div className="flex gap-0.5 overflow-x-auto"
           style={{ scrollbarWidth: 'none', background: '#373737', padding: 3, border: '2px solid #555' }}>
        {BLOCK_PALETTE.map(({ type, label, texture, cssFilter }) => {
          const isSelected = type === selected
          const isEraser   = type === 'eraser'
          return (
            <button
              key={type}
              onClick={() => onSelect(type)}
              title={label}
              data-testid={`palette-${type}`}
              className="mc-slot shrink-0 flex flex-col items-center justify-center"
              style={{
                width: 58, height: 66, padding: '4px 2px 2px',
                gap: 2,
                background: isSelected ? (isEraser ? '#2a0a0a' : '#1a1a00') : '#1a1a1a',
                borderColor: isSelected
                  ? (isEraser ? '#ff4444 #880000 #880000 #ff4444' : '#ffffff #888 #888 #ffffff')
                  : '#1c1c1c #7d7d7d #7d7d7d #1c1c1c',
                boxShadow: isSelected
                  ? `0 0 10px ${isEraser ? '#cc2222' : '#cccccc'}`
                  : 'none',
              }}
            >
              {type === 'move' ? (
                <svg width="40" height="40" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg"
                     style={{ width: 40, height: 40 }}>
                  <path d="M16 6 L16 20 M12 10 L12 20 M20 10 L20 20 M8 14 L8 22 C8 25 10 27 13 27 L19 27 C22 27 24 25 24 22 L24 14"
                        stroke={isSelected ? '#f0f0f0' : '#aaa'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <polyline points="16,2 14,5 18,5" fill={isSelected ? '#f0f0f0' : '#aaa'}/>
                  <polyline points="16,30 14,27 18,27" fill={isSelected ? '#f0f0f0' : '#aaa'}/>
                </svg>
              ) : isEraser ? (
                <div style={{ width: 40, height: 40, background: '#2a0a0a', border: '1px solid #551111', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ff4444', fontSize: 22, fontWeight: 'bold' }}>
                  ✕
                </div>
              ) : texture ? (
                <img
                  src={`${MCMETA_BASE}/textures/${texture}.png`}
                  alt={label}
                  width={40}
                  height={40}
                  style={{ width: 40, height: 40, imageRendering: 'pixelated', ...(cssFilter ? { filter: cssFilter } : {}) }}
                  onError={e => { (e.currentTarget as HTMLImageElement).src = PLACEHOLDER_IMG }}
                />
              ) : (
                <div style={{ width: 40, height: 40, background: '#2a2a2a' }} />
              )}
              <span className="font-pixel" style={{
                fontSize: 10,
                color: isSelected ? (isEraser ? '#ff8888' : '#ffee88') : '#888',
                lineHeight: '1.2',
                textAlign: 'center',
                width: '100%',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {label}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── HeightPanel ───────────────────────────────────────────────────────────────

interface HeightPanelProps {
  activeLayer:      number
  layerCounts:      number[]
  cutUpper:         boolean
  onChangeLayer:    (y: number) => void
  onToggleCutUpper: () => void
}

/**
 * 編集レイヤー (Y) の操作パネル。
 * ▲▼ で1段ずつ移動、レイヤーセル直接クリックでジャンプ、
 * 👁 で activeLayer より上のレイヤーの表示カットを切り替える。
 */
function HeightPanel({
  activeLayer, layerCounts, cutUpper, onChangeLayer, onToggleCutUpper,
}: HeightPanelProps) {
  const layers = Array.from({ length: layerCounts.length }, (_, i) => layerCounts.length - 1 - i)

  return (
    <div
      className="flex flex-col items-center"
      style={{
        position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
        gap: 4, zIndex: 10, padding: 4,
        background: 'rgba(29,29,29,0.92)', border: '2px solid #444',
      }}
    >
      <span className="font-pixel" style={{ fontSize: 10, color: '#666', letterSpacing: 1 }}>Y</span>

      {/* 1段上へ */}
      <button
        onClick={() => onChangeLayer(activeLayer + 1)}
        disabled={activeLayer >= layerCounts.length - 1}
        title="1つ上のレイヤーへ"
        className="mc-btn w-10 h-8 text-sm font-bold"
      >▲</button>

      {/* レイヤーセル（上=最上層） */}
      <div className="flex flex-col" style={{ gap: 2 }}>
        {layers.map(y => {
          const active = y === activeLayer
          const hasBlocks = layerCounts[y] > 0
          return (
            <button
              key={y}
              onClick={() => onChangeLayer(y)}
              title={`Y=${y}${hasBlocks ? `（${layerCounts[y]} ブロック）` : ''}`}
              className="flex items-center justify-between font-mono"
              style={{
                width: 40, height: 18, padding: '0 4px', fontSize: 10,
                background: active ? '#6b0000' : '#242424',
                border: '1px solid',
                borderColor: active ? '#ff4444' : '#3a3a3a',
                color: active ? '#ff9999' : hasBlocks ? '#bbb' : '#555',
                boxShadow: active ? '0 0 6px #cc2222' : 'none',
              }}
            >
              <span>{y}</span>
              <span style={{
                display: 'inline-block', width: 6, height: 6, borderRadius: '50%',
                background: hasBlocks ? (active ? '#ffcc00' : '#7a7a2a') : 'transparent',
                border: hasBlocks ? 'none' : '1px solid #333',
              }} />
            </button>
          )
        })}
      </div>

      {/* 1段下へ */}
      <button
        onClick={() => onChangeLayer(activeLayer - 1)}
        disabled={activeLayer <= 0}
        title="1つ下のレイヤーへ"
        className="mc-btn w-10 h-8 text-sm font-bold"
      >▼</button>

      {/* 現在レイヤー表示 */}
      <div
        className="w-10 h-8 flex items-center justify-center font-pixel"
        style={{
          background: '#111', border: '2px solid',
          borderColor: '#1c1c1c #5a5a5a #5a5a5a #1c1c1c',
          fontSize: 13, color: '#ff9900',
        }}
      >
        {activeLayer}
      </div>

      {/* 上層カットトグル */}
      <button
        onClick={onToggleCutUpper}
        title={cutUpper ? '上層カット中（クリックで全層表示）' : '全層表示中（クリックで上層カット）'}
        className="mc-btn w-10 h-8 text-sm"
        style={{
          background: cutUpper ? '#1a2a4a' : '#3a3a3a',
          borderColor: cutUpper ? '#3a6aaa #0a1a3a #0a1a3a #3a6aaa' : '#666 #222 #222 #666',
        }}
      >👁</button>
    </div>
  )
}

// ── PowerSelect ───────────────────────────────────────────────────────────────

/**
 * 信号強度セレクタ (DELAY バーと同型)。重量感圧板の踏まれ信号 (1-15) と
 * コンテナの背面読み信号 (0-15) に共用。値が多いので 8 列グリッドで折り返す。
 */
function PowerSelect({ label, min, max, value, onChange }: {
  label:    string
  min:      number
  max:      number
  value:    number
  onChange: (v: number) => void
}) {
  const values = Array.from({ length: max - min + 1 }, (_, i) => min + i)
  return (
    <div className="flex flex-col gap-1.5 shrink-0">
      <span className="font-pixel text-center" style={{ fontSize: 11, color: '#555' }}>{label}</span>
      <div className="grid grid-cols-8" style={{ gap: 3 }}>
        {values.map(v => {
          const active = value === v
          return (
            <button key={v} onClick={() => onChange(v)}
                    className="mc-btn font-bold"
                    style={{
                      width: 28, height: 28, fontSize: 12,
                      background: active ? '#6b0000' : '#3a3a3a',
                      borderColor: active
                        ? '#ff4444 #440000 #440000 #ff4444'
                        : '#666 #222 #222 #666',
                      color: active ? '#ff8888' : '#aaa',
                      boxShadow: active ? '0 0 8px #cc2222' : 'none',
                    }}>
              {v}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── CountInput ──────────────────────────────────────────────────────────────

/**
 * ホッパー/ドロッパーの内容個数入力 (#65)。値域が広い (0..576) ため
 * PowerSelect のボタングリッドではなく数値入力にする (SIGNAL セレクタの前例に倣い
 * ラベル + 入力を FacingBar に置く)。
 */
function CountInput({ label, max, value, onChange }: {
  label:    string
  max:      number
  value:    number
  onChange: (v: number) => void
}) {
  return (
    <div className="flex flex-col gap-1.5 shrink-0">
      <span className="font-pixel text-center" style={{ fontSize: 11, color: '#555' }}>{label}</span>
      <input
        type="number" min={0} max={max} value={value}
        onChange={e => {
          const n = Math.max(0, Math.min(max, Math.floor(Number(e.target.value) || 0)))
          onChange(n)
        }}
        className="mc-btn font-bold text-center"
        style={{
          width: 72, height: 28, fontSize: 12,
          background: '#3a3a3a', color: '#ddd',
          borderColor: '#666 #222 #222 #666',
        }}
      />
    </div>
  )
}

// ── DPadBtn ───────────────────────────────────────────────────────────────────

function DPadBtn({ active, onClick, children }: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className="mc-btn w-10 h-10 font-bold text-base"
      style={{
        background: active ? '#6b0000' : '#3a3a3a',
        borderColor: active
          ? '#ff4444 #440000 #440000 #ff4444'
          : '#666 #222 #222 #666',
        color: active ? '#ff9999' : '#999',
        boxShadow: active ? '0 0 8px #cc2222' : 'none',
      }}
    >
      {children}
    </button>
  )
}

// ── McMenuBtn ─────────────────────────────────────────────────────────────────

function McMenuBtn({ onClick, danger, testid, children }: {
  onClick: () => void
  danger?: boolean
  testid?: string
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      data-testid={testid}
      className="w-full text-left px-4 py-2.5 font-mono text-sm"
      style={{ color: danger ? '#ff8888' : '#d0d0d0' }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = danger ? '#4a1010' : '#3a3a3a' }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
    >
      {children}
    </button>
  )
}
