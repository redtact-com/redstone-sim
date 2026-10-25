import { test, expect, type Page, type Request } from '@playwright/test'
import { PNG } from 'pngjs'

// #395 取得先が落ちてもビューアを出す / テクスチャの無駄な取得をなくす。
//
// 取得先は page.route で塞ぐ (route は goto の前に張る)。
// raw だけ塞ぐケースは jsDelivr に実際に取りに行く。CI が不安定になったら、
// jsDelivr への要求を route.fetch で raw から取って返す形に変える
// (それでも「jsDelivr の URL を組み立てて取りに行った」ことは確かめられる)。

const RAW = 'https://raw.githubusercontent.com/**'
const RAW_AND_JSD = /^https:\/\/(raw\.githubusercontent\.com|cdn\.jsdelivr\.net)\//
const EXTERNAL_PNG = /^https:\/\/(raw\.githubusercontent\.com|cdn\.jsdelivr\.net)\/.*\.png$/

/** ビューアの資産への要求か (パレットの img は数えない) */
function isAssetFetch(req: Request): boolean {
  if (req.resourceType() !== 'fetch') return false
  const url = req.url()
  return url.startsWith('https://raw.githubusercontent.com/')
    || url.startsWith('https://cdn.jsdelivr.net/')
    || new URL(url).pathname.startsWith('/resourcepack/')
}

async function openDemo(page: Page): Promise<void> {
  await page.goto('/?demo=lever-wire-lamp')
  await page.waitForFunction(() => !!window.__demo, null, { timeout: 30_000 })
  await page.evaluate(() => window.__demo!.ready)
}

const demoViewer = (page: Page) => page.locator('[data-testid="demo-canvas"] [data-viewer-status]')

/** 色の付いた画素の数 (背景 26,26,31 とグリッドの灰色は数えない)。上端の HUD を避ける */
function colorfulPixels(buf: Buffer): number {
  const png = PNG.sync.read(buf)
  let n = 0
  for (let y = 70; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      const i = (y * png.width + x) * 4
      const r = png.data[i], g = png.data[i + 1], b = png.data[i + 2]
      if (Math.max(r, g, b) - Math.min(r, g, b) > 40) n++
    }
  }
  return n
}

test('raw だけ塞ぐ → jsDelivr から取って、いつもどおり描く (#395)', async ({ page }) => {
  await page.route(RAW, r => r.abort('connectionfailed'))
  const jsd: string[] = []
  page.on('request', req => { if (req.url().startsWith('https://cdn.jsdelivr.net/gh/')) jsd.push(req.url()) })

  await openDemo(page)

  await expect(demoViewer(page)).toHaveAttribute('data-viewer-status', 'ready')
  await expect(demoViewer(page)).toHaveAttribute('data-viewer-assets', 'full')
  await expect(page.getByTestId('viewer-assets-note')).toHaveCount(0)
  // 同じリポの同じ版 (コミット・タグ固定) を取っている
  expect(jsd.some(u => u.includes('/PrismarineJS/minecraft-assets@a95e329c161b7fdd19de9f78d0a91c45da57d921/'))).toBe(true)
  expect(jsd.some(u => u.includes('/misode/mcmeta@1.21.4-assets/'))).toBe(true)
})

test('raw と jsDelivr を両方塞ぐ → エラーにせず単色の簡易表示で描く (#395)', async ({ page }) => {
  await page.route(RAW_AND_JSD, r => r.abort())

  await openDemo(page)

  await expect(demoViewer(page)).toHaveAttribute('data-viewer-status', 'ready')
  await expect(demoViewer(page)).toHaveAttribute('data-viewer-assets', 'solid')
  await expect(page.getByTestId('viewer-assets-note')).toHaveText('テクスチャを読み込めないため簡易表示中')
  // 盤面が実際に描かれている (エラー表示や空の画面ではない)
  const shot = await demoViewer(page).locator('canvas').screenshot()
  expect(colorfulPixels(shot), '単色の立方体が描かれていない').toBeGreaterThan(500)
})

test('外の .png だけ塞ぐ → 届かない面だけ単色にする (#395)', async ({ page }) => {
  await page.route(EXTERNAL_PNG, r => r.abort())

  await openDemo(page)

  await expect(demoViewer(page)).toHaveAttribute('data-viewer-assets', 'partial')
  await expect(page.getByTestId('viewer-assets-note')).toHaveText('一部のテクスチャを読み込めませんでした')
})

test('パックへは一覧にあるものだけ取りに行き、200 + index.html を受けない (#395)', async ({ page }) => {
  const html: string[] = []
  const packTextures: string[] = []
  page.on('response', res => {
    const { pathname } = new URL(res.url())
    if (!pathname.startsWith('/resourcepack/')) return
    if ((res.headers()['content-type'] ?? '').includes('text/html')) html.push(pathname)
    const m = /^\/resourcepack\/assets\/minecraft\/textures\/(.+)\.png$/.exec(pathname)
    if (m && res.request().resourceType() === 'fetch') packTextures.push(m[1])
  })

  await page.goto('/')
  await page.waitForFunction(() => !!window.__editorTest)
  await expect(page.locator('[data-viewer-status]')).toHaveAttribute('data-viewer-status', 'ready', { timeout: 30_000 })

  const bundle = await (await page.request.get('/resourcepack/bundle.json')).json() as { textures: string[] }
  expect(html, 'パックに無いものを取りに行っている').toEqual([])
  expect(packTextures.length).toBeGreaterThan(0)
  expect(packTextures.filter(p => !bundle.textures.includes(p)), '一覧に無いテクスチャをパックへ取りに行っている').toEqual([])
})

test('エディタで START しても資産を取り直さない (#395)', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => !!window.__editorTest)
  await expect(page.locator('[data-viewer-status]')).toHaveAttribute('data-viewer-status', 'ready', { timeout: 30_000 })
  await page.evaluate(() => {
    const ed = window.__editorTest!
    for (let x = 0; x <= 4; x++) ed.placeAt(x, 0, 0, 'solid')
    ed.placeAt(0, 1, 0, 'lever')
    ed.placeAt(1, 1, 0, 'wire')
    ed.placeAt(4, 1, 0, 'lamp')
  })

  const fetched: string[] = []
  page.on('request', req => { if (isAssetFetch(req)) fetched.push(req.url()) })
  await page.getByTestId('btn-start').click()
  await page.waitForFunction(() => window.__editorTest?.getMode() === 'sim')
  // sim 側の画面に切り替わってから 3D の ready を待つ (2D のビューアを見ないように)
  await expect(page.getByTestId('btn-tick')).toBeVisible()
  await expect(page.locator('[data-viewer-status]')).toHaveAttribute('data-viewer-status', 'ready', { timeout: 30_000 })

  expect(fetched, 'START のあとに資産を取り直している').toEqual([])
})

test('raw が応答しない → 8 秒で打ち切って jsDelivr から取る (#395)', async ({ page }) => {
  test.skip(!!process.env.CI, '8 秒待つので手元だけで試す')
  // 応答を返さない (route を放置する)
  await page.route(RAW, () => {})
  const t0 = Date.now()

  await openDemo(page)

  await expect(demoViewer(page)).toHaveAttribute('data-viewer-assets', 'full')
  expect(Date.now() - t0, '打ち切りを待たずに進んでいる').toBeGreaterThan(8_000)
})
