// ============================================================
// capture.ts — 実回路を実機に置いて「操作 → N tick 後」を採る (#240)
//
//   npx tsx tools/mc-harness/runner/capture.ts <定義.json> [--snapshot-only]
//
// 既存の generate.ts (手書き fixture 用) との違い:
//
//   1. **回路ファイル (.litematic/.nbt/.schem) をそのまま食う**。
//      sim の型に変換せず **生の blockstate** を置くので、装飾・塀・泡柱が落ちない
//   2. **settle 照合で落とさない**。実回路は「実機が正」なので、
//      安定状態を採用して authored にする (ズレはレポートに出す)
//   3. **差分だけ記録する**。6393 ブロック x 201 tick のフルダンプは 115.9MB になる (実測)
//   4. **プレイヤーを乗せられる**。carpet の fake player は泡柱で実際に上昇する
//      (実測: y -58.7 → -47.5)。毎 tick 座標を記録する
//
// 定義ファイルの形:
// ```jsonc
// {
//   "name": "elevator-floor5",
//   "source": "/mnt/c/Users/.../xxx.litematic",
//   "ticks": 200,
//   "pad": 2,                                  // region を回路 bbox から広げる量
//   "players": [{ "name": "gt", "spawn": [3.5, 6, 1.5] }],
//   "inputs": [
//     { "tick": 2,  "pos": [5, 2, 8], "action": "container", "signal": 5 },
//     { "tick": 10, "pos": [2, 1, 7], "action": "use" }
//   ],
//   "snapshots": [0, 60, 200]                  // 回路ファイルに書き出す tick
// }
// ```
// ============================================================

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { rcon, scarpet, withHarnessLock, sleep } from './rcon.js'
import type { Capture } from './compare.js'
import { readScheduledTicks } from './scheduled-ticks.js'
import { readRawPlacedBlocks } from '../../../app/src/nbtIO.js'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..', '..', '..')
const sharedDir = join(repoRoot, 'tools', 'mc-harness', 'scripts', 'shared')
const outDir = join(repoRoot, 'tools', 'mc-harness', 'captures')

/** 実機に乗せる fake player */
export interface CaptureDefPlayer {
  name: string
  /** 立たせる座標 (回路ローカル。小数可) */
  spawn: [number, number, number]
}

export interface CaptureDefInput {
  tick: number
  pos: [number, number, number]
  /**
   * 'use'       … fake player の右クリック (レバー/ボタン/ドア)
   * 'setblock'  … `/setblock` 相当。`block` に blockstate 文字列
   * 'container' … コンテナの中身を `signal` (0-15) 相当にする (#236 の入力)
   * 'tp'        … fake player を `to` へ飛ばす (シャフトへ入れる等)
   * 'kill'      … 近傍のエンティティを消す
   */
  action: 'use' | 'setblock' | 'container' | 'tp' | 'kill'
  block?: string
  signal?: number
  player?: string
  to?: [number, number, number]
}

export interface CaptureDef {
  name: string
  source: string
  ticks: number
  pad?: number
  players?: CaptureDefPlayer[]
  inputs?: CaptureDefInput[]
  snapshots?: number[]
  /**
   * **回路の一部だけを置く** (#食い違いの自動最小化)。座標キー "x,y,z" の配列で、
   * 指定があるとその座標のブロックだけが実機に置かれ、region は
   * **keep の bbox + pad** に縮む (指定が無ければ従来どおり回路全体)。
   *
   * 座標は「回路ファイルを原点寄せした後」の系 (= キャプチャ JSON / fixture と同じ)。
   * ブロックの無い座標を書いても構わない (region を広げるだけ)。入力の当たり先を
   * region に含めたいときに使う。
   */
  keep?: string[]
}

// Capture の形は **compare.ts が正**。二重定義するとドリフトして
// 「書いた側と読む側で形が違う」事故になるので、型はそちらから貰う
export type { Capture } from './compare.js'

const MC_VERSION = '1.21.1'

/** "x,y,z" → [x,y,z] */
const parseKey = (k: string): [number, number, number] =>
  k.split(',').map(Number) as [number, number, number]

