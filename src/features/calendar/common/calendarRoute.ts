// カレンダーの行き先を読む・直す決まり（docs/SPEC.md の 3.1・3.7・6.4・7.12。確かめ A2・A4・D02・D04・D31）。
// 行き先（#/year/2026・#/month/2026-11・#/week/2026-11-08・#/day/2026-11-10・トップ #/）から、モード・期間・見ている日を決め、
// 正しくない行き先は置き換える先を返す。［‹］［›］で見ている日を移す・裏から戻って6時間たった時に今日へ移すかもここで決める。
// 日付はどれも 'YYYY-MM-DD'。React・ストアを読まない（純粋な関数。src/features/calendar/purity.test.ts）
import {
  addDaysYmd,
  compareYmd,
  isMonth,
  parseYmd,
  ROUTE_YEARS,
  toYmd,
  weekStartOf,
  monthRange,
  yearRange,
} from '../../../domain/dates'
import { calendarModeOf, calendarPath, paths } from '../../../routes'
import { shiftPeriod } from './calendarHeading'
import type { CalendarMode } from './types'

/** 期間（初めの日と最後の日。両端を含む） */
export interface Period {
  from: string
  to: string
}

/** 行き先を読んだ結果 */
export interface ParsedCalendarPath extends Period {
  mode: CalendarMode
  /**
   * 行き先が決める見ている日: デイリーの日付、日曜でない週の日付（FRAME-018）、トップ #/ と正しくない行き先の今日。
   * null の時は、覚えている見ている日から決める（resolveViewed。D02）
   */
  date: string | null
  /** 置き換える行き先（そのままでよい時は null。FRAME-001・017・018） */
  replaceTo: string | null
}

/** 行き先に使える年か（1900〜2199年。D04） */
function inRouteYears(y: number): boolean {
  return Number.isInteger(y) && y >= ROUTE_YEARS.from && y <= ROUTE_YEARS.to
}

/** 行き先に使える日か（1900-01-01〜2199-12-31 の暦にある日） */
function routableDate(date: string): boolean {
  const v = parseYmd(date)
  return v !== null && inRouteYears(v.y)
}

/**
 * そのモードで、その日を含む期間を行き先にできるか（行き先に使える年の中か）。週は、日曜〜土曜のどれかが中にあればよい
 * （1900年1月1日の週の日曜は 1899年12月31日）。［‹］［›］で年の端より外へは移らない
 */
export function isRoutable(mode: CalendarMode, date: string): boolean {
  if (!parseYmd(date)) return false
  if (mode !== 'week') return routableDate(date)
  const sunday = weekStartOf(date)
  return routableDate(sunday) || routableDate(addDaysYmd(sunday, 6))
}

/** そのモードで、その日を含む期間（年は 1/1〜12/31、月は 1日〜最終日、週は日曜〜土曜、日はその日） */
export function periodRange(mode: CalendarMode, date: string): Period {
  switch (mode) {
    case 'year':
      return yearRange(Number(date.slice(0, 4)))
    case 'month':
      return monthRange(date.slice(0, 7))
    case 'week': {
      const from = weekStartOf(date)
      return { from, to: addDaysYmd(from, 6) }
    }
    case 'day':
      return { from: date, to: date }
  }
}

/** その日が期間の中か */
export function inPeriod(date: string, p: Period): boolean {
  return compareYmd(p.from, date) <= 0 && compareYmd(date, p.to) <= 0
}

/** 今日を含む期間の行き先として読んだ結果（トップ #/・正しくない行き先） */
function todayPeriod(mode: CalendarMode, today: string, pathname: string): ParsedCalendarPath {
  const to = calendarPath(mode, today)
  return { mode, ...periodRange(mode, today), date: today, replaceTo: to === pathname ? null : to }
}

/** 行き先の値の部分（#/month/2026-11 の 2026-11。後ろの / は除く） */
function valueOf(pathname: string): string {
  return pathname.replace(/\/$/, '').split('/')[2] ?? ''
}

