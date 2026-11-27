/**
 * fixture の札 (#434)。本文の `[実機 1.21.1: 名前]` の下に置く 1 行の細い札。
 *
 * 札は**ただの HTML** にする (データ → HTML の文字列)。生成器がビルド時にページの HTML へ差し込み、
 * 読む側は「表示」が押された時にだけ、札の中の置き場 (`.fx-view`) へビューアを付ける。
 * ここは文字列を作るだけで、DOM にも WebGL にも触らない (静的な HTML の記事にも埋められる)。
 *
 * 出す HTML の形:
 *
 * ```html
 * <div class="fx-cards">                          <!-- 段落・箇条書きの直後 -->
 *   <div class="fx-card" data-fx-card="名前">
 *     <div class="fx-row">
 *       <span class="fx-name">名前</span>
 *       <span class="fx-meta">12 ブロック・20 tick</span>
 *       <span class="fx-note fx-note-skip" title="理由">今のエンジンは実機と違う</span>
 *       <span class="fx-note">エンティティは描かない</span>
 *       <button type="button" class="fx-open" data-fx-open="名前" aria-expanded="false">表示</button>
 *     </div>
 *     <div class="fx-view" hidden></div>          <!-- 開いた時だけ高さを取る -->
 *   </div>
 * </div>
 * <details class="fx-cards fx-fold">…</details>   <!-- 表の後ろは 1 つの折りたたみ -->
 * ```
 *
 * 埋め込めない fixture (ブロックが上限を超える) の札は、ボタンと置き場の代わりに
 * `<span class="fx-big">大きいので埋め込まない</span>` を持つ。
 */

import type { FixtureInfo } from './types.js'

/** エンティティを出し入れする入力。ビューアはエンティティを描かない */
export const FIXTURE_ENTITY_ACTIONS: readonly string[] = ['summon', 'item', 'kill']

/** 埋め込めない fixture の札に出す文 (これ以外の理由は書かない) */
export const FIXTURE_NOTE_TOO_BIG = '大きいので埋め込まない'
/** skip つきの fixture の注記。後ろに fixture の理由を続ける */
export const FIXTURE_NOTE_SKIP = '今のエンジンは実機と違う'
/** summon・item・kill を含む fixture の注記 */
export const FIXTURE_NOTE_ENTITIES = 'エンティティは描かない'
/** ビューアの枠に必ず出す 1 行 */
export const FIXTURE_NOTE_ENGINE = 'このエンジンの再生。実機の記録は fixture の expect'
/** 札のボタンの字 (閉じている時・開いている時) */
export const FIXTURE_OPEN_LABEL = '表示'
export const FIXTURE_CLOSE_LABEL = '閉じる'

/** 札に要る欄 (目録の `FixtureInfo` から `sections` を除いた物) */
export type FixtureCardInfo = Omit<FixtureInfo, 'sections'>

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** 札 1 枚の HTML */
export function fixtureCardHtml(name: string, info: FixtureCardInfo): string {
  const n = esc(name)
  const row = [
    `<span class="fx-name">${n}</span>`,
    `<span class="fx-meta">${info.blocks} ブロック・${info.ticks} tick</span>`,
  ]
  if (!info.embed) {
    row.push(`<span class="fx-big">${FIXTURE_NOTE_TOO_BIG}</span>`)
    return `<div class="fx-card" data-fx-card="${n}"><div class="fx-row">${row.join('')}</div></div>`
  }
  if (info.skip !== undefined) row.push(`<span class="fx-note fx-note-skip" title="${esc(info.skip)}">${FIXTURE_NOTE_SKIP}</span>`)
  if (info.entities) row.push(`<span class="fx-note">${FIXTURE_NOTE_ENTITIES}</span>`)
  row.push(`<button type="button" class="fx-open" data-fx-open="${n}" aria-expanded="false">${FIXTURE_OPEN_LABEL}</button>`)
  return `<div class="fx-card" data-fx-card="${n}"><div class="fx-row">${row.join('')}</div><div class="fx-view" hidden></div></div>`
}

/**
 * 札の並びの HTML。`fold` は表の後ろに置く形 (1 つの折りたたみにまとめる)。
 * 札が無ければ空の文字列
 */
export function fixtureCardsHtml(cards: readonly (readonly [string, FixtureCardInfo])[], fold = false): string {
  if (cards.length === 0) return ''
  const body = cards.map(([name, info]) => fixtureCardHtml(name, info)).join('')
  if (!fold) return `<div class="fx-cards">${body}</div>\n`
  return `<details class="fx-cards fx-fold"><summary>この表の fixture (${cards.length} 本)</summary>${body}</details>\n`
}
