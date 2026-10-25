import { test, expect } from '@playwright/test'
import type { Page, CDPSession } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { PNG } from 'pngjs'

// 3D 盤面のクリック・タップでトリガ素子を操作する (#397)。
//
// **canvas の座標を実際にクリック・タップして**確かめる (押す操作はトリガ欄や postMessage を通さない)。
// 押す座標は __editorTest / __embed の blockToClient で、押す直前に毎回取り直す。
// 描画と同じ行列で計算した座標なので、本当にそこにレバーが描かれているかは
// 「押す前後でその周りの画素が変わり、離れた所は変わらない」ことで確かめる。

interface Pt { x: number; y: number }

/** 背景色 (IsometricView の gl.clearColor(0.1, 0.1, 0.12)) */
const BG = [26, 26, 31]

// ─── エディタ ─────────────────────────────────────────────────────────────

/** editor-smoke と同じ回路 (石の床 + レバー + ワイヤー ×3 + ランプ) と、画素の対照に使う離れた石 */
async function buildCircuit(page: Page) {
  await page.goto('/')
  await page.waitForFunction(() => !!window.__editorTest)
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
    ed.placeAt(12, 0, 12, 'solid')
  })
}

async function startSim(page: Page) {
  await page.getByTestId('btn-start').click()
  await page.waitForFunction(() => window.__editorTest?.getMode() === 'sim')
  await expect(page.getByText('Loading textures...')).toBeHidden({ timeout: 60_000 })
  await page.waitForFunction(() => window.__editorTest!.blockToClient(0, 1, 0) !== null)
}

const leverOn = (page: Page) =>
  page.evaluate(() => {
    const b = window.__editorTest!.getSimStateAt(0, 1, 0)
    return b?.type === 'lever' ? b.powered : null
  })
const lampLit = (page: Page) =>
  page.evaluate(() => {
    const b = window.__editorTest!.getSimStateAt(4, 1, 0)
    return b?.type === 'lamp' ? b.lit : null
  })
async function at(page: Page, x: number, y: number, z: number): Promise<Pt> {
  const p = await page.evaluate(([x, y, z]) => window.__editorTest!.blockToClient(x, y, z), [x, y, z])
  expect(p, `blockToClient(${x},${y},${z})`).not.toBeNull()
  return p!
}

// ─── 画素 ─────────────────────────────────────────────────────────────────

async function grab(page: Page, p: Pt, r: number): Promise<PNG> {
  const buf = await page.screenshot({
    clip: { x: Math.round(p.x) - r, y: Math.round(p.y) - r, width: 2 * r, height: 2 * r },
  })
  return PNG.sync.read(buf)
}
function countNotBg(png: PNG): number {
  let n = 0
  for (let i = 0; i < png.data.length; i += 4) {
    if (Math.abs(png.data[i] - BG[0]) + Math.abs(png.data[i + 1] - BG[1]) + Math.abs(png.data[i + 2] - BG[2]) > 6) n++
  }
  return n
}
function countDiff(a: PNG, b: PNG): number {
  let n = 0
  for (let i = 0; i < a.data.length; i += 4) {
    if (a.data[i] !== b.data[i] || a.data[i + 1] !== b.data[i + 1] || a.data[i + 2] !== b.data[i + 2]) n++
  }
  return n
}
const cursorOf = (page: Page) =>
  page.evaluate(() => getComputedStyle(document.querySelector('canvas')!).cursor)
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y)

// ─── PC ───────────────────────────────────────────────────────────────────

