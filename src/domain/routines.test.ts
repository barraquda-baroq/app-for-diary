// ルーチンの戻る日と済み（docs/SPEC.md の 2.10・6.7・14.3 の表と例の全部）。日付を決めて確かめる（時計を進める代わりに today を渡す）
import { describe, expect, it } from 'vitest'
import {
  checkDatesOf,
  checkDatesProblem,
  checkToday,
  effectiveSpec,
  isRoutineDone,
  latestResetDay,
  nextResetDay,
  normalizeDates,
  routineProblems,
  uncheck,
} from './routines'
import { dataWith, mkCheck, mkRoutine } from './testData'

const daily = mkRoutine()
const weekly = mkRoutine({ cycle: 'weekly' })
const monThu = mkRoutine({ cycle: 'weekly', weekdays: [1, 4] })
const mon = mkRoutine({ cycle: 'weekly', weekdays: [1] })
const monthly = mkRoutine({ cycle: 'monthly' })
const on25 = mkRoutine({ cycle: 'monthly', monthDay: 25 })
const on31 = mkRoutine({ cycle: 'monthly', monthDay: 31 })
const quarterly = mkRoutine({ cycle: 'quarterly' })
const yearly = mkRoutine({ cycle: 'yearly' })
const mar15 = mkRoutine({ cycle: 'yearly', yearMonth: 3, yearDay: 15 })
const feb29 = mkRoutine({ cycle: 'yearly', yearMonth: 2, yearDay: 29 })

describe('いちばん新しい戻る日（14.3 の表）', () => {
  it('毎日は今日', () => {
    expect(latestResetDay(daily, '2026-11-10')).toBe('2026-11-10')
  })

  it('毎週（指定なし）は今日以前でいちばん近い日曜', () => {
    expect(latestResetDay(weekly, '2026-11-10')).toBe('2026-11-08')
    expect(latestResetDay(weekly, '2026-11-08')).toBe('2026-11-08')
    expect(latestResetDay(weekly, '2026-11-07')).toBe('2026-11-01')
  })

  it('毎週（曜日）は今日以前でいちばん近い、指定の曜日のどれかの日', () => {
    // 2026-11-10 は火曜
    expect(latestResetDay(monThu, '2026-11-10')).toBe('2026-11-09')
    expect(latestResetDay(monThu, '2026-11-12')).toBe('2026-11-12')
    expect(latestResetDay(monThu, '2026-11-15')).toBe('2026-11-12')
  })

  it('毎月（指定なし）は今月の1日、毎月（d）は今月の d 日か先月の d 日（無ければ最終日）', () => {
    expect(latestResetDay(monthly, '2026-11-10')).toBe('2026-11-01')
    expect(latestResetDay(on25, '2026-11-10')).toBe('2026-10-25')
    expect(latestResetDay(on25, '2026-11-25')).toBe('2026-11-25')
    expect(latestResetDay(on31, '2026-11-30')).toBe('2026-11-30')
    expect(latestResetDay(on31, '2026-12-05')).toBe('2026-11-30')
    expect(latestResetDay(on31, '2027-03-05')).toBe('2027-02-28')
  })

  it('四半期は今の四半期（1・4・7・10月）の1日', () => {
    expect(latestResetDay(quarterly, '2026-11-10')).toBe('2026-10-01')
    expect(latestResetDay(quarterly, '2026-03-31')).toBe('2026-01-01')
    expect(latestResetDay(quarterly, '2026-04-01')).toBe('2026-04-01')
  })

  it('毎年（指定なし）は今年の1月1日、毎年（m/d）は今年か去年の m/d（2/29 は平年は 2/28）', () => {
    expect(latestResetDay(yearly, '2026-11-10')).toBe('2026-01-01')
    expect(latestResetDay(mar15, '2026-11-10')).toBe('2026-03-15')
    expect(latestResetDay(mar15, '2026-03-14')).toBe('2025-03-15')
    expect(latestResetDay(feb29, '2027-03-01')).toBe('2027-02-28')
    expect(latestResetDay(feb29, '2028-02-29')).toBe('2028-02-29')
    expect(latestResetDay(feb29, '2027-02-27')).toBe('2026-02-28')
  })
})

