#!/usr/bin/env node
// ============================================================
// 読む用の Web (/docs/。#434) を台本どおりに操作して GIF を撮る CLI。
//
//   node tools/demo/docs-gif.mjs [options]
//
// 台本は 2 本 (--script で選ぶ)。
//
// reader (既定): 目次 → ページ → 理解度 → 検索
//   1. 最初の画面
//   2. 目次で V07 → 「4」の ## を開き、§4.3 のページへ
//   3. 「読んだ」を付け、理解度を 60 まで動かす (目次と上の帯の集計が変わる)
//   4. 検索の欄に「リピーター ロック」と打つ → 結果から節へ飛ぶ
//
// viewer: 図 → 3D の再生 → 2D
//   1. V13 §2 のページ → §2.2 の見出しの直後の図 (ピストンの時系列)
//   2. 同じ節の fixture の札 (piston-basic) の「表示」→ 3D のビューア
//   3. 「再生」(最後の tick まで。撮れた tick だけがコマになる)
//   4. 「最初へ」→ 2D → 1 tick ずつ進める → 層を 1 つ下げて戻す
//
// options:
//   --script <name>  reader | viewer (既定 reader)
//   --out <path>     出力先 (既定 .github/pr-assets/<branch>/docs-<script>.gif)
//   --port <n>       vite preview のポート (既定 4318)
//   --base-url <url> 既存の配信先に対して撮る (PR のプレビューなど)。build も preview も起動しない
//   --no-build       既存の app/dist と docs-web/dist を使う (写すだけ)
//   --width/--height ビューポート (既定は reader 960x600・viewer 1280x720)
//   --frames <dir>   各フレームの PNG もこのフォルダに残す (目で確かめる用)
//
// PR のプレビューと同じ形で撮る: app のビルド → build:docs → app/dist/docs へ写す →
// app の preview の /docs/。撮り終えたら app/dist/docs は消す
// (手元の app/dist を本番と同じ中身に戻す)。
// GIF の合成・サーバ待ち・preview の起動は demo-gif.mjs と同じ物 (lib.mjs) を使う。
// ============================================================

import { PNG } from 'pngjs'
import { execSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { REPO_ROOT, branchName, encodeGif, launchBrowser, startAppPreview, waitForServer } from './lib.mjs'

const PAGE = 'v07/4.3'
const QUERY = ['リピーター', 'リピーター ロック']
const HIT = 'v07/2.3'

/** viewer の台本: 図と札の両方がある節 */
const VIEWER_PAGE = 'v13/2'
const VIEWER_SEC = 'v13/2.2'
const VIEWER_FIXTURE = 'piston-basic'

function parseArgs(argv) {
  const opts = { script: 'reader', out: null, port: 4318, baseUrl: null, build: true, width: null, height: null, frames: null }
  const rest = argv.slice(2)
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]
    if (a === '--out') opts.out = rest[++i]
    else if (a === '--script') opts.script = rest[++i]
    else if (a === '--port') opts.port = parseInt(rest[++i], 10)
    else if (a === '--base-url') opts.baseUrl = rest[++i]
    else if (a === '--no-build') opts.build = false
    else if (a === '--width') opts.width = parseInt(rest[++i], 10)
    else if (a === '--height') opts.height = parseInt(rest[++i], 10)
    else if (a === '--frames') opts.frames = rest[++i]
    else throw new Error(`不明な引数: ${a}`)
  }
  if (!(opts.script in SCRIPTS)) throw new Error(`不明な台本: ${opts.script} (${Object.keys(SCRIPTS).join(' | ')})`)
  opts.width ??= VIEWPORTS[opts.script].width
  opts.height ??= VIEWPORTS[opts.script].height
  return opts
}

