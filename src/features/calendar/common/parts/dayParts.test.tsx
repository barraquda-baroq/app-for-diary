// 日の見出しの部品: 曜日の丸いラベル（DayPill。4.4-5・7.1・7.3・7.4）・祝日名（HolidayName。7.2）・「休」（OffMark。7.4）
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { setupCalendarTests } from '../../../../test/renderCalendar'
import { DayPill } from './DayPill'
import { HolidayName } from './HolidayName'
import { OffMark } from './OffMark'

setupCalendarTests()

const pill = (c: HTMLElement) => c.querySelector('.cp-pill') as HTMLElement

describe('曜日の丸いラベル（DayPill）', () => {
  it('中は等幅の英字3文字（.caps）、読み上げは日本語（「火曜日」。FRAME-257・CALENDAR-051・052）', () => {
    const { container } = render(<DayPill date="2026-11-10" today="2026-11-12" />)
    const el = pill(container)
    expect(el.classList.contains('pill')).toBe(true)
    const caps = el.querySelector('.caps') as HTMLElement
    expect(caps.textContent).toBe('TUE')
    expect(caps.getAttribute('aria-hidden')).toBe('true')
    expect(el.querySelector('.visually-hidden')?.textContent).toBe('火曜日')
    expect(screen.getByText('火曜日')).toBeTruthy()
  })

  it.each([
    ['2026-11-08', 'SUN', '日曜日'],
    ['2026-11-09', 'MON', '月曜日'],
    ['2026-11-11', 'WED', '水曜日'],
    ['2026-11-12', 'THU', '木曜日'],
    ['2026-11-13', 'FRI', '金曜日'],
    ['2026-11-14', 'SAT', '土曜日'],
  ])('%s は %s（%s）', (date, en, ja) => {
    const { container } = render(<DayPill date={date} today="2026-11-10" />)
    expect(pill(container).querySelector('.caps')?.textContent).toBe(en)
    expect(pill(container).querySelector('.visually-hidden')?.textContent).toBe(ja)
  })

  it('今日は今日の印（.pill.is-today）で、aria-current="date"（CALENDAR-072・FRAME-156）', () => {
    const { container } = render(<DayPill date="2026-11-10" today="2026-11-10" />)
    const el = pill(container)
    expect(el.classList.contains('is-today')).toBe(true)
    expect(el.getAttribute('aria-current')).toBe('date')
    expect(el.classList.contains('is-off')).toBe(false)
  })

  it('今日でない日は今日の印も aria-current も無い', () => {
    const { container } = render(<DayPill date="2026-11-11" today="2026-11-10" />)
    expect(pill(container).classList.contains('is-today')).toBe(false)
    expect(pill(container).hasAttribute('aria-current')).toBe(false)
  })

  it('休みの日は地を --surface にする印（is-off。CALENDAR-083・FRAME-157）', () => {
    const { container } = render(<DayPill date="2026-11-11" today="2026-11-10" off />)
    expect(pill(container).classList.contains('is-off')).toBe(true)
  })

  it('今日が休みの日なら今日の印が勝つ（D16・AMB-CAL-02）', () => {
    const { container } = render(<DayPill date="2026-11-10" today="2026-11-10" off />)
    expect(pill(container).classList.contains('is-today')).toBe(true)
    expect(pill(container).classList.contains('is-off')).toBe(false)
  })

  it.each([
    ['2026-11-08', 'cp-sun'],
    ['2026-11-14', 'cp-sat'],
    ['2026-11-03', 'cp-sun'],
  ])('%s の曜日の色は %s（CALENDAR-053）。今日なら今日の印の字（色を付けない）', (date, tone) => {
    const { container, rerender } = render(<DayPill date={date} today="2026-11-10" />)
    expect(pill(container).classList.contains(tone)).toBe(true)
    rerender(<DayPill date={date} today={date} />)
    expect(pill(container).classList.contains(tone)).toBe(false)
  })

  it('平日は色を付けない', () => {
    const { container } = render(<DayPill date="2026-11-12" today="2026-11-10" />)
    expect(pill(container).className).not.toMatch(/cp-su|cp-sa/)
  })
})

describe('祝日名（HolidayName。CALENDAR-066・D21）', () => {
  it('祝日にはその名前（1行。title にも全部）', () => {
    const { container } = render(<HolidayName date="2026-11-03" className="wk-holiday" />)
    const el = container.querySelector('.cp-holiday') as HTMLElement
    expect(el.textContent).toBe('文化の日')
    expect(el.getAttribute('title')).toBe('文化の日')
    expect(el.classList.contains('wk-holiday')).toBe(true)
  })

  it('画面に出す形に縮めた名前（「休日」→「国民の休日」、「… 振替休日」→「振替休日」）', () => {
    const { container: a } = render(<HolidayName date="2026-09-22" />)
    expect(a.textContent).toBe('国民の休日')
    const { container: b } = render(<HolidayName date="2026-05-06" />)
    expect(b.textContent).toBe('振替休日')
  })

  it('祝日でない日・表の外の年は何も出さない', () => {
    expect(render(<HolidayName date="2026-11-04" />).container.innerHTML).toBe('')
    expect(render(<HolidayName date="2051-01-01" />).container.innerHTML).toBe('')
  })
})

describe('「休」（OffMark。CALENDAR-054・081）', () => {
  it('見える字は「休」、読み上げは「休み」', () => {
    const { container } = render(<OffMark className="mo-off" />)
    const el = container.querySelector('.cp-off') as HTMLElement
    expect(el.classList.contains('mo-off')).toBe(true)
    expect(el.querySelector('[aria-hidden="true"]')?.textContent).toBe('休')
    expect(el.querySelector('.visually-hidden')?.textContent).toBe('休み')
  })
})
