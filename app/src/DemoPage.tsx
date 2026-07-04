/**
 * fixture 再生デモ (`?demo=<fixture名>`) — issue #70
 *
 * 実機検証済み fixture (blocks/inputs/ticks) をそのまま回路として自動構築し、
 * tick を 1 コマずつ進めて 3D ビューに再生する。tick 意味論は fixture-runner と
 * 同一 (state[t] = ST フェーズ完了後 + inputs[t] 適用直後) — 共通ドライバ
 * @redstone/sim の FixtureRunner を使うことで CI 回帰と系列が bit-identical になる。
 *
 * `window.__demo` (CLI / E2E から操作):
 *   - ready:  Promise      … ビューア初期描画完了で resolve
 *   - load(nameOrJson)     … 別 fixture を読み込む
 *   - step(): {tick}       … 1 tick 進めて入力適用
 *   - getTick(): number
 *   - getStateAt(x,y,z): string   … 正規化 blockstate ('air' 含む)
 *   - fitCamera(): void    … region bounds から距離/回転を自動設定
 *   - getFixtureName / getMaxTicks / isDone
 *
 * デモ領域コンテナに data-testid="demo-canvas" を付与し、HUD ごと screenshot
 * できるようにする (GIF 映え用)。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { IsometricView } from '@redstone/viewer'
import type { CameraInput } from '@redstone/viewer'
import { FixtureRunner } from '@redstone/sim'
import type { Fixture, WorldSnapshot, NotePlayEvent } from '@redstone/sim'
import { resolveFixture, FIXTURE_NAMES } from './demo/fixtures'

// GIF フレームの解像度を決めるデモ領域の固定サイズ (4:3)。
const DEMO_W = 720
const DEMO_H = 540

export interface DemoApi {
  ready: Promise<void>
  load: (nameOrJson: string | Fixture) => boolean
  step: () => { tick: number }
  getTick: () => number
  getStateAt: (x: number, y: number, z: number) => string
  fitCamera: () => void
  getFixtureName: () => string
  getMaxTicks: () => number
  isDone: () => boolean
}

declare global {
  interface Window {
    __demo?: DemoApi
  }
}

const EMPTY_SNAPSHOT: WorldSnapshot = {
  blocks: new Map(),
  bounds: { x: [0, 0], y: [0, 0], z: [0, 0] },
}

export function DemoPage({ fixtureName }: { fixtureName: string }) {
  const runnerRef = useRef<FixtureRunner | null>(null)
  const [fixture, setFixture] = useState<Fixture | null>(null)
  const [tick, setTick] = useState(0)
  const [lastEvent, setLastEvent] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  // fixture 差し替え時に IsometricView を作り直すためのキー
  const [reloadKey, setReloadKey] = useState(0)

  const cameraInputRef = useRef<CameraInput | null>(null)

  // ready Promise はマウント同期で 1 度だけ作る (window.__demo.ready が参照)
  const readyResolveRef = useRef<(() => void) | null>(null)
  const readyPromiseRef = useRef<Promise<void> | null>(null)
  if (!readyPromiseRef.current) {
    readyPromiseRef.current = new Promise<void>(res => { readyResolveRef.current = res })
  }

  const noteHandler = useCallback((e: NotePlayEvent) => {
    setLastEvent(`♪ note=${e.note} @ (${e.pos.join(',')})`)
  }, [])

  const loadFixture = useCallback((nameOrJson: string | Fixture): boolean => {
    const fx = resolveFixture(nameOrJson)
    if (!fx) {
      const label = typeof nameOrJson === 'string' ? nameOrJson : '(json)'
      setError(`fixture 未検出: ${label}`)
      return false
    }
    runnerRef.current = new FixtureRunner(fx, { onNotePlay: noteHandler })
    setFixture(fx)
    setTick(0)
    setError(null)
    setLastEvent(fx.inputs.some(i => i.tick === 0) ? '入力適用 (t=0)' : '起点 (t=0)')
    setReloadKey(k => k + 1)
    return true
  }, [noteHandler])

  const fitCamera = useCallback(() => {
    const fx = runnerRef.current?.fixture
    if (!fx) return
    const sx = fx.region.to[0] - fx.region.from[0] + 1
    const sy = fx.region.to[1] - fx.region.from[1] + 1
    const sz = fx.region.to[2] - fx.region.from[2] + 1
    // rotX=45,rotY=45 の等角ビューで回路全体が収まる距離。70°FOV では距離 d の
    // 中心面で高さ約 1.4d が見える。水平は回転で対角 hypot(sx,sz)、縦は sy を見て
    // 大きい方に合わせ、キャンバスの ~7 割を占めるよう係数を詰める。
    const distance = Math.max(Math.hypot(sx, sz) * 0.72, sy * 1.7) + 2.5
    cameraInputRef.current = { distance, panX: 0, panZ: 0, rotX: 45, rotY: 45 }
  }, [])

  const step = useCallback((): { tick: number } => {
    const r = runnerRef.current
    if (!r) return { tick: 0 }
    const { tick: t, inputs } = r.step()
    setTick(t)
    if (inputs.length > 0) {
      setLastEvent(`入力: activate ${inputs.map(i => `(${i.pos.join(',')})`).join(' ')}`)
    }
    return { tick: t }
  }, [])

  // 初期ロード
  useEffect(() => {
    loadFixture(fixtureName)
  }, [fixtureName, loadFixture])

  // window.__demo 公開
  useEffect(() => {
    const api: DemoApi = {
      ready: readyPromiseRef.current!,
      load: (n) => loadFixture(n),
      step,
      getTick: () => runnerRef.current?.tick ?? 0,
      getStateAt: (x, y, z) => runnerRef.current?.getStateAt(x, y, z) ?? 'air',
      fitCamera,
      getFixtureName: () => runnerRef.current?.fixture.name ?? '',
      getMaxTicks: () => runnerRef.current?.maxTicks ?? 0,
      isDone: () => runnerRef.current?.done ?? true,
    }
    window.__demo = api
    return () => { delete window.__demo }
  }, [loadFixture, step, fitCamera])

  const onViewerReady = useCallback(() => {
    setReady(true)
    fitCamera()
    readyResolveRef.current?.()
  }, [fitCamera])

  const snapshot: WorldSnapshot = fixture && runnerRef.current
    ? runnerRef.current.worldSnapshot()
    : EMPTY_SNAPSHOT

  if (error) {
    return (
      <div style={{
        width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: 12,
        background: '#141414', color: '#f0f0f0',
      }}>
        <div className="font-pixel" style={{ color: '#ff6666', fontSize: 18 }}>{error}</div>
        <div className="font-mono" style={{ color: '#888', fontSize: 12 }}>
          利用可能: {FIXTURE_NAMES.join(', ')}
        </div>
      </div>
    )
  }

  return (
    <div style={{
      width: '100%', height: '100%', display: 'flex',
      alignItems: 'center', justifyContent: 'center',
      background: '#0d0d0d',
    }}>
      <div
        data-testid="demo-canvas"
        data-demo-ready={ready ? 'true' : 'false'}
        data-demo-tick={tick}
        data-demo-fixture={fixture?.name ?? ''}
        style={{
          position: 'relative', width: DEMO_W, height: DEMO_H,
          background: '#141414', border: '2px solid #333', overflow: 'hidden',
        }}
      >
        {/* 3D 等角ビュー */}
        <div style={{ position: 'absolute', inset: 0 }}>
          <IsometricView
            key={reloadKey}
            snapshot={snapshot}
            topDown={false}
            cameraInputRef={cameraInputRef}
            onReady={onViewerReady}
          />
        </div>

        {/* HUD オーバーレイ */}
        <DemoHud
          fixtureName={fixture?.name ?? fixtureName}
          tick={tick}
          maxTicks={fixture?.ticks ?? 0}
          lastEvent={lastEvent}
        />
      </div>
    </div>
  )
}

