import { test, expect } from '@playwright/test'
import type { BlockState } from '@redstone/sim'

// ⑦ レバー/ボタンの取付面 (#111)。sim は元から Dir6 対応で、editor/UI/NBT が詰まっていた。
// 壁レバーは「取付面のブロックだけ」を強充電する = 反対側のダストには届かない、で検証する。

interface EditorTestApi {
  placeAt: (x: number, y: number, z: number, type: string, opts?: Record<string, unknown>) => void
  getEditorBlockAt: (x: number, y: number, z: number) => BlockState | null
  getSimStateAt: (x: number, y: number, z: number) => BlockState | null
  getMode: () => string
  clearAll: () => void
}
declare global {
  interface Window { __editorTest?: EditorTestApi }
}

test('editor: 壁レバーを配置でき、取付面の向きが保たれる', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => !!window.__editorTest)
  await page.evaluate(() => {
    window.__editorTest!.clearAll()
    window.__editorTest!.placeAt(5, 0, 5, 'lever', { facing: 'east' })   // 壁付け (西側の壁に付く)
    window.__editorTest!.placeAt(6, 0, 6, 'lever', { facing: 'down' })   // 天井付け
    window.__editorTest!.placeAt(7, 0, 7, 'button_stone', { facing: 'north' })
  })
  expect(await page.evaluate(() => window.__editorTest!.getEditorBlockAt(5, 0, 5) as { facing?: string })).toMatchObject({ type: 'lever', facing: 'east' })
  expect(await page.evaluate(() => window.__editorTest!.getEditorBlockAt(6, 0, 6) as { facing?: string })).toMatchObject({ type: 'lever', facing: 'down' })
  expect(await page.evaluate(() => window.__editorTest!.getEditorBlockAt(7, 0, 7) as { facing?: string })).toMatchObject({ type: 'button_stone', facing: 'north' })
})

test('sim: 壁レバーは取付面のブロックだけを強充電する', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => !!window.__editorTest)
  // 壁レバー(facing=east) を (5,0,5) に置く → 取付面は west 側 = (4,0,5)
  // その固体を挟んだ先のダスト (3,0,5) は点灯し、反対側 (6,0,5) の固体越しは点かない
  await page.evaluate(() => {
    const t = window.__editorTest!
    t.clearAll()
    t.placeAt(5, 0, 5, 'lever', { facing: 'east' })
    t.placeAt(4, 0, 5, 'solid')
    t.placeAt(3, 0, 5, 'wire')
    t.placeAt(6, 0, 5, 'solid')
    t.placeAt(7, 0, 5, 'wire')
  })
  await page.getByTestId('btn-start').click()
  await page.waitForFunction(() => window.__editorTest!.getMode() === 'sim')
  await page.getByTestId(/^trigger-/).first().click()
  await page.getByTestId('btn-tick').click()

  const attached = await page.evaluate(() => window.__editorTest!.getSimStateAt(3, 0, 5) as { power?: number })
  const opposite = await page.evaluate(() => window.__editorTest!.getSimStateAt(7, 0, 5) as { power?: number })
  expect(attached.power).toBe(15)   // 取付面側は強充電 → ダスト 15
  expect(opposite.power).toBe(0)    // 反対側の固体は充電されない
})
