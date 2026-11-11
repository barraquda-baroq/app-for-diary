// 曜日の丸いラベル（docs/SPEC.md の 4.4-5・7.1・7.3・7.4）。ウィークリー・デイリーの日の見出しに置く（マンスリーの曜日の列は
// 丸いラベルにしない）。中は等幅の英字3文字（SUN〜SAT）、読み上げは日本語（「日曜日」）。
// 土曜は --sat、日曜・祝日は --sun。今日は今日の印（地 --today-bg・字 --on-primary・輪・太さ 600）。休みの日は地を --surface に
// （--off-fill の地に埋もれないように）。今日が休みの日なら今日の印が勝つ（D16）
import { WEEKDAYS_EN, WEEKDAYS_JA_LONG, weekdayOfYmd } from '../../../../domain/dates'
import { cls, dayTone } from './itemLook'
import './parts.css'

export interface DayPillProps {
  /** その日（'YYYY-MM-DD'） */
  date: string
  /** 今日（'YYYY-MM-DD'） */
  today: string
  /** 休みの日 */
  off?: boolean
  className?: string
}

export function DayPill({ date, today, off = false, className }: DayPillProps) {
  const w = weekdayOfYmd(date)
  const isToday = date === today
  const tone = isToday ? null : dayTone(date)
  return (
    <span
      className={cls('pill', 'cp-pill', isToday && 'is-today', !isToday && off && 'is-off', tone && `cp-${tone}`, className)}
      aria-current={isToday ? 'date' : undefined}
    >
      <span className="caps" aria-hidden="true">
        {WEEKDAYS_EN[w]}
      </span>
      <span className="visually-hidden">{WEEKDAYS_JA_LONG[w]}</span>
    </span>
  )
}
