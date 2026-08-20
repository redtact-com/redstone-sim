import { test, expect } from '@playwright/test'
import { PNG } from 'pngjs'

// #238 カメラの寄り。
//
// **画面に映る大きさで確かめる**。距離を指定しても効かない状態が長く続いていたが、
// 「自動フィットがテクスチャ読み込み後に走って上書きする」せいで、
// ユニットテストでは捕まらなかった (実測: 距離 30 と 150 で描画が完全に同一)。

declare global {
  interface Window {
    __demo?: {
      ready: Promise<void>
      load: (json: string) => boolean
      setCamera: (o: Record<string, number>) => void
      fitCamera: () => void
    }
  }
}

/** 縦に細長い回路 (41 段)。旧実装が引きすぎていた形 */
const TALL = JSON.stringify({
  name: 'tall', mcVersion: '1.21.1', ticks: 2,
  region: { from: [0, 0, 0], to: [2, 40, 0] },
  blocks: [
    ...Array.from({ length: 41 }, (_, y) => ({ pos: [0, y, 0], block: 'stone' })),
    ...Array.from({ length: 41 }, (_, y) => ({ pos: [2, y, 0], block: 'glass' })),
    // **プリロード表に無いブロックを 1 つ混ぜる**。これがあるとビューアが
    // リソースを読み直して ready が再発火し、**自動フィットが後から上書きする**
    // 元の不具合の条件が揃う (無いと競合が起きず、テストが素通りする)
    { pos: [1, 0, 0], block: 'oak_stairs[facing=north,half=bottom,shape=straight,waterlogged=false]' },
  ],
  inputs: [], expect: [],
})

/** 描画されている中身の大きさ (HUD 文字を避けて上端 60px を除く) */
function contentSize(buf: Buffer): { w: number; h: number } {
  const png = PNG.sync.read(buf)
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1
  for (let y = 60; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      const i = (y * png.width + x) * 4
      if (png.data[i] + png.data[i + 1] + png.data[i + 2] > 210) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
  }
  return x1 < 0 ? { w: 0, h: 0 } : { w: x1 - x0 + 1, h: y1 - y0 + 1 }
}

test('デモ: カメラ距離の指定が描画に効く (#238)', async ({ page }) => {
  await page.goto('/?demo=lever-wire-lamp')
  await page.waitForFunction(() => !!window.__demo, null, { timeout: 30000 })
  await page.evaluate(() => window.__demo!.ready)
  expect(await page.evaluate(j => window.__demo!.load(j), TALL)).toBe(true)

  const canvas = page.getByTestId('demo-canvas')
  await page.evaluate(() => window.__demo!.setCamera({ distance: 30, rotX: 20, rotY: 30 }))
  await page.waitForTimeout(2500)
  const near = contentSize(await canvas.screenshot())

  await page.evaluate(() => window.__demo!.setCamera({ distance: 120 }))
  await page.waitForTimeout(1500)
  const far = contentSize(await canvas.screenshot())

  // **要求した距離が実際に効いているかを絶対値で見る**。
  // 41 段を距離 30 で見ると約 420px、自動フィット (約 39) に上書きされると約 324px。
  // 比だけ見ると両者を区別できないので、ここは閾値で切る (実測して 370 を採った)
  expect(near.h, `距離 30 の指定が効いていない (${near.h}px。上書きされると約 324px)`)
    .toBeGreaterThan(370)
  // 距離 4 倍なら見かけはおよそ 1/4
  expect(far.h, `距離を変えても大きさが変わらない (near=${near.h} far=${far.h})`)
    .toBeLessThan(near.h / 2)
})

test('デモ: 細長い回路でも自動フィットで画面に収まる (#238)', async ({ page }) => {
  await page.goto('/?demo=lever-wire-lamp')
  await page.waitForFunction(() => !!window.__demo, null, { timeout: 30000 })
  await page.evaluate(() => window.__demo!.ready)
  await page.evaluate(j => window.__demo!.load(j), TALL)
  await page.evaluate(() => window.__demo!.fitCamera())
  await page.waitForTimeout(2500)

  const size = contentSize(await page.getByTestId('demo-canvas').screenshot())
  // デモ領域は 540px。旧実装 (距離 = 高さ * 1.7) だと 3 割ほどしか使えなかった
  expect(size.h, `画面の高さを使えていない (${size.h}px)`).toBeGreaterThan(540 * 0.5)
  expect(size.h, 'はみ出している').toBeLessThanOrEqual(540)
})
