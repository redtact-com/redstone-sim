import { defineConfig, devices } from '@playwright/test'

// E2E スモーク (issue #70)。**本番ビルド (vite preview) に対して**実行する。
// dev の StrictMode 二重発火や HMR の揺れを避け、CI と手元で同じ挙動にするため。
// WebGL は headless chromium の SwiftShader で描く (下記 launch args)。

const PORT = Number(process.env.E2E_PORT ?? 4320)
const BASE_URL = `http://127.0.0.1:${PORT}`

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 60_000,
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    launchOptions: {
      args: [
        '--use-gl=angle', '--use-angle=swiftshader',
        '--ignore-gpu-blocklist', '--enable-webgl',
        '--disable-dev-shm-usage',
      ],
    },
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  // 本番ビルドを起こしてから preview で配信する。ビルド込みなので起動は長め。
  webServer: {
    command: `npm run build -w app && npm run preview -w app -- --port ${PORT} --strictPort --host 127.0.0.1`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
})
