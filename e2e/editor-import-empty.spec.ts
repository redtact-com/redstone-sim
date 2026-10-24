import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { NbtFile, NbtCompound, NbtList, NbtInt, NbtString } from 'deepslate/nbt'

// 0 ブロックの取り込みで今の回路を失わない (#390)。
//
// 以前は 0 ブロックでもプレビューに進み、確定すると今の盤面が空で置き換わっていた。
// 確定は resetToBlocks を通るので undo も消え、400ms 後のオートセーブで保存も空になる。
// ここでは「プレビューに進まない・理由が見える・盤面と保存と undo が残る」を固定する。
//
// 読ませるファイルはテストの中で作る (#358 と同じく、手元にしか無いファイルは使わない)。

declare global {
  interface Window {
    __editorTest?: {
      placeAt: (x: number, y: number, z: number, type: string, opts?: Record<string, unknown>) => void
      clearAll: () => void
      getEditorBlockAt: (x: number, y: number, z: number) => { type: string } | null
    }
  }
}

const STORAGE_KEY = 'rdsim:editor:circuit'

type Pos = [number, number, number]

/** 構造 NBT を組み立てる。blocks の state は palette の番号 (範囲外の番号で壊れたファイルも作れる) */
function structureNbt(palette: string[], blocks: Array<[state: number, pos: Pos]>): Buffer {
  const size = [0, 1, 2].map(i => Math.max(...blocks.map(([, p]) => p[i])) + 1)
  const root = new NbtCompound()
    .set('size', new NbtList<NbtInt>(size.map(v => new NbtInt(v))))
    .set('palette', new NbtList<NbtCompound>(
      palette.map(name => new NbtCompound().set('Name', new NbtString(name)))))
    .set('blocks', new NbtList<NbtCompound>(blocks.map(([state, [x, y, z]]) =>
      new NbtCompound()
        .set('state', new NbtInt(state))
        .set('pos', new NbtList<NbtInt>([new NbtInt(x), new NbtInt(y), new NbtInt(z)])))))
    .set('entities', new NbtList<NbtCompound>([]))
  return Buffer.from(new NbtFile('', root, 'gzip', false, undefined).write())
}

/** 同じブロックを positions に置いた構造 NBT */
const sameBlocks = (name: string, positions: Pos[]) =>
  structureNbt(['minecraft:air', name], positions.map(p => [1, p]))

const PNG = () => Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const savedCount = (page: Page) => page.evaluate((key) => {
  const raw = localStorage.getItem(key)
  return raw ? Object.keys(JSON.parse(raw).blocks ?? {}).length : -1
}, STORAGE_KEY)

const marks = (page: Page) => page.evaluate(() =>
  [4, 5, 6].map(x => window.__editorTest!.getEditorBlockAt(x, 0, 4)?.type ?? null))

/** 目印の 3 ブロックを置き、保存されるまで待つ */
async function putMarks(page: Page) {
  await page.goto('/')
  await page.waitForFunction(() => !!window.__editorTest)
  await page.evaluate(() => {
    const ed = window.__editorTest!
    ed.clearAll()
    ed.placeAt(4, 0, 4, 'lever', { facing: 'east' })
    ed.placeAt(5, 0, 4, 'wire')
    ed.placeAt(6, 0, 4, 'lamp')
  })
  await page.waitForFunction(key => {
    const raw = localStorage.getItem(key as string)
    return !!raw && Object.keys(JSON.parse(raw).blocks ?? {}).length === 3
  }, STORAGE_KEY)
}

const load = (page: Page, buffer: Buffer) =>
  page.getByTestId('nbt-file-input').setInputFiles({
    name: 'x.nbt', mimeType: 'application/octet-stream', buffer,
  })

/** [見出し, ファイル, バーに出る理由, ログの書き出し] */
const CASES: Array<[string, () => Buffer, string | RegExp, string]> = [
  ['未対応ブロックだけ (tnt)', () => sameBlocks('minecraft:tnt', [[0, 0, 0], [1, 0, 0]]),
    '未対応ブロック 2 個', 'インポートできません'],
  ['空気だけ', () => sameBlocks('minecraft:air', [[0, 0, 0]]),
    '取り込めるブロックがありません', 'インポートできません'],
  ['NBT ではないファイル (PNG)', PNG, 'NBT', 'インポートできません'],
  // 読み込み中の例外 (handleImportNbt の catch)。文言はライブラリのものなので中身は問わない
  ['壊れた構造 NBT (palette に無い番号)',
    () => structureNbt(['minecraft:air', 'minecraft:redstone_lamp'], [[5, [0, 0, 0]]]),
    /理由: \S/, 'インポートエラー'],
]

