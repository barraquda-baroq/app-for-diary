// 日付を選ぶ小さな月のカレンダー（docs/SPEC.md の 12.2 の 3・6.3・7.1・7.3。ITEMS-170・CALENDAR-021・D38・AMB-ITEMS-08）。
// 日曜始まり・今日の印（.today-mark）・土日祝の色（日曜と祝日は --sun、土曜は --sat）。前後の月の日は --numeral の字で出し、押すと
// その日を選ぶ。‹ › で月を替える。L・M は日付の欄の下に開く小窓（Popover）、S は下からのシート（src/ui/Modal）で開く（DatePicker）。
// 締め切り日の小窓で開始日より前の日・開始日の小窓で締め切り日より後の日も押せる（そろえるのは包む画面の editDates。6.3）。
// キー: ←→ で1日、↑↓ で1週、PageUp・PageDown で1か月、Home・End で週の初め・終わり、Enter・Space で選ぶ。小窓の Tab と Esc は閉じる
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { addDaysYmd, addMonthsToMonth, jaDateLabel, monthWeeks, toYmd, WEEKDAYS_JA, weekdayOfYmd } from '../../../domain/dates'
import { holidayName } from '../../../domain/holidays'
import { useToday, useWidthClass } from '../../../ui/hooks'
import { ChevronLeftIcon, ChevronRightIcon } from '../../../ui/icons'
import { Modal } from '../../../ui/Modal'
import { cls, dayTone } from '../../calendar/common/parts/itemLook'
import { Popover } from './Popover'

/** 日付を選ぶ小窓・シートの data-testid */
export const DATE_PICKER_TEST_ID = 'item-date-picker'

export interface MiniMonthProps {
  /** 選んでいる日（無ければ null） */
  value: string | null
  /** 初めに出す月（'YYYY-MM'） */
  month: string
  /** 今日 */
  today: string
  onPick: (date: string) => void
  /** 表の読み上げの名前（「開始日」など） */
  label: string
}

const monthTitle = (ym: string) => `${Number(ym.slice(0, 4))}年${Number(ym.slice(5, 7))}月`

/** その月の中の、初めにフォーカスする日（選んでいる日・今日・1日の順に、その月にある物） */
function startFocus(ym: string, value: string | null, today: string): string {
  if (value?.startsWith(ym)) return value
  if (today.startsWith(ym)) return today
  return `${ym}-01`
}