describe('次の戻る日（14.3）', () => {
  it('種類ごと', () => {
    expect(nextResetDay(daily, '2026-11-10')).toBe('2026-11-11')
    expect(nextResetDay(weekly, '2026-11-10')).toBe('2026-11-15')
    expect(nextResetDay(weekly, '2026-11-15')).toBe('2026-11-22')
    expect(nextResetDay(monThu, '2026-11-10')).toBe('2026-11-12')
    expect(nextResetDay(monThu, '2026-11-12')).toBe('2026-11-16')
    expect(nextResetDay(monthly, '2026-11-10')).toBe('2026-12-01')
    expect(nextResetDay(monthly, '2026-12-31')).toBe('2027-01-01')
    expect(nextResetDay(on25, '2026-11-10')).toBe('2026-11-25')
    expect(nextResetDay(on25, '2026-11-25')).toBe('2026-12-25')
    expect(nextResetDay(quarterly, '2026-11-10')).toBe('2027-01-01')
    expect(nextResetDay(quarterly, '2026-01-01')).toBe('2026-04-01')
    expect(nextResetDay(yearly, '2026-11-10')).toBe('2027-01-01')
    expect(nextResetDay(mar15, '2026-11-10')).toBe('2027-03-15')
    expect(nextResetDay(mar15, '2026-03-14')).toBe('2026-03-15')
    expect(nextResetDay(feb29, '2026-11-10')).toBe('2027-02-28')
    expect(nextResetDay(feb29, '2027-12-01')).toBe('2028-02-29')
  })
})

describe('14.3 の例', () => {
  it('毎週（月）を水曜 11/11 にチェック → 月曜 11/16 の 0時に外れる', () => {
    const dates = checkToday([], '2026-11-11')
    expect(isRoutineDone(mon, dates, '2026-11-11')).toBe(true)
    expect(isRoutineDone(mon, dates, '2026-11-15')).toBe(true)
    expect(isRoutineDone(mon, dates, '2026-11-16')).toBe(false)
    expect(nextResetDay(mon, '2026-11-11')).toBe('2026-11-16')
  })

  it('毎月（25日）を 11/26 にチェック → 12/25 の 0時に外れる', () => {
    const dates = ['2026-11-26']
    expect(isRoutineDone(on25, dates, '2026-12-24')).toBe(true)
    expect(isRoutineDone(on25, dates, '2026-12-25')).toBe(false)
    expect(nextResetDay(on25, '2026-11-26')).toBe('2026-12-25')
  })

  it('毎月（31日）は 11月は 11/30 に戻る。2027/1/31 にチェック → 2/28 に外れる（2028年は 2/29）', () => {
    expect(nextResetDay(on31, '2026-11-10')).toBe('2026-11-30')
    expect(isRoutineDone(on31, ['2026-10-31'], '2026-11-29')).toBe(true)
    expect(isRoutineDone(on31, ['2026-10-31'], '2026-11-30')).toBe(false)
    expect(nextResetDay(on31, '2027-01-31')).toBe('2027-02-28')
    expect(isRoutineDone(on31, ['2027-01-31'], '2027-02-27')).toBe(true)
    expect(isRoutineDone(on31, ['2027-01-31'], '2027-02-28')).toBe(false)
    expect(nextResetDay(on31, '2028-01-31')).toBe('2028-02-29')
  })

  it('2/28 にチェック → 3/31 の 0時に外れる。1/30 にチェック → 1/31 の 0時に外れる', () => {
    expect(nextResetDay(on31, '2027-02-28')).toBe('2027-03-31')
    expect(isRoutineDone(on31, ['2027-02-28'], '2027-03-30')).toBe(true)
    expect(isRoutineDone(on31, ['2027-02-28'], '2027-03-31')).toBe(false)
    expect(nextResetDay(on31, '2027-01-30')).toBe('2027-01-31')
    expect(isRoutineDone(on31, ['2027-01-30'], '2027-01-31')).toBe(false)
  })

  it('毎日は次の日の 0時に外れる。四半期は次の四半期の1日に外れる', () => {
    expect(isRoutineDone(daily, ['2026-11-10'], '2026-11-10')).toBe(true)
    expect(isRoutineDone(daily, ['2026-11-10'], '2026-11-11')).toBe(false)
    expect(isRoutineDone(quarterly, ['2026-10-01'], '2026-12-31')).toBe(true)
    expect(isRoutineDone(quarterly, ['2026-10-01'], '2027-01-01')).toBe(false)
  })
})

