// カレンダーの領域（docs/SPEC.md の 3.4・3.5・3.7・8.〜11.）: いちばん上に操作の列、その下にモードの画面。
// モード・期間・見ている日は行き先から決め（useCalendarRoute。正しくない行き先は描く前に置き換える）、モードの画面には
// ViewProps（モード・見ている日・今日・幅の区分・領域の大きさ）を渡す。領域の大きさは ResizeObserver で1か所だけで測る
// （イヤーの 870px・ウィークリーの列の 120px は CSS の幅の区分とは別に、領域の幅で決める。D53）。
// 高さ: L はカレンダーの領域の中だけでスクロール（ページはスクロールしない）。S・M のイヤー・マンスリーは中身の高さ、
// ウィークリー・デイリーは 100dvh − ヘッダー − 切り替えの列 に固定（操作の列を含む。is-fixed。src/features/top/top.css。D15）。
// S・M の指で左右になぞると前後の期間へ（どのモードでも。useSwipe）。なぞりを聞くのは、この区切りの全部（操作の列とモードの画面）と、
// 左右の画面の端までの余白（frame.css の .cal.is-swipe）。モードはそのままで期間が替わると、ページをめくる（PageTurn。
// モードの画面を包まず、.cal-body の横に置く）。
// iPhone の画面のいちばん端からのフリック（ブラウザの「戻る」「進む」の身振り。ページには来ず、アプリの履歴に popstate だけが来る）では、
// モードを円環で1つ回す（src/history/appHistory.ts から nav.ring を呼ぶ。3.1）。開いているすばやく足すは、モードのボタンを押した時と
// 同じく、字があれば足してから閉じる（12.1）
import { useEffect, useMemo, useRef, type ComponentType } from 'react'
import { setHistoryHandler } from '../../../history/appHistory'
import { useCalendarUi } from '../../../store/uiStore'
import { useElementSize } from '../../../ui/hooks'
import { DayView } from '../day/DayView'
import { MonthView } from '../month/MonthView'
import { WeekView } from '../week/WeekView'
import { YearView } from '../year/YearView'
import { CalendarToolbar } from './CalendarToolbar'
import { PageTurn } from './PageTurn'
import { quickAddModeChanging } from './parts/QuickAdd'
import { useItemSheets } from './sheets'
import { swipeEnabled } from './swipe'
import { testIds } from './testIds'
import type { CalendarMode, ViewProps, WidthClass } from './types'
import { useCalendarNav, useCalendarRoute } from './useCalendarRoute'
import { useSwipe } from './useSwipe'

/** モードごとの画面 */
const VIEWS: Record<CalendarMode, ComponentType<ViewProps>> = {
  year: YearView,
  month: MonthView,
  week: WeekView,
  day: DayView,
}

/** S・M で高さを固定するモード（中だけでスクロール。3.5） */
const FIXED: readonly CalendarMode[] = ['week', 'day']

export function CalendarView({ width, headingId }: { width: WidthClass; headingId?: string }) {
  const { mode, viewed, from, to, today } = useCalendarRoute()
  const nav = useCalendarNav()
  const { openRegister } = useItemSheets()
  const offMode = useCalendarUi((s) => s.offMode)
  const setOffMode = useCalendarUi((s) => s.setOffMode)
  const root = useRef<HTMLDivElement>(null)
  const body = useRef<HTMLDivElement>(null)
  const size = useElementSize(body)
  const area = useMemo(() => ({ width: size.width, height: size.height }), [size.width, size.height])
  const swipe = swipeEnabled(mode, width)
  useSwipe(root, swipe, nav.shift)
  // 端からのフリックでモードを回す（カレンダーを出している間だけ）。すばやく足すは先に閉じる（モードのボタンを押した時と同じ）
  useEffect(
    () =>
      setHistoryHandler('ring', (dir) => {
        quickAddModeChanging()
        nav.ring(dir)
      }),
    [nav],
  )

  const View = VIEWS[mode]
  const fixed = width !== 'L' && FIXED.includes(mode)
  return (
    <div
      ref={root}
      className={`cal${fixed ? ' is-fixed' : ''}${swipe ? ' is-swipe' : ''}`}
      data-mode={mode}
      data-testid={testIds.calendar}
    >
      <CalendarToolbar
        mode={mode}
        viewed={viewed}
        headingId={headingId}
        offMode={offMode}
        onMode={nav.goMode}
        onShift={nav.shift}
        onToday={nav.goToday}
        onOff={() => setOffMode(!offMode)}
        // デイリーではその日、ほかは今日が開始日（3.7・12.2）。区分は仕事（D50）
        onAdd={() => openRegister({ start: mode === 'day' ? viewed : today, kind: 'work' })}
      />
      <div ref={body} className="cal-body" data-testid={testIds.calendarBody}>
        <View mode={mode} viewed={viewed} today={today} width={width} area={area} />
      </div>
      <PageTurn mode={mode} from={from} to={to} body={body} />
    </div>
  )
}
