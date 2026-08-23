import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode, WheelEvent } from 'react'

/**
 * 横に長い 1 行を、PC からも確実に端まで動かせるようにする器 (#333 → #338)。
 *
 * `overflow-x: auto` だけだと**タッチでしか動かせない**。PC にはホイールの縦回転しか
 * 入力が無く、縦にはみ出していないパレットや操作パネルではブラウザ既定では何も起きない。
 * さらにスクロールバーを消していると掴む場所も無くなる。
 *
 * 用意するのは 4 つ:
 *   - ホイールの縦回転 → 横スクロール
 *   - 両端の ◀ ▶ (1 画面ずつ送る。端に着いたら無効化)
 *   - 細いスクロールバーを常時表示 (`.mc-hotbar-scroller`)
 *   - タッチのスワイプは `overflow-x: auto` のままなので従来どおり
 *
 * **同じ実装を各所に書かない**ためにここへ集めた。ホットバー (#333) を直したときに
 * 操作パネル 2 か所が取り残され、同じ報告が 2 度来た (#338)。
 */
export interface HScrollRowProps {
  /**
   * data-testid の接頭辞。`{id}-scroller` / `{id}-scroll-left` / `{id}-scroll-right` になる。
   *
   * **既存の testid と前方一致しない名前を選ぶこと**。操作パネルを `trigger-panel` にしたとき、
   * 個々のトリガー `trigger-{x}-{y}-{z}` を正規表現 `/^trigger-/` で引いていたテストが
   * **パネル自身を掴んでレバーを押せなくなった** (#338)
   */
  id: string
  /** スクロール領域そのものに当てる class / style (背景・枠はここ) */
  className?: string
  style?: CSSProperties
  /** ◀ ▶ を含む外枠 */
  outerClassName?: string
  outerStyle?: CSSProperties
  /**
   * 収まるときだけ中央寄せするか (ホットバー用)。
   * **はみ出すときは必ず左寄せに戻す** — 中央寄せのまま溢れると左右に均等にあふれ、
   * 左端がスクロールしても届かなくなる
   */
  centerWhenFits?: boolean
  /** ◀ ▶ の高さ。行の高さに合わせる */
  arrowHeight?: number
  /**
   * これが変わったとき、該当要素を見える位置へ寄せる (CSS セレクタ)。
   * 選択中の項目が見切れていると、どれを選んでいるのか分からなくなるため
   */
  scrollIntoView?: string
  children: ReactNode
}

export function HScrollRow({
  id, className, style, outerClassName, outerStyle,
  centerWhenFits = false, arrowHeight = 40, scrollIntoView, children,
}: HScrollRowProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [edge, setEdge] = useState({ overflow: false, atStart: true, atEnd: false })

  const syncEdge = useCallback(() => {
    const el = ref.current
    if (!el) return
    // 小数の丸めでいつまでも「端でない」と判定されるのを防ぐ (1px の余裕)
    const max = el.scrollWidth - el.clientWidth
    setEdge({ overflow: max > 1, atStart: el.scrollLeft <= 1, atEnd: el.scrollLeft >= max - 1 })
  }, [])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    syncEdge()
    // ウィンドウ幅でも中身の増減でも溢れるかが変わる。要素自身の寸法変化を見る
    const ro = new ResizeObserver(syncEdge)
    ro.observe(el)
    for (const child of Array.from(el.children)) ro.observe(child)
    return () => ro.disconnect()
  }, [syncEdge, children])

  /**
   * ホイールの縦回転を横スクロールにする。
   *
   * 横成分 (`deltaX`) を持つ入力 (トラックパッドの横スワイプ・Shift + ホイール) は
   * ブラウザに任せる — 奪うと慣性や加速度が消える
   */
  const handleWheel = useCallback((e: WheelEvent<HTMLDivElement>) => {
    const el = ref.current
    if (!el || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return
    if (el.scrollWidth - el.clientWidth <= 1) return
    el.scrollLeft += e.deltaY
    syncEdge()
  }, [syncEdge])

  /** 1 画面ぶん送る。端が半端に切れないよう少し重ねる */
  const page = useCallback((dir: -1 | 1) => {
    const el = ref.current
    if (!el) return
    el.scrollBy({ left: dir * Math.max(120, el.clientWidth - 80), behavior: 'smooth' })
  }, [])

  useEffect(() => {
    if (!scrollIntoView) return
    ref.current?.querySelector(scrollIntoView)
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
  }, [scrollIntoView])

  const arrow = (disabled: boolean): CSSProperties => ({
    width: 22, height: arrowHeight, fontSize: 13, lineHeight: 1, padding: 0,
    opacity: disabled ? 0.3 : 1,
    cursor: disabled ? 'default' : 'pointer',
  })

  return (
    <div className={`shrink-0 flex items-center gap-1 ${outerClassName ?? ''}`} style={outerStyle}>
      {edge.overflow && (
        <button onClick={() => page(-1)} disabled={edge.atStart} title="左へ"
                data-testid={`${id}-scroll-left`}
                className="mc-btn shrink-0 font-pixel" style={arrow(edge.atStart)}>◀</button>
      )}
      <div ref={ref} onScroll={syncEdge} onWheel={handleWheel}
           data-testid={`${id}-scroller`}
           className={`mc-hotbar-scroller overflow-x-auto ${className ?? ''}`}
           style={{
             ...style,
             // はみ出すときだけ伸ばす。収まるときは中身の幅のまま (中央寄せを保つ)
             ...(edge.overflow || !centerWhenFits ? { flex: '1 1 auto', minWidth: 0 } : {}),
           }}>
        {children}
      </div>
      {edge.overflow && (
        <button onClick={() => page(1)} disabled={edge.atEnd} title="右へ"
                data-testid={`${id}-scroll-right`}
                className="mc-btn shrink-0 font-pixel" style={arrow(edge.atEnd)}>▶</button>
      )}
    </div>
  )
}
