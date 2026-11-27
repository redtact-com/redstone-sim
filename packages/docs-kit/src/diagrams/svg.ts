/**
 * 図の部品が共有する SVG の小道具 (#434)。
 *
 * 図は「データ → SVG の文字列」の関数で作る。DOM に触らないので、ビルド時の静的な HTML にも埋められる。
 * 色は直に書かず、クラスと CSS 変数 (`--dg-*`) で決める。明暗は `DIAGRAM_CSS` が持つ。
 * 字の幅は測れないので見積もる (全角 1em・半角 0.6em)。箱はその見積もりで折り返して高さを決める。
 */

/**
 * 図の幅 (px)。全部の図で同じにする。読む用の Web の本文の欄 (幅 1280 の画面で 722 px) に、
 * 枠の余白ごと収まる値。それより狭い画面では枠 (`.dg`) の中で横に流す
 */
export const DIAGRAM_WIDTH = 696

/** 字の大きさ (px)。`DIAGRAM_CSS` の `.dg-t`・`.dg-s` と合わせる */
export const FS = 12
export const FS_SMALL = 10.5

export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

const n1 = (v: number): number => Math.round(v * 10) / 10

/** 字の幅の見積もり (px) */
export function textWidth(s: string, fs: number): number {
  let em = 0
  for (const ch of s) em += ch.charCodeAt(0) < 0x2000 ? 0.6 : 1
  return em * fs
}

/** 行の頭に置かない字と、行の末に置かない字 */
const NO_HEAD = '、。・)」〜→:ーっゃゅょッャュョァィゥェォ'
const NO_TAIL = '(「'

/**
 * 幅に収まるように折り返す。半角の語 (英数字の並び) は途中で切らない (1 語が幅を超える時だけ切る)。
 */
export function wrap(s: string, width: number, fs: number): string[] {
  const units = s.match(/[\x21-\x7e]+|\s+|[^\x20-\x7e]/g) ?? []
  const lines: string[] = []
  let cur = ''
  /** 行を閉じる。行の末の開き括弧は次の行へ送る */
  const push = (): string => {
    let line = cur.trim(), carry = ''
    while (line.length > 1 && NO_TAIL.includes(line[line.length - 1])) { carry = line[line.length - 1] + carry; line = line.slice(0, -1).trim() }
    if (line) lines.push(line)
    cur = ''
    return carry
  }
  for (let u of units) {
    if (textWidth(cur + u, fs) <= width || (u.length === 1 && NO_HEAD.includes(u))) { cur += u; continue }
    u = push() + u
    while (textWidth(u, fs) > width) {
      let k = 1
      while (textWidth(u.slice(0, k + 1), fs) <= width) k++
      lines.push(u.slice(0, k))
      u = u.slice(k)
    }
    cur = u.trim() ? u : ''
  }
  cur = push()
  push()
  return lines.length ? lines : ['']
}

export type Anchor = 'start' | 'middle' | 'end'

/** 1 行の字。`y` は字の基線 */
export function text(x: number, y: number, s: string, cls = '', anchor: Anchor = 'start'): string {
  const a = anchor === 'start' ? '' : ` text-anchor="${anchor}"`
  return `<text x="${n1(x)}" y="${n1(y)}" class="dg-t${cls ? ' ' + cls : ''}"${a}>${esc(s)}</text>`
}

/** 何行かの字。`y` は 1 行目の上の端。行の送りは字の大きさの 1.3 倍 */
export function textLines(x: number, y: number, lines: string[], fs: number, cls = '', anchor: Anchor = 'start'): string {
  const small = fs === FS_SMALL ? 'dg-s' : ''
  const c = [small, cls].filter(Boolean).join(' ')
  return lines.map((l, i) => text(x, y + fs * 0.95 + i * lineHeight(fs), l, c, anchor)).join('')
}

export const lineHeight = (fs: number): number => Math.round(fs * 1.35)

export function rect(x: number, y: number, w: number, h: number, cls: string, r = 4): string {
  return `<rect x="${n1(x)}" y="${n1(y)}" width="${n1(w)}" height="${n1(h)}" rx="${r}" class="${cls}"/>`
}

export function line(x1: number, y1: number, x2: number, y2: number, cls = 'dg-ln'): string {
  return `<path d="M${n1(x1)} ${n1(y1)}L${n1(x2)} ${n1(y2)}" class="${cls}"/>`
}

