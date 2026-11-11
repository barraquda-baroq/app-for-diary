// ウィークリー（docs/SPEC.md の 10.。日曜〜土曜の7日の予定をカードで並べて動かす画面）。並べ方は幅の区分で決め、L・M は7日を横
// （WeekHorizontal）、S は7日を縦（WeekVertical）（10.1。カレンダーの領域の幅では決めない）。領域の幅は、7日を横の列の幅
// （見出しを2行にするか・始点のカードの期間が入るか）と、7日を縦の半分の幅だけに使う（D53）。
// データは useCalendarData() の一覧から weekModel.ts の buildWeek で週の形を作る（表が変わった時だけ作り直す）。カード・●・＞は
// 記録ごとの React.memo。ドラッグ（WeekDnd・useItemDrag・useDayDrop。week/dnd）は WP11 が中身を作るまで何もしない。
// スクロールする要素は WeekScrollerContext で WeekDnd に渡す（自動のスクロールをウィークリーの中だけにする。weekScroller.ts）
import { useMemo, useRef } from 'react'
import { weekStartOf } from '../../../domain/dates'
import { useCalendarData } from '../common/parts'
import type { ViewProps } from '../common/types'
import { WeekDnd, type WeekCtx } from './dnd'
import type { WeekActions } from './weekActions'
import { WeekHorizontal } from './WeekHorizontal'
import { buildWeek, weekColumnPx, weekHalfPx } from './weekModel'
import { WeekScrollerContext } from './weekScroller'
import { WeekVertical } from './WeekVertical'
import './week.css'

/**
 * 日付の見出し → デイリー・休みのチェック・「＋」→ すばやく足すは、段階2の後半（WP7B）でつなぐ（それまでは押しても変わらない）。
 * 予定を押すと詳細が開くのは、カード・始点のカード・受けた表示・●・＞が自分でする
 */
const ACTIONS: WeekActions = {}

export function WeekView({ viewed, today, width, area }: ViewProps) {
  const sunday = weekStartOf(viewed)
  const { list, off } = useCalendarData()
  const model = useMemo(() => buildWeek(sunday, list, off, today), [sunday, list, off, today])
  const week = useMemo<WeekCtx>(() => ({ from: model.sunday, to: model.saturday }), [model.sunday, model.saturday])
  const scroller = useRef<HTMLDivElement>(null)
  return (
    <WeekScrollerContext.Provider value={scroller}>
      <WeekDnd week={week}>
        {width === 'S' ? (
          <WeekVertical
            model={model}
            today={today}
            week={week}
            halfPx={weekHalfPx(area.width)}
            actions={ACTIONS}
            scroller={scroller}
          />
        ) : (
          <WeekHorizontal
            model={model}
            today={today}
            week={week}
            columnPx={weekColumnPx(area.width)}
            actions={ACTIONS}
            scroller={scroller}
          />
        )}
      </WeekDnd>
    </WeekScrollerContext.Provider>
  )
}
