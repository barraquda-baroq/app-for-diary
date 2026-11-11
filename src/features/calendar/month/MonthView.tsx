// マンスリー（docs/SPEC.md の 9.）。中身（予定の数・休み・祝日・押した時。WP6）ができるまでの仮の画面: 段階0の空のマス目
// （日付と今日の丸だけ。段階0の MonthPlaceholder（WP4 で消した src/features/top/CalendarArea.tsx）と同じ形・同じクラス。
// CSS は src/features/top/top.css）をそのまま出す。
// 受け取る物（ViewProps）は最後の形
import { monthWeeks, parseYmd, sameDay, todayYmd, WEEKDAYS_EN } from '../../../domain/dates'
import { testIds } from '../common/testIds'
import type { ViewProps } from '../common/types'

export function MonthView({ viewed, today, width }: ViewProps) {
  const v = parseYmd(viewed) ?? todayYmd()
  const t = parseYmd(today)
  const weeks = monthWeeks(v.y, v.m)
  return (
    // 段階0のマス目の並べ方を変えないよう、包みの箱は置かない（display: contents）
    <div data-testid={testIds.view('month')} style={{ display: 'contents' }}>
      <div className={`cal-month${width === 'S' ? ' is-compact' : ''}`} data-testid="calendar-month" data-rows={weeks.length}>
        <p className="cal-stage-note">予定の数・休み・祝日は段階2で出します</p>
        <div className="cal-month-head" aria-hidden="true">
          {WEEKDAYS_EN.map((w, i) => (
            <span key={w} className={`caps cal-weekday${i === 0 ? ' is-sun' : i === 6 ? ' is-sat' : ''}`}>
              {w}
            </span>
          ))}
        </div>
        <div className="cal-month-grid" aria-hidden="true">
          {weeks.flat().map(({ date, outside }, i) => {
            const wd = i % 7
            const tone = outside ? ' is-outside' : wd === 0 ? ' is-sun' : wd === 6 ? ' is-sat' : ''
            const isToday = !outside && t !== null && sameDay(date, t)
            return (
              <div key={`${date.m}-${date.d}`} className={`cal-cell${tone}`}>
                <span className={`mono cal-date${isToday ? ' today-mark is-today' : ''}`}>{date.d}</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
