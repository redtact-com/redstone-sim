import { describe, it, expect } from 'vitest'
import { SimWorld } from '../src/world.js'
import type { BlockState } from '../src/types.js'

/**
 * **収縮する粘着ピストンは pos+2 の伸長中 moving を強制確定する** (#231)。
 *
 * [確定: 26.2 PistonBaseBlock.triggerEvent (b0=1/2) の isSticky 分岐 —
 * facing 方向へ 2 マス進んだ位置 (pos+2) を見て、そこが moving_piston であり、
 * その BlockEntity の向きが自分の facing と同じで、かつ**伸長中**であれば、
 * その BlockEntity を **BE 相でその場で確定 (finalTick)** させたうえで
 * 「ピストン片あり」と扱い、引き戻しは行わない]
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

/**
 * **収縮イベントの実行時再判定** (#231)。
 *
 * [確定: 26.2 PistonBaseBlock.triggerEvent —
 *  伸長イベント (b0=1/2) の実行時にまだ受電していれば、extended=true の状態を
 *  flag 2 で書き直して false を返し、イベント自体を取り消す]
 *
 * 収縮の予約は「受電が切れた」瞬間の NC で積まれるが、同じ tick の ST 相で
 * オブザーバー等が再点火すると BE 相の時点では受電が戻っている。そのとき
 * vanilla は**収縮を取り消して伸びたままにする**。
 */
describe('収縮イベントは実行時に受電していたら取り消す (#231)', () => {
  /**
   * 収縮を**予約させてから**、実行される前に別の面から受電を戻す。
   * 予約は「受電が切れた」NC で積まれ、実行は次の tick の BE 相なので、
   * その間に電源を戻せば vanilla は収縮を取り消す。
   */
  function buildQueuedRetractThenRepower(): SimWorld {
    const w = new SimWorld()
    w.setBlockAt([1, 0, 0], { type: 'sticky_piston', facing: 'east', extended: false } as BlockState)
    w.initialize()
    w.flush(64)
    // 上から受電させて伸ばす (setBlockCommand = /setblock 相当で近隣更新が飛ぶ)
    w.setBlockCommand([1, 1, 0], { type: 'redstone_block' } as BlockState)
    for (let i = 0; i < 4; i++) w.tick()
    expect(w.getBlock(1, 0, 0), '前提: 伸びている').toMatchObject({ extended: true })

    // 電源を外す → この NC で収縮が予約される (実行は次 tick の BE 相)
    w.setBlockCommand([1, 1, 0], { type: 'air' })
    // 実行前に別の面から受電を戻す
    w.setBlockCommand([1, -1, 0], { type: 'redstone_block' } as BlockState)
    return w
  }

  it('**前提**: 電源を戻した時点でピストンはまだ伸びている', () => {
    const w = buildQueuedRetractThenRepower()
    expect(w.getBlock(1, 0, 0)).toMatchObject({ extended: true })
  })

  it('予約済みの収縮が走っても、受電が戻っていれば縮まない', () => {
    const w = buildQueuedRetractThenRepower()
    for (let i = 0; i < 6; i++) w.tick()
    expect(w.getBlock(1, 0, 0), '受電が戻っているのに縮んだ').toMatchObject({ extended: true })
  })

  it('本当に電源が切れれば縮む (取り消しが効きすぎていない)', () => {
    const w = new SimWorld()
    w.setBlockAt([1, 0, 0], { type: 'sticky_piston', facing: 'east', extended: false } as BlockState)
    w.initialize()
    w.flush(64)
    w.setBlockCommand([1, 1, 0], { type: 'redstone_block' } as BlockState)
    for (let i = 0; i < 4; i++) w.tick()
    expect(w.getBlock(1, 0, 0)).toMatchObject({ extended: true })

    w.setBlockCommand([1, 1, 0], { type: 'air' })
    for (let i = 0; i < 6; i++) w.tick()
    expect(w.getBlock(1, 0, 0), '電源を切ったのに縮まない').toMatchObject({ extended: false })
  })
})

/**
 * **ピストンヘッドが受けた NC は基部へ転送する** (#231)。
 *
 * [確定: 26.2 PistonHeadBlock.neighborChanged —
 *  ヘッドが存続可能 (canSurvive) なら facing の反対側 1 マス = 基部へ近隣更新を転送する]
 *
 * QC で受電しているピストンは、電源側の変化が「1 個上のマスの隣」で起きるため
 * 基部に直接 NC が届かない。ヘッド経由のこの転送が唯一の通知経路になる。
 */