/**
 * 行き先を読む（FRAME-001〜005・016〜018）。カレンダーの行き先でなければ null（MIM・設定など）。
 * - トップ #/ → 前回のモード（lastMode）の今日を含む期間へ置き換える（見ている日は今日）
 * - 日付の形が正しくない・年が 1900〜2199年の外 → 同じモードの今日を含む期間へ置き換える（見ている日は今日）
 * - #/week/ の日付が日曜でない → その日を見ている日にして、その週の日曜の行き先へ置き換える
 * - 後ろに / が付いているなど、同じ期間の書き方が違う → 決まった書き方へ置き換える
 */
export function parseCalendarPath(pathname: string, today: string, lastMode: CalendarMode): ParsedCalendarPath | null {
  if (pathname === paths.top()) return todayPeriod(lastMode, today, pathname)
  const mode = calendarModeOf(pathname)
  if (!mode) return null
  const value = valueOf(pathname)
  let date: string | null = null
  let start: string | null = null
  switch (mode) {
    case 'year':
      if (/^\d{4}$/.test(value) && inRouteYears(Number(value))) start = `${value}-01-01`
      break
    case 'month':
      if (isMonth(value) && inRouteYears(Number(value.slice(0, 4)))) start = `${value}-01`
      break
    case 'week':
      if (isRoutable('week', value)) {
        start = weekStartOf(value)
        // 日曜でない日はその日を見ている日にする（FRAME-018）
        if (start !== value) date = value
      }
      break
    case 'day':
      if (routableDate(value)) start = date = value
      break
  }
  if (start === null) return todayPeriod(mode, today, pathname)
  const to = calendarPath(mode, start)
  return { mode, ...periodRange(mode, start), date, replaceTo: to === pathname ? null : to }
}

/**
 * 見ている日を決める（D02・確かめ A2）: 覚えている日が期間の中ならその日、無ければ今日が中なら今日、それも無ければ期間の初めの日
 * （年は 1/1、月は 1日、週は日曜）
 */
export function resolveViewed(p: Period, remembered: string | null, today: string): string {
  if (remembered && parseYmd(remembered) && inPeriod(remembered, p)) return remembered
  if (inPeriod(today, p)) return today
  return p.from
}

/**
 * ［‹］［›］・スワイプで見ている日を移す（年は1年、月は1か月、週は7日、日は1日。FRAME-063）。月・年を移って見ている日が
 * その月に無い時は、その月の最終日（1/31 → › → 2/28、2028/2/29 → 翌年 → 2029/2/28。FRAME-072）
 */
export function shiftViewed(mode: CalendarMode, viewed: string, dir: 1 | -1): string {
  const v = parseYmd(viewed)
  if (!v) throw new Error(`日付の形が違います: ${viewed}`)
  return toYmd(shiftPeriod(mode, v, dir))
}

/** 裏から戻って今日へ移すまでの、最後の操作からの時間（6時間。docs/SPEC.md の 6.4） */
export const RETURN_TO_TODAY_MS = 6 * 60 * 60 * 1000

export interface ReturnToTodayInput {
  /** 今（ミリ秒） */
  now: number
  /** 最後に押した・キーを打った時刻（ミリ秒。D31） */
  lastInteraction: number
  /** 前の「今日」（'YYYY-MM-DD'。最後に操作した時の今日） */
  prevToday: string
  /** 今の今日 */
  today: string
  mode: CalendarMode
  /** 見ている日 */
  viewed: string
}

/**
 * 裏から戻った時に、今日を含む期間へ移すか（FRAME-278・CALENDAR-030）。最後の操作から 6時間以上たっていて、見ている期間が
 * 前の「今日」を含んでいれば、新しい今日を含む期間の行き先を返す（行き先が今と同じでも返す。見ている日を今日にする）。
 * 移さない時は null
 */
export function returnToTodayTarget(a: ReturnToTodayInput): string | null {
  if (a.now - a.lastInteraction < RETURN_TO_TODAY_MS) return null
  if (!parseYmd(a.viewed) || !parseYmd(a.prevToday) || !parseYmd(a.today)) return null
  if (!inPeriod(a.prevToday, periodRange(a.mode, a.viewed))) return null
  return calendarPath(a.mode, a.today)
}
