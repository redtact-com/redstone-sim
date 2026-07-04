import { test, expect } from '@playwright/test'
import type { DemoApi } from '../app/src/DemoPage'

// ② fixture デモページのロードと step。?demo=<name> が回路を自動構築し、
// window.__demo.step() が fixture-runner と同じ系列 (state[t]=ST完了後+inputs[t]) を
// たどることを、実機検証済み dynamic-connect-push の期待変化で検証する。

declare global {
  interface Window { __demo?: DemoApi }
}

test('demo: dynamic-connect-push のロードと tick 送り', async ({ page }) => {
  await page.goto('/?demo=dynamic-connect-push')
  await page.waitForFunction(() => (window.__demo?.getMaxTicks() ?? 0) > 0)
  await page.evaluate(() => window.__demo!.ready)

  // デモ領域コンテナが HUD ごと screenshot できるように data-testid を持つ
  const canvas = page.getByTestId('demo-canvas')
  await expect(canvas).toBeVisible()

  expect(await page.evaluate(() => window.__demo!.getFixtureName())).toBe('dynamic-connect-push')
  expect(await page.evaluate(() => window.__demo!.getMaxTicks())).toBe(26)

  // 起点 (tick 0): 中央ダストは未給電、まだピストンは押していない
  await expect(canvas).toHaveAttribute('data-demo-tick', '0')
  expect(await page.evaluate(() => window.__demo!.getStateAt(2, 1, 0))).toContain('power=0')

  // tick 6 まで送る (push は tick 3、給電確定は tick 5)
  await page.evaluate(() => { for (let i = 0; i < 6; i++) window.__demo!.step() })
  await expect(canvas).toHaveAttribute('data-demo-tick', '6')
  expect(await page.evaluate(() => window.__demo!.getTick())).toBe(6)

  // 押し込まれた redstone_block で中央ダストが south 接続 + 15 給電 (T 字化)
  const wire = await page.evaluate(() => window.__demo!.getStateAt(2, 1, 0))
  expect(wire).toContain('power=15')
  expect(wire).toContain('south=side')
  expect(await page.evaluate(() => window.__demo!.getStateAt(2, 1, 1))).toContain('redstone_block')

  // load() で別 fixture に差し替えられる
  expect(await page.evaluate(() => window.__demo!.load('lever-wire-lamp'))).toBe(true)
  await page.waitForFunction(() => window.__demo!.getFixtureName() === 'lever-wire-lamp')
  expect(await page.evaluate(() => window.__demo!.getMaxTicks())).toBe(8)
  await expect(canvas).toHaveAttribute('data-demo-tick', '0')
})