test.describe('PC (エディタの sim)', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('レバーをクリックすると切り替わり、ドラッグはカメラだけを回す', async ({ page }) => {
    await buildCircuit(page)
    await startSim(page)
    expect(await leverOn(page)).toBe(false)
    // START 直後 (ログがまだ少ない) の 3D の高さ。最後に、ログが増えても変わらないことを見る
    const h0 = (await page.locator('canvas').boundingBox())!.height

    // 計算した座標に何か描かれている (背景色でない画素がある)
    let p = await at(page, 0, 1, 0)
    await expect.poll(async () => countNotBg(await grab(page, p, 3))).toBeGreaterThan(0)

    // ホバー: レバーの上で pointer、何も無い所で grab
    await page.mouse.move(p.x, p.y)
    await expect.poll(() => cursorOf(page)).toBe('pointer')
    const box = (await page.locator('canvas').boundingBox())!
    await page.mouse.move(box.x + 15, box.y + 15)
    await expect.poll(() => cursorOf(page)).toBe('grab')

    // クリックでレバーが ON になり、ランプが点く
    const near0 = await grab(page, p, 6)
    const ctrl = await at(page, 12, 0, 12)
    const far0 = await grab(page, ctrl, 6)
    await page.mouse.click(p.x, p.y)
    await expect.poll(() => leverOn(page)).toBe(true)
    expect(await lampLit(page)).toBe(true)
    // 押した所の絵が変わり (レバーの向き・ワイヤーの色)、離れた石は変わらない。
    // 計算した座標と実際の描画が合っていることの確かめ
    await expect.poll(async () => countDiff(near0, await grab(page, p, 6))).toBeGreaterThan(10)
    expect(countDiff(far0, await grab(page, ctrl, 6))).toBe(0)

    // 80px ドラッグ: レバーは変わらず、カメラが回る (レバーの画面座標が動く)
    p = await at(page, 0, 1, 0)
    await page.mouse.move(p.x, p.y)
    await page.mouse.down()
    for (let i = 1; i <= 8; i++) {
      await page.mouse.move(p.x + i * 10, p.y)
      if (i === 4) expect(await cursorOf(page)).toBe('grabbing')
    }
    await page.mouse.up()
    expect(await leverOn(page)).toBe(true)
    const moved = await at(page, 0, 1, 0)
    expect(dist(moved, p)).toBeGreaterThan(5)

    // 回した後も、取り直した座標のクリックで OFF にできる
    await page.mouse.click(moved.x, moved.y)
    await expect.poll(() => leverOn(page)).toBe(false)

    // 何も無い所 (canvas の左上隅) のクリックでは変わらない
    await page.mouse.click(box.x + 15, box.y + 15)
    await page.waitForTimeout(300)
    expect(await leverOn(page)).toBe(false)

    // ログ欄の高さは固定 (#397)。ログが増えても 3D が縮まないので、押した直後に盤面がずれない。
    // 続けて押しても、同じ座標のまま切り替わり続ける
    const q = await at(page, 0, 1, 0)
    for (let i = 0; i < 4; i++) {
      await page.mouse.click(q.x, q.y)
      await expect.poll(() => leverOn(page)).toBe(i % 2 === 0)
    }
    expect((await page.locator('canvas').boundingBox())!.height).toBe(h0)
  })
})

// ─── 埋め込み ─────────────────────────────────────────────────────────────

test.describe('埋め込み', () => {
  test.use({ viewport: { width: 900, height: 600 } })

  test('view では盤面を押しても変わらず、interact で押すと切り替わる', async ({ page }) => {
    // embed-smoke と同じ手順: エディタで組んで NBT を書き出し、rdsim:load で流す
    await page.goto('/')
    await page.waitForFunction(() => !!window.__editorTest)
    await page.evaluate(() => {
      const ed = window.__editorTest!
      ed.placeAt(0, 0, 0, 'lever')
      ed.placeAt(1, 0, 0, 'wire')
      ed.placeAt(2, 0, 0, 'lamp')
    })
    await page.getByTestId('btn-menu').click()
    const download = page.waitForEvent('download')
    await page.getByTestId('menu-nbt-save').click()
    const bytes = Array.from(readFileSync((await (await download).path())!))

    await page.goto('/?embed=1')
    await page.waitForFunction(() => !!window.__embed)
    await page.evaluate((arr) => {
      const u8 = new Uint8Array(arr)
      window.postMessage({ v: 1, type: 'rdsim:load', format: 'structure-nbt', bytes: u8.buffer }, '*')
    }, bytes)
    await page.waitForFunction(() => window.__embed!.isLoaded())
    await expect(page.getByText('Loading textures...')).toBeHidden({ timeout: 60_000 })
    await page.waitForFunction(() => window.__embed!.blockToClient(0, 0, 0) !== null)

    const powered = () => page.evaluate(() => {
      const b = window.__embed!.getStateAt(0, 0, 0)
      return b?.type === 'lever' ? b.powered : null
    })
    const leverAt = async () => (await page.evaluate(() => window.__embed!.blockToClient(0, 0, 0)))!

    // view (既定): 押しても変わらず、カーソルも変えない
    expect(await page.evaluate(() => window.__embed!.getMode())).toBe('view')
    let p = await leverAt()
    await page.mouse.move(p.x, p.y)
    await page.mouse.click(p.x, p.y)
    await page.waitForTimeout(300)
    expect(await powered()).toBe(false)
    expect(await cursorOf(page)).toBe('grab')

    // interact: トリガ欄が出て 3D が縮むので、座標は取り直す
    await page.getByTestId('embed-mode-interact').click()
    await page.waitForFunction(() => window.__embed!.getMode() === 'interact')
    p = await leverAt()
    await page.mouse.click(p.x, p.y)
    await expect.poll(powered).toBe(true)
  })
})

// ─── スマホ幅 (タッチ) ─────────────────────────────────────────────────────

