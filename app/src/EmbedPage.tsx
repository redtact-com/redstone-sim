/**
 * 埋め込みプレイヤー (`?embed=1`) — issue #97 / docs/research/14 §5
 *
 * redtact 等の外部ページに iframe 埋め込みし、共有回路をブラウザ内で動かすための
 * 閲覧専用/操作可能プレイヤー。EditorPage の編集機能を持たず、再生コントロールと
 * (interact モードでの) 手動トリガのみを提供する。回路の受け渡しと再生制御は
 * postMessage プロトコル v1 (embed/protocol.ts) で親ページと行う。
 *
 * モード:
 *  - view (既定)  : 盤面 + 再生/一時停止/1tick/リセット。編集・トリガ不可
 *  - interact     : view + レバー/ボタン/感圧板等の手動トリガのみ可
 *
 * 親との連携なしでも「rdsim で開く」導線から本体エディタへ遷移できる。
 * E2E 用に window.__embed を公開する (postMessage 経路の状態を読むため)。
 *
 * sim の駆動: load/reset は新しい world を setSimWorld で差し替え、tick/trigger は
 * 同一 world を破壊的に進めて setTick / rerender で反映する (EditorPage と同方針)。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { CircuitEditor } from '@redstone/editor'
import { SimWorld } from '@redstone/sim'
import type { WorldSnapshot, BlockState, Pos3D } from '@redstone/sim'
import { IsometricView } from '@redstone/viewer'
import type { CameraInput } from '@redstone/viewer'
import { importFromNbtBytes } from './nbtIO'
import type { EmbedMode } from './embed/embedTypes'
import {
  parseInbound, buildAllowedOrigins, isOriginAllowed,
  type InboundMessage, type OutboundMessage, type EmbedErrorCode,
} from './embed/protocol'

const GRID_W = 16
const GRID_H = 16
const GRID_LAYERS = 8

/** interact モードで手動トリガできる素子と表示略号 */
const TRIGGER_META: Record<string, { abbr: string }> = {
  lever: { abbr: 'Le' },
  button_stone: { abbr: 'Bu' },
  button_wood: { abbr: 'Bu' },
  pressure_plate_wood: { abbr: 'Pp' },
  pressure_plate_stone: { abbr: 'Pp' },
  weighted_pressure_plate_light: { abbr: 'Wp' },
  weighted_pressure_plate_heavy: { abbr: 'Wp' },
  target: { abbr: 'Tg' },
}
const TRIGGER_TYPES = new Set(Object.keys(TRIGGER_META))

function isTriggerOn(b: { type: string; powered?: boolean; outputPower?: number }): boolean {
  if (b.type === 'target') return (b.outputPower ?? 0) > 0
  return b.powered ?? false
}

interface TriggerEntry { pos: [number, number, number]; type: string }

const GRID_BOUNDS: WorldSnapshot['bounds'] = {
  x: [0, GRID_W - 1], y: [0, GRID_LAYERS - 1], z: [0, GRID_H - 1],
}
const EMPTY_SNAPSHOT: WorldSnapshot = { blocks: new Map(), bounds: GRID_BOUNDS }

export interface EmbedApi {
  getTick: () => number
  getMode: () => EmbedMode
  isLoaded: () => boolean
  isRunning: () => boolean
  getWarnings: () => string[]
  getStateAt: (x: number, y: number, z: number) => BlockState | null
}

declare global {
  interface Window {
    __embed?: EmbedApi
  }
}

