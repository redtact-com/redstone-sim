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
})
