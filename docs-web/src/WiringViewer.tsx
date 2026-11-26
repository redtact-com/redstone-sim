import { useCallback, useMemo, useRef, useState } from 'react'
import { IsometricView } from '@redstone/viewer'
import { buildFixtureWorld, type Fixture } from '@redstone/sim'
import { RESOURCEPACK_URL } from './paths'

/** 確かめ用の小さな回路 (レバー → ワイヤー 2 本 → ランプ)。fixture のファイルは読まない */
const PROBE: Fixture = {
  name: 'wiring-probe',
  mcVersion: '1.21.1',
  ticks: 0,
  region: { from: [0, 0, 0], to: [3, 1, 0] },
  blocks: [
    { pos: [0, 0, 0], block: 'stone' },
    { pos: [1, 0, 0], block: 'stone' },
    { pos: [2, 0, 0], block: 'stone' },
    { pos: [3, 0, 0], block: 'stone' },
    { pos: [0, 1, 0], block: 'lever[face=floor,facing=north,powered=true]' },
    { pos: [1, 1, 0], block: 'redstone_wire' },
    { pos: [2, 1, 0], block: 'redstone_wire' },
    { pos: [3, 1, 0], block: 'redstone_lamp' },
  ],
  inputs: [],
  expect: [],
}

/**
 * ビューアの確かめ (開発用。`#/_wiring` の下に出る)。`packages/viewer` に足した 4 点を手と e2e で見る。
 *
 * - 付け外しを繰り返しても WebGL の文脈が溜まらない (unmount で手放す)
 * - `interactive` を外している間は、ビューアの上でも wheel でページが流れる
 * - `frameLoop="demand"` の間は、止まっていれば requestAnimationFrame が回らない
 * - 資源の基点 URL を渡して描ける
 */
export default function WiringViewer() {
  const snapshot = useMemo(() => buildFixtureWorld(PROBE).world.snapshot(), [])
  const [mounted, setMounted] = useState(true)
  const [interactive, setInteractive] = useState(false)
  const [demand, setDemand] = useState(false)
  const [ready, setReady] = useState(0)
  const [cycles, setCycles] = useState(0)
  const [busy, setBusy] = useState(false)
  const onReadyOnce = useRef<(() => void) | null>(null)
  const onReady = useCallback(() => {
    setReady(n => n + 1)
    onReadyOnce.current?.()
    onReadyOnce.current = null
  }, [])

  /** 外す → 付ける → 描けるまで待つ、を n 回 */
  const cycle = async (n: number) => {
    setBusy(true)
    const frame = () => new Promise<void>(r => requestAnimationFrame(() => r()))
    for (let i = 0; i < n; i++) {
      setMounted(false)
      await frame()
      await new Promise<void>(r => { onReadyOnce.current = r; setMounted(true) })
      setCycles(c => c + 1)
    }
    setBusy(false)
  }

  return (
    <section className="wiring-viewer" data-testid="wiring-viewer" data-ready={ready} data-cycles={cycles} data-busy={busy ? 1 : 0}>
      <h2>ビューアの確かめ</h2>
      <p>
        <button type="button" data-testid="wv-toggle" disabled={busy} onClick={() => setMounted(m => !m)}>{mounted ? '外す' : '付ける'}</button>{' '}
        <button type="button" data-testid="wv-cycle" disabled={busy} onClick={() => { void cycle(20) }}>付け外しを 20 回</button>{' '}
        <label><input type="checkbox" data-testid="wv-interactive" checked={interactive} onChange={e => setInteractive(e.target.checked)} /> interactive</label>{' '}
        <label><input type="checkbox" data-testid="wv-demand" checked={demand} onChange={e => setDemand(e.target.checked)} /> frameLoop=demand</label>{' '}
        <span>描けた回数 {ready}・付け外し {cycles}</span>
      </p>
      <div className="wiring-viewer-box" data-testid="wv-box">
        {mounted && (
          <IsometricView
            snapshot={snapshot}
            interactive={interactive}
            frameLoop={demand ? 'demand' : 'always'}
            resourcePackUrl={RESOURCEPACK_URL}
            onReady={onReady}
          />
        )}
      </div>
      {/* ビューアの上で wheel を回してページが流れるかを見るための余白 */}
      <div className="wiring-viewer-pad" aria-hidden="true" />
    </section>
  )
}
