/**
 * 実機のライブ観測 (`?live=1`) — issue #366
 *
 * `tools/mc-harness/runner/live.ts` に WebSocket でつなぎ、**実機と sim を並べて**描く。
 * 食い違った座標は 3 枚目の「差分ビュー」に目印ブロックで出し、表で blockstate を読む
 * (`IsometricView` にハイライトの口が無いため。枠描画は別 issue)。
 *
 * **sim はここで回す**。`buildFixtureWorld` / `applyFixtureInputsAt` /
 * `snapshotFixtureRegion` は CI の fixture テストと同じ関数なので、
 * ここで合っていれば CI でも同じ系列になる。
 *
 * **真上から (topDown) で描く**。`IsometricView` は 3D のときクリックをカメラ回転に
 * 使うので `onBlockClick` が発火せず、クリック操作が成立しない
 * (`IsometricView.tsx:186` の `if (!topDown) { onMouseDown(...); return }`)。
 * 真上からなら格子が 3 枚でそろうので、見比べにも向く。
 * 3D でのピッキングは別 issue。
 *
 * **パネルは 1 枚ずつ順に出す**。`IsometricView` はインスタンスごとに
 * テクスチャを取り直す (共有キャッシュが無い) ので、3 枚を同時に mount すると
 * ブラウザが `ERR_INSUFFICIENT_RESOURCES` を返して 2 枚目以降が真っ白になる (実測)。
 *
 * `window.__live` (CLI / E2E から操作。`DemoPage` の `window.__demo` と同じ思想):
 *   - use(pos) / setblock(pos, block) / step(n) / reset() / inspect(pos)
 *   - getTick() / getDiffs() / getStatus() / getReal() / getSim()
 *
 * このページは**開発時だけ**。`App.tsx` が `import.meta.env.DEV` で囲んでいる。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { IsometricView } from '@redstone/viewer'
import {
  buildFixtureWorld, applyFixtureInputsAt, snapshotFixtureRegion, mcToSim,
} from '@redstone/sim'
import type { BlockState, Fixture, Pos3D, SimWorld, StateMap, WorldSnapshot } from '@redstone/sim'
import type { BlockMap, ClientMsg, ServerMsg } from '../../tools/mc-harness/runner/live-protocol'

type Key = `${number},${number},${number}`

const keyOf = (p: Pos3D): Key => `${p[0]},${p[1]},${p[2]}`
const posOf = (k: string): Pos3D => k.split(',').map(Number) as Pos3D

/**
 * 実機の状態マップ → ビューア用スナップショット。
 *
 * **描けなかった数も返す**。`mcToSim` が知らないブロックは描き飛ばすしかないが、
 * 黙って落とすと「実機と sim で絵が違う = 食い違いがある」と誤解する
 * (実際に circuit1 で 2 ブロックが実機側だけ消えて見えた。状態は一致していた)。
 */
function toSnapshot(
  map: BlockMap, region: Fixture['region'],
): { snapshot: WorldSnapshot; undrawable: string[] } {
  const blocks = new Map<Key, BlockState>()
  const undrawable: string[] = []
  for (const [k, state] of Object.entries(map)) {
    let b: BlockState | null = null
    try { b = mcToSim(state) } catch { undrawable.push(`${k} ${state}`) }
    if (b !== null) blocks.set(k as Key, b)
  }
  return { snapshot: { blocks, bounds: boundsOf(region) }, undrawable }
}

const boundsOf = (region: Fixture['region']): WorldSnapshot['bounds'] => ({
  x: [region.from[0], region.to[0]],
  y: [region.from[1], region.to[1]],
  z: [region.from[2], region.to[2]],
})

/** 食い違った座標だけを目印ブロックで描く (差分ビュー) */
function toDiffSnapshot(diffs: string[], region: Fixture['region']): WorldSnapshot {
  const blocks = new Map<Key, BlockState>()
  for (const k of diffs) blocks.set(k as Key, { type: 'redstone_block' })
  return { blocks, bounds: boundsOf(region) }
}

interface DiffRow { key: string; real: string; sim: string }

/**
 * `id` を除いた命令。**union に素の `Omit` を掛けると各枝が混ざって死ぬ**ので
 * 条件型で分配する
 */
type Command = ClientMsg extends infer T ? (T extends { id: number } ? Omit<T, 'id'> : never) : never

