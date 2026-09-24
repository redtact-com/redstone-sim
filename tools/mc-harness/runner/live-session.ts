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
import {
  emitAttachedSupportUpdate, placeCircuit, splitDrift, scanLiveRegion,
  type CaptureDef, type CaptureDefPlayer,
} from './capture.js'
import { ensureWorldSetup } from './world-setup.js'
import { readScheduledTicks, readComparatorOutputs, readHopperCooldowns } from './scheduled-ticks.js'
import { Announcer, changesSummary } from './announce.js'
import type { BlockMap, LiveChange, LiveHiddenState, LiveSessionInfo } from './live-protocol.js'

const harnessDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const fixturesDefDir = join(harnessDir, 'fixtures')
const capturesDefDir = join(harnessDir, 'captures')
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

/** いまの region を実機から読む (実装は capture.ts と共有する) */
const scanRegion = (): BlockMap => scanLiveRegion()

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

/** キャプチャ定義 (実回路) の一覧 */
export function listCaptureDefs(): string[] {
  if (!existsSync(capturesDefDir)) return []
  return readdirSync(capturesDefDir)
    .filter(f => f.endsWith('.def.json'))
    .map(f => f.replace(/\.def\.json$/, ''))
    .sort()
}

/** 何を開いているか。**狙点の流儀が違う**ので種類を持ち回る */
export type SessionKind = 'fixture' | 'capture'

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

  /**
   * ワールドに入っている人への合図 (#374)。
   *
   * **既定で知らせる**。知らせないと操作を見逃す (実際に見逃したのがこの機能の発端)。
   * 人が居なければ中で黙るので、誰も見ていないときの余分な rcon にはならない。
   */
  readonly announcer = new Announcer()

  private constructor(
    def: LiveDef, withHidden: boolean,
    private readonly kind: SessionKind = 'fixture',
    private readonly capDef: CaptureDef | null = null,
  ) {
    this.def = def
    this.withHidden = withHidden
    this.prev = {}
    this._hidden = null
    /*
     * `use` の狙点 (**種類で流儀が違う**)。
     *
     * - fixture … `player.lookAt` の Y 小数部を使う (床レバー .35 / 床ボタン .06)
     * - capture … ブロック中心 (`capture.ts` の applyInput と同じ `+0.5`)
     */
    const lookY = kind === 'capture'
      ? 0.5
      : def.player ? def.player.lookAt[1] - Math.floor(def.player.lookAt[1]) : 0.5
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

  /**
   * 回路を開く。掃除 → 設置 → settle まで済ませる。
   *
   * - `fixture` … `fixtures/<name>.json` (手書きの小さな回路)
   * - `capture` … `captures/<name>.def.json` + 回路ファイル (**実回路**)
   *
   * **自動判定はしない**。同名があったときにどちらを開いたのか分からなくなる
   */
  static async open(
    name: string,
    opts: { withHidden?: boolean; kind?: SessionKind; announce?: boolean } = {},
  ): Promise<HarnessSession> {
    const kind = opts.kind ?? 'fixture'
    ensureWorldSetup()
    reloadDumpApp()   // dump.sc を読み直す (script load だけでは読み直さない)

    if (kind === 'capture') {
      const defPath = join(capturesDefDir, `${name}.def.json`)
      if (!existsSync(defPath)) throw new Error(`キャプチャ定義が無い: ${name}`)
      const capDef = JSON.parse(readFileSync(defPath, 'utf-8')) as CaptureDef
      capDef.name = name
      const s = new HarnessSession({ name, region: { from: [0, 0, 0], to: [0, 0, 0] }, blocks: [] }, opts.withHidden !== false, 'capture', capDef)
      if (opts.announce === false) s.announcer.setEnabled(false)
      await s.reset()
      return s
    }

    const defPath = join(fixturesDefDir, `${name}.json`)
    if (!existsSync(defPath)) throw new Error(`fixture 定義が無い: ${name}`)
    const def = JSON.parse(readFileSync(defPath, 'utf-8')) as LiveDef
    def.name = name
    const s = new HarnessSession(def, opts.withHidden !== false, 'fixture')
    if (opts.announce === false) s.announcer.setEnabled(false)
    await s.reset()
    return s
  }

  /** 合図を送る (会話で決めた文面をそのまま出す) */
  async say(text: string, opts: { big?: boolean; countdown?: number } = {}): Promise<void> {
    if (opts.countdown !== undefined && opts.countdown > 0) {
      await this.announcer.countdown(opts.countdown, text)
    }
    this.announcer.say(text, { big: opts.big })
  }

  get tick(): number { return this._tick }
  hidden(): LiveHiddenState | null { return this._hidden }
  /** いまの盤面 (最後に読んだもの) */
  state(): BlockMap { return this.prev }
  /** 1 座標だけ */
  inspect(pos: [number, number, number]): string {
    return this.prev[pos.join(',')] ?? 'air'
  }

  /** 実回路のときの fake player (use に要る)。定義が持っていなければ null */
  private players: CaptureDefPlayer[] = []

  /** 置き直して 0 tick へ */
  async reset(): Promise<void> {
    if (this.kind === 'capture' && this.capDef !== null) {
      // **キャプチャと同じ関数**で置く (順序に意味があるので写経しない)
      const placed = await placeCircuit(this.capDef, (...a) => console.error(...a))
      this.players = placed.players
      // 定義の fake player も観客に数えない (#374)
      this.announcer.exclude(...placed.players.map(p => p.name))
      // **構造のズレはチャットにも出す** (#376)。
      // 見ている人にとっては「置いた瞬間に機械が壊れている」という一番知りたい情報で、
      // ホスト側のログには届かない
      const { structural } = splitDrift(placed.drift)
      if (structural.length > 0) {
        const head = structural.slice(0, 2).map(d => `${d.pos} ${d.source}→${d.settled}`).join(' / ')
        this.announcer.say(
          `⚠ 置いた結果が元ファイルと ${structural.length} か所ズレています (${head})`,
          { color: 'red' },
        )
      }
      // 走査範囲は placeCircuit → fx_setup が shared/fixture.json から
      // global_region に入れているので、こちらで教え直す必要はない
      this.def.region = { from: placed.region.from, to: placed.region.to }
      this.info.region = {
        from: placed.region.from as [number, number, number],
        to: placed.region.to as [number, number, number],
      }
    } else {
      await setupCircuit(this.def)
    }
    this._tick = 0
    this.prev = scanRegion()
    this._hidden = this.withHidden ? readHidden(this.def) : null
    this.announcer.say(
      `回路 ${this.def.name} を置きました (${Object.keys(this.prev).length} ブロック / tick 0)`,
      { big: true },
    )
  }

  async step(n: number): Promise<LiveChange[]> {
    this.announcer.say(`${n} tick 進めます (いま tick ${this._tick})`, { big: true })
    for (let i = 0; i < n; i++) {
      rcon('tick', 'step', '1')
      await sleep(STEP_SETTLE_MS)
      this._tick++
    }
    const changes = this.publish()
    this.announcer.say(`▶ 進めました (tick ${this._tick})。${changesSummary(changes)}`)
    return changes
  }

  async use(pos: [number, number, number]): Promise<LiveChange[]> {
    // 実回路は定義が持つ fake player を使う (fixture は固定名 GT)
    const who = this.kind === 'capture' ? this.players[0]?.name : PLAYER_NAME
    if (who === undefined) {
      throw new Error(`${this.def.name} には players が無いので押せない (定義に players を足すこと)`)
    }
    this.announcer.say(`レバー等を押します (${pos.join(',')})`, { big: true })
    const [lx, ly, lz] = lookTarget(pos, this.info.lookY)
    rcon('player', who, 'look', 'at', lx, ly, lz)
    await sleep(200)
    rcon('player', who, 'use', 'once')
    await sleep(200)
    const changes = this.publish()
    this.announcer.say(`▶ 押しました (${pos.join(',')})。${changesSummary(changes)}`)
    return changes
  }

  async setblock(pos: [number, number, number], block: string): Promise<LiveChange[]> {
    this.announcer.say(`${block.split('[')[0]} を置きます (${pos.join(',')})`, { big: true })
    rcon('setblock', String(pos[0]), String(pos[1]), String(pos[2]), block)
    // レバー/ボタンは**支えブロックの隣**にも更新を配る (#290)。
    // 落とすと「ON にしたのに動かない」実機状態ができる
    emitAttachedSupportUpdate(pos, block)
    await sleep(200)
    const changes = this.publish()
    this.announcer.say(`▶ 置きました (${pos.join(',')})。${changesSummary(changes)}`)
    return changes
  }

  /** 実機を読み直して差分を返す */
  private publish(): LiveChange[] {
    const cur = scanRegion()
    const changes = diffBlockMaps(this.prev, cur)
    this.prev = cur
    return changes
  }
}
