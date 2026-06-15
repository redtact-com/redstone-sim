import { defineConfig } from 'vitest/config'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  test: {
    globals: true,
  },
  resolve: {
    alias: {
      '@redstone/sim':    path.resolve(__dirname, 'packages/sim/src/index.ts'),
      '@redstone/editor': path.resolve(__dirname, 'packages/editor/src/index.ts'),
    },
  },
})
