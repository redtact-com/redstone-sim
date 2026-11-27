/**
 * FixtureViewer — fixture を記事の中で再生する (#434)。
 *
 * `IsometricView` (描く)・`FixtureRunner` (このエンジンで 1 tick ずつ進める)・`fitDistance` (寄り) を包む。
 *
 * - 3D と 2D は同じ canvas で `topDown` を切り替える (WebGL の文脈は 1 個のまま)。
 *   2D は snapshot を「y <= 層」で絞り、層の ± ボタンで上下する
 * - 操作は 再生 / 止める・1 tick 進む・最初へ・tick の表示
 * - 置いただけではページのスクロールを奪わない。枠をクリックすると操作できるようになり
 *   (ドラッグ・wheel・ピンチ)、Esc か外のクリックで戻る
 * - 止まっている間は描かない (`frameLoop="demand"`)
 * - 再生するのはこのエンジンの計算で、実機の記録ではない。枠にその 1 行を必ず出す
 *
 * 見た目は CSS のクラス (`fxv`・`fxv-frame`・`fxv-bar`・`fxv-note` ほか) で付ける。枠の高さだけは
 * ここで決める (IsometricView は親の大きさいっぱいに描くので、高さが無いと潰れる)。
 * 同じ部品で別の fixture を出す時は `key` を変えて作り直す。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { IsometricView } from '@redstone/viewer'
import type { CameraInput, IsometricViewHandle } from '@redstone/viewer'
import { FixtureRunner } from '@redstone/sim'
import type { Fixture } from '@redstone/sim'
import { FIXTURE_NOTE_ENGINE, FIXTURE_NOTE_ENTITIES, FIXTURE_NOTE_SKIP } from '../fixture-card.js'
import { clampLayer, fixtureFrame, sliceSnapshot, topDownDistance, topLayer } from './frame.js'

/** 1 tick の間隔の既定 (ms)。エディタと埋め込みのプレイヤーの連続実行と同じ */
export const FIXTURE_TICK_MS = 100

export interface FixtureViewerProps {
  /** 再生する fixture (`data/fixtures/<名前>.json` の中身) */
  fixture: Fixture
  /** リソースパックの基点 URL。省くと viewer の既定 (`/resourcepack`) */
  resourcePackUrl?: string
  /** skip つきの fixture の理由。渡すと「今のエンジンは実機と違う」と一緒に出す */
  skip?: string
  /** summon・item・kill を含む fixture。「エンティティは描かない」と出す */
  entities?: boolean
  /** 1 tick の間隔 (ms) */
  tickMs?: number
  /** 最初の絵が描けた時に 1 回呼ぶ */
  onReady?: () => void
}

const FRAME_STYLE: CSSProperties = { position: 'relative', width: '100%', aspectRatio: '16 / 10', maxHeight: '70vh', minHeight: 180 }

