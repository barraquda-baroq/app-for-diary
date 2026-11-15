// ルーチンの指定を選ぶ所（docs/SPEC.md の 14.1・14.2）: 毎週は7つの曜日のボタン（日〜土。いくつでも。押すたびに付ける・外す）、毎月は
// 1〜31日の選択、毎年は月と日の選択（日の数は月に合わせる。2/29 も選べる）。毎日・四半期は指定を持たないので何も出さない。
// 入力欄の［指定］の小窓（routine/RoutineInput）と［詳しく］のパネル（routine/RoutinePanel）の中で同じ物を使う。選んだ物はすぐ渡す
// （保存・足すのは使う側）。日・月日の選択は端末の選ぶ部品（select。iPhone は下から出る回す選び方）
import { useId } from 'react'
import { WEEKDAYS_JA, WEEKDAYS_JA_LONG } from '../../../domain/dates'
import type { SpecDraft } from '../../../domain/routineList'
import { maxYearDay } from '../../../domain/routines'
import type { RoutineCycle } from '../../../domain/types'

export interface SpecPickerProps {
  cycle: RoutineCycle
  value: SpecDraft
  onChange: (next: SpecDraft) => void
}

/** 指定を持つ種類か（毎週・毎月・毎年） */
export const hasSpec = (cycle: RoutineCycle): boolean => cycle === 'weekly' || cycle === 'monthly' || cycle === 'yearly'

const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1)

/** select の値（'' は指定なし） */
const numberOf = (v: string): number | null => (v === '' ? null : Number(v))

export function SpecPicker({ cycle, value, onChange }: SpecPickerProps) {
  const id = useId()
  if (cycle === 'weekly') {
    const on = new Set(value.weekdays)
    return (
      <div className="rt-spec-week" role="group" aria-label="曜日">
        {WEEKDAYS_JA.map((label, w) => (
          <button
            key={w}
            type="button"
            className="rt-spec-day"
            aria-pressed={on.has(w)}
            aria-label={WEEKDAYS_JA_LONG[w]}
            onClick={() => {
              const next = new Set(on)
              if (next.has(w)) next.delete(w)
              else next.add(w)
              onChange({ ...value, weekdays: [...next].sort((a, b) => a - b) })
            }}
          >
            {label}
          </button>
        ))}
      </div>
    )
  }
  if (cycle === 'monthly') {
    return (
      <div className="rt-spec-row">
        <label htmlFor={`${id}-day`} className="rt-spec-label">
          毎月
        </label>
        <select
          id={`${id}-day`}
          className="select rt-spec-select"
          aria-label="日"
          value={value.monthDay ?? ''}
          onChange={(e) => onChange({ ...value, monthDay: numberOf(e.target.value) })}
        >
          <option value="">指定なし</option>
          {range(31).map((d) => (
            <option key={d} value={d}>
              {d}日
            </option>
          ))}
        </select>
      </div>
    )
  }
  if (cycle === 'yearly') {
    const days = value.yearMonth === null ? 31 : maxYearDay(value.yearMonth)
    return (
      <div className="rt-spec-row">
        <label htmlFor={`${id}-month`} className="rt-spec-label">
          毎年
        </label>
        <select
          id={`${id}-month`}
          className="select rt-spec-select"
          aria-label="月"
          value={value.yearMonth ?? ''}
          onChange={(e) => {
            const month = numberOf(e.target.value)
            // 選んだ月に無い日（4月の31日など）は外す
            const day = month !== null && value.yearDay !== null && value.yearDay > maxYearDay(month) ? null : value.yearDay
            onChange({ ...value, yearMonth: month, yearDay: day })
          }}
        >
          <option value="">月</option>
          {range(12).map((m) => (
            <option key={m} value={m}>
              {m}月
            </option>
          ))}
        </select>
        <select
          className="select rt-spec-select"
          aria-label="日"
          value={value.yearDay ?? ''}
          onChange={(e) => onChange({ ...value, yearDay: numberOf(e.target.value) })}
        >
          <option value="">日</option>
          {range(days).map((d) => (
            <option key={d} value={d}>
              {d}日
            </option>
          ))}
        </select>
      </div>
    )
  }
  return null
}
