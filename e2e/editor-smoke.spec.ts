import { test, expect } from '@playwright/test'
import type { BlockState } from '@redstone/sim'

// ① 配置 → START → +1 → レバートグル → ランプ点灯 の基本回帰。
//
// グリッド配置と sim 状態読み取りだけ window.__editorTest 経由 (canvas ピクセル
// 校正の脆弱性を排除)。tool 選択・START・+1・レバートグルは data-testid の実ボタン
// クリックで駆動する。回路は fixture lever-wire-lamp と同じ「floor lever → wire×3
// → lamp」を再現し、レバー ON でランプが点灯することを検証する。

declare global {
  interface Window {
    __editorTest?: {
      placeAt: (x: number, y: number, z: number, type: string, opts?: Record<string, unknown>) => void
      getSimStateAt: (x: number, y: number, z: number) => BlockState | null
      getMode: () => 'edit' | 'sim'
    }
  }
}

test('editor: 配置→START→tick→レバートグルでランプ点灯', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => !!window.__editorTest)

  // パレットの主要ボタンが data-testid で引けること (ref 脆弱性の解消を担保)
  await expect(page.getByTestId('palette-wire')).toBeVisible()
  await expect(page.getByTestId('palette-lever')).toBeVisible()
  await expect(page.getByTestId('palette-lamp')).toBeVisible()

  // 回路構築 (y=0 石床、y=1 に lever/wire/wire/wire/lamp)
  await page.evaluate(() => {
    const ed = window.__editorTest!
    for (let x = 0; x <= 4; x++) {
      ed.placeAt(x, 0, 0, 'solid')
      ed.placeAt(x, 0, 1, 'solid')
    }
    ed.placeAt(0, 1, 0, 'lever')
    ed.placeAt(1, 1, 0, 'wire')
    ed.placeAt(2, 1, 0, 'wire')
    ed.placeAt(3, 1, 0, 'wire')
    ed.placeAt(4, 1, 0, 'lamp')
  })

  // START (実ボタン)
  await page.getByTestId('btn-start').click()
  await page.waitForFunction(() => window.__editorTest?.getMode() === 'sim')

  // +1 tick (実ボタン)。lever OFF のうちはランプ消灯のまま
  await page.getByTestId('btn-tick').click()
  await expect(page.getByTestId('tick-counter')).toHaveText('0001')

  const lampOff = await page.evaluate(() => window.__editorTest!.getSimStateAt(4, 1, 0))
  expect(lampOff?.type).toBe('lamp')
  expect((lampOff as { lit?: boolean }).lit).toBe(false)

  // レバートグル (トリガパネルの実ボタン data-testid=trigger-0-1-0)
  await page.getByTestId('trigger-0-1-0').click()

  // レバー ON でランプ点灯 (lever→wire は遅延なしで同 tick 反映)
  const lampOn = await page.evaluate(() => window.__editorTest!.getSimStateAt(4, 1, 0))
  expect((lampOn as { lit?: boolean }).lit).toBe(true)

  // 直近の wire が給電 15 になっていること
  const wire = await page.evaluate(() => window.__editorTest!.getSimStateAt(1, 1, 0))
  expect((wire as { power?: number }).power).toBe(15)
})
