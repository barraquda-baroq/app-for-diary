// 今見ている週のスクロールする要素（docs/SPEC.md の 7.11・10.1〜10.4）。ドラッグ（week/dnd の edgeDriver.ts）が、掴んでいる間の
// 画面の端を測るのに使う: 上下の端の自動のスクロールはこの要素の中（S は週、L・M は中の段）だけを動かし（ページは動かさない。
// WP11s の G3・G4）、左右の端の帯はこの要素の見えている所の左右の端から測る。掴んだまま別の週へ移った間は、今の週の要素を指す
// （見えないまま残す掴んだ週の要素は指さない）。
// - 7日を縦（S）: 週全体を縦にスクロールする要素（日のかたまりが並ぶ所）
// - 7日を横（L・M）: 横にスクロールする要素（領域が 504px より狭い時）。中に、段ごとに縦にスクロールする2つの要素がある
// どちらも WeekView のいちばん外の要素で、data-week-scroller の印も付ける（DOM で見分ける時の印。今は単体テストが見るだけで、
// ドラッグは印ではなく WeekScrollerContext の ref を使う）。WeekDnd は WeekView の中で描かれるので、useWeekScroller() で受け取れる
import { createContext, useContext, type RefObject } from 'react'

/** ウィークリーのスクロールする要素（描く前・ウィークリーの外では current が null） */
export const WeekScrollerContext = createContext<RefObject<HTMLElement | null>>({ current: null })

export function useWeekScroller(): RefObject<HTMLElement | null> {
  return useContext(WeekScrollerContext)
}
