#!/usr/bin/env node
// ============================================================
// fixture 再生デモ (?demo=<name>) を tick 送りで撮影し MP4 に合成する CLI。
//
//   npm run demo-mp4 -- <fixture名> [options]
//   npm run demo-mp4 -- --json <path.json> [options]
//
// demo-gif.mjs の MP4 版。**GIF より綺麗で軽い**ので、長い動画 (100 tick 超) や
// 人に見せる用はこちら。GIF が要るときは demo-gif.mjs を使う。
//
// options (demo-gif と共通のもの以外):
//   --json <path>    fixture 名ではなくファイルから読む (キャプチャ由来の巨大 fixture 用)
//   --scale <n>      デバイスピクセル比 (既定 2)。720x540 の描画領域が 1440x1080 になる
//   --fps <n>        1 秒あたりのコマ数 (既定 10 = 実機の半分の速さ)
//   --hold <n>       最初と最後で止めるコマ数 (既定 10)
//   --crf <n>        x264 の品質 (既定 18。小さいほど高品質・大きいファイル)
//   --demo-w/--demo-h デモ領域の大きさ (既定 720x540)。**縦長の回路は縦長のコマで撮る**
//
// **region を絞ると寄れる**: fixture の region はカメラのフィット範囲と
// 描画対象を兼ねている (FixtureRunner.worldSnapshot)。**回路全体は動いたまま**
// region だけ小さくすれば、147 段のエレベーターでも見せたい階だけ大写しにできる。
//
// ffmpeg は PATH に無ければ ffmpeg-static を使う (FFMPEG env で明示指定も可)。
// ============================================================

import { chromium } from 'playwright'
import { execSync, execFileSync, spawn } from 'node:child_process'
import { writeFileSync, mkdirSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import http from 'node:http'
import https from 'node:https'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '../..')

function parseArgs(argv) {
  const o = {
    fixture: null, json: null, out: null, every: 1, fps: 10, hold: 10, crf: 18,
    port: 4320, build: true, width: 800, height: 620, scale: 2, baseUrl: null,
    rotX: null, rotY: null, distance: null, ticks: null, demoW: null, demoH: null,
  }
  const rest = argv.slice(2)
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]
    if (a === '--out') o.out = rest[++i]
    else if (a === '--json') o.json = rest[++i]
    else if (a === '--every') o.every = Math.max(1, parseInt(rest[++i], 10))
    else if (a === '--fps') o.fps = parseInt(rest[++i], 10)
    else if (a === '--hold') o.hold = parseInt(rest[++i], 10)
    else if (a === '--crf') o.crf = parseInt(rest[++i], 10)
    else if (a === '--scale') o.scale = parseFloat(rest[++i])
    else if (a === '--ticks') o.ticks = parseInt(rest[++i], 10)
    else if (a === '--port') o.port = parseInt(rest[++i], 10)
    else if (a === '--base-url') o.baseUrl = rest[++i]
    else if (a === '--rot-x') o.rotX = parseFloat(rest[++i])
    else if (a === '--rot-y') o.rotY = parseFloat(rest[++i])
    else if (a === '--distance') o.distance = parseFloat(rest[++i])
    else if (a === '--no-build') o.build = false
    else if (a === '--demo-w') o.demoW = parseInt(rest[++i], 10)
    else if (a === '--demo-h') o.demoH = parseInt(rest[++i], 10)
    else if (a === '--width') o.width = parseInt(rest[++i], 10)
    else if (a === '--height') o.height = parseInt(rest[++i], 10)
    else if (!a.startsWith('--') && !o.fixture) o.fixture = a
    else throw new Error(`不明な引数: ${a}`)
  }
  if (!o.fixture && !o.json) throw new Error('fixture 名か --json <path> が要ります')
  return o
}

function ffmpegPath() {
  if (process.env.FFMPEG) return process.env.FFMPEG
  try { execSync('which ffmpeg', { stdio: 'ignore' }); return 'ffmpeg' } catch { /* 次へ */ }
  // ffmpeg-static は devDependency にしていない (置き場所を汚さない)。
  // 事前に `npm i ffmpeg-static` した先を FFMPEG で渡すか、PATH に ffmpeg を入れる
  throw new Error('ffmpeg が見つかりません。PATH に入れるか FFMPEG=<path> で渡してください')
}

