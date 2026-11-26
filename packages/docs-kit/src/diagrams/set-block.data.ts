import type { DiagramDef } from './figure.js'
import type { Dir } from './direction-order.js'

/** 図の文言 (#434): docs/vanilla/04_set-block-and-updates.md §2.1・§2.3 の手順と表の言い換え */

/** §2.1: Level#setBlock の 1 回の書き込み (10 手順) */
export const SET_BLOCK_STEPS: DiagramDef = {
  title: '1 回の書き込みで起きること (Level#setBlock)',
  source: 'V04 §2.1',
  panels: [{
    kind: 'flow',
    data: {
      steps: [
        { text: '座標が範囲の中か確かめる', out: { when: '範囲外', text: 'false で戻る' } },
        { text: 'デバッグワールドでないか確かめる', out: { when: 'デバッグワールド', text: 'false で戻る' } },
        {
          text: 'チャンクへ書く (LevelChunk#setBlockState)',
          sub: [
            '同じ状態なら何もせず「変化なし」を返す',
            '高さマップと光を更新する',
            '古い BlockEntity を外す (ブロックの種類が変わったとき)',
            '古い状態の撤去フックを呼ぶ (条件つき)',
            '新しい状態の設置フック onPlace を呼ぶ (条件つき)',
            '新しい BlockEntity を作る',
          ],
        },
        { text: 'チャンクの返事を見る', out: { when: '「変化なし」', text: 'false で戻る。ここより下は何も起きない' } },
        { text: '書いた座標を読み直す', out: { when: '頼んだ状態と違う', text: '何も通知せず true で戻る' } },
        { text: 'フラグ 2 があれば、クライアントへの通知を積む' },
        { text: 'フラグ 1 があれば NC を出す。続けて、新しい状態がアナログ出力を持てば CU を出す', hi: true },
        {
          text: 'フラグ 16 が無く、残り回数が 1 以上なら SU を出す',
          hi: true,
          sub: ['古い状態の間接形状更新', '新しい状態の 6 方向の SU', '新しい状態の間接形状更新'],
        },
        { text: 'POI を更新する' },
        { text: 'true で戻る' },
      ],
      notes: [
        '順は 撤去フック → 設置フック → NC → CU → SU。フックはチャンクの書き込み (手順 3) の中で走る。',
        'NC = 近隣更新・SU = 形状更新・CU = コンパレーター更新。',
      ],
    },
  }],
}

/** 方向の呼び名 (1 字) */
export const DIR_NAMES: Record<Dir, string> = { D: '下', U: '上', N: '北', S: '南', W: '西', E: '東' }

/** §2.3: 方向の並び 5 本。V06 §3.6 (ダストが使う並び) も同じ 5 本 */
export const DIRECTION_ORDERS: DiagramDef = {
  title: '方向の並び (用途ごとに 5 本)',
  source: 'V04 §2.3',
  panels: [{
    kind: 'dirs',
    data: {
      names: DIR_NAMES,
      orders: [
        { label: 'Direction の宣言順', order: ['D', 'U', 'N', 'S', 'W', 'E'] },
        { label: 'NC (近隣更新) の 6 方向', order: ['W', 'E', 'D', 'U', 'N', 'S'] },
        { label: 'SU (形状更新) の 6 方向', order: ['W', 'E', 'N', 'S', 'D', 'U'] },
        { label: '水平の 4 方向 (CU ほか)', order: ['N', 'E', 'S', 'W'] },
        { label: '垂直の 2 方向', order: ['U', 'D'] },
      ],
      notes: [
        '番号 = 配る順。塗った丸 = 見える面 (上・南・東)、破線の丸 = 裏の面 (西・北・下)。番号の無い面はその並びに入らない。',
        '立方体は南東の上から見た向き。東 = +x・上 = +y・南 = +z。',
      ],
    },
  }],
}