export function MiniMonth({ value, month: initialMonth, today, onPick, label }: MiniMonthProps) {
  const [month, setMonth] = useState(initialMonth)
  const [focus, setFocus] = useState(() => startFocus(initialMonth, value, today))
  const grid = useRef<HTMLDivElement>(null)
  /** キーで日を移した時だけ、その日のボタンへフォーカスを移す */
  const moved = useRef(false)
  const weeks = monthWeeks(Number(month.slice(0, 4)), Number(month.slice(5, 7)))

  useEffect(() => {
    if (!moved.current) return
    moved.current = false
    grid.current?.querySelector<HTMLButtonElement>(`[data-date="${focus}"]`)?.focus()
  }, [focus, month])

  const showMonth = (ym: string) => {
    setMonth(ym)
    setFocus(startFocus(ym, value, today))
  }
  const moveTo = (date: string) => {
    moved.current = true
    setFocus(date)
    if (!date.startsWith(month)) setMonth(date.slice(0, 7))
  }

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const w = weekdayOfYmd(focus)
    const step: Record<string, () => string> = {
      ArrowLeft: () => addDaysYmd(focus, -1),
      ArrowRight: () => addDaysYmd(focus, 1),
      ArrowUp: () => addDaysYmd(focus, -7),
      ArrowDown: () => addDaysYmd(focus, 7),
      Home: () => addDaysYmd(focus, -w),
      End: () => addDaysYmd(focus, 6 - w),
      PageUp: () => shiftMonthKeepDay(focus, -1),
      PageDown: () => shiftMonthKeepDay(focus, 1),
    }
    const next = step[e.key]
    if (!next) return
    e.preventDefault()
    moveTo(next())
  }

  return (
    <div className="it-mm">
      <div className="it-mm-head">
        <button
          type="button"
          className="icon-btn"
          aria-label="前の月"
          title="前の月"
          onClick={() => showMonth(addMonthsToMonth(month, -1))}
        >
          <ChevronLeftIcon />
        </button>
        <span className="it-mm-title" aria-live="polite">
          {monthTitle(month)}
        </span>
        <button
          type="button"
          className="icon-btn"
          aria-label="次の月"
          title="次の月"
          onClick={() => showMonth(addMonthsToMonth(month, 1))}
        >
          <ChevronRightIcon />
        </button>
      </div>
      <div ref={grid} className="it-mm-grid" role="grid" aria-label={`${label}（${monthTitle(month)}）`} onKeyDown={onKey}>
        <div className="it-mm-row" role="row">
          {WEEKDAYS_JA.map((d, i) => (
            <span key={d} className="it-mm-wd" role="columnheader" data-tone={i === 0 ? 'sun' : i === 6 ? 'sat' : undefined}>
              {d}
            </span>
          ))}
        </div>
        {weeks.map((week) => (
          <div key={toYmd(week[0].date)} className="it-mm-row" role="row">
            {week.map(({ date: ymd, outside }) => {
              const date = toYmd(ymd)
              const holiday = holidayName(date)
              const isToday = date === today
              const name = [jaDateLabel(date), holiday, isToday ? '今日' : null].filter(Boolean).join('、')
              return (
                <span key={date} className="it-mm-cell" role="gridcell" aria-selected={date === value}>
                  <button
                    type="button"
                    className={cls('it-mm-day', isToday && 'today-mark', date === value && 'is-selected')}
                    tabIndex={date === focus ? 0 : -1}
                    aria-label={name}
                    aria-pressed={date === value}
                    data-date={date}
                    data-tone={dayTone(date) ?? undefined}
                    data-outside={outside || undefined}
                    onClick={() => onPick(date)}
                  >
                    {ymd.d}
                  </button>
                </span>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

/** 1か月前・後の同じ日（その月に無い日は月の終わり） */
function shiftMonthKeepDay(date: string, months: number): string {
  const ym = addMonthsToMonth(date.slice(0, 7), months)
  const day = Number(date.slice(8, 10))
  const last = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate()
  return `${ym}-${String(Math.min(day, last)).padStart(2, '0')}`
}

export interface DatePickerProps {
  /** 欄の名前（「開始日」・「締め切り日」） */
  caption: string
  /** 押した日付の欄（L・M の小窓はこの下に開く） */
  anchor: HTMLElement | null
  value: string | null
  /** もう一方の欄の日付（値が無い時は、その月を初めに出す） */
  other: string | null
  onPick: (date: string) => void
  onClose: () => void
}

/** 日付を選ぶ所: L・M は欄の下の小窓、S は下からのシート（D38）。選ぶと閉じる（中の小さな画面は履歴に積まない） */
export function DatePicker({ caption, anchor, value, other, onPick, onClose }: DatePickerProps) {
  const width = useWidthClass()
  const today = toYmd(useToday())
  const month = (value ?? other ?? today).slice(0, 7)
  const pick = (date: string) => {
    onClose()
    onPick(date)
  }
  const body = <MiniMonth value={value} month={month} today={today} onPick={pick} label={caption} />
  if (width === 'S') {
    return (
      <Modal
        title={`${caption}を選ぶ`}
        onClose={onClose}
        className="it-mm-sheet"
        testId={DATE_PICKER_TEST_ID}
        initialFocus=".it-mm-day[tabindex='0']"
      >
        {body}
      </Modal>
    )
  }
  return (
    <PopoverPicker caption={caption} anchor={anchor} onClose={onClose}>
      {body}
    </PopoverPicker>
  )
}

/** L・M の小窓: 開くと日へフォーカスし、Tab・閉じた時は日付の欄へフォーカスを戻す */
function PopoverPicker({
  caption,
  anchor,
  onClose,
  children,
}: {
  caption: string
  anchor: HTMLElement | null
  onClose: () => void
  children: ReactNode
}) {
  useEffect(() => {
    document.querySelector<HTMLElement>(`[data-testid="${DATE_PICKER_TEST_ID}"] .it-mm-day[tabindex='0']`)?.focus()
    return () => {
      // 閉じた時、フォーカスが小窓の中にあった（消えて body に落ちた）なら日付の欄へ戻す
      const active = document.activeElement
      if (anchor?.isConnected && (!active || active === document.body)) anchor.focus({ preventScroll: true })
    }
  }, [anchor])
  return (
    <Popover
      anchor={anchor}
      onClose={onClose}
      role="dialog"
      label={`${caption}を選ぶ`}
      className="it-mm-pop"
      testId={DATE_PICKER_TEST_ID}
      onKeyDown={(e) => {
        // 小窓の外（下の小さな画面の Tab の囲い）へは出さずに閉じる
        if (e.key !== 'Tab') return
        e.preventDefault()
        e.stopPropagation()
        onClose()
        anchor?.focus({ preventScroll: true })
      }}
    >
      {children}
    </Popover>
  )
}
