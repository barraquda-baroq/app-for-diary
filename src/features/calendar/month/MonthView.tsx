// マンスリー（docs/SPEC.md の 9.・7.1〜7.4・7.6・7.12）。月の予定の量を数字だけで見る画面（線と●は出さない。7.8）。
// - いちばん上に曜日の行（SUN〜SAT。丸いラベルにしない）、その下に 7列 × その月に掛かる週の数（4〜6行）のマス目。
//   L は領域の高さを行の数で分け（88px 以上）、M は 88px、S は 56px 以上の行（D15）
// - マスの中身は monthModel.ts が決め（日付・今日の丸・「休」・祝日名・件数・読み上げ）、マス（MonthCell）はそれを描くだけ
// - 押した時（7.12・9.3）: L・M の数字はその区分を目立たせてデイリーへ、マスのほかの所はデイリーへ（目立たせない）。S はマスの
//   どこを押してもデイリーへ（目立たせない。D32）。前後の月の日はその月のマンスリーへ
// - 休みを付ける状態（9.5。［休み］で入る・終わる。状態は useCalendarUi の offMode）: 操作の列の下に帯、マスの枠を点線にし、
//   どのマスを押しても（数字・前後の月の日も）その日の休みが付いたり外れたりする。［休み］をもう一度・［終わる］・Esc で終わる。
//   ‹ ›・今日・スワイプ・［＋ 登録］では続き、マンスリーを離れると終わる（モードの切り替え・「戻る」・MIM・設定など、マンスリーを
//   離れた時に終えるのは src/features/top/TopPage.tsx の useEndOffMode と useCalendarNav。ここでは終えない。D30）
import { useCallback, useMemo } from 'react'
import { parseYmd, todayYmd, WEEKDAYS_EN } from '../../../domain/dates'
import type { ItemKind } from '../../../domain/types'
import { actions } from '../../../store/actions'
import { attempt, useCalendarUi } from '../../../store/uiStore'
import { cls, useCalendarData } from '../common/parts'
import { testIds } from '../common/testIds'
import type { ViewProps } from '../common/types'
import { useCalendarNav } from '../common/useCalendarRoute'
import { MonthCell } from './MonthCell'
import { buildMonth, type MonthCellVM } from './monthModel'
import { OffModeBanner } from './OffModeBanner'
import './month.css'

export function MonthView({ viewed, today, width }: ViewProps) {
  const v = parseYmd(viewed) ?? todayYmd()
  const { list, off } = useCalendarData()
  const weeks = useMemo(() => buildMonth({ y: v.y, m: v.m }, list, off, today, width), [v.y, v.m, list, off, today, width])
  const offMode = useCalendarUi((s) => s.offMode)
  const setOffMode = useCalendarUi((s) => s.setOffMode)
  const nav = useCalendarNav()
  const compact = width === 'S'

  const onCell = useCallback(
    (c: MonthCellVM) => {
      if (useCalendarUi.getState().offMode) {
        attempt(() => actions.setOffDay(c.date, !c.off))
        return
      }
      if (c.outside) nav.openMonth(c.date)
      else nav.openDay(c.date)
    },
    [nav],
  )
  const onCount = useCallback((date: string, kind: ItemKind) => nav.openDay(date, kind), [nav])

  return (
    <div className="mo" data-testid={testIds.view('month')}>
      {offMode && <OffModeBanner onEnd={() => setOffMode(false)} />}
      <div
        className={cls('mo-month', compact && 'is-compact', offMode && 'is-off')}
        data-testid={testIds.calendarMonth}
        data-rows={weeks.length}
      >
        <div className="mo-head" aria-hidden="true">
          {WEEKDAYS_EN.map((w, i) => (
            <span key={w} className="caps mo-weekday" data-tone={i === 0 ? 'sun' : i === 6 ? 'sat' : undefined}>
              {w}
            </span>
          ))}
        </div>
        <div className="mo-grid">
          {weeks.flat().map((c) => (
            <MonthCell key={c.date} cell={c} compact={compact} offMode={offMode} onCell={onCell} onCount={onCount} />
          ))}
        </div>
      </div>
    </div>
  )
}
