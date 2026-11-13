// ウィークリーの日の見出しと段の名札（docs/SPEC.md の 10.2・10.4・4.4-5・7.1〜7.4）。
// - 日の見出し（DayHead）: 曜日の丸いラベル＋等幅の「11/8」（13px。押すとその日のデイリー）、休みのチェック、祝日名（10px・--sun・1行）。
//   7日を横は列の幅が 120px 以上なら1行目の右に休みのチェック・下に祝日名（52px）、狭い時は2行目に休みのチェックと祝日名（64px）。
//   7日を縦は日のかたまりの見出し（32px）で、左から丸いラベル・日付・祝日名、右の端に休みのチェック
// - 休みのチェック（OffDayCheck）: 16px の四角＋「休」10px。休みの日の「休」はこの字だけ（D33）。元に戻す・やり直すで休みを当てた日は
//   見出しを目立たせる（7.13・■26）
// - 段の名札（KindTag）: 線のアイコン（かばん／家）＋等幅の「WORK」「PRIVATE」11px＋「仕事」「プライベート」11px
import { jaDateLabel } from '../../../domain/dates'
import { ITEM_KIND_LABELS } from '../../../domain/trash'
import type { ItemKind } from '../../../domain/types'
import { CheckIcon, KindIcon } from '../../../ui/icons'
import { cls, dayTone, DayPill, flashKey, HolidayName, useFlashTarget } from '../common/parts'
import { testIds } from '../common/testIds'
import type { WeekActions } from './weekActions'
import type { WeekDay } from './weekModel'
import './week.css'

/** 段の名札の英語 */
const KIND_EN: Record<ItemKind, string> = { work: 'WORK', private: 'PRIVATE' }

export interface DayHeadProps {
  day: WeekDay
  today: string
  /** 7日を横の行の数（1 = 52px、2 = 64px）。7日を縦は 'block'（32px） */
  layout: 1 | 2 | 'block'
  actions: WeekActions
}

/** 目立たせる時に見える所まで出す（7日を縦の週の中だけ。ページは動かさない） */
const HEAD_FLASH = { scroll: true } as const

export function DayHead({ day, today, layout, actions }: DayHeadProps) {
  // 日付の色は今日でも土日・祝日の色（7.1）。今日の印は丸いラベル（地・字の色・輪）と日付の太さ 600 で示す（7.3）
  const tone = dayTone(day.date)
  // 元に戻す・やり直すで、その日の休みを当てた時に目立たせる（7.13・■26）
  const flashRef = useFlashTarget<HTMLDivElement>(flashKey.dayHead(day.date), HEAD_FLASH)
  return (
    <div
      ref={flashRef}
      className={cls('wk-head', layout === 'block' ? 'is-block' : `is-rows-${layout}`, day.off && 'is-off')}
      data-testid={testIds.weekHead(day.date)}
    >
      <button
        type="button"
        className="wk-day"
        onClick={() => actions.openDay(day.date)}
        aria-label={`${jaDateLabel(day.date)}のデイリーを開く`}
        aria-current={day.isToday ? 'date' : undefined}
      >
        <DayPill date={day.date} today={today} off={day.off} />
        <span className={cls('mono', 'wk-md', tone && `cp-${tone}`, day.isToday && 'is-today')}>{day.md}</span>
      </button>
      <OffDayCheck date={day.date} off={day.off} onChange={actions.setOff} />
      <span className="wk-holiday-slot">
        <HolidayName date={day.date} />
      </span>
    </div>
  )
}

export interface OffDayCheckProps {
  date: string
  off: boolean
  onChange?: (date: string, off: boolean) => void
}

/** 休みのチェック（16px の四角＋「休」。押せる所は周りに広げる。指の端末では 34px 四方） */
export function OffDayCheck({ date, off, onChange }: OffDayCheckProps) {
  return (
    <label className={cls('wk-off', off && 'is-on')}>
      <input
        type="checkbox"
        className="wk-off-input"
        checked={off}
        onChange={(e) => onChange?.(date, e.currentTarget.checked)}
        aria-label={`${jaDateLabel(date)}を休みにする`}
        data-testid={testIds.weekOff(date)}
      />
      <span className="wk-off-box" aria-hidden="true">
        {off ? <CheckIcon className="icon wk-off-check" /> : null}
      </span>
      <span className="wk-off-text" aria-hidden="true">
        休
      </span>
    </label>
  )
}

/** 段の名札（7日を横は各段のいちばん上、7日を縦はいちばん上の行の左右） */
export function KindTag({ kind, className }: { kind: ItemKind; className?: string }) {
  return (
    <div className={cls('wk-tag', className)}>
      <KindIcon kind={kind} small />
      <span className="mono wk-tag-en">{KIND_EN[kind]}</span>
      <span className="wk-tag-ja">{ITEM_KIND_LABELS[kind]}</span>
    </div>
  )
}
