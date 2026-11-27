// ============================================================
// オラクルのデータパックと実行の計画を作業フォルダに作る (docs/research/18 §4.1 の 3)。
//
// 使い方: npx tsx tools/gt-oracle/gen-datapack.ts --run <作業フォルダ> [--version 26.3] <fixture名> [...]
//
// 作る物 (どれも自分で書いた中身。<作業フォルダ> は tools/gt-oracle/work/ の下):
//   packs/gt_oracle/pack.mcmeta                          … データパックの版は jar の version.json の pack_version
//   packs/gt_oracle/data/gt_oracle/test_environment/frozen.json … 時刻・天気・湧き・ランダム tick・延焼を止める
//   packs/gt_oracle/data/gt_oracle/test_instance/drive.json     … Java の test_function (gt_oracle:drive) を 1 本だけ呼ぶ
//   plan.json                                            … 撮る定義の一覧と tick の予算。Driver.java が読む
//
// 定義の探し方: tools/gt-oracle/definitions/<名前>.json → tools/mc-harness/fixtures/<名前>.json の順。
// 形は今のハーネスの定義と同じ (R18 §7.1)。player は読まない (視線の計算が無いので要らない)。
//
// O1 で写していない物は、起動する前にここで止める (撮れたことにしない):
//   - action の step・container・tp・lectern、書見台の本 (lectern)
//   - レバー・ボタンを置く setblock (今のハーネスは支えブロックの隣にも更新を足している #290。写し方は O2 で決める)
//   - trustAuthored と見えない状態 (scheduled・comparators・cooldowns) の注入 (O4)
// ============================================================

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { attachedSupportPos } from '../mc-harness/runner/capture.js'
import type { Fixture } from '../../packages/sim/test/fixture-runner.js'
import { gtDir, jarDir } from './fetch-jar.js'

export const NAMESPACE = 'gt_oracle'
export const FUNCTION = 'drive'
export const ENVIRONMENT = 'frozen'
const repoRoot = join(gtDir, '..', '..')
export const definitionsDir = join(gtDir, 'definitions')
export const harnessDefinitionsDir = join(repoRoot, 'tools', 'mc-harness', 'fixtures')

/**
 * Driver が毎 tick の呼び出しを続ける tick の上限。GameTestServer は tick を全速で回し、
 * チャンクの生成を待つ間も tick が進むので、tick の数は上限にならない。止める役は時間の上限 (wallLimitMs) が担い、
 * こちらは test_instance の max_ticks (時間切れ) を先に踏まないための大きな値にする
 */
const BUDGET_TICKS = 100_000_000
/** 全体の時間の上限。1 本あたり 60 秒 + 起動直後の余裕 */
const WALL_MS_PER_FIXTURE = 60_000
const WALL_MS_SLACK = 120_000

/** 撮る定義。今のハーネスの定義と同じ形 (expect が無い Fixture) */
export type Definition = Omit<Fixture, 'expect'> & { player?: unknown }

export interface ResolvedDefinition {
  def: Definition
  /** リポジトリからの相対パス */
  source: string
}

export function resolveDefinition(name: string): ResolvedDefinition {
  for (const dir of [definitionsDir, harnessDefinitionsDir]) {
    const path = join(dir, `${name}.json`)
    if (existsSync(path)) {
      const def = JSON.parse(readFileSync(path, 'utf-8')) as Definition
      if (def.name !== name) throw new Error(`${path}: name が ${def.name} でファイル名と違う`)
      return { def, source: path.slice(repoRoot.length + 1) }
    }
  }
  throw new Error(`定義が無い: ${name} (tools/gt-oracle/definitions/ と tools/mc-harness/fixtures/ を見た)`)
}

const SUPPORTED_ACTIONS = new Set(['use', 'setblock', 'summon', 'kill', 'item'])

/** O1 で撮れない所を並べる。空なら撮れる */
export function unsupported(def: Definition): string[] {
  const out: string[] = []
  for (const input of def.inputs) {
    if (!SUPPORTED_ACTIONS.has(input.action)) {
      out.push(`tick ${input.tick} の action ${input.action} はまだ写していない (O2)`)
    } else if (input.action === 'setblock' && input.block && attachedSupportPos(input.pos, input.block)) {
      out.push(`tick ${input.tick} の setblock ${input.block} は支えブロックの更新の写し方が決まっていない (O2)`)
    }
  }
  if (def.blocks.some(b => b.lectern !== undefined)) out.push('書見台の本 (lectern) はまだ写していない (O2)')
  if (def.trustAuthored) out.push('trustAuthored と見えない状態の注入はまだ写していない (O4)')
  if (def.scheduled?.length || def.comparators?.length || def.cooldowns?.length) {
    out.push('scheduled・comparators・cooldowns の注入はまだ写していない (O4)')
  }
  return out
}