/** 折れ線の先に矢じりを付ける。点は [x, y] の並び */
export function arrow(points: [number, number][], cls = 'dg-ln'): string {
  const d = points.map(([x, y], i) => `${i ? 'L' : 'M'}${n1(x)} ${n1(y)}`).join('')
  const [x2, y2] = points[points.length - 1]
  const [x1, y1] = points[points.length - 2]
  const len = Math.hypot(x2 - x1, y2 - y1) || 1
  const ux = (x2 - x1) / len, uy = (y2 - y1) / len
  const bx = x2 - ux * 7, by = y2 - uy * 7
  const head = `M${n1(x2)} ${n1(y2)}L${n1(bx - uy * 3.5)} ${n1(by + ux * 3.5)}L${n1(bx + uy * 3.5)} ${n1(by - ux * 3.5)}Z`
  return `<path d="${d}" class="${cls}"/><path d="${head}" class="dg-ah"/>`
}

/** 番号の丸 */
export function badge(cx: number, cy: number, label: string | number, cls = 'dg-num', r = 9): string {
  return `<circle cx="${n1(cx)}" cy="${n1(cy)}" r="${r}" class="${cls}"/>`
    + text(cx, cy + 3.7, String(label), cls === 'dg-num' ? 'dg-s dg-on dg-b' : 'dg-s dg-b', 'middle')
}

/** SVG の外枠。`label` は読み上げ用の名前 */
export function svg(height: number, label: string, body: string, width = DIAGRAM_WIDTH): string {
  const h = Math.ceil(height)
  return `<svg class="dg-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${h}" width="${width}" height="${h}" role="img" aria-label="${esc(label)}">${body}</svg>`
}

/**
 * 図の見た目。読む側のページに 1 回だけ入れる (`<style>`)。
 *
 * - 色は `--dg-*` で決める。明るい配色が既定で、暗い配色は `prefers-color-scheme` で切り替える
 * - `:where()` で詳細度を 0 にしてあるので、読む側は `.dg { --dg-accent: … }` と書くだけで上書きできる
 * - 図は縮めない。枠より広い時は枠の中で横に流す (ページは横に流さない)
 */
export const DIAGRAM_CSS = `
:where(.dg){--dg-bg:#fff;--dg-fg:#1c1e21;--dg-muted:#5f6672;--dg-line:#c3c9d2;--dg-box:#f6f7f9;--dg-hi:#fdecea;--dg-accent:#b3261e;--dg-alt:#e7effb;--dg-alt-line:#1d4f91}
@media (prefers-color-scheme:dark){:where(.dg){--dg-bg:#15171a;--dg-fg:#e4e6ea;--dg-muted:#9aa1ad;--dg-line:#454b55;--dg-box:#1c1f24;--dg-hi:#3a1d1a;--dg-accent:#ff7a6b;--dg-alt:#1c2c44;--dg-alt-line:#a9c8f5}}
.dg{margin:1em 0;padding:10px 12px;border:1px solid var(--dg-line);border-radius:6px;background:var(--dg-bg);color:var(--dg-fg);max-width:100%;overflow-x:auto}
.dg-cap{margin:0 0 6px;font-size:.85rem;font-weight:600;position:sticky;left:0}
.dg-src{font-weight:400;color:var(--dg-muted)}
.dg-panel{margin:8px 0 2px;font-size:.8rem;font-weight:600;position:sticky;left:0}
.dg-svg{display:block;max-width:none;font-family:system-ui,-apple-system,"Hiragino Sans","Noto Sans JP","Yu Gothic UI",sans-serif}
.dg-t{fill:var(--dg-fg);font-size:12px}
.dg-s{font-size:10.5px}
.dg-m{fill:var(--dg-muted)}
.dg-b{font-weight:600}
.dg-on{fill:var(--dg-bg)}
.dg-acc{fill:var(--dg-accent)}
.dg-box{fill:var(--dg-box);stroke:var(--dg-line)}
.dg-hi{fill:var(--dg-hi);stroke:var(--dg-accent);stroke-width:1.5}
.dg-alt{fill:var(--dg-alt);stroke:var(--dg-alt-line)}
.dg-out{fill:var(--dg-bg);stroke:var(--dg-muted);stroke-dasharray:4 3}
.dg-ln{fill:none;stroke:var(--dg-muted);stroke-width:1.2}
.dg-dash{fill:none;stroke:var(--dg-line);stroke-dasharray:3 3}
.dg-ah{fill:var(--dg-muted)}
.dg-num{fill:var(--dg-accent)}
.dg-ring{fill:var(--dg-bg);stroke:var(--dg-muted);stroke-dasharray:3 2}
.dg-cur{fill:var(--dg-accent);stroke:var(--dg-accent)}
`.trim()
