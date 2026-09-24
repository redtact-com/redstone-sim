// ============================================================
// 実機セッション (#366 で live.ts に書いたものを #369 で切り出し)
//
// **実機を触る部分だけ**を持つ。WebSocket (live.ts) と MCP (mcp.ts) の
// 両方がこれを使う。1 本にしておかないと「ライブでは動くのに MCP では動かない」
// が起きる (ドライバを 2 本にしないのと同じ理由)。
// ============================================================

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseMcState } from '@redstone/sim'
import { rcon, scarpet, reloadDumpApp, sleep } from './rcon.js'
import { emitAttachedSupportUpdate } from './capture.js'
import { ensureWorldSetup } from './world-setup.js'
import { readScheduledTicks, readComparatorOutputs, readHopperCooldowns } from './scheduled-ticks.js'
import type { BlockMap, LiveChange, LiveHiddenState, LiveSessionInfo } from './live-protocol.js'

const harnessDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const fixturesDefDir = join(harnessDir, 'fixtures')
const sharedDir = join(harnessDir, 'scripts', 'shared')
const worldDir = join(harnessDir, 'data', 'world')

const PLAYER_NAME = 'GT'
/** 実機の応答を待つ余裕。generate.ts の tick step 後と同じ */
const STEP_SETTLE_MS = 120

/**
 * 2 つの状態マップの差分。**消滅は `'air'`** で表す
 * (fixture の expect と同じ規約。`packages/sim/test/fixture-runner.ts` の diff と揃える)
 */
export function diffBlockMaps(prev: BlockMap, cur: BlockMap): LiveChange[] {
  const keys = new Set([...Object.keys(prev), ...Object.keys(cur)])
  const out: LiveChange[] = []
  for (const k of [...keys].sort()) {
    const p = prev[k] ?? 'air'
    const c = cur[k] ?? 'air'
    if (p === c) continue
    const pos = k.split(',').map(Number) as [number, number, number]
    out.push({ pos, block: c })
  }
  return out
}

/**
 * `use` の狙点。**Y の小数部が全入力で共有される** (README の落とし穴)。
 * 床レバーは .35 / 床ボタンは .06 のように種類で変わるので、
 * fixture の `player.lookAt` に書かれた小数部をそのまま使う。
 */
export function lookTarget(
  pos: [number, number, number], lookY: number,
): [string, string, string] {
  return [String(pos[0] + 0.5), String(pos[1] + lookY), String(pos[2] + 0.5)]
}

// ─── 実機とのやりとり ────────────────────────────────────────────

interface LiveDef {
  name: string
  region: { from: number[]; to: number[] }
  blocks: { pos: number[]; block: string; items?: unknown }[]
  player?: { spawn: number[]; facing: number[]; lookAt: number[] }
}