describe('ピストンヘッドは NC を基部へ転送する (#231)', () => {
  it('ヘッドの隣で電源が消えると基部が縮む', () => {
    const w = new SimWorld()
    // 上向き粘着ピストン。**QC 源は最初から置いておく** — 後から置いても
    // 斜めの位置には NC が飛ばないので伸びない (それが QC/BUD の性質)
    w.setBlockAt([0, 0, 0], { type: 'sticky_piston', facing: 'up', extended: false } as BlockState)
    w.setBlockAt([0, 1, 0], { type: 'solid', powered: false } as BlockState)   // 押される石
    w.setBlockAt([1, 1, 0], { type: 'redstone_block' } as BlockState)          // 1 個上のマスの隣 = QC
    w.initialize()
    w.flush(64)
    // QC は「隣に置いただけ」では基部に NC が届かないので、BUD を 1 回起こして起動させる
    w.setBlockCommand([0, 0, 1], { type: 'solid', powered: false } as BlockState)
    for (let i = 0; i < 6; i++) w.tick()
    expect(w.getBlock(0, 0, 0), '前提: QC で伸びている').toMatchObject({ extended: true })
    expect(w.getBlock(0, 1, 0), '前提: ヘッドが出ている').toMatchObject({ type: 'piston_head' })

    // 電源を消す。基部 (0,0,0) は電源の隣ではないので直接 NC は届かず、
    // **ヘッド (0,1,0) が受けた NC の転送**でしか伝わらない
    w.setBlockCommand([1, 1, 0], { type: 'air' })
    for (let i = 0; i < 6; i++) w.tick()
    expect(w.getBlock(0, 0, 0), 'ヘッド経由の NC が届かず縮んでいない')
      .toMatchObject({ extended: false })
  })
})

/**
 * **音符ブロックの POWERED 変化は近隣更新 (NC) を出す** (#231)。
 *
 * [確定: 26.2 NoteBlock.neighborChanged — **flag 3 の setBlock** の
 *  flag 3 = UPDATE_NEIGHBORS|UPDATE_CLIENTS]。
 * 「信号を出力しないから NC 不要」ではない。UPDATE_NEIGHBORS は出力の有無と関係なく
 * 隣接 6 マスへ配られ、**真下のピストン**はこれで電源断を知る。
 * ランプは flag 2 なので NC を出さない — 揃えないこと。
 */
describe('音符ブロックの POWERED 変化は NC を出す (#231)', () => {
  it('真上の音符ブロックの受電が切れるとピストンが縮む', () => {
    const w = new SimWorld()
    // 北向きピストンの 1 個上が音符ブロック。その隣の電源が QC 源かつ音符ブロックの電源
    w.setBlockAt([0, 0, 0], { type: 'sticky_piston', facing: 'north', extended: false } as BlockState)
    w.setBlockAt([0, 1, 0], { type: 'note_block', powered: false, note: 0, instrument: 'harp' } as BlockState)
    w.setBlockAt([1, 1, 0], { type: 'redstone_block' } as BlockState)
    w.initialize()
    w.flush(64)
    w.setBlockCommand([0, 0, 1], { type: 'solid', powered: false } as BlockState)   // BUD
    for (let i = 0; i < 6; i++) w.tick()
    expect(w.getBlock(0, 1, 0), '前提: 音符ブロックが受電している').toMatchObject({ powered: true })
    expect(w.getBlock(0, 0, 0), '前提: QC で伸びている').toMatchObject({ extended: true })

    w.setBlockCommand([1, 1, 0], { type: 'air' })
    for (let i = 0; i < 6; i++) w.tick()
    expect(w.getBlock(0, 1, 0)).toMatchObject({ powered: false })
    expect(w.getBlock(0, 0, 0), '音符ブロックからの NC が無く縮んでいない')
      .toMatchObject({ extended: false })
  })
})

/**
 * **伸長の予約は「押せるか」を予約時に判定する** (#231)。
 *
 * [確定: 26.2 PistonBaseBlock.checkIfExtend —
 *  伸長要求かつ EXTENDED でないとき、押し構造の解決 (PistonStructureResolver) が
 *  成功した場合に限って block event を発行する]
 *
 * 予約してから実行時にだけ判定すると、**その間に押し先の moving_piston が確定して
 * 本来押せないはずのタイミングで押せてしまう**。5×5 ドアの t=220 で、実機が伸ばさない
 * ピストンを sim が伸ばしていた原因。
 */
