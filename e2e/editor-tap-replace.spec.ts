import { test, expect } from '@playwright/test'
import type { BlockState } from '@redstone/sim'

// ⑤ 別ツールで既存ブロックのマスをタップ → 置き換え (#99)。
// canvas ピクセル校正を避けるため __editorTest.tapCell (handleBlockClick 相当) で叩く。

interface EditorTestApi {
  placeAt: (x: number, y: number, z: number, type: string, opts?: Record<string, unknown>) => void
  getEditorBlockAt: (x: number, y: number, z: number) => BlockState | null
  tapCell: (x: number, z: number) => void
  selectTool: (type: string) => void
}

declare global {
  interface Window { __editorTest?: EditorTestApi }
}

test('editor: 別ツール(ダスト)で既存リピーターのマスをタップ → wire に置換', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => !!window.__editorTest)

  // リピーターを配置 (既定選択ツールは wire)
  await page.evaluate(() => window.__editorTest!.placeAt(5, 0, 5, 'repeater', { facing: 'east', delay: 2 }))
  expect(await page.evaluate(() => window.__editorTest!.getEditorBlockAt(5, 0, 5)?.type)).toBe('repeater')

  // ダスト(wire)を持った状態でそのマスをタップ → 選択でなく置き換え
  await page.evaluate(() => window.__editorTest!.tapCell(5, 5))
  expect(await page.evaluate(() => window.__editorTest!.getEditorBlockAt(5, 0, 5)?.type)).toBe('wire')
})

test('editor: 同種ツールで既存ブロックのマスをタップ → 置換せず選択のまま', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => !!window.__editorTest)

  await page.evaluate(() => window.__editorTest!.placeAt(3, 0, 3, 'repeater', { facing: 'east', delay: 2 }))
  // repeater ツールに切り替え (状態反映のため tap は別 evaluate で)
  await page.evaluate(() => window.__editorTest!.selectTool('repeater'))
  await page.evaluate(() => window.__editorTest!.tapCell(3, 3))

  // 同種タップは選択(編集)なのでブロックは repeater のまま (delay も保持)
  const b = await page.evaluate(() => window.__editorTest!.getEditorBlockAt(3, 0, 3))
  expect(b?.type).toBe('repeater')
  expect((b as { delay?: number })?.delay).toBe(2)
})

test('editor: 空セルへの配置は従来どおり', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => !!window.__editorTest)

  // 空セルを wire でタップ → 配置
  await page.evaluate(() => window.__editorTest!.tapCell(7, 7))
  expect(await page.evaluate(() => window.__editorTest!.getEditorBlockAt(7, 0, 7)?.type)).toBe('wire')
})