describe('チェック・外す・記録の並び', () => {
  it('チェックは今日を足し、小さい順・重なりなし', () => {
    expect(checkToday(['2026-11-10', '2026-11-02'], '2026-11-05')).toEqual(['2026-11-02', '2026-11-05', '2026-11-10'])
    expect(checkToday(['2026-11-10'], '2026-11-10')).toEqual(['2026-11-10'])
  })

  it('外すと、いちばん新しい戻る日以後の記録を消す（前の回の記録は残す）', () => {
    expect(uncheck(['2026-11-03', '2026-11-09', '2026-11-10'], weekly, '2026-11-10')).toEqual(['2026-11-03'])
    expect(uncheck(['2026-10-05', '2026-11-10'], quarterly, '2026-11-10')).toEqual([])
  })

  it('normalizeDates は形の正しくない日付を除いて並べ直す', () => {
    expect(normalizeDates(['2026-11-10', 'x', '2026-11-01', '2026-11-10', 3])).toEqual(['2026-11-01', '2026-11-10'])
  })

  it('全部の月のチェックした日', () => {
    const data = dataWith({
      routineChecks: [mkCheck('r1', '2026-10', ['2026-10-30']), mkCheck('r1', '2026-11', ['2026-11-02']), mkCheck('r2', '2026-11', ['2026-11-03'])],
    })
    expect(checkDatesOf(data, 'r1')).toEqual(['2026-10-30', '2026-11-02'])
  })
})

describe('指定の確かめ（6.7）', () => {
  it('種類と指定の組', () => {
    expect(routineProblems(monThu)).toEqual([])
    expect(routineProblems(mar15)).toEqual([])
    expect(routineProblems(feb29)).toEqual([])
    expect(routineProblems({ ...daily, weekdays: [1] }).map((p) => p.fields)).toEqual([['cycle', 'weekdays']])
    expect(routineProblems({ ...weekly, monthDay: 3 }).map((p) => p.fields)).toEqual([['cycle', 'monthDay']])
    expect(routineProblems({ ...monthly, yearMonth: 3, yearDay: 1 }).map((p) => p.fields)).toEqual([['cycle', 'yearMonth', 'yearDay']])
  })

  it('範囲・並び・月日の片方だけ・知らない種類・件名', () => {
    expect(routineProblems({ ...weekly, weekdays: [7] })).toHaveLength(1)
    expect(routineProblems({ ...weekly, weekdays: [4, 1] })).toHaveLength(1)
    expect(routineProblems({ ...weekly, weekdays: [1, 1] })).toHaveLength(1)
    expect(routineProblems({ ...monthly, monthDay: 32 })).toHaveLength(1)
    expect(routineProblems({ ...yearly, yearMonth: 3, yearDay: null })).toHaveLength(1)
    expect(routineProblems({ ...yearly, yearMonth: 2, yearDay: 30 })).toHaveLength(1)
    expect(routineProblems({ ...daily, cycle: 'hourly' as never }).map((p) => p.fields)).toEqual([['cycle']])
    expect(routineProblems({ ...daily, title: '' }).map((p) => p.fields)).toEqual([['title']])
  })

  it('計算に使う指定は、合わない指定を「指定なし」とみなす', () => {
    expect(effectiveSpec({ ...monthly, weekdays: [1] }).weekdays).toEqual([])
    expect(effectiveSpec({ ...yearly, yearMonth: 3, yearDay: null })).toMatchObject({ yearMonth: null, yearDay: null })
    expect(effectiveSpec({ ...daily, cycle: 'hourly' as never }).cycle).toBe('daily')
    // 曜日の指定が無い時は日曜（指定の外れた毎週と同じ）
    expect(latestResetDay({ ...weekly, weekdays: [9] }, '2026-11-10')).toBe('2026-11-08')
  })
})

describe('チェックの記録の直す依頼の確かめ（19.4）', () => {
  it('足してよいのは依頼を作った日だけ、外せるのはいちばん新しい戻る日以後だけ', () => {
    // 毎週（指定なし）。依頼を作った日は 11/10（火）で、戻る日は 11/8（日）
    expect(checkDatesProblem(weekly, '2026-11', ['2026-11-03'], ['2026-11-03', '2026-11-10'], '2026-11-10')).toBeNull()
    expect(checkDatesProblem(weekly, '2026-11', ['2026-11-03'], ['2026-11-03', '2026-11-09'], '2026-11-10')).toMatch('今日')
    expect(checkDatesProblem(weekly, '2026-11', ['2026-11-03', '2026-11-09'], ['2026-11-03'], '2026-11-10')).toBeNull()
    expect(checkDatesProblem(weekly, '2026-11', ['2026-11-03', '2026-11-09'], ['2026-11-09'], '2026-11-10')).toMatch('前の回')
  })

  it('形・並び・ほかの月の日', () => {
    expect(checkDatesProblem(daily, '2026-11', [], ['2026-11-10', '2026-11-10'], '2026-11-10')).toMatch('小さい順')
    expect(checkDatesProblem(daily, '2026-11', [], ['2026-12-01'], '2026-12-01')).toMatch('その月')
    expect(checkDatesProblem(daily, '2026-11', [], 'x', '2026-11-10')).toMatch('形')
  })
})
