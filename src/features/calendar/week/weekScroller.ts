// ウィークリーのスクロールする要素（docs/SPEC.md の 7.11・10.1〜10.4）。ドラッグ（week/dnd。WP11）が、画面の端に近づいた時の
// 自動のスクロールをウィークリーの中だけに絞るのに使う（dnd-kit の Scroller の getScrollableElements を、この要素の中の物だけにする。
// 絞らないと、週の終わりまでスクロールした後にページ全体が動く。WP11s の G3・G4）。
// - 7日を縦（S）: 週全体を縦にスクロールする要素（日のかたまりが並ぶ所）
// - 7日を横（L・M）: 横にスクロールする要素（領域が 504px より狭い時）。中に、段ごとに縦にスクロールする2つの要素がある
// どちらも WeekView のいちばん外の要素で、data-week-scroller の印も付ける。WeekDnd は WeekView の中で描かれるので、
// useWeekScroller() で受け取れる。
// 落とした先・登録したカードを見える所まで出す時も、ウィークリーの中だけをスクロールする（revealInWeek。ページは動かさない）
import { createContext, useContext, type RefObject } from 'react'
import { scrollBehavior } from '../../../ui/motion'

/** ウィークリーのスクロールする要素（描く前・ウィークリーの外では current が null） */
export const WeekScrollerContext = createContext<RefObject<HTMLElement | null>>({ current: null })

export function useWeekScroller(): RefObject<HTMLElement | null> {
  return useContext(WeekScrollerContext)
}

/** スクロールする要素に付ける印（CSS・E2E で探す時の名前） */
export const WEEK_SCROLLER_ATTR = 'data-week-scroller'

/** [start, end] を見える所 [portStart, portEnd] に入れるのに動かす量（scrollIntoView の nearest と同じ。入らない大きさなら始まりに合わせる） */
function nearestDelta(start: number, end: number, portStart: number, portEnd: number): number {
  if (start < portStart) return start - portStart
  if (end > portEnd) return Math.min(end - portEnd, start - portStart)
  return 0
}

const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max)
const scrolls = (v: string) => v === 'auto' || v === 'scroll'

/**
 * 要素を、ウィークリーの中のスクロール（L・M は段の中と横、S は週の全体）で見える所まで出す（scrollIntoView の block・inline: nearest と
 * 同じ。もう見えている時は動かさない。視差効果を減らす設定ではすぐに）。ウィークリーの外（ページ）はスクロールしない: S で週の下の端が
 * 画面の下の端より少し下にある時に、ページまで数 px 動かさない（WP11s の G4）。落とした先のカード（week/dnd/WeekDnd.tsx）と、
 * 登録した・移ったカードを目立たせる時（WeekCard の useFlashTarget）に使う。
 * 要素の scroll-margin は scrollIntoView と同じく見える所の外に取る（S のカードは上に固定した段の名札の行 24px の下に出す。week.css）
 */
export function revealInWeek(el: Element | null | undefined): void {
  const root = el?.closest(`[${WEEK_SCROLLER_ATTR}]`)
  if (!el || !root) return
  const r = el.getBoundingClientRect()
  const m = getComputedStyle(el)
  const px = (v: string) => parseFloat(v) || 0
  let top = r.top - px(m.scrollMarginTop)
  let bottom = r.bottom + px(m.scrollMarginBottom)
  let left = r.left - px(m.scrollMarginLeft)
  let right = r.right + px(m.scrollMarginRight)
  for (let a = el.parentElement; a; a = a === root ? null : a.parentElement) {
    const cs = getComputedStyle(a)
    const canY = scrolls(cs.overflowY) && a.scrollHeight > a.clientHeight
    const canX = scrolls(cs.overflowX) && a.scrollWidth > a.clientWidth
    if (!canY && !canX) continue
    const port = a.getBoundingClientRect()
    const portTop = port.top + a.clientTop
    const portLeft = port.left + a.clientLeft
    const dy = canY
      ? clamp(
          nearestDelta(top, bottom, portTop, portTop + a.clientHeight),
          -a.scrollTop,
          a.scrollHeight - a.clientHeight - a.scrollTop,
        )
      : 0
    const dx = canX
      ? clamp(
          nearestDelta(left, right, portLeft, portLeft + a.clientWidth),
          -a.scrollLeft,
          a.scrollWidth - a.clientWidth - a.scrollLeft,
        )
      : 0
    if (dy === 0 && dx === 0) continue
    a.scrollTo({
      ...(dy !== 0 ? { top: a.scrollTop + dy } : {}),
      ...(dx !== 0 ? { left: a.scrollLeft + dx } : {}),
      behavior: scrollBehavior(),
    })
    top -= dy
    bottom -= dy
    left -= dx
    right -= dx
  }
}
