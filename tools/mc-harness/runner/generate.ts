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
//
// ブロックの文字列の扱い (#242):
//   - 比べるとき (settle 照合・expect の差分) は**両側を canonicalize してから**比べる。
//     実機の dump (dump.sc の _canon) は名前空間を外してキーを並べるだけで、材質は生のまま
//     返ってくる。片側だけ畳むと、羊毛・色付きガラス・ハーフ (waterlogged) を置いた定義が
//     必ず落ちる。fixture-runner が sim と比べるときも両側を畳んでいる
//   - 書くとき (fixture の blocks / expect) は**畳まない**。blocks は名前空間を外してキーを
//     並べるだけ (ビューアーが元の見た目で描くのに使う。#343)、expect は実機の生の文字列
//
// rcon・ワールド初期化・ロックは rcon.ts / world-setup.ts の共通の経路を使う (#242)。
// 実行中はハーネスのロックを握る。capture / live / MCP と並行して叩くと rcon の応答が混線する。
// ============================================================

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { constants as osConstants } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseMcState, formatMcState, canonicalize } from '@redstone/sim'
import { emitAttachedSupportUpdate } from './capture.js'
import {
  rcon, scarpet, sleep, reloadDumpApp, readCarpetVersion,
  withHarnessLock, refreshHarnessLock, releaseHarnessLock,
} from './rcon.js'
import { ensureWorldSetup } from './world-setup.js'
import type {
  Fixture, FixtureExpectEntry, FixtureChange,
} from '../../../packages/sim/test/fixture-runner.js'

const harnessDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = join(harnessDir, '..', '..')
const fixturesDefDir = join(harnessDir, 'fixtures')
const sharedDir = join(harnessDir, 'scripts', 'shared')
const outDir = join(repoRoot, 'packages', 'sim', 'test', 'fixtures')

const PLAYER_NAME = 'GT'

/**
 * ロックの取得時刻を更新する間隔。--all は 30 分ほどかかるが、
 * ロックは 10 分 (LOCK_STALE_MS) で残骸とみなされて他の実行に奪われる
 */
const LOCK_HEARTBEAT_MS = 60_000

interface McDumpResult {
  name: string
  mc_world_time: number
  ticks: { tick: number; blocks: Record<string, string> }[]
}

// ─── 照合と書き出し (純粋な部分。generate.test.ts が実機なしで検査する) ───

/** 盤面。'x,y,z' → blockstate 文字列 (air は持たない) */
type StateMap = Record<string, string>
type DefBlock = Fixture['blocks'][number]

/**
 * fixture に書く形。名前空間を外してキーを並べるだけ (dump.sc の `_canon` と同じ形)。
 * **材質は畳まない** (ビューアーが元の見た目で描くのに使う。#343)
 */
export function normalizeState(state: string): string {
  const { name, props } = parseMcState(state)
  return formatMcState(name, props)
}

/**
 * 2 つの盤面の差分。消滅は 'air' で表す。
 *
 * **比べるのは canonicalize した形、書くのは cur の生の文字列** (#242)。
 * 材質だけの違い (羊毛 ⇄ 石) やハーフの waterlogged の有無は変化として数えない。
 */
export function stateMapDiff(prev: StateMap, cur: StateMap): FixtureChange[] {
  const keys = new Set([...Object.keys(prev), ...Object.keys(cur)])
  const changes: FixtureChange[] = []
  for (const k of [...keys].sort()) {
    const p = prev[k] ?? 'air'
    const c = cur[k] ?? 'air'
    if (canonicalize(p) !== canonicalize(c)) {
      const pos = k.split(',').map(Number) as [number, number, number]
      changes.push({ pos, block: c })
    }
  }
  return changes
}

/** 定義の blocks を盤面にする (書く形のまま) */
export function authoredMap(blocks: readonly DefBlock[]): StateMap {
  const m: StateMap = {}
  for (const b of blocks) m[b.pos.join(',')] = normalizeState(b.block)
  return m
}

export interface SettleMismatch {
  pos: string
  /** 定義の文字列 (書く形) */
  authored: string
  /** 実機の生の文字列 */
  settled: string
}

/**
 * settle 照合。定義の blocks と実機の tick -1 (settle 後) を両側 canonicalize して比べ、
 * 食い違った座標を返す (空なら一致)。
 * 報告には定義の文字列と実機の生の文字列を並べる (畳んだ形では何を直せばよいか読めない)
 */
