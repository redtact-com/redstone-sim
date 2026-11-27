import { DIAGRAM_WIDTH, FS, FS_SMALL, arrow, badge, lineHeight, rect, svg, text, textLines, wrap } from './svg.js'

/** 手順 1 つ (箱 1 つ) */
export interface FlowStep {
  text: string
  /** 箱の中の小さな手順。`3.1`・`3.2` と番号を振る */
  sub?: string[]
  /** 横へ抜ける分岐 (1 段だけ)。`when` の時に `text` で終わる */
  out?: { when: string; text: string }
  hi?: boolean
}

export interface StepFlowData {
  steps: FlowStep[]
  /** 図の下の注記 */
  notes?: string[]
}

const PAD = 8
const GAP = 16
const BRANCH_GAP = 100
const BRANCH_W = 170

/**
 * 手順の流れ。上から下へ箱を矢印でつなぎ、分岐は右へ 1 段だけ出す。番号は上から 1, 2, … と振る。
 */
export function stepFlowSvg(d: StepFlowData, label = '手順の流れ'): string {
  const branch = d.steps.some(s => s.out)
  const mainW = branch ? DIAGRAM_WIDTH - PAD * 2 - BRANCH_GAP - BRANCH_W : DIAGRAM_WIDTH - PAD * 2
  const tx = PAD + 34
  const textW = mainW - 34 - 10
  const lh = lineHeight(FS), sh = lineHeight(FS_SMALL)
  let out = ''
  let y = 6
  d.steps.forEach((s, i) => {
    const lines = wrap(s.text, textW, FS)
    const subs = (s.sub ?? []).map((t, j) => wrap(`${i + 1}.${j + 1}  ${t}`, textW - 12, FS_SMALL))
    const subH = subs.reduce((n, ls) => n + ls.length * sh + 3, 0)
    const outLines = s.out ? wrap(s.out.text, BRANCH_W - 16, FS_SMALL) : []
    const h = Math.max(16 + lines.length * lh + (subH ? subH + 3 : 0), outLines.length * sh + 14, 34)
    if (i > 0) out += arrow([[PAD + 20, y - GAP], [PAD + 20, y]])
    out += rect(PAD, y, mainW, h, s.hi ? 'dg-hi' : 'dg-box')
    out += badge(PAD + 18, y + 8 + lh / 2, i + 1)
    out += textLines(tx, y + 8, lines, FS)
    let sy = y + 8 + lines.length * lh + 3
    for (const ls of subs) { out += textLines(tx + 12, sy, ls, FS_SMALL, 'dg-m'); sy += ls.length * sh + 3 }
    if (s.out) {
      const my = y + h / 2
      const bx = PAD + mainW + BRANCH_GAP
      out += arrow([[PAD + mainW, my], [bx, my]])
      const when = wrap(s.out.when, BRANCH_GAP - 14, FS_SMALL)
      out += textLines(PAD + mainW + BRANCH_GAP / 2 - 3, my - 5 - when.length * sh, when, FS_SMALL, 'dg-acc dg-b', 'middle')
      const bh = outLines.length * sh + 12
      out += rect(bx, my - bh / 2, BRANCH_W, bh, 'dg-out')
      out += textLines(bx + 8, my - bh / 2 + 6, outLines, FS_SMALL)
    }
    y += h + GAP
  })
  y -= GAP - 6
  for (const note of d.notes ?? []) {
    for (const l of wrap(note, DIAGRAM_WIDTH - PAD * 2, FS_SMALL)) { out += text(PAD, y + 10, l, 'dg-s dg-m'); y += sh }
    y += 2
  }
  return svg(y + 4, label, out)
}
