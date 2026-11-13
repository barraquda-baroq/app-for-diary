// 掴んだまま上下・左右の端にいる時に、週・段をまだ送れるか（edgeDriver.ts の canScroll。docs/SPEC.md の 7.11）
import { describe, expect, it } from 'vitest'
import { canScroll } from './edgeDriver'

/** スクロールする箱（jsdom は大きさを測らないので、測る値をそのまま与える） */
function box(
  o: {
    scrollTop?: number
    scrollLeft?: number
    scrollHeight?: number
    clientHeight?: number
    scrollWidth?: number
    clientWidth?: number
  },
  overflow = 'auto',
): HTMLElement {
  const el = document.createElement('div')
  el.style.overflowX = overflow
  el.style.overflowY = overflow
  for (const [k, v] of Object.entries(o)) Object.defineProperty(el, k, { configurable: true, value: v })
  return el
}

describe('canScroll（端まで送ったか）', () => {
  it('下の端まで残り 1px（整数の歩みで max − 1 に止まった）なら、まだ送れる（858 のはずが 857 で止まらない）', () => {
    expect(canScroll(box({ scrollTop: 857, scrollHeight: 1697, clientHeight: 839 }), 'y', 1)).toBe(true)
  })

  it('下の端まで残り半ピクセル未満（小数の scrollTop）なら、もう送れない', () => {
    expect(canScroll(box({ scrollTop: 857.6, scrollHeight: 1697, clientHeight: 839 }), 'y', 1)).toBe(false)
    expect(canScroll(box({ scrollTop: 858, scrollHeight: 1697, clientHeight: 839 }), 'y', 1)).toBe(false)
  })

  it('上へは scrollTop が 0 より大きい間だけ', () => {
    expect(canScroll(box({ scrollTop: 1, scrollHeight: 1697, clientHeight: 839 }), 'y', -1)).toBe(true)
    expect(canScroll(box({ scrollTop: 0, scrollHeight: 1697, clientHeight: 839 }), 'y', -1)).toBe(false)
  })

  it('横も同じ（右の端まで残り 1px なら送れる・半ピクセル未満なら送れない）', () => {
    expect(canScroll(box({ scrollLeft: 199, scrollWidth: 1200, clientWidth: 1000 }), 'x', 1)).toBe(true)
    expect(canScroll(box({ scrollLeft: 199.7, scrollWidth: 1200, clientWidth: 1000 }), 'x', 1)).toBe(false)
  })

  it('スクロールしない箱（overflow: visible・hidden）では送れない', () => {
    expect(canScroll(box({ scrollTop: 0, scrollHeight: 1697, clientHeight: 839 }, 'visible'), 'y', 1)).toBe(false)
    expect(canScroll(box({ scrollTop: 0, scrollHeight: 1697, clientHeight: 839 }, 'hidden'), 'y', 1)).toBe(false)
  })
})
