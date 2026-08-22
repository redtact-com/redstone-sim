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
//   --base-url <url> 既存の配信先に対して撮る (PR プレビュー等)。build/preview は起動しない
//   --rot-x/--rot-y  カメラ角度 (既定は fitCamera の 45/45)。面を正面から見せたいとき用
//   --distance <n>   カメラ距離 (既定は fitCamera の自動値)
//   --no-build       既存の app/dist を使い build をスキップ
//   --width/--height ビューポート (既定 800x620)
//
// 設計意図: 実機検証済み fixture をそのままデモページに流し (window.__demo)、
// 本番ビルド (vite preview) に対して撮る。dev の StrictMode 二重発火や
// canvas ピクセル校正を避け、コマンド一発で PR 品質の GIF を出す (issue #70)。
// GIF 合成は gifenc + pngjs の pure JS で完結し Python 依存を持ち込まない。
// フレーム間で変化しない画素は透過にして書く (#326。180 フレームで 3.5MB → 450KB)。
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
import https from 'node:https'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '../..')

// ── 引数パース ─────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const opts = {
    fixture: null, out: null, every: 1, frameMs: 400, holdMs: 1200,
    port: 4319, build: true, width: 800, height: 620, baseUrl: null,
    rotX: null, rotY: null, distance: null,
  }
  const rest = argv.slice(2)
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]
    if (a === '--out') opts.out = rest[++i]
    else if (a === '--every') opts.every = Math.max(1, parseInt(rest[++i], 10))
    else if (a === '--frame-ms') opts.frameMs = parseInt(rest[++i], 10)
    else if (a === '--hold-ms') opts.holdMs = parseInt(rest[++i], 10)
    else if (a === '--port') opts.port = parseInt(rest[++i], 10)
    else if (a === '--base-url') opts.baseUrl = rest[++i]
    else if (a === '--rot-x') opts.rotX = parseFloat(rest[++i])
    else if (a === '--rot-y') opts.rotY = parseFloat(rest[++i])
    else if (a === '--distance') opts.distance = parseFloat(rest[++i])
    else if (a === '--no-build') opts.build = false
    else if (a === '--width') opts.width = parseInt(rest[++i], 10)
    else if (a === '--height') opts.height = parseInt(rest[++i], 10)
    else if (!a.startsWith('--') && !opts.fixture) opts.fixture = a
    else throw new Error(`不明な引数: ${a}`)
  }
  if (!opts.fixture) throw new Error('fixture 名を指定してください: npm run demo-gif -- <fixture名>')
  return opts
}

// ── GIF エンコード ─────────────────────────────────────────────────────────────

/**
 * 変化しない画素を透過にする GIF エンコード (#326)。
 *
 * 以前は**毎フレームを全画面 + フレームごとのパレット**で書いていた。
 * 回路デモは画面の大半が動かないので、これだと同じ背景を何十回も書き直すことになり、
 * 3.5MB の GIF ができていた (リポジトリの追跡ファイルの 7 割が PR 用 GIF だった)。
 *
 * 2 つ変える:
 *   1. **パレットを全フレーム共通**にする。フレームごとに量子化すると
 *      同じ背景でも色番号が揺れて「変化した」ことになり、差分が効かない
 *   2. 前フレームと**同じ画素を透過**にして、前の絵を残す (dispose=1)。
 *      同じ値が延々と続くので LZW がまとめて潰す
 *
 * フレームは全画面のまま書く。gifenc の `writeFrame` は画像記述子の左上を
 * **常に 0,0 で書く**ので (dist/gifenc.js encodeImageDescriptor)、
 * 変化した矩形だけを部分フレームとして置くことはできない。
 * 小さいサブ画像を渡すと**左上に縮んで貼られて絵が壊れる**。
 *
 * 透過に 1 色使うので、色は 255 色までに量子化する。
 */
