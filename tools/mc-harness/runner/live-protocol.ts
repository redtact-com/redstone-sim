// ============================================================
// ライブ観測の通信仕様 (#366)
//
// `live.ts` (ホスト) と `app/src/LivePage.tsx` (ブラウザ) が共有する型。
// **型だけを置く**。ブラウザ側は `import type` で読むので実行時には消え、
// app のバンドルに tools/ のコードが入ることはない。
// ============================================================

/** 盤面 1 マスの状態。`'name[k=v,...]'` の正規化文字列 (air は含めない) */
export type BlockMap = Record<string, string>

/** 差分 1 件。消滅は `block: 'air'` */
export interface LiveChange {
  pos: [number, number, number]
  block: string
}

/** 実機が持っていて blockstate に出ない値 (sim の出発点をそろえるのに要る) */
export interface LiveHiddenState {
  /** 予約 tick */
  scheduled: { pos: [number, number, number]; block: string; delay: number; priority: number }[]
  /** コンパレーターの保持出力 */
  comparators: { pos: [number, number, number]; output: number }[]
  /** ホッパーの転送クールダウン */
  cooldowns: { pos: [number, number, number]; cooldown: number }[]
}

export interface LiveSessionInfo {
  /** 開いている回路の名前 (fixture 名) */
  name: string
  mcVersion: string
  carpet: string
  region: { from: [number, number, number]; to: [number, number, number] }
  /** 実機の fake player が使う照準の高さオフセット (use 入力の狙点) */
  lookY: number
}

/** ホスト → ブラウザ */
export type ServerMsg =
  /** 接続直後に 1 回。実機の落ち着いた状態そのもの */
  | {
      type: 'hello'
      session: LiveSessionInfo
      tick: number
      authored: BlockMap
      hidden: LiveHiddenState | null
    }
  /** 実機が進んだ / 変わった */
  | { type: 'frame'; tick: number; changes: LiveChange[]; cause: string }
  /** inspect の応答 */
  | { type: 'state'; pos: [number, number, number]; block: string }
  | { type: 'ack'; id: number }
  | { type: 'error'; id: number | null; message: string }

/** ブラウザ → ホスト */
export type ClientMsg =
  | { type: 'step'; id: number; n: number }
  | { type: 'use'; id: number; pos: [number, number, number] }
  | { type: 'setblock'; id: number; pos: [number, number, number]; block: string }
  | { type: 'inspect'; id: number; pos: [number, number, number] }
  /** 回路を置き直して 0 tick へ */
  | { type: 'reset'; id: number }

/**
 * 既定のポート。**127.0.0.1 にしか bind しない** (実機操作の口を外へ出さない)。
 *
 * 8787 は避ける — 開発機で別のツールが使っていて衝突した (2026-09-24)。
 * 埋まっていたら `--port` で変える。
 */
export const LIVE_PORT = 8791
