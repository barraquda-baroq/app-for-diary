// 暦の日付の計算（docs/SPEC.md の 2.9・6.4・7.1）。日付は端末の現地の暦の日付（壁時計の値。時差では動かさない）、
// 週は日曜〜土曜、日の変わり目は端末の 0時。
// 段階0は画面の枠（カレンダーの操作の列・空のマンスリーのマス目・ログインの画面の日付・今日の印）に要る分だけ。
// 段階2で 'YYYY-MM-DD' の文字の形との行き来・期間の重なりなどを足す

/** 暦の日付（端末の現地の日付。m は 1〜12） */
export interface Ymd {
  y: number
  m: number
  d: number
}

/** 曜日の英字3文字（日曜始まり。docs/SPEC.md の 4.4・7.1） */
export const WEEKDAYS_EN = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const
/** 読み上げの曜日（「（火）」） */
export const WEEKDAYS_JA = ['日', '月', '火', '水', '木', '金', '土'] as const
/** 月の英字3文字 */
export const MONTHS_EN = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'] as const

/** 2桁にそろえる（11.08 の 08 など） */
export const pad2 = (n: number): string => String(n).padStart(2, '0')

const toDate = (v: Ymd) => new Date(v.y, v.m - 1, v.d)
const fromDate = (date: Date): Ymd => ({ y: date.getFullYear(), m: date.getMonth() + 1, d: date.getDate() })

/** 今日（端末の現地の日付） */
export function todayYmd(now: Date = new Date()): Ymd {
  return fromDate(now)
}

export function sameDay(a: Ymd, b: Ymd): boolean {
  return a.y === b.y && a.m === b.m && a.d === b.d
}

/** その月の日数（うるう年の2月は 29） */
export function daysInMonth(y: number, m: number): number {
  return new Date(y, m, 0).getDate()
}

/** 曜日（0 = 日曜） */
export function weekdayOf(v: Ymd): number {
  return toDate(v).getDay()
}

export function addDays(v: Ymd, days: number): Ymd {
  return fromDate(new Date(v.y, v.m - 1, v.d + days))
}

/** その日を含む週（日曜始まり）の日曜 */
export function weekStart(v: Ymd): Ymd {
  return addDays(v, -weekdayOf(v))
}

/** 月を移る。その日が移った先の月に無い時は、その月の最終日にする（1/31 → 2/28、2028/2/29 → 12か月後 → 2/28。docs/SPEC.md の 3.7） */
export function addMonths(v: Ymd, months: number): Ymd {
  const index = v.y * 12 + (v.m - 1) + months
  const y = Math.floor(index / 12)
  const m = (index % 12) + 1
  return { y, m, d: Math.min(v.d, daysInMonth(y, m)) }
}

/** 次の 0時（端末の現地の時刻）までのミリ秒。今日の計算し直しのタイマーに使う（docs/SPEC.md の 6.4） */
export function msUntilNextDay(now: Date = new Date()): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  return next.getTime() - now.getTime()
}

export interface MonthCell {
  date: Ymd
  /** 前後の月の日（日付だけを --numeral の色で出す。docs/SPEC.md の 9.1） */
  outside: boolean
}

/** マンスリーのマス目の日付: その月に掛かる週（日曜始まり）の数だけ、7日ずつの行（4〜6行。docs/SPEC.md の 9.1） */
export function monthWeeks(y: number, m: number): MonthCell[][] {
  const first = { y, m, d: 1 }
  const start = weekStart(first)
  const rows = Math.ceil((weekdayOf(first) + daysInMonth(y, m)) / 7)
  return Array.from({ length: rows }, (_, r) =>
    Array.from({ length: 7 }, (_, c) => {
      const date = addDays(start, r * 7 + c)
      return { date, outside: date.m !== m }
    }),
  )
}

/** ログインの画面の今日の曜日と日付（「TUE · 2026.11.10」。docs/SPEC.md の 2.5） */
export function coverDateLabel(v: Ymd): string {
  return `${WEEKDAYS_EN[weekdayOf(v)]} · ${v.y}.${pad2(v.m)}.${pad2(v.d)}`
}
