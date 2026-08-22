import type { BlockState, Pos3D, SimWorld } from '@redstone/sim'
import type { CircuitEditor } from './editor.js'

/**
 * 編集中の回路を「動かす」ための最小セッション (#113)。
 *
 * これまで下流 (redstone-maker) とアプリ側がそれぞれ
 * 「world を組む → initialize → 落ち着くまで進める」を手書きしており、
 * しかも `flush()` がピストンの押し出しを取りこぼす罠を各自で回避していた。
 * その手順を 1 か所に集約する。
 */

export interface SessionOptions {
  /** レバーの初期状態を上書きする ("x,y,z" → powered)。真理値表の 1 行を組むのに使う */
  leverStates?: ReadonlyMap<string, boolean>
}

export interface SettleOutcome {
  ticks: number
  /** false = 発振しているか maxTicks で打ち切られた */
  quiescent: boolean
}

export class SimSession {
  readonly world: SimWorld

  constructor(editor: CircuitEditor, opts: SessionOptions = {}) {
    this.world = editor.buildSimWorld()
    const levers = opts.leverStates
    if (levers) {
      for (const [key, powered] of levers) {
        const [x, y, z] = key.split(',').map(Number) as Pos3D
        const block = this.world.getBlockAt([x, y, z])
        if (block?.type === 'lever') {
          this.world.setBlockAt([x, y, z], { ...block, powered } as BlockState)
        }
      }
    }
    // **ここは意図的に計算し直す** (#317)。真理値表を組むために leverStates で
    // レバーを差し替えるので、保存時の状態を信用すると差し替えが伝わらない。
    // 取り込んだ回路を「そのまま動かす」のはアプリ側 (EditorPage / EmbedPage) の役目
    this.world.initialize()
  }

  /** n tick 進める */
  step(n = 1): void {
    for (let i = 0; i < n; i++) this.world.tick()
  }

  /** 落ち着くまで進める。押し出し中のピストンも確定させる (flush と違う点) */
  settle(maxTicks = 4096, quietTicks = 1): SettleOutcome {
    return this.world.settle(maxTicks, quietTicks)
  }

  /** これ以上自力で変化しないか */
  get quiescent(): boolean {
    return this.world.isQuiescent()
  }

  /** 動いている最中か (発振中を含む) */
  get active(): boolean {
    return !this.world.isQuiescent()
  }

  /** レバー・ボタン等を手で叩く */
  activate(x: number, y: number, z: number): void {
    this.world.activateBlock(x, y, z)
  }
}
