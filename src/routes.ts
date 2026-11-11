// 画面の行き先（HashRouter を使うので静的ホスティングでもそのまま動く。docs/SPEC.md の 3.1）。
// 段階0はトップ・MIM（仮の画面）・ログイン・設定の4つ。段階2でカレンダーの4つのモード（#/year/2026・#/month/2026-11・
// #/week/2026-11-08・#/day/2026-11-10）の行き先の作り方を足した（行き先を読む・直す決まりは src/features/calendar/common/calendarRoute.ts）。
// MIM のメモ（#/mim/{id}）・Task View は段階4、ゴミ箱・Claude の操作の記録は段階5で足す
import { pad2, parseYmd, toYmd, weekStart } from './domain/dates'
import type { CalendarMode } from './store/uiStore'

export const paths = {
  /** トップ（カレンダーと右の列。開くと前回のモードの今日を含む期間に置き換える。docs/SPEC.md の 3.1・Q20） */
  top: () => '/',
  /** イヤー（例 #/year/2026） */
  year: (y: number) => `/year/${y}`,
  /** マンスリー（例 #/month/2026-11。m は 1〜12） */
  month: (y: number, m: number) => `/month/${y}-${pad2(m)}`,
  /** ウィークリー（例 #/week/2026-11-08）。日付はその週の日曜（日曜でない日から作る時は calendarPath('week', 日付)） */
  week: (sunday: string) => `/week/${sunday}`,
  /** デイリー（例 #/day/2026-11-10） */
  day: (date: string) => `/day/${date}`,
  /**
   * MIM（ヘッダーの［MIM］で開く。docs/SPEC.md の 16.1）。L はカレンダーの領域、M は積んだ中のカレンダーの区切りが MIM に替わり、
   * S は全面で開く。段階0は「段階4で作ります」の仮の画面
   */
  mim: () => '/mim',
  /** ログインの画面（ログインしていない時。docs/SPEC.md の 2.5） */
  login: () => '/login',
  /** 設定（別のページ。右の列は出さない。docs/SPEC.md の 18.1） */
  settings: () => '/settings',
}

/**
 * そのモードで、その日（'YYYY-MM-DD'）を含む期間の行き先（年・月・その週の日曜・その日）。
 * 例: calendarPath('week', '2026-12-31') → '/week/2026-12-27'（年をまたぐ週も日曜の日付）
 */
export function calendarPath(mode: CalendarMode, date: string): string {
  const v = parseYmd(date)
  if (!v) throw new Error(`日付の形が違います: ${date}`)
  switch (mode) {
    case 'year':
      return paths.year(v.y)
    case 'month':
      return paths.month(v.y, v.m)
    case 'week':
      return paths.week(toYmd(weekStart(v)))
    case 'day':
      return paths.day(toYmd(v))
  }
}

/** カレンダーのモードの行き先（#/year/… #/month/… #/week/… #/day/…。中の値が正しいかは calendarRoute.ts が見る） */
const MODE_PATH = /^\/(year|month|week|day)\/[^/]+\/?$/

/** 行き先のモード（カレンダーのモードの行き先でなければ null。トップ #/ も null） */
export function calendarModeOf(pathname: string): CalendarMode | null {
  const m = MODE_PATH.exec(pathname)
  return m ? (m[1] as CalendarMode) : null
}

/** MIM を開いている行き先か（#/mim と、段階4で足す #/mim/{メモの id}） */
export function isMimPath(pathname: string): boolean {
  return pathname === paths.mim() || pathname.startsWith(`${paths.mim()}/`)
}

/**
 * カレンダーを出している行き先か: トップ（#/）と 4つのモード（#/year/… #/month/… #/week/… #/day/…）。
 * カレンダーから［MIM］を開いた印（mimFromCalendar）・［‹ カレンダーに戻る］で使う。#/month だけ・#/month/2026-11/x のような
 * 行き先の無い所（NotFound）は含めない（docs/SPEC.md の 3.1）
 */
export function isCalendarPath(pathname: string): boolean {
  return pathname === paths.top() || calendarModeOf(pathname) !== null
}
