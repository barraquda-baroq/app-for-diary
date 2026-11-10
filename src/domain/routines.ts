// ルーチンの「戻る日」と済みの判定（docs/SPEC.md の 6.7・14.3）。チェックした日を全部記録し、0時に外す書き込みはしない。
// 済み = いちばん新しいチェックの日が、いちばん新しい「戻る日」以後であること（見るたびに計算する。どの端末でも同じになる。D7）。
// 日付はどれも端末の暦の 'YYYY-MM-DD'。
import { addDaysYmd, addMonthsToMonth, dayInMonthClamped, daysInMonth, isYmd, monthOf, parseYmd, toYmd, weekdayOfYmd } from './dates'
import { LIMITS, ROUTINE_CYCLES, type AppData, type ID, type Routine, type RoutineCheck, type RoutineCycle } from './types'
import { charCount } from './util'

type Spec = Pick<Routine, 'cycle' | 'weekdays' | 'monthDay' | 'yearMonth' | 'yearDay'>

export const ROUTINE_CYCLE_LABELS: Record<RoutineCycle, string> = {
  daily: '毎日',
  weekly: '毎週',
  monthly: '毎月',
  quarterly: '四半期',
  yearly: '毎年',
}

export function isRoutineCycle(v: unknown): v is RoutineCycle {
  return typeof v === 'string' && (ROUTINE_CYCLES as readonly string[]).includes(v)
}

const isInt = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max

/** 毎年の m/d に使える日の上限（うるう年の 2/29 を含める） */
export function maxYearDay(month: number): number {
  return daysInMonth(2000, month)
}

/**
 * 計算に使う指定（cycle に合わない指定・範囲の外の指定・月日の片方だけは「指定なし」とみなす。6.12 の修復と同じ）
 */
export function effectiveSpec(r: Spec): Spec {
  const cycle: RoutineCycle = isRoutineCycle(r.cycle) ? r.cycle : 'daily'
  const weekdays =
    cycle === 'weekly' && Array.isArray(r.weekdays)
      ? [...new Set(r.weekdays.filter((w) => isInt(w, 0, 6)))].sort((a, b) => a - b)
      : []
  const monthDay = cycle === 'monthly' && isInt(r.monthDay, 1, 31) ? r.monthDay : null
  const yearly = cycle === 'yearly' && isInt(r.yearMonth, 1, 12) && isInt(r.yearDay, 1, maxYearDay(r.yearMonth))
  return {
    cycle,
    weekdays,
    monthDay,
    yearMonth: yearly ? r.yearMonth : null,
    yearDay: yearly ? r.yearDay : null,
  }
}

const ymdParts = (s: string) => {
  const v = parseYmd(s)
  if (!v) throw new Error(`日付の形が違います: ${s}`)
  return v
}

/** その日を含む四半期（1・4・7・10月）の1日 */
function quarterStart(y: number, m: number): string {
  return toYmd({ y, m: Math.floor((m - 1) / 3) * 3 + 1, d: 1 })
}

/** いちばん新しい戻る日（今日以前。その日の 0時にチェックが外れる。14.3 の表） */
export function latestResetDay(r: Spec, today: string): string {
  const s = effectiveSpec(r)
  const t = ymdParts(today)
  switch (s.cycle) {
    case 'daily':
      return today
    case 'weekly': {
      const days = s.weekdays.length > 0 ? s.weekdays : [0]
      for (let i = 0; i < 7; i++) {
        const d = addDaysYmd(today, -i)
        if (days.includes(weekdayOfYmd(d))) return d
      }
      return today
    }
    case 'monthly': {
      if (s.monthDay === null) return toYmd({ y: t.y, m: t.m, d: 1 })
      const thisMonth = dayInMonthClamped(t.y, t.m, s.monthDay)
      if (thisMonth <= today) return thisMonth
      const prev = addMonthsToMonth(monthOf(today), -1)
      return dayInMonthClamped(Number(prev.slice(0, 4)), Number(prev.slice(5, 7)), s.monthDay)
    }
    case 'quarterly':
      return quarterStart(t.y, t.m)
    case 'yearly': {
      if (s.yearMonth === null || s.yearDay === null) return toYmd({ y: t.y, m: 1, d: 1 })
      const thisYear = dayInMonthClamped(t.y, s.yearMonth, s.yearDay)
      return thisYear <= today ? thisYear : dayInMonthClamped(t.y - 1, s.yearMonth, s.yearDay)
    }
  }
}

/** 次の戻る日（今日より後でいちばん近い戻る日。「11/16（月）に戻ります」。14.3） */
export function nextResetDay(r: Spec, today: string): string {
  const s = effectiveSpec(r)
  const t = ymdParts(today)
  switch (s.cycle) {
    case 'daily':
      return addDaysYmd(today, 1)
    case 'weekly': {
      const days = s.weekdays.length > 0 ? s.weekdays : [0]
      for (let i = 1; i <= 7; i++) {
        const d = addDaysYmd(today, i)
        if (days.includes(weekdayOfYmd(d))) return d
      }
      return addDaysYmd(today, 7)
    }
    case 'monthly': {
      const next = addMonthsToMonth(monthOf(today), 1)
      const ny = Number(next.slice(0, 4))
      const nm = Number(next.slice(5, 7))
      if (s.monthDay === null) return toYmd({ y: ny, m: nm, d: 1 })
      const thisMonth = dayInMonthClamped(t.y, t.m, s.monthDay)
      return thisMonth > today ? thisMonth : dayInMonthClamped(ny, nm, s.monthDay)
    }
    case 'quarterly': {
      const start = quarterStart(t.y, t.m)
      const next = addMonthsToMonth(monthOf(start), 3)
      return `${next}-01`
    }
    case 'yearly': {
      if (s.yearMonth === null || s.yearDay === null) return toYmd({ y: t.y + 1, m: 1, d: 1 })
      const thisYear = dayInMonthClamped(t.y, s.yearMonth, s.yearDay)
      return thisYear > today ? thisYear : dayInMonthClamped(t.y + 1, s.yearMonth, s.yearDay)
    }
  }
}

