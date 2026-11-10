// 暦の日付の計算（docs/SPEC.md の 2.9・2.10・6.4）: 月の日数（うるう年）・週の初め（日曜）・月を移る（その月に無い日は最終日）・
// 次の 0時まで・マンスリーのマス目の行の数（9.1）・ログインの画面の日付（2.5）
import { describe, expect, it } from 'vitest'
import {
  addDays,
  addMonths,
  coverDateLabel,
  daysInMonth,
  monthWeeks,
  msUntilNextDay,
  todayYmd,
  weekStart,
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
