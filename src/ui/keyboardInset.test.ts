// iPhone の画面キーボードに隠れる高さ（docs/SPEC.md の 2.7・FRAME-086・ITEMS-191）: visualViewport との差を --kb に入れ、
// 打っている欄がキーボードの上 16px に来るまで送る
import { act, cleanup, render } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { KEYBOARD_GAP, keyboardInset, revealAboveKeyboard, useKeyboardInset } from './keyboardInset'

describe('keyboardInset', () => {
  it('見えている範囲より下に隠れた高さ（拡大している時は 0）', () => {
    expect(keyboardInset(844, { height: 844, offsetTop: 0, scale: 1 })).toBe(0)
    expect(keyboardInset(844, { height: 508, offsetTop: 0, scale: 1 })).toBe(336)
    expect(keyboardInset(844, { height: 508, offsetTop: 20.4, scale: 1 })).toBe(316)
    expect(keyboardInset(844, { height: 300, offsetTop: 0, scale: 2 })).toBe(0)
    expect(keyboardInset(844, { height: 900, offsetTop: 0, scale: 1 })).toBe(0)
  })
})

/** 高さを変えられる visualViewport の偽物 */
function fakeViewport(height: number) {
  const target = new EventTarget() as EventTarget & { height: number; offsetTop: number; scale: number; width: number }
  Object.assign(target, { height, offsetTop: 0, scale: 1, width: 390 })
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: target })
  return target
}