export function FixtureViewer({ fixture, resourcePackUrl, skip, entities, tickMs = FIXTURE_TICK_MS, onReady }: FixtureViewerProps) {
  // 最初の runner。作れない fixture は、理由を出して絵なしで枠だけ出す
  const [initial] = useState(() => {
    try { return { runner: new FixtureRunner(fixture), failure: null } } catch (e) { return { runner: null, failure: messageOf(e) } }
  })
  const runnerRef = useRef<FixtureRunner | null>(initial.runner)
  const [failure, setFailure] = useState<string | null>(initial.failure)

  const frame = useMemo(() => fixtureFrame(fixture.region), [fixture])
  const [snapshot, setSnapshot] = useState(() => initial.runner?.worldSnapshot() ?? null)
  const [tick, setTick] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [topDown, setTopDown] = useState(false)
  const [layer, setLayer] = useState(() => (snapshot ? topLayer(snapshot, frame) : frame.layers[1]))
  const [interactive, setInteractive] = useState(false)
  const [ready, setReady] = useState(false)

  const rootRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<IsometricViewHandle | null>(null)
  const cameraInputRef = useRef<CameraInput | null>(null)
  const onReadyRef = useRef(onReady)
  onReadyRef.current = onReady

  /** runner の今の状態を画面へ写す */
  const sync = useCallback((r: FixtureRunner) => {
    setTick(r.tick)
    setSnapshot(r.worldSnapshot())
  }, [])

  const step = useCallback((): boolean => {
    const r = runnerRef.current
    if (!r || r.done) return false
    try { r.step() } catch (e) {
      setFailure(messageOf(e))
      setPlaying(false)
      return false
    }
    sync(r)
    return !r.done
  }, [sync])

  const rewind = useCallback((): boolean => {
    try {
      runnerRef.current = new FixtureRunner(fixture)
    } catch (e) {
      setFailure(messageOf(e))
      return false
    }
    setFailure(null)
    sync(runnerRef.current)
    return true
  }, [fixture, sync])

  // 再生: 決まった間隔で 1 tick ずつ進め、最後の tick で止まる
  useEffect(() => {
    if (!playing) return
    const id = setInterval(() => { if (!step()) setPlaying(false) }, tickMs)
    return () => clearInterval(id)
  }, [playing, step, tickMs])

  const togglePlay = () => {
    if (playing) { setPlaying(false); return }
    // 最後まで行っていたら、最初から流し直す
    if (runnerRef.current?.done && !rewind()) return
    setPlaying(true)
  }

  /** カメラの寄りを決め直す (3D は領域の全体、2D は今の層の上の面) */
  const fit = (toTopDown: boolean, toLayer: number) => {
    const el = frameRef.current
    const aspect = el && el.clientHeight > 0 ? el.clientWidth / el.clientHeight : 1.6
    cameraInputRef.current = {
      distance: toTopDown ? topDownDistance(frame, toLayer, aspect) : fixtureFrame(fixture.region, aspect).distance,
    }
    viewRef.current?.invalidate()
  }
  const setView = (toTopDown: boolean) => {
    if (toTopDown === topDown) return
    setTopDown(toTopDown)
    fit(toTopDown, layer)
  }
  const moveLayer = (d: number) => setLayer(l => clampLayer(frame, l + d))

  // 操作できる間: Esc か外のクリックで戻す
  useEffect(() => {
    if (!interactive) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setInteractive(false) }
    const onDown = (e: PointerEvent) => {
      const root = rootRef.current
      if (root && e.target instanceof Node && !root.contains(e.target)) setInteractive(false)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onDown, true)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onDown, true)
    }
  }, [interactive])

  const shown = useMemo(
    () => (snapshot && topDown ? sliceSnapshot(snapshot, layer) : snapshot),
    [snapshot, topDown, layer],
  )
  const handleReady = useCallback(() => {
    setReady(true)
    onReadyRef.current?.()
  }, [])

  const maxTicks = fixture.ticks
  const done = tick >= maxTicks
  const [lo, hi] = frame.layers

  return (
    <div
      className="fxv" ref={rootRef}
      data-fxv={fixture.name} data-tick={tick} data-playing={playing ? 1 : 0} data-view={topDown ? '2d' : '3d'}
      data-layer={layer} data-interactive={interactive ? 1 : 0} data-ready={ready ? 1 : 0}
    >
      <div
        className="fxv-frame" ref={frameRef} style={FRAME_STYLE}
        onClick={() => setInteractive(true)}
      >
        {shown && (
          <IsometricView
            snapshot={shown}
            topDown={topDown}
            panMode={topDown}
            placementY={layer - lo}
            interactive={interactive}
            frameLoop="demand"
            resourcePackUrl={resourcePackUrl}
            viewRef={viewRef}
            cameraInputRef={cameraInputRef}
            onReady={handleReady}
          />
        )}
        <button
          type="button" className="fxv-grab" aria-pressed={interactive}
          onClick={e => { e.stopPropagation(); setInteractive(v => !v) }}
        >{interactive ? '操作中 (Esc で戻す)' : 'クリックで操作'}</button>
      </div>
      <div className="fxv-bar" role="group" aria-label={`${fixture.name} の再生`}>
        <button type="button" className="fxv-play" onClick={togglePlay} disabled={failure !== null}>{playing ? '止める' : '再生'}</button>
        <button type="button" className="fxv-step" onClick={() => { setPlaying(false); step() }} disabled={done || failure !== null}>1 tick 進む</button>
        <button type="button" className="fxv-rewind" onClick={() => { setPlaying(false); rewind() }} disabled={tick === 0 && failure === null}>最初へ</button>
        <output className="fxv-tick" aria-live="off">tick {tick} / {maxTicks}</output>
        <span className="fxv-views" role="group" aria-label="見え方">
          <button type="button" className="fxv-3d" aria-pressed={!topDown} onClick={() => setView(false)}>3D</button>
          <button type="button" className="fxv-2d" aria-pressed={topDown} onClick={() => setView(true)}>2D</button>
        </span>
        {topDown && (
          <span className="fxv-layers" role="group" aria-label="層">
            <button type="button" className="fxv-layer-down" aria-label="下の層へ" onClick={() => moveLayer(-1)} disabled={layer <= lo}>−</button>
            <output className="fxv-layer">層 y = {layer} ({layer - lo + 1} / {hi - lo + 1})</output>
            <button type="button" className="fxv-layer-up" aria-label="上の層へ" onClick={() => moveLayer(1)} disabled={layer >= hi}>+</button>
          </span>
        )}
      </div>
      <p className="fxv-note">{FIXTURE_NOTE_ENGINE}</p>
      {skip !== undefined && <p className="fxv-note fxv-note-warn">{FIXTURE_NOTE_SKIP}: {skip}</p>}
      {entities && <p className="fxv-note fxv-note-warn">{FIXTURE_NOTE_ENTITIES}</p>}
      {failure !== null && <p className="fxv-note fxv-note-warn" role="alert">このエンジンで再生できなかった ({failure})</p>}
    </div>
  )
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