/** RawPlacedBlock の props から blockstate 文字列を組む (キー昇順) */
function toStateString(name: string, props: Record<string, string>): string {
  const id = name.replace(/^minecraft:/, '')
  const keys = Object.keys(props).sort()
  return keys.length === 0 ? id : `${id}[${keys.map(k => `${k}=${props[k]}`).join(',')}]`
}

export interface CaptureRegion {
  from: [number, number, number]
  to: [number, number, number]
}

export interface SelectedBlocks<T> {
  /** 実機に置くブロック (keep 指定があればその座標だけ) */
  blocks: T[]
  /** 観測 + 掃除の範囲 */
  region: CaptureRegion
  /** keep に書いたのに回路にブロックが無かった座標 (誤字の検出用。region は広がる) */
  missing: string[]
}

/** 座標列の bbox。空なら null */
function bboxOf(positions: readonly [number, number, number][]): CaptureRegion | null {
  if (positions.length === 0) return null
  const min: [number, number, number] = [Infinity, Infinity, Infinity]
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  for (const p of positions) {
    for (let i = 0; i < 3; i++) {
      if (p[i] < min[i]) min[i] = p[i]
      if (p[i] > max[i]) max[i] = p[i]
    }
  }
  return { from: min, to: max }
}

/**
 * 置くブロックを選び、region を決める純関数 (実機に触らないのでテストできる)。
 *
 * - `keep` 無し … 全ブロック。region は回路全体の bbox + pad
 * - `keep` あり … その座標のブロックだけ。region は **keep 座標の bbox + pad**
 *
 * どちらも **下端 y だけは 0 より下げない**。回路は原点寄せ済みで y=0 が床、
 * ワールドは void superflat なので y<0 には何も無く、掃除範囲を広げても無駄なだけ。
 * (keep 無しの場合 min は必ず (0,0,0) になるので from = [-pad, 0, -pad] という
 *  従来の式と完全に一致する)
 */
export function selectPlacedBlocks<T extends { pos: [number, number, number] }>(
  blocks: readonly T[], pad: number, keep?: readonly string[],
): SelectedBlocks<T> {
  const missing: string[] = []
  let picked: T[]
  let anchors: [number, number, number][]

  if (keep === undefined) {
    picked = [...blocks]
    anchors = picked.map(b => b.pos)
  } else {
    // keep は外から来る (最小化ループが組み立てる) ので形式を検証してから使う。
    // 壊れたキーを黙って捨てると region がこっそり縮んで原因不明の食い違いになる
    const wanted = new Map<string, [number, number, number]>()
    for (const k of keep) wanted.set(k, parseKeyStrict(k))
    picked = blocks.filter(b => wanted.has(b.pos.join(',')))
    const placed = new Set(picked.map(b => b.pos.join(',')))
    for (const k of wanted.keys()) if (!placed.has(k)) missing.push(k)
    anchors = [...wanted.values()]
  }

  const bbox = bboxOf(anchors)
  if (bbox === null) throw new Error('置くブロックが 1 つも無い (keep が空か、全て回路の外)')
  return {
    blocks: picked,
    region: {
      from: [bbox.from[0] - pad, Math.max(0, bbox.from[1] - pad), bbox.from[2] - pad],
      to: [bbox.to[0] + pad, bbox.to[1] + pad, bbox.to[2] + pad],
    },
    missing,
  }
}

/** "x,y,z" → [x,y,z]。壊れたキーは例外 (黙って捨てない) */
function parseKeyStrict(key: string): [number, number, number] {
  const parts = key.split(',').map(s => Number(s.trim()))
  if (parts.length !== 3 || parts.some(n => !Number.isInteger(n))) {
    throw new Error(`keep の座標キーが不正: "${key}" ("x,y,z" 形式で書くこと)`)
  }
  return [parts[0], parts[1], parts[2]]
}

/**
 * 回路ファイルを読み、原点寄せして「置くブロック」と region を決める。
 *
 * `fullRegion` は keep で絞る前の回路全体の範囲。keep で縮めたときの
 * **掃除範囲**に使う (縮めた region だけを掃除すると、前回のキャプチャで置いた
 * ブロックが region のすぐ外に残り、実機だけが影響を受ける — README の「残骸」)。
 */
