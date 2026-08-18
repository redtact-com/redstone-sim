import { test, expect } from '@playwright/test'
import type { BlockState } from '@redstone/sim'

// #236 シミュレーション中に樽 (コンテナ) を触って入力にする。
//
// 樽 → コンパレーター → ランプ の最小回路で、
//   ① パネルのボタンで 1 段ずつ上げられる
//   ② 数値入力で離れた値を一発で入れられる (階数指定の用途)
// を実ボタン経由で確かめる。

declare global {
  interface Window {
    __editorTest?: {
      placeAt: (x: number, y: number, z: number, type: string, opts?: Record<string, unknown>) => void
      getSimStateAt: (x: number, y: number, z: number) => BlockState | null
      getMode: () => 'edit' | 'sim'
    }
  }
}

const outputAt = (page: import('@playwright/test').Page, x: number, y: number, z: number) =>
  page.evaluate(([x, y, z]) => {
    const b = window.__editorTest!.getSimStateAt(x, y, z)
    return b?.type === 'comparator' ? (b as { outputPower: number }).outputPower : -1
  }, [x, y, z])

test('sim 中に樽の中身を変えるとコンパレーターが読む', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => !!window.__editorTest)

  // y=0 に床、y=1 に 樽(0,1,0) → コンパレーター(1,1,0, 西向き=背面が樽) → ワイヤー → ランプ
  await page.evaluate(() => {
    const ed = window.__editorTest!
    for (let x = 0; x <= 3; x++) ed.placeAt(x, 0, 0, 'solid')
    ed.placeAt(0, 1, 0, 'container', { signal: 0 })
    ed.placeAt(1, 1, 0, 'comparator', { facing: 'east' })
    ed.placeAt(2, 1, 0, 'wire')
    ed.placeAt(3, 1, 0, 'lamp')
  })

  await page.getByTestId('btn-start').click()
  await page.waitForFunction(() => window.__editorTest?.getMode() === 'sim')

  // パネルにコンテナが並び、現在値 0 が出ている
  const input = page.getByTestId('container-signal-0-1-0')
  await expect(input).toHaveValue('0')

  // ① ボタンで +1 → コンパレーターは 2gt 後に出す
  await page.getByTestId('trigger-0-1-0').click()
  await expect(input).toHaveValue('1')
  for (let i = 0; i < 3; i++) await page.getByTestId('btn-tick').click()
  expect(await outputAt(page, 1, 1, 0)).toBe(1)

  // ② 数値入力で一発指定 (階数指定の用途。+1 を 12 回押させない)
  await input.fill('12')
  await expect(input).toHaveValue('12')
  for (let i = 0; i < 3; i++) await page.getByTestId('btn-tick').click()
  expect(await outputAt(page, 1, 1, 0)).toBe(12)

  // ランプまで届いている (12 → ワイヤー 1 マスで 11)
  const lamp = await page.evaluate(() => window.__editorTest!.getSimStateAt(3, 1, 0))
  expect((lamp as { lit?: boolean }).lit).toBe(true)

  // 15 の次は 0 に戻る
  await input.fill('15')
  await page.getByTestId('trigger-0-1-0').click()
  await expect(input).toHaveValue('0')
})
