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
    // 配列で書く。`@redstone/docs-kit/viewer` を入口より先に置く (前方一致で吸われないように)
    alias: [
      { find: '@redstone/sim',             replacement: path.resolve(__dirname, 'packages/sim/src/index.ts') },
      { find: '@redstone/editor',          replacement: path.resolve(__dirname, 'packages/editor/src/index.ts') },
      { find: '@redstone/viewer',          replacement: path.resolve(__dirname, 'packages/viewer/src/index.ts') },
      { find: '@redstone/docs-kit/viewer', replacement: path.resolve(__dirname, 'packages/docs-kit/src/viewer/index.ts') },
      { find: '@redstone/docs-kit',        replacement: path.resolve(__dirname, 'packages/docs-kit/src/index.ts') },
    ],
  },
})
