// 今日（docs/SPEC.md の 6.4・7.3）: PWA を開いたまま 0時を過ぎたら、次の 0時のタイマーで今日を計算し直す。
// 裏にあってタイマーが遅れた時も、画面が見えるようになった時・フォーカスが戻った時に計算し直す
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { coverDateLabel } from '../domain/dates'
import { useToday } from './hooks'

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
