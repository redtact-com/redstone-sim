import type { BlockState, BlockType } from '@redstone/sim'
import { slotsFromCount, containerSlotsOf } from '@redstone/sim'

/**
 * 編集中の回路をブラウザに残す (#109)。
 *
 * 方針:
 * - **落ちないことを最優先**。プライベートモード・容量超過・壊れた JSON のいずれでも
 *   例外を投げず、保存/復元を静かに諦めてエディタは通常起動する
 * - 保存するのは編集モードの回路だけ。シミュレーションの途中状態は派生物なので持たない
 * - 形式はバージョン付き。将来 BlockState が変わったら version を上げて古い保存は捨てる
 */

export const STORAGE_KEY = 'rdsim:editor:circuit'
export const STORAGE_VERSION = 1

/** 異常なデータで固まらないための上限 (16×16×8 = 2048 が現行の最大) */
const MAX_BLOCKS = 4096

export interface SavedCircuit {
  v: number
  savedAt: string
  blocks: Record<string, BlockState>
}

export interface RestoredCircuit {
  blocks: Map<string, BlockState>
  savedAt: string
}

/** localStorage は「アクセスした瞬間に throw する」環境がある (Safari のプライベート等) */
function safeStorage(storage?: Storage): Storage | null {
  try {
    return storage ?? (typeof localStorage === 'undefined' ? null : localStorage)
  } catch {
    return null
  }
}

const isPosKey = (key: string): boolean => {
  const parts = key.split(',')
  return parts.length === 3 && parts.every(p => p !== '' && Number.isFinite(Number(p)))
}

export function serializeCircuit(blocks: Map<string, BlockState>, savedAt: string): SavedCircuit {
  const out: Record<string, BlockState> = {}
  for (const [key, block] of blocks) out[key] = block
  return { v: STORAGE_VERSION, savedAt, blocks: out }
}

/** 壊れた保存データを弾く。1 ブロックでも形が違えば全体を捨てる (中途半端な復元をしない) */
export function parseCircuit(raw: string): RestoredCircuit | null {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof data !== 'object' || data === null) return null
  const { v, savedAt, blocks } = data as Partial<SavedCircuit>
  if (v !== STORAGE_VERSION) return null
  if (typeof blocks !== 'object' || blocks === null) return null

  const entries = Object.entries(blocks)
  if (entries.length > MAX_BLOCKS) return null

  const map = new Map<string, BlockState>()
  for (const [key, block] of entries) {
    if (!isPosKey(key)) return null
    if (typeof block !== 'object' || block === null) return null
    if (typeof (block as BlockState).type !== 'string') return null
    map.set(key, migrateBlock(block as BlockState))
  }
  return { blocks: map, savedAt: typeof savedAt === 'string' ? savedAt : '' }
}

/**
 * 保存データのブロックを現行の形へ移行する (#201)。
 *
 * v0.8.0 (#194) でコンテナが `count: number` → `slots` に変わった。移行しないと
 * **読み込んだ瞬間に落ちる** (`slots is not iterable` / `reading 'length'`)。
 * `STORAGE_VERSION` を上げて捨てる手もあるが、それでは回路まで失うのでここで直す。
 *
 * 旧モデルの count は「64 スタックのアイテムが slot0 から詰まっている」意味だったので、
 * `slotsFromCount` の既定と一致し**コンパレーター強度も変わらない**。
 */
function migrateBlock(block: BlockState): BlockState {
  const type = block.type as BlockType
  if (type !== 'hopper' && type !== 'dropper' && type !== 'dispenser' && type !== 'container') {
    return block
  }
  // 既に slots を持っていれば現行形式
  if (containerSlotsOf(block) !== undefined) return block
  const legacy = block as unknown as { count?: unknown }
  if (typeof legacy.count !== 'number') {
    // container の手動 signal モードは slots を持たないのが正しい
    if (type === 'container') return block
    // hopper/dropper で count も slots も無い壊れたデータ → 空スロットで復旧
    return { ...block, slots: slotsFromCount(type, 0) } as BlockState
  }
  const { count: _drop, ...rest } = block as unknown as Record<string, unknown>
  return { ...rest, slots: slotsFromCount(type, legacy.count) } as unknown as BlockState
}

export type SaveResult = 'saved' | 'unavailable' | 'failed'

export function saveCircuit(
  blocks: Map<string, BlockState>,
  now: string = new Date().toISOString(),
  storage?: Storage,
): SaveResult {
  const s = safeStorage(storage)
  if (!s) return 'unavailable'
  try {
    s.setItem(STORAGE_KEY, JSON.stringify(serializeCircuit(blocks, now)))
    return 'saved'
  } catch {
    // 容量超過など。次の保存で回復する可能性があるので消さずに諦める
    return 'failed'
  }
}

export function loadCircuit(storage?: Storage): RestoredCircuit | null {
  const s = safeStorage(storage)
  if (!s) return null
  let raw: string | null
  try {
    raw = s.getItem(STORAGE_KEY)
  } catch {
    return null
  }
  if (!raw) return null
  const parsed = parseCircuit(raw)
  if (!parsed) {
    // 壊れているものを残しても毎回失敗するだけなので捨てる
    clearCircuit(s)
    return null
  }
  return parsed
}

export function clearCircuit(storage?: Storage): void {
  const s = safeStorage(storage)
  if (!s) return
  try {
    s.removeItem(STORAGE_KEY)
  } catch {
    /* 消せなくても実害はない */
  }
}
