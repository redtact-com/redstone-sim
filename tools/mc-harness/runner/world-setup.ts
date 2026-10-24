// ============================================================
// 実機ワールドの冪等な初期化 (#366)
//
// generate.ts (ground-truth) と live-session.ts (live / MCP) が**この 1 本**を使う (#242)。
// 以前は generate.ts が自前の同じ列を持っていて、片方だけ直すと
// 「generate では動くのに live では動かない」が起きるため、live.test.ts が
// ソースの文字列照合で 2 つを縛っていた。
// ============================================================

import { rcon } from './rcon.js'

/**
 * 実機に流す初期化コマンド列。
 *
 * mob / 天候 / ランダム tick を止め、観測範囲を forceload し、`/tick freeze` で
 * ホスト側から 1 tick ずつ進められる状態にする。
 */
export const WORLD_SETUP_COMMANDS: string[][] = [
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

export function ensureWorldSetup(): void {
  for (const c of WORLD_SETUP_COMMANDS) rcon(...c)
}
