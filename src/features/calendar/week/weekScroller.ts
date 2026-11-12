// ウィークリーのスクロールする要素（docs/SPEC.md の 7.11・10.1〜10.4）。ドラッグ（week/dnd。WP11）が、画面の端に近づいた時の
// 自動のスクロールをウィークリーの中だけに絞るのに使う（dnd-kit の Scroller の getScrollableElements を、この要素の中の物だけにする。
// 絞らないと、週の終わりまでスクロールした後にページ全体が動く。WP11s の G3・G4）。
// - 7日を縦（S）: 週全体を縦にスクロールする要素（日のかたまりが並ぶ所）
// - 7日を横（L・M）: 横にスクロールする要素（領域が 504px より狭い時）。中に、段ごとに縦にスクロールする2つの要素がある
// どちらも WeekView のいちばん外の要素で、data-week-scroller の印も付ける。WeekDnd は WeekView の中で描かれるので、
// useWeekScroller() で受け取れる
import { createContext, useContext, type RefObject } from 'react'

/** ウィークリーのスクロールする要素（描く前・ウィークリーの外では current が null） */
export const WeekScrollerContext = createContext<RefObject<HTMLElement | null>>({ current: null })

export function useWeekScroller(): RefObject<HTMLElement | null> {
  return useContext(WeekScrollerContext)
}

/** スクロールする要素に付ける印（CSS・E2E で探す時の名前） */
export const WEEK_SCROLLER_ATTR = 'data-week-scroller'
