import type { DiagramDef } from './figure.js'
import type { PhaseCell } from './phase-timeline.js'

/** 図の文言 (#434): docs/vanilla/01_tick-loop.md §2.1〜§2.4 の表と手順の言い換え。数・順・名前は md に合わせる */

/** §2.1〜§2.2: サーバ 1 周 (区間 A → B → C) と、区間 B の中の順 */
export const TICK_LOOP_CYCLE: DiagramDef = {
  title: 'サーバ 1 周 = 1 tick (区間 A → B → C)',
  source: 'V01 §2.1〜§2.2',
  panels: [{
    kind: 'phase',
    data: {
      perRow: 6,
      cells: [
        { id: 'A', label: 'パケット処理。プレイヤーの右クリック・設置・破壊が到着順に世界へ入る', w: 2 },
        { id: 'B1', label: 'データパックの関数' },
        { id: 'B2', label: 'ワールド時計' },
        { id: 'B3', label: '時刻の同期' },
        { id: 'B4', label: '全ディメンションを順に tick', w: 1.5, hi: true },
        { id: 'B5', label: '接続ごとの tick (移動と物理)' },
        { id: 'B6', label: 'プレイヤー一覧' },
        { id: 'B7', label: 'デバッグ購読' },
        { id: 'B8', label: 'ゲームテスト' },
        { id: 'B9', label: 'GUI の更新' },
        { id: 'B10', label: 'チャンクの送信' },
        { id: 'C', label: 'tick の合間。タスクキューを消化し、次の tick の時刻まで待つ。チャットと RCON のコマンドはここ', w: 2 },
      ],
      groups: [
        { from: 0, to: 0, label: '区間 A' },
        { from: 1, to: 10, label: '区間 B: サーバ tick (tickChildren の順)' },
        { from: 11, to: 11, label: '区間 C' },
      ],
      loop: 'A → B → C を繰り返す。A と C は ServerLevel#tick の外',
      legend: 'B4 の中身 = ServerLevel#tick の相 L0〜L15 (§2.3)',
    },
  }],
}

/** §2.3 の相。`hi` は「エンジンが最低限持つべき相」 */
export const LEVEL_PHASES: PhaseCell[] = [
  { id: 'L0', label: '前処理' },
  { id: 'L1', label: 'ワールドボーダー' },
  { id: 'L2', label: '天候' },
  { id: 'L3', label: '睡眠' },
  { id: 'L4', label: '空の明るさ' },
  { id: 'L5', label: 'ゲーム時刻を 1 進める', hi: true },
  { id: 'L6', label: 'ブロックの予約 tick', hi: true },
  { id: 'L7', label: '流体の予約 tick', hi: true },
  { id: 'L8', label: '襲撃' },
  { id: 'L9', label: 'チャンク (ランダム tick)', hi: true },
  { id: 'L10', label: 'ブロックイベント', hi: true },
  { id: 'L11', label: '後処理' },
  { id: 'L12', label: 'エンティティ', hi: true },
  { id: 'L13', label: 'ブロックエンティティ', hi: true },
  { id: 'L14', label: 'エンティティ管理' },
  { id: 'L15', label: 'デバッグ同期' },
]

/** §2.3: ServerLevel.tick の相の時間割 */
export const LEVEL_PHASE_TIMELINE: DiagramDef = {
  title: 'ServerLevel#tick の相の時間割 (L0〜L15)',
  source: 'V01 §2.3',
  panels: [{
    kind: 'phase',
    data: {
      perRow: 8,
      cells: LEVEL_PHASES,
      legend: 'エンジンが最低限持つべき相: L5・L6・L7・L9 のランダム tick・L10・L12・L13',
      notes: ['区間 B の B4 の中身。1 ディメンションぶん。左から右へ、上の段から下の段へ進む。'],
    },
  }],
}

/** §2.4: tick N と tick N+1 の間に起きること (7 手順) と、予約が発火する tick */
export const TICK_BOUNDARY: DiagramDef = {
  title: 'tick N と tick N+1 の間 (入力の位相)',
  source: 'V01 §2.4',
  panels: [{
    kind: 'ticks',
    data: {
      cols: [
        { label: 'B4', group: 'tick N' },
        { label: 'B5', group: 'tick N' },
        { label: '区間 C', group: 'tick N' },
        { label: '区間 A', group: 'tick N+1' },
        { label: 'B1', group: 'tick N+1' },
        { label: 'B2', group: 'tick N+1' },
        { label: 'B4', group: 'tick N+1' },
      ],
      lanes: ['', ''],
      items: [
        { k: 'ev', col: 0, lane: 0, n: 1, text: '全ディメンションの L0〜L15 が終わる' },
        { k: 'ev', col: 1, lane: 0, n: 2, text: 'プレイヤーの移動と物理。専用サーバのコンソール入力のコマンド' },
        { k: 'ev', col: 2, lane: 0, n: 3, text: 'タスクキューを消化。チャット欄と RCON のコマンド' },
        { k: 'ev', col: 3, lane: 0, n: 4, text: 'プレイヤーのパケット (右クリック・設置・破壊) を到着順に処理' },
        { k: 'ev', col: 4, lane: 0, n: 5, text: 'データパックの tick 関数' },
        { k: 'ev', col: 5, lane: 0, n: 6, text: '時計が進む' },
        { k: 'ev', col: 6, lane: 0, n: 7, hi: true, text: 'L5 で gameTime が N+1 になり、L6 以降が走る' },
        { k: 'bar', lane: 1, from: 1, to: 5, text: '2〜5 の setBlock が積む遅延 d の予約: gameTime = N のまま登録 → tick N+d の L6 で発火' },
        { k: 'bar', lane: 1, from: 6, to: 7, hi: true, text: 'L6 の中で積む遅延 d の予約 → tick N+1+d で発火' },
      ],
      notes: ['入力から生まれた予約は、tick の中で生まれた予約より 1 tick 早く見える。'],
    },
  }],
}
