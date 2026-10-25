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
    // npm run test:coverage (--coverage 付き) のときだけ集計する。
    // include を書くと、どのテストからも読まれないファイルも 0% として表に出る。
    // しきい値はまだ付けない (#<issue>)
    coverage: {
      provider: 'v8',
      include: [
        'packages/*/src/**/*.{ts,tsx}',
        'app/src/**/*.{ts,tsx}',
        'tools/mc-harness/runner/**/*.ts',
      ],
      exclude: ['**/*.test.{ts,tsx}', '**/*.d.ts'],
      reporter: ['text-summary', 'json-summary', 'html'],
      reportsDirectory: 'coverage',
    },
  },
  resolve: {
    alias: {
      '@redstone/sim':    path.resolve(__dirname, 'packages/sim/src/index.ts'),
      '@redstone/editor': path.resolve(__dirname, 'packages/editor/src/index.ts'),
    },
  },
})
