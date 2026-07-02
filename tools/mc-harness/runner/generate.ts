// ============================================================
// fixture 生成ドライバ (実機 Minecraft → expect 系列)
//
// 前提: tools/mc-harness で `docker compose up -d` 済み。
// 使い方: npx tsx tools/mc-harness/runner/generate.ts <fixture名> [...]
//
// 駆動方式 (README「駆動方式の確定」参照):
//   scarpet 内から run('tick step 1') を呼ぶと「コマンド実行中の run() は
//   遅延実行される」ためループ駆動できない。また __on_tick は freeze 中に
//   発火しない (実験済み)。よって tick step / fake player 入力は全て
//   ホスト側から rcon で 1 コマンドずつ発行し、各 step 後に scarpet の
//   fx_dump() でスナップショットを蓄積する。
// ============================================================

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseMcState, canonicalize } from '@redstone/sim'
import type {
  Fixture, FixtureExpectEntry, FixtureChange,
} from '../../../packages/sim/test/fixture-runner.js'

const harnessDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = join(harnessDir, '..', '..')
const fixturesDefDir = join(harnessDir, 'fixtures')
const sharedDir = join(harnessDir, 'scripts', 'shared')
const outDir = join(repoRoot, 'packages', 'sim', 'test', 'fixtures')

const PLAYER_NAME = 'GT'
// WSL2 + compose v2.22 / docker 29 の API バージョン不整合回避 (README 参照)
const env = { ...process.env, DOCKER_API_VERSION: process.env.DOCKER_API_VERSION ?? '1.44' }

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

function rcon(...args: string[]): string {
  const out = execFileSync(
    'docker',
    ['compose', 'exec', '-T', 'mc', 'rcon-cli', '--', ...args],
    { cwd: harnessDir, env, encoding: 'utf-8' },
  )
  return out.trim()
}

/** scarpet 関数呼び出し。' = ok' 応答以外はエラー扱い */
function scarpet(expr: string): string {
  const out = rcon('script', 'in', 'dump', 'run', expr)
  if (/error|failed|exception/i.test(out)) {
    throw new Error(`scarpet 実行エラー: ${expr}\n${out}`)
  }
  return out
}

/** 冪等なワールド初期化 (gamerule / forceload / freeze) */
function ensureWorldSetup(): void {
  const cmds: string[][] = [
    ['gamerule', 'doDaylightCycle', 'false'],
    ['gamerule', 'doWeatherCycle', 'false'],
    ['gamerule', 'doMobSpawning', 'false'],
    ['gamerule', 'doFireTick', 'false'],
    ['gamerule', 'randomTickSpeed', '0'],
    ['gamerule', 'announceAdvancements', 'false'],
    ['gamerule', 'spawnChunkRadius', '0'],
    ['setworldspawn', '0', '4', '0'],
    ['weather', 'clear'],
    ['forceload', 'add', '-16', '-16', '47', '31'],
    ['tick', 'freeze'],
  ]
  for (const c of cmds) rcon(...c)
  const loaded = rcon('script', 'load', 'dump')
  if (!/reloaded|loaded/.test(loaded)) throw new Error(`dump.sc をロードできない: ${loaded}`)
}

interface McDumpResult {
  name: string
  mc_world_time: number
  ticks: { tick: number; blocks: Record<string, string> }[]
}

