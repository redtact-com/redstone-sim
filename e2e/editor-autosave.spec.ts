import { test, expect } from '@playwright/test'
import type { BlockState } from '@redstone/sim'

// ⑥ 編集中の回路がリロードで消えないこと (#109)。
// 保存は localStorage への debounce 書き込みなので、リロード前に保存完了を待つ。

interface EditorTestApi {
  placeAt: (x: number, y: number, z: number, type: string, opts?: Record<string, unknown>) => void
  getEditorBlockAt: (x: number, y: number, z: number) => BlockState | null
  clearAll: () => void
}

declare global {
  interface Window { __editorTest?: EditorTestApi }
}

const STORAGE_KEY = 'rdsim:editor:circuit'

/** debounce (400ms) の書き込みが終わるまで待つ */
async function waitSaved(page: import('@playwright/test').Page, minBlocks: number) {
  await page.waitForFunction(
    ([key, n]) => {
      const raw = localStorage.getItem(key as string)
      if (!raw) return false
      try { return Object.keys(JSON.parse(raw).blocks ?? {}).length >= (n as number) } catch { return false }
    },
    [STORAGE_KEY, minBlocks] as const,
  )
}

test('editor: 組んだ回路がリロード後も残る', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => !!window.__editorTest)
  await page.evaluate(() => {
    window.__editorTest!.placeAt(4, 0, 4, 'lever', { facing: 'east' })
    window.__editorTest!.placeAt(5, 0, 4, 'wire')
    window.__editorTest!.placeAt(6, 0, 4, 'lamp')
  })
  await waitSaved(page, 3)

  await page.reload()
  await page.waitForFunction(() => !!window.__editorTest)
  // 復元は mount 直後の effect で走る
  await page.waitForFunction(() => window.__editorTest!.getEditorBlockAt(6, 0, 4)?.type === 'lamp')

  expect(await page.evaluate(() => window.__editorTest!.getEditorBlockAt(4, 0, 4)?.type)).toBe('lever')
  expect(await page.evaluate(() => window.__editorTest!.getEditorBlockAt(5, 0, 4)?.type)).toBe('wire')
  await expect(page.getByText(/前回の回路を復元しました/)).toBeVisible()
})

test('editor: クリアすると保存も消え、リロードしても復活しない', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => !!window.__editorTest)
  await page.evaluate(() => window.__editorTest!.placeAt(2, 0, 2, 'wire'))
  await waitSaved(page, 1)

  await page.evaluate(() => window.__editorTest!.clearAll())
  await page.waitForFunction(key => localStorage.getItem(key as string) === null, STORAGE_KEY)

  await page.reload()
  await page.waitForFunction(() => !!window.__editorTest)
  expect(await page.evaluate(() => window.__editorTest!.getEditorBlockAt(2, 0, 2))).toBeNull()
})

test('editor: 保存データが壊れていても通常起動する', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => !!window.__editorTest)
  await page.evaluate(key => localStorage.setItem(key as string, '{壊れている'), STORAGE_KEY)

  await page.reload()
  await page.waitForFunction(() => !!window.__editorTest)
  // エディタは起動し、壊れた保存データは捨てられている
  await page.evaluate(() => window.__editorTest!.placeAt(1, 0, 1, 'wire'))
  expect(await page.evaluate(() => window.__editorTest!.getEditorBlockAt(1, 0, 1)?.type)).toBe('wire')
  expect(await page.evaluate(key => {
    const raw = localStorage.getItem(key as string)
    return raw === null ? 'cleared' : raw.slice(0, 1)
  }, STORAGE_KEY)).toMatch(/cleared|\{/)
})