/** 台本 reader: 目次 → ページ → 理解度 → 検索 */
async function scriptReader({ page, docsUrl, shot }) {
  // 1. 最初の画面
  await page.goto(`${docsUrl}#/`, { waitUntil: 'load' })
  await page.locator('.toc-doc').first().waitFor()
  await page.locator('.home').waitFor()
  await shot('最初の画面', 1600)

  // 2. 目次: メモ → ## → ページ
  const [docKey] = PAGE.split('/')
  const manifest = await (await page.request.get(`${docsUrl}data/manifest.json`)).json()
  const doc = manifest.docs.find(d => d.key === docKey)
  const groupIndex = doc.groups.findIndex(g => g.pages.includes(PAGE))
  if (groupIndex < 0) throw new Error(`目次に ${PAGE} が無い`)
  const tocDoc = page.locator(`.toc-doc[data-doc="${docKey}"]`)
  await tocDoc.locator('> .toc-doc-row').click()
  await tocDoc.locator('.toc-groups').waitFor()
  await shot('メモを開く', 900)
  const link = tocDoc.locator(`a[href="#/${PAGE}"]`)
  if (await link.count() === 0) {
    await tocDoc.locator('.toc-groups > li').nth(groupIndex).locator('.toc-group-row').click()
    await link.waitFor()
    await shot('## を開く', 900)
  }
  await link.click()
  await page.locator(`article[data-page="${PAGE}"]`).waitFor()
  await shot('ページ', 1800)

  // 少し読む
  for (const y of [260, 520]) {
    await page.evaluate(top => window.scrollTo(0, top), y)
    await shot(`読む ${y}`, 700)
  }
  await page.evaluate(() => window.scrollTo(0, 0))
  await shot('上へ戻る', 600)

  // 3. 読んだ + 理解度
  const bar = page.locator('.status-bar[data-where="top"]')
  await bar.locator('input[type="checkbox"]').check()
  await shot('読んだ', 900)
  const range = bar.locator('input[type="range"]')
  for (const u of [20, 40, 60]) {
    await range.fill(String(u))
    await shot(`理解度 ${u}`, u === 60 ? 1600 : 350)
  }

  // 4. 検索
  const input = page.locator('.head-search input')
  await input.focus()
  await shot('検索の欄', 600)
  for (const q of QUERY) {
    await input.fill(q)
    await page.locator('.search[data-ready="1"] .hits a.hit').first().waitFor()
    // 抜粋は結果のページを取ってから出る
    await page.locator('.hits a.hit .hit-snip mark').first().waitFor()
    await page.waitForLoadState('networkidle')
    await shot(`検索 ${q}`, q === QUERY[QUERY.length - 1] ? 2200 : 700)
  }
  const hit = page.locator(`.hits a.hit[data-id="${HIT}"]`)
  await hit.scrollIntoViewIfNeeded()
  await shot('結果を選ぶ', 900)
  await hit.click()
  await page.locator(`article[data-page="${HIT.replace(/\.[^./]+$/, '')}"]`).waitFor()
  await page.waitForFunction(id => {
    const h = document.getElementById(id)
    return !!h && h.getBoundingClientRect().top < window.innerHeight / 2
  }, `sec-${HIT.split('/')[1]}`, { polling: 100 })
  await shot('節へ飛ぶ', 2600)
}

/** 台本 viewer: 図 → 3D の再生 → 2D */
async function scriptViewer({ page, docsUrl, shot, frames }) {
  const attr = (name, value) => page.waitForFunction(
    ([n, v]) => document.querySelector('.fxv')?.getAttribute(n) === v, [name, value], { polling: 50 })
  /** 要素の上端を、上の帯の少し下へ持って来る */
  const scrollTo = (selector, gap = 12) => page.evaluate(([sel, g]) => {
    const el = document.querySelector(sel)
    const head = document.querySelector('.head')
    const top = el.getBoundingClientRect().top - (head ? head.getBoundingClientRect().bottom : 0) - g
    window.scrollBy(0, top)
  }, [selector, gap])

  // 1. ページ → 図
  await page.goto(`${docsUrl}#/${VIEWER_PAGE}`, { waitUntil: 'load' })
  await page.locator(`article[data-page="${VIEWER_PAGE}"]`).waitFor()
  const figure = `[data-sec="${VIEWER_SEC}"] + figure.dg`
  await page.locator(figure).waitFor()
  await shot('ページ', 1400)
  await scrollTo(`[data-sec="${VIEWER_SEC}"]`)
  await shot('図 (上)', 2600)
  // 図が画面より高い時は、下の半分も見せる
  const rest = await page.evaluate(sel => {
    const r = document.querySelector(sel).getBoundingClientRect()
    return Math.round(r.bottom - window.innerHeight + 16)
  }, figure)
  if (rest > 40) {
    await page.evaluate(dy => window.scrollBy(0, dy), rest)
    await shot('図 (下)', 2600)
  }

  // 2. 札 → 3D のビューア
  const cardSel = `.fx-card[data-fx-card="${VIEWER_FIXTURE}"]`
  const card = page.locator(cardSel).first()
  await card.scrollIntoViewIfNeeded()
  await scrollTo(cardSel, 120)
  await shot('札', 1500)
  await card.locator('.fx-open').click()
  const fxv = card.locator('.fxv')
  await card.locator('.fxv[data-ready="1"]').waitFor({ timeout: 30000 })
  await scrollTo(cardSel, 8)
  await shot('3D', 1600)

  // 3. 再生。tick が進むたびに撮る (撮っている間に過ぎた tick は飛ぶ)
  const total = Number((await fxv.locator('.fxv-tick').textContent()).split('/')[1])
  await fxv.locator('.fxv-play').click()
  let last = 0
  for (;;) {
    const state = await fxv.evaluate(el => ({ tick: Number(el.dataset.tick), playing: el.dataset.playing }))
    if (state.tick !== last) {
      last = state.tick
      frames.push({ png: await page.screenshot({ type: 'png' }), ms: 220, label: `再生 tick ${state.tick}` })
    }
    if (state.playing === '0' && state.tick >= total) break
    await page.waitForTimeout(10)
  }
  await shot('再生の終わり', 1400)

  // 4. 最初へ → 2D → 1 tick ずつ → 層
  await fxv.locator('.fxv-rewind').click()
  await attr('data-tick', '0')
  await fxv.locator('.fxv-2d').click()
  await attr('data-view', '2d')
  await page.waitForTimeout(300)
  await shot('2D', 1600)
  for (let t = 1; t <= Math.min(total, 8); t++) {
    await fxv.locator('.fxv-step').click()
    await attr('data-tick', String(t))
    await shot(`2D tick ${t}`, 350)
  }
  const down = fxv.locator('.fxv-layer-down')
  if (await down.isEnabled()) {
    await down.click()
    await page.waitForTimeout(200)
    await shot('層を下げる', 1500)
    await fxv.locator('.fxv-layer-up').click()
    await page.waitForTimeout(200)
  }
  await shot('2D の終わり', 2400)
}

