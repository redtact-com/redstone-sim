import { test, expect } from '@playwright/test'
import { exportToNbtBytes } from '../app/src/nbtIO'
import { mcToSim } from '@redstone/sim'
import type { BlockState } from '@redstone/sim'

// 選択中のブロックが**取り込んだ元のブロック**だと分かること (#356)。
//
// パレットは「置ける種類」の選択肢なので、黒曜石を選んでも「石」が光るだけ。
// 3D の見た目 (#343 / #351) が元どおりになっても、名前は画面のどこにも出ていなかった。
//
// 素材の .nbt は**テストの中で作る** (#358)。最初はローカルのファイルを絶対パスで
// 参照していて CI だけ ENOENT で落ちた。ファイルを置かず buffer で渡せば手元と CI で同じになる。

declare global {
  interface Window {
    __editorTest?: {
      placeAt: (x: number, y: number, z: number, type: string, opts?: Record<string, unknown>) => void
      tapCell: (x: number, z: number) => void
      selectTool: (type: string) => void
      getEditorBlockAt: (x: number, y: number, z: number) => { type: string } | null
    }
  }
}

/** 取り込み由来の状態 (name を持つ) を作るための .nbt */
function buildNbt(): Buffer {
  const blocks = new Map<string, BlockState>([
    ['0,0,0', mcToSim('obsidian')!],
    ['1,0,0', mcToSim('oak_log[axis=x]')!],
  ])
  return Buffer.from(exportToNbtBytes(blocks, 2, 1))
}

test('取り込んだブロックを選ぶと元の名前が出る / パレット配置では出ない', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => !!window.__editorTest)

  // 1) 取り込む (obsidian と oak_log[axis=x])
  await page.setInputFiles('[data-testid="nbt-file-input"]', {
    name: 'selected-block.nbt', mimeType: 'application/octet-stream', buffer: buildNbt(),
  })
  await page.waitForSelector('[data-testid="preview-commit"]')
  await page.click('[data-testid="preview-commit"]')
  await page.waitForFunction(() => window.__editorTest!.getEditorBlockAt(0, 0, 0)?.type === 'solid')

  // 2) 取り込んだブロックを選ぶ → 名前が出る
  //    (選択は**同種ツールでクリック**が条件。違うツールだと置き換えになる)
  await page.evaluate(() => window.__editorTest!.selectTool('solid'))
  await page.evaluate(() => window.__editorTest!.tapCell(0, 0))
  await expect(page.getByTestId('selected-block-name')).toHaveText('obsidian')

  // 3) 見た目プロパティも併せて出る
  await page.evaluate(() => window.__editorTest!.tapCell(1, 0))
  await expect(page.getByTestId('selected-block-name')).toHaveText('oak_log[axis=x]')

  // 4) **パレットから置いたブロックには出ない** (名前を持たないため)
  await page.evaluate(() => window.__editorTest!.placeAt(5, 0, 5, 'solid'))
  await page.evaluate(() => window.__editorTest!.tapCell(5, 5))
  await expect(page.getByTestId('selected-block-name')).toHaveCount(0)
})