for (const [label, bytes, reason, logHead] of CASES) {
  test(`${label}: プレビューに進まず理由が出て、盤面・undo・保存が残る`, async ({ page }) => {
    await putMarks(page)
    await expect(page.getByTitle('元に戻す')).toBeEnabled()

    await load(page, bytes())

    await expect(page.getByTestId('import-error')).toBeVisible()
    await expect(page.getByTestId('import-error-reason')).toContainText('今の回路はそのままです')
    await expect(page.getByTestId('import-error-reason')).toContainText(reason)
    await expect(page.getByText(new RegExp(`^${logHead}: `))).toHaveCount(1)
    await expect(page.getByTestId('preview-bar')).toHaveCount(0)
    expect(await marks(page)).toEqual(['lever', 'wire', 'lamp'])
    await expect(page.getByTitle('元に戻す')).toBeEnabled()

    // オートセーブの debounce (400ms) を越えて待っても、保存は 3 個のまま
    await page.waitForTimeout(1000)
    expect(await savedCount(page)).toBe(3)

    await page.reload()
    await page.waitForFunction(() => window.__editorTest?.getEditorBlockAt(6, 0, 4)?.type === 'lamp')
    expect(await marks(page)).toEqual(['lever', 'wire', 'lamp'])
  })
}

test('閉じるで消え、次に読める回路を選ぶと今までどおりプレビュー → 確定できる', async ({ page }) => {
  await putMarks(page)
  await load(page, sameBlocks('minecraft:tnt', [[0, 0, 0]]))
  await expect(page.getByTestId('import-error')).toBeVisible()
  await page.getByTestId('import-error-close').click()
  await expect(page.getByTestId('import-error')).toHaveCount(0)

  await load(page, sameBlocks('minecraft:tnt', [[0, 0, 0]]))
  await expect(page.getByTestId('import-error')).toBeVisible()
  // 続けて読める回路を選ぶと、理由は消えてプレビューになる
  await load(page, sameBlocks('minecraft:redstone_lamp', [[0, 0, 0]]))
  await expect(page.getByTestId('preview-bar')).toBeVisible()
  await expect(page.getByTestId('import-error')).toHaveCount(0)
  await expect(page.getByTestId('preview-label')).toContainText('1 ブロック')

  await page.getByTestId('preview-commit').click()
  await expect(page.getByTestId('preview-bar')).toHaveCount(0)
  await page.waitForFunction(() => window.__editorTest!.getEditorBlockAt(0, 0, 0)?.type === 'lamp')
})

test('プレビュー中に読めないファイルを選ぶと、プレビューは残して理由を出す', async ({ page }) => {
  await putMarks(page)
  await page.getByTestId('slide-px').click()
  await expect(page.getByTestId('preview-label')).toContainText('スライド')

  await load(page, sameBlocks('minecraft:tnt', [[0, 0, 0]]))
  await expect(page.getByTestId('import-error')).toBeVisible()
  // 読めなかったファイルはプレビューを置き換えない (取消・確定はそのまま選べる)
  await expect(page.getByTestId('preview-label')).toContainText('スライド')

  await page.getByTestId('preview-cancel').click()
  await expect(page.getByTestId('preview-bar')).toHaveCount(0)
  expect(await marks(page)).toEqual(['lever', 'wire', 'lamp'])

  // 別のプレビューを始めたら、前のファイルの理由は片付ける (2 本のバーを重ねたままにしない)
  await expect(page.getByTestId('import-error')).toBeVisible()
  await page.getByTestId('slide-px').click()
  await expect(page.getByTestId('preview-bar')).toBeVisible()
  await expect(page.getByTestId('import-error')).toHaveCount(0)
})

test('幅 390px でも理由と閉じるボタンが画面に収まり、長い理由は 3 行で切る', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await putMarks(page)
  // 種類の多い未対応ブロック (MOD のブロックを想定)。理由は 800 文字を超える
  const names = Array.from({ length: 30 }, (_, i) => `examplemod:machine_part_${String(i).padStart(2, '0')}`)
  await load(page, structureNbt(['minecraft:air', ...names], names.map((_, i) => [i + 1, [i, 0, 0]])))

  await expect(page.getByTestId('import-error')).toBeVisible()
  const reason = page.getByTestId('import-error-reason')
  await expect(reason).toContainText('未対応ブロック 30 個')
  // 全文は title に残す (画面では 3 行で切る)
  expect(await reason.getAttribute('title')).toContain('machine_part_29')

  for (const id of ['import-error-reason', 'import-error-close']) {
    const box = await page.getByTestId(id).boundingBox()
    expect(box, `${id} が見えない`).not.toBeNull()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width, `${id} が右へはみ出している`).toBeLessThanOrEqual(390)
  }
  // 切らずに出すと 30 行ほど (バーの高さ 500px 超) になり、盤面を押し下げる。3 行なら 70px 弱
  const bar = await page.getByTestId('import-error').boundingBox()
  expect(bar!.height, 'バーが 3 行で切れていない').toBeLessThanOrEqual(100)
})
