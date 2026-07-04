import { test, expect } from '@playwright/test'
import type { BlockState } from '@redstone/sim'
import { readFileSync } from 'node:fs'

// ③ NBT エクスポート → インポートの往復。⋯ メニューの NBT 保存で download を捕捉し、
// クリア後にその .nbt を隠し file input へ流し込み、ブロックが復元されることを検証する。

declare global {
  interface Window {
    __editorTest?: {
      placeAt: (x: number, y: number, z: number, type: string, opts?: Record<string, unknown>) => void
      clearAll: () => void
      getEditorBlockAt: (x: number, y: number, z: number) => BlockState | null
    }
  }
}

test('editor: NBT エクスポート/インポートの往復でブロックが復元される', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => !!window.__editorTest)

  // 3 種のブロックを配置
  await page.evaluate(() => {
    const ed = window.__editorTest!
    ed.placeAt(0, 0, 0, 'wire')
    ed.placeAt(1, 0, 0, 'lever')
    ed.placeAt(2, 0, 0, 'repeater', { facing: 'east', delay: 2 })
  })
  expect(await page.evaluate(() => window.__editorTest!.getEditorBlockAt(2, 0, 0)?.type)).toBe('repeater')

  // ⋯ メニュー → NBT 保存 で download を捕捉
  await page.getByTestId('btn-menu').click()
  const downloadPromise = page.waitForEvent('download')
  await page.getByTestId('menu-nbt-save').click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('circuit.nbt')
  const nbtPath = await download.path()
  expect(nbtPath).toBeTruthy()

  // クリア → 空になったことを確認
  await page.evaluate(() => window.__editorTest!.clearAll())
  expect(await page.evaluate(() => window.__editorTest!.getEditorBlockAt(0, 0, 0))).toBeNull()

  // 保存した .nbt を隠し file input へ流し込み、復元を確認
  const bytes = readFileSync(nbtPath!)
  await page.getByTestId('nbt-file-input').setInputFiles({
    name: 'circuit.nbt',
    mimeType: 'application/octet-stream',
    buffer: bytes,
  })

  await page.waitForFunction(() => window.__editorTest!.getEditorBlockAt(0, 0, 0)?.type === 'wire')
  expect(await page.evaluate(() => window.__editorTest!.getEditorBlockAt(1, 0, 0)?.type)).toBe('lever')
  expect(await page.evaluate(() => window.__editorTest!.getEditorBlockAt(2, 0, 0)?.type)).toBe('repeater')
})