describe('useKeyboardInset', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 844 })
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: undefined })
    vi.restoreAllMocks()
  })

  function Inset() {
    useKeyboardInset()
    return null
  }

  it('キーボードが出たら --kb に高さを入れ、閉じたら 0 に戻す', () => {
    const vv = fakeViewport(844)
    render(createElement(Inset))
    expect(document.documentElement.style.getPropertyValue('--kb')).toBe('0px')
    vv.height = 508
    act(() => {
      vv.dispatchEvent(new Event('resize'))
      vi.runOnlyPendingTimers()
    })
    expect(document.documentElement.style.getPropertyValue('--kb')).toBe('336px')
    vv.height = 844
    act(() => {
      vv.dispatchEvent(new Event('resize'))
      vi.runOnlyPendingTimers()
    })
    expect(document.documentElement.style.getPropertyValue('--kb')).toBe('0px')
  })

  it('欄にフォーカスしたままキーボードが出た時・出たまま別の欄へ移った時に、その欄をキーボードの上 16px まで送る（ITEMS-191）', () => {
    const vv = fakeViewport(844)
    const scrollBy = vi.fn()
    document.documentElement.scrollBy = scrollBy as unknown as typeof document.documentElement.scrollBy
    Object.defineProperty(document, 'scrollingElement', { configurable: true, value: document.documentElement })
    const first = document.createElement('input')
    const second = document.createElement('textarea')
    const button = document.createElement('button')
    document.body.append(first, second, button)
    vi.spyOn(first, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 560, 300, 40))
    vi.spyOn(second, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 700, 300, 80))
    vi.spyOn(button, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 700, 300, 80))
    render(createElement(Inset))
    first.focus()
    // キーボードが出る（見えている高さ 508px）→ 高さを入れた後に、隠れた欄を送る
    vv.height = 508
    act(() => {
      vv.dispatchEvent(new Event('resize'))
      vi.runOnlyPendingTimers()
    })
    expect(scrollBy).not.toHaveBeenCalled()
    act(() => {
      vi.runOnlyPendingTimers()
    })
    expect(scrollBy).toHaveBeenCalledTimes(1)
    expect(scrollBy).toHaveBeenLastCalledWith(expect.objectContaining({ top: 600 - (508 - KEYBOARD_GAP) }))
    // 出たまま別の欄へ（すぐ送る）。ボタンは文字を打つ欄ではないので送らない
    act(() => second.focus())
    expect(scrollBy).toHaveBeenCalledTimes(2)
    expect(scrollBy).toHaveBeenLastCalledWith(expect.objectContaining({ top: 780 - (508 - KEYBOARD_GAP) }))
    act(() => button.focus())
    expect(scrollBy).toHaveBeenCalledTimes(2)
    first.remove()
    second.remove()
    button.remove()
  })

  it('キーボードが出たまま見えている所が縦に動いた（ページを指で動かした・iPhone が見えている所をずらした）だけでは送らない。--kb は今までどおり見えている所の下に隠れた高さ（■36 の時の作者の報告。2.7）', () => {
    const vv = fakeViewport(844)
    const scrollBy = vi.fn()
    document.documentElement.scrollBy = scrollBy as unknown as typeof document.documentElement.scrollBy
    Object.defineProperty(document, 'scrollingElement', { configurable: true, value: document.documentElement })
    const input = document.createElement('input')
    document.body.append(input)
    vi.spyOn(input, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 800, 300, 40))
    render(createElement(Inset))
    input.focus()
    const step = () =>
      act(() => {
        vi.runOnlyPendingTimers()
        vi.runOnlyPendingTimers()
      })
    // キーボードが出た: 1回だけ送る
    vv.height = 508
    act(() => vv.dispatchEvent(new Event('resize')))
    step()
    expect(scrollBy).toHaveBeenCalledTimes(1)
    expect(document.documentElement.style.getPropertyValue('--kb')).toBe('336px')
    // キーボードはそのままで、見えている所が縦に動く（iOS は、ページが動く間 offsetTop を替えて scroll を送る）: 送らない
    for (const top of [40, 120, 260, 90]) {
      vv.offsetTop = top
      act(() => vv.dispatchEvent(new Event('scroll')))
      step()
      expect(document.documentElement.style.getPropertyValue('--kb')).toBe(`${336 - top}px`)
    }
    act(() => window.dispatchEvent(new Event('resize')))
    step()
    expect(scrollBy).toHaveBeenCalledTimes(1)
    input.remove()
  })

  it('キーボードの高さが変わった時（候補の列が出た・閉じた）は送る。数 px の違いでは送らない。キーボードを閉じた時は送らない', () => {
    const vv = fakeViewport(844)
    const scrollBy = vi.fn()
    document.documentElement.scrollBy = scrollBy as unknown as typeof document.documentElement.scrollBy
    Object.defineProperty(document, 'scrollingElement', { configurable: true, value: document.documentElement })
    const input = document.createElement('input')
    document.body.append(input)
    vi.spyOn(input, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 800, 300, 40))
    render(createElement(Inset))
    input.focus()
    const resize = (height: number, offsetTop = vv.offsetTop) => {
      vv.height = height
      vv.offsetTop = offsetTop
      act(() => {
        vv.dispatchEvent(new Event('resize'))
        vi.runOnlyPendingTimers()
        vi.runOnlyPendingTimers()
      })
    }
    resize(508)
    expect(scrollBy).toHaveBeenCalledTimes(1)
    // 見えている所が動いた後に、候補の列が出てキーボードが高くなった
    resize(470, 60)
    expect(scrollBy).toHaveBeenCalledTimes(2)
    // 2px だけ（丸めの違いなど）
    resize(468)
    expect(scrollBy).toHaveBeenCalledTimes(2)
    // 閉じた
    resize(844, 0)
    expect(scrollBy).toHaveBeenCalledTimes(2)
    expect(document.documentElement.style.getPropertyValue('--kb')).toBe('0px')
    input.remove()
  })

  it('キーボードが出たまま見えている所が動いた後に、別の欄へ移った時は送る', () => {
    const vv = fakeViewport(844)
    const scrollBy = vi.fn()
    document.documentElement.scrollBy = scrollBy as unknown as typeof document.documentElement.scrollBy
    Object.defineProperty(document, 'scrollingElement', { configurable: true, value: document.documentElement })
    const first = document.createElement('input')
    const second = document.createElement('textarea')
    document.body.append(first, second)
    vi.spyOn(first, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 400, 300, 40))
    vi.spyOn(second, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 900, 300, 80))
    render(createElement(Inset))
    first.focus()
    vv.height = 508
    act(() => {
      vv.dispatchEvent(new Event('resize'))
      vi.runOnlyPendingTimers()
      vi.runOnlyPendingTimers()
    })
    expect(scrollBy).not.toHaveBeenCalled()
    vv.offsetTop = 120
    act(() => {
      vv.dispatchEvent(new Event('scroll'))
      vi.runOnlyPendingTimers()
      vi.runOnlyPendingTimers()
    })
    expect(scrollBy).not.toHaveBeenCalled()
    act(() => second.focus())
    expect(scrollBy).toHaveBeenCalledTimes(1)
    expect(scrollBy).toHaveBeenLastCalledWith(expect.objectContaining({ top: 980 - (120 + 508 - KEYBOARD_GAP) }))
    first.remove()
    second.remove()
  })

  it('打っている欄がキーボードに隠れたら、キーボードの上 16px まで送る', () => {
    fakeViewport(508)
    const scroller = document.createElement('div')
    const input = document.createElement('input')
    scroller.appendChild(input)
    document.body.appendChild(scroller)
    const scrollBy = vi.fn()
    document.documentElement.scrollBy = scrollBy as unknown as typeof document.documentElement.scrollBy
    Object.defineProperty(document, 'scrollingElement', { configurable: true, value: document.documentElement })
    vi.spyOn(input, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 560, 300, 40))
    revealAboveKeyboard(input)
    expect(scrollBy).toHaveBeenCalledWith(expect.objectContaining({ top: 600 - (508 - KEYBOARD_GAP) }))
    // 見えていれば送らない
    scrollBy.mockClear()
    vi.spyOn(input, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 400, 300, 40))
    revealAboveKeyboard(input)
    expect(scrollBy).not.toHaveBeenCalled()
    scroller.remove()
  })

  it('キーボードの上に画面の下のお知らせ（［OK］まで出す物など）が出ていれば、欄をその上の端の 8px 上まで送る（■26・4.9）', () => {
    fakeViewport(508)
    const input = document.createElement('input')
    document.body.appendChild(input)
    const scrollBy = vi.fn()
    document.documentElement.scrollBy = scrollBy as unknown as typeof document.documentElement.scrollBy
    Object.defineProperty(document, 'scrollingElement', { configurable: true, value: document.documentElement })
    // 欄はキーボードの上 16px（492）より上にある
    vi.spyOn(input, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 400, 300, 40))
    revealAboveKeyboard(input)
    expect(scrollBy).not.toHaveBeenCalled()
    // キーボードの上に出たお知らせ（425〜492）と重なる: お知らせの上の端の 8px 上（417）まで送る
    const toasts = document.createElement('div')
    toasts.className = 'toasts'
    toasts.appendChild(document.createElement('div')).className = 'toast'
    document.body.appendChild(toasts)
    vi.spyOn(toasts, 'getBoundingClientRect').mockReturnValue(new DOMRect(12, 425, 366, 67))
    revealAboveKeyboard(input)
    expect(scrollBy).toHaveBeenCalledWith(expect.objectContaining({ top: 440 - (425 - 8) }))
    // 横に重ならないお知らせは見込まない
    scrollBy.mockClear()
    vi.spyOn(input, 'getBoundingClientRect').mockReturnValue(new DOMRect(380, 400, 10, 40))
    revealAboveKeyboard(input)
    expect(scrollBy).not.toHaveBeenCalled()
    input.remove()
    toasts.remove()
  })
})
