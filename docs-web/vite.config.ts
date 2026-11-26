import { defineConfig } from 'vite'
import type { Connect, Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

// 読む用の Web (#434)。編集用の app とは HTML もビルドも別にする。
// 本番 (deploy.yml) はここをビルドしないので、rdsim.com には出ない。
// 出るのは手元 (npm run dev:docs) と PR のプレビュー (/docs/) だけ。
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(__dirname, '..')
const PACKAGES = path.resolve(REPO, 'packages')
const RESOURCEPACK = path.resolve(REPO, 'app/public/resourcepack')
const DATA = path.resolve(__dirname, 'public/data')

/** 手元で開くポート。既読と理解度は localStorage (オリジンごと) に置くので、毎回同じにする */
export const DOCS_DEV_PORT = 4330

const MIME: Record<string, string> = {
  '.json': 'application/json', '.mcmeta': 'application/json',
  '.png': 'image/png', '.md': 'text/markdown; charset=utf-8',
}

/** `prefix` で始まる URL を `dir` の下のファイルで返す。無いファイルは 404、置き場の外 (../) は 403 */
function serveDir(prefix: string, dir: string): Connect.NextHandleFunction {
  return (req, res, next) => {
    const url = (req.url ?? '').split('?')[0]
    if (!url.startsWith(prefix)) return next()
    let rel: string
    try { rel = decodeURIComponent(url.slice(prefix.length)) } catch { return next() }
    const file = path.resolve(dir, rel)
    if (file !== dir && !file.startsWith(dir + path.sep)) { res.statusCode = 403; return res.end() }
    // 読めないパス (URL の %00 など) は、readFile が呼んだその場で throw する。それも 404 にする
    if (file.includes('\0')) { res.statusCode = 404; return res.end() }
    fs.readFile(file, (err, buf) => {
      // 無いファイルは 404 にする (SPA の fallback で HTML を返すと、読む側が JSON として読んで落ちる)
      if (err) { res.statusCode = 404; return res.end() }
      res.setHeader('Content-Type', MIME[path.extname(file)] ?? 'application/octet-stream')
      res.end(buf)
    })
  }
}

/**
 * `/resourcepack/*` を app/public/resourcepack から返す (複製しない)。
 *
 * viewer はテクスチャを**ルート絶対**の `/resourcepack/...` で取る。PR のプレビューでは
 * エディタと同じオリジンの `/docs/` に置くのでそのまま届くが、手元の dev と preview は
 * オリジンが別なので、ここで同じパスを生やす。`--base /docs/` でもこのパスは動かない
 */
function resourcepackFromApp(): Plugin {
  const handler = serveDir('/resourcepack/', RESOURCEPACK)
  return {
    name: 'docs-web:resourcepack-from-app',
    configureServer(server) { server.middlewares.use(handler) },
    configurePreviewServer(server) { server.middlewares.use(handler) },
  }
}

/**
 * 手元の dev では、生成物 (`/data/*`) をディスクから直に返す。
 *
 * Vite の dev は public の中のファイルの一覧を覚えていて、生成器が置き場を消して作り直すと
 * 一覧から半分ほど抜ける (実測: 565 本のうち 299 本が HTML の fallback になった)。
 * 一覧を通さずに読めば、作り直した直後でも全部届く
 */
function dataFromDisk(): Plugin {
  return {
    name: 'docs-web:data-from-disk',
    apply: 'serve',
    configureServer(server) { server.middlewares.use(serveDir('/data/', DATA)) },
  }
}

/**
 * 手元の dev で md を直したら、生成器を回し直して画面を読み込み直す。
 * 生成物 (public/data) は `npm run dev:docs` が起動の前に 1 回作る。ここは 2 回目から後だけを受け持つ
 */
function regenerateOnMdChange(): Plugin {
  const dirs = [path.join(REPO, 'docs/vanilla'), path.join(REPO, 'docs/research')]
  return {
    name: 'docs-web:regenerate-on-md-change',
    apply: 'serve',
    configureServer(server) {
      server.watcher.add(dirs)
      let running = false
      let again = false
      const run = () => {
        if (running) { again = true; return }
        running = true
        const child = spawn('npm', ['run', '--silent', 'docs:index'], { cwd: REPO, stdio: 'inherit', shell: true })
        child.on('exit', code => {
          running = false
          if (code === 0) server.ws.send({ type: 'full-reload' })
          if (again) { again = false; run() }
        })
      }
      server.watcher.on('change', file => {
        if (file.endsWith('.md') && dirs.some(d => file.startsWith(d + path.sep))) run()
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), resourcepackFromApp(), dataFromDisk(), regenerateOnMdChange()],
  resolve: {
    // 同じモノレポの packages/* をソースのまま読む (app と同じ形)。
    // `@redstone/docs-kit/viewer` を先に書く。前方一致なので、後ろだと入口の方に吸われる
    alias: [
      { find: '@redstone/docs-kit/viewer', replacement: path.resolve(PACKAGES, 'docs-kit/src/viewer/index.ts') },
      { find: '@redstone/docs-kit',        replacement: path.resolve(PACKAGES, 'docs-kit/src/index.ts') },
      { find: '@redstone/viewer',          replacement: path.resolve(PACKAGES, 'viewer/src/index.ts') },
      { find: '@redstone/sim',             replacement: path.resolve(PACKAGES, 'sim/src/index.ts') },
    ],
    dedupe: ['react', 'react-dom'],
  },
  server: {
    port: DOCS_DEV_PORT,
    strictPort: true,
    fs: { allow: ['..'] },
  },
  preview: { port: DOCS_DEV_PORT, strictPort: true },
})
