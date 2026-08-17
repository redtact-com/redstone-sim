import { describe, it, expect } from 'vitest'
import { SimWorld } from '../src/world.js'
import type { BlockState } from '../src/types.js'

/**
 * **収縮する粘着ピストンは pos+2 の伸長中 moving を強制確定する** (#231)。
 *
 * [確定: 26.2 `PistonBaseBlock.triggerEvent` (b0=1/2) の isSticky 分岐]
 * ```java
 * BlockPos twoPos = pos.offset(direction.getStepX() * 2, ...);
 * if (movingState.is(Blocks.MOVING_PISTON)
 *    && level.getBlockEntity(twoPos) instanceof PistonMovingBlockEntity entity
 *    && entity.getDirection() == direction && entity.isExtending()) {
 *    entity.finalTick();   // ← BE 相で確定させる
 *    pistonPiece = true;   // ← 引き戻しはしない
 * }
 * ```
 *
 * 確定が **BE 相**で起きるのが要点。sim は以前 head (pos+1) だけ強制確定し、
 * pos+2 の payload を phase10 (BlockEntity 相) 任せにしていた。BE の後に確定するので
 * **そのセルを押したい下流ピストンの伸長が翌 tick へずれていた**。
 *
 * 実回路での現れ方: ユーザ提供の 5×5 ドアで tick 18 の押し上げが 1 tick 遅れ、
 * そこから部分機構が非同期になっていた。2 幅ドア (#216 の既知ギャップ) もこれで解消。
 * tick 単位の回帰は実機 fixture `door-2wide-open-to-close` が守る。
 */

const at = (w: SimWorld, x: number, y: number, z: number) => w.getBlock(x, y, z)

/**
 * 東向きの粘着ピストンが石を押し出し、**押しが空中にある間に**電源を切って
 * 収縮させる。pos+2 = (3,0,0) が伸長中の moving_piston になっている状態。
 */
function buildPushingThenRetracting(): { w: SimWorld; poweredWhileMoving: boolean } {
  const w = new SimWorld()
  // レバー(0,0,0) → 粘着ピストン(1,0,0,east) → 石(2,0,0) を (3,0,0) へ押す
  w.setBlockAt([0, 0, 0], { type: 'lever', facing: 'up', powered: false } as BlockState)
  w.setBlockAt([1, 0, 0], { type: 'sticky_piston', facing: 'east', extended: false } as BlockState)
  w.setBlockAt([2, 0, 0], { type: 'solid', powered: false } as BlockState)
  w.initialize()
  w.flush(64)

  w.activateBlock(0, 0, 0)   // 伸長開始
  w.tick()
  // pos+2 が伸長中の moving になっているうちに電源を切る
  const movingAtTwo = at(w, 3, 0, 0)?.type === 'moving_piston'
  w.activateBlock(0, 0, 0)
  return { w, poweredWhileMoving: movingAtTwo }
}

describe('収縮する粘着ピストンは pos+2 の伸長中 moving を確定させる (#231)', () => {
  it('**前提**: 電源を切る時点で pos+2 は伸長中の moving である', () => {
    const { poweredWhileMoving } = buildPushingThenRetracting()
    // これが崩れると以降の検証が空振りになる
    expect(poweredWhileMoving, 'pos+2 が moving_piston になっていない').toBe(true)
  })

  it('収縮の tick 中に pos+2 が確定する (翌 tick へ持ち越さない)', () => {
    const { w } = buildPushingThenRetracting()
    w.tick()   // 収縮の BE がこの tick で走る
    const two = at(w, 3, 0, 0)
    expect(two?.type, 'pos+2 が moving のまま残っている (phase10 待ちになっている)')
      .not.toBe('moving_piston')
  })

  it('確定した先は押されていた石になる (payload が失われない)', () => {
    const { w } = buildPushingThenRetracting()
    w.tick()
    expect(at(w, 3, 0, 0)).toMatchObject({ type: 'solid' })
  })

  it('**引き戻さない** (pistonPiece 相当なので石は押した先に残る)', () => {
    const { w } = buildPushingThenRetracting()
    for (let i = 0; i < 8; i++) w.tick()
    // 引き戻していれば (2,0,0) に石が戻ってくる
    expect(at(w, 2, 0, 0)?.type, '引き戻してしまっている').not.toBe('solid')
    expect(at(w, 3, 0, 0)).toMatchObject({ type: 'solid' })
  })

  it('ピストン自身は縮んだ状態へ戻る', () => {
    const { w } = buildPushingThenRetracting()
    for (let i = 0; i < 8; i++) w.tick()
    expect(at(w, 1, 0, 0)).toMatchObject({ type: 'sticky_piston', extended: false })
  })

  it('確定は近隣更新を伴い、そのセルを押したいピストンが同じ tick で伸びられる', () => {
    const { w } = buildPushingThenRetracting()
    // (3,-1,0) から上へ押すピストンを、確定するセル (3,0,0) の真下に置いて受電させる
    w.setBlockAt([3, -1, 0], { type: 'sticky_piston', facing: 'up', extended: false } as BlockState)
    w.setBlockAt([4, -1, 0], { type: 'lever', facing: 'up', powered: false } as BlockState)
    w.activateBlock(4, -1, 0)
    w.tick()   // この tick で pos+2 が確定し、下のピストンが押せるようになる
    // 押し上げが始まっている (moving) か、既に伸びていること
    const vertical = at(w, 3, -1, 0)
    expect(
      vertical?.type === 'sticky_piston' && vertical.extended,
      '確定セルを押すピストンが同じ tick で伸びていない',
    ).toBe(true)
  })
})
