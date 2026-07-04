import { defineConfig } from 'vitest/config'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  test: {
    globals: true,
    // ワークフロー用 worktree (.claude/worktrees/) のテスト重複実行を防ぐ。
    // e2e/ は Playwright Test (npm run e2e) 専用。vitest では拾わない (#70)。
    exclude: ['**/node_modules/**', '**/.claude/**', '**/dist/**', '**/e2e/**'],
  },
  resolve: {
    alias: {
      '@redstone/sim':    path.resolve(__dirname, 'packages/sim/src/index.ts'),
      '@redstone/editor': path.resolve(__dirname, 'packages/editor/src/index.ts'),
    },
  },
})
