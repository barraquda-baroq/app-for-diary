// カレンダーの領域（段階0の空の形）: いちばん上に操作の列（docs/SPEC.md の 3.7）、その下にモードの画面の仮の絵。
// 操作の列は、左に 大きく淡い数字 → 期間の小さな表記 → ［‹］［›］→［今日］、右に［年｜月｜週｜日］→［休み］→［＋ 登録］→
// ［Task View］。モードの切り替えと ‹ › 今日 は見ている日と表記だけを動かす（行き先 #/month/2026-11 などは段階2で作る）。
// ［休み］［＋ 登録］は段階2、［Task View］は段階4で作るので、今はお知らせを出すだけ。
// マンスリーの所は空のマス目（日付だけ。予定の数・休み・祝日は段階2）、ほかのモードは「段階2で作ります」
import { useState } from 'react'
import { notify, usePrefs, type CalendarMode } from '../../store/uiStore'
import { monthWeeks, sameDay, todayYmd, WEEKDAYS_EN, type Ymd } from '../../domain/dates'
import { useToday, type WidthClass } from '../../ui/hooks'
import { ChevronLeftIcon, ChevronRightIcon, ListCheckIcon, PlusIcon } from '../../ui/icons'
import { periodHeading, shiftPeriod } from './calendarHeading'

/** ［年｜月｜週｜日］の並び */
export const MODES: readonly { mode: CalendarMode; label: string; name: string }[] = [
  { mode: 'year', label: '年', name: 'イヤー' },
  { mode: 'month', label: '月', name: 'マンスリー' },
  { mode: 'week', label: '週', name: 'ウィークリー' },
  { mode: 'day', label: '日', name: 'デイリー' },
]

/** そのモードに無いボタンは visibility: hidden で消し、ほかのボタンの位置を動かさない（docs/SPEC.md の 3.7） */
const SHOWN: Record<'off' | 'add' | 'taskView', readonly CalendarMode[]> = {
  off: ['month'],
  add: ['month', 'week', 'day'],
  taskView: ['year', 'month'],
}

const UNIT: Record<CalendarMode, string> = { year: '年', month: '月', week: '週', day: '日' }

export function CalendarArea({ width, headingId }: { width: WidthClass; headingId?: string }) {
  const lastMode = usePrefs((s) => s.lastMode)
  const setPrefs = usePrefs((s) => s.setPrefs)
  // 初めは前回のモード（Q20）。段階2で、モードと見ている日は行き先（#/month/2026-11 など）から決める
  const [mode, setMode] = useState<CalendarMode>(lastMode)
  const [viewed, setViewed] = useState<Ymd>(() => todayYmd())
  // 日付が変わったら今日の印だけを移す（見ている期間は動かさない。docs/SPEC.md の 6.4・7.3）
  const today = useToday()

  const changeMode = (next: CalendarMode) => {
    setMode(next)
    setPrefs({ lastMode: next })
  }

  return (
    <div className="cal" data-mode={mode} data-testid="calendar">
      <CalendarToolbar
        mode={mode}
        viewed={viewed}
        headingId={headingId}
        onMode={changeMode}
        onShift={(dir) => setViewed((v) => shiftPeriod(mode, v, dir))}
        onToday={() => setViewed(todayYmd())}
      />
      <div className="cal-body" data-testid="calendar-body">
        {mode === 'month' ? (
          <MonthPlaceholder viewed={viewed} today={today} compact={width === 'S'} />
        ) : (
          <div className="empty cal-empty" data-testid="calendar-placeholder">
            {MODES.find((m) => m.mode === mode)?.name}（{UNIT[mode]}）の画面は段階2で作ります
          </div>
        )}
      </div>
    </div>
  )
}

function CalendarToolbar({
  mode,
  viewed,
  headingId,
  onMode,
  onShift,
  onToday,
}: {
  mode: CalendarMode
  viewed: Ymd
  headingId?: string
  onMode: (mode: CalendarMode) => void
  onShift: (dir: 1 | -1) => void
  onToday: () => void
}) {
  const heading = periodHeading(mode, viewed)
  const unit = UNIT[mode]
  const hidden = (key: keyof typeof SHOWN) => (SHOWN[key].includes(mode) ? '' : ' cal-tool-hidden')
  return (
    <div className="cal-toolbar" data-testid="calendar-toolbar">
      <div className="cal-toolbar-left">
        <h1 id={headingId} tabIndex={-1} className="cal-period" data-testid="cal-period">
          <span className="numeral cal-numeral" aria-hidden="true" data-testid="cal-numeral">
            {heading.numeral}
          </span>
          <span className="cal-period-label" aria-hidden="true">
            <span className="caps">{heading.top}</span>
            <span className="caps">{heading.bottom || ' '}</span>
          </span>
          <span className="visually-hidden">{heading.spoken}</span>
        </h1>
        <div className="cal-nav">
          <button
            type="button"
            className="icon-btn"
            onClick={() => onShift(-1)}
            aria-label={`前の${unit}`}
            title={`前の${unit}`}
            data-testid="cal-prev"
          >
            <ChevronLeftIcon />
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={() => onShift(1)}
            aria-label={`次の${unit}`}
            title={`次の${unit}`}
            data-testid="cal-next"
          >
            <ChevronRightIcon />
          </button>
          <button type="button" className="btn btn-sm" onClick={onToday} data-testid="cal-today">
            今日
          </button>
        </div>
      </div>
      <div className="cal-toolbar-right">
        <div className="segmented cal-modes" role="group" aria-label="カレンダーのモード">
          {MODES.map((m) => (
            <button
              key={m.mode}
              type="button"
              aria-pressed={mode === m.mode}
              title={m.name}
              onClick={() => onMode(m.mode)}
              data-testid={`cal-mode-${m.mode}`}
            >
              {m.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className={`btn btn-sm cal-off${hidden('off')}`}
          aria-pressed={false}
          onClick={() => notify('休みを付けるのは段階2で作ります')}
          data-testid="cal-off"
        >
          休み
        </button>
        <button
          type="button"
          className={`btn btn-sm cal-add${hidden('add')}`}
          aria-label="登録"
          onClick={() => notify('予定の登録は段階2で作ります')}
          data-testid="cal-add"
        >
          <PlusIcon />
          <span className="hide-mobile">登録</span>
        </button>
        <button
          type="button"
          className={`btn btn-sm cal-taskview${hidden('taskView')}`}
          aria-label="Task View"
          title="Task View"
          onClick={() => notify('Task View は段階4で作ります')}
          data-testid="cal-taskview"
        >
          <ListCheckIcon />
          <span className="hide-mobile">Task View</span>
        </button>
      </div>
    </div>
  )
}

/**
 * 空のマンスリーのマス目（docs/SPEC.md の 9.1 の形だけ。日付と今日の丸だけを出す）。
 * 段階2で src/features/calendar/month（予定の数・休み・祝日・押した時。9.）に置き換える
 */
function MonthPlaceholder({ viewed, today, compact }: { viewed: Ymd; today: Ymd; compact: boolean }) {
  const weeks = monthWeeks(viewed.y, viewed.m)
  return (
    <div className={`cal-month${compact ? ' is-compact' : ''}`} data-testid="calendar-month" data-rows={weeks.length}>
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
          const isToday = !outside && sameDay(date, today)
          return (
            <div key={`${date.m}-${date.d}`} className={`cal-cell${tone}`}>
              <span className={`mono cal-date${isToday ? ' today-mark is-today' : ''}`}>{date.d}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
