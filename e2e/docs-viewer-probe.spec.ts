import { test, expect, type Page } from '@playwright/test'

// packages/viewer に足した 4 点 (#434) を、読む用の Web の確かめのページ (/docs/#/_wiring) で見る。
//
//   1. 付け外しを 20 回しても WebGL の文脈の警告が出ない (unmount で文脈を手放す)
//   2. interactive=false の間は、ビューアの上でも wheel でページが流れる。true では流れない
//   3. frameLoop="demand" の間は、止まっていれば requestAnimationFrame が回らない
//   (資源の基点 URL は、このページが resourcePackUrl を渡して描けていることで見る)
//
// エディタ・デモ・埋め込みは props を渡さないので、既定の動きは他の spec が守る。

const probe = (page: Page) => page.getByTestId('wiring-viewer')
const box = (page: Page) => page.getByTestId('wv-box')

/** WebGL の文脈についての警告とエラーを集める */
function collectWebglMessages(page: Page): string[] {
  const out: string[] = []
  page.on('console', m => {
    const text = m.text()
    if (/webgl|context/i.test(text) && m.type() !== 'log') out.push(`${m.type()}: ${text}`)
  })
  page.on('pageerror', e => out.push(`pageerror: ${e.message}`))
  return out
}

async function openProbe(page: Page) {
  await page.goto('/docs/#/_wiring')
  await expect(box(page).locator('[data-viewer-status="ready"]')).toBeVisible({ timeout: 30_000 })
  await expect(probe(page)).toHaveAttribute('data-ready', '1')
}

test('付け外しを 20 回しても WebGL の文脈の警告が出ない (#434)', async ({ page }) => {
  const messages = collectWebglMessages(page)
  // WebGL の文脈を作った canvas を全部つかんでおく。外した canvas が GC されると文脈も消えて、
  // 手放していなくても警告が出ない (手放さない版でも通ってしまう)。GC が走らない場合を再現する。
  // この条件で手放さない版を流すと「Too many active WebGL contexts」が 5 回出る (21 個 - 上限 16 個)
  await page.addInitScript(() => {
    const w = window as unknown as { __kept: HTMLCanvasElement[] }
    w.__kept = []
    const orig = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: unknown[]) {
      if (String(args[0]).startsWith('webgl') && !w.__kept.includes(this)) w.__kept.push(this)
      return (orig as (...a: unknown[]) => unknown).apply(this, args)
    } as typeof orig
  })
  await openProbe(page)

  await page.getByTestId('wv-cycle').click()
  await expect(probe(page)).toHaveAttribute('data-cycles', '20', { timeout: 60_000 })
  await expect(probe(page)).toHaveAttribute('data-busy', '0')
  await expect(box(page).locator('[data-viewer-status="ready"]')).toBeVisible()

  // 作った文脈は 21 個 (最初の 1 個 + 20 回)。外した 20 個は手放してあり、残っている 1 個は生きている
  const lostOf = () => page.evaluate(() =>
    (window as unknown as { __kept: HTMLCanvasElement[] }).__kept
      .map(c => (c.getContext('webgl')?.isContextLost() ?? true) ? 1 : 0 as number))
  const lost = await lostOf()
  expect(lost).toHaveLength(21)
  expect(lost.slice(0, 20)).toEqual(Array(20).fill(1))
  expect(lost[20]).toBe(0)
  expect(messages).toEqual([])

  // 外すと、その 1 枚も手放す
  await page.getByTestId('wv-toggle').click()
  await expect(box(page).locator('canvas')).toHaveCount(0)
  await expect.poll(async () => (await lostOf())[20]).toBe(1)
  expect(messages).toEqual([])
})

test('interactive=false の間はビューアの上でも wheel でページが流れる (#434)', async ({ page }) => {
  await openProbe(page)
  const canvas = box(page).locator('canvas')
  await canvas.scrollIntoViewIfNeeded()
  const center = async () => {
    const r = (await canvas.boundingBox())!
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  }
  const scrollY = () => page.evaluate(() => window.scrollY)

  // 既定 (このページでは interactive を外してある): ページが流れ、touch-action も奪わない
  await expect(canvas).toHaveCSS('touch-action', 'auto')
  const before = await scrollY()
  let p = await center()
  await page.mouse.move(p.x, p.y)
  await page.mouse.wheel(0, 120)
  await expect.poll(scrollY).toBeGreaterThan(before + 60)

  // interactive にすると、今までどおり wheel はビューアが使い、ページは流れない
  await page.getByTestId('wv-interactive').check()
  await expect(canvas).toHaveCSS('touch-action', 'none')
  p = await center()
  await page.mouse.move(p.x, p.y)
  const fixed = await scrollY()
  await page.mouse.wheel(0, 120)
  await page.waitForTimeout(300)
  expect(await scrollY()).toBe(fixed)

  // 外すと、また流れる
  await page.getByTestId('wv-interactive').uncheck()
  p = await center()
  await page.mouse.move(p.x, p.y)
  await page.mouse.wheel(0, 120)
  await expect.poll(scrollY).toBeGreaterThan(fixed + 60)
})

test('frameLoop="demand" の間は、止まっていれば rAF が回らない (#434)', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __raf: number }
    w.__raf = 0
    const orig = window.requestAnimationFrame.bind(window)
    window.requestAnimationFrame = cb => { w.__raf++; return orig(cb) }
  })
  await openProbe(page)
  /** ms の間に予約された rAF の数 */
  const rafDuring = async (ms: number) => {
    const a = await page.evaluate(() => (window as unknown as { __raf: number }).__raf)
    await page.waitForTimeout(ms)
    return (await page.evaluate(() => (window as unknown as { __raf: number }).__raf)) - a
  }

  // 既定 ("always"): 毎フレーム描く
  expect(await rafDuring(500)).toBeGreaterThan(10)

  // "demand": 止まっている間は 0
  await page.getByTestId('wv-demand').check()
  await page.waitForTimeout(200)
  expect(await rafDuring(500)).toBe(0)

  // 操作すると描く (ドラッグでカメラを回す)。離して少し経つとまた止まる
  await page.getByTestId('wv-interactive').check()
  const canvas = box(page).locator('canvas')
  const r = (await canvas.boundingBox())!
  // 画面に出ている絵で比べる (描いた後のバッファは残らないので toDataURL は使えない)
  const shot = () => canvas.screenshot()
  await page.waitForTimeout(200)
  const still = await shot()
  await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2)
  await page.mouse.down()
  await page.mouse.move(r.x + r.width / 2 + 80, r.y + r.height / 2 + 10, { steps: 8 })
  await page.mouse.up()
  await page.waitForTimeout(200)
  expect((await shot()).equals(still)).toBe(false)
  expect(await rafDuring(500)).toBe(0)

  // "always" に戻すと、また毎フレーム描く
  await page.getByTestId('wv-demand').uncheck()
  await page.waitForTimeout(100)
  expect(await rafDuring(500)).toBeGreaterThan(10)
})
