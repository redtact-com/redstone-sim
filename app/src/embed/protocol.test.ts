import { describe, it, expect } from 'vitest'
import {
  parseInbound, buildAllowedOrigins, isOriginAllowed, BUILTIN_PARENT_ORIGINS,
} from './protocol'

// ============================================================
// embed protocol v1 — origin 検証とメッセージ parse (#97)
// ============================================================

describe('protocol: origin 検証', () => {
  it('既定 origin (redtact.com / dev.redtact.com) を許可', () => {
    const allowed = buildAllowedOrigins(null)
    for (const o of BUILTIN_PARENT_ORIGINS) expect(isOriginAllowed(o, allowed)).toBe(true)
  })

  it('?parentOrigin= で追加した origin を許可 (カンマ区切り)', () => {
    const allowed = buildAllowedOrigins('https://a.example, https://b.example')
    expect(isOriginAllowed('https://a.example', allowed)).toBe(true)
    expect(isOriginAllowed('https://b.example', allowed)).toBe(true)
    expect(isOriginAllowed('https://evil.example', allowed)).toBe(false)
  })

  it('localhost / 127.0.0.1 は任意ポートで許可 (dev)', () => {
    const allowed = buildAllowedOrigins(null)
    expect(isOriginAllowed('http://localhost:5199', allowed)).toBe(true)
    expect(isOriginAllowed('http://127.0.0.1:4320', allowed)).toBe(true)
  })

  it('opaque origin ("null") と空文字は拒否', () => {
    const allowed = buildAllowedOrigins(null)
    expect(isOriginAllowed('null', allowed)).toBe(false)
    expect(isOriginAllowed('', allowed)).toBe(false)
  })

  it('許可外 origin は拒否', () => {
    const allowed = buildAllowedOrigins(null)
    expect(isOriginAllowed('https://redtact.com.evil.example', allowed)).toBe(false)
    expect(isOriginAllowed('http://redtact.com', allowed)).toBe(false) // スキーム違い
  })
})

describe('protocol: parseInbound', () => {
  it('バージョン不一致は null', () => {
    expect(parseInbound({ v: 2, type: 'rdsim:run' })).toBeNull()
    expect(parseInbound({ type: 'rdsim:run' })).toBeNull()
  })

  it('非オブジェクト・未知 type は null', () => {
    expect(parseInbound(null)).toBeNull()
    expect(parseInbound('rdsim:run')).toBeNull()
    expect(parseInbound({ v: 1, type: 'rdsim:unknown' })).toBeNull()
  })

  it('load は format=structure-nbt かつ bytes(ArrayBuffer/Uint8Array) が必須', () => {
    const buf = new Uint8Array([1, 2, 3])
    expect(parseInbound({ v: 1, type: 'rdsim:load', format: 'structure-nbt', bytes: buf }))
      .toEqual({ v: 1, type: 'rdsim:load', format: 'structure-nbt', bytes: buf })
    expect(parseInbound({ v: 1, type: 'rdsim:load', format: 'litematic', bytes: buf })).toBeNull()
    expect(parseInbound({ v: 1, type: 'rdsim:load', format: 'structure-nbt', bytes: 'x' })).toBeNull()
  })

  it('step は n を正整数へ正規化 (省略/不正は undefined)', () => {
    expect(parseInbound({ v: 1, type: 'rdsim:step' })).toEqual({ v: 1, type: 'rdsim:step', n: undefined })
    expect(parseInbound({ v: 1, type: 'rdsim:step', n: 3.9 })).toEqual({ v: 1, type: 'rdsim:step', n: 3 })
    expect(parseInbound({ v: 1, type: 'rdsim:step', n: -2 })).toEqual({ v: 1, type: 'rdsim:step', n: undefined })
  })

  it('run / pause / reset はそのまま通す', () => {
    for (const type of ['rdsim:run', 'rdsim:pause', 'rdsim:reset'] as const) {
      expect(parseInbound({ v: 1, type })).toEqual({ v: 1, type })
    }
  })

  it('trigger は x/y/z 数値が必須', () => {
    expect(parseInbound({ v: 1, type: 'rdsim:trigger', x: 1, y: 0, z: 2 }))
      .toEqual({ v: 1, type: 'rdsim:trigger', x: 1, y: 0, z: 2 })
    expect(parseInbound({ v: 1, type: 'rdsim:trigger', x: 1, y: 0 })).toBeNull()
    expect(parseInbound({ v: 1, type: 'rdsim:trigger', x: '1', y: 0, z: 2 })).toBeNull()
  })

  it('setMode は view / interact のみ許可', () => {
    expect(parseInbound({ v: 1, type: 'rdsim:setMode', mode: 'view' }))
      .toEqual({ v: 1, type: 'rdsim:setMode', mode: 'view' })
    expect(parseInbound({ v: 1, type: 'rdsim:setMode', mode: 'interact' }))
      .toEqual({ v: 1, type: 'rdsim:setMode', mode: 'interact' })
    expect(parseInbound({ v: 1, type: 'rdsim:setMode', mode: 'edit' })).toBeNull()
  })
})
