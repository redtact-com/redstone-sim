import { describe, it, expect } from 'vitest'
import { mcToSim, simToMc, canonicalize } from '../src/mcstate.js'
import { appearanceProps } from '../src/blocks/blockNames.js'

/**
 * **見た目にだけ効くプロパティ**が往復で失われないこと (#351)。
 *
 * 名前 (#343) だけ戻しても、横倒しの原木は縦置きに、天井付けのトラップドアは
 * 床付けに見える。挙動には効かないので sim の状態には出さず、`renderProps` に載せる。
 */
describe('見た目プロパティの保持 (#351)', () => {
  it('横倒しの原木は axis を保つ', () => {
    const b = mcToSim('oak_log[axis=x]')
    expect(b).toMatchObject({ type: 'solid', name: 'oak_log', renderProps: { axis: 'x' } })
  })

  it('釉薬テラコッタは facing を保つ', () => {
    const b = mcToSim('white_glazed_terracotta[facing=east]')
    expect(b).toMatchObject({ name: 'white_glazed_terracotta', renderProps: { facing: 'east' } })
  })

  it('天井付けのトラップドアは half を保つ', () => {
    const b = mcToSim('spruce_trapdoor[facing=north,half=top,open=false,powered=false,waterlogged=false]')
    expect(b).toMatchObject({
      type: 'trapdoor_wood', name: 'spruce_trapdoor', renderProps: { half: 'top' },
    })
  })

  it('塀に埋めたゲートは in_wall を保つ', () => {
    const b = mcToSim('oak_fence_gate[facing=north,in_wall=true,open=false,powered=false]')
    expect(b).toMatchObject({ type: 'fence_gate', renderProps: { in_wall: 'true' } })
  })

  it('**動的な値は拾わない** (sim が状態として持っているため)', () => {
    // powered / open / lit を固定してしまうと、シミュレーション中に見た目が更新されなくなる
    expect(appearanceProps('trapdoor_wood', { half: 'top', open: 'true', powered: 'true' }))
      .toEqual({ half: 'top' })
    expect(appearanceProps('solid', { axis: 'z', powered: 'true' })).toEqual({ axis: 'z' })
  })

  it('何も無ければ undefined (往復比較のノイズにしない)', () => {
    expect(appearanceProps('solid', {})).toBeUndefined()
    expect(mcToSim('stone')).not.toHaveProperty('renderProps.axis')
  })

  it('書き出しで戻る (合成パス)', () => {
    const b = mcToSim('oak_log[axis=x]')!
    expect(simToMc(b)).toBe('oak_log[axis=x]')
  })

  it('**実機比較には効かない** (canonicalize が代表名へ潰す)', () => {
    expect(canonicalize('oak_log[axis=x]')).toBe(canonicalize('stone'))
  })

  it('**二重スラブは往復しても導体のまま** (type=double を落とすと非導体に化ける)', () => {
    const b = mcToSim('oak_slab[type=double,waterlogged=false]')!
    expect(b).toMatchObject({ type: 'solid', name: 'oak_slab', renderProps: { type: 'double' } })
    // 書き出し → 読み直しで型が変わらないこと (変わると導通が消える)
    const back = mcToSim(simToMc(b))!
    expect(back.type, '往復で単体スラブ (非導体) に化けた').toBe('solid')
  })

  it('**スラブの上下は sim 側が正** (authored の値を残さない)', () => {
    // ピストンで上付きスラブが下付きスラブのあった座標へ動くと、
    // authored を信じたままだと下付きとして書き出される
    const top = mcToSim('oak_slab[type=top,waterlogged=false]')!
    expect(simToMc(top, 'smooth_stone_slab[type=bottom,waterlogged=false]'))
      .toBe('oak_slab[type=top,waterlogged=false]')
  })
})
