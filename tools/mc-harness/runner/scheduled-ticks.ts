// ============================================================
// scheduled-ticks.ts — 実機の「ブロック状態に出ない値」を保存データから読む
//
// 扱うのは 2 つ。どちらも Anvil のチャンク NBT にしか無い:
//   1. 予約 tick (`block_ticks`) … 「あと 5gt で ON」(#240)
//   2. コンパレーターの出力強度 (`block_entities` の OutputSignal) … (#249)
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

/** 範囲に掛かるチャンクを順に読んで fn に渡す (未生成・未保存のチャンクは飛ばす) */
function forEachChunk(
  worldDir: string,
  from: [number, number, number],
  to: [number, number, number],
  fn: (chunk: NbtCompound) => void,
): void {
  const cx0 = Math.floor(from[0] / 16), cx1 = Math.floor(to[0] / 16)
  const cz0 = Math.floor(from[2] / 16), cz1 = Math.floor(to[2] / 16)
  for (let cx = cx0; cx <= cx1; cx++) {
    for (let cz = cz0; cz <= cz1; cz++) {
      const path = `${worldDir}/region/r.${Math.floor(cx / 32)}.${Math.floor(cz / 32)}.mca`
      if (!existsSync(path)) continue
      const chunk = readChunk(readFileSync(path), cx, cz)
      if (chunk !== null) fn(chunk)
    }
  }
}

/** 範囲内か (from/to は両端を含む) */
function inRange(
  x: number, y: number, z: number,
  from: [number, number, number], to: [number, number, number],
): boolean {
  return x >= from[0] && x <= to[0] && y >= from[1] && y <= to[1] && z >= from[2] && z <= to[2]
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
  forEachChunk(worldDir, from, to, chunk => {
    const list = chunk.get('block_ticks')
    if (!(list instanceof NbtList)) return
    for (let n = 0; n < list.length; n++) {
      const e = list.get(n)
      if (!(e instanceof NbtCompound)) continue
      const x = e.getNumber('x'), y = e.getNumber('y'), z = e.getNumber('z')
      if (!inRange(x, y, z, from, to)) continue
      out.push({
        pos: [x, y, z],
        block: e.getString('i'),
        delay: e.getNumber('t'),
        priority: e.getNumber('p'),
      })
    }
  })
  out.sort((a, b) => a.delay - b.delay || a.priority - b.priority
    || a.pos[0] - b.pos[0] || a.pos[1] - b.pos[1] || a.pos[2] - b.pos[2])
  return out
}

// ------------------------------------------------------------
// コンパレーターの出力強度 (#249)
//
// **compare/subtract の出力値は BlockEntity にあって blockstate には出ない**
// (blockstate は powered = 0 か否かだけ)。実機のスナップショットを読んでも
// 強度が分からないので、sim 側は「今の入力から計算し直す」で埋めていた。
//
// これは**止まっている回路でしか正しくない**。信号が周回しながら 1 ずつ減っていく
// ような機械では、コンパレーターは「まだ書き換わっていない古い値」を保持していて、
// 予約 tick が発火した瞬間に新しい値へ落ちる。計算し直すと最初から新しい値になり、
// 発火しても何も変わらないので**機械が止まる**
// (実機 fixture elev-dust-decay-min: 実機は 15→14→13 と減衰、sim は 15 のまま不動)。
//
// 保存データの block_entities には次の形で入っている:
//
//   {"id": "minecraft:comparator", "x": 2, "y": 2, "z": 2, "OutputSignal": 14}
// ------------------------------------------------------------

export interface ComparatorOutputEntry {
  pos: [number, number, number]
  /** BlockEntity が保持している出力強度 (0-15) */
  output: number
}

/**
 * 指定範囲のコンパレーターが保持している出力強度を集める。
 *
 * `readScheduledTicks` と同じく、呼ぶ前に `/save-all flush` が要る。
 */
export function readComparatorOutputs(
  worldDir: string,
  from: [number, number, number],
  to: [number, number, number],
): ComparatorOutputEntry[] {
  const out: ComparatorOutputEntry[] = []
  forEachChunk(worldDir, from, to, chunk => {
    const list = chunk.get('block_entities')
    if (!(list instanceof NbtList)) return
    for (let n = 0; n < list.length; n++) {
      const e = list.get(n)
      if (!(e instanceof NbtCompound)) continue
      if (e.getString('id') !== 'minecraft:comparator') continue
      const x = e.getNumber('x'), y = e.getNumber('y'), z = e.getNumber('z')
      if (!inRange(x, y, z, from, to)) continue
      out.push({ pos: [x, y, z], output: e.getNumber('OutputSignal') })
    }
  })
  out.sort((a, b) => a.pos[0] - b.pos[0] || a.pos[1] - b.pos[1] || a.pos[2] - b.pos[2])
  return out
}
