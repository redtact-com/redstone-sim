import { describe, it, expect } from 'vitest'
import type { BlockState } from '@redstone/sim'
import { effectiveContainerSignal } from '@redstone/sim'
import { MAX_SAVED_BLOCKS, STORAGE_KEY, STORAGE_VERSION, clearCircuit, loadCircuit, parseCircuit, saveCircuit, serializeCircuit } from './circuitStorage'

/** localStorage の代役。throw する版も作れるようにしてある */
function fakeStorage(opts: { throwOnSet?: boolean; throwOnGet?: boolean } = {}): Storage {
  const map = new Map<string, string>()
  return {
    get length() { return map.size },
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => {
      if (opts.throwOnGet) throw new Error('blocked')
      return map.get(k) ?? null
    },
    setItem: (k: string, v: string) => {
      if (opts.throwOnSet) throw new DOMException('QuotaExceededError')
      map.set(k, v)
    },
    removeItem: (k: string) => { map.delete(k) },
  } as Storage
}

const wire = (power = 0): BlockState =>
  ({ type: 'wire', power, connections: { north: false, south: false, east: true, west: true } }) as BlockState

const sample = () => new Map<string, BlockState>([
  ['0,0,0', wire(15)],
  ['1,0,0', wire(14)],
  ['2,0,0', { type: 'lamp', lit: true } as BlockState],
])

describe('circuitStorage', () => {
  it('保存した回路をそのまま復元できる', () => {
    const s = fakeStorage()
    expect(saveCircuit(sample(), '2026-08-12T00:00:00Z', s)).toBe('saved')
    const restored = loadCircuit(s)
    expect(restored?.blocks.size).toBe(3)
    expect(restored?.blocks.get('0,0,0')).toEqual(wire(15))
    expect(restored?.savedAt).toBe('2026-08-12T00:00:00Z')
  })

  it('保存が無ければ null', () => {
    expect(loadCircuit(fakeStorage())).toBeNull()
  })

  it('空の回路も保存・復元できる', () => {
    const s = fakeStorage()
    saveCircuit(new Map(), '2026-08-12T00:00:00Z', s)
    expect(loadCircuit(s)?.blocks.size).toBe(0)
  })

  it('クリアすると保存も消える', () => {
    const s = fakeStorage()
    saveCircuit(sample(), '2026-08-12T00:00:00Z', s)
    clearCircuit(s)
    expect(loadCircuit(s)).toBeNull()
  })

  // ── 壊れた保存データで落ちないこと ──────────────────────────────
  it('JSON として壊れていたら null を返し、壊れたデータは捨てる', () => {
    const s = fakeStorage()
    s.setItem(STORAGE_KEY, '{壊れている')
    expect(loadCircuit(s)).toBeNull()
    expect(s.getItem(STORAGE_KEY)).toBeNull()
  })

  it('バージョンが違えば復元しない', () => {
    const s = fakeStorage()
    s.setItem(STORAGE_KEY, JSON.stringify({ v: STORAGE_VERSION + 1, savedAt: '', blocks: {} }))
    expect(loadCircuit(s)).toBeNull()
  })

  it.each([
    ['座標キーが不正', { 'a,b,c': { type: 'wire' } }],
    ['キーの要素数が違う', { '0,0': { type: 'wire' } }],
    ['値がオブジェクトでない', { '0,0,0': 'wire' }],
    ['type が無い', { '0,0,0': { power: 3 } }],
  ])('%s なら全体を捨てる (中途半端に復元しない)', (_label, blocks) => {
    expect(parseCircuit(JSON.stringify({ v: STORAGE_VERSION, savedAt: '', blocks }))).toBeNull()
  })

  it('ブロック数が上限を超えたら捨てる', () => {
    // 上限は最大盤面の体積 (#226)。旧 4096 固定では 16×16×16 より大きい盤面が保存できない
    const blocks: Record<string, unknown> = {}
    for (let i = 0; i <= MAX_SAVED_BLOCKS; i++) blocks[`${i},0,0`] = { type: 'wire' }
    expect(parseCircuit(JSON.stringify({ v: STORAGE_VERSION, savedAt: '', blocks }))).toBeNull()
  })

  it('旧上限 (4096) を超える回路は捨てない (盤面を広げた分が保存できる)', () => {
    const blocks: Record<string, unknown> = {}
    for (let i = 0; i < 5000; i++) blocks[`${i},0,0`] = { type: 'wire' }
    const r = parseCircuit(JSON.stringify({ v: STORAGE_VERSION, savedAt: '', blocks }))
    expect(r?.blocks.size).toBe(5000)
  })

  // ── ストレージが使えない環境で落ちないこと ──────────────────────
  it('setItem が throw しても例外を投げない (容量超過・プライベートモード)', () => {
    expect(saveCircuit(sample(), '2026-08-12T00:00:00Z', fakeStorage({ throwOnSet: true }))).toBe('failed')
  })

  it('getItem が throw しても null を返す', () => {
    expect(loadCircuit(fakeStorage({ throwOnGet: true }))).toBeNull()
  })

  it('serializeCircuit はバージョンと保存時刻を持つ', () => {
    const out = serializeCircuit(sample(), '2026-08-12T00:00:00Z')
    expect(out.v).toBe(STORAGE_VERSION)
    expect(out.savedAt).toBe('2026-08-12T00:00:00Z')
    expect(Object.keys(out.blocks)).toHaveLength(3)
  })
})