export async function loadCircuit(def: CaptureDef) {
  const path = def.source
  if (!existsSync(path)) throw new Error(`回路ファイルが無い: ${path}`)
  const raw = await readRawPlacedBlocks(new Uint8Array(readFileSync(path)))
  if (raw.length === 0) throw new Error(`ブロックが 1 つも読めなかった: ${path}`)

  // 原点寄せ (回路ファイルの座標は 0 始まりとは限らない)
  let minX = Infinity, minY = Infinity, minZ = Infinity
  for (const b of raw) {
    if (b.pos[0] < minX) minX = b.pos[0]
    if (b.pos[1] < minY) minY = b.pos[1]
    if (b.pos[2] < minZ) minZ = b.pos[2]
  }
  const blocks = raw.map(b => {
    const { name, props } = { name: b.name, props: b.props }
    return {
      pos: [b.pos[0] - minX, b.pos[1] - minY, b.pos[2] - minZ] as [number, number, number],
      name: name.replace(/^minecraft:/, ''),
      props,
      items: b.items,
    }
  })
  const pad = def.pad ?? 1
  const picked = selectPlacedBlocks(blocks, pad, def.keep)
  return {
    blocks: picked.blocks,
    region: picked.region,
    // keep で縮めても掃除だけは回路全体に掛ける (前回の残骸を region の外に残さない)
    fullRegion: selectPlacedBlocks(blocks, pad).region,
    missing: picked.missing,
  }
}

/**
 * 記録側の tick が target に届くまで待つ。
 *
 * `/tick step N` は**即座に返る** (サーバは後から N tick 進める) ので、
 * sleep で待つと先走って記録が途中で終わる (実機で 120 tick 指定して 46 tick しか
 * 採れなかった)。1 tick ごとに領域を全走査するぶん所要時間は回路の大きさで変わるため、
 * **完了はポーリングで確かめる**。
 */
async function waitForTick(target: number, timeoutMs = 15 * 60 * 1000): Promise<void> {
  const started = Date.now()
  let last = -1
  for (;;) {
    const cur = Number(scarpet('fx_cap_tick()').match(/=\s*(\d+)/)?.[1] ?? -1)
    if (cur >= target) return
    if (cur !== last) { last = cur; if (process.env.GT_DEBUG) console.log(`[capture] tick ${cur}/${target}`) }
    if (Date.now() - started > timeoutMs) {
      throw new Error(`tick が進まない (${cur}/${target})。サーバが固まっていないか確認すること`)
    }
    await sleep(400)
  }
}

/** 入力を実機へ当てる。当てた「直後」に fx_cap_reframe を呼ぶのは呼び出し側 */
async function applyInput(input: CaptureDefInput, players: CaptureDefPlayer[]): Promise<void> {
  const [x, y, z] = input.pos
  switch (input.action) {
    case 'use': {
      const name = input.player ?? players[0]?.name
      if (!name) throw new Error(`use には fake player が要る (players を定義する): ${input.pos}`)
      // ブロック中心へ照準し直してから 1 回だけ使う
      rcon('player', name, 'look', 'at', String(x + 0.5), String(y + 0.5), String(z + 0.5))
      await sleep(150)
      rcon('player', name, 'use', 'once')
      await sleep(150)
      break
    }
    case 'setblock':
      if (!input.block) throw new Error(`setblock に block が無い: ${input.pos}`)
      rcon('setblock', String(x), String(y), String(z), input.block)
      break
    case 'container': {
      // コンテナの中身をコンパレーター強度 signal 相当にする (#236)。
      // 樽 27 スロット x 64 で f = 個数/容量、signal = floor(f*14)+1
      //
      // **2 段構え**にする。scarpet の inventory_set は速いが
      // vanilla の `Container.setItem → setChanged` を通らないため
      // **コンパレーターが更新されない** (空にしても前の値が残る — 実測)。
      // 中身は scarpet で作り、**最後に slot 0 だけ `/item replace block` で置き直す**。
      // こうすると更新の出方が実機のプレイヤー操作と同じになる
      const s = Math.max(0, Math.min(15, Math.floor(input.signal ?? 0)))
      const ret = scarpet(`fx_set_signal([${x},${y},${z}], ${s})`)
      const first = Number(ret.match(/\[\s*\d+\s*,\s*(\d+)\s*\]/)?.[1] ?? 0)
      if (first > 0) {
        rcon('item', 'replace', 'block', String(x), String(y), String(z),
          'container.0', 'with', 'minecraft:cobblestone', String(first))
      } else {
        rcon('item', 'replace', 'block', String(x), String(y), String(z),
          'container.0', 'with', 'minecraft:air')
      }
      break
    }
    case 'tp': {
      const name = input.player ?? players[0]?.name
      if (!name) throw new Error('tp には fake player が要る')
      const to = input.to ?? [x + 0.5, y, z + 0.5]
      rcon('tp', name, String(to[0]), String(to[1]), String(to[2]))
      await sleep(150)
      break
    }
    case 'kill':
      rcon('kill', `@e[type=!player,x=${x},y=${y},z=${z},distance=..3]`)
      break
  }
}

