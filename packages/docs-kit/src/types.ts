/**
 * 読む用の Web の生成物の形 (#434)。
 *
 * 生成器 (tools/docs-index) が出し、読む画面・状態・検索・AI 向けの索引が読む。
 * **欄の意味はここ 1 か所に書く**。欄を足す・変えるときは、生成器とここを同時に直す。
 *
 * ID の決まり (URL・状態・検索・AI の索引で同じ物を使う):
 *
 * | 対象 | 形 |
 * |---|---|
 * | メモ | `v07` (docs/vanilla/07_*.md)・`r19` (docs/research/19_*.md)・`v-readme` |
 * | 番号つきの節 | `v07/4.3`・`r19/3.9` (メモの番号 + 見出しの番号) |
 * | 付録 | `v05/app` (付録の `##`)・`v05/app-C` (付録 C)・`v05/app-C.1` |
 * | 番号なしの見出し | 親の ID + ファイル内の連番 (`v07/4.5/n2`)。見出しを足すと後ろがずれる |
 * | メモの `#` と前置き | `v07/0`。メモに §0 があるとき (research 17〜19) は `r17/top` |
 *
 * ページの ID は、そのページの先頭の節の ID と同じ。ただし割った `##` (150 行超) は
 * 前置きごと先頭の `###` のページに入るので、`v07/4` はページではなく `v07/4.1` の中の節になる。
 */

/** 生成物の形の版。欄の意味を変えたら上げる */
export const DOCS_DATA_VERSION = 1

/** 印の種類。語は決め打ちで拾う (`[t]`・`[4]` のような添字は印にしない) */
export type MarkKind =
  | 'read'    // [26.3 読解 …]
  | 'need'    // [要実機 …]
  | 'fx'      // [実機 1.21.1: fixture 名]
  | 'ver'     // [版差 …]
  | 'sure'    // [確定 …]
  | 'meas'    // [実測 …]・[ライブラリ実測]
  | 'guess'   // [推定]
  | 'check'   // [要確認 …]・[要検証 …]

/** 印の種類の並び (索引のビットの順。足すときは後ろに足す) */
export const MARK_KINDS: readonly MarkKind[] = ['read', 'need', 'fx', 'ver', 'sure', 'meas', 'guess', 'check']

/** 印の短い呼び名 (検索の結果のバッジと、CLI の `--mark` に使う) */
export const MARK_LABELS: Record<MarkKind, string> = {
  read: '26.3 読解', need: '要実機', fx: '実機', ver: '版差',
  sure: '確定', meas: '実測', guess: '推定', check: '要確認',
}

/** 印の数。0 の種類は欄ごと省く */
export type MarkCounts = Partial<Record<MarkKind, number>>

// ---------------------------------------------------------------------------
// data/manifest.json — 目次。最初に 1 回だけ読む
// ---------------------------------------------------------------------------

export interface Manifest {
  /** DOCS_DATA_VERSION */
  v: number
  /** メモ。並びは目次の順 (README → vanilla 00〜19 → research 17〜19) */
  docs: ManifestDoc[]
  /** ページ。並びは読む順 (前へ・次へはこの順の隣)。`docs[].groups[].pages` と同じ ID */
  pages: ManifestPage[]
  /** 本文の `[実機 1.21.1: 名前]` が指す fixture。鍵は fixture の名前 */
  fixtures: Record<string, FixtureInfo>
  /** 数 (画面の集計と、ビルドの記録に使う) */
  counts: {
    docs: number
    pages: number
    sections: number
    /** 節の参照のうちリンクにした数 */
    refs: number
    /** この Web に無い資料 (research 01〜16・`R-6` の形) への参照。リンクにしない */
    refsOutside: number
    /** 解けなかった参照 (行き先の節が無い)。単体テストが上限を置く */
    refsUnresolved: number
  }
}

/** メモ 1 本 (目次の 1 段目) */
export interface ManifestDoc {
  /** メモの ID。`v07`・`r19`・`v-readme` */
  key: string
  kind: 'vanilla' | 'research'
  /** ファイル名の頭の 2 桁。README は null */
  num: string | null
  /** 短い呼び名。`V07`・`R19`・`README` */
  label: string
  /** `#` の見出し (番号と印を外した文) */
  title: string
  /** リポ相対のパス (`docs/vanilla/07_diodes.md`) */
  file: string
  /** `#` の前置きと `##` ごとのまとまり (目次の 2 段目)。先頭は前置きのページ 1 枚 */
  groups: ManifestGroup[]
}

/** `##` 1 個 (目次の 2 段目)。割れていなければ `pages` は 1 枚 */
export interface ManifestGroup {
  /** `##` の節の ID (`v07/4`)。前置きは `v07/0`。割れた `##` ではページの ID と一致しない */
  id: string
  /** 見出し (印を外した文) */
  title: string
  /** この `##` に入るページの ID (目次の 3 段目)。読む順 */
  pages: string[]
}

