#!/usr/bin/env node
// ============================================================
// fixture 再生デモ (?demo=<name>) を tick 送りで撮影し GIF を合成する CLI。
//
//   npm run demo-gif -- <fixture名> [options]
//
// options:
//   --out <path>     出力先 (既定 .github/pr-assets/<branch>/<fixture>.gif)
//   --every <N>      N tick ごとに 1 フレーム撮る (既定 1)
//   --frame-ms <ms>  各フレームの表示時間 (既定 400)
//   --hold-ms <ms>   最初と最後のフレームの表示時間 (既定 1200)
//   --port <n>       vite preview のポート (既定 4319)
//   --no-build       既存の app/dist を使い build をスキップ
//   --width/--height ビューポート (既定 800x620)
//
// 設計意図: 実機検証済み fixture をそのままデモページに流し (window.__demo)、
// 本番ビルド (vite preview) に対して撮る。dev の StrictMode 二重発火や
// canvas ピクセル校正を避け、コマンド一発で PR 品質の GIF を出す (issue #70)。
// GIF 合成は gifenc + pngjs の pure JS で完結し Python 依存を持ち込まない。
// ============================================================

import { chromium } from 'playwright'
import gifenc from 'gifenc'
import { PNG } from 'pngjs'

const { GIFEncoder, quantize, applyPalette } = gifenc
import { execSync, spawn } from 'node:child_process'
import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import http from 'node:http'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '../..')

// ── 引数パース ─────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const opts = {
    fixture: null, out: null, every: 1, frameMs: 400, holdMs: 1200,
    port: 4319, build: true, width: 800, height: 620,
  }
  const rest = argv.slice(2)
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]
    if (a === '--out') opts.out = rest[++i]
    else if (a === '--every') opts.every = Math.max(1, parseInt(rest[++i], 10))
    else if (a === '--frame-ms') opts.frameMs = parseInt(rest[++i], 10)
    else if (a === '--hold-ms') opts.holdMs = parseInt(rest[++i], 10)
    else if (a === '--port') opts.port = parseInt(rest[++i], 10)
    else if (a === '--no-build') opts.build = false
    else if (a === '--width') opts.width = parseInt(rest[++i], 10)
    else if (a === '--height') opts.height = parseInt(rest[++i], 10)
    else if (!a.startsWith('--') && !opts.fixture) opts.fixture = a
    else throw new Error(`不明な引数: ${a}`)
  }
  if (!opts.fixture) throw new Error('fixture 名を指定してください: npm run demo-gif -- <fixture名>')
  return opts
}

// ── サーバ待機 ─────────────────────────────────────────────────────────────────

function waitForServer(url, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs
  return new Promise((res, rej) => {
    const tick = () => {
      const req = http.get(url, r => { r.destroy(); res() })
      req.on('error', () => {
        if (Date.now() > deadline) rej(new Error(`preview 起動タイムアウト: ${url}`))
        else setTimeout(tick, 200)
      })
    }
    tick()
  })
}

