import { test, expect, type Locator, type Page } from '@playwright/test'

// 読む用の Web (#434)。PR のプレビューと同じ形 = app の preview の /docs/ で回す
// (playwright.config.ts の webServer が docs-web をビルドして app/dist/docs へ写す)。
//
//   1. ページを開く → 「読んだ」+ 理解度 60 → 再読み込みで残る → 目次の集計が変わる
//   2. 検索「リピーター ロック」→ V07 が上位 → 結果を押すと節へ飛ぶ。
//      索引は検索の欄に入るまで取られない
//   3. 幅 375 px でページが横に流れない (00 §4 の表・V14 の 17 列の表)
//   4. fixture の札の「表示」→ canvas が描ける → 1 tick 進む → 2D に切り替える →
//      3 個目を開くと 1 個目が札に戻る
//   5. ビューアの上でも wheel でページが流れる。ビューアのあるページを 20 回移っても
//      「Too many active WebGL contexts」が出ない
//   6. 図: 9 か所とも節の見出しの直後に出る。図のチャンクは図のあるページでだけ取る。
//      幅 375 px では図の枠の中で横に流れる。暗い配色で図の色が変わる
//
// 札とビューアの細かい動き (押すまで取らない・再生と層・注記・Esc と外のクリック・rAF) は
// e2e/docs-fixture-viewer.spec.ts にある。

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
  // 未設定のつまみは 0 の位置にある。0 を選んでも (値は変わらないが) 理解度 0 が付き、読んだになる
  await expect(top.locator('output')).toHaveText('—')
  await top.locator('input[type="range"]').focus()
  await page.keyboard.press('Home')
  await expect(top.locator('output')).toHaveText('0')
  await expect(top.locator('input[type="checkbox"]')).toBeChecked()
  // 読んだを外すと、つまみも表示も未設定に戻る
  await top.locator('input[type="checkbox"]').uncheck()
  await expect(top.locator('output')).toHaveText('—')
  await expect(top.locator('input[type="range"]')).toHaveValue('0')

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

// ── 4・5: fixture の札と 3D/2D のビューア ──

/** 開ける札 (「表示」のある札) */
const openable = (page: Page) => page.locator('.fx-card:has(.fx-open)')

/** 札を開いて、ビューアが描けるまで待つ */
async function openCard(card: Locator) {
  await card.locator('.fx-open').click()
  await expect(card.locator('.fxv[data-ready="1"]')).toBeVisible({ timeout: 30_000 })
}

test('札の「表示」→ 描ける → 1 tick 進む → 2D → 3 個目を開くと 1 個目が札に戻る (#434)', async ({ page }) => {
  const errors = collectErrors(page)
  await page.goto('/docs/#/v15/4.8')
  await expect(article(page, 'v15/4.8')).toBeVisible()
  const list = openable(page)
  await expect(list).toHaveCount(7)
  await expect(page.locator('canvas')).toHaveCount(0)

  const first = list.nth(0)
  await openCard(first)
  await expect(first.locator('canvas')).toHaveCount(1)
  const fxv = first.locator('.fxv')
  await expect(fxv).toHaveAttribute('data-tick', '0')
  await fxv.locator('.fxv-step').click()
  await expect(fxv).toHaveAttribute('data-tick', '1')
  await expect(fxv.locator('.fxv-tick')).toHaveText('tick 1 / 10')

  // 2D は同じ canvas のまま (文脈は 1 個)
  await fxv.locator('.fxv-2d').click()
  await expect(fxv).toHaveAttribute('data-view', '2d')
  await expect(fxv.locator('.fxv-layer')).toBeVisible()
  await expect(first.locator('canvas')).toHaveCount(1)

  // 2 個目までは並ぶ。3 個目を開くと、一番古い 1 個目が札に戻る
  await openCard(list.nth(1))
  await expect(page.locator('canvas')).toHaveCount(2)
  await openCard(list.nth(2))
  await expect(page.locator('canvas')).toHaveCount(2)
  await expect(first.locator('.fx-open')).toHaveText('表示')
  await expect(first.locator('.fx-view')).toBeHidden()
  await expect(first.locator('canvas')).toHaveCount(0)
  await expect(page.locator('.fx-card[data-open]')).toHaveCount(2)

  expect(errors).toEqual([])
})

