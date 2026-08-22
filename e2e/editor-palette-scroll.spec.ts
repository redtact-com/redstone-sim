import { test, expect } from '@playwright/test'

// ホットバーの横スクロール (#333)。
//
// パレットは 41 項目 x 約 60px = 約 2460px あり PC の画面幅に収まらない。
// 以前は overflow-x:auto なのに **スクロールバーを消していて** PC から動かす手段が無く、
// さらに中央寄せのせいで**左端がスクロールしても届かなかった**。
// ここで固定するのは「狭い画面でも端の項目に到達して選べる」ことそのもの。

const LAST = 'palette-eraser'   // BLOCK_PALETTE の末尾
const FIRST = 'palette-move'    // 先頭

test('狭い画面: 見切れた末尾の項目に ▶ で到達して選べる', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 800 })
  await page.goto('/')
  await page.waitForFunction(() => !!window.__editorTest)

  const scroller = page.getByTestId('palette-scroller')
  const overflow = await scroller.evaluate(el => el.scrollWidth - el.clientWidth)
  expect(overflow, '900px ではパレットがはみ出しているはず').toBeGreaterThan(1)

  // はみ出しているので矢印が出る
  await expect(page.getByTestId('palette-scroll-left')).toBeVisible()
  await expect(page.getByTestId('palette-scroll-right')).toBeVisible()
  // 初期位置は左端なので ◀ は押せない
  await expect(page.getByTestId('palette-scroll-left')).toBeDisabled()

  // 末尾は最初は画面外
  expect(await scroller.evaluate(el => el.scrollLeft)).toBe(0)

  // ▶ 1 回で 1 画面ぶん進む
  await page.getByTestId('palette-scroll-right').click()
  await expect.poll(() => scroller.evaluate(el => el.scrollLeft)).toBeGreaterThan(100)

  // 末尾まで送ったら ▶ が無効・◀ が有効になる
  // (押し切るループにすると、滑らかスクロールの完了と disabled 化が競合して落ちる)
  await scroller.evaluate(el => { el.scrollLeft = el.scrollWidth })
  await expect(page.getByTestId('palette-scroll-right')).toBeDisabled()
  await expect(page.getByTestId('palette-scroll-left')).toBeEnabled()

  // **到達できるだけでなく選べる**こと
  await page.getByTestId(LAST).click()
  await expect(page.getByTestId(LAST)).toHaveCSS('box-shadow', /rgb/)
})

test('狭い画面: ◀ で左端へ戻れる (中央寄せで左が届かない問題)', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 800 })
  await page.goto('/')
  await page.waitForFunction(() => !!window.__editorTest)

  const scroller = page.getByTestId('palette-scroller')
  await scroller.evaluate(el => { el.scrollLeft = el.scrollWidth })
  const atEnd = await scroller.evaluate(el => el.scrollLeft)
  expect(atEnd).toBeGreaterThan(0)

  // ◀ 1 回で戻る向きに動く
  await page.getByTestId('palette-scroll-left').click()
  await expect.poll(() => scroller.evaluate(el => el.scrollLeft)).toBeLessThan(atEnd)

  // 左端まで戻ると ◀ が無効になり、先頭の項目を選べる
  await scroller.evaluate(el => { el.scrollLeft = 0 })
  await expect(page.getByTestId('palette-scroll-left')).toBeDisabled()
  await page.getByTestId(FIRST).click()
  await expect(page.getByTestId(FIRST)).toHaveCSS('box-shadow', /rgb/)
})

test('狭い画面: ホイールの縦回転で横に流れる', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 800 })
  await page.goto('/')
  await page.waitForFunction(() => !!window.__editorTest)

  const scroller = page.getByTestId('palette-scroller')
  await scroller.hover()
  await page.mouse.wheel(0, 300)
  await page.waitForTimeout(200)
  expect(await scroller.evaluate(el => el.scrollLeft),
    'ホイールを縦に回すと横スクロールするはず').toBeGreaterThan(0)
})

test('広い画面: 収まるので矢印は出ない', async ({ page }) => {
  await page.setViewportSize({ width: 2700, height: 800 })
  await page.goto('/')
  await page.waitForFunction(() => !!window.__editorTest)

  const scroller = page.getByTestId('palette-scroller')
  const overflow = await scroller.evaluate(el => el.scrollWidth - el.clientWidth)
  expect(overflow, '2700px なら収まるはず').toBeLessThanOrEqual(1)
  await expect(page.getByTestId('palette-scroll-left')).toHaveCount(0)
  await expect(page.getByTestId('palette-scroll-right')).toHaveCount(0)
})
