import { test, expect } from '@playwright/test'
import type { BlockState } from '@redstone/sim'

// 盤面サイズの変更と回路全体のスライド (#226)。
//
// 要点は **確定するまで切り捨てない**こと。プレビューで盤面外の個数を出し、
// 「確定」で捨て、「取消」で戻す。ここが崩れると取り込んだ回路が黙って欠ける。

declare global {
  interface Window {
    __editorTest?: {
      placeAt: (x: number, y: number, z: number, type: string, opts?: Record<string, unknown>) => void
      clearAll: () => void
      getEditorBlockAt: (x: number, y: number, z: number) => BlockState | null
      getBoard: () => { x: number; y: number; z: number }
      getPendingOutside: () => number | null
      tapCell: (x: number, z: number) => void
      selectTool: (type: string) => void
    }
  }
}

const ready = async (page: import('@playwright/test').Page): Promise<void> => {
  await page.goto('/')
  await page.waitForFunction(() => !!window.__editorTest)
}

/** 目印になる 3 ブロックを置く */
const putMarks = (page: import('@playwright/test').Page) =>
  page.evaluate(() => {
    const ed = window.__editorTest!
    ed.clearAll()
    ed.placeAt(0, 0, 0, 'solid')
    ed.placeAt(1, 0, 0, 'wire')
    ed.placeAt(2, 0, 0, 'lamp')
  })

test('盤面サイズを変えると保持され、リロードしても残る', async ({ page }) => {
  await ready(page)
  await expect(page.getByTestId('board-panel')).toBeVisible()

  await page.getByTestId('board-x').fill('24')
  // 数値を触った時点ではプレビュー
  await expect(page.getByTestId('preview-bar')).toBeVisible()
  await page.getByTestId('preview-commit').click()
  await expect(page.getByTestId('preview-bar')).toHaveCount(0)
  expect(await page.evaluate(() => window.__editorTest!.getBoard())).toMatchObject({ x: 24 })

  // オートセーブは debounce があるので少し待ってからリロード
  await page.waitForTimeout(1200)
  await page.reload()
  await page.waitForFunction(() => !!window.__editorTest)
  expect(await page.evaluate(() => window.__editorTest!.getBoard())).toMatchObject({ x: 24 })
})

test('スライドは確定するまで反映されず、取消で元に戻る', async ({ page }) => {
  await ready(page)
  await putMarks(page)

  await page.getByTestId('slide-px').click()
  await expect(page.getByTestId('preview-bar')).toBeVisible()
  // プレビュー中は実体を動かさない
  expect(await page.evaluate(() => !!window.__editorTest!.getEditorBlockAt(0, 0, 0))).toBe(true)
  expect(await page.evaluate(() => !!window.__editorTest!.getEditorBlockAt(3, 0, 0))).toBe(false)

  await page.getByTestId('preview-cancel').click()
  await expect(page.getByTestId('preview-bar')).toHaveCount(0)
  expect(await page.evaluate(() => !!window.__editorTest!.getEditorBlockAt(0, 0, 0))).toBe(true)
})

test('スライドを確定すると回路全体が動く (相対位置は保たれる)', async ({ page }) => {
  await ready(page)
  await putMarks(page)

  await page.getByTestId('slide-px').click()
  await page.getByTestId('slide-px').click()   // 続けて押すと積み上がる
  await page.getByTestId('slide-pz').click()
  await page.getByTestId('preview-commit').click()
  await expect(page.getByTestId('preview-bar')).toHaveCount(0)

  const at = (x: number, y: number, z: number) =>
    page.evaluate(([x, y, z]) => window.__editorTest!.getEditorBlockAt(x, y, z)?.type ?? null, [x, y, z])
  expect(await at(2, 0, 1)).toBe('solid')
  expect(await at(3, 0, 1)).toBe('wire')
  expect(await at(4, 0, 1)).toBe('lamp')
  expect(await at(0, 0, 0)).toBeNull()
})

test('盤面の外に出したブロックは確定するまで残り、確定で切り捨てられる', async ({ page }) => {
  await ready(page)
  await putMarks(page)

  // 左へ 2 マス動かすと (0,0,0) と (1,0,0) が盤面外 (x=-2, -1) に出る
  await page.getByTestId('slide-nx').click()
  await page.getByTestId('slide-nx').click()
  await expect(page.getByTestId('preview-outside')).toContainText('2 ブロック')
  expect(await page.evaluate(() => window.__editorTest!.getPendingOutside())).toBe(2)

  // 逆に戻せば盤面外は消える = 確定前なら失われていない
  await page.getByTestId('slide-px').click()
  expect(await page.evaluate(() => window.__editorTest!.getPendingOutside())).toBe(1)
  await page.getByTestId('slide-px').click()
  expect(await page.evaluate(() => window.__editorTest!.getPendingOutside())).toBe(0)

  // もう一度外に出して確定 → そこで初めて失われる
  await page.getByTestId('slide-nx').click()
  await page.getByTestId('preview-commit').click()
  const kinds = await page.evaluate(() => {
    const ed = window.__editorTest!
    return [ed.getEditorBlockAt(0, 0, 0)?.type ?? null, ed.getEditorBlockAt(1, 0, 0)?.type ?? null]
  })
  // solid が盤面外へ出て消え、wire/lamp が 1 つ手前へ寄っている
  expect(kinds).toEqual(['wire', 'lamp'])
})