function waitForServer(url, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs
  return new Promise((res, rej) => {
    const tick = () => {
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

async function main() {
  const o = parseArgs(process.argv)
  const ffmpeg = ffmpegPath()
  const name = o.fixture ?? 'fixture'
  const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: REPO_ROOT })
    .toString().trim().replace(/[^\w.\-/]+/g, '_')
  const outPath = o.out
    ? resolve(REPO_ROOT, o.out)
    : join(REPO_ROOT, '.github', 'pr-assets', branch, `${name}.mp4`)

  if (o.build && !o.baseUrl) {
    console.log('[demo-mp4] building app ...')
    execSync('npm run build -w app', { cwd: REPO_ROOT, stdio: 'inherit' })
  }
  const preview = o.baseUrl ? null : spawn(
    'npm',
    ['run', 'preview', '-w', 'app', '--', '--port', String(o.port), '--strictPort', '--host', '127.0.0.1'],
    { cwd: REPO_ROOT, stdio: 'ignore', detached: true },
  )
  const baseUrl = o.baseUrl ?? `http://127.0.0.1:${o.port}`
  const shutdown = () => { if (preview) { try { process.kill(-preview.pid, 'SIGTERM') } catch { /* noop */ } } }
  process.on('exit', shutdown)
  process.on('SIGINT', () => { shutdown(); process.exit(1) })

  const frameDir = join(tmpdir(), `demo-mp4-${process.pid}`)
  mkdirSync(frameDir, { recursive: true })
  let browser
  try {
    await waitForServer(baseUrl + '/')
    browser = await chromium.launch({
      headless: true,
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist',
        '--enable-webgl', '--disable-dev-shm-usage'],
    })
    const page = await browser.newPage({
      viewport: { width: o.width, height: o.height },
      deviceScaleFactor: o.scale,
    })
    page.on('pageerror', e => console.warn('[page error]', e.message))
    const q = new URLSearchParams({ demo: o.fixture ?? 'lever-wire-lamp' })
    if (o.demoW) q.set('w', String(o.demoW))
    if (o.demoH) q.set('h', String(o.demoH))
    await page.goto(`${baseUrl}/?${q}`, { waitUntil: 'load' })
    await page.waitForFunction(() => !!window.__demo, null, { timeout: 30000, polling: 250 })
    await page.evaluate(() => window.__demo.ready)
    if (o.json) {
      const json = readFileSync(resolve(REPO_ROOT, o.json), 'utf-8')
      const ok = await page.evaluate(j => window.__demo.load(j), json)
      if (!ok) throw new Error(`fixture を読み込めませんでした: ${o.json}`)
    }
    await page.evaluate(() => window.__demo.fitCamera())
    if (o.rotX !== null || o.rotY !== null || o.distance !== null) {
      await page.evaluate(c => window.__demo.setCamera(c),
        Object.fromEntries(['rotX', 'rotY', 'distance']
          .filter(k => o[k] !== null).map(k => [k, o[k]])))
    }
    const maxTicks = Math.min(await page.evaluate(() => window.__demo.getMaxTicks()),
      o.ticks ?? Number.POSITIVE_INFINITY)
    console.log(`[demo-mp4] ${await page.evaluate(() => window.__demo.getFixtureName())}`
      + ` ticks=${maxTicks} scale=${o.scale} fps=${o.fps}`)

    const canvas = page.getByTestId('demo-canvas')
    await canvas.waitFor({ state: 'visible' })
    await page.waitForTimeout(800)

    const shots = [0]
    for (let t = o.every; t <= maxTicks; t += o.every) shots.push(t)
    if (shots[shots.length - 1] !== maxTicks) shots.push(maxTicks)

    let n = 0, cur = 0
    const write = buf => writeFileSync(join(frameDir, `f${String(n++).padStart(5, '0')}.png`), buf)
    for (const target of shots) {
      while (cur < target) { await page.evaluate(() => window.__demo.step()); cur++ }
      await page.waitForFunction(
        t => document.querySelector('[data-testid=demo-canvas]')?.getAttribute('data-demo-tick') === String(t),
        cur, { timeout: 8000 })
      await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))
      const buf = await canvas.screenshot({ type: 'png' })
      const hold = (cur === 0 || cur === maxTicks) ? o.hold : 1
      for (let i = 0; i < hold; i++) write(buf)
      if (cur % 20 === 0) console.log(`[demo-mp4]   tick ${cur}/${maxTicks}`)
    }
    console.log(`[demo-mp4] captured ${n} frames`)

    mkdirSync(dirname(outPath), { recursive: true })
    execFileSync(ffmpeg, [
      '-y', '-framerate', String(o.fps), '-i', join(frameDir, 'f%05d.png'),
      // 高さ・幅を偶数へ丸める (x264 の yuv420p 制約)
      '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2',
      '-c:v', 'libx264', '-preset', 'slow', '-crf', String(o.crf),
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart', outPath,
    ], { stdio: ['ignore', 'ignore', 'inherit'] })
    const kb = (readFileSync(outPath).length / 1024).toFixed(1)
    console.log(`[demo-mp4] wrote ${outPath} (${kb} KB)`)
  } finally {
    if (browser) await browser.close()
    shutdown()
    rmSync(frameDir, { recursive: true, force: true })
  }
}

main().catch(e => { console.error('[demo-mp4] ERROR:', e.message); process.exitCode = 1 })
