// 画面の行き先の作り方（docs/SPEC.md の 3.1）: カレンダーの4つのモードの行き先と、カレンダーを出している行き先か
import { describe, expect, it } from 'vitest'
import { calendarModeOf, calendarPath, isCalendarPath, isMimPath, paths } from './routes'

describe('カレンダーのモードの行き先（3.1）', () => {
  it('年・月・週（日曜）・日の行き先を作る', () => {
    expect(paths.year(2026)).toBe('/year/2026')
    expect(paths.month(2026, 11)).toBe('/month/2026-11')
    expect(paths.month(2027, 1)).toBe('/month/2027-01')
    expect(paths.week('2026-11-08')).toBe('/week/2026-11-08')
    expect(paths.day('2026-11-10')).toBe('/day/2026-11-10')
  })

  it.each([
    ['year', '2026-11-10', '/year/2026'],
    ['month', '2026-11-10', '/month/2026-11'],
    ['week', '2026-11-10', '/week/2026-11-08'],
    ['week', '2026-11-08', '/week/2026-11-08'],
    ['week', '2026-11-14', '/week/2026-11-08'],
    // 年をまたぐ週（2026-12-27〜2027-01-02）は日曜の日付
    ['week', '2027-01-01', '/week/2026-12-27'],
    ['month', '2028-02-29', '/month/2028-02'],
    ['day', '2026-11-10', '/day/2026-11-10'],
  ] as const)('calendarPath(%s, %s) は %s', (mode, date, path) => {
    expect(calendarPath(mode, date)).toBe(path)
  })

  it('日付の形が違う時は、作らずに知らせる（呼ぶ側の誤り）', () => {
    expect(() => calendarPath('day', '2026-02-30')).toThrow()
    expect(() => calendarPath('month', 'abc')).toThrow()
  })

  it('行き先のモードを読む（トップ・ほかの画面・形の違う行き先は null）', () => {
    expect(calendarModeOf('/year/2026')).toBe('year')
    expect(calendarModeOf('/month/2026-11')).toBe('month')
    expect(calendarModeOf('/week/2026-11-08')).toBe('week')
    expect(calendarModeOf('/day/2026-11-10')).toBe('day')
    // 値が正しくなくてもモードの行き先（直すのは calendarRoute.ts）
    expect(calendarModeOf('/month/2026-13')).toBe('month')
    expect(calendarModeOf('/')).toBeNull()
    expect(calendarModeOf('/month')).toBeNull()
    expect(calendarModeOf('/month/2026-11/x')).toBeNull()
    expect(calendarModeOf('/mim')).toBeNull()
  })
})

describe('isCalendarPath（FRAME-007）', () => {
  it.each(['/', '/year/2026', '/month/2026-11', '/week/2026-11-08', '/day/2026-11-10', '/day/2026-11-10/'])(
    '%s はカレンダーを出している行き先',
    (p) => {
      expect(isCalendarPath(p)).toBe(true)
    },
  )

  it.each(['/mim', '/mim/abc', '/settings', '/login', '/month', '/month/2026-11/x', '/weeks/2026-11-08', '/yearly/2026'])(
    '%s はカレンダーではない',
    (p) => {
      expect(isCalendarPath(p)).toBe(false)
    },
  )

  it('MIM の行き先は今までどおり', () => {
    expect(isMimPath('/mim')).toBe(true)
    expect(isMimPath('/mim/n1')).toBe(true)
    expect(isMimPath('/month/2026-11')).toBe(false)
  })
})