test('ビューアの上でも wheel でページが流れる。ビューアのあるページを 20 回移っても文脈の警告が出ない (#434)', async ({ page }) => {
  test.setTimeout(180_000)
  const messages: string[] = []
  page.on('console', m => {
    const text = m.text()
    if (m.type() !== 'log' && /webgl|context/i.test(text)) messages.push(`${m.type()}: ${text}`)
  })
  page.on('pageerror', e => messages.push(`pageerror: ${e.message}`))
  // WebGL の文脈を作った canvas をつかんでおく。外した canvas が GC されると文脈も消えるので、
  // 手放していなくても警告が出ない。GC が走らない場合 (上限は 16 個) を再現する
  await page.addInitScript(() => {
    const w = window as unknown as { __kept: HTMLCanvasElement[] }
    w.__kept = []
    const orig = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: unknown[]) {
      if (String(args[0]).startsWith('webgl') && !w.__kept.includes(this)) w.__kept.push(this)
      return (orig as (...a: unknown[]) => unknown).apply(this, args)
    } as typeof orig
  })
  await page.setViewportSize({ width: 1280, height: 600 })
  await page.goto('/docs/#/v15/4.8')
  await expect(article(page, 'v15/4.8')).toBeVisible()

  // 置いただけのビューアの上で wheel を回すと、ページが流れる
  const card = openable(page).first()
  await openCard(card)
  const canvas = card.locator('canvas')
  await canvas.scrollIntoViewIfNeeded()
  const box = (await canvas.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + Math.min(box.height, 300) / 2)
  const before = await page.evaluate(() => window.scrollY)
  await page.mouse.wheel(0, 120)
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(before + 60)
  await expect(card.locator('.fxv')).toHaveAttribute('data-interactive', '0')

  // 札のある 2 ページを行き来する。移るたびに前のビューアは外れ、移った先で 1 個開く (20 回)
  for (let i = 0; i < 20; i++) {
    const id = i % 2 === 0 ? 'v15/4.7' : 'v15/4.8'
    await page.goto(`/docs/#/${id}`)
    await expect(article(page, id)).toBeVisible()
    await expect(page.locator('canvas')).toHaveCount(0)
    await openCard(openable(page).first())
  }

  // 作った文脈は 21 個。移る前の 20 個は手放してあり、今のページの 1 個だけ生きている
  const lostOf = () => page.evaluate(() =>
    (window as unknown as { __kept: HTMLCanvasElement[] }).__kept
      .map(c => (c.getContext('webgl')?.isContextLost() ?? true) ? 1 : 0 as number))
  await expect.poll(async () => (await lostOf()).slice(0, 20)).toEqual(Array(20).fill(1))
  const lost = await lostOf()
  expect(lost).toHaveLength(21)
  expect(lost[20]).toBe(0)
  expect(messages.filter(m => /Too many active WebGL contexts/.test(m))).toEqual([])
  expect(messages).toEqual([])
})

// ── 6: 図 ──

/** 図のあるページと、その中の節 (docs-web/src/diagrams/placements.ts と同じ 9 か所) */
const DIAGRAM_PAGES: [page: string, secs: string[]][] = [
  ['v01/2', ['v01/2.1', 'v01/2.3', 'v01/2.4']],
  ['v02/2', ['v02/2.2']],
  ['v04/2', ['v04/2.1', 'v04/2.3']],
  ['v06/3', ['v06/3.6']],
  ['v07/2', ['v07/2.4']],
  ['v13/2', ['v13/2.2']],
]