test.describe('スマホ幅 (タッチ)', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

  test('タップで切り替わる。長押し・ドラッグ・ピンチでは切り替わらない', async ({ page }) => {
    await buildCircuit(page)
    await startSim(page)
    expect(await leverOn(page)).toBe(false)

    // 押す点が canvas であること (トリガ欄などが重なっていない)
    let p = await at(page, 0, 1, 0)
    expect(await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.tagName, [p.x, p.y])).toBe('CANVAS')

    // 1 回目のタップ。ここで切り替わらなければ、以降の CDP の操作も信用できない
    await page.touchscreen.tap(p.x, p.y)
    await expect.poll(() => leverOn(page)).toBe(true)

    const cdp: CDPSession = await page.context().newCDPSession(page)
    // touchEnd には離す指だけを並べる。[] で全部離す
    const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', pts: [number, number][]) =>
      cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) })

    // 6px 揺れたタップは押せる (ON → OFF)
    p = await at(page, 0, 1, 0)
    await touch('touchStart', [[p.x, p.y]])
    await touch('touchMove', [[p.x + 6, p.y]])
    await touch('touchEnd', [])
    await expect.poll(() => leverOn(page)).toBe(false)

    // 700ms の長押しは押さない
    await touch('touchStart', [[p.x, p.y]])
    await page.waitForTimeout(700)
    await touch('touchEnd', [])
    await page.waitForTimeout(300)
    expect(await leverOn(page)).toBe(false)

    // 中心から 10px 外した点: マウスのクリックは外れる (その点の光線はレバーに当たらない) が、
    // タップは周り (半径 6px と 12px) を探して拾う
    const off = { x: p.x - 10, y: p.y }
    await page.mouse.click(off.x, off.y)
    await page.waitForTimeout(300)
    expect(await leverOn(page), 'マウスでは外れる点のはず').toBe(false)
    await touch('touchStart', [[off.x, off.y]])
    await touch('touchEnd', [])
    await expect.poll(() => leverOn(page)).toBe(true)
    // 40px 外したタップは拾わない
    await touch('touchStart', [[p.x - 40, p.y]])
    await touch('touchEnd', [])
    await page.waitForTimeout(300)
    expect(await leverOn(page)).toBe(true)

    // 1 本指で 64px ドラッグ: 変わらず、カメラが回る
    p = await at(page, 0, 1, 0)
    await touch('touchStart', [[p.x, p.y]])
    for (let i = 1; i <= 8; i++) await touch('touchMove', [[p.x + i * 8, p.y]])
    await touch('touchEnd', [])
    await page.waitForTimeout(300)
    expect(await leverOn(page)).toBe(true)
    const moved = await at(page, 0, 1, 0)
    expect(dist(moved, p)).toBeGreaterThan(5)

    // 1 本目の指をレバーに置き、2 本目の指も触れてから両方離す (動かさない): 変わらない。
    // カメラが動かないので、ピンチの取り消しが無ければレバーに当たって切り替わってしまう
    p = moved
    await touch('touchStart', [[p.x, p.y]])
    await touch('touchStart', [[p.x, p.y], [p.x + 60, p.y - 60]])
    await touch('touchEnd', [])
    await page.waitForTimeout(300)
    expect(await leverOn(page)).toBe(true)
    expect(dist(await at(page, 0, 1, 0), p)).toBeLessThan(0.5)

    // レバーに 1 本目の指を置いたまま、2 本目を広げるピンチ: 変わらず、寄る (レバーが画面の端へ動く)。
    // 寄りすぎるとレバーが画面の外へ出て最後のタップを確かめられないので、広げるのは少しだけ
    p = moved
    await touch('touchStart', [[p.x, p.y]])
    await touch('touchStart', [[p.x, p.y], [p.x + 60, p.y - 60]])
    for (let i = 1; i <= 6; i++) await touch('touchMove', [[p.x, p.y], [p.x + 60 + i * 4, p.y - 60 - i * 4]])
    await touch('touchEnd', [])
    await page.waitForTimeout(300)
    expect(await leverOn(page)).toBe(true)
    expect(dist(await at(page, 0, 1, 0), p)).toBeGreaterThan(3)
    // ページごと拡大されていない (2 本の指とも canvas の上で、touch-action: none が効いている)
    expect(await page.evaluate(() => window.visualViewport?.scale ?? 1)).toBe(1)

    // 最後にもう一度タップして、操作が詰まっていない (指の数え違いでピンチ扱いになっていない) こと
    p = await at(page, 0, 1, 0)
    expect(await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.tagName, [p.x, p.y])).toBe('CANVAS')
    await touch('touchStart', [[p.x, p.y]])
    await touch('touchEnd', [])
    await expect.poll(() => leverOn(page)).toBe(false)
  })
})