function readCarpetVersion(): string {
  try {
    const out = execFileSync(
      'docker', ['compose', 'exec', '-T', 'mc', 'ls', '/data/mods'],
      { cwd: harnessDir, env, encoding: 'utf-8' },
    )
    const jar = out.split('\n').find(l => /carpet.*\.jar/i.test(l))
    return jar?.replace(/\.jar$/, '').replace(/^fabric-carpet-|^carpet-/, '') ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

function stateMapDiff(
  prev: Record<string, string>,
  cur: Record<string, string>,
): FixtureChange[] {
  const keys = new Set([...Object.keys(prev), ...Object.keys(cur)])
  const changes: FixtureChange[] = []
  for (const k of [...keys].sort()) {
    const p = prev[k] ?? 'air'
    const c = cur[k] ?? 'air'
    if (p !== c) {
      const pos = k.split(',').map(Number) as [number, number, number]
      changes.push({ pos, block: c })
    }
  }
  return changes
}

async function generateFixture(name: string): Promise<void> {
  const defPath = join(fixturesDefDir, `${name}.json`)
  const def = JSON.parse(readFileSync(defPath, 'utf-8')) as Omit<Fixture, 'expect'> & {
    player?: { spawn: number[]; facing: number[]; lookAt: number[] }
  }
  console.log(`\n=== fixture 生成: ${name} (${def.ticks} ticks) ===`)

  // 1. shared/fixture.json を書き出し (scarpet の set() 用に name/props 分解)
  mkdirSync(sharedDir, { recursive: true })
  const scBlocks = def.blocks.map(b => {
    const { name: n, props } = parseMcState(b.block)
    return { pos: b.pos, name: n, props }
  })
  writeFileSync(
    join(sharedDir, 'fixture.json'),
    JSON.stringify({ region: def.region, blocks: scBlocks }),
  )

  // 2. 設置 → 全ブロック update → settle 8 step
  rcon('player', PLAYER_NAME, 'kill') // 前回の残骸 (居なければ失敗するが無視される)
  scarpet('fx_setup()')
  scarpet('fx_settle()')
  rcon('tick', 'step', '8')
  await sleep(600)

  // 3. fake player 準備 (入力がある fixture のみ)
  const hasInputs = def.inputs.length > 0
  if (hasInputs) {
    if (!def.player) throw new Error(`${name}: inputs があるのに player 定義がない`)
    const [sx, sy, sz] = def.player.spawn
    const [yaw, pitch] = def.player.facing
    rcon('player', PLAYER_NAME, 'spawn', 'at', String(sx), String(sy), String(sz),
      'facing', String(yaw), String(pitch), 'in', 'minecraft:overworld', 'in', 'survival')
    await sleep(800)
    const [lx, ly, lz] = def.player.lookAt
    rcon('player', PLAYER_NAME, 'look', 'at', String(lx), String(ly), String(lz))
    await sleep(300)
  }

  // 4. settled 状態を tick -1 として dump (authored 照合用)
  scarpet('fx_dump(-1)')

  // 5. tick ループ: step → 入力 → dump
  for (let t = 0; t <= def.ticks; t++) {
    if (t > 0) {
      rcon('tick', 'step', '1')
      await sleep(120)
    }
    for (const input of def.inputs.filter(i => i.tick === t)) {
      if (input.action !== 'use') throw new Error(`未対応 action: ${input.action}`)
      rcon('player', PLAYER_NAME, 'use', 'once')
      await sleep(200)
    }
    scarpet(`fx_dump(${t})`)
  }

  // 6. 保存して回収
  scarpet(`fx_save('${name}')`)
  if (hasInputs) rcon('player', PLAYER_NAME, 'kill')
  const result = JSON.parse(
    readFileSync(join(sharedDir, 'result.json'), 'utf-8'),
  ) as McDumpResult

  // 7. settled (tick -1) が authored と一致するか検証
  const authored: Record<string, string> = {}
  for (const b of def.blocks) authored[b.pos.join(',')] = canonicalize(b.block)
  const settled = result.ticks.find(x => x.tick === -1)
  if (!settled) throw new Error('tick -1 (settled) が result にない')
  const settleDiff = stateMapDiff(authored, settled.blocks)
  if (settleDiff.length > 0) {
    console.error('authored 状態が実機の安定状態と一致しない (fixture 定義を修正すること):')
    for (const c of settleDiff) {
      console.error(`  ${c.pos.join(',')}: authored=${authored[c.pos.join(',')] ?? 'air'} -> settled=${c.block}`)
    }
    throw new Error(`${name}: settle 照合失敗`)
  }

  // 8. tick 毎差分 (expect) を計算
  const expect: FixtureExpectEntry[] = []
  let prev = authored
  for (let t = 0; t <= def.ticks; t++) {
    const entry = result.ticks.find(x => x.tick === t)
    if (!entry) throw new Error(`tick ${t} が result にない`)
    const changes = stateMapDiff(prev, entry.blocks)
    if (changes.length > 0) expect.push({ tick: t, changes })
    prev = entry.blocks
  }

  // 9. packages/sim/test/fixtures/<name>.json へ書き込み
  const { player: _player, ...defRest } = def
  const fixture: Fixture = {
    ...defRest,
    blocks: def.blocks.map(b => ({ pos: b.pos, block: canonicalize(b.block) })),
    expect,
    generated: {
      at: new Date().toISOString(),
      mc: def.mcVersion,
      carpet: readCarpetVersion(),
    },
  }
  mkdirSync(outDir, { recursive: true })
  const outPath = join(outDir, `${name}.json`)
  writeFileSync(outPath, JSON.stringify(fixture, null, 2) + '\n')
  console.log(`書き込み: ${outPath}`)
  console.log(`expect エントリ数: ${expect.length} (変化があった tick: ${expect.map(e => e.tick).join(', ')})`)
}

async function main() {
  const names = process.argv.slice(2)
  if (names.length === 0) {
    console.error('使い方: npx tsx tools/mc-harness/runner/generate.ts <fixture名> [...]')
    process.exit(1)
  }
  ensureWorldSetup()
  for (const name of names) {
    await generateFixture(name)
  }
}

main().catch(e => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