export function EmbedPage() {
  const editorRef = useRef(new CircuitEditor(0))

  const [simWorld, setSimWorld] = useState<SimWorld | null>(null)
  const [, forceUpdate] = useState(0)
  const rerender = useCallback(() => forceUpdate((n) => n + 1), [])

  const [tick, setTick] = useState(0)
  const [running, setRunning] = useState(false)
  const [mode, setMode] = useState<EmbedMode>('view')
  const [loaded, setLoaded] = useState(false)
  const [warnings, setWarnings] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [triggers, setTriggers] = useState<TriggerEntry[]>([])
  const [reloadKey, setReloadKey] = useState(0)

  const cameraInputRef = useRef<CameraInput | null>(null)

  // ── 親への送信 (target origin 固定。未確定時のみ '*' = ready 用) ──────────
  const trustedOriginRef = useRef<string | null>(null)
  const postToParent = useCallback((msg: OutboundMessage) => {
    if (typeof window === 'undefined' || !window.parent) return
    window.parent.postMessage(msg, trustedOriginRef.current ?? '*')
  }, [])

  const emitError = useCallback((code: EmbedErrorCode, message: string) => {
    setError(message)
    postToParent({ v: 1, type: 'rdsim:error', code, message })
  }, [postToParent])

  // ── トリガ素子スキャン ────────────────────────────────────────────────
  const scanTriggers = useCallback((): TriggerEntry[] => {
    const found: TriggerEntry[] = []
    for (const [key, block] of editorRef.current.getAllBlocks()) {
      if (!TRIGGER_TYPES.has(block.type)) continue
      const [x, y, z] = key.split(',').map(Number)
      found.push({ pos: [x, y, z], type: block.type })
    }
    return found.sort((a, b) => a.pos[1] - b.pos[1] || a.pos[2] - b.pos[2] || a.pos[0] - b.pos[0])
  }, [])

  // ── カメラフィット (loaded size から距離を決める) ──────────────────────
  const fitCamera = useCallback((size: [number, number, number]) => {
    const [sx, sy, sz] = size
    const distance = Math.max(Math.hypot(sx, sz) * 0.72, sy * 1.7) + 3
    cameraInputRef.current = { distance, panX: 0, panZ: 0, rotX: 40, rotY: 45 }
  }, [])

  // ── 回路ロード ─────────────────────────────────────────────────────────
  const loadCircuit = useCallback((bytes: Uint8Array) => {
    let result
    try {
      result = importFromNbtBytes(bytes, { gridW: GRID_W, gridH: GRID_H, maxLayers: GRID_LAYERS })
    } catch (e) {
      emitError('parse-error', e instanceof Error ? e.message : String(e))
      return
    }
    const { blocks, warnings: warns, size } = result
    if (blocks.size === 0) {
      setWarnings(warns)
      emitError('empty', '取り込めるブロックがありません')
      return
    }
    editorRef.current.resetToBlocks(blocks)
    const world = editorRef.current.buildSimWorld()
    world.initialize()
    setSimWorld(world)
    setTick(0)
    setRunning(false)
    setTriggers(scanTriggers())
    setWarnings(warns)
    setError(null)
    setLoaded(true)
    fitCamera(size)
    setReloadKey((k) => k + 1)
    postToParent({ v: 1, type: 'rdsim:loaded', size, warnings: warns })
  }, [emitError, scanTriggers, fitCamera, postToParent])

  // ── 再生制御 ──────────────────────────────────────────────────────────
  const doStep = useCallback((n = 1) => {
    if (!simWorld) return
    let t = 0
    for (let i = 0; i < n; i++) t = simWorld.tick().currentTick
    setTick(t)
    rerender()
    postToParent({ v: 1, type: 'rdsim:tick', tick: t })
  }, [simWorld, rerender, postToParent])

  const doReset = useCallback(() => {
    if (!loaded) return // load 前の reset は無視 (空 world を作らない)
    setRunning(false)
    // editor は元の配置を保持しているので再ビルドで初期状態に戻す
    const world = editorRef.current.buildSimWorld()
    world.initialize()
    setSimWorld(world)
    setTick(0)
    setError(null)
    postToParent({ v: 1, type: 'rdsim:tick', tick: 0 })
  }, [loaded, postToParent])

  const doTrigger = useCallback((x: number, y: number, z: number) => {
    if (!simWorld) return
    const b = simWorld.getBlockAt([x, y, z])
    if (b && TRIGGER_TYPES.has(b.type)) {
      simWorld.activateBlock(x, y, z)
      rerender()
    }
  }, [simWorld, rerender])

  // ── 連続実行 (100ms/tick, rdsim spec) ──────────────────────────────────
  useEffect(() => {
    if (!running || !simWorld) return
    const id = setInterval(() => {
      const t = simWorld.tick().currentTick
      setTick(t)
      rerender()
      postToParent({ v: 1, type: 'rdsim:tick', tick: t })
    }, 100)
    return () => clearInterval(id)
  }, [running, simWorld, rerender, postToParent])

  // ── 盤面クリック (interact モードのトリガのみ) ─────────────────────────
  const handleBlockClick = useCallback((pos: Pos3D) => {
    if (mode !== 'interact') return
    doTrigger(pos[0], pos[1], pos[2])
  }, [mode, doTrigger])

  // ── postMessage 受信 + ready 送信 ──────────────────────────────────────
  // ハンドラは最新の action を ref 経由で参照 (stale closure 回避)。
  // ref 更新は render 中でなく effect で行う (react-hooks/refs)。
  const actionsRef = useRef({ loadCircuit, doStep, doReset, doTrigger, setRunning, setMode })
  useEffect(() => {
    actionsRef.current = { loadCircuit, doStep, doReset, doTrigger, setRunning, setMode }
  }, [loadCircuit, doStep, doReset, doTrigger])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const allowed = buildAllowedOrigins(params.get('parentOrigin'))
    const firstParent = params.get('parentOrigin')?.split(',')[0]?.trim()
    if (firstParent) trustedOriginRef.current = firstParent

    const onMessage = (event: MessageEvent) => {
      if (event.source !== window.parent) return // 親以外は無視
      if (!isOriginAllowed(event.origin, allowed)) return
      const msg: InboundMessage | null = parseInbound(event.data)
      if (!msg) return
      trustedOriginRef.current = event.origin // 以降の送信先を確定
      const a = actionsRef.current
      switch (msg.type) {
        case 'rdsim:load': {
          const bytes = msg.bytes instanceof Uint8Array ? msg.bytes : new Uint8Array(msg.bytes)
          a.loadCircuit(bytes)
          break
        }
        case 'rdsim:step': a.doStep(msg.n ?? 1); break
        case 'rdsim:run': a.setRunning(true); break
        case 'rdsim:pause': a.setRunning(false); break
        case 'rdsim:reset': a.doReset(); break
        case 'rdsim:trigger': a.doTrigger(msg.x, msg.y, msg.z); break
        case 'rdsim:setMode': a.setMode(msg.mode); break
      }
    }
    window.addEventListener('message', onMessage)
    // リスナー確立後に ready を通知 (親はこれを待って load を送る)
    postToParent({ v: 1, type: 'rdsim:ready' })
    return () => window.removeEventListener('message', onMessage)
  }, [postToParent])

  // ── E2E 用フック ───────────────────────────────────────────────────────
  useEffect(() => {
    window.__embed = {
      getTick: () => tick,
      getMode: () => mode,
      isLoaded: () => loaded,
      isRunning: () => running,
      getWarnings: () => warnings,
      getStateAt: (x, y, z) => simWorld?.getBlockAt([x, y, z]) ?? null,
    }
    return () => { delete window.__embed }
  }, [tick, mode, loaded, running, warnings, simWorld])

  // ── スナップショット ───────────────────────────────────────────────────
  const snapshot: WorldSnapshot = simWorld
    ? { blocks: simWorld.snapshot().blocks, bounds: GRID_BOUNDS }
    : EMPTY_SNAPSHOT

  return (
    <div
      data-testid="embed-root"
      data-embed-mode={mode}
      data-embed-loaded={loaded ? 'true' : 'false'}
      data-embed-tick={tick}
      style={{
        width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
        background: '#141414', color: '#f0f0f0', userSelect: 'none',
      }}
    >
      {/* コントロールバー */}
      <div className="shrink-0 flex items-center gap-2 px-2 py-1.5"
           style={{ background: '#2d2d2d', borderBottom: '2px solid #444' }}>
        <span className="font-pixel" style={{ fontSize: 12, color: '#ff4444', letterSpacing: 2 }}>rdsim</span>

        {/* TICK */}
        <div className="flex items-center gap-1.5 px-2 h-8" style={{ background: '#1a1a1a', border: '2px solid #333' }}>
          <span className="font-pixel" style={{ fontSize: 9, color: '#666', letterSpacing: 1 }}>TICK</span>
          <span data-testid="embed-tick" className="font-pixel"
                style={{ fontSize: 15, color: '#ff9900', letterSpacing: 2, textShadow: '0 0 8px #cc6600' }}>
            {String(tick).padStart(4, '0')}
          </span>
        </div>

        <div className="flex-1" />

        {/* view / interact 切替 */}
        <div className="flex" style={{ border: '2px solid #333' }}>
          {(['view', 'interact'] as const).map((m) => (
            <button key={m} onClick={() => setMode(m)} data-testid={`embed-mode-${m}`}
                    className="font-pixel px-2 h-8 text-xs"
                    style={{
                      background: mode === m ? '#1a3a5a' : '#1a1a1a',
                      color: mode === m ? '#88bbff' : '#666',
                      letterSpacing: 1,
                    }}>
              {m === 'view' ? '閲覧' : '操作'}
            </button>
          ))}
        </div>

        {/* +1 / run / reset */}
        <button onClick={() => doStep(1)} disabled={running || !simWorld} data-testid="embed-tick-btn"
                className="mc-btn w-9 h-8 font-mono text-xs font-bold">+1</button>
        <button onClick={() => setRunning((r) => !r)} disabled={!simWorld} data-testid="embed-run-btn"
                className="mc-btn h-8 px-3 font-bold text-base"
                style={{
                  background: !simWorld ? '#2a2a2a' : running ? '#7a3300' : '#1a4a1a',
                  borderColor: !simWorld ? '#444 #222 #222 #444'
                    : running ? '#cc6600 #442200 #442200 #cc6600'
                    : '#4a8a4a #0a2a0a #0a2a0a #4a8a4a',
                }}>{running ? '⏸' : '▶'}</button>
        <button onClick={doReset} disabled={!simWorld} data-testid="embed-reset-btn"
                className="mc-btn h-8 px-2 font-mono text-xs">↩</button>
      </div>

      {/* interact モードのトリガパネル */}
      {mode === 'interact' && triggers.length > 0 && (
        <div className="shrink-0 flex items-center gap-1.5 px-2 py-1.5 overflow-x-auto"
             style={{ background: '#1a1a1a', borderBottom: '2px solid #2a2a2a', scrollbarWidth: 'none' }}>
          <span className="font-pixel shrink-0 mr-1" style={{ fontSize: 11, color: '#555' }}>TRIG</span>
          {triggers.map(({ pos: [x, y, z], type }) => {
            const b = simWorld?.getBlockAt([x, y, z])
            const on = b ? isTriggerOn(b) : false
            return (
              <button key={`${x},${y},${z}`} onClick={() => doTrigger(x, y, z)} disabled={!simWorld}
                      data-testid={`embed-trigger-${x}-${y}-${z}`}
                      className="mc-btn shrink-0 h-8 px-2 flex items-center gap-1.5"
                      style={{
                        background: on ? '#7a4400' : '#2a2a2a',
                        borderColor: on ? '#cc8800 #553300 #553300 #cc8800' : '#555 #222 #222 #555',
                      }}>
                <span style={{
                  display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
                  background: on ? '#ffcc00' : '#333',
                  boxShadow: on ? '0 0 6px #ffaa00' : 'none',
                }} />
                <span className="font-mono text-xs" style={{ color: on ? '#ffcc00' : '#666' }}>
                  {TRIGGER_META[type]?.abbr ?? '?'} {x},{y},{z}
                </span>
              </button>
            )
          })}
        </div>
      )}

      {/* 3D ビュー */}
      <div className="flex-1 min-h-0 relative">
        <IsometricView
          key={reloadKey}
          snapshot={snapshot}
          topDown={false}
          cameraInputRef={cameraInputRef}
          onBlockClick={mode === 'interact' ? handleBlockClick : undefined}
        />
        {!loaded && !error && (
          <div className="absolute inset-0 flex items-center justify-center font-mono"
               style={{ color: '#555', fontSize: 12 }}>
            回路を読み込み中…
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center font-mono text-center px-4"
               data-testid="embed-error" style={{ color: '#ff6666', fontSize: 13 }}>
            {error}
          </div>
        )}
      </div>

      {/* 警告 + 「rdsim で開く」 */}
      <div className="shrink-0 flex items-center gap-2 px-3 py-1"
           style={{ background: '#0d0d0d', borderTop: '2px solid #1e1e1e', minHeight: 24 }}>
        {warnings.length > 0 && (
          <span data-testid="embed-warnings" className="font-mono truncate"
                style={{ fontSize: 10, color: '#c89a3c' }} title={warnings.join(' / ')}>
            ⚠ {warnings.join(' / ')}
          </span>
        )}
        <div className="flex-1" />
        <a href={`${import.meta.env.BASE_URL}`} target="_blank" rel="noopener noreferrer"
           className="font-mono shrink-0" style={{ fontSize: 10, color: '#5b86b5', textDecoration: 'none' }}>
          rdsim で開く ↗
        </a>
      </div>
    </div>
  )
}