describe('伸長は予約時に押せるかを判定する (#231)', () => {
  /**
   * **合成テストでは再現できない**ので前提だけ固定する。
   * 「予約時は押せないが、同じ BE 相で他のイベントが押し先を確定させ、その後に
   * 予約が実行される」という順序が要り、それは実回路 (5×5 ドアの t=220) でしか作れなかった。
   * 実際の回帰は実機 fixture door-5x5-kurigohan-open が守る
   * (この判定が無いと不一致が 2 tick → 81 tick に増える)。
   *
   * 着地そのものは NC を出すので、**押し先が確定したあとに改めて伸びるのは正しい**
   * (#213 の着地 NC)。ここではそれを固定しておく。
   */
  it('押し先が moving のうちは伸びず、着地の更新で伸びる', () => {
    const w = new SimWorld()
    w.setBlockAt([0, 0, 0], { type: 'lever', facing: 'up', powered: false } as BlockState)
    w.setBlockAt([1, 0, 0], { type: 'piston', facing: 'east', extended: false } as BlockState)
    w.setBlockAt([2, 0, 0], { type: 'solid', powered: false } as BlockState)
    w.setBlockAt([3, -1, 0], { type: 'sticky_piston', facing: 'up', extended: false } as BlockState)
    w.initialize()
    w.flush(64)

    w.activateBlock(0, 0, 0)
    w.tick()
    expect(w.getBlock(3, 0, 0)?.type, '前提: 押し先が moving').toBe('moving_piston')
    w.setBlockCommand([3, -2, 0], { type: 'redstone_block' } as BlockState)
    // moving のうちは伸びない
    expect(w.getBlock(3, -1, 0), 'moving を押してしまっている').toMatchObject({ extended: false })
    // 着地すると NC が飛ぶので、そこで伸びる (#213)
    for (let i = 0; i < 6; i++) w.tick()
    expect(w.getBlock(3, -1, 0)).toMatchObject({ extended: true })
  })
})

/**
 * **着地したピストンは自分自身を再判定する** (#231)。
 *
 * [確定: 26.2 PistonBaseBlock.onPlace —
 *  置き換え前が別ブロック種で、かつその位置に BlockEntity がまだ無いときだけ checkIfExtend を呼ぶ]
 *
 * 着地は moving_piston → piston の差し替えなので条件を満たす。
 * 着地が出す NC は**隣接 6 マス向けで自分には飛ばない**ため、これが無いと
 * 「運ばれて着地した直後に受電しているピストン」が伸びない
 * (5×5 ドアの t=299 で実機だけが伸びていた)。
 *
 * **ここで固定できるのはタイミングだけ**: 合成回路では他の更新でも再判定されてしまい、
 * 自己再判定の有無を切り分けられなかった (再判定を外しても同じ tick で伸びる)。
 * 経路そのものの回帰は実機 fixture door-5x5-kurigohan-open が守る
 * (外すと不一致が 2 tick → 17 tick に増える)。
 */
describe('着地したピストンは自分を再判定する (#231)', () => {
  it('受電した状態で着地したピストンは着地の翌 tick で伸びる', () => {
    const w = new SimWorld()
    // 運び役: レバー(0,0,0) → ピストン(1,0,0,east) が上向き粘着ピストン(2,0,0) を (3,0,0) へ押す
    w.setBlockAt([0, 0, 0], { type: 'lever', facing: 'up', powered: false } as BlockState)
    w.setBlockAt([1, 0, 0], { type: 'piston', facing: 'east', extended: false } as BlockState)
    w.setBlockAt([2, 0, 0], { type: 'sticky_piston', facing: 'up', extended: false } as BlockState)
    // 着地先 (3,0,0) の隣に電源を置いておく (着地した瞬間から受電している)
    w.setBlockAt([3, -1, 0], { type: 'redstone_block' } as BlockState)
    w.setBlockAt([2, 1, 0], { type: 'solid', powered: false } as BlockState)   // 押される弾 (一緒に運ばれる)
    w.initialize()
    w.flush(64)
    expect(w.getBlock(2, 0, 0), '前提: まだ伸びていない').toMatchObject({ extended: false })

    w.activateBlock(0, 0, 0)
    // **着地した tick と伸びた tick が一致すること**を見る。
    // 「そのうち伸びる」だけだと、他の更新で再判定されても通ってしまい空振りになる
    let landTick = -1, extendTick = -1
    for (let t = 1; t <= 12; t++) {
      w.tick()
      const b = w.getBlock(3, 0, 0) as { type: string; extended?: boolean } | null
      if (b?.type === 'sticky_piston' && landTick < 0) landTick = t
      if (b?.type === 'sticky_piston' && b.extended && extendTick < 0) extendTick = t
    }
    expect(landTick, '運ばれて着地していない').toBeGreaterThan(0)
    expect(extendTick, '着地しても伸びない').toBeGreaterThan(0)
    // 着地は phase10 (BlockEntity 相) なので、そこで積んだ BE が走るのは**翌 tick**。
    // 実機でも t=298 着地 → t=299 伸長 だった
    expect(extendTick, `着地 t=${landTick} の翌 tick で伸びていない (t=${extendTick})`).toBe(landTick + 1)
  })
})
