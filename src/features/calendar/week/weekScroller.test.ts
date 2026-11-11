// 落とした先・登録したカードを、ウィークリーの中だけで見える所まで出す（revealInWeek。docs/SPEC.md の 7.11・4.9。CALENDAR-181・
// WP11s の G4）: scrollIntoView の nearest と同じ動かし方で、段の中・週の全体・横のスクロールを動かし、ウィークリーの外は動かさない
import { afterEach, describe, expect, it, vi } from 'vitest'
import { revealInWeek, WEEK_SCROLLER_ATTR } from './weekScroller'

/** jsdom は大きさを測らないので、要素の見える所（画面の座標）・中身の大きさを決める。scrollTo を返す */
function box(
  el: HTMLElement,
  rect: { x: number; y: number; w: number; h: number },
  scroll?: { height?: number; width?: number; top?: number; left?: number },
) {
  el.getBoundingClientRect = () => DOMRect.fromRect({ x: rect.x, y: rect.y, width: rect.w, height: rect.h })
  const scrollTo = vi.fn()
  if (scroll) {
    el.style.overflowX = 'auto'
    el.style.overflowY = 'auto'
    const define = (name: string, value: number) => Object.defineProperty(el, name, { configurable: true, value })
    define('clientHeight', rect.h)
    define('clientWidth', rect.w)
    define('scrollHeight', scroll.height ?? rect.h)
    define('scrollWidth', scroll.width ?? rect.w)
    Object.defineProperty(el, 'scrollTop', { configurable: true, value: scroll.top ?? 0 })
    Object.defineProperty(el, 'scrollLeft', { configurable: true, value: scroll.left ?? 0 })
    el.scrollTo = scrollTo as unknown as typeof el.scrollTo
  }
  return scrollTo
}

/** ページ（スクロールする）> ウィークリー（data-week-scroller）> 段の中（スクロールする）> カード */
function week() {
  const page = document.createElement('div')
  const root = document.createElement('div')
  root.setAttribute(WEEK_SCROLLER_ATTR, '')
  const tier = document.createElement('div')
  const card = document.createElement('div')
  tier.appendChild(card)
  root.appendChild(tier)
  page.appendChild(root)
  document.body.appendChild(page)
  return { page, root, tier, card }
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('revealInWeek', () => {
  it('段の中の見えていないカードは、下の端を見える所の下の端に合わせる（nearest）。ウィークリーの外は動かさない', () => {
    const { page, root, tier, card } = week()
    const pageScroll = box(page, { x: 0, y: 0, w: 400, h: 600 }, { height: 2000 })
    box(root, { x: 0, y: 100, w: 400, h: 600 })
    const tierScroll = box(tier, { x: 0, y: 100, w: 400, h: 300 }, { height: 900, top: 50 })
    box(card, { x: 10, y: 500, w: 100, h: 40 })
    revealInWeek(card)
    expect(tierScroll).toHaveBeenCalledWith({ top: 50 + 140, behavior: 'smooth' })
    expect(pageScroll).not.toHaveBeenCalled()
  })

  it('上に隠れたカードは、上の端を合わせる。見える所より大きいカードも上の端を合わせる', () => {
    const { tier, card } = week()
    const tierScroll = box(tier, { x: 0, y: 100, w: 400, h: 300 }, { height: 900, top: 200 })
    box(card, { x: 10, y: 60, w: 100, h: 40 })
    revealInWeek(card)
    expect(tierScroll).toHaveBeenLastCalledWith({ top: 160, behavior: 'smooth' })
    box(card, { x: 10, y: 380, w: 100, h: 500 })
    revealInWeek(card)
    expect(tierScroll).toHaveBeenLastCalledWith({ top: 480, behavior: 'smooth' })
  })

  it('もう見えている時・スクロールできない時は動かさない。動かせる所までにとどめる', () => {
    const { root, tier, card } = week()
    const tierScroll = box(tier, { x: 0, y: 100, w: 400, h: 300 }, { height: 900 })
    box(card, { x: 10, y: 200, w: 100, h: 40 })
    revealInWeek(card)
    expect(tierScroll).not.toHaveBeenCalled()
    // 段の中はもう下の端まで（900 − 300）。残りはウィークリー（7日を縦の週の全体）を動かす
    const rootScroll = box(root, { x: 0, y: 0, w: 400, h: 500 }, { height: 1500 })
    box(tier, { x: 0, y: 100, w: 400, h: 300 }, { height: 900, top: 590 })
    box(card, { x: 10, y: 520, w: 100, h: 40 })
    revealInWeek(card)
    expect(tier.scrollTo).toHaveBeenCalledWith({ top: 600, behavior: 'smooth' })
    // 段の中で 10px 動いた後のカードは 510〜550。ウィークリーの見える所（0〜500）に入れるには 50px
    expect(rootScroll).toHaveBeenCalledWith({ top: 50, behavior: 'smooth' })
  })

  it('横にスクロールする週（狭い領域の 7日を横）は横も動かす', () => {
    const { root, tier, card } = week()
    box(tier, { x: 0, y: 0, w: 1000, h: 300 })
    const rootScroll = box(root, { x: 0, y: 0, w: 400, h: 300 }, { width: 1000 })
    box(card, { x: 600, y: 10, w: 100, h: 40 })
    revealInWeek(card)
    expect(rootScroll).toHaveBeenCalledWith({ left: 300, behavior: 'smooth' })
  })

  it('ウィークリーの外の要素・無い要素では何もしない', () => {
    const lone = document.createElement('div')
    document.body.appendChild(lone)
    const native = vi.fn()
    lone.scrollIntoView = native
    revealInWeek(lone)
    revealInWeek(null)
    expect(native).not.toHaveBeenCalled()
  })
})
