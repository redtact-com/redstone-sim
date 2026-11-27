/**
 * 見出しから節の ID を作る (#434)。ID の形は packages/docs-kit/src/types.ts の頭の表にある。
 *
 * メモの「07 §4.3」「05 付録 C.1」の引き方と同じ形にする。URL・状態・検索・AI の索引が
 * 同じ ID を使うので、**規則を変えると保存した既読と理解度が外れる**。
 * 前にあった ID が消えたら section-ids.txt のテストが落ちる。
 */

/** 見出しの頭の番号 */
export type HeadingNumber =
  | { kind: 'num'; label: string }   // `4.3 …`・`4. …` → '4.3'・'4'
  | { kind: 'app'; label: string }   // 付録。'app'・'app-A'・'app-C.1'
  | { kind: 'none' }                 // 番号なし (`P1. …`・`R1 …`・和文だけ)

/**
 * 見出しの文から番号を読む。
 *
 * 付録は 3 通りの書き方を 1 つの系列に寄せる:
 * `付録 A. …` (05)・`A. …` (09)・`A.1 …` / `F.0 …` (05・11・17)。
 * 英字 1 字で始まる形は、付録の中 (`inAppendix`) でだけ付録として読む。
 */
export function headingNumber(title: string, inAppendix: boolean): HeadingNumber {
  let m: RegExpExecArray | null
  if ((m = /^(\d+(?:\.\d+)*)\.?(?:\s|$)/.exec(title))) return { kind: 'num', label: m[1] }
  if (/^付録\s*[:：]/.test(title) || /^付録$/.test(title)) return { kind: 'app', label: 'app' }
  if ((m = /^付録\s*([A-Z])(?:\.(\d+(?:\.\d+)*))?[.．]?(?:\s|$)/.exec(title))) {
    return { kind: 'app', label: `app-${m[1]}${m[2] ? '.' + m[2] : ''}` }
  }
  if (inAppendix && (m = /^([A-Z])(?:\.(\d+(?:\.\d+)*))?\.?(?:\s|$)/.exec(title))) {
    return { kind: 'app', label: `app-${m[1]}${m[2] ? '.' + m[2] : ''}` }
  }
  return { kind: 'none' }
}

/** メモ 1 本の中で ID を配る。重複は作らない */
export class IdAllocator {
  private used = new Set<string>()
  private serial = 0
  readonly doc: string

  constructor(doc: string) { this.doc = doc }

  /** `#` と前置きの ID。メモに §0 があるときは `top` に逃がす */
  intro(hasSectionZero: boolean): string {
    return this.take(`${this.doc}/${hasSectionZero ? 'top' : '0'}`)
  }

  /**
   * 見出し 1 個の ID。番号つきは `メモ/番号`、番号なしは `親の ID/n連番` (連番はファイル内)。
   * 番号が同じメモの中で重なったら、後の方を番号なしとして扱う。
   */
  heading(num: HeadingNumber, parentId: string | null): string {
    if (num.kind !== 'none') {
      const id = `${this.doc}/${num.label}`
      if (!this.used.has(id)) return this.take(id)
    }
    return this.take(`${parentId ?? this.doc}/n${++this.serial}`)
  }

  private take(id: string): string {
    if (this.used.has(id)) throw new Error(`節の ID が重なった: ${id}`)
    this.used.add(id)
    return id
  }
}
