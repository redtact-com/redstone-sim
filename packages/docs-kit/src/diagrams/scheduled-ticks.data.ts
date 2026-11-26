import type { DiagramDef } from './figure.js'

/** 図の文言 (#434): docs/vanilla/02_scheduled-ticks.md §2.2 の手順 (捨てる条件は §2.1) の言い換え */

/** §2.2: 予約から発火まで (7 手順) */
export const SCHEDULE_TO_FIRE: DiagramDef = {
  title: '予約から発火までの流れ',
  source: 'V02 §2.2',
  panels: [{
    kind: 'flow',
    data: {
      steps: [
        { text: 'ブロックのコードが scheduleTick を呼ぶ (位置・種類・遅延・省略できる優先度)' },
        {
          text: 'LevelAccessor#createTick が予約 1 件を作る',
          sub: ['発火 tick = 今のゲーム時刻 + 遅延', '優先度は省略時 NORMAL (0)', '予約順 = 呼ぶたびに 1 増える通し番号'],
        },
        {
          text: 'LevelTicks#schedule が位置からチャンクを求め、そのチャンクの入れ物へ渡す',
          out: { when: '入れ物が未登録', text: '捨てる' },
        },
        {
          text: 'LevelChunkTicks#schedule が (位置, 種類) の集合へ追加を試み、無ければキューへ入れる',
          out: { when: '既にある', text: '捨てる (先勝ち)' },
        },
        { text: '入れた予約がそのチャンクのキューの先頭になったら、「このチャンクの次の発火 tick」の表を更新する' },
        { text: '以後の tick の予約 tick 相で LevelTicks#tick が走る。発火 tick が今の時刻以下の予約を集めて実行する', hi: true },
        {
          text: '実行は ServerLevel#tickBlock (流体は tickFluid)。位置のブロックが予約の種類と同じなら、ブロックの tick を呼ぶ',
          out: { when: '種類が違う', text: '何もしない' },
        },
      ],
    },
  }],
}