test('図は節の見出しの直後に出る (9 か所)。図のチャンクは図のあるページでだけ取る (#434)', async ({ page }) => {
  const errors = collectErrors(page)
  const chunks: string[] = []
  const viewers: string[] = []
  page.on('request', r => {
    if (/\/assets\/diagrams-/.test(r.url())) chunks.push(r.url())
    if (/\/assets\/viewer-/.test(r.url())) viewers.push(r.url())
  })

  // 図の無いページでは取らない
  await page.goto('/docs/#/v07/4.3')
  await expect(article(page, 'v07/4.3')).toBeVisible()
  await page.waitForLoadState('networkidle')
  expect(chunks).toEqual([])
  await expect(page.locator('figure.dg')).toHaveCount(0)

  let total = 0
  for (const [id, secs] of DIAGRAM_PAGES) {
    await page.goto(`/docs/#/${id}`)
    await expect(article(page, id)).toBeVisible()
    await expect(article(page, id).locator('figure.dg')).toHaveCount(secs.length)
    for (const sec of secs) {
      // 見出しのすぐ次の兄弟が図。中の SVG は題を持ち、字が入っている
      const fig = article(page, id).locator(`[data-sec="${sec}"] + figure.dg`)
      await expect(fig).toHaveCount(1)
      await expect(fig.locator('.dg-cap')).toContainText('図: ')
      const svg = fig.locator('svg.dg-svg').first()
      await expect(svg).toHaveAttribute('role', 'img')
      expect((await svg.getAttribute('aria-label'))!.length).toBeGreaterThan(0)
      expect(await svg.locator('text').count()).toBeGreaterThan(3)
      total++
    }
  }
  expect(total).toBe(9)
  // 図のチャンクは最初の 1 回だけ。CSS も 1 個。ビューアのチャンクは取らない
  expect(chunks).toHaveLength(1)
  await expect(page.locator('style[data-dg-css]')).toHaveCount(1)
  expect(viewers).toEqual([])

  // 図のあるページでも、札の「表示」でビューアが開く (v13/2 は図と札の両方がある)
  await openCard(openable(page).first())
  expect(viewers).toHaveLength(1)

  expect(errors).toEqual([])
})

test('幅 375 px では図が枠の中で横に流れる。暗い配色で図の色が変わる (#434)', async ({ page }) => {
  const errors = collectErrors(page)
  await page.setViewportSize({ width: 375, height: 800 })
  await page.goto('/docs/#/v04/2')
  await expect(article(page, 'v04/2')).toBeVisible()
  const figs = article(page, 'v04/2').locator('figure.dg')
  await expect(figs).toHaveCount(2)
  expect(await overflowX(page)).toBe(0)
  for (let i = 0; i < 2; i++) {
    const m = await figs.nth(i).evaluate(el => {
      const r = el.getBoundingClientRect()
      el.scrollLeft = 200
      return { left: r.left, right: r.right, inner: el.scrollWidth, box: el.clientWidth, moved: el.scrollLeft }
    })
    expect(m.left).toBeGreaterThanOrEqual(0)
    expect(m.right).toBeLessThanOrEqual(375)
    expect(m.inner).toBeGreaterThan(m.box)
    expect(m.moved).toBe(200)
  }
  // 図を横に流しても、ページは流れない
  expect(await overflowX(page)).toBe(0)
  expect(await page.evaluate(() => window.scrollX)).toBe(0)

  // 明暗: 字 (色の指定の無い普通の字) と枠の地の色が配色で変わる
  const colors = () => figs.first().evaluate(el => ({
    text: getComputedStyle(el.querySelector('svg text.dg-t:not(.dg-on):not(.dg-m):not(.dg-acc)')!).fill,
    bg: getComputedStyle(el).backgroundColor,
  }))
  await page.emulateMedia({ colorScheme: 'light' })
  const light = await colors()
  await page.emulateMedia({ colorScheme: 'dark' })
  const dark = await colors()
  expect(light).toEqual({ text: 'rgb(28, 30, 33)', bg: 'rgb(255, 255, 255)' })
  expect(dark).toEqual({ text: 'rgb(228, 230, 234)', bg: 'rgb(21, 23, 26)' })

  expect(errors).toEqual([])
})