/** capture() の任意設定 */
export interface CaptureOptions {
  /**
   * 進捗ログを出さない。最小化ループは 1 回のキャプチャにつき 10 行以上出されると
   * 「残り何ブロックか」が流れて読めなくなるので、そこからは静かに呼ぶ
   */
  quiet?: boolean
}

export async function capture(defPath: string, opts: CaptureOptions = {}): Promise<Capture> {
  const log = opts.quiet === true ? () => {} : (...a: unknown[]) => console.log(...a)
  const def = JSON.parse(readFileSync(defPath, 'utf-8')) as CaptureDef
  const { blocks, region, fullRegion, missing } = await loadCircuit(def)
  log(`[capture] ${def.name}: ${blocks.length} ブロック / region ${region.from} - ${region.to}`)
  if (missing.length > 0) {
    log(`[capture] keep のうち ${missing.length} 座標には回路のブロックが無い (region を広げるだけ): `
      + missing.slice(0, 5).join(' '))
  }

  // 1. 共有 JSON へ (rcon のコマンド長 1014 文字を超えられないのでファイル経由)
  const items = blocks
    .filter(b => b.items && b.items.length > 0)
    .map(b => ({ pos: b.pos, slots: b.items!.map(i => ({ slot: i.slot, id: i.id.replace(/^minecraft:/, ''), count: i.count })) }))
  mkdirSync(sharedDir, { recursive: true })
  writeFileSync(join(sharedDir, 'fixture.json'), JSON.stringify({
    region,
    // 掃除だけは回路全体に掛ける (keep で region を縮めたとき、前回置いた
    // ブロックが region の外に残って実機側だけを動かすのを防ぐ)
    clear: fullRegion,
    blocks: blocks.map(b => ({ pos: b.pos, name: b.name, props: b.props })),
    items,
  }))
  log(`[capture] コンテナ ${items.length} 個 / スロット ${items.reduce((n, i) => n + i.slots.length, 0)}`)

  // 2. 設置 → 中身 → 安定化
  rcon('tick', 'freeze')
  scarpet('fx_setup()')
  if (items.length > 0) {
    const n = scarpet('fx_items()')
    log(`[capture] 中身を投入: ${n.trim()}`)
    scarpet('fx_settle()')   // #196: 中身を入れた後にもう一度更新を配らないとコンパレーターが読まない
  }
  scarpet('fx_settle()')
  rcon('tick', 'step', '8')
  await sleep(600)

  // 3. 元ファイルとのズレを記録する (落とさない。実機が正)
  const source: Record<string, string> = {}
  for (const b of blocks) source[b.pos.join(',')] = toStateString(b.name, b.props)
  scarpet(`fx_cap_authored('${def.name}')`)
  const authored = (JSON.parse(readFileSync(join(sharedDir, 'authored.json'), 'utf-8')) as {
    blocks: Record<string, string>
  }).blocks
  const settleDrift: Capture['settleDrift'] = []
  for (const k of new Set([...Object.keys(source), ...Object.keys(authored)])) {
    if (source[k] !== authored[k]) {
      settleDrift.push({ pos: k, source: source[k] ?? 'air', settled: authored[k] ?? 'air' })
    }
  }
  if (settleDrift.length > 0) {
    log(`[capture] 元ファイルと実機の安定状態が ${settleDrift.length} か所ズレた (実機を採用)`)
    for (const d of settleDrift.slice(0, 8)) log(`    ${d.pos}: ファイル=${d.source} 実機=${d.settled}`)
    if (settleDrift.length > 8) log(`    … 他 ${settleDrift.length - 8} 件`)
  }

  // 3b. **実機の予約 tick を読む** (#240)。
  // 「あと 5gt で ON」のような予約は blockstate に出ないので、これが無いと
  // 動いている機械の出発点を sim 側で再現できない
  rcon('save-all', 'flush')
  await sleep(1500)
  const scheduled = readScheduledTicks(
    join(repoRoot, 'tools', 'mc-harness', 'data', 'world'), region.from, region.to)
  if (scheduled.length > 0) {
    log(`[capture] 実機の予約 tick: ${scheduled.length} 件`)
    for (const st of scheduled.slice(0, 5)) {
      log(`    ${st.pos.join(',')} ${st.block.replace('minecraft:', '')} 残り ${st.delay}gt 優先度 ${st.priority}`)
    }
  }

  // 4. プレイヤーを置く
  const players = def.players ?? []
  for (const p of players) {
    rcon('player', p.name, 'spawn', 'at', String(p.spawn[0]), String(p.spawn[1]), String(p.spawn[2]))
    await sleep(300)
  }

  // 5. 記録開始 → 入力を挟みながら tick を進める
  const watch = players.map(p => `'${p.name}'`).join(',')
  scarpet(`fx_cap_start([${watch}])`)
  const inputs = (def.inputs ?? []).slice().sort((a, b) => a.tick - b.tick)
  let cur = 0
  for (const input of inputs) {
    if (input.tick > def.ticks) break
    if (input.tick > cur) {
      // **1 コマンドで N tick 進む**。__on_tick が 1 tick ずつ差分を記録する
      rcon('tick', 'step', String(input.tick - cur))
      await waitForTick(input.tick)
      cur = input.tick
    }
    await applyInput(input, players)
    scarpet('fx_cap_reframe()')
  }
  if (def.ticks > cur) {
    rcon('tick', 'step', String(def.ticks - cur))
    await waitForTick(def.ticks)
  }

  // 6. 回収
  const saved = scarpet(`fx_cap_save('${def.name}')`)
  log(`[capture] 記録: ${saved.trim()}`)
  const raw = JSON.parse(readFileSync(join(sharedDir, 'capture.json'), 'utf-8')) as {
    ticks: number
    frames: { tick: number; changes: { pos: string; block: string }[] }[]
    players: { tick: number; name: string; pos: number[]; on_ground: boolean }[]
  }
  for (const p of players) rcon('player', p.name, 'kill')

  const out: Capture = {
    name: def.name,
    source: def.source,
    mcVersion: MC_VERSION,
    region,
    authored,
    ...(items.length > 0 ? { items } : {}),
    inputs,
    ticks: raw.ticks,
    frames: raw.frames.map(f => ({
      tick: f.tick,
      changes: f.changes.map(c => ({ pos: parseKey(c.pos), block: c.block })),
    })),
    players: raw.players.map(p => ({
      tick: p.tick, name: p.name,
      pos: [p.pos[0], p.pos[1], p.pos[2]],
      onGround: p.on_ground,
    })),
    ...(scheduled.length > 0 ? { scheduled } : {}),
    ...(settleDrift.length > 0 ? { settleDrift } : {}),
    generated: { at: new Date().toISOString(), mc: MC_VERSION, carpet: readCarpetVersion() },
  }
  mkdirSync(outDir, { recursive: true })
  const outPath = join(outDir, `${def.name}.json`)
  writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n')
  log(`[capture] 書き込み: ${outPath}`)
  log(`[capture] 変化のあった tick: ${out.frames?.length ?? 0} / 記録 ${out.ticks} tick`)
  return out
}

function readCarpetVersion(): string {
  try {
    const modsDir = join(repoRoot, 'tools', 'mc-harness', 'data', 'mods')
    const f = readFileSync(join(modsDir, '.index.json'), 'utf-8')
    const m = f.match(/carpet[^"]*?(\d[\w.+-]*)\.jar/)
    return m ? m[1] : 'unknown'
  } catch { return 'unknown' }
}

async function main() {
  const args = process.argv.slice(2)
  if (args.length === 0) {
    console.error('使い方: npx tsx tools/mc-harness/runner/capture.ts <定義.json>')
    process.exit(1)
  }
  for (const p of args.filter(a => !a.startsWith('-'))) {
    await withHarnessLock(() => capture(p))
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(e => {
    console.error(e instanceof Error ? e.message : e)
    process.exit(1)
  })
}