/** 計画に載せる 1 本。定義から player を除き、どこから読んだか (source) を足したもの */
export type PlanFixture = Omit<Definition, 'player'> & { source: string }

export interface Plan {
  mc: string
  /** Driver が毎 tick の呼び出しを続ける上限。これを使い切ったら失敗 */
  budgetTicks: number
  /** Driver の時間の上限 (ms)。超えたら失敗 */
  wallLimitMs: number
  /** test_instance の max_ticks。budgetTicks より大きくする (時間切れより先に Driver が止まるように) */
  maxTicks: number
  fixtures: PlanFixture[]
}

export function buildPlan(mc: string, defs: readonly ResolvedDefinition[]): Plan {
  const fixtures: PlanFixture[] = defs.map(({ def, source }) => {
    const { player: _player, ...rest } = def
    return { ...rest, source }
  })
  return {
    mc,
    budgetTicks: BUDGET_TICKS,
    wallLimitMs: WALL_MS_SLACK + WALL_MS_PER_FIXTURE * fixtures.length,
    maxTicks: BUDGET_TICKS + 20,
    fixtures,
  }
}

/** 時刻・天気・湧き・ランダム tick・延焼を止める (R18 §4.1 の 3。今のハーネスの world-setup.ts のゲームルールに当たる) */
export const FROZEN_RULES: Record<string, boolean | number> = {
  'minecraft:advance_time': false,
  'minecraft:advance_weather': false,
  'minecraft:spawn_mobs': false,
  'minecraft:spawn_monsters': false,
  'minecraft:random_tick_speed': 0,
  'minecraft:fire_spread_radius_around_player': 0,
}

/** データパックの中身。キーはパックのフォルダからの相対パス */
export function buildDatapack(packFormat: number, maxTicks: number): Record<string, unknown> {
  return {
    'pack.mcmeta': {
      pack: {
        description: 'redstone-sim gt-oracle (docs/research/18)',
        min_format: packFormat,
        max_format: packFormat,
      },
    },
    [`data/${NAMESPACE}/test_environment/${ENVIRONMENT}.json`]: {
      type: 'minecraft:game_rules',
      rules: FROZEN_RULES,
    },
    [`data/${NAMESPACE}/test_instance/${FUNCTION}.json`]: {
      type: 'minecraft:function',
      function: `${NAMESPACE}:${FUNCTION}`,
      environment: `${NAMESPACE}:${ENVIRONMENT}`,
      // 回路はテストの構造物に置かない (R18 §4.5)。構造物は空のもので足りる
      structure: 'minecraft:empty',
      max_ticks: maxTicks,
      setup_ticks: 0,
      required: true,
    },
  }
}

/** jar の version.json から、データパックの版を読む */
export function packFormatOf(versionJson: { pack_version: { data_major: number } }): number {
  return versionJson.pack_version.data_major
}

export function writeRun(runDir: string, version: string, names: readonly string[]): Plan {
  const defs = names.map(resolveDefinition)
  const problems = defs.flatMap(({ def }) => unsupported(def).map(p => `${def.name}: ${p}`))
  if (problems.length > 0) throw new Error(`O1 で撮れない定義がある:\n  ${problems.join('\n  ')}`)

  const vjsonPath = join(jarDir(version), 'version.json')
  if (!existsSync(vjsonPath)) throw new Error(`${vjsonPath} が無い。先に fetch-jar.ts を回す`)
  const packFormat = packFormatOf(JSON.parse(readFileSync(vjsonPath, 'utf-8')))
  const plan = buildPlan(version, defs)

  const packDir = join(runDir, 'packs', NAMESPACE)
  rmSync(packDir, { recursive: true, force: true })
  for (const [rel, body] of Object.entries(buildDatapack(packFormat, plan.maxTicks))) {
    const path = join(packDir, rel)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify(body, null, 2) + '\n')
  }
  writeFileSync(join(runDir, 'plan.json'), JSON.stringify(plan, null, 2) + '\n')
  return plan
}

function main(): void {
  const args = process.argv.slice(2)
  let runDir: string | undefined
  let version = '26.3'
  const names: string[] = []
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--run') runDir = args[++i]
    else if (args[i] === '--version') version = args[++i]
    else names.push(args[i])
  }
  if (!runDir || names.length === 0) {
    console.error('使い方: npx tsx tools/gt-oracle/gen-datapack.ts --run <作業フォルダ> [--version 26.3] <fixture名> [...]')
    process.exit(1)
  }
  mkdirSync(runDir, { recursive: true })
  const plan = writeRun(runDir, version, names)
  console.log(`==> データパックと計画を書いた: ${plan.fixtures.length} 本 (時間の上限 ${plan.wallLimitMs / 1000} 秒)`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main()
  } catch (e) {
    console.error(e instanceof Error ? e.message : e)
    process.exit(1)
  }
}
