import type { DiagramDef } from './figure.js'

/** 図の文言 (#434): docs/vanilla/07_diodes.md §2.4 の手順の言い換え (記号 P・F は §2.1) */

/** §2.4: リピーターが OFF → ON になる tick に起きることの順 */
export const REPEATER_FLIP: DiagramDef = {
  title: 'リピーターの 1 回の反転 (OFF → ON) で起きることの順',
  source: 'V07 §2.4',
  panels: [{
    kind: 'flow',
    data: {
      steps: [
        { text: 'ServerLevel#tickBlock が、その位置のブロックが予約した種類と同じか確かめ、同じなら tick を呼ぶ' },
        { text: 'DiodeBlock#tick が isLocked を読む', out: { when: 'ロック中', text: '終わり' } },
        { text: 'shouldTurnOn (入力の有無) を読む' },
        {
          text: 'POWERED を true にして flag 2 で書く。この書き込みの中で次が順に起きる',
          hi: true,
          sub: [
            '状態を差し替える (ブロックの種類は同じなので撤去処理は呼ばれない)',
            '新しい状態の onPlace → updateNeighborsInFront。F へ近隣更新を 1 件 (連鎖が全部終わるまで走り切る)。次に F の近傍へ 西・東・下・上・北・南 の順で、P の向きを飛ばして 5 件',
            'flag 1 が無いので、自分の周りへの近隣更新とコンパレーター更新は出ない',
            'flag 16 が無いので形状更新を出す。P の 6 近傍へ 西・東・北・南・下・上 の順。隣のリピーターの LOCKED はここで変わる',
          ],
        },
        { text: '手順 3 で入力が無かった場合だけ、遅延後・優先度 -2 の予約を積む (最短パルスの保証)。手順 4 の連鎖の後に来る' },
      ],
      notes: ['P = リピーターの位置・F = 出力を受ける前のマス (P から FACING の逆へ 1 マス)。呼び出しは予約 tick 相の最上位なので、近隣更新のスタックは空。'],
    },
  }],
}
