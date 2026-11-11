// 祝日（docs/SPEC.md の 7.2・6.4）: 2026年の表・画面に出す名前・表の無い年・同じ年は作り直さない・時差がマイナスの端末でも日がずれない。
// 部品を新しくした時に壊れていないかの確かめ（振替休日・国民の休日の決まりが表に入っているか）も置く（毎年2月ごろの部品の更新。7.2）
import holidayJp from '@holiday-jp/holiday_jp'
import { describe, expect, it, vi } from 'vitest'
import { addDaysYmd, weekdayOfYmd } from './dates'
import { HOLIDAY_YEARS, displayHolidayName, holidayName, holidaysOfYear } from './holidays'

/** 部品の表（名前は部品のまま） */
const RAW: Readonly<Record<string, { readonly name: string }>> = holidayJp.holidays
const isHoliday = (d: string) => Object.prototype.hasOwnProperty.call(RAW, d)

const H2026: [string, string][] = [
  ['2026-01-01', '元日'],
  ['2026-01-12', '成人の日'],
  ['2026-02-11', '建国記念の日'],
  ['2026-02-23', '天皇誕生日'],
  ['2026-03-20', '春分の日'],
  ['2026-04-29', '昭和の日'],
  ['2026-05-03', '憲法記念日'],
  ['2026-05-04', 'みどりの日'],
  ['2026-05-05', 'こどもの日'],
  ['2026-05-06', '振替休日'],
  ['2026-07-20', '海の日'],
  ['2026-08-11', '山の日'],
  ['2026-09-21', '敬老の日'],
  ['2026-09-22', '国民の休日'],
  ['2026-09-23', '秋分の日'],
  ['2026-10-12', 'スポーツの日'],
  ['2026-11-03', '文化の日'],
  ['2026-11-23', '勤労感謝の日'],
]

describe('祝日の表（7.2）', () => {
  it('2026年は 18日（振替休日 5/6・国民の休日 9/22 を含む）。日付の順', () => {
    expect([...holidaysOfYear(2026)]).toEqual(H2026)
  })

  it('7.2 の例: 5/6・9/22・11/3・11/23 は祝日、11/4 は祝日でない', () => {
    expect(holidayName('2026-05-06')).toBe('振替休日')
    expect(holidayName('2026-09-22')).toBe('国民の休日')
    expect(holidayName('2026-11-03')).toBe('文化の日')
    expect(holidayName('2026-11-23')).toBe('勤労感謝の日')
    expect(holidayName('2026-11-04')).toBeNull()
    expect(holidayName('2026-11-10')).toBeNull()
  })

  it('部品の名前は、そのままでは長い・分かりにくい物だけ縮める（開発）', () => {
    expect(RAW['2026-09-22'].name).toBe('休日')
    expect(RAW['2026-05-06'].name).toBe('こどもの日 振替休日')
    expect(displayHolidayName('休日')).toBe('国民の休日')
    expect(displayHolidayName('こどもの日 振替休日')).toBe('振替休日')
    expect(displayHolidayName('憲法記念日 振替休日')).toBe('振替休日')
    expect(displayHolidayName('文化の日')).toBe('文化の日')
    expect(displayHolidayName('休日（祝日扱い）')).toBe('休日（祝日扱い）')
  })

  it('表は 1970〜2050年。それより前と 2051年以降は祝日なし（落ちない・空の表）', () => {
    expect(HOLIDAY_YEARS).toEqual({ from: 1970, to: 2050 })
    expect(holidayName('1970-01-01')).toBe('元日')
    expect(holidayName('2050-11-23')).toBe('勤労感謝の日')
    expect(holidaysOfYear(1969).size).toBe(0)
    expect(holidaysOfYear(2051).size).toBe(0)
    expect(holidayName('1969-01-01')).toBeNull()
    expect(holidayName('2051-01-01')).toBeNull()
    expect(holidayName('2100-01-01')).toBeNull()
  })

  it('形の違う日付・年は祝日なし', () => {
    expect(holidayName('2026/11/03')).toBeNull()
    expect(holidayName('')).toBeNull()
    expect(holidaysOfYear(2026.5).size).toBe(0)
    expect(holidaysOfYear(Number.NaN).size).toBe(0)
  })

  it('同じ年は作り直さない（同じ表を返す）', () => {
    const a = holidaysOfYear(2027)
    expect(holidaysOfYear(2027)).toBe(a)
    expect(holidaysOfYear(2026)).not.toBe(a)
  })

  it('時差がマイナスの端末（America/Los_Angeles）でも 11/3 は文化の日（Date の暦を使わない。7.2・6.4）', async () => {
    vi.stubEnv('TZ', 'America/Los_Angeles')
    try {
      // between() が返す UTC の 0時の Date を、その端末の暦で読むと1日前にずれる（これを避ける）
      expect(new Date('2026-11-03').getDate()).toBe(2)
      vi.resetModules()
      const fresh = await import('./holidays')
      expect([...fresh.holidaysOfYear(2026)]).toEqual(H2026)
      expect(fresh.holidayName('2026-11-03')).toBe('文化の日')
      expect(fresh.holidayName('2026-11-02')).toBeNull()
      expect(fresh.holidayName('2027-01-01')).toBe('元日')
    } finally {
      vi.unstubAllEnvs()
    }
  })
})

describe('部品の表の確かめ（部品を新しくした時に壊れていないか）', () => {
  it('2007〜2050年: 日曜の祝日の後には、続く祝日の次に「… 振替休日」がある', () => {
    const missing: string[] = []
    for (const date of Object.keys(RAW)) {
      if (date < '2007-01-01' || weekdayOfYmd(date) !== 0) continue
      let next = addDaysYmd(date, 1)
      while (isHoliday(next) && !RAW[next].name.endsWith('振替休日')) next = addDaysYmd(next, 1)
      if (!isHoliday(next)) missing.push(date)
    }
    expect(missing).toEqual([])
  })

  it('1988〜2050年: 2つの祝日に挟まれた、日曜でない平日が無い（国民の休日になっている）', () => {
    const sandwiched: string[] = []
    for (let d = '1988-01-01'; d <= '2050-12-31'; d = addDaysYmd(d, 1)) {
      if (isHoliday(d) || weekdayOfYmd(d) === 0) continue
      if (isHoliday(addDaysYmd(d, -1)) && isHoliday(addDaysYmd(d, 1))) sandwiched.push(d)
    }
    expect(sandwiched).toEqual([])
  })

  it('どの年の表も、部品の表のその年の日と同じ数', () => {
    let total = 0
    for (let y = HOLIDAY_YEARS.from; y <= HOLIDAY_YEARS.to; y++) total += holidaysOfYear(y).size
    expect(total).toBe(Object.keys(RAW).length)
  })
})