// ── メイン ─────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs(process.argv)

  const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: REPO_ROOT })
    .toString().trim().replace(/[^\w.\-/]+/g, '_')
  const outPath = opts.out
    ? resolve(REPO_ROOT, opts.out)
    : join(REPO_ROOT, '.github', 'pr-assets', branch, `${opts.fixture}.gif`)

  // 1. 本番ビルド
  if (opts.build) {
    console.log('[demo-gif] building app (vite production build)...')
    execSync('npm run build -w app', { cwd: REPO_ROOT, stdio: 'inherit' })
  }

  // 2. vite preview 起動
  console.log(`[demo-gif] starting preview on :${opts.port} ...`)
  const preview = spawn(
    'npm',
    ['run', 'preview', '-w', 'app', '--', '--port', String(opts.port), '--strictPort', '--host', '127.0.0.1'],
    { cwd: REPO_ROOT, stdio: 'ignore' },
  )
  const baseUrl = `http://127.0.0.1:${opts.port}`
  const shutdown = () => { try { preview.kill('SIGTERM') } catch { /* noop */ } }
  process.on('exit', shutdown)
  process.on('SIGINT', () => { shutdown(); process.exit(1) })

  let browser
  try {
    await waitForServer(baseUrl + '/')

    // 3. chromium (headless, software WebGL)
    browser = await chromium.launch({
      headless: true,
      args: [
        '--use-gl=angle', '--use-angle=swiftshader',
        '--ignore-gpu-blocklist', '--enable-webgl',
        '--disable-dev-shm-usage',
      ],
    })
    const page = await browser.newPage({
      viewport: { width: opts.width, height: opts.height },
      deviceScaleFactor: 1,
    })
    page.on('pageerror', e => console.warn('[page error]', e.message))

    const url = `${baseUrl}/?demo=${encodeURIComponent(opts.fixture)}`
    console.log(`[demo-gif] loading ${url}`)
    await page.goto(url, { waitUntil: 'load' })

    // 4. __demo.ready → fitCamera
    await page.waitForFunction(() => !!window.__demo, null, { timeout: 20000 })
    await page.evaluate(() => window.__demo.ready)
    await page.evaluate(() => window.__demo.fitCamera())

    const maxTicks = await page.evaluate(() => window.__demo.getMaxTicks())
    const fixtureName = await page.evaluate(() => window.__demo.getFixtureName())
    if (!fixtureName) throw new Error(`fixture "${opts.fixture}" が読み込めませんでした`)
    console.log(`[demo-gif] fixture=${fixtureName} ticks=${maxTicks} every=${opts.every}`)

    const canvas = page.getByTestId('demo-canvas')
    await canvas.waitFor({ state: 'visible' })

    // レンダリング安定待ち (テクスチャ + fitCamera 反映)
    await page.waitForTimeout(500)

    // 撮影対象 tick のリスト (0, every, 2*every, ..., maxTicks を必ず含む)
    const shotTicks = [0]
    for (let t = opts.every; t <= maxTicks; t += opts.every) shotTicks.push(t)
    if (shotTicks[shotTicks.length - 1] !== maxTicks) shotTicks.push(maxTicks)

    // 5. tick 送りしながら screenshot
    const frames = []
    let cur = 0
    for (const target of shotTicks) {
      while (cur < target) {
        await page.evaluate(() => window.__demo.step())
        cur++
      }
      // React 再描画で data-demo-tick が反映 → GL 2 フレーム描くのを待つ
      await page.waitForFunction(
        t => document.querySelector('[data-testid=demo-canvas]')?.getAttribute('data-demo-tick') === String(t),
        cur, { timeout: 5000 },
      )
      await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))
      const buf = await canvas.screenshot({ type: 'png' })
      frames.push({ tick: cur, png: buf })
    }
    console.log(`[demo-gif] captured ${frames.length} frames`)

    // 6. GIF 合成
    const gif = GIFEncoder()
    let width = 0, height = 0
    for (let i = 0; i < frames.length; i++) {
      const png = PNG.sync.read(frames[i].png)
      width = png.width; height = png.height
      const rgba = new Uint8Array(png.data.buffer, png.data.byteOffset, png.data.length)
      const palette = quantize(rgba, 256, { format: 'rgba4444' })
      const index = applyPalette(rgba, palette, 'rgba4444')
      const isEdge = i === 0 || i === frames.length - 1
      gif.writeFrame(index, width, height, {
        palette,
        delay: isEdge ? opts.holdMs : opts.frameMs,
        repeat: i === 0 ? 0 : undefined,
      })
    }
    gif.finish()
    const bytes = gif.bytes()

    mkdirSync(dirname(outPath), { recursive: true })
    writeFileSync(outPath, bytes)
    const kb = (bytes.length / 1024).toFixed(1)
    console.log(`[demo-gif] wrote ${outPath} (${width}x${height}, ${frames.length} frames, ${kb} KB)`)
  } finally {
    if (browser) await browser.close()
    shutdown()
  }
}

main().catch(e => {
  console.error('[demo-gif] ERROR:', e.message)
  process.exitCode = 1
})
