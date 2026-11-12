// 動きの共通の決まり（docs/SPEC.md の 4.9）: 視差効果を減らす設定では、なめらかなスクロールをやめる。
// 目立たせる枠・ロック中の揺れ・その代わりのロックの印の色を、決まった時間だけ付けて外す
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  FLASH_MS,
  LOCK_ACCENT_MS,
  SHAKE_MS,
  TURN_MS,
  flash,
  prefersReducedMotion,
  scrollBehavior,
  shake,
  vibrate15,
} from './motion'

const original = window.matchMedia

function setReducedMotion(reduce: boolean | null) {
  window.matchMedia =
    reduce === null
      ? (undefined as unknown as typeof window.matchMedia)
      : (((query: string) => ({
          matches: reduce && query.includes('prefers-reduced-motion: reduce'),
          media: query,
        })) as unknown as typeof window.matchMedia)
}

afterEach(() => {
  window.matchMedia = original
})

describe('scrollBehavior（4.9）', () => {
  it('ふだんは smooth', () => {
    setReducedMotion(false)
    expect(prefersReducedMotion()).toBe(false)
    expect(scrollBehavior()).toBe('smooth')
  })

  it('視差効果を減らす設定では auto', () => {
    setReducedMotion(true)
    expect(prefersReducedMotion()).toBe(true)
    expect(scrollBehavior()).toBe('auto')
  })

  it('matchMedia の無い所では smooth', () => {
    setReducedMotion(null)
    expect(scrollBehavior()).toBe('smooth')
  })
})

describe('目立たせる・揺らす（4.9）', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('時間は 1,200ms・240ms・600ms・ページをめくる 420ms（--dur-turn）', () => {
    expect([FLASH_MS, SHAKE_MS, LOCK_ACCENT_MS, TURN_MS]).toEqual([1200, 240, 600, 420])
  })

  it.each([false, true])('目立たせる枠は 1.2秒付けて外す（視差効果を減らす設定 %s でも同じ時間。FRAME-231・236）', (reduce) => {
    setReducedMotion(reduce)
    const el = document.createElement('div')
    flash(el)
    expect(el.classList.contains('flash')).toBe(true)
    vi.advanceTimersByTime(FLASH_MS - 1)
    expect(el.classList.contains('flash')).toBe(true)
    vi.advanceTimersByTime(1)
    expect(el.classList.contains('flash')).toBe(false)
  })

  it('目立たせている間にもう一度目立たせると、そこから 1.2秒数え直す', () => {
    setReducedMotion(false)
    const el = document.createElement('div')
    flash(el)
    vi.advanceTimersByTime(1000)
    flash(el)
    vi.advanceTimersByTime(1000)
    expect(el.classList.contains('flash')).toBe(true)
    vi.advanceTimersByTime(200)
    expect(el.classList.contains('flash')).toBe(false)
    // 要素が無い時は何もしない
    expect(() => flash(null)).not.toThrow()
  })

  it('ふだんは 240ms 揺らし、ロックの印の色は変えない（FRAME-232）', () => {
    setReducedMotion(false)
    const card = document.createElement('div')
    const lock = document.createElement('span')
    card.appendChild(lock)
    shake(card, lock)
    expect(card.classList.contains('shake')).toBe(true)
    expect(lock.classList.contains('lock-accent')).toBe(false)
    vi.advanceTimersByTime(SHAKE_MS)
    expect(card.classList.contains('shake')).toBe(false)
  })

  it('視差効果を減らす設定では揺らさず、ロックの印を 600ms だけ --accent にする（FRAME-235）', () => {
    setReducedMotion(true)
    const card = document.createElement('div')
    const lock = document.createElement('span')
    card.appendChild(lock)
    shake(card, lock)
    expect(card.classList.contains('shake')).toBe(false)
    expect(lock.classList.contains('lock-accent')).toBe(true)
    vi.advanceTimersByTime(LOCK_ACCENT_MS - 1)
    expect(lock.classList.contains('lock-accent')).toBe(true)
    vi.advanceTimersByTime(1)
    expect(lock.classList.contains('lock-accent')).toBe(false)
    // ロックの印を渡さない時は、その要素に付ける
    shake(card)
    expect(card.classList.contains('lock-accent')).toBe(true)
  })

  it('掴めた時の振動は 15ms。振動できない端末では何もしない', () => {
    const vibrate = vi.fn(() => true)
    Object.defineProperty(navigator, 'vibrate', { configurable: true, value: vibrate })
    vibrate15()
    expect(vibrate).toHaveBeenCalledWith(15)
    Object.defineProperty(navigator, 'vibrate', { configurable: true, value: undefined })
    expect(() => vibrate15()).not.toThrow()
  })
})

describe('なめらかなスクロールは motion.ts を通す（FRAME-237・CALENDAR-265）', () => {
  // テストでは import.meta.glob で src/ の TS・TSX を文字として読む（node:fs の型はアプリの tsconfig に無いので）
  const sources = import.meta.glob(['../**/*.{ts,tsx}', '!../**/*.test.{ts,tsx}', '!./motion.ts'], {
    query: '?raw',
    import: 'default',
    eager: true,
  }) as Record<string, string>

  it('src/ の TS・TSX を読めている', () => {
    expect(Object.keys(sources)).toContain('../main.tsx')
    expect(Object.keys(sources).length).toBeGreaterThan(50)
  })

  it("behavior: 'smooth' を直接書かない（scrollBehavior() を使う）", () => {
    const smooth = Object.entries(sources)
      .filter(([, source]) => /behavior\s*:\s*['"]smooth['"]/.test(source))
      .map(([file]) => file)
    expect(smooth).toEqual([])
  })
})
