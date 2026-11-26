import { test, expect, type Locator, type Page } from '@playwright/test'

// 読む用の Web の fixture の札とビューア (#434)。app の preview の /docs/ で見る。
//
//   1. 札はただの HTML。ビューアのチャンクと fixture の JSON は「表示」を押すまで取らない
//   2. 「表示」→ 描ける → 1 tick 進む → 再生 → 最初へ → 2D と層 (canvas は 1 枚のまま)
//   3. 同時に生かすのは 2 個まで。ページを移ると全部外す。大きい 1 本は開けない
//   4. packages/viewer の 4 点: 開け閉めを 20 回しても WebGL の文脈の警告が出ない・
//      置いただけでは wheel でページが流れる (クリックで操作、Esc で戻す)・止まっている間は rAF が回らない
//
// エディタ・デモ・埋め込みは viewer に props を渡さないので、既定の動きは他の spec が守る。

/** fixture の札が 7 枚あるページ (V15 §4.8) */
const PAGE = '/docs/#/v15/4.8'

const cards = (page: Page) => page.locator('.fx-card:has(.fx-open)')
const ready = (card: Locator) => card.locator('.fxv[data-ready="1"]')

/** WebGL の文脈についての警告とエラーを集める */
function collectWebglMessages(page: Page): string[] {
  const out: string[] = []
  page.on('console', m => {
    const text = m.text()
    // スクリーンショットの読み出しで出る GPU の性能の注意は、文脈の数と関係が無い
    if (/webgl|context/i.test(text) && m.type() !== 'log' && !/GPU stall due to ReadPixels/.test(text)) out.push(`${m.type()}: ${text}`)
  })
  page.on('pageerror', e => out.push(`pageerror: ${e.message}`))
  return out
}

async function openPage(page: Page, url = PAGE) {
  await page.goto(url)
  await expect(page.locator('.fx-card').first()).toBeAttached({ timeout: 30_000 })
}

async function openCard(card: Locator) {
  await card.locator('.fx-open').click()
  await expect(ready(card)).toBeVisible({ timeout: 30_000 })
}

