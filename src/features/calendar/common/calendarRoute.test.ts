// カレンダーの行き先を読む・直す決まり（docs/SPEC.md の 3.1・3.7・6.4。確かめ A2・A4。D02・D04）:
// トップ #/ の置き換え、正しくない行き先、日曜でない週、見ている日の決め方、［‹］［›］の月末、裏から戻って6時間の今日
import { describe, expect, it } from 'vitest'
import {
  clampToRouteYears,
  inPeriod,
  isRoutable,
  parseCalendarPath,
  periodRange,
  resolveViewed,
  RETURN_TO_TODAY_MS,
  returnToTodayTarget,
  shiftViewed,
} from './calendarRoute'

const TODAY = '2026-11-10'

describe('parseCalendarPath（3.1 の行き先）', () => {
  it('トップ #/ は前回のモードの今日を含む期間へ置き換える（初めはマンスリー。FRAME-001）', () => {
    expect(parseCalendarPath('/', TODAY, 'month')).toEqual({
      mode: 'month',
      from: '2026-11-01',
      to: '2026-11-30',
      date: TODAY,
      replaceTo: '/month/2026-11',
    })
    expect(parseCalendarPath('/', TODAY, 'week')).toMatchObject({ mode: 'week', replaceTo: '/week/2026-11-08', date: TODAY })
    expect(parseCalendarPath('/', TODAY, 'year')).toMatchObject({ mode: 'year', replaceTo: '/year/2026' })
    expect(parseCalendarPath('/', TODAY, 'day')).toMatchObject({ mode: 'day', replaceTo: '/day/2026-11-10' })
  })

  it.each([
    ['/year/2026', 'year', '2026-01-01', '2026-12-31'],
    ['/month/2026-11', 'month', '2026-11-01', '2026-11-30'],
    ['/month/2028-02', 'month', '2028-02-01', '2028-02-29'],
    ['/week/2026-11-08', 'week', '2026-11-08', '2026-11-14'],
    ['/week/2026-12-27', 'week', '2026-12-27', '2027-01-02'],
    ['/day/2026-11-10', 'day', '2026-11-10', '2026-11-10'],
  ] as const)('正しい行き先 %s はそのまま（%s・%s〜%s）', (path, mode, from, to) => {
    expect(parseCalendarPath(path, TODAY, 'month')).toMatchObject({ mode, from, to, replaceTo: null })
  })

  it('日の行き先は、その日を見ている日にする。年・月・日曜の週は覚えている日から決める（date が null）', () => {
    expect(parseCalendarPath('/day/2026-11-12', TODAY, 'month')?.date).toBe('2026-11-12')
    expect(parseCalendarPath('/month/2026-12', TODAY, 'month')?.date).toBeNull()
    expect(parseCalendarPath('/year/2027', TODAY, 'month')?.date).toBeNull()
    expect(parseCalendarPath('/week/2026-11-15', TODAY, 'month')?.date).toBeNull()
  })

  it.each([
    ['/year/abc', '/year/2026'],
    ['/year/26', '/year/2026'],
    ['/year/1899', '/year/2026'],
    ['/year/2200', '/year/2026'],
    ['/month/2026-13', '/month/2026-11'],
    ['/month/26-11', '/month/2026-11'],
    ['/month/2026-1', '/month/2026-11'],
    ['/month/1899-12', '/month/2026-11'],
    ['/day/2026-02-30', '/day/2026-11-10'],
    ['/day/2027-02-29', '/day/2026-11-10'],
    ['/day/abc', '/day/2026-11-10'],
    ['/day/2200-01-01', '/day/2026-11-10'],
    ['/week/2026-02-30', '/week/2026-11-08'],
    ['/week/x', '/week/2026-11-08'],
  ])('日付の形が正しくない %s は同じモードの今日を含む期間 %s へ置き換える（見ている日は今日。FRAME-017・D04）', (path, to) => {
    const r = parseCalendarPath(path, TODAY, 'week')
    expect(r?.replaceTo).toBe(to)
    expect(r?.date).toBe(TODAY)
    expect(r && inPeriod(TODAY, r)).toBe(true)
  })

  it('#/week/ の日付が日曜でない時は、その日を見ている日にして、その週の日曜へ置き換える（FRAME-018）', () => {
    expect(parseCalendarPath('/week/2026-11-10', TODAY, 'month')).toEqual({
      mode: 'week',
      from: '2026-11-08',
      to: '2026-11-14',
      date: '2026-11-10',
      replaceTo: '/week/2026-11-08',
    })
    // 年をまたぐ週（2027年1月1日の週の日曜は 2026年12月27日）
    expect(parseCalendarPath('/week/2027-01-01', TODAY, 'month')).toMatchObject({
      date: '2027-01-01',
      replaceTo: '/week/2026-12-27',
    })
  })

  it('後ろの / は決まった書き方へ置き換える（同じ期間・見ている日は覚えている日から）', () => {
    expect(parseCalendarPath('/month/2026-11/', TODAY, 'month')).toMatchObject({ replaceTo: '/month/2026-11', date: null })
    expect(parseCalendarPath('/day/2026-11-12/', TODAY, 'month')).toMatchObject({ replaceTo: '/day/2026-11-12' })
  })

  it('年の端: 1900〜2199年の中の日を含む週は使える（1900年1月1日の週の日曜は 1899年12月31日）', () => {
    expect(parseCalendarPath('/week/1900-01-03', TODAY, 'month')).toMatchObject({
      replaceTo: '/week/1899-12-31',
      date: '1900-01-03',
    })
    expect(parseCalendarPath('/week/1899-12-31', TODAY, 'month')).toMatchObject({ replaceTo: null, from: '1899-12-31' })
    expect(parseCalendarPath('/week/1899-12-24', TODAY, 'month')?.replaceTo).toBe('/week/2026-11-08')
    expect(parseCalendarPath('/year/1900', TODAY, 'month')?.replaceTo).toBeNull()
    expect(parseCalendarPath('/year/2199', TODAY, 'month')?.replaceTo).toBeNull()
  })

  it('年の端の週の、年の外の日（日曜でない）を開いた時は、見ている日を年の中の日に寄せる（モードを替えて今日へ飛ばないように）', () => {
    // 2199年12月29日（日）〜2200年1月4日（土）の週
    expect(parseCalendarPath('/week/2200-01-02', TODAY, 'month')).toMatchObject({
      from: '2199-12-29',
      replaceTo: '/week/2199-12-29',
      date: '2199-12-31',
    })
  })

  it('カレンダーの行き先でなければ null（MIM・設定・#/month だけ・#/month/2026-11/x）', () => {
    for (const p of ['/mim', '/settings', '/login', '/month', '/month/2026-11/x', '/taskview/2026']) {
      expect(parseCalendarPath(p, TODAY, 'month'), p).toBeNull()
    }
  })

  it('端末の時計が行き先の年の外でも、置き換えを繰り返さない（今日の期間の行き先がそのままなら置き換えない）', () => {
    expect(parseCalendarPath('/year/2201', '2201-03-04', 'year')).toMatchObject({ replaceTo: null, date: '2201-03-04' })
  })
})

