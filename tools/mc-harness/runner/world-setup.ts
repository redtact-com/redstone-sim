// ============================================================
// 実機ワールドの冪等な初期化 (#366)
//
// `generate.ts` は**自前の同じ列**を持っている (そちらは独自の rcon 実装を
// 使っているため、この PR では触らない)。2 つに分かれたまま片方だけ直すと
// 「generate では動くのに live では動かない」が起きるので、
// **列が一致していることを `live.test.ts` が検査する**。
// 将来 generate.ts をこちらへ寄せるのは別 issue。
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
