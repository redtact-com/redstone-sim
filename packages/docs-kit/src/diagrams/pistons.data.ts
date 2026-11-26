import type { DiagramDef } from './figure.js'
import type { TickCol } from './tick-axis.js'

/** 図の文言 (#434): docs/vanilla/13_pistons.md §2.2〜§2.4 の表の言い換え (記号 P・A・B・T は冒頭の定義) */

const COLS: TickCol[] = [
  { label: '任意' },
  { label: 'T' },
  { label: 'T+1' },
  { label: 'T+2' },
]

/** §2.2〜§2.4: ピストンの伸長と収縮の時系列と、セルの移り変わり */
export const PISTON_TIMELINE: DiagramDef = {
  title: 'ピストンの時系列 (伸長と収縮)',
  source: 'V13 §2.2〜§2.4',
  panels: [
    {
      kind: 'ticks',
      title: '伸長',
      data: {
        cols: COLS,
        lanes: ['近隣更新を受けた時点', 'ブロックイベント相', 'BlockEntity 相', 'セル P', 'セル A', '押し先'],
        items: [
          { k: 'ev', col: 0, lane: 0, text: '信号あり・未伸長・押し構造が解決できる → 種別 0 のブロックイベントを積む' },
          { k: 'ev', col: 1, lane: 1, hi: true, text: '信号を見直す → A と押し先を moving_piston にする → 本体を extended=true にする' },
          { k: 'arrow', from: [0, 0], to: [1, 1], text: '種別 0' },
          { k: 'ev', col: 1, lane: 2, text: 'progress 0 → 0.5 (作られた tick にも進む)' },
          { k: 'ev', col: 2, lane: 2, text: 'progress 0.5 → 1.0' },
          { k: 'ev', col: 3, lane: 2, hi: true, text: '着地。近隣更新と形状更新が出る' },
          { k: 'bar', lane: 3, from: 1, to: 4, text: 'piston extended=true (着地後も同じ)' },
          { k: 'bar', lane: 4, from: 1, to: 3.25, text: 'moving_piston (中身 = piston_head)' },
          { k: 'bar', lane: 4, from: 3.25, to: 4, text: 'piston_head' },
          { k: 'bar', lane: 5, from: 1, to: 3.25, text: 'moving_piston (中身 = 元のブロック)' },
          { k: 'bar', lane: 5, from: 3.25, to: 4, text: '元のブロック' },
        ],
      },
    },
    {
      kind: 'ticks',
      title: '収縮',
      data: {
        cols: COLS,
        lanes: ['近隣更新を受けた時点', 'ブロックイベント相', 'BlockEntity 相', 'セル P', 'セル A'],
        items: [
          { k: 'ev', col: 0, lane: 0, text: '信号なし・伸長済み → 種別 1 または 2 を積む (押し構造は調べない)' },
          { k: 'ev', col: 1, lane: 1, hi: true, text: '信号が戻っていれば取り消し。そうでなければ本体を moving_piston にし、ヘッドを消す。粘着なら B を引く' },
          { k: 'arrow', from: [0, 0], to: [1, 1], text: '種別 1・2' },
          { k: 'ev', col: 1, lane: 2, text: 'progress が 0.5 進む' },
          { k: 'ev', col: 2, lane: 2, text: 'progress が 0.5 進む' },
          { k: 'ev', col: 3, lane: 2, hi: true, text: '本体が piston (extended=false) に戻る。引いたブロックが A に着地する' },
          { k: 'bar', lane: 3, from: 1, to: 3.25, text: 'moving_piston (中身 = piston extended=false)。この間、本体は近隣更新を受けない' },
          { k: 'bar', lane: 3, from: 3.25, to: 4, text: 'piston extended=false' },
          { k: 'bar', lane: 4, from: 1, to: 3.25, text: '空気、または moving_piston (引いたブロック)' },
          { k: 'bar', lane: 4, from: 3.25, to: 4, text: '空気、または引いたブロック' },
        ],
        notes: [
          'P = ピストン本体・A = 腕のセル (ヘッドが入る)・B = ヘッドの 1 つ先・T = ブロックイベントが実行された tick。',
          '積んだ相がブロックイベント相より前なら同じ tick に、後 (エンティティ相・BlockEntity 相・プレイヤー入力) なら次の tick に実行される。',
        ],
      },
    },
  ],
}
