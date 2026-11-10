// 操作の列の大きな数字と小さな表記（docs/SPEC.md の 3.7 の表）、［‹］［›］での見ている日の移り方（3.7 の「見ている日を引き継ぐ」）。
// 暦の日付の計算そのもの（月の日数・週の初め・マンスリーのマス目・ログインの画面の日付）は src/domain/dates.test.ts
import { describe, expect, it } from 'vitest'
import type { Ymd } from '../../domain/dates'
import { periodHeading, shiftPeriod } from './calendarHeading'

const d = (y: number, m: number, day: number): Ymd => ({ y, m, d: day })

describe('periodHeading（3.7 の表）', () => {
  const nov10 = d(2026, 11, 10)

  it('年: 2026 ／ YEAR・空', () => {
    expect(periodHeading('year', nov10)).toEqual({ numeral: '2026', top: 'YEAR', bottom: '', spoken: '2026年' })
  })

  it('月: 11 ／ NOV・2026', () => {
    expect(periodHeading('month', nov10)).toEqual({ numeral: '11', top: 'NOV', bottom: '2026', spoken: '2026年11月' })
  })

  it('週: その週の日曜の月 ／ WEEK・11.08–11.14（週は日曜始まり）', () => {
    expect(periodHeading('week', nov10)).toMatchObject({ numeral: '11', top: 'WEEK', bottom: '11.08–11.14' })
    expect(periodHeading('week', d(2026, 11, 14)).bottom).toBe('11.08–11.14')
    expect(periodHeading('week', d(2026, 11, 15)).bottom).toBe('11.15–11.21')
  })

  it('週が月・年をまたぐ時、大きな数字は日曜の月（12.27–01.02 は 12）', () => {
    const h = periodHeading('week', d(2027, 1, 1))
    expect(h).toMatchObject({ numeral: '12', bottom: '12.27–01.02' })
    expect(h.spoken).toBe('2026年12月27日から2027年1月2日までの週')
  })

  it('日: 10 ／ TUE・NOV 2026', () => {
    expect(periodHeading('day', nov10)).toEqual({
      numeral: '10',
      top: 'TUE',
      bottom: 'NOV 2026',
      spoken: '2026年11月10日（火）',
    })
  })
})

describe('shiftPeriod（‹ ›。見ている日を引き継ぐ）', () => {
  it('年は1年、月は1か月、週は7日、日は1日', () => {
    const v = d(2026, 11, 10)
    expect(shiftPeriod('year', v, 1)).toEqual(d(2027, 11, 10))
    expect(shiftPeriod('month', v, -1)).toEqual(d(2026, 10, 10))
    expect(shiftPeriod('week', v, 1)).toEqual(d(2026, 11, 17))
    expect(shiftPeriod('day', v, -1)).toEqual(d(2026, 11, 9))
  })

  it('月・年をまたぐ（12月 → 1月、1月 → 12月、大晦日 → 元日）', () => {
    expect(shiftPeriod('month', d(2026, 12, 5), 1)).toEqual(d(2027, 1, 5))
    expect(shiftPeriod('month', d(2027, 1, 5), -1)).toEqual(d(2026, 12, 5))
    expect(shiftPeriod('day', d(2026, 12, 31), 1)).toEqual(d(2027, 1, 1))
    expect(shiftPeriod('week', d(2026, 12, 30), 1)).toEqual(d(2027, 1, 6))
  })

  it('見ている日がその月に無い時は、その月の最終日（1/31 → › → 2/28、2028/2/29 → 翌年 → 2/28）', () => {
    expect(shiftPeriod('month', d(2027, 1, 31), 1)).toEqual(d(2027, 2, 28))
    expect(shiftPeriod('month', d(2028, 1, 31), 1)).toEqual(d(2028, 2, 29))
    expect(shiftPeriod('month', d(2026, 3, 31), -1)).toEqual(d(2026, 2, 28))
    expect(shiftPeriod('year', d(2028, 2, 29), 1)).toEqual(d(2029, 2, 28))
    expect(shiftPeriod('year', d(2028, 2, 29), -1)).toEqual(d(2027, 2, 28))
  })
})