export function settleMismatches(
  blocks: readonly DefBlock[], settled: StateMap,
): SettleMismatch[] {
  const authored = authoredMap(blocks)
  return stateMapDiff(authored, settled).map(c => {
    const pos = c.pos.join(',')
    return { pos, authored: authored[pos] ?? 'air', settled: c.block }
  })
}

/**
 * tick ごとの差分 (expect)。tick 0 の基準は定義の blocks。
 * 畳んだ形で比べるので、材質を置いた座標が tick 0 の偽の変化として載ることはない
 */
export function buildExpect(
  blocks: readonly DefBlock[],
  ticks: readonly { tick: number; blocks: StateMap }[],
  nTicks: number,
): FixtureExpectEntry[] {
  const expect: FixtureExpectEntry[] = []
  let prev = authoredMap(blocks)
  for (let t = 0; t <= nTicks; t++) {
    const entry = ticks.find(x => x.tick === t)
    if (!entry) throw new Error(`tick ${t} が result にない`)
    const changes = stateMapDiff(prev, entry.blocks)
    if (changes.length > 0) expect.push({ tick: t, changes })
    prev = entry.blocks
  }
  return expect
}

/** fixture に書く blocks。材質を残し、items はそのまま */
export function fixtureBlocks(blocks: readonly DefBlock[]): Fixture['blocks'] {
  return blocks.map(b => ({
    pos: b.pos,
    block: normalizeState(b.block),
    ...(b.items !== undefined ? { items: b.items } : {}),
  }))
}

