// ウィークリー（docs/SPEC.md の 10.。日曜〜土曜の7日の予定をカードで並べて動かす画面）。並べ方は幅の区分で決め、L・M は7日を横
// （WeekHorizontal）、S は7日を縦（WeekVertical）（10.1。カレンダーの領域の幅では決めない）。領域の幅は、7日を横の列の幅
// （見出しを2行にするか・始点のカードの期間が入るか）と、7日を縦の半分の幅だけに使う（D53）。
// データは useCalendarData() の一覧から weekModel.ts の buildWeek で週の形を作る（表が変わった時だけ作り直す）。カード・●・＞は
// 記録ごとの React.memo。ドラッグは week/dnd（WeekDnd・useItemDrag・useDayDrop）。
// スクロールする要素は WeekScrollerContext で WeekDnd に渡す（自動のスクロールをウィークリーの中だけにする。weekScroller.ts）。
// 見出し → デイリー・休みのチェック・「＋」→ すばやく足すは useWeekActions（weekActions.ts）。S・M の指で横になぞると前後の週へ
// （ほかのモードと同じ。22. の段階2の終わりの確かめ。画面の枠 common/CalendarView の useSwipe。カードは長押ししてから動かすと掴み、
// すぐ横へ払うとなぞる。すばやく足すで文字を打っている間・ドラッグ中はなぞっても移らない）
import { useMemo, useRef } from 'react'
import { weekStartOf } from '../../../domain/dates'
import { useCalendarData } from '../common/parts'
import type { ViewProps } from '../common/types'
import { WeekDnd, type WeekCtx } from './dnd'
import { useWeekActions } from './weekActions'
import { WeekHorizontal } from './WeekHorizontal'
import { buildWeek, weekColumnPx, weekHalfPx } from './weekModel'
import { WeekScrollerContext } from './weekScroller'
import { WeekVertical } from './WeekVertical'
import './week.css'

export function WeekView({ viewed, today, width, area }: ViewProps) {
  const sunday = weekStartOf(viewed)
  const { list, off } = useCalendarData()
  const model = useMemo(() => buildWeek(sunday, list, off, today), [sunday, list, off, today])
  const week = useMemo<WeekCtx>(() => ({ from: model.sunday, to: model.saturday }), [model.sunday, model.saturday])
  const scroller = useRef<HTMLDivElement>(null)
  const actions = useWeekActions(model.sunday)
  return (
    <WeekScrollerContext.Provider value={scroller}>
      <WeekDnd week={week}>
        {width === 'S' ? (
          <WeekVertical
            model={model}
            today={today}
            week={week}
            halfPx={weekHalfPx(area.width)}
            actions={actions}
            scroller={scroller}
          />
        ) : (
          <WeekHorizontal
            model={model}
            today={today}
            week={week}
            columnPx={weekColumnPx(area.width)}
            actions={actions}
            scroller={scroller}
          />
        )}
      </WeekDnd>
    </WeekScrollerContext.Provider>
  )
}