test('「中へ寄せる」で盤面外のブロックが戻る', async ({ page }) => {
  await ready(page)
  await putMarks(page)

  await page.getByTestId('slide-nx').click()
  await page.getByTestId('slide-nx').click()
  await expect(page.getByTestId('preview-fit')).toBeVisible()
  await page.getByTestId('preview-fit').click()
  expect(await page.evaluate(() => window.__editorTest!.getPendingOutside())).toBe(0)

  await page.getByTestId('preview-commit').click()
  const count = await page.evaluate(() => {
    const ed = window.__editorTest!
    return [0, 1, 2].filter(x => ed.getEditorBlockAt(x, 0, 0) !== null).length
  })
  expect(count, '寄せたのに失われている').toBe(3)
})

test('盤面を縮めると盤面外が出て、確定で切り捨てられる', async ({ page }) => {
  await ready(page)
  await putMarks(page)

  await page.getByTestId('board-x').fill('2')
  await expect(page.getByTestId('preview-outside')).toContainText('1 ブロック')
  await page.getByTestId('preview-commit').click()
  expect(await page.evaluate(() => !!window.__editorTest!.getEditorBlockAt(2, 0, 0))).toBe(false)
  expect(await page.evaluate(() => !!window.__editorTest!.getEditorBlockAt(1, 0, 0))).toBe(true)
})

test('高さパネルはページ送りと直接入力で遠い段へ行ける', async ({ page }) => {
  await ready(page)

  // 既定 16 段 → 8 段/ページ なのでページ送りが出る
  await expect(page.getByTestId('layer-page-label')).toHaveText('0-7')
  await page.getByTestId('layer-page-next').click()
  await expect(page.getByTestId('layer-page-label')).toHaveText('8-15')

  // 盤面を高くして、直接入力で遠い段へ
  await page.getByTestId('board-y').fill('40')
  await page.getByTestId('preview-commit').click()
  await page.getByTestId('layer-jump').fill('33')
  await page.getByTestId('layer-jump').press('Enter')
  // 直接入力した段を含むページが開く
  await expect(page.getByTestId('layer-page-label')).toHaveText('32-39')
})

test('プレビュー中はセルを叩いても配置されない (確定後は配置できる)', async ({ page }) => {
  await ready(page)
  await putMarks(page)

  // まず通常時に置けることを確かめる (この後の「置けない」が意味を持つように)
  await page.evaluate(() => {
    window.__editorTest!.selectTool('wire')
    window.__editorTest!.tapCell(9, 9)
  })
  expect(await page.evaluate(() => !!window.__editorTest!.getEditorBlockAt(9, 0, 9))).toBe(true)

  await page.getByTestId('slide-px').click()
  await expect(page.getByTestId('preview-bar')).toBeVisible()

  // プレビュー中は同じ操作が通らない
  await page.evaluate(() => window.__editorTest!.tapCell(10, 9))
  expect(
    await page.evaluate(() => !!window.__editorTest!.getEditorBlockAt(10, 0, 9)),
    'プレビュー中なのに配置されている',
  ).toBe(false)

  // 確定すれば再び置ける
  await page.getByTestId('preview-commit').click()
  await page.evaluate(() => window.__editorTest!.tapCell(10, 9))
  expect(await page.evaluate(() => !!window.__editorTest!.getEditorBlockAt(10, 0, 9))).toBe(true)
})

test('スライドを続けて押すと合計が出る (最後の 1 回ではない)', async ({ page }) => {
  await ready(page)
  await putMarks(page)

  await page.getByTestId('slide-px').click()
  await page.getByTestId('slide-px').click()
  await page.getByTestId('slide-pz').click()
  await expect(page.getByTestId('preview-label')).toHaveText('スライド 合計 (+2, +0, +1)')

  // 逆に押せば戻る
  await page.getByTestId('slide-nx').click()
  await expect(page.getByTestId('preview-label')).toHaveText('スライド 合計 (+1, +0, +1)')
})

test('取消と確定のボタンは常に押せる位置にある (ラベルで押し出されない)', async ({ page }) => {
  await ready(page)
  await putMarks(page)
  // 盤面外の警告まで出してバーを一番長い状態にする
  for (let i = 0; i < 3; i++) await page.getByTestId('slide-nx').click()
  await expect(page.getByTestId('preview-outside')).toBeVisible()

  for (const id of ['preview-fit', 'preview-commit', 'preview-cancel']) {
    const box = await page.getByTestId(id).boundingBox()
    expect(box, `${id} が見えない`).not.toBeNull()
    const width = page.viewportSize()!.width
    expect(box!.x + box!.width, `${id} が画面右端からはみ出している`).toBeLessThanOrEqual(width)
  }
})