test('札は押すまでビューアを取らない。表示 → 1 tick → 再生 → 2D と層 (#434)', async ({ page }) => {
  const heavy: string[] = []
  page.on('request', r => { if (/\/assets\/viewer-|\/data\/fixtures\//.test(r.url())) heavy.push(r.url()) })
  await openPage(page)
  await expect(page.locator('.fx-card')).toHaveCount(7)
  await expect(page.locator('canvas')).toHaveCount(0)
  await page.waitForTimeout(500)
  expect(heavy).toEqual([])

  const card = cards(page).first()
  await expect(card.locator('.fx-name')).toHaveText('powered-rail-chain')
  await expect(card.locator('.fx-meta')).toHaveText('23 ブロック・10 tick')
  await openCard(card)
  // 取ったのは、ビューアのチャンク 1 個と、この fixture 1 本だけ
  expect(heavy.filter(u => /\/assets\/viewer-/.test(u))).toHaveLength(1)
  expect(heavy.filter(u => /\/data\/fixtures\//.test(u)).map(u => u.split('/').pop())).toEqual(['powered-rail-chain.json'])
  await expect(card.locator('.fx-open')).toHaveText('閉じる')
  await expect(card.locator('.fxv-note').first()).toHaveText('このエンジンの再生。実機の記録は fixture の expect')

  const fxv = card.locator('.fxv')
  await expect(fxv.locator('.fxv-tick')).toHaveText('tick 0 / 10')
  await fxv.locator('.fxv-step').click()
  await expect(fxv).toHaveAttribute('data-tick', '1')
  // 再生は最後の tick で止まる。もう一度押すと最初から流し直す
  await fxv.locator('.fxv-play').click()
  await expect(fxv.locator('.fxv-play')).toHaveText('止める')
  await expect(fxv).toHaveAttribute('data-tick', '10', { timeout: 10_000 })
  await expect(fxv).toHaveAttribute('data-playing', '0')
  await expect(fxv.locator('.fxv-step')).toBeDisabled()
  await fxv.locator('.fxv-rewind').click()
  await expect(fxv).toHaveAttribute('data-tick', '0')

  // 2D は同じ canvas のまま切り替える。層を下げると絵が変わる
  const canvas = card.locator('canvas')
  const before3d = await canvas.screenshot()
  await fxv.locator('.fxv-2d').click()
  await expect(fxv).toHaveAttribute('data-view', '2d')
  await expect(card.locator('canvas')).toHaveCount(1)
  // 最初の層は、ブロックのある一番上 (領域の一番上の y = 2 は空いている)
  await expect(fxv.locator('.fxv-layer')).toHaveText('層 y = 1 (2 / 3)')
  await page.waitForTimeout(300)
  const top = await canvas.screenshot()
  expect(top.equals(before3d)).toBe(false)
  await fxv.locator('.fxv-layer-down').click()
  await expect(fxv).toHaveAttribute('data-layer', '0')
  await expect(fxv.locator('.fxv-layer-down')).toBeDisabled()
  await page.waitForTimeout(300)
  expect((await canvas.screenshot()).equals(top)).toBe(false)
  await fxv.locator('.fxv-3d').click()
  await expect(fxv).toHaveAttribute('data-view', '3d')

  // 閉じると札に戻り、高さを取らない
  await card.locator('.fx-open').click()
  await expect(page.locator('canvas')).toHaveCount(0)
  await expect(card.locator('.fx-view')).toBeHidden()
  await expect(card.locator('.fx-open')).toHaveText('表示')
})

test('同時に生かすのは 2 個まで。ページを移ると全部外す。大きい 1 本は開けない (#434)', async ({ page }) => {
  await openPage(page)
  const list = cards(page)
  await openCard(list.nth(0))
  await openCard(list.nth(1))
  await expect(page.locator('canvas')).toHaveCount(2)
  // 3 個目を開くと、一番古い物が札に戻る
  await openCard(list.nth(2))
  await expect(page.locator('canvas')).toHaveCount(2)
  await expect(list.nth(0).locator('.fx-open')).toHaveText('表示')
  await expect(list.nth(0).locator('.fx-view')).toBeHidden()
  await expect(page.locator('.fx-card[data-open]')).toHaveCount(2)

  // ページを移ると全部外す。戻っても閉じたまま
  await page.goto('/docs/#/v15/4.9')
  await expect(page.locator('article[data-page="v15/4.9"]')).toBeVisible()
  await expect(page.locator('canvas')).toHaveCount(0)
  await page.goBack()
  await expect(page.locator('article[data-page="v15/4.8"]')).toBeVisible()
  await expect(page.locator('.fx-card[data-open]')).toHaveCount(0)

  // 476 ブロックの 1 本: 札は出るが、ボタンも置き場も無い
  await openPage(page, '/docs/#/v03/8')
  const big = page.locator('.fx-card[data-fx-card="door-5x5-kurigohan"]').first()
  await expect(big.locator('.fx-big')).toHaveText('大きいので埋め込まない')
  await expect(big.locator('.fx-meta')).toHaveText('476 ブロック・120 tick')
  await expect(big.locator('button')).toHaveCount(0)
  await expect(big.locator('.fx-view')).toHaveCount(0)
})

test('注記: skip つきは理由を出して再生する。表の中のタグの札は折りたたみにまとまる (#434)', async ({ page }) => {
  // V02 §8 の表 (タグが 5 本)
  await openPage(page, '/docs/#/v02/8')
  const fold = page.locator('details.fx-fold').first()
  await expect(fold.locator('summary')).toContainText('この表の fixture')
  await expect(fold.locator('.fx-card').first()).toBeHidden()
  // 表の中のチップを押すと、折りたたみが開いてその札へ寄る
  const chip = page.locator('.tbl .mk[data-fx]').first()
  const name = (await chip.getAttribute('data-fx'))!.split(' ')[0]
  await chip.click()
  await expect(fold.locator(`.fx-card[data-fx-card="${name}"]`)).toBeVisible()

  await openPage(page, '/docs/#/v15/4.10')
  const skip = page.locator('.fx-card[data-fx-card="detector-rail-cart-stay"]').first()
  await expect(skip.locator('.fx-note-skip')).toHaveText('今のエンジンは実機と違う')
  await expect(skip.locator('.fx-note').nth(1)).toHaveText('エンティティは描かない')
  await openCard(skip)
  await expect(skip.locator('.fxv-note-warn').first()).toContainText('今のエンジンは実機と違う: ')
  await expect(skip.locator('.fxv-note-warn').nth(1)).toHaveText('エンティティは描かない')
  await skip.locator('.fxv-step').click()
  await expect(skip.locator('.fxv')).toHaveAttribute('data-tick', '1')
})

test('開け閉めを 20 回しても WebGL の文脈の警告が出ない (#434)', async ({ page }) => {
  const messages = collectWebglMessages(page)
  // WebGL の文脈を作った canvas を全部つかんでおく。外した canvas が GC されると文脈も消えて、
  // 手放していなくても警告が出ない (手放さない版でも通ってしまう)。GC が走らない場合を再現する。
  // この条件で手放さない版を流すと「Too many active WebGL contexts」が出る (上限は 16 個)
  await page.addInitScript(() => {
    const w = window as unknown as { __kept: HTMLCanvasElement[] }
    w.__kept = []
    const orig = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: unknown[]) {
      if (String(args[0]).startsWith('webgl') && !w.__kept.includes(this)) w.__kept.push(this)
      return (orig as (...a: unknown[]) => unknown).apply(this, args)
    } as typeof orig
  })
  await openPage(page)
  const card = cards(page).first()
  for (let i = 0; i < 20; i++) {
    await openCard(card)
    await card.locator('.fx-open').click()
    await expect(page.locator('canvas')).toHaveCount(0)
  }
  await openCard(card)

  // 作った文脈は 21 個。外した 20 個は手放してあり、残っている 1 個は生きている
  const lostOf = () => page.evaluate(() =>
    (window as unknown as { __kept: HTMLCanvasElement[] }).__kept
      .map(c => (c.getContext('webgl')?.isContextLost() ?? true) ? 1 : 0 as number))
  await expect.poll(async () => (await lostOf()).slice(0, 20)).toEqual(Array(20).fill(1))
  const lost = await lostOf()
  expect(lost).toHaveLength(21)
  expect(lost[20]).toBe(0)
  expect(messages).toEqual([])

  // ページを移ると、その 1 枚も手放す
  await page.goto('/docs/#/v15/4.9')
  await expect(page.locator('article[data-page="v15/4.9"]')).toBeVisible()
  await expect.poll(async () => (await lostOf())[20]).toBe(1)
  expect(messages).toEqual([])
})

test('置いただけでは wheel でページが流れる。クリックで操作、Esc と外のクリックで戻す (#434)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 600 })
  await openPage(page)
  const card = cards(page).first()
  await openCard(card)
  const fxv = card.locator('.fxv')
  const canvas = card.locator('canvas')
  // ビューアの上にマウスを置き直す (ページが流れると位置が変わる)
  const hover = async () => {
    await canvas.scrollIntoViewIfNeeded()
    const r = (await canvas.boundingBox())!
    await page.mouse.move(r.x + r.width / 2, r.y + Math.min(r.height, 300) / 2)
  }
  const scrollY = () => page.evaluate(() => window.scrollY)
  /** wheel を回して、ページが流れた量を返す */
  const wheel = async (dy: number) => {
    await hover()
    const a = await scrollY()
    await page.mouse.wheel(0, dy)
    await page.waitForTimeout(300)
    return (await scrollY()) - a
  }

  // 置いただけ: ページが流れ、touch-action も奪わない
  await expect(fxv).toHaveAttribute('data-interactive', '0')
  await expect(canvas).toHaveCSS('touch-action', 'auto')
  expect(await wheel(80)).toBeGreaterThan(40)

  // 枠をクリックすると操作できる: wheel はビューアが使い、ページは流れない
  await hover()
  await page.mouse.down()
  await page.mouse.up()
  await expect(fxv).toHaveAttribute('data-interactive', '1')
  await expect(canvas).toHaveCSS('touch-action', 'none')
  expect(await wheel(80)).toBe(0)
  // 下の操作のボタンを押しても、操作できるまま
  await fxv.locator('.fxv-step').click()
  await expect(fxv).toHaveAttribute('data-interactive', '1')

  // Esc で戻る
  await page.keyboard.press('Escape')
  await expect(fxv).toHaveAttribute('data-interactive', '0')
  expect(await wheel(80)).toBeGreaterThan(40)

  // 外のクリックでも戻る
  await fxv.locator('.fxv-grab').click()
  await expect(fxv).toHaveAttribute('data-interactive', '1')
  await page.locator('.crumbs').scrollIntoViewIfNeeded()
  await page.locator('.crumbs span').last().click()
  await expect(fxv).toHaveAttribute('data-interactive', '0')
})

test('止まっている間は rAF が回らない。再生と操作の間だけ描く (#434)', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __raf: number }
    w.__raf = 0
    const orig = window.requestAnimationFrame.bind(window)
    window.requestAnimationFrame = cb => { w.__raf++; return orig(cb) }
  })
  await openPage(page)
  const card = cards(page).first()
  await openCard(card)
  const fxv = card.locator('.fxv')
  /** ms の間に予約された rAF の数 */
  const rafDuring = async (ms: number) => {
    const a = await page.evaluate(() => (window as unknown as { __raf: number }).__raf)
    await page.waitForTimeout(ms)
    return (await page.evaluate(() => (window as unknown as { __raf: number }).__raf)) - a
  }
  await page.waitForTimeout(300)
  expect(await rafDuring(500)).toBe(0)

  // 再生の間は tick ごとに描く (絵が変わった tick だけ)。止まるとまた 0
  await fxv.locator('.fxv-play').click()
  await expect(fxv).toHaveAttribute('data-playing', '0', { timeout: 10_000 })
  await page.waitForTimeout(300)
  expect(await rafDuring(500)).toBe(0)

  // 操作すると描く (ドラッグでカメラを回す)。離して少し経つとまた止まる
  const canvas = card.locator('canvas')
  await canvas.scrollIntoViewIfNeeded()
  await fxv.locator('.fxv-grab').click()
  await page.waitForTimeout(200)
  const still = await canvas.screenshot()
  const r = (await canvas.boundingBox())!
  await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2)
  await page.mouse.down()
  await page.mouse.move(r.x + r.width / 2 + 80, r.y + r.height / 2 + 10, { steps: 8 })
  await page.mouse.up()
  await page.waitForTimeout(200)
  expect((await canvas.screenshot()).equals(still)).toBe(false)
  expect(await rafDuring(500)).toBe(0)
})