// ── HUD ───────────────────────────────────────────────────────────────────────

function DemoHud({ fixtureName, tick, maxTicks, lastEvent }: {
  fixtureName: string
  tick: number
  maxTicks: number
  lastEvent: string
}) {
  return (
    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, pointerEvents: 'none' }}>
      {/* トップバー: fixture 名 + TICK カウンタ */}
      <div className="flex items-center gap-3 px-3 py-2" style={{
        background: 'linear-gradient(#1a1a1add, #1a1a1a99)',
        borderBottom: '1px solid #2a2a2a',
      }}>
        <span className="font-pixel" style={{ fontSize: 13, color: '#ff4444', letterSpacing: 2 }}>DEMO</span>
        <span className="font-mono" style={{ fontSize: 12, color: '#cfcfcf' }}>{fixtureName}</span>
        <div style={{ flex: 1 }} />
        <span className="font-pixel" style={{ fontSize: 10, color: '#666', letterSpacing: 2 }}>TICK</span>
        <span className="font-pixel" style={{
          fontSize: 18, color: '#ff9900', letterSpacing: 3, textShadow: '0 0 10px #cc6600',
        }}>
          {String(tick).padStart(3, '0')}
          <span style={{ fontSize: 11, color: '#7a5a20' }}> / {String(maxTicks).padStart(3, '0')}</span>
        </span>
      </div>

      {/* 直近イベント 1 行 */}
      {lastEvent && (
        <div className="font-mono px-3 py-1" style={{
          fontSize: 11, color: '#ffcc66',
          background: '#0d0d0daa', display: 'inline-block',
        }}>
          {lastEvent}
        </div>
      )}
    </div>
  )
}