// ============================================================
// 旧形式コンテナの移行 (#201)
//
// v0.8.0 (#194) で `HopperState.count` → `slots` に変えたが移行を入れておらず、
// **保存済み回路を読み込んだ瞬間に落ちる**状態だった
// (`slots is not iterable` / `reading 'length'`)。
// STORAGE_VERSION を上げて捨てれば落ちはしないが回路まで失うので、ここで直す。
// ============================================================

describe('旧形式コンテナの移行 (#201)', () => {
  const legacy = (block: Record<string, unknown>): string => JSON.stringify({
    v: 1, savedAt: '2026-08-16T00:00:00.000Z', blocks: { '0,0,0': block },
  })
  const first = (raw: string) => parseCircuit(raw)!.blocks.get('0,0,0') as {
    slots?: readonly ({ id: string; stack: number; count: number } | null)[]
    count?: number
  }

  it('hopper の count を slots に移行する', () => {
    const b = first(legacy({ type: 'hopper', facing: 'down', count: 14, enabled: true }))
    expect(b.count, 'count は残さない').toBeUndefined()
    expect(b.slots![0]).toMatchObject({ stack: 64, count: 14 })
  })

  it('**移行後もコンパレーター強度が変わらない** (旧モデルは 64 スタック相当だった)', () => {
    // 旧: f = 100 / (5*64) → floor(0.4375*14)+1 = 7
    const b = first(legacy({ type: 'hopper', facing: 'down', count: 100, enabled: true }))
    expect(effectiveContainerSignal(b as never)).toBe(Math.floor((100 / 320) * 14) + 1)
  })

  it('dropper / dispenser も移行する', () => {
    for (const type of ['dropper', 'dispenser']) {
      const b = first(legacy({ type, facing: 'north', count: 70, triggered: false }))
      expect(b.slots!.filter(Boolean).length, type).toBe(2)   // 64 + 6
    }
  })

  it('container の手動 signal モードは slots を持たないまま通す', () => {
    const b = first(legacy({ type: 'container', signal: 9 }))
    expect(b.slots).toBeUndefined()
    expect(effectiveContainerSignal(b as never)).toBe(9)
  })

  it('現行形式 (slots つき) はそのまま通す', () => {
    const slots = [{ id: 'snowball', stack: 16, count: 3 }, null, null, null, null]
    const b = first(legacy({ type: 'hopper', facing: 'down', slots, enabled: true }))
    expect(b.slots![0]).toMatchObject({ id: 'snowball', stack: 16, count: 3 })
  })

  it('count も slots も無い壊れたコンテナは空スロットで復旧する', () => {
    const b = first(legacy({ type: 'hopper', facing: 'down', enabled: true }))
    expect(b.slots).toHaveLength(5)
    expect(b.slots!.every(s => s === null)).toBe(true)
  })

  it('移行しないと落ちること自体を固定する (回帰防止)', () => {
    // 移行を外すとこの形が sim に渡り、下の呼び出しが TypeError になる
    const raw = { type: 'hopper', facing: 'down', count: 14, enabled: true } as never
    expect(() => effectiveContainerSignal(raw)).toThrow(TypeError)
  })
})

describe('盤面サイズの保存 (#226)', () => {
  it('保存した盤面サイズが復元される', () => {
    const s = fakeStorage()
    saveCircuit(sample(), '2026-08-17T00:00:00Z', s, { x: 32, y: 24, z: 20 })
    expect(loadCircuit(s)?.board).toEqual({ x: 32, y: 24, z: 20 })
  })

  it('**盤面サイズが無い古い保存データも読める** (回路を捨てない)', () => {
    const s = fakeStorage()
    // board フィールドを持たない v1 のデータ
    s.setItem(STORAGE_KEY, JSON.stringify({
      v: STORAGE_VERSION, savedAt: '2026-08-16T00:00:00Z',
      blocks: { '0,0,0': wire(15) },
    }))
    const r = loadCircuit(s)
    expect(r?.blocks.size).toBe(1)
    expect(r?.board).toEqual({ x: 16, y: 16, z: 16 })
  })

  it('壊れた盤面サイズは既定に落とす (回路は生かす)', () => {
    const s = fakeStorage()
    s.setItem(STORAGE_KEY, JSON.stringify({
      v: STORAGE_VERSION, savedAt: '', blocks: { '0,0,0': wire(1) },
      board: { x: 9999, y: 'abc', z: -3 },
    }))
    const r = loadCircuit(s)
    expect(r?.blocks.size).toBe(1)
    expect(r?.board).toEqual({ x: 256, y: 16, z: 1 })
  })

  it('盤面サイズを渡さずに保存すると既定が入る', () => {
    expect(serializeCircuit(sample(), '2026-08-17T00:00:00Z').board).toEqual({ x: 16, y: 16, z: 16 })
  })
})
