/**
 * 埋め込み (iframe) 連携の postMessage プロトコル v1 — issue #97 / docs/research/14 §5.2
 *
 * 親ページ (redtact 記事など) が rdsim を iframe 埋め込みし、回路のロードと
 * 再生制御を postMessage で行うための型とヘルパー。UI に依存しない純粋関数のみを
 * 置き、EmbedPage はここをディスパッチ層として使う。
 *
 * 設計方針:
 * - origin 検証は allowlist (redtact 本番/dev + ?parentOrigin= + localhost) で行う
 * - 未知/不正なメッセージは parseInbound が null を返し、無視する (例外にしない)
 * - target origin は固定し、'*' は「秘匿情報を含まない」ready のみ許容する
 */

import type { EmbedMode } from './embedTypes'

export const PROTOCOL_VERSION = 1

/** redtact 本番/開発の既定 origin (frame-src 側の対応は redtact リポで行う) */
export const BUILTIN_PARENT_ORIGINS: readonly string[] = [
  'https://redtact.com',
  'https://dev.redtact.com',
]

// ── 親 → 子 (inbound) ─────────────────────────────────────────────────────────

export type InboundMessage =
  | { v: 1; type: 'rdsim:load'; format: 'structure-nbt'; bytes: ArrayBuffer | Uint8Array }
  | { v: 1; type: 'rdsim:step'; n?: number }
  | { v: 1; type: 'rdsim:run' }
  | { v: 1; type: 'rdsim:pause' }
  | { v: 1; type: 'rdsim:reset' }
  | { v: 1; type: 'rdsim:trigger'; x: number; y: number; z: number }
  | { v: 1; type: 'rdsim:setMode'; mode: EmbedMode }

// ── 子 → 親 (outbound) ────────────────────────────────────────────────────────

export type OutboundMessage =
  | { v: 1; type: 'rdsim:ready' }
  | { v: 1; type: 'rdsim:loaded'; size: [number, number, number]; warnings: string[] }
  | { v: 1; type: 'rdsim:tick'; tick: number }
  | { v: 1; type: 'rdsim:error'; code: EmbedErrorCode; message: string }

export type EmbedErrorCode = 'bad-message' | 'parse-error' | 'empty' | 'not-loaded'

// ── origin 検証 ───────────────────────────────────────────────────────────────

/** localhost / 127.0.0.1 (任意ポート・スキーム) を dev 用に許可するか判定 */
function isLocalOrigin(origin: string): boolean {
  try {
    const { hostname } = new URL(origin)
    return hostname === 'localhost' || hostname === '127.0.0.1'
  } catch {
    return false
  }
}

/** 既定 + ?parentOrigin= (カンマ区切り) から許可 origin 集合を作る */
export function buildAllowedOrigins(parentOriginParam: string | null): Set<string> {
  const set = new Set<string>(BUILTIN_PARENT_ORIGINS)
  if (parentOriginParam) {
    for (const o of parentOriginParam.split(',').map((s) => s.trim()).filter(Boolean)) {
      set.add(o)
    }
  }
  return set
}

/** event.origin が許可されているか (allowlist 完全一致 or localhost) */
export function isOriginAllowed(origin: string, allowed: Set<string>): boolean {
  if (origin === 'null' || origin === '') return false // sandbox / opaque origin は拒否
  if (allowed.has(origin)) return true
  return isLocalOrigin(origin)
}

// ── メッセージ検証 ────────────────────────────────────────────────────────────

function isBytes(v: unknown): v is ArrayBuffer | Uint8Array {
  return v instanceof ArrayBuffer || v instanceof Uint8Array
}

/**
 * 受信データを検証して InboundMessage に正規化する。バージョン不一致・未知 type・
 * 必須フィールド欠落はすべて null (呼び出し側は無視する)。
 */
export function parseInbound(data: unknown): InboundMessage | null {
  if (!data || typeof data !== 'object') return null
  const m = data as Record<string, unknown>
  if (m.v !== PROTOCOL_VERSION) return null

  switch (m.type) {
    case 'rdsim:load':
      if (m.format !== 'structure-nbt' || !isBytes(m.bytes)) return null
      return { v: 1, type: 'rdsim:load', format: 'structure-nbt', bytes: m.bytes }

    case 'rdsim:step': {
      const n = typeof m.n === 'number' && m.n > 0 ? Math.floor(m.n) : undefined
      return { v: 1, type: 'rdsim:step', n }
    }

    case 'rdsim:run':
      return { v: 1, type: 'rdsim:run' }
    case 'rdsim:pause':
      return { v: 1, type: 'rdsim:pause' }
    case 'rdsim:reset':
      return { v: 1, type: 'rdsim:reset' }

    case 'rdsim:trigger':
      if (typeof m.x !== 'number' || typeof m.y !== 'number' || typeof m.z !== 'number') return null
      return { v: 1, type: 'rdsim:trigger', x: m.x, y: m.y, z: m.z }

    case 'rdsim:setMode':
      if (m.mode !== 'view' && m.mode !== 'interact') return null
      return { v: 1, type: 'rdsim:setMode', mode: m.mode }

    default:
      return null
  }
}