/** 実機と sim を突き合わせる。無い側は 'air' (fixture の diff と同じ規約) */
function compare(real: BlockMap, sim: StateMap): DiffRow[] {
  const keys = new Set([...Object.keys(real), ...sim.keys()])
  const rows: DiffRow[] = []
  for (const k of [...keys].sort()) {
    const r = real[k] ?? 'air'
    const s = sim.get(k) ?? 'air'
    if (r !== s) rows.push({ key: k, real: r, sim: s })
  }
  return rows
}

export function LivePage() {
  const wsUrl = useMemo(() => {
    const q = new URLSearchParams(window.location.search)
    return q.get('ws') ?? 'ws://127.0.0.1:8787'
  }, [])

  const [status, setStatus] = useState<'接続中' | '接続' | '切断' | 'エラー'>('接続中')
  const [tick, setTick] = useState(0)
  const [cause, setCause] = useState('')
  const [real, setReal] = useState<BlockMap>({})
  const [simState, setSimState] = useState<StateMap>(new Map())
  const [inspected, setInspected] = useState<DiffRow | null>(null)
  /**
   * sim を組めなかった理由 (#372)。
   *
   * **実機にピストンが動いている最中のブロックがあると組めない**
   * (`moving_piston` は運んでいる中身が BlockEntity にあって blockstate に出ない)。
   * キャプチャが「初期状態に moving_piston があれば撮らない」のと同じ理由。
   * このとき**実機側の表示は続ける** — 実機を見るだけなら sim は要らない
   */
  const [simError, setSimError] = useState<string | null>(null)
  // 差分ビューは**既定 OFF**。3 枚同時はテクスチャ取得が枯れる
  const [showDiffView, setShowDiffView] = useState(false)
  /** 真上から見るときのクリック対象レイヤー */
  const [layerY, setLayerY] = useState(1)
  /** 何枚目まで mount したか (1 枚ずつ順に出す) */
  const [mounted, setMounted] = useState(1)

  const wsRef = useRef<WebSocket | null>(null)
  const idRef = useRef(1)
  /** sim 側の世界。fixture を**育てながら**同じドライバに流す */
  const simRef = useRef<{ fx: Fixture; world: SimWorld; authored: Map<string, string>; tick: number } | null>(null)
  const [region, setRegion] = useState<Fixture['region'] | null>(null)
  const [sessionName, setSessionName] = useState('')

  const refreshSim = useCallback(() => {
    const s = simRef.current
    if (!s) return
    setSimState(snapshotFixtureRegion(s.world, s.fx, s.authored))
  }, [])

  const send = useCallback((msg: Command) => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify({ ...msg, id: idRef.current++ }))
  }, [])

  // ─── 実機からの受信 ───────────────────────────────────────────
  useEffect(() => {
    const ws = new WebSocket(wsUrl)
    wsRef.current = ws
    ws.onopen = () => setStatus('接続')
    ws.onclose = () => setStatus('切断')
    ws.onerror = () => setStatus('エラー')
    ws.onmessage = ev => {
      const msg = JSON.parse(String(ev.data)) as ServerMsg
      if (msg.type === 'hello') {
        // 実機の落ち着いた状態から sim を組む。
        // **隠れ状態 (予約 tick / コンパレーター保持 / クールダウン) が来ていれば
        // trustAuthored で出発点をそろえる** — 無いと動いている機械は tick 0 から食い違う
        const fx: Fixture = {
          name: msg.session.name,
          mcVersion: msg.session.mcVersion,
          // ライブは終わりが無いので上限を置かない (step は明示的に呼ぶ)
          ticks: Number.MAX_SAFE_INTEGER,
          region: msg.session.region,
          blocks: Object.entries(msg.authored).map(([k, block]) => ({ pos: posOf(k), block })),
          inputs: [],
          expect: [],
          trustAuthored: msg.hidden !== null,
          scheduled: msg.hidden?.scheduled,
          comparators: msg.hidden?.comparators,
          cooldowns: msg.hidden?.cooldowns,
        }
        // **実機側を先に出す**。sim が組めなくても実機は見られるようにする
        setRegion(msg.session.region)
        // 回路は床 (y=0) の上に組むので、既定は 1 段上を触らせる
        setLayerY(Math.min(msg.session.region.from[1] + 1, msg.session.region.to[1]))
        setSessionName(msg.session.name)
        setReal(msg.authored)
        setTick(msg.tick)
        setCause('接続')
        setInspected(null)
        try {
          const { world, authored } = buildFixtureWorld(fx)
          simRef.current = { fx, world, authored, tick: 0 }
          setSimError(null)
          setSimState(snapshotFixtureRegion(world, fx, authored))
        } catch (e) {
          simRef.current = null
          setSimState(new Map())
          setSimError(e instanceof Error ? e.message : String(e))
        }
        return
      }
      if (msg.type === 'frame') {
        setReal(prev => {
          const next = { ...prev }
          for (const c of msg.changes) {
            if (c.block === 'air') delete next[keyOf(c.pos)]
            else next[keyOf(c.pos)] = c.block
          }
          return next
        })
        setTick(msg.tick)
        setCause(msg.cause)
        return
      }
      if (msg.type === 'state') {
        const s = simRef.current
        const k = keyOf(msg.pos)
        setInspected({
          key: k,
          real: msg.block,
          sim: s ? snapshotFixtureRegion(s.world, s.fx, s.authored).get(k) ?? 'air' : 'air',
        })
        return
      }
      if (msg.type === 'error') console.error(`[live] ${msg.message}`)
    }
    return () => ws.close()
  }, [wsUrl, refreshSim])

  // ─── 操作 (実機と sim の両方へ同じことをする) ──────────────────
  const step = useCallback((n: number) => {
    const s = simRef.current
    if (s) {
      for (let i = 0; i < n; i++) {
        s.tick++
        s.world.tick()
      }
      refreshSim()
    }
    send({ type: 'step', n })
  }, [refreshSim, send])

  const use = useCallback((pos: Pos3D) => {
    const s = simRef.current
    if (s) {
      // **実機と同じ道**で入力を流す。fixture の inputs を育てて
      // applyFixtureInputsAt に渡すので、CI の再生と同じ経路を通る
      s.fx.inputs.push({ tick: s.tick, pos, action: 'use' })
      applyFixtureInputsAt(s.world, s.fx, s.tick, s.authored)
      refreshSim()
    }
    send({ type: 'use', pos })
  }, [refreshSim, send])

  /** 実機に blockstate を置く (レバーを倒す等)。sim にも同じ入力を流す */
  const setblock = useCallback((pos: Pos3D, block: string) => {
    const s = simRef.current
    if (s) {
      s.fx.inputs.push({ tick: s.tick, pos, action: 'setblock', block })
      applyFixtureInputsAt(s.world, s.fx, s.tick, s.authored)
      refreshSim()
    }
    send({ type: 'setblock', pos, block })
  }, [refreshSim, send])

  const reset = useCallback(() => send({ type: 'reset' }), [send])

  const diffs = useMemo(
    () => (simError === null ? compare(real, simState) : []), [real, simState, simError],
  )
  const diffKeys = useMemo(() => diffs.map(d => d.key), [diffs])

  // ─── 外から触れる口 (E2E / 手元の確認用) ──────────────────────
  // 画面のピクセルを狙わずに操作できるようにする。
  // クリックの当たり判定は格子の投影に依存するので、検証はこちらを使う
  useEffect(() => {
    const api = {
      use: (pos: Pos3D) => use(pos),
      setblock: (pos: Pos3D, block: string) => setblock(pos, block),
      step: (n = 1) => step(n),
      reset: () => reset(),
      inspect: (pos: Pos3D) => send({ type: 'inspect', pos }),
      getTick: () => tick,
      getStatus: () => status,
      getDiffs: () => diffs,
      getReal: () => real,
      getSim: () => Object.fromEntries(simState),
      getUndrawable: () => realView?.undrawable ?? [],
      getSimError: () => simError,
    }
    ;(window as unknown as { __live: typeof api }).__live = api
  }, [use, step, reset, send, tick, status, diffs, real, simState])

  const realView = useMemo(
    () => (region ? toSnapshot(real, region) : null), [real, region],
  )
  const realSnapshot = realView?.snapshot ?? null
  const simSnapshot = useMemo(() => {
    const s = simRef.current
    if (!s || !region) return null
    const blocks = new Map<Key, BlockState>()
    for (const [k, v] of simState) {
      let b: BlockState | null = null
      try { b = mcToSim(v) } catch { b = null }
      if (b !== null) blocks.set(k as Key, b)
    }
    return { blocks, bounds: boundsOf(region) }
  }, [simState, region])
  const diffSnapshot = useMemo(
    () => (region ? toDiffSnapshot(diffKeys, region) : null), [diffKeys, region],
  )

  return (
    <div style={{ padding: 12, fontFamily: 'monospace', color: '#ddd', background: '#111', minHeight: '100vh' }}>
      <h1 style={{ fontSize: 16 }}>
        実機ライブ <span style={{ color: '#888' }}>{sessionName}</span>
      </h1>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', margin: '8px 0', flexWrap: 'wrap' }}>
        <span>接続: {status} <span style={{ color: '#888' }}>({wsUrl})</span></span>
        <span>tick {tick}</span>
        <span style={{ color: '#888' }}>{cause}</span>
        {simError === null ? (
          <span style={{ color: diffs.length === 0 ? '#5c5' : '#f66' }}>
            食い違い {diffs.length} 件
          </span>
        ) : (
          <span style={{ color: '#fa0' }}>sim を組めない</span>
        )}
        {realView && realView.undrawable.length > 0 && (
          <span style={{ color: '#fa0' }} title={realView.undrawable.slice(0, 10).join('\n')}>
            描けない {realView.undrawable.length} 個
          </span>
        )}
        <button onClick={() => step(1)}>1 tick</button>
        <button onClick={() => step(8)}>8 tick</button>
        <button onClick={reset}>初期化</button>
        <label>
          y{' '}
          <input
            type="number" value={layerY} style={{ width: 48 }}
            onChange={e => setLayerY(Number(e.target.value))}
          />
        </label>
        <label>
          <input type="checkbox" checked={showDiffView} onChange={e => setShowDiffView(e.target.checked)} />
          差分ビュー
        </label>
      </div>

      {simError !== null && (
        <p style={{ background: '#3a2a00', border: '1px solid #a70', padding: 8, fontSize: 12 }}>
          sim を組めない: {simError}
          <br />
          実機の表示は続きます。<b>「初期化」を押すか、tick を進めてピストンが止まってから</b>
          つなぎ直すと sim も出ます。
        </p>
      )}
      <p style={{ color: '#888', fontSize: 12 }}>
        左クリック = 実機のレバー等を押す / 右クリック = その座標の状態を読む (y の層が対象)
      </p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {realSnapshot && (
          <Panel title={`実機 (y=${layerY})`}>
            <IsometricView
              snapshot={realSnapshot}
              topDown
              placementY={layerY}
              onReady={() => setMounted(m => Math.max(m, 2))}
              onBlockClick={(pos, button) => {
                if (button === 'left') use(pos)
                else send({ type: 'inspect', pos })
              }}
            />
          </Panel>
        )}
        {simError === null && simSnapshot && mounted >= 2 && (
          <Panel title="sim">
            <IsometricView
              snapshot={simSnapshot}
              topDown
              placementY={layerY}
              onReady={() => setMounted(m => Math.max(m, 3))}
            />
          </Panel>
        )}
        {showDiffView && diffSnapshot && mounted >= 3 && (
          <Panel title={`差分 (${diffs.length})`}>
            <IsometricView snapshot={diffSnapshot} topDown placementY={layerY} />
          </Panel>
        )}
      </div>

      {inspected && (
        <pre style={{ background: '#1a1a1a', padding: 8, marginTop: 8 }}>
          {inspected.key}\n  実機: {inspected.real}\n  sim : {inspected.sim}
        </pre>
      )}

      {diffs.length > 0 && (
        <table style={{ marginTop: 12, fontSize: 12, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ color: '#888' }}>
              <th style={{ textAlign: 'left', padding: '2px 8px' }}>座標</th>
              <th style={{ textAlign: 'left', padding: '2px 8px' }}>実機</th>
              <th style={{ textAlign: 'left', padding: '2px 8px' }}>sim</th>
            </tr>
          </thead>
          <tbody>
            {diffs.slice(0, 60).map(d => (
              <tr key={d.key}>
                <td style={{ padding: '2px 8px', color: '#f66' }}>{d.key}</td>
                <td style={{ padding: '2px 8px' }}>{d.real}</td>
                <td style={{ padding: '2px 8px' }}>{d.sim}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ border: '1px solid #333' }}>
      <div style={{ padding: '2px 6px', background: '#1a1a1a', fontSize: 12 }}>{title}</div>
      <div style={{ width: 420, height: 320 }}>{children}</div>
    </div>
  )
}
