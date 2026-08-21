import { chromium } from 'playwright'
const b = await chromium.launch({ headless: true, args: ['--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist','--enable-webgl','--disable-dev-shm-usage'] })
const ctx = await b.newContext({ viewport: { width: 900, height: 700 } })
const p = await ctx.newPage()
const cdp = await ctx.newCDPSession(p)
await cdp.send('Network.enable')
await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 40, downloadThroughput: 20*1024*1024/8, uploadThroughput: 5*1024*1024/8 })
const kinds = {}
p.on('request', r => { const u = r.url()
  const k = u.includes('bundle.json') ? 'bundle.json'
    : /resourcepack\/.*\.json/.test(u) ? 'pack JSON'
    : u.includes('raw.githubusercontent') ? '外部' : 'その他'
  kinds[k] = (kinds[k] ?? 0) + 1 })
const ready = new Promise(res => p.on('console', m => { if (m.text().includes('[buildResources] Ready')) res({ t: Date.now(), line: m.text() }) }))
const t0 = Date.now()
await p.goto('https://rdsim.com/?demo=lever-wire-lamp', { waitUntil: 'commit' })
const r = await Promise.race([ready, new Promise(x => setTimeout(() => x({ t: -1, line: '(timeout)' }), 60000))])
console.log(`Ready まで: ${r.t < 0 ? 'timeout' : (r.t - t0) + 'ms'}`)
console.log(' ', r.line)
console.log(' ', JSON.stringify(kinds))
await b.close()
