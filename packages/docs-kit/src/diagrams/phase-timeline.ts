import { DIAGRAM_WIDTH, FS_SMALL, arrow, lineHeight, rect, svg, text, textLines, wrap } from './svg.js'

/** 相 1 つ (帯の 1 ます) */
export interface PhaseCell {
  /** ますの中に書く短い名前 (`L6`・`B4`) */
  id: string
  /** ますの下に書く説明 */
  label?: string
  /** 幅の重み (既定 1) */
  w?: number
  /** 色を付けて目立たせる */
  hi?: boolean
}

/** 何ますかをまとめる見出し (帯の上の括り) */
export interface PhaseGroup {
  /** 始まりと終わりのますの番号 (0 始まり・両端を含む) */
  from: number
  to: number
  label: string
}

export interface PhaseTimelineData {
  cells: PhaseCell[]
  groups?: PhaseGroup[]
  /** 1 段に並べるますの数。超えた分は次の段へ折り返す (上の段から下の段へ進む)。省くと 1 段 */
  perRow?: number
  /** 最後のますから最初のますへ戻る矢印の説明 (1 周して繰り返す時) */
  loop?: string
  /** 色を付けたますの意味 */
  legend?: string
  /** 図の下の注記 */
  notes?: string[]
  /** 今の相。この `id` のますを塗る */
  current?: string
  /** 小型版。ますだけを 1 段に並べ、説明・括り・凡例は出さない */
  mini?: boolean
}

const PAD = 8
const MINI_CELL = 30

/**
 * 相の時間割。左から右へ (段があれば上から下へ) 時間が進む帯で、ますの下に説明を書く。
 * `mini` は記事の中で「今はこの相」を示す小型版。
 */
export function phaseTimelineSvg(d: PhaseTimelineData, label = '相の時間割'): string {
  const width = d.mini ? d.cells.length * MINI_CELL + PAD * 2 : DIAGRAM_WIDTH
  const perRow = d.mini || !d.perRow ? d.cells.length : d.perRow
  const groups = d.mini ? [] : d.groups ?? []
  const cellH = d.mini ? 20 : 26
  const lh = lineHeight(FS_SMALL)
  // 戻りの矢印は左の余白を通って最初のますへ入る
  const left = PAD + (d.loop && !d.mini ? 16 : 0)
  let firstMid = 0
  let out = ''
  let y = d.mini ? 4 : 6
  for (let start = 0; start < d.cells.length; start += perRow) {
    const cells = d.cells.slice(start, start + perRow)
    const end = start + cells.length - 1
    const unit = (width - PAD - left) / cells.reduce((s, c) => s + (c.w ?? 1), 0)
    const xs: number[] = []
    let x = left
    for (const c of cells) { xs.push(x); x += (c.w ?? 1) * unit }
    xs.push(x)

    // 括り: この段にかかる分だけを引く
    const here = groups.filter(g => g.from <= end && g.to >= start)
    for (const g of here) {
      const x1 = xs[Math.max(g.from, start) - start] + 3, x2 = xs[Math.min(g.to, end) - start + 1] - 3
      out += text((x1 + x2) / 2, y + 11, g.label, 'dg-s dg-b', 'middle')
      out += `<path d="M${x1} ${y + 22}V${y + 17}H${x2}V${y + 22}" class="dg-ln"/>`
    }
    if (here.length) y += 26

    if (start === 0) firstMid = y + cellH / 2
    let labelH = 0
    cells.forEach((c, i) => {
      const w = xs[i + 1] - xs[i]
      const cur = c.id === d.current
      out += rect(xs[i] + 1, y, w - 2, cellH, cur ? 'dg-cur' : c.hi ? 'dg-hi' : 'dg-box', 3)
      out += text(xs[i] + w / 2, y + cellH / 2 + 4, c.id, `dg-b${d.mini ? ' dg-s' : ''}${cur ? ' dg-on' : ''}`, 'middle')
      if (d.mini || !c.label) return
      const lines = wrap(c.label, w - 8, FS_SMALL)
      out += textLines(xs[i] + w / 2, y + cellH + 5, lines, FS_SMALL, c.hi ? '' : 'dg-m', 'middle')
      labelH = Math.max(labelH, lines.length * lh)
    })
    y += cellH + (d.mini ? 0 : 5 + labelH + 8)
  }
  if (d.mini) return svg(y + 4, label, out, width)

  if (d.loop) {
    const xr = width - PAD - 12, xl = PAD + 5
    out += arrow([[xr, y - 4], [xr, y + 10], [xl, y + 10], [xl, firstMid], [left + 1, firstMid]])
    out += text(width / 2, y + 26, d.loop, 'dg-s', 'middle')
    y += 34
  }
  if (d.legend) {
    out += rect(PAD + 1, y + 2, 18, 12, 'dg-hi', 2) + text(PAD + 26, y + 12, d.legend, 'dg-s')
    y += 20
  }
  for (const note of d.notes ?? []) { out += text(PAD, y + 12, note, 'dg-s dg-m'); y += lh + 1 }
  return svg(y + 4, label, out, width)
}
