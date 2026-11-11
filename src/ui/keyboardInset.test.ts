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
})
