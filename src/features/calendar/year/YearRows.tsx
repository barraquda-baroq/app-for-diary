// イヤーの「月を行・日を列」（docs/SPEC.md の 8.2。カレンダーの領域の幅が 870px 以上）。
// 12行（1月〜12月）× 31列（1〜31日）。各行の左に月の見出しの帯（幅 64px。「NOV」と「2026」。今月は今日の印。押すとその月の1日を
// 見ている日にしてマンスリーへ。8.4）、その右に日のマス（幅は（領域の幅 − 64px − すき間）÷ 31。CSS の 1fr で割る）。
// その月に無い日（2月30日など）は何も描かない（線も無し）
import { cls } from '../common/parts'
import { testIds } from '../common/testIds'
import { YearCell } from './YearCell'
import type { DotsRow, YearMonthVM } from './yearModel'
import './year.css'

export interface YearRowsProps {
  y: number
  months: YearMonthVM[]
  /** ●の段（マスの幅で決める。D28） */
  dots: DotsRow
  /** Tab で止まる日 */
  tabDate: string
  onCell: (date: string) => void
  onMonth: (first: string) => void
  onFocusCell: (date: string) => void
}

export function YearRows({ y, months, dots, tabDate, onCell, onMonth, onFocusCell }: YearRowsProps) {
  return (
    <div className="yr-rows" data-dots={dots}>
      {months.map((mo) => (
        <div key={mo.m} className="yr-row" role="group" aria-label={`${y}年${mo.m}月`}>
          <button
            type="button"
            className={cls('yr-band', mo.isThisMonth && 'today-mark is-this-month')}
            data-testid={testIds.yearMonth(mo.m)}
            aria-label={mo.label}
            aria-current={mo.isThisMonth ? 'date' : undefined}
            onClick={() => onMonth(mo.first)}
          >
            <span className="mono yr-band-month" aria-hidden="true">
              {mo.name}
            </span>
            <span className="mono yr-band-year" aria-hidden="true">
              {y}
            </span>
          </button>
          {mo.days.map((day) => (
            <YearCell
              key={day.date}
              day={day}
              mini={false}
              dots={dots}
              tabbable={day.date === tabDate}
              onCell={onCell}
              onFocusCell={onFocusCell}
            />
          ))}
        </div>
      ))}
    </div>
  )
}
