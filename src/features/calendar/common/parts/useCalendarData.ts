// カレンダーの画面（年・月・週・日）が読むデータ（docs/SPEC.md の 6.3・6.5・6.6・6.12）。表示用に直した記録（useData() と同じ
// useApp の data。知らない kind は仕事、空の件名は「（件名なし）」、calendar 生まれで start の無い物は due か作った日。6.12）から、
// カレンダーに出る項目の一覧・休みの日・ラベルの呼び名を作る。表ごとに覚え、その表が変わった時だけ作り直す
// （休みを付けても項目の一覧は作り直さない。カード・行は記録ごとの React.memo なので、変わった記録だけが描き直される。FRAME-284）
import { useMemo } from 'react'
import { calendarItems, offDaySet, type CalItem } from '../../../../domain/calendar'
import type { AppData } from '../../../../domain/types'
import { useApp } from '../../../../store/appStore'

export interface CalendarData {
  /** カレンダーに出る項目と期間（6.3。期間の初めの日 → 作った順） */
  list: CalItem[]
  /** 休みの日（off が true の日付。6.5） */
  off: ReadonlySet<string>
  /** ラベルの呼び名（6.6。付けていない色は無い） */
  labelNames: AppData['labelNames']
}

export function useCalendarData(): CalendarData {
  const items = useApp((s) => s.data.items)
  const offDays = useApp((s) => s.data.offDays)
  const labelNames = useApp((s) => s.data.labelNames)
  const list = useMemo(() => calendarItems(items), [items])
  const off = useMemo(() => offDaySet(offDays), [offDays])
  return useMemo(() => ({ list, off, labelNames }), [list, off, labelNames])
}
