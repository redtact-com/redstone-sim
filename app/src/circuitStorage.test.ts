import { describe, it, expect } from 'vitest'
import type { BlockState } from '@redstone/sim'
import {
  STORAGE_KEY, STORAGE_VERSION,
  saveCircuit, loadCircuit, clearCircuit, parseCircuit, serializeCircuit,
} from './circuitStorage'

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
    const blocks: Record<string, unknown> = {}
    for (let i = 0; i < 4097; i++) blocks[`${i},0,0`] = { type: 'wire' }
    expect(parseCircuit(JSON.stringify({ v: STORAGE_VERSION, savedAt: '', blocks }))).toBeNull()
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