/** チェックした日の並べ直し（正しい日付だけ・小さい順・重なりなし） */
export function normalizeDates(dates: readonly unknown[]): string[] {
  return [...new Set(dates.filter((d): d is string => isYmd(d)))].sort()
}

/** そのルーチンのチェックの記録（月ごと） */
export function checksOf(data: Pick<AppData, 'routineChecks'>, routineId: ID): RoutineCheck[] {
  return Object.values(data.routineChecks).filter((c) => c.routineId === routineId)
}

/** そのルーチンのチェックした日（全部の月。小さい順） */
export function checkDatesOf(data: Pick<AppData, 'routineChecks'>, routineId: ID): string[] {
  return normalizeDates(checksOf(data, routineId).flatMap((c) => (Array.isArray(c.dates) ? c.dates : [])))
}

/** 済みか（いちばん新しいチェックの日が、いちばん新しい戻る日以後。14.3） */
export function isRoutineDone(r: Spec, dates: readonly string[], today: string): boolean {
  if (dates.length === 0) return false
  const latest = dates.reduce((a, b) => (a > b ? a : b))
  return latest >= latestResetDay(r, today)
}

/** チェックする（今日を足す） */
export function checkToday(dates: readonly string[], today: string): string[] {
  return normalizeDates([...dates, today])
}

/** チェックを外す（いちばん新しい戻る日以後の記録を消す。14.3） */
export function uncheck(dates: readonly string[], r: Spec, today: string): string[] {
  const reset = latestResetDay(r, today)
  return normalizeDates(dates).filter((d) => d < reset)
}

// ---------- 決まり（6.7） ----------

export interface RoutineProblem {
  fields: readonly string[]
  message: string
}

/** ルーチンが 6.7 の決まりに合わない所（無ければ空）。受け取り箱の確かめと手の操作に使う */
export function routineProblems(r: Pick<Routine, 'title'> & Spec): RoutineProblem[] {
  const out: RoutineProblem[] = []
  if (typeof r.title !== 'string' || charCount(r.title) < 1 || charCount(r.title) > LIMITS.title) {
    out.push({ fields: ['title'], message: `件名は1〜${LIMITS.title}字で入れてください` })
  }
  if (!isRoutineCycle(r.cycle)) {
    out.push({ fields: ['cycle'], message: '種類が正しくありません' })
    return out
  }
  const wd = r.weekdays
  const wdOk =
    Array.isArray(wd) && wd.every((w) => isInt(w, 0, 6)) && wd.every((w, i) => i === 0 || (wd[i - 1] as number) < (w as number))
  if (!wdOk) out.push({ fields: ['weekdays'], message: '曜日は 0（日）〜6（土）を小さい順に重ねずに入れてください' })
  else if (r.cycle !== 'weekly' && wd.length > 0) out.push({ fields: ['cycle', 'weekdays'], message: '曜日の指定は毎週だけです' })
  if (r.monthDay !== null && !isInt(r.monthDay, 1, 31)) out.push({ fields: ['monthDay'], message: '毎月の日は 1〜31 です' })
  else if (r.cycle !== 'monthly' && r.monthDay !== null) out.push({ fields: ['cycle', 'monthDay'], message: '日の指定は毎月だけです' })
  const ym = r.yearMonth
  const yd = r.yearDay
  if ((ym === null) !== (yd === null)) {
    out.push({ fields: ['yearMonth', 'yearDay'], message: '毎年の指定は月と日の両方を入れてください' })
  } else if (ym !== null && yd !== null) {
    if (!isInt(ym, 1, 12) || !isInt(yd, 1, maxYearDay(ym))) {
      out.push({ fields: ['yearMonth', 'yearDay'], message: '毎年の月日が暦にありません' })
    } else if (r.cycle !== 'yearly') {
      out.push({ fields: ['cycle', 'yearMonth', 'yearDay'], message: '月日の指定は毎年だけです' })
    }
  }
  return out
}

/**
 * チェックの記録の直す依頼（`patch: { dates }`）の確かめ（19.4）: その月の正しい日付を小さい順・重なりなしで、足してよいのは依頼を
 * 作った日（createdDay）だけ、外せるのは、その日から見たいちばん新しい戻る日以後の日だけ。合えば null、合わなければ理由
 */
export function checkDatesProblem(
  routine: Spec,
  month: string,
  current: readonly string[],
  next: unknown,
  createdDay: string,
): string | null {
  if (!Array.isArray(next) || !next.every((d) => isYmd(d))) return 'チェックした日の形が正しくありません'
  const list = next as string[]
  if (!list.every((d, i) => i === 0 || list[i - 1] < d)) return 'チェックした日は小さい順に重ねずに入れてください'
  if (!list.every((d) => monthOf(d) === month)) return `${month} の記録には、その月の日だけを入れられます`
  const cur = new Set(normalizeDates(current))
  const nxt = new Set(list)
  for (const d of nxt) if (!cur.has(d) && d !== createdDay) return 'チェックを付けられるのは、依頼を作った日（今日）の分だけです'
  const reset = latestResetDay(routine, createdDay)
  for (const d of cur) if (!nxt.has(d) && d < reset) return '前の回のチェックは外せません'
  return null
}
