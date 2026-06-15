import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import { fileURLToPath } from 'url'

// 同一モノレポ内の packages/* をソース直参照する（ビルド不要・HMR 有効）。
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PACKAGES = path.resolve(__dirname, '../packages')

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@redstone/sim':    path.resolve(PACKAGES, 'sim/src/index.ts'),
      '@redstone/editor': path.resolve(PACKAGES, 'editor/src/index.ts'),
      '@redstone/viewer': path.resolve(PACKAGES, 'viewer/src/index.ts'),
    },
    dedupe: ['react', 'react-dom'],
  },
  server: {
    fs: {
      // app の外（モノレポ root 配下の packages/）をソース提供できるよう許可
      allow: ['..'],
    },
  },
})
