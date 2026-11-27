// ============================================================
// GIF を撮る道具の共通の関数 (#434 で demo-gif.mjs から切り出した)。
//
//   demo-gif.mjs  fixture の再生デモ (?demo=<name>) を tick 送りで撮る
//   docs-gif.mjs  読む用の Web (/docs/) を台本どおりに操作して撮る
//
// 動きは切り出す前と同じ (同じ fixture で前後の GIF がバイト単位で一致するのを確かめた)。
// ============================================================

import { chromium } from 'playwright'
import gifenc from 'gifenc'
import { execSync, spawn } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import http from 'node:http'
import https from 'node:https'

const { GIFEncoder, quantize, applyPalette } = gifenc

const __dirname = dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT = resolve(__dirname, '../..')

/** 今のブランチ名 (出力先のフォルダ名に使う。パスに使えない字は _ にする) */
export function branchName() {
  return execSync('git rev-parse --abbrev-ref HEAD', { cwd: REPO_ROOT })
    .toString().trim().replace(/[^\w.\-/]+/g, '_')
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
 *
 * `opts.delays` (フレームごとの ms の配列) があればそれを使う。無ければ
 * 最初と最後が `opts.holdMs`、他は `opts.frameMs`。
 */
export function encodeGif(pngs, opts) {
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
    const delay = opts.delays ? opts.delays[i] : isEdge ? opts.holdMs : opts.frameMs
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

export function waitForServer(url, timeoutMs = 30000) {
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

// ── preview の起動 ─────────────────────────────────────────────────────────────

/**
 * app の vite preview を起こす。`baseUrl` があれば何も起こさず、その配信先を使う。
 * 返す `shutdown` は何度呼んでもよい (プロセスの終了時にも呼ばれる)。
 *
 * detached + プロセスグループ kill: npm 経由だと孫 (vite) が親 kill で残り、
 * ポートを占有し続ける (孤児 preview が次回実行の strictPort を殺す) ため
 */
export function startAppPreview({ port, baseUrl = null }) {
  const preview = baseUrl ? null : spawn(
    'npm',
    ['run', 'preview', '-w', 'app', '--', '--port', String(port), '--strictPort', '--host', '127.0.0.1'],
    { cwd: REPO_ROOT, stdio: 'ignore', detached: true },
  )
  const shutdown = () => {
    if (!preview) return
    try { process.kill(-preview.pid, 'SIGTERM') } catch { /* noop */ }
  }
  process.on('exit', shutdown)
  process.on('SIGINT', () => { shutdown(); process.exit(1) })
  return { baseUrl: baseUrl ?? `http://127.0.0.1:${port}`, shutdown }
}

// ── ブラウザ ───────────────────────────────────────────────────────────────────

/** chromium (headless, software WebGL) */
export function launchBrowser() {
  return chromium.launch({
    headless: true,
    args: [
      '--use-gl=angle', '--use-angle=swiftshader',
      '--ignore-gpu-blocklist', '--enable-webgl',
      '--disable-dev-shm-usage',
    ],
  })
}
