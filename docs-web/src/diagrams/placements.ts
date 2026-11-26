import type { DiagramName } from '@redstone/docs-kit/diagrams'

/**
 * 図の置き場所 (#434): 節 ID → その節の見出しの直後に出す図。
 *
 * - md には何も書かない。置き場所はここだけが持つ
 * - 値は `@redstone/docs-kit/diagrams` の一覧 (`DIAGRAMS`) の名前。名前 1 つが「部品と、それに渡す値」を決める。
 *   ここは型だけを import するので、殻のチャンクに図の中身は入らない (図のあるページを開いた時に取る)
 * - 節の番号が動くと ID が変わる。`docs-web/test/placements.test.ts` が、ID が全部実在することと、
 *   名前が一覧にあることを見る
 * - 図を足す時は、`packages/docs-kit/src/diagrams/*.data.ts` に文言を書き、ここに 1 行足す
 */
export const PLACEMENTS: Readonly<Record<string, readonly DiagramName[]>> = {
  'v01/2.1': ['tick-loop-cycle'],    // 区間 A → B → C の 1 周 (§2.1〜§2.2)
  'v01/2.3': ['level-phases'],       // 相の時間割
  'v01/2.4': ['tick-boundary'],      // tick の間の 7 手順
  'v02/2.2': ['schedule-to-fire'],   // 予約から発火まで
  'v04/2.1': ['set-block-steps'],    // setBlock の 10 手順
  'v04/2.3': ['direction-orders'],   // 方向の並び 5 本
  'v06/3.6': ['direction-orders'],   // 同じ図 (ダストが使う並び)
  'v07/2.4': ['repeater-flip'],      // リピーターの反転の順
  'v13/2.2': ['piston-timeline'],    // ピストンの時系列 (§2.2〜§2.4)
}

/** このページ (節の並び) に図があるか */
export function hasDiagrams(sections: readonly { id: string }[]): boolean {
  return sections.some(s => s.id in PLACEMENTS)
}

/**
 * ページの HTML の、図のある節の見出しの直後に図を差し込む。
 * 見出しは生成器が `data-sec="節 ID"` を付けている。見つからない節は何もしない。
 */
export function insertDiagrams(
  html: string, sections: readonly { id: string }[], render: (name: DiagramName) => string,
): string {
  let out = html
  for (const s of sections) {
    const names = PLACEMENTS[s.id]
    if (!names) continue
    const id = s.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const heading = new RegExp(`<h([1-6])[^>]*\\sdata-sec="${id}"[^>]*>[\\s\\S]*?</h\\1>`)
    out = out.replace(heading, m => m + names.map(render).join(''))
  }
  return out
}
