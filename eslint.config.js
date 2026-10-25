// リポ全体の ESLint 設定 (#420)。npm run lint はルートで eslint . を流す。
// 今ある違反は eslint-suppressions.json に凍結してあり、CI は新しい違反だけで落ちる。
// 違反を直したら npm run lint:prune で凍結の件数を減らす (減らさないと CI が落ちる)。
import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

// tsc (noUnusedParameters・noUnusedLocals) と同じ形を許す。
// 先頭が _ の引数と、残余の分割代入で外すキー ({ count: _drop, ...rest })
const unusedVars = ['error', {
  argsIgnorePattern: '^_',
  ignoreRestSiblings: true,
}]

export default defineConfig([
  // .gitignore と同じく、生成物と手元にしか無いものは見ない
  globalIgnores([
    '**/dist',
    '**/.wrangler',
    '**/*.local.*',
    'coverage',
    'playwright-report',
    'test-results',
    'blob-report',
    'playwright/.cache',
    '**/.claude',
    'tools/decompile/jars',
    'tools/decompile/work',
    'tools/decompile/out',
    'tools/mc-harness/circuits',
    '**/zz-*',
    '**/*.tmp.mjs',
    '**/.verify-tmp*',
  ]),
  {
    files: ['**/*.{js,mjs,ts,tsx}'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.node,
    },
    rules: {
      'no-unused-vars': unusedVars,
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [tseslint.configs.recommended],
    rules: {
      '@typescript-eslint/no-unused-vars': unusedVars,
      // cond ? a++ : b-- の文は許す (packages/sim/src/rail.ts)
      '@typescript-eslint/no-unused-expressions': ['error', { allowTernary: true }],
    },
  },
  // ブラウザで動くコード
  {
    files: ['app/src/**/*.{ts,tsx}', 'packages/*/src/**/*.{ts,tsx}'],
    languageOptions: {
      globals: globals.browser,
    },
  },
  // React を使う 2 か所
  {
    files: ['app/src/**/*.{ts,tsx}', 'packages/viewer/src/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat.recommended],
  },
  {
    files: ['app/src/**/*.{ts,tsx}'],
    extends: [reactRefresh.configs.vite],
  },
  // Playwright の page.evaluate の中は window を触る
  {
    files: ['e2e/**/*.ts', 'tools/demo/**/*.mjs'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },
])
