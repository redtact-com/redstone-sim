import { describe, it, expect } from 'vitest'
import { simToMc } from '../src/mcstate.js'

// #257 ピストンで**移動してきた**ブロックの書き出し。
//
// simToMc は authored (その座標に元々あった blockstate) をベースに、
// sim が管理する動的プロパティだけを上書きする。
// **向きは「動的」の側に入れ忘れていた**ので、別の向きの同種ブロックがあった座標へ
// 移動してくると、sim の世界は正しいのに**書き出しだけが古い向き**になっていた。
//
// エレベーターの搬器は上向きと下向きのピストンが背中合わせで昇降するため、
// 座標だけ見ると「同じ型で向きだけ違う」状態が頻繁に起きる
// (実機 elev-ride の tick 27 でこれを踏み、sim のバグに見えていた)。

describe('移動してきたブロックの書き出しは sim の向きを使う (#257)', () => {
  it('ピストン: authored と向きが違っても sim の向きで書く', () => {
    expect(simToMc(
      { type: 'sticky_piston', facing: 'down', extended: false },
      'sticky_piston[extended=true,facing=up]',
    )).toBe('sticky_piston[extended=false,facing=down]')
  })

  it('ピストンヘッド: 向きと粘着も sim 側から書く', () => {
    expect(simToMc(
      { type: 'piston_head', facing: 'down', sticky: true },
      'piston_head[facing=up,short=false,type=normal]',
    )).toBe('piston_head[facing=down,short=false,type=sticky]')
  })

  it('オブザーバー: 向きも sim 側から書く', () => {
    expect(simToMc(
      { type: 'observer', facing: 'south', powered: true },
      'observer[facing=north,powered=false]',
    )).toBe('observer[facing=south,powered=true]')
  })

  it('向きが同じなら従来どおり (上の 3 件が空振りでない証拠)', () => {
    expect(simToMc(
      { type: 'sticky_piston', facing: 'up', extended: true },
      'sticky_piston[extended=false,facing=up]',
    )).toBe('sticky_piston[extended=true,facing=up]')
  })
})