describe('isRoutable・periodRange', () => {
  it('期間（年 1/1〜12/31、月 1日〜最終日、週 日曜〜土曜、日 その日）', () => {
    expect(periodRange('year', '2026-11-10')).toEqual({ from: '2026-01-01', to: '2026-12-31' })
    expect(periodRange('month', '2027-02-14')).toEqual({ from: '2027-02-01', to: '2027-02-28' })
    expect(periodRange('week', '2026-11-14')).toEqual({ from: '2026-11-08', to: '2026-11-14' })
    expect(periodRange('day', '2026-11-10')).toEqual({ from: '2026-11-10', to: '2026-11-10' })
  })

  it('行き先にできる年（1900〜2199年）', () => {
    expect(isRoutable('year', '1900-01-01')).toBe(true)
    expect(isRoutable('year', '1899-12-31')).toBe(false)
    expect(isRoutable('day', '2199-12-31')).toBe(true)
    expect(isRoutable('month', '2200-01-01')).toBe(false)
    expect(isRoutable('week', '1899-12-31')).toBe(true)
    expect(isRoutable('week', '1899-12-30')).toBe(false)
    expect(isRoutable('week', '2200-01-01')).toBe(true)
    expect(isRoutable('day', '2026-02-30')).toBe(false)
  })
})

describe('resolveViewed（見ている日。D02・確かめ A2）', () => {
  const nov = { from: '2026-11-01', to: '2026-11-30' }
  const dec = { from: '2026-12-01', to: '2026-12-31' }

  it('覚えている日が期間の中ならその日', () => {
    expect(resolveViewed(nov, '2026-11-25', TODAY)).toBe('2026-11-25')
  })

  it('覚えている日が外（無い）なら、今日が中なら今日', () => {
    expect(resolveViewed(nov, '2026-12-25', TODAY)).toBe(TODAY)
    expect(resolveViewed(nov, null, TODAY)).toBe(TODAY)
  })

  it('どちらも外なら期間の初めの日（年は 1/1、月は 1日、週は日曜）', () => {
    expect(resolveViewed(dec, '2026-11-25', TODAY)).toBe('2026-12-01')
    expect(resolveViewed({ from: '2027-01-01', to: '2027-12-31' }, null, TODAY)).toBe('2027-01-01')
    expect(resolveViewed({ from: '2026-11-15', to: '2026-11-21' }, '2026-11-10', TODAY)).toBe('2026-11-15')
  })

  it('覚えている日の形が正しくなければ使わない', () => {
    expect(resolveViewed(nov, '2026-11-31', TODAY)).toBe(TODAY)
  })

  it('1900年1月1日の週（日曜は 1899年12月31日）は 1900年1月1日を見ている日にする（年の外の日にしない。D04）', () => {
    const first = { from: '1899-12-31', to: '1900-01-06' }
    expect(resolveViewed(first, null, TODAY)).toBe('1900-01-01')
    expect(resolveViewed(first, '1899-12-31', TODAY)).toBe('1900-01-01')
    expect(resolveViewed(first, '1900-01-03', TODAY)).toBe('1900-01-03')
    expect(resolveViewed({ from: '2199-12-29', to: '2200-01-04' }, '2200-01-02', TODAY)).toBe('2199-12-31')
  })
})