function encodeGif(pngs, opts) {
  const { width, height } = pngs[0]
  const rgbas = pngs.map(p => new Uint8Array(p.data.buffer, p.data.byteOffset, p.data.length))

  // 1. 全フレームから共通パレットを作る。全部を連結すると巨大になるので
  //    等間隔に最大 8 枚を標本にする (背景が同じなので色の分布はほぼ変わらない)
  const step = Math.max(1, Math.ceil(rgbas.length / 8))
  const sample = rgbas.filter((_, i) => i % step === 0)
  const merged = new Uint8Array(sample.reduce((n, a) => n + a.length, 0))
  let off = 0
  for (const a of sample) { merged.set(a, off); off += a.length }
  // 255 色 + 透過 1 色。format は rgb444 で十分 (rgba4444 は透過分を色数に使ってしまう)
  const palette = quantize(merged, 255, { format: 'rgb444' })
  const transparentIndex = palette.length
  palette.push([0, 0, 0])

  const gif = GIFEncoder()
  let prev = null
  for (let i = 0; i < rgbas.length; i++) {
    const cur = applyPalette(rgbas[i], palette, 'rgb444')
    const isEdge = i === 0 || i === rgbas.length - 1
    const delay = isEdge ? opts.holdMs : opts.frameMs
    if (prev === null) {
      gif.writeFrame(cur, width, height, { palette, delay, repeat: 0 })
    } else {
      // **cur を書き換える前に次回用の控えを取る** (透過で潰した値を次の比較に使わない)
      const shown = Uint8Array.from(cur)
      for (let j = 0; j < cur.length; j++) if (cur[j] === prev[j]) cur[j] = transparentIndex
      gif.writeFrame(cur, width, height, {
        palette, delay, transparent: true, transparentIndex, dispose: 1,
      })
      prev = shown
      continue
    }
    prev = cur
  }
  gif.finish()
  return gif.bytes()
}

// ── サーバ待機 ─────────────────────────────────────────────────────────────────

function waitForServer(url, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs
  return new Promise((res, rej) => {
    const tick = () => {
      // https の配信先 (PR プレビュー等) も待てるようにする
      const client = url.startsWith('https:') ? https : http
      const req = client.get(url, r => { r.destroy(); res() })
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
  if (opts.build && !opts.baseUrl) {
    console.log('[demo-gif] building app (vite production build)...')
    execSync('npm run build -w app', { cwd: REPO_ROOT, stdio: 'inherit' })
  }

  // 2. vite preview 起動
  console.log(`[demo-gif] starting preview on :${opts.port} ...`)
  // detached + プロセスグループ kill: npm 経由だと孫 (vite) が親 kill で残り、
  // ポートを占有し続ける (孤児 preview が次回実行の strictPort を殺す) ため
  // --base-url があれば既に動いている配信先を使う (PR プレビューの確認用)。
  // build も preview も起動しないので、**手元のコードではなく配信物**を撮る
  const preview = opts.baseUrl ? null : spawn(
    'npm',
    ['run', 'preview', '-w', 'app', '--', '--port', String(opts.port), '--strictPort', '--host', '127.0.0.1'],
    { cwd: REPO_ROOT, stdio: 'ignore', detached: true },
  )
  const baseUrl = opts.baseUrl ?? `http://127.0.0.1:${opts.port}`
  const shutdown = () => {
    if (!preview) return
    try { process.kill(-preview.pid, 'SIGTERM') } catch { /* noop */ }
  }
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
    // polling は interval 指定 (既定の rAF はヘッドレスの非表示スロットリングで
    // 発火せず、__demo が存在しても timeout し得る)
    await page.waitForFunction(() => !!window.__demo, null, { timeout: 30000, polling: 250 })
    await page.evaluate(() => window.__demo.ready)
    await page.evaluate(() => window.__demo.fitCamera())
    // 角度/距離の指定があれば fitCamera の後に上書きする (面を正面から見せる用)
    if (opts.rotX !== null || opts.rotY !== null || opts.distance !== null) {
      await page.evaluate(o => {
        const c = {}
        if (o.rotX !== null) c.rotX = o.rotX
        if (o.rotY !== null) c.rotY = o.rotY
        if (o.distance !== null) c.distance = o.distance
        window.__demo.setCamera(c)
      }, { rotX: opts.rotX, rotY: opts.rotY, distance: opts.distance })
    }

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
    const bytes = encodeGif(frames.map(f => PNG.sync.read(f.png)), opts)
    const { width, height } = PNG.sync.read(frames[0].png)

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
