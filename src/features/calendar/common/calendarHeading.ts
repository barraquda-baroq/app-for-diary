// カレンダーの操作の列の「大きく淡い数字」と「期間の小さな表記」（docs/SPEC.md の 3.7）と、［‹］［›］での見ている日の移り方
// （3.7 の「見ている日を引き継ぐ」）。暦の日付の計算そのものは src/domain/dates.ts（2.9）。
// 段階0は src/features/top にあり、段階2でカレンダーの画面の共通の所（ここ）へ移した。React・ストアを読まない（純粋な関数。
// src/features/calendar/purity.test.ts。モードの型も common/types.ts から読む）
import {
  addDays,
  addMonths,
  MONTHS_EN,
  pad2,
  WEEKDAYS_EN,
  WEEKDAYS_JA,
  weekdayOf,
  weekStart,
  type Ymd,
} from '../../../domain/dates'
import type { CalendarMode } from './types'

/** ［‹］［›］: そのモードの期間で前後へ（年は1年、月は1か月、週は7日、日は1日。docs/SPEC.md の 3.7） */
export function shiftPeriod(mode: CalendarMode, v: Ymd, dir: 1 | -1): Ymd {
  switch (mode) {
    case 'year':
      return addMonths(v, 12 * dir)
    case 'month':
      return addMonths(v, dir)
    case 'week':
      return addDays(v, 7 * dir)
    case 'day':
      return addDays(v, dir)
  }
}

export interface PeriodHeading {
  /** 大きく淡い数字（年は 2026、月は 11、週はその週の日曜の月、日は 10） */
  numeral: string
  /** 小さな表記の上の行（YEAR・NOV・WEEK・TUE） */
  top: string
  /** 小さな表記の下の行（年は空、2026、11.08–11.14、NOV 2026） */
  bottom: string
  /** 読み上げ（「2026年11月」など。大きな数字と小さな表記は飾りにして、こちらを読ませる） */
  spoken: string
}

/** 操作の列の大きな数字と小さな表記（docs/SPEC.md の 3.7 の表） */
export function periodHeading(mode: CalendarMode, v: Ymd): PeriodHeading {
  switch (mode) {
    case 'year':
      return { numeral: String(v.y), top: 'YEAR', bottom: '', spoken: `${v.y}年` }
    case 'month':
      return { numeral: String(v.m), top: MONTHS_EN[v.m - 1], bottom: String(v.y), spoken: `${v.y}年${v.m}月` }
    case 'week': {
      const s = weekStart(v)
      const e = addDays(s, 6)
      const end = e.y === s.y ? `${e.m}月${e.d}日` : `${e.y}年${e.m}月${e.d}日`
      return {
        numeral: String(s.m),
        top: 'WEEK',
        bottom: `${pad2(s.m)}.${pad2(s.d)}–${pad2(e.m)}.${pad2(e.d)}`,
        spoken: `${s.y}年${s.m}月${s.d}日から${end}までの週`,
      }
    }
    case 'day':
      return {
        numeral: String(v.d),
        top: WEEKDAYS_EN[weekdayOf(v)],
        bottom: `${MONTHS_EN[v.m - 1]} ${v.y}`,
        spoken: `${v.y}年${v.m}月${v.d}日（${WEEKDAYS_JA[weekdayOf(v)]}）`,
      }
  }
}