// ─── 実機の駆動 ───────────────────────────────────────────────────

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

  // 2. 残骸掃除 → 設置 → settle 8 step
  // freeze 中は player kill/spawn がその場で処理されない (次の step まで保留され、
  // 残骸状態によっては以後の入力が全て空振りする)。掃除は必ず unfreeze 区間で行う
  rcon('tick', 'unfreeze')
  rcon('player', PLAYER_NAME, 'kill') // 前回の残骸 (居なければ失敗するが無視される)
  // **プレイヤー以外のエンティティも全て消す** (#161)。fx_setup が消すのは region 内の
  // ブロックだけなので、前の fixture が残したマインカート (#146 の summon) や
  // ディスペンサーが射出したアイテムがワールドに居座り、**fake player のクリックを
  // 奪って use が空振りする**。テストワールドにはハーネスの生成物しか無いので全消しでよい
  rcon('kill', '@e[type=!player]')
  await sleep(400)
  rcon('tick', 'freeze')
  scarpet('fx_setup()')
  scarpet('fx_settle()')
  // コンテナ (hopper/dropper/barrel 等) の初期アイテム充填 (#65)。
  // items は blockstate に現れない BE 内容のため item replace で入れる
  // (数値モデルの count に対応。settle dump より前に行い、コンパレーター読み等の
  // 初期安定状態へ反映させる)
  for (const b of def.blocks) {
    if (b.items === undefined) continue
    // 数値は旧形式 (cobblestone を slot 0 に n 個)。配列はスロット指定 (#194) で、
    // **スタック上限の違うアイテムを混ぜた状態**を実機に作れる
    const specs = typeof b.items === 'number'
      ? (b.items > 0 ? [{ slot: 0, id: 'cobblestone', count: b.items }] : [])
      : b.items
    for (const it of specs) {
      const id = it.id.startsWith('minecraft:') ? it.id : `minecraft:${it.id}`
      rcon('item', 'replace', 'block',
        String(b.pos[0]), String(b.pos[1]), String(b.pos[2]),
        `container.${it.slot}`, 'with', id, String(it.count))
      await sleep(80)
    }
  }
  // #196: 充填後にもう一度 update を配る。fx_settle() は上で 1 度呼んでいるが
  // **アイテムを入れる前**なので、コンテナ隣接のコンパレーターが中身を読みに
  // 行かないままになる (authored は without_updates で置かれるため、
  // /item replace だけでは comparator の OutputSignal が 0 のまま残る)。
  // これが無いと混載ホッパーの fixture が settle 照合を通せなかった
  if (def.blocks.some(b => b.items !== undefined)) {
    scarpet('fx_settle()')
    await sleep(200)
  }
  rcon('tick', 'step', '8')
  await sleep(600)

  // 3. fake player 準備 (入力がある fixture のみ)。
  // spawn も freeze 中は完了しないため、床設置後に一時 unfreeze して行う。
  // unfreeze 中に ~20tick 走るが、authored は settled 安定状態なので不変
  // (発振回路 fixture を作る場合はこの前提が崩れる点に注意)
  const hasInputs = def.inputs.length > 0
  if (hasInputs) {
    if (!def.player) throw new Error(`${name}: inputs があるのに player 定義がない`)
    const [sx, sy, sz] = def.player.spawn
    const [yaw, pitch] = def.player.facing
    rcon('tick', 'unfreeze')
    rcon('player', PLAYER_NAME, 'spawn', 'at', String(sx), String(sy), String(sz),
      'facing', String(yaw), String(pitch), 'in', 'minecraft:overworld', 'in', 'survival')
    await sleep(800)
    const [lx, ly, lz] = def.player.lookAt
    rcon('player', PLAYER_NAME, 'look', 'at', String(lx), String(ly), String(lz))
    await sleep(300)
    rcon('tick', 'freeze')
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
      if (input.action === 'use') {
        // input.pos のブロックへ毎回照準し直す (複数レバー fixture 対応)。
        // 高さは fixture の player.lookAt の Y オフセットを流用する
        // (床レバー 1.35 / 床ボタン 1.06 などブロック種で異なるため)
        const lookY = def.player!.lookAt[1] - Math.floor(def.player!.lookAt[1])
        rcon('player', PLAYER_NAME, 'look', 'at',
          String(input.pos[0] + 0.5), String(input.pos[1] + lookY), String(input.pos[2] + 0.5))
        await sleep(200)
        rcon('player', PLAYER_NAME, 'use', 'once')
        await sleep(200)
      } else if (input.action === 'setblock') {
        // `/setblock` は flag 2|256 で置くので近隣更新を伴わず、そのあと
        // updateNeighboursOnBlockSet が **周囲6方向にだけ** 更新を配る。
        // 同じブロック種の上書きなら onPlace の再評価も走らないため、
        // 「本来ありえない状態」を実機に作れる (BUD 検証用。#127)
        if (!input.block) throw new Error(`setblock 入力に block がない: ${JSON.stringify(input.pos)}`)
        rcon('setblock', String(input.pos[0]), String(input.pos[1]), String(input.pos[2]),
          input.block)
        // レバー/ボタンは**支えブロックの隣**にも更新を配る必要がある (#290)。
        // capture.ts だけが直っていて**こちら側が漏れていた** (#324)。
        // 漏れたままだと「レバーを ON にしたのに何も起きない」ground truth ができ、
        // それを正解として sim を直しにいくことになる
        emitAttachedSupportUpdate(input.pos, input.block)
        await sleep(200)
      } else if (input.action === 'summon') {
        // マインカートを召喚する (#146)。detector_rail の powered=true は実機では
        // カート検出でしか作れず、setblock で置いても onPlace → checkPressed が
        // 即 false に落とすため、ground truth を採るにはこれが要る。
        // sim にエンティティは持ち込まない (13 §2 エンティティ境界原則) ので、
        // **ハーネス側だけの拡張**という線引き。
        // freeze 中は entityInside が走らないので、検出は次の tick step で起きる。
        rcon('summon', 'minecart',
          String(input.pos[0] + 0.5), String(input.pos[1]), String(input.pos[2] + 0.5))
        await sleep(200)
      } else if (input.action === 'item') {
        // コンテナの中身を差し替える (#236)。プレイヤーが GUI で動かすのと同じ
        // `Container.setItem → setChanged` を通る [確定: 26.2 ItemCommands.setBlockItem]
        // ので、**中身の変化がレッドストーンに伝わる経路**をそのまま実機で撮れる。
        // 中身は blockstate に出ないため、dump に現れるのは下流の変化だけになる
        const slot = input.slot ?? 0
        const count = input.count ?? 1
        const item = input.item ?? 'minecraft:stone'
        rcon('item', 'replace', 'block',
          String(input.pos[0]), String(input.pos[1]), String(input.pos[2]),
          `container.${slot}`, 'with', item, String(count))
        await sleep(200)
      } else if (input.action === 'kill') {
        // 対象座標の近傍のカートだけを消す (他の fixture 要素を巻き込まないため)
        rcon('kill', `@e[type=minecart,x=${input.pos[0]},y=${input.pos[1]},z=${input.pos[2]},`
          + 'distance=..2]')
        await sleep(200)
      } else if (input.action === 'step') {
        // 感圧板を踏む: fake player を板の中心へ tp して entityInside を発火させ、
        // 直後に spawn へ戻して離れる (手動 sim モデルは単発 = getPressedTime 後 auto-off の
        // ため、踏みっぱなしだと実機で再発火し続け sim と乖離する)。
        // [未検証: docker 実行は後段で親が直列実行する。freeze 境界での entityInside 発火
        //  タイミング / press が tick t に載るか t+1 に載るかは実機で要確認。ズレる場合は
        //  authored の input.tick か expect を実機生成時に調整すること]
        const [sx, sy, sz] = def.player!.spawn
        rcon('tp', PLAYER_NAME,
          String(input.pos[0] + 0.5), String(input.pos[1]), String(input.pos[2] + 0.5))
        await sleep(200)
        rcon('tp', PLAYER_NAME, String(sx), String(sy), String(sz))
        await sleep(200)
      } else {
        throw new Error(`未対応 action: ${input.action}`)
      }
    }
    scarpet(`fx_dump(${t})`)
  }

  // 6. 保存して回収。**前回の result.json を読まない**よう、保存の前に消して名前も確かめる。
  // コンテナの scripts/ はコンテナを起動したチェックアウトを bind mount しているので、
  // 別のチェックアウトから回すと書き出し先がずれ、残っていた古い結果を新しい結果として書いてしまう
  const resultPath = join(sharedDir, 'result.json')
  rmSync(resultPath, { force: true })
  scarpet(`fx_save('${name}')`)
  if (hasInputs) rcon('player', PLAYER_NAME, 'kill')
  if (!existsSync(resultPath)) {
    throw new Error(
      `${resultPath} が書き出されていない。`
      + 'コンテナの scripts/ がこのチェックアウトを mount しているか確かめること '
      + '(docker inspect redstone-sim-mc-harness の /data/world/scripts の Source)',
    )
  }
  const result = JSON.parse(readFileSync(resultPath, 'utf-8')) as McDumpResult
  if (result.name !== name) {
    throw new Error(`result.json の name が違う: ${result.name} (期待: ${name})`)
  }

  // 7. settled (tick -1) が authored と一致するか検証 (両側を canonicalize して比べる)
  const settled = result.ticks.find(x => x.tick === -1)
  if (!settled) throw new Error('tick -1 (settled) が result にない')
  const settleDiff = settleMismatches(def.blocks, settled.blocks)
  if (settleDiff.length > 0) {
    console.error('authored 状態が実機の安定状態と一致しない (fixture 定義を修正すること):')
    for (const d of settleDiff) console.error(`  ${d.pos}: authored=${d.authored} -> settled=${d.settled}`)
    throw new Error(`${name}: settle 照合失敗`)
  }

  // 8. tick 毎差分 (expect) を計算
  const expect = buildExpect(def.blocks, result.ticks, def.ticks)

  // 9. packages/sim/test/fixtures/<name>.json へ書き込み (blocks は材質を残す)
  const { player: _player, ...defRest } = def
  const fixture: Fixture = {
    ...defRest,
    blocks: fixtureBlocks(def.blocks),
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

async function main(): Promise<void> {
  const names = process.argv.slice(2)
  if (names.length === 0) {
    console.error('使い方: npx tsx tools/mc-harness/runner/generate.ts <fixture名> [...]')
    process.exit(1)
  }
  // ロックが握られていたら待たずに止まる (capture・live・MCP と同じ)
  await withHarnessLock(async () => {
    const heartbeat = setInterval(() => refreshHarnessLock(), LOCK_HEARTBEAT_MS)
    // Ctrl-C や kill では finally を通らないので、ここでロックを返してから終わる
    // (返さないと残骸とみなされるまでの 10 分間、他の実行が止まる)
    const onSignal = (sig: NodeJS.Signals): void => {
      clearInterval(heartbeat)
      releaseHarnessLock()
      console.error(`${sig} を受けたので中断した (ロックは返した)`)
      process.exit(128 + osConstants.signals[sig])
    }
    process.once('SIGINT', onSignal)
    process.once('SIGTERM', onSignal)
    try {
      ensureWorldSetup()
      reloadDumpApp()   // unload → load (load だけでは dump.sc を読み直さない)
      for (const name of names) await generateFixture(name)
    } finally {
      clearInterval(heartbeat)
      process.off('SIGINT', onSignal)
      process.off('SIGTERM', onSignal)
    }
  })
}

// テストから import しても CLI が走らないようにする。
// **pathToFileURL で比べる**。`file://${process.argv[1]}` の形だと、日本語を含むパスでは
// import.meta.url (パーセントエンコードされる) と一致せず、黙って何もしない
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(e => {
    console.error(e instanceof Error ? e.message : e)
    process.exit(1)
  })
}
