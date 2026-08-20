import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
const [JSON_PATH, OUT, DIST] = process.argv.slice(2)
const fx = readFileSync(JSON_PATH, 'utf-8')
const PORT = 4331
const preview = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: 'app', stdio: 'ignore' })
await new Promise(r => setTimeout(r, 3500))
const b = await chromium.launch({ headless: true, args: ['--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist','--enable-webgl','--disable-dev-shm-usage'] })
const page = await b.newPage({ viewport: { width: 760, height: 620 } })
await page.goto(`http://127.0.0.1:${PORT}/?demo=lever-wire-lamp`)
await page.waitForFunction(() => !!window.__demo, null, { timeout: 30000, polling: 250 })
await page.evaluate(() => window.__demo.ready)
console.log('load →', await page.evaluate(j => window.__demo.load(j), fx))
await page.evaluate(() => window.__demo.fitCamera())
if (DIST) await page.evaluate(d => window.__demo.setCamera({ distance: Number(d) }), DIST)
await page.waitForTimeout(2500)
await page.getByTestId('demo-canvas').screenshot({ path: OUT })
await b.close(); preview.kill()
console.log('wrote', OUT)
