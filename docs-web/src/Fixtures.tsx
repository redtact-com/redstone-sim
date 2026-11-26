import { useEffect, useLayoutEffect, useState } from 'react'
import type { ComponentType, RefObject } from 'react'
import { createPortal } from 'react-dom'
import { FIXTURE_CLOSE_LABEL, FIXTURE_OPEN_LABEL } from '@redstone/docs-kit'
import type { FixtureInfo } from '@redstone/docs-kit'
import type { FixtureViewerProps } from '@redstone/docs-kit/viewer'
import type { Fixture } from '@redstone/sim'
import { loadFixture, loadViewer } from './data'
import { RESOURCEPACK_URL } from './paths'

/** 同時に生かすビューアの数。3 個目を開くと、一番古い物が札に戻る (WebGL の文脈を溜めない) */
export const MAX_OPEN_VIEWERS = 2

/** 開いている札 1 枚 */
interface OpenCard {
  /** 札ごとの通し番号 (同じ fixture の札がページに 2 枚あっても別に数える) */
  key: number
  name: string
  card: HTMLElement
  /** ビューアを付ける置き場 (`.fx-view`) */
  slot: HTMLElement
}

let nextKey = 1

/**
 * 本文の中の fixture の札を動かす (#434)。
 *
 * 札はビルド時に作った**ただの HTML** で、ここは押された時の処理だけを持つ:
 * - 「表示」を押した札の置き場へビューアを付ける。ビューアのチャンクと fixture の JSON は、その時に初めて取る
 * - 同時に生かすのは 2 個まで。3 個目を開くと一番古い物を外す
 * - 本文のチップ (`[実機 …]`) を押すと、その fixture の札へ寄せる
 *
 * ページを移ると本文ごと作り直されるので、開いていた物は全部外れる。
 */
export function FixtureCards({ root, fixtures }: {
  root: RefObject<HTMLElement | null>
  fixtures: Record<string, FixtureInfo>
}) {
  const [open, setOpen] = useState<OpenCard[]>([])

  useEffect(() => {
    const el = root.current
    if (!el) return
    const onClick = (e: MouseEvent) => {
      const target = e.target as Element
      const button = target.closest?.('[data-fx-open]')
      if (button && el.contains(button)) {
        const card = button.closest<HTMLElement>('.fx-card')
        const slot = card?.querySelector<HTMLElement>('.fx-view')
        const name = button.getAttribute('data-fx-open')
        if (!card || !slot || !name) return
        setOpen(list => list.some(o => o.card === card)
          ? list.filter(o => o.card !== card)
          : [...list, { key: nextKey++, name, card, slot }].slice(-MAX_OPEN_VIEWERS))
        return
      }
      const chip = target.closest?.('.mk[data-fx]')
      if (chip && el.contains(chip)) revealCard(chip)
    }
    el.addEventListener('click', onClick)
    return () => el.removeEventListener('click', onClick)
  }, [root])

  // 開閉を札の HTML に写す (ボタンの字・置き場の高さ)。ビューアが大きさを測る前に済ませる
  useLayoutEffect(() => {
    const el = root.current
    if (!el) return
    const opened = new Set(open.map(o => o.card))
    for (const card of el.querySelectorAll<HTMLElement>('.fx-card')) {
      const on = opened.has(card)
      const button = card.querySelector('.fx-open')
      const slot = card.querySelector<HTMLElement>('.fx-view')
      if (!button || !slot) continue
      if (on) card.setAttribute('data-open', '1')
      else card.removeAttribute('data-open')
      button.setAttribute('aria-expanded', on ? 'true' : 'false')
      button.textContent = on ? FIXTURE_CLOSE_LABEL : FIXTURE_OPEN_LABEL
      slot.hidden = !on
    }
  }, [open, root])

  return <>{open.map(o => createPortal(<FixtureSlot name={o.name} info={fixtures[o.name]} />, o.slot, String(o.key)))}</>
}

/** チップを押した時: 後ろにある、その fixture の札を見える所へ寄せる (折りたたみの中なら開く) */
function revealCard(chip: Element): void {
  const names = (chip.getAttribute('data-fx') ?? '').split(' ').filter(Boolean)
  const all = [...document.querySelectorAll<HTMLElement>('.fx-card')]
  const card = all.find(c =>
    names.includes(c.getAttribute('data-fx-card') ?? '')
    && (chip.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0)
  if (!card) return
  const fold = card.closest('details')
  if (fold) fold.open = true
  card.scrollIntoView({ block: 'nearest' })
  card.classList.add('fx-hit')
  window.setTimeout(() => card.classList.remove('fx-hit'), 1200)
}

type Loaded =
  | { state: 'loading' }
  | { state: 'ready'; Viewer: ComponentType<FixtureViewerProps>; fixture: Fixture }
  | { state: 'error'; message: string }

/** 開いた札の中身。ビューアのチャンクと fixture を取ってから描く */
function FixtureSlot({ name, info }: { name: string; info: FixtureInfo | undefined }) {
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let alive = true
    setLoaded({ state: 'loading' })
    Promise.all([loadViewer(), loadFixture(name)]).then(
      ([m, fixture]) => { if (alive) setLoaded({ state: 'ready', Viewer: m.FixtureViewer, fixture }) },
      e => { if (alive) setLoaded({ state: 'error', message: String(e instanceof Error ? e.message : e) }) },
    )
    return () => { alive = false }
  }, [name, attempt])
  if (loaded.state === 'loading') return <p className="loading fx-loading">ビューアを読み込み中…</p>
  if (loaded.state === 'error') {
    return (
      <p className="notice notice-err" role="alert">
        ビューアを取れなかった ({loaded.message})。<button type="button" onClick={() => setAttempt(n => n + 1)}>もう一度</button>
      </p>
    )
  }
  const { Viewer, fixture } = loaded
  return <Viewer fixture={fixture} resourcePackUrl={RESOURCEPACK_URL} skip={info?.skip} entities={info?.entities} />
}