function readCarpetVersion(): string {
  try {
    const out = execFileSync(
      'docker', ['compose', 'exec', '-T', 'mc', 'ls', '/data/mods'],
      { cwd: harnessDir, env: { ...process.env, DOCKER_API_VERSION: '1.44' }, encoding: 'utf-8' },
    )
    const jar = out.split('\n').find(l => /carpet.*\.jar/i.test(l))
    return jar?.replace(/\.jar$/, '').replace(/^fabric-carpet-|^carpet-/, '') ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

/** いまの region を実機から読む。dump.sc が shared/live.json に書いたものを回収する */
function scanRegion(): BlockMap {
  scarpet('fx_live_save()')
  const path = join(sharedDir, 'live.json')
  if (!existsSync(path)) throw new Error(`live.json が無い: ${path}`)
  const json = JSON.parse(readFileSync(path, 'utf-8')) as { blocks: BlockMap }
  return json.blocks ?? {}
}

/** 回路を置き直して落ち着かせる。掃除 → 空回し → 設置 の順は capture.ts と同じ理由 (#240) */
async function setupCircuit(def: LiveDef): Promise<void> {
  mkdirSync(sharedDir, { recursive: true })
  const scBlocks = def.blocks.map(b => {
    const { name, props } = parseMcState(b.block)
    return { pos: b.pos, name, props }
  })
  writeFileSync(
    join(sharedDir, 'fixture.json'),
    JSON.stringify({ region: def.region, blocks: scBlocks }),
  )

  // 残骸掃除は unfreeze 区間で行う (freeze 中は player kill/spawn が保留される)
  rcon('tick', 'unfreeze')
  rcon('player', PLAYER_NAME, 'kill')
  rcon('kill', '@e[type=!player]')
  await sleep(400)
  rcon('tick', 'freeze')

  // 前回の予約 tick を枯らしてから置く (#240)
  scarpet('fx_clear()')
  rcon('tick', 'step', '60')
  await sleep(600)
  scarpet('fx_setup()')
  scarpet('fx_settle()')
  rcon('tick', 'step', '8')
  await sleep(600)

  // fake player を出す (use 入力に要る)。spawn は unfreeze 区間でしか完了しない
  if (def.player) {
    const [sx, sy, sz] = def.player.spawn
    const [yaw, pitch] = def.player.facing
    rcon('tick', 'unfreeze')
    rcon('player', PLAYER_NAME, 'spawn', 'at', String(sx), String(sy), String(sz),
      'facing', String(yaw), String(pitch), 'in', 'minecraft:overworld', 'in', 'survival')
    await sleep(800)
    rcon('tick', 'freeze')
  }
}

/**
 * blockstate に出ない 3 値を保存ファイルから読む。
 *
 * **sim の出発点をそろえるのに要る** (予約 tick・コンパレーターの保持出力・
 * ホッパーのクールダウン)。`/save-all flush` の後でないと古い値を読む。
 */
function readHidden(def: LiveDef): LiveHiddenState | null {
  try {
    rcon('save-all', 'flush')
    const from = def.region.from as [number, number, number]
    const to = def.region.to as [number, number, number]
    return {
      scheduled: readScheduledTicks(worldDir, from, to).map(e => ({
        pos: e.pos, block: e.block, delay: e.delay, priority: e.priority,
      })),
      comparators: readComparatorOutputs(worldDir, from, to).map(e => ({
        pos: e.pos, output: e.output,
      })),
      cooldowns: readHopperCooldowns(worldDir, from, to).map(e => ({
        pos: e.pos, cooldown: e.cooldown,
      })),
    }
  } catch (e) {
    console.warn(`[live] 隠れ状態を読めなかった (sim の出発点がずれる可能性がある): ${
      e instanceof Error ? e.message : e}`)
    return null
  }
}


/** 実機が起きているか (落ちていても例外にしない) */
export function isHarnessUp(): boolean {
  try {
    rcon('list')
    return true
  } catch {
    return false
  }
}

/** fixture 定義の一覧 (MCP / CLI の入力補助) */
export function listFixtures(): string[] {
  return readdirSync(fixturesDefDir)
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace(/\.json$/, ''))
    .sort()
}

/**
 * 実機を保持したセッション。
 *
 * **1 命令ごとに region を全走査**して前回との差分を返す。fixture 規模なら十分速い
 * (キャプチャ側の差分機構は `/tick step N` をまとめて撃つ前提なので、
 * 人が 1 tick ずつ触る用途とは噛み合わない)。
 */
export class HarnessSession {
  private def: LiveDef
  private prev: BlockMap
  private _tick = 0
  private _hidden: LiveHiddenState | null
  private readonly withHidden: boolean
  readonly info: LiveSessionInfo

  private constructor(def: LiveDef, withHidden: boolean) {
    this.def = def
    this.withHidden = withHidden
    this.prev = {}
    this._hidden = null
    const lookY = def.player ? def.player.lookAt[1] - Math.floor(def.player.lookAt[1]) : 0.5
    this.info = {
      name: def.name,
      mcVersion: '1.21.1',
      carpet: readCarpetVersion(),
      region: {
        from: def.region.from as [number, number, number],
        to: def.region.to as [number, number, number],
      },
      lookY,
    }
  }

  /** fixture を開く。掃除 → 設置 → settle まで済ませる */
  static async open(name: string, opts: { withHidden?: boolean } = {}): Promise<HarnessSession> {
    const defPath = join(fixturesDefDir, `${name}.json`)
    if (!existsSync(defPath)) throw new Error(`fixture 定義が無い: ${name}`)
    const def = JSON.parse(readFileSync(defPath, 'utf-8')) as LiveDef
    def.name = name
    const s = new HarnessSession(def, opts.withHidden !== false)
    ensureWorldSetup()
    reloadDumpApp()   // dump.sc を読み直す (script load だけでは読み直さない)
    await s.reset()
    return s
  }

  get tick(): number { return this._tick }
  hidden(): LiveHiddenState | null { return this._hidden }
  /** いまの盤面 (最後に読んだもの) */
  state(): BlockMap { return this.prev }
  /** 1 座標だけ */
  inspect(pos: [number, number, number]): string {
    return this.prev[pos.join(',')] ?? 'air'
  }

  /** 置き直して 0 tick へ */
  async reset(): Promise<void> {
    await setupCircuit(this.def)
    this._tick = 0
    this.prev = scanRegion()
    this._hidden = this.withHidden ? readHidden(this.def) : null
  }

  async step(n: number): Promise<LiveChange[]> {
    for (let i = 0; i < n; i++) {
      rcon('tick', 'step', '1')
      await sleep(STEP_SETTLE_MS)
      this._tick++
    }
    return this.publish()
  }

  async use(pos: [number, number, number]): Promise<LiveChange[]> {
    const [lx, ly, lz] = lookTarget(pos, this.info.lookY)
    rcon('player', PLAYER_NAME, 'look', 'at', lx, ly, lz)
    await sleep(200)
    rcon('player', PLAYER_NAME, 'use', 'once')
    await sleep(200)
    return this.publish()
  }

  async setblock(pos: [number, number, number], block: string): Promise<LiveChange[]> {
    rcon('setblock', String(pos[0]), String(pos[1]), String(pos[2]), block)
    // レバー/ボタンは**支えブロックの隣**にも更新を配る (#290)。
    // 落とすと「ON にしたのに動かない」実機状態ができる
    emitAttachedSupportUpdate(pos, block)
    await sleep(200)
    return this.publish()
  }

  /** 実機を読み直して差分を返す */
  private publish(): LiveChange[] {
    const cur = scanRegion()
    const changes = diffBlockMaps(this.prev, cur)
    this.prev = cur
    return changes
  }
}
