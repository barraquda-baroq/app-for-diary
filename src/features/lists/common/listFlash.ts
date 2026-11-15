// 3つのリストの目立たせる所（docs/SPEC.md の 4.9・13.2・14.2・15.1。開発・P12）。カレンダーと同じ仕組み（useCalendarUi の flash と
// calendar/common/parts/useFlashTarget）に、リストのキーを足した物: 足した行・済みへ移った行・済みへ移った時の「済み n件」の区切りを
// 1.2秒の 2px の --accent の枠で目立たせる。目立たせられる側（common/ListRow・DoneSection）は、L は右の列（.top-side）の中だけで
// スクロールして見える所まで出す（scrollIntoViewWithin。ページは動かさない）。S・M はページがスクロールするので動かさず、見えていれば
// 目立つ（足した後も入力欄をキーボードの上から動かさない。開発）
import type { ID } from '../../../domain/types'
import { useCalendarUi, type ListKey, type RoutineCycle } from '../../../store/uiStore'

/** 目立たせる所のキー（目立たせる側・目立たせられる側が同じ物を使う） */
export const listFlashKey = {
  /** その行（list:{リスト}:{id}） */
  row: (list: ListKey, id: ID) => `list:${list}:${id}`,
  /** Task List・Favorite List の「済み n件」の区切り（list:{リスト}:done） */
  done: (list: 'task' | 'favorite') => `list:${list}:done`,
  /** Routine List のその種類の「済み n件」の区切り（list:routine:done:{種類}） */
  routineDone: (cycle: RoutineCycle) => `list:routine:done:${cycle}`,
} as const

/** その行（と、いっしょに目立たせる物）を目立たせる。足した後・済みにした後に呼ぶ（行は描き直した後に見つかれば目立つ） */
export function flashList(...keys: string[]): void {
  useCalendarUi.getState().flashTarget(...keys)
}
