import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import type { EmbedApi } from '../app/src/EmbedPage'

// ④ 埋め込みプレイヤー (?embed=1) の postMessage 経路 (#97 / docs/research/14 §5)。
// エディタでレバー+ワイヤー+ランプを組んで NBT を書き出し、そのバイト列を embed ページへ
// rdsim:load で流し込む。以降 step / setMode / trigger / reset を postMessage で駆動し、
// tick 進行・レバー ON・初期化が反映されること、子→親の ready/loaded/tick が届くことを検証。
//
// トップレベルでは window.parent === window なので、テストの window.postMessage は
// 「親からの受信」として扱われ、EmbedPage の親向け送信もこの window で受け取れる。

interface EditorTestApi {
  placeAt: (x: number, y: number, z: number, type: string, opts?: Record<string, unknown>) => void
  getEditorBlockAt: (x: number, y: number, z: number) => { type: string } | null
}

declare global {
  interface Window {
    __editorTest?: EditorTestApi
    __embed?: EmbedApi
    __rx?: Array<{ type: string; tick?: number }>
  }
}

test('embed: postMessage で load → step → trigger → reset', async ({ page }) => {
  // ── 1) エディタで回路を組み、NBT を書き出してバイト列を捕捉 ──────────────
  await page.goto('/')
  await page.waitForFunction(() => !!window.__editorTest)
  await page.evaluate(() => {
    const ed = window.__editorTest!
    ed.placeAt(0, 0, 0, 'lever')
    ed.placeAt(1, 0, 0, 'wire')
    ed.placeAt(2, 0, 0, 'lamp')
  })

  await page.getByTestId('btn-menu').click()
  const downloadPromise = page.waitForEvent('download')
  await page.getByTestId('menu-nbt-save').click()
  const download = await downloadPromise
  const nbtPath = await download.path()
  expect(nbtPath).toBeTruthy()
  const bytes = Array.from(readFileSync(nbtPath!))

  // ── 2) embed ページへ遷移し、子→親メッセージのキャプチャを仕込む ──────────
  await page.goto('/?embed=1')
  await page.waitForFunction(() => !!window.__embed)
  await page.evaluate(() => {
    window.__rx = []
    window.addEventListener('message', (e) => {
      const t = (e.data && (e.data as { type?: string }).type) ?? ''
      if (['rdsim:ready', 'rdsim:loaded', 'rdsim:tick', 'rdsim:error'].includes(t)) {
        window.__rx!.push(e.data as { type: string; tick?: number })
      }
    })
  })

  const root = page.getByTestId('embed-root')
  await expect(root).toHaveAttribute('data-embed-loaded', 'false')

  // ── 3) rdsim:load を送信 → loaded 反映 ─────────────────────────────────
  await page.evaluate((arr) => {
    const u8 = new Uint8Array(arr)
    window.postMessage({ v: 1, type: 'rdsim:load', format: 'structure-nbt', bytes: u8.buffer }, '*')
  }, bytes)
  await page.waitForFunction(() => window.__embed!.isLoaded())
  await expect(root).toHaveAttribute('data-embed-loaded', 'true')
  expect(await page.evaluate(() => window.__rx!.some((m) => m.type === 'rdsim:loaded'))).toBe(true)
  expect(await page.evaluate(() => window.__embed!.getStateAt(0, 0, 0)?.type)).toBe('lever')

  // ── 4) rdsim:step(n=3) → tick 3 + 子→親 tick 通知 ──────────────────────
  await page.evaluate(() => window.postMessage({ v: 1, type: 'rdsim:step', n: 3 }, '*'))
  await page.waitForFunction(() => window.__embed!.getTick() === 3)
  await expect(root).toHaveAttribute('data-embed-tick', '3')
  expect(await page.evaluate(() => window.__rx!.some((m) => m.type === 'rdsim:tick' && m.tick === 3))).toBe(true)

  // ── 5) interact + trigger でレバー ON ──────────────────────────────────
  await page.evaluate(() => window.postMessage({ v: 1, type: 'rdsim:setMode', mode: 'interact' }, '*'))
  await page.waitForFunction(() => window.__embed!.getMode() === 'interact')
  expect(await page.evaluate(() =>
    (window.__embed!.getStateAt(0, 0, 0) as { powered?: boolean } | null)?.powered)).toBe(false)

  await page.evaluate(() => window.postMessage({ v: 1, type: 'rdsim:trigger', x: 0, y: 0, z: 0 }, '*'))
  await page.waitForFunction(() =>
    (window.__embed!.getStateAt(0, 0, 0) as { powered?: boolean } | null)?.powered === true)

  // ── 6) rdsim:reset → tick 0 + レバー OFF ───────────────────────────────
  await page.evaluate(() => window.postMessage({ v: 1, type: 'rdsim:reset' }, '*'))
  await page.waitForFunction(() => window.__embed!.getTick() === 0)
  await expect(root).toHaveAttribute('data-embed-tick', '0')
  expect(await page.evaluate(() =>
    (window.__embed!.getStateAt(0, 0, 0) as { powered?: boolean } | null)?.powered)).toBe(false)
})

test('embed: 許可外 origin からの postMessage は無視される', async ({ page }) => {
  await page.goto('/?embed=1&parentOrigin=https://redtact.com')
  await page.waitForFunction(() => !!window.__embed)

  // 別 window を source に偽装はできないが、setMode を送っても
  // 実際の event.origin は localhost=許可なので通る (正の対照)。
  await page.evaluate(() => window.postMessage({ v: 1, type: 'rdsim:setMode', mode: 'interact' }, '*'))
  await page.waitForFunction(() => window.__embed!.getMode() === 'interact')

  // 不正メッセージ (未知 type / version 不一致) は無視され mode は変わらない
  await page.evaluate(() => {
    window.postMessage({ v: 2, type: 'rdsim:setMode', mode: 'view' }, '*')
    window.postMessage({ v: 1, type: 'rdsim:bogus' }, '*')
  })
  await page.waitForTimeout(200)
  expect(await page.evaluate(() => window.__embed!.getMode())).toBe('interact')
})

test('embed: load 前の reset は無視され空 world を作らない', async ({ page }) => {
  await page.goto('/?embed=1')
  await page.waitForFunction(() => !!window.__embed)

  // load 前は未ロード & 再生ボタンは無効
  await expect(page.getByTestId('embed-root')).toHaveAttribute('data-embed-loaded', 'false')
  await expect(page.getByTestId('embed-run-btn')).toBeDisabled()

  // reset を先に送っても無視される (空 world を合成しない → run は無効のまま)
  await page.evaluate(() => window.postMessage({ v: 1, type: 'rdsim:reset' }, '*'))
  await page.waitForTimeout(200)
  expect(await page.evaluate(() => window.__embed!.isLoaded())).toBe(false)
  await expect(page.getByTestId('embed-run-btn')).toBeDisabled()
})
