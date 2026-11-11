// イヤーの「小さな月を並べる」（docs/SPEC.md の 8.3。カレンダーの領域の幅が 870px より狭い時。M・S はいつも）。
// 小さな月 = 月の名前「NOV」（今月は --accent。押すとその月の1日を見ている日にしてマンスリーへ。8.4）、曜日の頭文字の行
// S M T W T F S、7列×6行のマス（前後の月の日は出さない。D28・AMB-CAL-19）。列の数は floor(領域の幅 ÷ 170px) を 2〜4 に収めた数
// （S は2列。yearModel.ts の miniColumns）で、上から1月〜12月の順に並べる
import { cls } from '../common/parts'
import { testIds } from '../common/testIds'
import { YearCell } from './YearCell'
import type { YearMonthVM } from './yearModel'
import './year.css'

/** 曜日の頭文字（日曜〜土曜。日曜は --sun、土曜は --sat） */
const INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const
/** 7列×6行 */
const SLOTS = 42

export interface YearMinisProps {
  y: number
  months: YearMonthVM[]
  columns: 2 | 3 | 4
  /** Tab で止まる日 */
  tabDate: string
  onCell: (date: string) => void
  onMonth: (first: string) => void
  onFocusCell: (date: string) => void
}

export function YearMinis({ y, months, columns, tabDate, onCell, onMonth, onFocusCell }: YearMinisProps) {
  return (
    <div className="yr-minis" data-cols={columns}>
      {months.map((mo) => (
        <div key={mo.m} className="yr-mini" role="group" aria-label={`${y}年${mo.m}月`}>
          <button
            type="button"
            className={cls('mono', 'yr-mini-name', mo.isThisMonth && 'is-this-month')}
            data-testid={testIds.yearMonth(mo.m)}
            aria-label={mo.label}
            aria-current={mo.isThisMonth ? 'date' : undefined}
            onClick={() => onMonth(mo.first)}
          >
            {mo.name}
          </button>
          <div className="yr-mini-head" aria-hidden="true">
            {INITIALS.map((w, i) => (
              <span key={i} className="mono yr-mini-wd" data-tone={i === 0 ? 'sun' : i === 6 ? 'sat' : undefined}>
                {w}
              </span>
            ))}
          </div>
          <div className="yr-mini-grid">
            {Array.from({ length: SLOTS }, (_, i) => {
              const day = mo.days[i - mo.lead]
              if (!day) return <span key={`e${i}`} className="yr-slot" aria-hidden="true" />
              return (
                <YearCell
                  key={day.date}
                  day={day}
                  mini
                  dots="top"
                  tabbable={day.date === tabDate}
                  onCell={onCell}
                  onFocusCell={onFocusCell}
                />
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
