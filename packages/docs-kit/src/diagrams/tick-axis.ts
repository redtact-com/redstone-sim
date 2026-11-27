import { DIAGRAM_WIDTH, FS_SMALL, arrow, badge, line, lineHeight, rect, svg, text, textLines, wrap } from './svg.js'

/** 時間軸の 1 列 (tick 1 つ、または tick の中の区間 1 つ) */
export interface TickCol {
  label: string
  /** 続けて同じ名前を持つ列を、上の括りでまとめる (`tick N`) */
  group?: string
}

/** 列の中の出来事 (箱) */
export interface TickEvent {
  k: 'ev'
  col: number
  lane: number
  text: string
  /** 順の番号 */
  n?: number
  hi?: boolean
}

/** 何列かにまたがる帯 (状態が続く間・予約が生きている間)。`from`・`to` は列の位置 (小数も可。1.5 = 2 列目の真ん中) */
export interface TickBar {
  k: 'bar'
  lane: number
  from: number
  to: number
  text: string
  hi?: boolean
}

/** 出来事から出来事への矢印 (予約・積む)。下へ降りてから右へ進む */
export interface TickArrow {
  k: 'arrow'
  from: [col: number, lane: number]
  to: [col: number, lane: number]
  text?: string
}

export type TickItem = TickEvent | TickBar | TickArrow

export interface TickAxisData {
  cols: TickCol[]
  /** 段の名前 (左の欄)。全部が空なら左の欄を作らない */
  lanes: string[]
  items: TickItem[]
  /** 図の下の注記 */
  notes?: string[]
}

const PAD = 8
const GUTTER = 96
const BOX_PAD = 6

/**
 * tick の時間軸。列が時間 (左から右)、段が相やセルで、箱 (出来事)・帯 (続く状態)・矢印 (予約) を置く。
 */
export function tickAxisSvg(d: TickAxisData, label = 'tick の時間軸'): string {
  const gutter = d.lanes.some(Boolean) ? GUTTER : 0
  const x0 = PAD + gutter
  const colW = (DIAGRAM_WIDTH - PAD - x0) / d.cols.length
  const cx = (c: number) => x0 + c * colW
  const lh = lineHeight(FS_SMALL)
  let out = ''
  let y = 6

  // 列の括りと見出し
  if (d.cols.some(c => c.group)) {
    for (let i = 0; i < d.cols.length;) {
      let j = i
      while (j + 1 < d.cols.length && d.cols[j + 1].group === d.cols[i].group) j++
      const g = d.cols[i].group
      if (g) {
        const x1 = cx(i) + 3, x2 = cx(j + 1) - 3
        out += text((x1 + x2) / 2, y + 11, g, 'dg-s dg-b', 'middle')
        out += `<path d="M${x1} ${y + 22}V${y + 17}H${x2}V${y + 22}" class="dg-ln"/>`
      }
      i = j + 1
    }
    y += 26
  }
  const heads = d.cols.map(c => wrap(c.label, colW - 8, FS_SMALL))
  const headH = Math.max(...heads.map(h => h.length)) * lh + 8
  d.cols.forEach((_, i) => {
    out += rect(cx(i) + 1, y, colW - 2, headH, 'dg-box', 3)
    out += textLines(cx(i) + colW / 2, y + 4, heads[i], FS_SMALL, 'dg-b', 'middle')
  })
  y += headH + 6
  const top = y

  // 段の高さ: その段の箱と帯のうち一番高い物
  const wrapped = d.items.map(it => it.k === 'ev'
    ? wrap(it.text, colW - 6 - BOX_PAD * 2 - (it.n ? 14 : 0), FS_SMALL)
    : it.k === 'bar' ? wrap(it.text, (it.to - it.from) * colW - 6 - BOX_PAD * 2, FS_SMALL) : [])
  const laneH = d.lanes.map((_, l) => Math.max(26, ...d.items.map((it, i) =>
    it.k !== 'arrow' && it.lane === l ? wrapped[i].length * lh + BOX_PAD * 2 : 0)))
  const laneY: number[] = []
  for (const h of laneH) { laneY.push(y); y += h + 8 }
  const bottom = y - 4

  for (let i = 1; i < d.cols.length; i++) out += line(cx(i), top - 2, cx(i), bottom, 'dg-dash')
  d.lanes.forEach((name, l) => {
    if (!name) return
    const ls = wrap(name, gutter - 8, FS_SMALL)
    out += textLines(PAD, laneY[l] + (laneH[l] - ls.length * lh) / 2, ls, FS_SMALL, 'dg-b')
  })

  d.items.forEach((it, i) => {
    if (it.k === 'arrow') return
    const ly = laneY[it.lane], h = laneH[it.lane]
    const x = it.k === 'ev' ? cx(it.col) + 3 : cx(it.from) + 3
    const w = (it.k === 'ev' ? colW : (it.to - it.from) * colW) - 6
    out += rect(x, ly, w, h, it.hi ? 'dg-hi' : it.k === 'bar' ? 'dg-alt' : 'dg-box', it.k === 'bar' ? 10 : 4)
    const lines = wrapped[i]
    const ty = ly + (h - lines.length * lh) / 2
    if (it.k === 'ev') {
      if (it.n) out += badge(x + 11, ly + 12, it.n, 'dg-num', 8)
      out += textLines(x + BOX_PAD + (it.n ? 14 : 0), it.n ? ly + BOX_PAD : ty, lines, FS_SMALL)
    } else out += textLines(x + w / 2, ty, lines, FS_SMALL, '', 'middle')
  })

  for (const it of d.items) {
    if (it.k !== 'arrow') continue
    const sx = cx(it.from[0]) + colW / 2
    const sy = laneY[it.from[1]] + laneH[it.from[1]]
    const ty = laneY[it.to[1]] + laneH[it.to[1]] / 2
    const tx = cx(it.to[0]) + 3
    out += arrow([[sx, sy], [sx, ty], [tx, ty]])
    if (it.text) out += text((sx + tx) / 2 + 2, ty - 5, it.text, 'dg-s dg-acc dg-b', 'middle')
  }

  for (const note of d.notes ?? []) {
    for (const l of wrap(note, DIAGRAM_WIDTH - PAD * 2, FS_SMALL)) { out += text(PAD, y + 10, l, 'dg-s dg-m'); y += lh }
    y += 2
  }
  return svg(y + 4, label, out)
}
