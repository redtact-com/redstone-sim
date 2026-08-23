import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'

// 操作パネル (TRIG) の横スクロール (#338)。
//
// レバーやボタンを多く置くと 1 行に収まらない。以前は overflow-x:auto なのに
// **スクロールバーを消していた**ため、PC からは端のレバーを押せなかった
// (ホットバー #333 と同じ原因が別の場所に残っていた)。
//
// ここで固定するのは「多数のレバーがあっても端のレバーを押して ON にできる」こと。

const LEVERS = 14   // 1 個約 130px。900px の画面にはまるで収まらない

declare global {
  interface Window {
    __editorTest?: {
      placeAt: (x: number, y: number, z: number, type: string, opts?: Record<string, unknown>) => void
      getSimStateAt: (x: number, y: number, z: number) => { powered?: boolean } | null
    }
    __embed?: { isLoaded: () => boolean; getMode: () => string }
  }
}

async function buildLevers(page: import('@playwright/test').Page) {
  await page.evaluate((n) => {
    const ed = window.__editorTest!
    for (let x = 0; x < n; x++) {
      ed.placeAt(x, 0, 0, 'solid')
      ed.placeAt(x, 1, 0, 'lever')
    }
  }, LEVERS)
}

test('レバーが多いとき ▶ で端のレバーまで届いて押せる', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 800 })
  await page.goto('/')
  await page.waitForFunction(() => !!window.__editorTest)
  await buildLevers(page)
  await page.getByTestId('btn-start').click()

  const scroller = page.getByTestId('trigbar-scroller')
  await expect(scroller).toBeVisible()
  expect(await scroller.evaluate(el => el.scrollWidth - el.clientWidth),
    'レバー 14 個なら 900px からはみ出すはず').toBeGreaterThan(1)

  // はみ出しているので矢印が出て、左端では ◀ が無効
  await expect(page.getByTestId('trigbar-scroll-left')).toBeDisabled()
  await expect(page.getByTestId('trigbar-scroll-right')).toBeEnabled()

  // ▶ 1 回で進む
  await page.getByTestId('trigbar-scroll-right').click()
  await expect.poll(() => scroller.evaluate(el => el.scrollLeft)).toBeGreaterThan(100)

  // 右端まで送ると ▶ が無効・◀ が有効
  await scroller.evaluate(el => { el.scrollLeft = el.scrollWidth })
  await expect(page.getByTestId('trigbar-scroll-right')).toBeDisabled()
  await expect(page.getByTestId('trigbar-scroll-left')).toBeEnabled()

  // **到達できるだけでなく押せる**こと (最後のレバーが ON になる)
  const last = LEVERS - 1
  expect(await page.evaluate(x => window.__editorTest!.getSimStateAt(x, 1, 0)?.powered, last)).toBe(false)
  await page.getByTestId(`trigger-${last}-1-0`).click()
  await expect.poll(() =>
    page.evaluate(x => window.__editorTest!.getSimStateAt(x, 1, 0)?.powered, last)).toBe(true)
})

test('レバーが多いとき ホイールで横に流れる', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 800 })
  await page.goto('/')
  await page.waitForFunction(() => !!window.__editorTest)
  await buildLevers(page)
  await page.getByTestId('btn-start').click()

  const scroller = page.getByTestId('trigbar-scroller')
  await scroller.hover()
  await page.mouse.wheel(0, 300)
  await expect.poll(() => scroller.evaluate(el => el.scrollLeft)).toBeGreaterThan(0)
})

test('レバーが少ないときは矢印が出ない', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 800 })
  await page.goto('/')
  await page.waitForFunction(() => !!window.__editorTest)
  await page.evaluate(() => {
    const ed = window.__editorTest!
    ed.placeAt(0, 0, 0, 'solid')
    ed.placeAt(0, 1, 0, 'lever')
  })
  await page.getByTestId('btn-start').click()

  await expect(page.getByTestId('trigbar-scroller')).toBeVisible()
  await expect(page.getByTestId('trigbar-scroll-left')).toHaveCount(0)
  await expect(page.getByTestId('trigbar-scroll-right')).toHaveCount(0)
})

test('埋め込みの操作パネルも同じように送れる', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 800 })
  // エディタでレバーを並べて NBT に書き出す
  await page.goto('/')
  await page.waitForFunction(() => !!window.__editorTest)
  await buildLevers(page)
  await page.getByTestId('btn-menu').click()
  const dl = page.waitForEvent('download')
  await page.getByTestId('menu-nbt-save').click()
  const bytes = Array.from(readFileSync((await (await dl).path())!))

  await page.goto('/?embed=1')
  await page.waitForFunction(() => !!window.__embed)
  await page.evaluate((arr) => {
    const u8 = new Uint8Array(arr)
    window.postMessage({ v: 1, type: 'rdsim:load', format: 'structure-nbt', bytes: u8.buffer }, '*')
  }, bytes)
  await page.waitForFunction(() => window.__embed!.isLoaded())
  await page.evaluate(() => window.postMessage({ v: 1, type: 'rdsim:setMode', mode: 'interact' }, '*'))
  await page.waitForFunction(() => window.__embed!.getMode() === 'interact')

  const scroller = page.getByTestId('embed-trigbar-scroller')
  await expect(scroller).toBeVisible()
  expect(await scroller.evaluate(el => el.scrollWidth - el.clientWidth)).toBeGreaterThan(1)
  await expect(page.getByTestId('embed-trigbar-scroll-right')).toBeEnabled()
  await page.getByTestId('embed-trigbar-scroll-right').click()
  await expect.poll(() => scroller.evaluate(el => el.scrollLeft)).toBeGreaterThan(100)
})
