// 暦の日付の計算（docs/SPEC.md の 2.9・2.10・6.4）: 月の日数（うるう年）・週の初め（日曜）・月を移る（その月に無い日は最終日）・
// 次の 0時まで・マンスリーのマス目の行の数（9.1）・ログインの画面の日付（2.5）・文字の日付（段階1）・無料枠の戻る時刻（2.8）
import { describe, expect, it } from 'vitest'
import {
  addDays,
  addDaysYmd,
  addMonths,
  addMonthsToMonth,
  compareYmd,
  coverDateLabel,
  dayInMonthClamped,
  daysInMonth,
  hmToMinutes,
  isHm,
  isMonth,
  isYmd,
  monthOf,
  monthWeeks,
  monthsBefore,
  msUntilNextDay,
  nextQuotaResetMs,
  parseYmd,
  quotaResumeAt,
  shortDateLabel,
  todayYmd,
  toYmd,
  weekStart,
  weekdayOfYmd,
  ymdOfMs,
  type Ymd,
} from './dates'

const d = (y: number, m: number, day: number): Ymd => ({ y, m, d: day })

describe('暦の小さな計算', () => {
  it('その月の日数（うるう年）', () => {
    expect(daysInMonth(2026, 2)).toBe(28)
    expect(daysInMonth(2028, 2)).toBe(29)
    expect(daysInMonth(2100, 2)).toBe(28)
    expect(daysInMonth(2000, 2)).toBe(29)
    expect(daysInMonth(2026, 11)).toBe(30)
  })

  it('週の初め（日曜）', () => {
    expect(weekStart(d(2026, 11, 8))).toEqual(d(2026, 11, 8))
    expect(weekStart(d(2026, 11, 10))).toEqual(d(2026, 11, 8))
    expect(weekStart(d(2026, 11, 1))).toEqual(d(2026, 11, 1))
    expect(weekStart(d(2027, 1, 1))).toEqual(d(2026, 12, 27))
  })

  it('日を足す（月・年をまたぐ）', () => {
    expect(addDays(d(2026, 12, 31), 1)).toEqual(d(2027, 1, 1))
    expect(addDays(d(2028, 3, 1), -1)).toEqual(d(2028, 2, 29))
  })

  it('月を移る。その日が無い月では最終日（1/31 → 2/28、2028/2/29 → 12か月後 → 2029/2/28）', () => {
    expect(addMonths(d(2026, 12, 5), 1)).toEqual(d(2027, 1, 5))
    expect(addMonths(d(2027, 1, 5), -1)).toEqual(d(2026, 12, 5))
    expect(addMonths(d(2027, 1, 31), 1)).toEqual(d(2027, 2, 28))
    expect(addMonths(d(2028, 2, 29), 12)).toEqual(d(2029, 2, 28))
    expect(addMonths(d(2028, 2, 29), -12)).toEqual(d(2027, 2, 28))
  })

  it('今日は端末の現地の日付', () => {
    expect(todayYmd(new Date(2026, 10, 10, 23, 59))).toEqual(d(2026, 11, 10))
    expect(todayYmd(new Date(2026, 10, 11, 0, 0))).toEqual(d(2026, 11, 11))
  })

  it('次の 0時までのミリ秒（今日の計算し直しのタイマー。6.4）', () => {
    expect(msUntilNextDay(new Date(2026, 10, 10, 23, 59, 30))).toBe(30_000)
    expect(msUntilNextDay(new Date(2026, 10, 10, 0, 0, 0))).toBe(24 * 60 * 60 * 1000)
    expect(msUntilNextDay(new Date(2026, 11, 31, 12, 0, 0))).toBe(12 * 60 * 60 * 1000)
  })
})

describe('monthWeeks（9.1: 行はその月に掛かる週の数。4〜6行）', () => {
  it('2026年11月は日曜始まりで5行。前後の月の日に印を付ける', () => {
    const weeks = monthWeeks(2026, 11)
    expect(weeks).toHaveLength(5)
    expect(weeks.every((w) => w.length === 7)).toBe(true)
    expect(weeks[0][0]).toEqual({ date: d(2026, 11, 1), outside: false })
    expect(weeks[4][1]).toEqual({ date: d(2026, 11, 30), outside: false })
    expect(weeks[4][2]).toEqual({ date: d(2026, 12, 1), outside: true })
  })

  it('4行（2026年2月は日曜の1日から28日まで）と6行（2026年8月）', () => {
    expect(monthWeeks(2026, 2)).toHaveLength(4)
    const aug = monthWeeks(2026, 8)
    expect(aug).toHaveLength(6)
    expect(aug[0][0]).toEqual({ date: d(2026, 7, 26), outside: true })
    expect(aug[0][6]).toEqual({ date: d(2026, 8, 1), outside: false })
  })
})

describe('coverDateLabel（ログインの画面の日付。2.5）', () => {
  it('「TUE · 2026.11.10」の形', () => {
    expect(coverDateLabel(d(2026, 11, 10))).toBe('TUE · 2026.11.10')
    expect(coverDateLabel(d(2027, 1, 3))).toBe('SUN · 2027.01.03')
  })
})

