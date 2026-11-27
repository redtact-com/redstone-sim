import { DIAGRAM_WIDTH, FS, FS_SMALL, badge, line, lineHeight, svg, text, textLines, wrap } from './svg.js'

/** 方向。下・上・北・南・西・東 */
export type Dir = 'D' | 'U' | 'N' | 'S' | 'W' | 'E'

/** 並び 1 本 (立方体 1 個) */
export interface DirOrder {
  /** 何の並びか */
  label: string
  /** 配る順。6 方向より少ない並びでは、無い面に番号を振らない */
  order: Dir[]
}

export interface DirectionOrderData {
  orders: DirOrder[]
  /** 方向の呼び名 (1 字) */
  names: Record<Dir, string>
  /** 図の下に書く注記 (座標の向き・印の意味) */
  notes?: string[]
}

const PAD = 8
/** 立方体の大きさ: 上の面の幅の半分・高さの半分・縦の辺 */
const A = 34, B = 17, H = 40

/**
 * 方向の並びを、6 面に番号を振った立方体で見せる。
 *
 * 立方体は南東の上から見る。見えるのは 上・南 (左の面)・東 (右の面) で、
 * 裏の 西・北・下 は外に破線の丸で出す。
 */
export function directionOrderSvg(d: DirectionOrderData, label = '方向の並び'): string {
  const n = d.orders.length
  const cell = (DIAGRAM_WIDTH - PAD * 2) / n
  const heads = d.orders.map(o => wrap(o.label, cell - 10, FS))
  const headH = Math.max(...heads.map(h => h.length)) * lineHeight(FS)
  const y0 = 8 + headH + 34
  let out = ''
  d.orders.forEach((o, i) => {
    const cx = PAD + cell * i + cell / 2
    out += textLines(cx, 8, heads[i], FS, 'dg-b', 'middle')
    // 面: 上・南 (左)・東 (右)
    const T = [cx, y0], R = [cx + A, y0 + B], C = [cx, y0 + 2 * B], L = [cx - A, y0 + B]
    const poly = (pts: number[][], cls: string) => `<path d="M${pts.map(p => p.join(' ')).join('L')}Z" class="${cls}"/>`
    out += poly([T, R, C, L], 'dg-box')
    out += poly([L, C, [C[0], C[1] + H], [L[0], L[1] + H]], 'dg-box')
    out += poly([C, R, [R[0], R[1] + H], [C[0], C[1] + H]], 'dg-box')
    // 裏の面への引き出し線
    out += line(cx - A / 2, y0 + B / 2, cx - A / 2 - 9, y0 + B / 2 - 14, 'dg-dash')
    out += line(cx + A / 2, y0 + B / 2, cx + A / 2 + 9, y0 + B / 2 - 14, 'dg-dash')
    out += line(cx, y0 + 2 * B + H, cx, y0 + 2 * B + H + 8, 'dg-dash')
    const midY = y0 + 1.5 * B + H / 2
    const at: Record<Dir, { x: number; y: number; stack: boolean; back: boolean }> = {
      U: { x: cx, y: y0 + B, stack: false, back: false },
      S: { x: cx - A / 2, y: midY, stack: true, back: false },
      E: { x: cx + A / 2, y: midY, stack: true, back: false },
      W: { x: cx - A / 2 - 14, y: y0 + B / 2 - 22, stack: false, back: true },
      N: { x: cx + A / 2 + 14, y: y0 + B / 2 - 22, stack: false, back: true },
      D: { x: cx, y: y0 + 2 * B + H + 19, stack: false, back: true },
    }
    for (const dir of Object.keys(at) as Dir[]) {
      const p = at[dir]
      const k = o.order.indexOf(dir)
      if (k < 0) { out += text(p.x, p.y + 4, d.names[dir], 'dg-s dg-m', 'middle'); continue }
      const cls = p.back ? 'dg-ring' : 'dg-num'
      if (p.stack) out += badge(p.x, p.y - 7, k + 1, cls, 8) + text(p.x, p.y + 14, d.names[dir], 'dg-s', 'middle')
      else out += badge(p.x - 7, p.y, k + 1, cls, 8) + text(p.x + 9, p.y + 4, d.names[dir], 'dg-s', 'middle')
    }
    const seq = wrap(o.order.map(x => d.names[x]).join(' → '), cell - 6, FS_SMALL)
    out += textLines(cx, y0 + 2 * B + H + 36, seq, FS_SMALL, 'dg-m', 'middle')
  })
  let y = y0 + 2 * B + H + 36 + lineHeight(FS_SMALL) * 2 + 8
  for (const note of d.notes ?? []) { out += text(PAD, y + 10, note, 'dg-s dg-m'); y += lineHeight(FS_SMALL) + 1 }
  return svg(y + 4, label, out)
}