/** ページ 1 枚の目録 */
export interface ManifestPage {
  /** ページの ID (`v07/4.3`)。URL は `#/v07/4.3`、本文は `data/pages/v07/4.3.json` */
  id: string
  /** メモの ID */
  doc: string
  /** 属する `##` の ID (`ManifestGroup.id`) */
  group: string
  /** 見出し (印を外した文) */
  title: string
  /** md の行数。10 行未満のページは集計と「読んだにして次へ」で進める */
  lines: number
  /** ページの中の印の数 (絞り込みに使う) */
  marks: MarkCounts
  /** ページの中の fixture の数 (重複を除く) */
  fixtures: number
}

/** fixture 1 本の目録 (packages/sim/test/fixtures から数える) */
export interface FixtureInfo {
  /** ブロックの数 */
  blocks: number
  /** 再生する tick の数 */
  ticks: number
  /** 埋め込める大きさか (ブロックが上限以下)。false は「大きいので埋め込まない」と出す */
  embed: boolean
  /** skip つき (今のエンジンは実機と違う) のとき、その理由 */
  skip?: string
  /** summon・item・kill の入力を含む (エンティティは描かない) */
  entities?: boolean
  /** この fixture を引く節の ID */
  sections: string[]
}

// ---------------------------------------------------------------------------
// data/pages/<ページの ID>.json — ページ 1 枚。開いた時に読む
// ---------------------------------------------------------------------------

export interface PageData {
  /** DOCS_DATA_VERSION */
  v: number
  /** ページの ID */
  id: string
  /** メモの ID */
  doc: string
  /** 属する `##` の ID */
  group: string
  /** 見出し (印を外した文) */
  title: string
  /** 見出しの道筋 (メモの題 → `##` → …)。最後がこのページ */
  path: string[]
  /** リポ相対のパスと、md の中の行の範囲 (1 始まり・両端を含む) */
  file: string
  line: number
  endLine: number
  /**
   * 本文の HTML (ビルド時に markdown-it で作る。実行時にパーサは持たない)。
   *
   * - 見出しは `<h2 id="sec-4.3" data-sec="v07/4.3">`。`id` は `sec-` + `PageSection.anchor`
   * - 節の参照は `<a class="ref" href="#/v07/4.3?s=4.3.2" data-ref="v07/4.3.2">`。
   *   この Web に無い資料は `<span class="ref-out">`、解けなかった物は `<span class="ref-miss">`
   * - 印は `<span class="mk mk-need">`。fixture のタグは `data-fx="名前 名前"` を持つ
   * - 表は `<div class="tbl">` で包む。50 行を超える表は `tbl tbl-long`
   */
  html: string
  /** ページの中の見出し (ページ内のアンカー)。先頭はページの頭の節 */
  sections: PageSection[]
  /** 読む順の前と次のページの ID */
  prev: string | null
  next: string | null
  /** ページの中の印の数 */
  marks: MarkCounts
  /** ページの中の fixture の名前 (重複を除く・出てくる順) */
  fixtures: string[]
}

/** ページの中の見出し 1 個 */
export interface PageSection {
  /** 節の ID (`v07/4.3.2`) */
  id: string
  /** メモの ID を除いた部分 (`4.3.2`)。URL の `?s=` と、HTML の `id="sec-…"` に使う */
  anchor: string
  /** 見出しの深さ (`#` の数) */
  level: number
  /** 見出し (印を外した文) */
  title: string
  /** md の行 (1 始まり) */
  line: number
}

// ---------------------------------------------------------------------------
// 節 1 件の記録 — 検索の索引と AI 向けの JSONL (data/ai/sections.jsonl) の元
// ---------------------------------------------------------------------------

export interface SectionRecord {
  /** 節の ID */
  id: string
  /** 入っているページの ID */
  page: string
  /** リポ相対のパスと、見出しの行 (1 始まり) */
  file: string
  line: number
  /** 見出しの深さ (`#` の数) */
  level: number
  /** 見出し (印を外した文) */
  title: string
  /** 見出しの道筋 (メモの題 → … → この節) */
  path: string[]
  /** 本文 (md のまま。見出しの行は含まず、次の見出しの手前まで) */
  text: string
  /** 本文と見出しに出る印の種類 */
  marks: MarkKind[]
  /** 本文が引く fixture の名前 */
  fixtures: string[]
  /** 本文が引く節・メモの ID (解けた物だけ・重複を除く) */
  refs: string[]
  /** 担当するクラスの名前 (00 の網羅表から引く)。索引の段で埋める */
  classes: string[]
  /** 関わるブロックの ID。索引の段で埋める */
  blocks: string[]
  /** 節の要約と別名。欄だけ用意して空のままにする (言い換えの検索のため。後の issue) */
  summary: string
  aliases: string[]
}
