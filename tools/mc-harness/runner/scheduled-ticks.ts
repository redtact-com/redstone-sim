// ============================================================
// scheduled-ticks.ts — 実機の「予約 tick」を保存データから読む (#240)
//
// **ブロック状態だけでは動いている機械を再現できない**。リピーターの「あと 5gt で ON」
// のような予約はブロック状態に出ないため、実機のスナップショットを sim に読ませても
// 出発点が揃わない (エレベーターで tick 0 から 62 座標ズレた)。
//
// 予約はワールドの保存データ (Anvil のチャンク NBT `block_ticks`) に残る:
//
//   {"i": "minecraft:repeater", "x": 21, "y": 2, "z": 20, "t": 5, "p": -1}
//
// [確定: 26.2 SavedTick.java:13,37-40,52]
//   `record SavedTick<T>(T type, BlockPos pos, int delay, TickPriority priority)`
//   codec は i=type / t=delay / p=priority、`unpack` は `currentTick + this.delay` を
//   発火 tick にする。つまり **t は残り遅延**、p は優先度そのもの。
//
// scarpet には予約を読む API が無い (`block_tick` は**発火させる**関数)。
// carpet の /log にもレッドストーン系は無い。保存データを読むのが唯一の手段。
// ============================================================

import { readFileSync, existsSync } from 'node:fs'
import { inflateSync, gunzipSync } from 'node:zlib'
import { NbtFile, NbtCompound, NbtList } from 'deepslate'

export interface ScheduledTickEntry {
  pos: [number, number, number]
  /** ブロック ID (名前空間つき) */
  block: string
  /** 残り遅延 (gt)。0 は「次の tick で発火」 */
  delay: number
  /** 優先度。小さいほど先に実行される (vanilla の TickPriority) */
  priority: number
}

/** Anvil のチャンクを 1 個取り出して NBT にする。未生成なら null */
function readChunk(mca: Buffer, cx: number, cz: number): NbtCompound | null {
  const i = 4 * ((cx & 31) + (cz & 31) * 32)
  if (i + 4 > mca.length) return null
  const off = (mca[i] << 16) | (mca[i + 1] << 8) | mca[i + 2]
  if (off === 0) return null
  const start = off * 4096
  const len = mca.readInt32BE(start)
  const comp = mca[start + 4]
  const payload = mca.subarray(start + 5, start + 4 + len)
  // 1=gzip / 2=zlib (既定) / 3=無圧縮
  const raw = comp === 1 ? gunzipSync(payload) : comp === 2 ? inflateSync(payload) : payload
  return NbtFile.read(new Uint8Array(raw)).root
}

/**
 * 指定範囲に予約されている block tick を集める。
 *
 * 呼ぶ前に `/save-all flush` を実行しておくこと (保存されていない分は出ない)。
 */
export function readScheduledTicks(
  worldDir: string,
  from: [number, number, number],
  to: [number, number, number],
): ScheduledTickEntry[] {
  const out: ScheduledTickEntry[] = []
  const cx0 = Math.floor(from[0] / 16), cx1 = Math.floor(to[0] / 16)
  const cz0 = Math.floor(from[2] / 16), cz1 = Math.floor(to[2] / 16)
  const seen = new Set<string>()
  for (let cx = cx0; cx <= cx1; cx++) {
    for (let cz = cz0; cz <= cz1; cz++) {
      const rx = Math.floor(cx / 32), rz = Math.floor(cz / 32)
      const path = `${worldDir}/region/r.${rx}.${rz}.mca`
      if (seen.has(path) === false && !existsSync(path)) continue
      seen.add(path)
      const mca = readFileSync(path)
      const chunk = readChunk(mca, cx, cz)
      if (chunk === null) continue
      const list = chunk.get('block_ticks')
      if (!(list instanceof NbtList)) continue
      for (let n = 0; n < list.length; n++) {
        const e = list.get(n)
        if (!(e instanceof NbtCompound)) continue
        const x = e.getNumber('x'), y = e.getNumber('y'), z = e.getNumber('z')
        if (x < from[0] || x > to[0] || y < from[1] || y > to[1] || z < from[2] || z > to[2]) continue
        out.push({
          pos: [x, y, z],
          block: e.getString('i'),
          delay: e.getNumber('t'),
          priority: e.getNumber('p'),
        })
      }
    }
  }
  out.sort((a, b) => a.delay - b.delay || a.priority - b.priority
    || a.pos[0] - b.pos[0] || a.pos[1] - b.pos[1] || a.pos[2] - b.pos[2])
  return out
}