const SCRIPTS = { reader: scriptReader, viewer: scriptViewer }
/** 台本ごとの既定のビューポート。viewer は図 (幅 696 px) が本文の欄に収まる幅にする */
const VIEWPORTS = { reader: { width: 960, height: 600 }, viewer: { width: 1280, height: 720 } }

async function main() {
  const opts = parseArgs(process.argv)
  const outPath = opts.out
    ? resolve(REPO_ROOT, opts.out)
    : join(REPO_ROOT, '.github', 'pr-assets', branchName(), `docs-${opts.script}.gif`)

  const staged = !opts.baseUrl
  if (staged) {
    if (opts.build) {
      console.log('[docs-gif] building app + docs-web ...')
      execSync('npm run build -w app && npm run build:docs', { cwd: REPO_ROOT, stdio: 'inherit' })
    }
    execSync('npm run stage:docs', { cwd: REPO_ROOT, stdio: 'inherit' })
  }
  const unstage = () => {
    if (staged) rmSync(join(REPO_ROOT, 'app', 'dist', 'docs'), { recursive: true, force: true })
  }

  console.log(`[docs-gif] starting preview on :${opts.port} ...`)
  const { baseUrl, shutdown } = startAppPreview({ port: opts.port, baseUrl: opts.baseUrl })
  const docsUrl = `${baseUrl.replace(/\/$/, '')}/docs/`

  let browser
  try {
    await waitForServer(docsUrl)
    browser = await launchBrowser()
    const page = await browser.newPage({
      viewport: { width: opts.width, height: opts.height },
      deviceScaleFactor: 1,
      colorScheme: 'light',
      reducedMotion: 'reduce',
    })
    page.on('pageerror', e => console.warn('[page error]', e.message))

    /** @type {{ png: Buffer, ms: number, label: string }[]} */
    const frames = []
    const shot = async (label, ms) => {
      // 描き終わりを 2 フレーム待つ (polling が rAF だと headless で止まることがあるので timeout も置く)
      await page.evaluate(() => new Promise(r => {
        const t = setTimeout(r, 300)
        requestAnimationFrame(() => requestAnimationFrame(() => { clearTimeout(t); r() }))
      }))
      frames.push({ png: await page.screenshot({ type: 'png' }), ms, label })
    }

    await SCRIPTS[opts.script]({ page, docsUrl, shot, frames })

    console.log(`[docs-gif] captured ${frames.length} frames`)
    if (opts.frames) {
      const dir = resolve(opts.frames)
      mkdirSync(dir, { recursive: true })
      frames.forEach((f, i) => writeFileSync(join(dir, `${String(i).padStart(2, '0')}.png`), f.png))
    }

    const bytes = encodeGif(frames.map(f => PNG.sync.read(f.png)), { delays: frames.map(f => f.ms) })
    mkdirSync(dirname(outPath), { recursive: true })
    writeFileSync(outPath, bytes)
    const total = (frames.reduce((n, f) => n + f.ms, 0) / 1000).toFixed(1)
    console.log(`[docs-gif] wrote ${outPath} (${opts.width}x${opts.height}, ${frames.length} frames, ${total} s, ${(bytes.length / 1024).toFixed(1)} KB)`)
  } finally {
    if (browser) await browser.close()
    shutdown()
    unstage()
  }
}

main().catch(e => {
  console.error('[docs-gif] ERROR:', e.message)
  process.exitCode = 1
})
