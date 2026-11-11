// 今日（docs/SPEC.md の 6.4・7.3）: PWA を開いたまま 0時を過ぎたら、次の 0時のタイマーで今日を計算し直す。
// 裏にあってタイマーが遅れた時も、画面が見えるようになった時・フォーカスが戻った時に計算し直す。
// 段階2の今の時刻（1分ごと。11.3）・上に載せられる端末か（D43）・要素の大きさ（D53）
import { act, cleanup, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { coverDateLabel } from '../domain/dates'
import { resizeObserved } from '../test/renderCalendar'
import { useElementSize, useHoverCapable, useNow, useToday } from './hooks'

let renders = 0

function Today() {
  renders++
  return <p data-testid="today">{coverDateLabel(useToday())}</p>
}

beforeEach(() => {
  renders = 0
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 10, 10, 23, 59, 30))
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('useToday（6.4）', () => {
  it('次の 0時を過ぎたら、次の日になる', () => {
    render(<Today />)
    expect(screen.getByTestId('today').textContent).toBe('TUE · 2026.11.10')
    act(() => vi.advanceTimersByTime(20_000))
    expect(screen.getByTestId('today').textContent).toBe('TUE · 2026.11.10')
    act(() => vi.advanceTimersByTime(12_000))
    expect(screen.getByTestId('today').textContent).toBe('WED · 2026.11.11')
    // その次の 0時でも変わる（タイマーを掛け直している）
    act(() => vi.advanceTimersByTime(24 * 60 * 60 * 1000))
    expect(screen.getByTestId('today').textContent).toBe('THU · 2026.11.12')
  })

  it('タイマーが遅れても、画面が見えるようになった時・フォーカスが戻った時に計算し直す', () => {
    render(<Today />)
    // 時計だけが進んだ（端末が眠っていてタイマーが動かなかった）
    vi.setSystemTime(new Date(2026, 10, 12, 8, 0))
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(screen.getByTestId('today').textContent).toBe('THU · 2026.11.12')
    vi.setSystemTime(new Date(2026, 10, 13, 8, 0))
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    expect(screen.getByTestId('today').textContent).toBe('FRI · 2026.11.13')
  })

  it('日付が変わらない時は描き直さない', () => {
    render(<Today />)
    const before = renders
    act(() => {
      window.dispatchEvent(new Event('focus'))
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(renders).toBe(before)
  })
})

describe('useNow（11.3 の今の時刻の線）', () => {
  function Now({ ms }: { ms?: number }) {
    const now = new Date(useNow(ms))
    return <p data-testid="now">{`${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`}</p>
  }

  it('分の変わり目で描き直す（1分ごと）', () => {
    render(<Now />)
    expect(screen.getByTestId('now').textContent).toBe('23:59')
    act(() => vi.advanceTimersByTime(29_000))
    expect(screen.getByTestId('now').textContent).toBe('23:59')
    act(() => vi.advanceTimersByTime(1_000))
    expect(screen.getByTestId('now').textContent).toBe('0:00')
    act(() => vi.advanceTimersByTime(60_000))
    expect(screen.getByTestId('now').textContent).toBe('0:01')
  })

  it('タイマーが遅れても、画面が見えるようになった時に計算し直す', () => {
    render(<Now />)
    vi.setSystemTime(new Date(2026, 10, 11, 8, 30, 10))
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(screen.getByTestId('now').textContent).toBe('8:30')
  })
})

describe('useHoverCapable（D43）', () => {
  const original = window.matchMedia
  afterEach(() => {
    window.matchMedia = original
  })

  function Hover() {
    return <p data-testid="hover">{String(useHoverCapable())}</p>
  }

  it.each([
    [true, 'true'],
    [false, 'false'],
  ])('(hover: hover) and (pointer: fine) が %s なら %s', (fine, shown) => {
    window.matchMedia = ((query: string) => ({
      matches: query === '(hover: hover) and (pointer: fine)' && fine,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia
    render(<Hover />)
    expect(screen.getByTestId('hover').textContent).toBe(shown)
  })
})

describe('useElementSize（D53）', () => {
  let renders2 = 0
  function Sized() {
    renders2++
    const ref = useRef<HTMLDivElement>(null)
    const { width, height } = useElementSize(ref)
    return (
      <div ref={ref} data-testid="sized">
        {width}x{height}
      </div>
    )
  }

  it('測った大きさを返し、変わった時だけ描き直す。外すと見るのをやめる', () => {
    renders2 = 0
    const { unmount } = render(<Sized />)
    // jsdom は測らないので 0×0
    expect(screen.getByTestId('sized').textContent).toBe('0x0')
    act(() => resizeObserved(870, 600))
    expect(screen.getByTestId('sized').textContent).toBe('870x600')
    const before = renders2
    act(() => resizeObserved(870, 600))
    expect(renders2).toBe(before)
    act(() => resizeObserved(869, 600, screen.getByTestId('sized')))
    expect(screen.getByTestId('sized').textContent).toBe('869x600')
    unmount()
    expect(() => resizeObserved(100, 100)).not.toThrow()
  })

  it('描く前の1回目も、ResizeObserver と同じ中身の箱（枠線・内側の余白を除く）で測る', () => {
    // 外の箱 920×640、枠線 2px・内側の余白 上下 10px・左右 20px → 中身 876×616
    const spy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 920, 640))
    function Padded() {
      const ref = useRef<HTMLDivElement>(null)
      const { width, height } = useElementSize(ref)
      return (
        <div ref={ref} data-testid="padded" style={{ padding: '10px 20px', borderWidth: 2, borderStyle: 'solid' }}>
          {width}x{height}
        </div>
      )
    }
    render(<Padded />)
    expect(screen.getByTestId('padded').textContent).toBe('876x616')
    spy.mockRestore()
  })
})
