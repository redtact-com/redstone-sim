// ============================================================
// ワールドに入っている人への合図 (#374)
//
// #368 でクライアントから入れるようにしたのは、**操作が正しく行われたかを
// 自分の目で確かめる**ため。ところが `/tick freeze` 中は `step` を撃った瞬間しか
// 世界が動かず、押すのも fake player なので、**知らせないと見逃す** (実際に見逃した)。
//
// 3 層で知らせる:
//   ① チャット (tellraw)      … 履歴が残る。見逃しても後から追える
//   ② アクションバー (title)  … 画面下に 1 行。**流れない**
//   ③ カウントダウン          … 目を向けてもらう
//
// **人が居なければ黙る**。誰も見ていないのに rcon を余分に叩かない。
// ============================================================

import { rcon, rconBatch, MAX_COMMAND_LEN, sleep } from './rcon.js'

/** 合図の先頭に付ける印。人の発言と混ざらないようにする */
export const PREFIX = '[harness]'

/** `/list` の結果を覚えておく時間。毎命令で叩くと ~100ms 増える */
export const ONLINE_CACHE_MS = 10_000

/**
 * 観客に数えない名前 (#374)。
 *
 * **ハーネス自身の fake player を除く**。fixture セッションは `GT` を常駐させるので、
 * これを数えると「人が居ないときは黙る」が永久に働かない (実機で踏んだ)。
 */
export const HARNESS_PLAYERS = ['GT']

/**
 * `/list` の応答から**人の名前だけ**を取り出す。
 *
 * 応答例: `There are 2 of a max of 20 players online: gt, Taku128`
 *
 * **大小を無視して比べる**。carpet の fake player は `GT` で作っても
 * `/list` には **`gt` (小文字)** で出る (実機で踏んだ。そのままだと除外に当たらず、
 * ハーネス自身を観客に数えて永久に黙らない)。
 */
export function humanPlayers(listOutput: string, exclude: string[] = HARNESS_PLAYERS): string[] {
  const names = (listOutput.split(':')[1] ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(s => s.length > 0)
  const ban = new Set(exclude.map(n => n.toLowerCase()))
  return names.filter(n => !ban.has(n.toLowerCase()))
}

/**
 * チャットに載せられる本文の上限。
 *
 * `tellraw @a {"text":"...","color":"..."}` の包みを引いた残り。
 * **コマンド長 1014 バイトを超えると実機は無言でハングする**ので、
 * 余裕を持って切る (日本語は 1 文字 3 バイト)。
 */
export const MAX_BODY_BYTES = 700

/** JSON 文字列の中に置ける形に直す */
const esc = (s: string): string => JSON.stringify(s).slice(1, -1)

/** バイト数で切って末尾に … を付ける (文字数で切ると日本語ですり抜ける) */
export function clip(text: string, maxBytes = MAX_BODY_BYTES): string {
  const buf = Buffer.from(text, 'utf-8')
  if (buf.length <= maxBytes) return text
  // 途中のマルチバイトを壊さないように、デコードできるところまで戻す
  let end = maxBytes - 3
  while (end > 0) {
    const s = buf.subarray(0, end).toString('utf-8')
    if (!s.endsWith('�')) return `${s}…`
    end--
  }
  return '…'
}

/** `tellraw` 1 本ぶんのコマンド引数 */
export function tellrawArgs(text: string, color = 'aqua'): string[] {
  return ['tellraw', '@a', `{"text":"${esc(clip(text))}","color":"${color}"}`]
}

/** アクションバー (画面下の 1 行) 1 本ぶん */
export function actionbarArgs(text: string, color = 'yellow'): string[] {
  return ['title', '@a', 'actionbar', `{"text":"${esc(clip(text))}","color":"${color}"}`]
}

/**
 * 合図を送る係。
 *
 * `enabled` が false なら何もしない (`--quiet`)。
 * 人が居ないときも黙るが、**`/list` の結果は 10 秒だけ使い回す**。
 */
export class Announcer {
  /** ハーネス自身の fake player (観客に数えない) */
  private excluded: string[] = [...HARNESS_PLAYERS]
  /**
   * 最後に `/list` を聞いた時刻。
   *
   * **`0` で初期化してはいけない**。`now - 0 < 10_000` が成り立ってしまい、
   * **最初の 1 回がキャッシュ扱いで黙る** (= 開いた直後の合図が消える。
   * この機能が直そうとしている「見逃す」そのもの)。
   */
  private lastCheck = Number.NEGATIVE_INFINITY
  private online = false

  constructor(private enabled = true) {}

  setEnabled(on: boolean): void { this.enabled = on }
  get isEnabled(): boolean { return this.enabled }

  /** 観客に数えない名前を足す (キャプチャ定義の fake player など) */
  exclude(...names: string[]): void {
    for (const n of names) if (!this.excluded.includes(n)) this.excluded.push(n)
  }

  /** いま観客として数えている名前 (status に出す。切り分けにも使える) */
  audience(): string[] {
    try {
      return humanPlayers(rcon('list'), this.excluded)
    } catch {
      return []
    }
  }

  /** 誰か入っているか (10 秒キャッシュ) */
  hasAudience(now = Date.now()): boolean {
    if (!this.enabled) return false
    if (now - this.lastCheck < ONLINE_CACHE_MS) return this.online
    this.lastCheck = now
    try {
      // "There are 2 of a max of 20 players online: GT, Taku128"
      // **ハーネスの fake player は数えない** (数えると永久に黙らない)
      this.online = humanPlayers(rcon('list'), this.excluded).length > 0
    } catch {
      this.online = false
    }
    return this.online
  }

  /**
   * チャットとアクションバーへ出す。
   *
   * `big` のときはアクションバーにも出す (流れて消えない)。
   * **1 回の docker exec にまとめる** (2 本を別々に撃つと 2 倍遅い)
   */
  say(text: string, opts: { big?: boolean; color?: string } = {}): void {
    if (!this.hasAudience()) return
    const body = `${PREFIX} ${text}`
    const cmds = [tellrawArgs(body, opts.color).join(' ')]
    if (opts.big === true) cmds.push(actionbarArgs(text).join(' '))
    try {
      // 応答は使わない (tellraw / title は複数行返すので警告だけが邪魔になる)
      rconBatch(cmds, { ignoreResponses: true })
    } catch (e) {
      // 合図が出せなくても本体の操作は続ける
      console.error(`[announce] 送れなかった: ${e instanceof Error ? e.message : e}`)
    }
  }

  /** 「3 … 2 … 1」のあとに本文。目を向けてもらうため */
  async countdown(n: number, what: string): Promise<void> {
    if (!this.hasAudience()) return
    for (let i = n; i >= 1; i--) {
      this.say(`${what} … ${i}`, { big: true })
      await sleep(1000)
    }
  }
}

/** 変化した座標を読みやすく並べる (多いときは頭だけ) */
export function changesSummary(
  changes: { pos: [number, number, number] }[], max = 4,
): string {
  if (changes.length === 0) return '変化なし'
  const head = changes.slice(0, max).map(c => c.pos.join(',')).join(' / ')
  return changes.length <= max
    ? `変化 ${changes.length} か所: ${head}`
    : `変化 ${changes.length} か所: ${head} ほか`
}

/** コマンド長の検査に当たらないことを型で示すための再輸出 */
export { MAX_COMMAND_LEN }