describe('文字の日付（6.4）', () => {
  it('YYYY-MM-DD の形と暦（うるう年・月末・形の正しくない文字）', () => {
    expect(isYmd('2026-11-10')).toBe(true)
    expect(isYmd('2028-02-29')).toBe(true)
    expect(isYmd('2026-02-29')).toBe(false)
    expect(isYmd('2100-02-29')).toBe(false)
    expect(isYmd('2026-11-31')).toBe(false)
    expect(isYmd('2026-13-01')).toBe(false)
    expect(isYmd('2026-1-10')).toBe(false)
    expect(isYmd('2026/11/10')).toBe(false)
    expect(isYmd('2026-11-10T00:00')).toBe(false)
    expect(isYmd(null)).toBe(false)
    expect(isYmd(20261110)).toBe(false)
    expect(parseYmd('2026-11-10')).toEqual(d(2026, 11, 10))
    expect(toYmd(d(2027, 1, 3))).toBe('2027-01-03')
  })

  it('HH:MM（24:00 は終了だけ）', () => {
    expect(isHm('09:07')).toBe(true)
    expect(isHm('23:59')).toBe(true)
    expect(isHm('24:00')).toBe(false)
    expect(isHm('24:00', true)).toBe(true)
    expect(isHm('24:01', true)).toBe(false)
    expect(isHm('9:00')).toBe(false)
    expect(isHm('12:60')).toBe(false)
    expect(hmToMinutes('24:00')).toBe(1440)
    expect(hmToMinutes('09:07')).toBe(547)
  })

  it('月（YYYY-MM）と月の計算', () => {
    expect(isMonth('2026-11')).toBe(true)
    expect(isMonth('2026-00')).toBe(false)
    expect(isMonth('2026-13')).toBe(false)
    expect(monthOf('2026-11-10')).toBe('2026-11')
    expect(addMonthsToMonth('2026-11', 2)).toBe('2027-01')
    expect(addMonthsToMonth('2026-01', -1)).toBe('2025-12')
    // 月の束の境: 今が 2026年11月なら、3か月前は 8月（7月まで束にする。6.11）
    expect(monthsBefore('2026-11', 3)).toBe('2026-08')
    expect(monthsBefore('2026-02', 3)).toBe('2025-11')
  })

  it('日を足す・比べる・曜日・その月に無い日は最終日', () => {
    expect(addDaysYmd('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDaysYmd('2028-03-01', -1)).toBe('2028-02-29')
    expect(() => addDaysYmd('2026-02-30', 1)).toThrow()
    expect(compareYmd('2026-11-09', '2026-11-10')).toBeLessThan(0)
    expect(compareYmd('2026-11-10', '2026-11-10')).toBe(0)
    expect(weekdayOfYmd('2026-11-10')).toBe(2)
    expect(dayInMonthClamped(2027, 2, 31)).toBe('2027-02-28')
    expect(dayInMonthClamped(2028, 2, 31)).toBe('2028-02-29')
    expect(dayInMonthClamped(2026, 11, 31)).toBe('2026-11-30')
    expect(shortDateLabel('2026-11-10')).toBe('11/10（火）')
  })

  it('ミリ秒の日時の、端末の暦の日付（日の変わり目は端末の 0時）', () => {
    expect(ymdOfMs(new Date(2026, 10, 10, 23, 59, 59).getTime())).toBe('2026-11-10')
    expect(ymdOfMs(new Date(2026, 10, 11, 0, 0, 0).getTime())).toBe('2026-11-11')
  })
})

describe('無料枠の戻る時刻（2.8。米国太平洋時間の 0時を端末の時刻に）', () => {
  it('日本では 17:00、米国の夏時間の間は 16:00', () => {
    // 2026-11-10 は太平洋標準時（夏時間は 11/1 に終わった）
    expect(quotaResumeAt(Date.UTC(2026, 10, 10, 3, 0), 'Asia/Tokyo')).toBe('17:00')
    // 2026-07-01 は夏時間
    expect(quotaResumeAt(Date.UTC(2026, 6, 1, 3, 0), 'Asia/Tokyo')).toBe('16:00')
    // 米国東部では 3:00（夏時間の間も 3:00）
    expect(quotaResumeAt(Date.UTC(2026, 10, 10, 3, 0), 'America/New_York')).toBe('03:00')
    expect(quotaResumeAt(Date.UTC(2026, 6, 1, 3, 0), 'America/New_York')).toBe('03:00')
  })

  it('夏時間の切り替わる日の前後（2026-11-01 に終わり、2026-03-08 に始まる）', () => {
    // 10/31（夏時間）の次の 0時は 11/1 0:00 PDT = 07:00 UTC
    expect(nextQuotaResetMs(Date.UTC(2026, 9, 31, 12, 0))).toBe(Date.UTC(2026, 10, 1, 7, 0))
    expect(quotaResumeAt(Date.UTC(2026, 9, 31, 12, 0), 'Asia/Tokyo')).toBe('16:00')
    // 11/1（標準時に戻った日）の次の 0時は 11/2 0:00 PST = 08:00 UTC
    expect(nextQuotaResetMs(Date.UTC(2026, 10, 1, 12, 0))).toBe(Date.UTC(2026, 10, 2, 8, 0))
    expect(quotaResumeAt(Date.UTC(2026, 10, 1, 12, 0), 'Asia/Tokyo')).toBe('17:00')
    // 3/7（標準時）→ 3/8 0:00 PST = 08:00 UTC、3/8（夏時間に入った日）→ 3/9 0:00 PDT = 07:00 UTC
    expect(nextQuotaResetMs(Date.UTC(2026, 2, 7, 12, 0))).toBe(Date.UTC(2026, 2, 8, 8, 0))
    expect(nextQuotaResetMs(Date.UTC(2026, 2, 8, 12, 0))).toBe(Date.UTC(2026, 2, 9, 7, 0))
  })

  it('ちょうど 0時なら次の日の 0時', () => {
    expect(nextQuotaResetMs(Date.UTC(2026, 10, 11, 8, 0))).toBe(Date.UTC(2026, 10, 12, 8, 0))
    expect(nextQuotaResetMs(Date.UTC(2026, 10, 11, 7, 59))).toBe(Date.UTC(2026, 10, 11, 8, 0))
  })
})
