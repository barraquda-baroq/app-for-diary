// 移った先・押した区切りを目立たせる（useFlashTarget。4.9・FRAME-231・236・D32）。偽の時計で、枠（.flash）の付け外しを確かめる
import { act, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { T0 } from '../../../../domain/testData'
import { useCalendarUi } from '../../../../store/uiStore'
import { FLASH_MS } from '../../../../ui/motion'
import { scrollIntoViewWithin } from '../../../../ui/scrollWithin'
import { renderView, setupCalendarTests } from '../../../../test/renderCalendar'
import { FLASH_STALE_MS, flashKey, useFlashTarget } from './useFlashTarget'

// 見える所まで動かすのは src/ui/scrollWithin.ts（中身はそのまま動かし、呼ばれた物を見る）
vi.mock('../../../../ui/scrollWithin', { spy: true })

setupCalendarTests()

beforeEach(() => {
  vi.useFakeTimers({ now: T0 })
})
afterEach(() => {
  vi.useRealTimers()
})

interface BoxProps {
  keys: string | readonly string[] | null
  scroll?: boolean
  className?: string
  show?: boolean
}

/** 目立たせられる要素（カード・区切りの代わり） */
function Box({ keys, scroll, className = 'card', show = true }: BoxProps) {
  const ref = useFlashTarget<HTMLDivElement>(keys, { scroll })
  return show ? <div ref={ref} className={className} data-testid="box" /> : null
}

const box = () => screen.getByTestId('box')
const flashed = () => box().classList.contains('flash')
const target = (...keys: string[]) => act(() => useCalendarUi.getState().flashTarget(...keys))
const wait = (ms: number) => act(() => vi.advanceTimersByTime(ms))

describe('キー', () => {
  it('予定・デイリーの区切り・タイムスケジュールのその区分の予定（uiStore の flash のキー）', () => {
    expect(flashKey.item('a1')).toBe('item:a1')
    expect(flashKey.dayArea('work')).toBe('day-area:work')
    expect(flashKey.dayEvents('private')).toBe('day-events:private')
  })
})

describe('キーが合うと 1.2秒だけ .flash の枠（FRAME-231）', () => {
  it('付けてから 1,200ms で外す', async () => {
    await renderView<BoxProps>(Box, { keys: flashKey.item('a') })
    expect(flashed()).toBe(false)
    target(flashKey.item('a'))
    expect(flashed()).toBe(true)
    await wait(FLASH_MS - 1)
    expect(flashed()).toBe(true)
    await wait(1)
    expect(flashed()).toBe(false)
  })

  it('視差効果を減らす設定でも同じ 1.2秒（薄くしないのは CSS。FRAME-236）', async () => {
    await renderView<BoxProps>(Box, { keys: flashKey.item('a') }, { reducedMotion: true })
    target(flashKey.item('a'))
    expect(flashed()).toBe(true)
    await wait(FLASH_MS)
    expect(flashed()).toBe(false)
  })

  it('キーの合わない所は目立たせない', async () => {
    await renderView<BoxProps>(Box, { keys: flashKey.item('a') })
    target(flashKey.item('b'))
    expect(flashed()).toBe(false)
  })

  it('キーが無い（null）時は何もしない', async () => {
    await renderView<BoxProps>(Box, { keys: null })
    target(flashKey.item('a'))
    expect(flashed()).toBe(false)
  })

  it('いくつものキーのどれかで目立つ（マンスリーの数字から来た時の区切りと予定。7.12・11.2）', async () => {
    await renderView<BoxProps>(Box, { keys: [flashKey.item('e1'), flashKey.dayEvents('work')] })
    target(flashKey.dayArea('work'), flashKey.dayEvents('work'))
    expect(flashed()).toBe(true)
  })

  it('同じ所をもう一度目立たせると、また枠を出す（seq が替わる）', async () => {
    await renderView<BoxProps>(Box, { keys: flashKey.item('a') })
    target(flashKey.item('a'))
    await wait(FLASH_MS)
    expect(flashed()).toBe(false)
    target(flashKey.item('a'))
    expect(flashed()).toBe(true)
  })

  it('目立たせる時の地の色は変えない（枠だけ。要素の className はそのまま）', async () => {
    await renderView<BoxProps>(Box, { keys: flashKey.item('a'), className: 'wk-card is-work' })
    target(flashKey.item('a'))
    expect(box().className).toBe('wk-card is-work flash')
  })
})

describe('描き直し・出る順', () => {
  it('目立たせている間に className が替わって枠が消えたら付け直す', async () => {
    const { setProps } = await renderView<BoxProps>(Box, { keys: flashKey.item('a'), className: 'card' })
    target(flashKey.item('a'))
    await wait(300)
    setProps({ keys: flashKey.item('a'), className: 'card is-done' })
    expect(box().className).toContain('is-done')
    expect(flashed()).toBe(true)
  })

  it('終わった後の描き直しでは付け直さない', async () => {
    const { setProps } = await renderView<BoxProps>(Box, { keys: flashKey.item('a'), className: 'card' })
    target(flashKey.item('a'))
    await wait(FLASH_MS)
    setProps({ keys: flashKey.item('a'), className: 'card is-done' })
    expect(flashed()).toBe(false)
  })

  it('キーを置いた後に出た要素（登録・ドラッグで移ったカード）も、出た時に目立つ', async () => {
    const { setProps } = await renderView<BoxProps>(Box, { keys: flashKey.item('new'), show: false })
    target(flashKey.item('new'))
    await wait(100)
    setProps({ keys: flashKey.item('new'), show: true })
    expect(flashed()).toBe(true)
  })

  it('目立たせた 1.2秒の後はキーを消す（開き直してももう一度は目立たせない）', async () => {
    const { setProps } = await renderView<BoxProps>(Box, { keys: flashKey.item('a') })
    target(flashKey.item('a'))
    await wait(FLASH_MS)
    expect(useCalendarUi.getState().flash).toBeNull()
    setProps({ keys: flashKey.item('a'), show: false })
    setProps({ keys: flashKey.item('a'), show: true })
    expect(flashed()).toBe(false)
  })

  it('どこにも出ないまま FLASH_STALE_MS を過ぎたキーは消す（後で開いた画面では目立たせない）', async () => {
    const { setProps } = await renderView<BoxProps>(Box, { keys: flashKey.item('later'), show: false })
    target(flashKey.item('later'))
    await wait(FLASH_STALE_MS)
    expect(useCalendarUi.getState().flash).toBeNull()
    setProps({ keys: flashKey.item('later'), show: true })
    expect(flashed()).toBe(false)
  })

  it('新しく置いたキーは、前のキーの後始末で消さない', async () => {
    await renderView<BoxProps>(Box, { keys: flashKey.item('a') })
    target(flashKey.item('a'))
    await wait(FLASH_MS - 100)
    target(flashKey.item('b'))
    await wait(200)
    expect(useCalendarUi.getState().flash?.key).toBe(flashKey.item('b'))
  })
})

describe('見える所まで動かす（scroll）', () => {
  it.each([
    [false, 'smooth'],
    [true, 'auto'],
  ] as const)('視差効果を減らす設定 %s → behavior %s', async (reducedMotion, behavior) => {
    await renderView<BoxProps>(Box, { keys: flashKey.item('a'), scroll: true }, { reducedMotion })
    vi.mocked(scrollIntoViewWithin).mockClear()
    target(flashKey.item('a'))
    expect(scrollIntoViewWithin).toHaveBeenCalledWith(box(), { behavior })
  })

  it('動かすのはカレンダーの中のスクロールだけで、ページ（window）と scrollIntoView は使わない（S・M でページが動かないように。G4）', async () => {
    await renderView<BoxProps>(Box, { keys: flashKey.item('a'), scroll: true })
    // 目立たせる物を、スクロールする所（画面の下に 5px はみ出した週の中）の下の端に置く
    const week = box().parentElement as HTMLElement
    week.style.overflowY = 'auto'
    week.getBoundingClientRect = () => new DOMRect(0, 214, 400, 630)
    Object.defineProperties(week, {
      clientHeight: { configurable: true, value: 630 },
      scrollHeight: { configurable: true, value: 1500 },
    })
    const weekTo = vi.fn()
    week.scrollTo = weekTo as unknown as typeof week.scrollTo
    box().getBoundingClientRect = () => new DOMRect(0, 800, 200, 44)
    const screenHeight = window.innerHeight
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 839 })
    const pageTo = vi.spyOn(window, 'scrollTo')
    const intoView = vi.mocked(Element.prototype.scrollIntoView)
    intoView.mockClear()
    try {
      target(flashKey.item('a'))
      // 画面の下の端（839px）まで: 844 − 839 = 5px
      expect(weekTo).toHaveBeenCalledWith({ left: 0, top: 5, behavior: 'smooth' })
      expect(pageTo).not.toHaveBeenCalled()
      expect(intoView).not.toHaveBeenCalled()
    } finally {
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: screenHeight })
      pageTo.mockRestore()
    }
  })

  it('目立たせる側が flashInPlace で置いた時（ドラッグで落とした時）は、scroll を渡していても動かさない（目立たせはする）', async () => {
    await renderView<BoxProps>(Box, { keys: flashKey.item('a'), scroll: true })
    vi.mocked(scrollIntoViewWithin).mockClear()
    act(() => useCalendarUi.getState().flashInPlace(flashKey.item('a')))
    expect(flashed()).toBe(true)
    expect(scrollIntoViewWithin).not.toHaveBeenCalled()
    // 次に flashTarget で置いた時は、また動かす
    await wait(FLASH_MS)
    target(flashKey.item('a'))
    expect(scrollIntoViewWithin).toHaveBeenCalledWith(box(), { behavior: 'smooth' })
  })

  it('目立たせる所が出る前に flashInPlace で置いた時も、出た時に動かさない', async () => {
    const { setProps } = await renderView<BoxProps>(Box, { keys: flashKey.item('a'), scroll: true, show: false })
    vi.mocked(scrollIntoViewWithin).mockClear()
    act(() => useCalendarUi.getState().flashInPlace(flashKey.item('a')))
    setProps({ keys: flashKey.item('a'), scroll: true, show: true })
    expect(flashed()).toBe(true)
    expect(scrollIntoViewWithin).not.toHaveBeenCalled()
  })

  it('scroll を渡さなければ動かさない', async () => {
    await renderView<BoxProps>(Box, { keys: flashKey.item('a') })
    vi.mocked(scrollIntoViewWithin).mockClear()
    target(flashKey.item('a'))
    expect(scrollIntoViewWithin).not.toHaveBeenCalled()
  })
})