describe('clampToRouteYears（行き先に使える年の中へ寄せる。D04）', () => {
  it.each([
    ['1899-12-31', '1900-01-01'],
    ['1900-01-01', '1900-01-01'],
    ['2026-11-10', '2026-11-10'],
    ['2199-12-31', '2199-12-31'],
    ['2200-01-04', '2199-12-31'],
  ])('%s → %s', (date, to) => {
    expect(clampToRouteYears(date)).toBe(to)
  })
})

describe('shiftViewed（［‹］［›］。FRAME-063・072）', () => {
  it('年は1年、月は1か月、週は7日、日は1日', () => {
    expect(shiftViewed('year', TODAY, 1)).toBe('2027-11-10')
    expect(shiftViewed('month', TODAY, -1)).toBe('2026-10-10')
    expect(shiftViewed('week', TODAY, 1)).toBe('2026-11-17')
    expect(shiftViewed('day', TODAY, -1)).toBe('2026-11-09')
  })

  it('月・年を移って見ている日がその月に無い時はその月の最終日（1/31 → › → 2/28、2028/2/29 → 翌年 → 2029/2/28）', () => {
    expect(shiftViewed('month', '2027-01-31', 1)).toBe('2027-02-28')
    expect(shiftViewed('month', '2028-01-31', 1)).toBe('2028-02-29')
    expect(shiftViewed('year', '2028-02-29', 1)).toBe('2029-02-28')
    expect(shiftViewed('month', '2026-03-31', -1)).toBe('2026-02-28')
  })

  it('年・月をまたぐ週と日', () => {
    expect(shiftViewed('week', '2026-12-30', 1)).toBe('2027-01-06')
    expect(shiftViewed('day', '2026-12-31', 1)).toBe('2027-01-01')
  })
})

describe('returnToTodayTarget（裏から戻って6時間。FRAME-278・CALENDAR-030）', () => {
  const base = new Date(2026, 10, 10, 22, 0).getTime()
  const just = RETURN_TO_TODAY_MS
  const minute = 60_000
  const input = (over: Partial<Parameters<typeof returnToTodayTarget>[0]>) => ({
    now: base + just,
    lastInteraction: base,
    prevToday: '2026-11-10',
    today: '2026-11-11',
    mode: 'day' as const,
    viewed: '2026-11-10',
    ...over,
  })

  it('6時間ちょうどたっていて、見ている期間が前の今日を含めば、新しい今日を含む期間へ', () => {
    expect(returnToTodayTarget(input({}))).toBe('/day/2026-11-11')
    expect(returnToTodayTarget(input({ mode: 'week' }))).toBe('/week/2026-11-08')
    expect(returnToTodayTarget(input({ mode: 'month', viewed: '2026-11-25' }))).toBe('/month/2026-11')
  })

  it('5時間59分では移さない', () => {
    expect(returnToTodayTarget(input({ now: base + just - minute }))).toBeNull()
  })

  it('見ている期間が前の今日を含まなければ、6時間たっていても移さない', () => {
    expect(returnToTodayTarget(input({ viewed: '2026-11-03' }))).toBeNull()
    expect(returnToTodayTarget(input({ mode: 'month', viewed: '2026-12-05' }))).toBeNull()
    expect(returnToTodayTarget(input({ mode: 'week', viewed: '2026-11-15', now: base + 10 * just }))).toBeNull()
  })

  it('日付が変わっていなくても、6時間たって前の今日を含めば今日の期間（同じ行き先でも返す。見ている日を今日にする）', () => {
    expect(returnToTodayTarget(input({ today: '2026-11-10', mode: 'month', viewed: '2026-11-25' }))).toBe('/month/2026-11')
  })

  it('年をまたいでも新しい今日の年へ', () => {
    expect(returnToTodayTarget(input({ mode: 'year', prevToday: '2026-12-31', today: '2027-01-01', viewed: '2026-06-01' }))).toBe(
      '/year/2027',
    )
  })
})
