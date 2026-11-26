import { test, expect, type Page } from '@playwright/test'

// 読む用の Web (#434)。PR のプレビューと同じ形 = app の preview の /docs/ で回す
// (playwright.config.ts の webServer が docs-web をビルドして app/dist/docs へ写す)。
//
//   1. ページを開く → 「読んだ」+ 理解度 60 → 再読み込みで残る → 目次の集計が変わる
//   2. 検索「リピーター ロック」→ V07 が上位 → 結果を押すと節へ飛ぶ。
//      索引は検索の欄に入るまで取られない
//   3. 幅 375 px でページが横に流れない (00 §4 の表・V14 の 17 列の表)
//
// ビューアと図の手順 (4・5) は次の PR で足す。

const STATUS_KEY = 'rdsim:docs:status:v1'
const SEARCH_INDEX = 'search-index.json'

const article = (page: Page, id: string) => page.locator(`article[data-page="${id}"]`)

/** コンソールのエラーと例外を集める (テストの最後に 0 件を確かめる) */
function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
  page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`) })
  return errors
}

/** ページが横に流れる幅 (0 なら流れない) */
const overflowX = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)

test('読んだ + 理解度 60 が再読み込みで残り、目次の集計が変わる (#434)', async ({ page }) => {
  const errors = collectErrors(page)
  await page.goto('/docs/#/v07/4.3')
  await expect(article(page, 'v07/4.3')).toBeVisible()

  const overall = page.locator('.head-status .overall-text')
  const docCount = page.locator('.toc-doc[data-doc="v07"] > .toc-doc-row .toc-count')
  const current = page.locator('.toc [aria-current="page"]')
  await expect(overall).toHaveAttribute('data-read', '0')
  await expect(docCount).toHaveText(/^0\/\d+/)
  await expect(current).toHaveAttribute('data-read', '0')

  // 上の操作で付ける。理解度を動かすと下の操作も同じ値になる
  const top = page.locator('.status-bar[data-where="top"]')
  const bottom = page.locator('.status-bar[data-where="bottom"]')
  await top.locator('input[type="checkbox"]').check()
  await top.locator('input[type="range"]').fill('60')
  await expect(bottom.locator('input[type="checkbox"]')).toBeChecked()
  await expect(bottom.locator('input[type="range"]')).toHaveValue('60')

  const expectRecorded = async () => {
    await expect(overall).toHaveAttribute('data-read', '1')
    await expect(overall).toHaveAttribute('data-avg', '60')
    await expect(docCount).toHaveText(/^1\/\d+\s+60$/)
    await expect(current).toHaveAttribute('data-read', '1')
    await expect(current.locator('.toc-count')).toHaveText('60')
  }
  await expectRecorded()

  // 置き場は決まったキーの 1 個だけ (エディタの rdsim:editor:* と混ざらない)
  const stored = await page.evaluate(k => ({
    keys: Object.keys(localStorage).filter(x => x.startsWith('rdsim:docs:')),
    entry: JSON.parse(localStorage.getItem(k) ?? '{}').pages?.['v07/4.3'],
  }), STATUS_KEY)
  expect(stored.keys).toEqual([STATUS_KEY])
  expect(stored.entry).toMatchObject({ r: 1, u: 60 })

  await page.reload()
  await expect(article(page, 'v07/4.3')).toBeVisible()
  await expect(top.locator('input[type="checkbox"]')).toBeChecked()
  await expect(top.locator('input[type="range"]')).toHaveValue('60')
  await expectRecorded()

  // 絞り込み「未読だけ」で、読んだページが目次から消える
  await page.locator('[data-filter="unread"]').click()
  await expect(page.locator('.toc a[href="#/v07/4.3"]')).toHaveCount(0)
  await expect(page.locator('.toc a[href="#/v07/4.4"]')).toHaveCount(1)

  expect(errors).toEqual([])
})

test('検索「リピーター ロック」で V07 が上位に出て、結果から節へ飛ぶ。索引は欄に入るまで取らない (#434)', async ({ page }) => {
  const errors = collectErrors(page)
  const indexRequests: string[] = []
  page.on('request', req => { if (req.url().includes(SEARCH_INDEX)) indexRequests.push(req.url()) })

  // ページを 2 枚開いても索引は取らない
  await page.goto('/docs/#/v07/4.3')
  await expect(article(page, 'v07/4.3')).toBeVisible()
  await page.locator('.pager-next').click()
  await expect(article(page, 'v07/4.4')).toBeVisible()
  await page.waitForLoadState('networkidle')
  expect(indexRequests).toHaveLength(0)

  // 欄に入った時に 1 回だけ取る
  const input = page.locator('.head-search input')
  await input.focus()
  await expect.poll(() => indexRequests.length).toBe(1)

  await input.fill('リピーター ロック')
  await expect(page.locator('.search[data-ready="1"]')).toBeVisible()
  const hits = page.locator('.hits a.hit')
  await expect(hits).toHaveCount(20)
  await expect(hits.first()).toHaveAttribute('data-id', 'v07/4.3')
  // 上位 3 件は全部 V07 (リピーター・コンパレーターのメモ)
  const top3 = await hits.evaluateAll(els => els.slice(0, 3).map(e => e.getAttribute('data-id') ?? ''))
  expect(top3.every(id => id.startsWith('v07/'))).toBe(true)
  // 抜粋は結果のページを取ってから出る
  await expect(hits.first().locator('.hit-snip mark').first()).toBeVisible()

  // ページの中の節 (v07/2 の中の §2.3) へ飛ぶ。見出しが上の帯のすぐ下に来る
  const hit = page.locator('.hits a.hit[data-id="v07/2.3"]')
  await expect(hit).toHaveAttribute('href', '#/v07/2?s=2.3')
  await hit.click()
  await expect(article(page, 'v07/2')).toBeVisible()
  await expect.poll(async () => page.evaluate(() => {
    const h = document.getElementById('sec-2.3')
    const head = document.querySelector('.head')
    if (!h || !head) return -1
    return Math.round(h.getBoundingClientRect().top - head.getBoundingClientRect().bottom)
  })).toBeLessThan(40)
  expect(await page.evaluate(() => {
    const h = document.getElementById('sec-2.3')!
    const head = document.querySelector('.head')!
    return h.getBoundingClientRect().top - head.getBoundingClientRect().bottom
  })).toBeGreaterThanOrEqual(0)

  // 戻ると同じ問いと結果。索引は取り直さない
  await page.goBack()
  await expect(input).toHaveValue('リピーター ロック')
  await expect(hits.first()).toHaveAttribute('data-id', 'v07/4.3')
  expect(indexRequests).toHaveLength(1)

  expect(errors).toEqual([])
})

test('幅 375 px でページが横に流れない (00 §4 の表・V14 の 17 列の表) (#434)', async ({ page }) => {
  const errors = collectErrors(page)
  await page.setViewportSize({ width: 375, height: 800 })

  // 228 行の表 (00 §4.1) と 17 列の表 (V14 §4.1)。表は枠の中で流れ、ページは流れない
  for (const id of ['v00/4.1', 'v14/4.1']) {
    await page.goto(`/docs/#/${id}`)
    await expect(article(page, id)).toBeVisible()
    expect(await overflowX(page), `${id} のページの横あふれ`).toBe(0)
    const tables = await article(page, id).locator('.tbl').evaluateAll(els => els.map(el => {
      const r = el.getBoundingClientRect()
      return { left: r.left, right: r.right, inner: el.scrollWidth, box: el.clientWidth }
    }))
    expect(tables.length).toBeGreaterThan(0)
    for (const t of tables) {
      expect(t.left).toBeGreaterThanOrEqual(0)
      expect(t.right).toBeLessThanOrEqual(375)
    }
    // 広い表は枠の中で横に流れる (枠より中身が広い)
    expect(tables.some(t => t.inner > t.box), `${id} の表が枠の中で流れる`).toBe(true)
  }

  // 目次は引き出し。開いても、ページを移っても横に流れない
  await expect(page.locator('.side-col')).toBeHidden()
  await page.locator('.head-menu').click()
  await expect(page.locator('.toc-col.open')).toBeVisible()
  expect(await overflowX(page)).toBe(0)
  // 引き出しは画面の中に収まり、中身は引き出しの中で縦に流れる (下の方のメモまで届く)
  const drawer = await page.locator('.toc-col.open').evaluate(el => {
    const r = el.getBoundingClientRect()
    return { top: r.top, bottom: r.bottom, inner: el.scrollHeight, box: el.clientHeight }
  })
  expect(drawer.top).toBeGreaterThan(0)
  expect(drawer.bottom).toBeLessThanOrEqual(800)
  expect(drawer.inner).toBeGreaterThan(drawer.box)
  await page.locator('.toc-col.open a[href="#/v14/4.2"]').click()
  await expect(article(page, 'v14/4.2')).toBeVisible()
  await expect(page.locator('.toc-col.open')).toHaveCount(0)
  expect(await overflowX(page)).toBe(0)

  // 検索の結果も本文の欄に出て、横に流れない
  await page.locator('.head-search input').fill('コンパレーター 減算')
  await expect(page.locator('.hits a.hit').first()).toBeVisible()
  expect(await overflowX(page)).toBe(0)

  expect(errors).toEqual([])
})
