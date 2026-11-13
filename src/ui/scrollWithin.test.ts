// 要素を、それを入れたスクロールする所の中だけで見える所まで出す（scrollIntoViewWithin。ページは動かさない。WP11s の G4・7.11・
// CALENDAR-181）。jsdom は大きさを測らないので、箱の位置・大きさ・スクロールの量を決めて確かめる
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isShownWithin, nearestDelta, scrollIntoViewWithin, toastInset } from './scrollWithin'

/** 箱の位置と大きさ（rect は [left, top, width, height]。client・scroll は [幅, 高さ]。無ければ rect と同じ） */
interface Geom {
  rect: [number, number, number, number]
  client?: [number, number]
  scroll?: [number, number]
  at?: { top?: number; left?: number }
}

/** el の位置・大きさを決め、scrollTo を控える（scrollTo は位置も変える） */
function geom(el: HTMLElement, g: Geom) {
  el.getBoundingClientRect = () => new DOMRect(...g.rect)
  const [cw, ch] = g.client ?? [g.rect[2], g.rect[3]]
  const [sw, sh] = g.scroll ?? [cw, ch]
  let top = g.at?.top ?? 0
  let left = g.at?.left ?? 0
  Object.defineProperties(el, {
    clientWidth: { configurable: true, value: cw },
    clientHeight: { configurable: true, value: ch },
    scrollWidth: { configurable: true, value: sw },
    scrollHeight: { configurable: true, value: sh },
    scrollTop: { configurable: true, get: () => top, set: (v: number) => (top = v) },
    scrollLeft: { configurable: true, get: () => left, set: (v: number) => (left = v) },
  })
  const scrollTo = vi.fn((o: ScrollToOptions) => {
    top = o.top ?? top
    left = o.left ?? left
  })
  el.scrollTo = scrollTo as unknown as typeof el.scrollTo
  return scrollTo
}

function div(parent: HTMLElement, style: Partial<CSSStyleDeclaration> = {}): HTMLDivElement {
  const el = document.createElement('div')
  Object.assign(el.style, style)
  parent.append(el)
  return el
}

const original = { innerHeight: window.innerHeight, innerWidth: window.innerWidth, matchMedia: window.matchMedia }

function setScreen(width: number, height: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height })
}

function setReducedMotion(reduce: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: reduce && query.includes('prefers-reduced-motion: reduce'),
    media: query,
  })) as unknown as typeof window.matchMedia
}

/** ページ（window・html・body）を動かす物を全部見張る */
function watchPage() {
  const root = document.documentElement
  const body = document.body
  // ページもスクロールできる（S・M のトップはカレンダーの下にリストがある）
  root.style.overflowY = 'auto'
  body.style.overflowY = 'auto'
  geom(root, { rect: [0, 0, 412, 839], scroll: [412, 1102] })
  geom(body, { rect: [0, 0, 412, 1102], client: [412, 839], scroll: [412, 1102] })
  return {
    scrollTo: vi.spyOn(window, 'scrollTo'),
    scrollBy: vi.spyOn(window, 'scrollBy'),
    root,
    body,
  }
}

beforeEach(() => {
  setScreen(412, 839)
  setReducedMotion(false)
})

afterEach(() => {
  delete (Element.prototype as Partial<Element>).scrollIntoView
  document.body.replaceChildren()
  document.documentElement.removeAttribute('style')
  document.body.removeAttribute('style')
  setScreen(original.innerWidth, original.innerHeight)
  window.matchMedia = original.matchMedia
  vi.restoreAllMocks()
})

describe('nearestDelta（scrollIntoView の nearest と同じ決まり）', () => {
  it.each([
    ['全部見えている', [100, 140], 0],
    ['上にはみ出し、見える所に入る大きさ → 上の端をそろえる', [80, 120], -20],
    ['下にはみ出し、見える所に入る大きさ → 下の端をそろえる', [380, 420], 20],
    ['上にはみ出し、見える所より大きい → 下の端をそろえる', [-400, 300], -100],
    ['下にはみ出し、見える所より大きい → 上の端をそろえる', [200, 900], 100],
    ['見える所より大きく、両側にはみ出している → 動かさない', [50, 500], 0],
  ] as const)('%s', (_, [start, end], delta) => {
    expect(nearestDelta(start, end, 100, 400)).toBe(delta)
  })
})

describe('scrollIntoViewWithin', () => {
  it('S のウィークリー: 週の下の端が画面の下に出ていても、週の中だけを送って画面の中に出し、ページは動かさない（G4）', () => {
    const page = watchPage()
    // jsdom に scrollIntoView は無いので、呼ばれたら分かるように置く（ページも動かすので使わない）
    const intoView = vi.fn()
    Element.prototype.scrollIntoView = intoView
    // 週の中（スクロールする所）: 画面の上から 214〜844px（画面は 839px。ページのいちばん上では下の 5px が画面の外）
    const week = div(document.body, { overflowY: 'auto', overflowX: 'hidden' })
    const weekTo = geom(week, { rect: [16, 214, 380, 630], scroll: [380, 1478], at: { top: 807 } })
    const card = div(div(week))
    geom(card, { rect: [20, 804.58, 170, 44.84] })

    scrollIntoViewWithin(card)

    // 週の見える所の下の端（844）ではなく、画面の下の端（839）まで送る: 849.42 − 839 = 10.42 → 11px（切れないように整数へ）
    expect(weekTo).toHaveBeenCalledTimes(1)
    expect(weekTo).toHaveBeenCalledWith({ left: 0, top: 818, behavior: 'smooth' })
    expect(page.scrollTo).not.toHaveBeenCalled()
    expect(page.scrollBy).not.toHaveBeenCalled()
    expect(page.root.scrollTo).not.toHaveBeenCalled()
    expect(page.body.scrollTo).not.toHaveBeenCalled()
    expect(page.root.scrollTop).toBe(0)
    expect(page.body.scrollTop).toBe(0)
    expect(intoView).not.toHaveBeenCalled()
  })

  it('送れる所の終わりまでしか送らない（その先のページは動かさない）', () => {
    const page = watchPage()
    const week = div(document.body, { overflowY: 'auto' })
    const weekTo = geom(week, { rect: [16, 214, 380, 630], scroll: [380, 1478], at: { top: 845 } })
    const card = div(week)
    geom(card, { rect: [20, 810, 170, 44] })
    scrollIntoViewWithin(card)
    // 854 − 839 = 15px 送りたいが、送れるのは 1478 − 630 − 845 = 3px まで
    expect(weekTo).toHaveBeenCalledWith({ left: 0, top: 848, behavior: 'smooth' })
    expect(page.scrollTo).not.toHaveBeenCalled()
    expect(page.root.scrollTo).not.toHaveBeenCalled()
    expect(page.body.scrollTo).not.toHaveBeenCalled()
  })

  it('もう見えている時は動かさない', () => {
    const week = div(document.body, { overflowY: 'auto' })
    const weekTo = geom(week, { rect: [0, 100, 400, 600], scroll: [400, 2000], at: { top: 300 } })
    const card = div(week)
    geom(card, { rect: [10, 300, 200, 44] })
    scrollIntoViewWithin(card)
    expect(weekTo).not.toHaveBeenCalled()
  })

  it('上にはみ出した物は上の端まで戻す', () => {
    const week = div(document.body, { overflowY: 'auto' })
    const weekTo = geom(week, { rect: [0, 100, 400, 600], scroll: [400, 2000], at: { top: 300 } })
    const card = div(week)
    geom(card, { rect: [10, 60.5, 200, 44] })
    scrollIntoViewWithin(card)
    // 60.5 − 100 = −39.5 → −40px
    expect(weekTo).toHaveBeenCalledWith({ left: 0, top: 260, behavior: 'smooth' })
  })

  it('箱の scroll-padding（上に固定した行の分）と要素の scroll-margin を見込む（S のウィークリーの名札の行 24px の下に出す）', () => {
    const week = div(document.body, { overflowY: 'auto', scrollPaddingTop: '24px' })
    const weekTo = geom(week, { rect: [0, 214, 412, 630], scroll: [412, 2000], at: { top: 500 } })
    const card = div(week)
    geom(card, { rect: [10, 230, 200, 44] })
    scrollIntoViewWithin(card)
    // 見える所の上の端は 214 + 24 = 238: 230 − 238 = −8px
    expect(weekTo).toHaveBeenLastCalledWith({ left: 0, top: 492, behavior: 'smooth' })
    const inner = div(week, { scrollMarginTop: '4px' })
    geom(inner, { rect: [10, 240, 200, 44] })
    scrollIntoViewWithin(inner)
    // 要素の上の 4px も見せる: 240 − 4 − 238 = −2px
    expect(weekTo).toHaveBeenLastCalledWith({ left: 0, top: 490, behavior: 'smooth' })
  })

  it('入れ子: 中の段を縦に送った後の位置で、外の箱を横に送る。overflow が hidden の向き・箱は動かさない', () => {
    // 7日を横（外の箱は横だけスクロール）の中の段（縦だけスクロール）
    const outer = div(document.body, { overflowX: 'auto', overflowY: 'hidden' })
    const outerTo = geom(outer, { rect: [0, 0, 300, 450], scroll: [600, 900] })
    // 字を切るための hidden の箱（動かさない）
    const clip = div(outer, { overflow: 'hidden' })
    const clipTo = geom(clip, { rect: [0, 0, 600, 450], scroll: [600, 900] })
    const tier = div(clip, { overflowY: 'auto', overflowX: 'hidden' })
    const tierTo = geom(tier, { rect: [0, 100, 600, 300], scroll: [900, 1000] })
    const card = div(tier)
    geom(card, { rect: [350, 500, 70, 40] })

    scrollIntoViewWithin(card, { behavior: 'auto' })

    // 段: 540 − 400 = 140px 下へ（横は hidden なので動かさない）
    expect(tierTo).toHaveBeenCalledWith({ left: 0, top: 140, behavior: 'auto' })
    // 外の箱: 縦は hidden。横は 420 − 300 = 120px
    expect(outerTo).toHaveBeenCalledWith({ left: 120, top: 0, behavior: 'auto' })
    expect(clipTo).not.toHaveBeenCalled()
  })

  it('外の箱は、中の箱を送った後の位置で比べる（送る前の位置なら外も動いてしまう所）', () => {
    const outer = div(document.body, { overflowY: 'auto' })
    const outerTo = geom(outer, { rect: [0, 0, 400, 450], scroll: [400, 2000] })
    const inner = div(outer, { overflowY: 'auto' })
    const innerTo = geom(inner, { rect: [0, 100, 400, 300], scroll: [400, 1000] })
    const card = div(inner)
    geom(card, { rect: [0, 500, 200, 40] })
    scrollIntoViewWithin(card)
    expect(innerTo).toHaveBeenCalledWith({ left: 0, top: 140, behavior: 'smooth' })
    // 送った後は 360〜400px で、外の箱（0〜450px）の中に見えている
    expect(outerTo).not.toHaveBeenCalled()
  })

  it('位置の決まった箱（下からのシート・小窓）より外は動かさない', () => {
    const outer = div(document.body, { overflowY: 'auto' })
    const outerTo = geom(outer, { rect: [0, 0, 400, 300], scroll: [400, 2000] })
    const sheet = div(outer, { position: 'fixed' })
    const list = div(sheet, { overflowY: 'auto' })
    const listTo = geom(list, { rect: [0, 400, 300, 240], scroll: [300, 2000] })
    const option = div(list)
    geom(option, { rect: [0, 700, 300, 32] })
    scrollIntoViewWithin(option, { behavior: 'auto' })
    expect(listTo).toHaveBeenCalledWith({ left: 0, top: 92, behavior: 'auto' })
    expect(outerTo).not.toHaveBeenCalled()
  })

  it('箱が画面の外にある時は、箱の中で見える所まで（画面で狭めない）', () => {
    const week = div(document.body, { overflowY: 'auto' })
    const weekTo = geom(week, { rect: [0, 900, 400, 600], scroll: [400, 2000] })
    const card = div(week)
    geom(card, { rect: [0, 1520, 200, 40] })
    scrollIntoViewWithin(card)
    expect(weekTo).toHaveBeenCalledWith({ left: 0, top: 60, behavior: 'smooth' })
  })

  it('視差効果を減らす設定ではすぐに動かす（behavior auto。src/ui/motion.ts の scrollBehavior）', () => {
    setReducedMotion(true)
    const week = div(document.body, { overflowY: 'auto' })
    const weekTo = geom(week, { rect: [0, 100, 400, 600], scroll: [400, 2000] })
    const card = div(week)
    geom(card, { rect: [0, 690, 200, 40] })
    scrollIntoViewWithin(card)
    expect(weekTo).toHaveBeenCalledWith({ left: 0, top: 30, behavior: 'auto' })
  })

  it('要素が無い・外れている時は何もしない', () => {
    expect(() => scrollIntoViewWithin(null)).not.toThrow()
    expect(() => scrollIntoViewWithin(undefined)).not.toThrow()
    expect(() => scrollIntoViewWithin(document.createElement('div'))).not.toThrow()
  })
})

// ウィークリーの形（登録した・落とした先のカードを出す所。7.11・4.9・CALENDAR-181。もとは week/weekScroller.ts の revealInWeek の
// 確かめ。出す仕組みを scrollIntoViewWithin の1つにしたので、ここで同じことを確かめる）
describe('scrollIntoViewWithin: ウィークリーの形（段の中・7日を縦の週の全体・狭い時の横）', () => {
  /** ページ（スクロールする箱）> ウィークリー > 段の中（スクロールする）> カード */
  function week() {
    const page = div(document.body)
    const root = div(page)
    const tier = div(root)
    const card = div(tier)
    return { page, root, tier, card }
  }

  /** スクロールする箱にする（overflow: auto）。scrollTo を返す */
  function scrolling(el: HTMLElement, g: Geom) {
    el.style.overflowX = 'auto'
    el.style.overflowY = 'auto'
    return geom(el, g)
  }

  it('段の中の見えていないカードは、下の端を見える所の下の端に合わせる（nearest）。もう見えている外の箱は動かさない', () => {
    const { page, root, tier, card } = week()
    const pageTo = scrolling(page, { rect: [0, 0, 400, 600], scroll: [400, 2000] })
    geom(root, { rect: [0, 100, 400, 600] })
    const tierTo = scrolling(tier, { rect: [0, 100, 400, 300], scroll: [400, 900], at: { top: 50 } })
    geom(card, { rect: [10, 500, 100, 40] })
    scrollIntoViewWithin(card)
    expect(tierTo).toHaveBeenCalledWith({ left: 0, top: 50 + 140, behavior: 'smooth' })
    expect(pageTo).not.toHaveBeenCalled()
  })

  it('上に隠れたカードは、上の端を合わせる。見える所より大きいカードも上の端を合わせる', () => {
    const { tier, card } = week()
    /** 段の中を、上から 200px 送った所にする（scrollTo は送った所を覚えるので、確かめるたびに戻す） */
    const at200 = () => scrolling(tier, { rect: [0, 100, 400, 300], scroll: [400, 900], at: { top: 200 } })
    let tierTo = at200()
    geom(card, { rect: [10, 60, 100, 40] })
    scrollIntoViewWithin(card)
    expect(tierTo).toHaveBeenLastCalledWith({ left: 0, top: 160, behavior: 'smooth' })
    tierTo = at200()
    geom(card, { rect: [10, 380, 100, 500] })
    scrollIntoViewWithin(card)
    expect(tierTo).toHaveBeenLastCalledWith({ left: 0, top: 480, behavior: 'smooth' })
  })

  it('要素の scroll-margin は見える所の外に取る（上の端の余白に掛かっている物も見えていないので動かす。下の端は今までどおり）', () => {
    const { tier, card } = week()
    const at200 = () => scrolling(tier, { rect: [0, 100, 400, 300], scroll: [400, 900], at: { top: 200 } })
    card.style.scrollMarginTop = '24px'
    // 上に隠れたカード: 上の端を、見える所の上の端から 24px 下に合わせる
    let tierTo = at200()
    geom(card, { rect: [10, 60, 100, 40] })
    scrollIntoViewWithin(card)
    expect(tierTo).toHaveBeenLastCalledWith({ left: 0, top: 200 - 40 - 24, behavior: 'smooth' })
    // 上の端の 24px の中に掛かっているカードも、見えていないので動かす
    tierTo = at200()
    geom(card, { rect: [10, 110, 100, 40] })
    scrollIntoViewWithin(card)
    expect(tierTo).toHaveBeenLastCalledWith({ left: 0, top: 200 - 14, behavior: 'smooth' })
    // 下の端の方は scroll-margin-bottom（0）のまま
    tierTo = at200()
    geom(card, { rect: [10, 380, 100, 40] })
    scrollIntoViewWithin(card)
    expect(tierTo).toHaveBeenLastCalledWith({ left: 0, top: 200 + 20, behavior: 'smooth' })
  })

  it('もう見えている時・スクロールできない時は動かさない。送れる所までにとどめ、残りは外の箱（7日を縦の週の全体）で送る', () => {
    const { root, tier, card } = week()
    const tierTo = scrolling(tier, { rect: [0, 100, 400, 300], scroll: [400, 900] })
    geom(card, { rect: [10, 200, 100, 40] })
    scrollIntoViewWithin(card)
    expect(tierTo).not.toHaveBeenCalled()
    // 段の中は下の端（900 − 300）まであと 10px。残りはウィークリー（7日を縦の週の全体）を動かす
    const rootTo = scrolling(root, { rect: [0, 0, 400, 500], scroll: [400, 1500] })
    const tierTo2 = scrolling(tier, { rect: [0, 100, 400, 300], scroll: [400, 900], at: { top: 590 } })
    geom(card, { rect: [10, 520, 100, 40] })
    scrollIntoViewWithin(card)
    expect(tierTo2).toHaveBeenCalledWith({ left: 0, top: 600, behavior: 'smooth' })
    // 段の中で 10px 動いた後のカードは 510〜550。ウィークリーの見える所（0〜500）に入れるには 50px
    expect(rootTo).toHaveBeenCalledWith({ left: 0, top: 50, behavior: 'smooth' })
  })

  it('横にスクロールする週（狭い領域の 7日を横）は横も動かす', () => {
    const { root, tier, card } = week()
    geom(tier, { rect: [0, 0, 1000, 300] })
    const rootTo = scrolling(root, { rect: [0, 0, 400, 300], scroll: [1000, 300] })
    geom(card, { rect: [600, 10, 100, 40] })
    scrollIntoViewWithin(card)
    expect(rootTo).toHaveBeenCalledWith({ left: 300, top: 0, behavior: 'smooth' })
  })
})

describe('画面の下のお知らせの上に出す（bottomInset・toastInset。落とした時の「〜へ移しました［元に戻す］」。7.11・3.9）', () => {
  /** 画面の下の真ん中のお知らせ（src/ui/Layout.tsx の .toasts。中に1つ） */
  function toasts(rect: [number, number, number, number]) {
    const box = div(document.body)
    box.className = 'toasts'
    div(box).className = 'toast'
    geom(box, { rect })
    return box
  }

  it('bottomInset: 画面の下の端からその高さは見える所に数えず、その上の端まで送る。送れる所の終わりまでにとどめる', () => {
    // S の週（画面 412×839）の下の方に落としたカード（画面の下の端にぴったり）。お知らせは 772〜823
    const week = div(document.body, { overflowY: 'auto' })
    const weekTo = geom(week, { rect: [16, 214, 380, 630], scroll: [380, 2000], at: { top: 800 } })
    const card = div(week)
    geom(card, { rect: [20, 795, 170, 44] })
    scrollIntoViewWithin(card)
    expect(weekTo).not.toHaveBeenCalled()
    scrollIntoViewWithin(card, { bottomInset: 839 - 772 + 8 })
    // 見える所の下の端は 839 − 75 = 764: 839 − 764 = 75px 送る
    expect(weekTo).toHaveBeenLastCalledWith({ left: 0, top: 875, behavior: 'smooth' })
    // 週の終わりの近く（あと 30px しか送れない）では、送れる所まで
    const endTo = geom(week, { rect: [16, 214, 380, 630], scroll: [380, 1460], at: { top: 800 } })
    scrollIntoViewWithin(card, { bottomInset: 75 })
    expect(endTo).toHaveBeenLastCalledWith({ left: 0, top: 830, behavior: 'smooth' })
  })

  it('toastInset: 出ているお知らせと横に重なる時だけ、お知らせの上の端から画面の下の端まで + 8px', () => {
    const card = div(document.body)
    geom(card, { rect: [20, 795, 170, 44] })
    expect(toastInset(card)).toBe(0)
    // 画面の下の真ん中（412px の画面で幅 388px）の、772〜823 のお知らせ
    const box = toasts([12, 772, 388, 51])
    expect(toastInset(card)).toBe(839 - 772 + 8)
    // 横に重ならない物（L の左の端の列など）は空けない
    const left = div(document.body)
    geom(left, { rect: [0, 795, 10, 44] })
    expect(toastInset(left)).toBe(0)
    // 小さな画面を開いている間は上に出している（下を空けない）
    geom(box, { rect: [12, 12, 388, 51] })
    expect(toastInset(card)).toBe(0)
    // 中が空（お知らせが消えた）
    geom(box, { rect: [12, 772, 388, 51] })
    box.replaceChildren()
    expect(toastInset(card)).toBe(0)
  })
})

// 戻した・やり直した予定が見えているか（見えている時だけ、すばやく足すの入力欄をお知らせの上へ送る。7.13・■26）。
// scrollIntoViewWithin が動かさない（もう見える所に入っている）時を「見えている」とする
describe('isShownWithin（見えているか）', () => {
  /** S の週（画面 412×839 の 214〜844。下の 5px は画面の外）> カード */
  function weekWith(card: [number, number, number, number], at = 0) {
    const week = div(document.body, { overflowY: 'auto' })
    geom(week, { rect: [16, 214, 380, 630], scroll: [380, 1460], at: { top: at } })
    const el = div(week)
    geom(el, { rect: card })
    return el
  }

  it('箱の見える所に全部入っていれば見えている', () => {
    expect(isShownWithin(weekWith([20, 300, 170, 44]))).toBe(true)
  })

  it('箱のスクロールの外（下・上）は見えていない。少しでも切れていれば見えていない（目立たせる時に全部出す）', () => {
    expect(isShownWithin(weekWith([20, 900, 170, 44]))).toBe(false)
    expect(isShownWithin(weekWith([20, 150, 170, 44]))).toBe(false)
    expect(isShownWithin(weekWith([20, 820, 170, 44]))).toBe(false)
  })

  it('画面の外に出た所は見えていない（週の下の端が画面の下に出ている時）', () => {
    expect(isShownWithin(weekWith([20, 800, 170, 44]))).toBe(false)
    expect(isShownWithin(weekWith([20, 790, 170, 44]))).toBe(true)
  })

  it('見える所より大きくて両側にはみ出している物は見えている（送っても変わらない）', () => {
    expect(isShownWithin(weekWith([20, 200, 170, 700]))).toBe(true)
  })

  it('スクロールしない箱の中でも、画面の外にあれば見えていない（S・M でページを下のリストまで送っている時）', () => {
    const el = div(document.body)
    geom(el, { rect: [20, 900, 170, 44] })
    expect(isShownWithin(el)).toBe(false)
    geom(el, { rect: [20, -60, 170, 44] })
    expect(isShownWithin(el)).toBe(false)
    geom(el, { rect: [20, 100, 170, 44] })
    expect(isShownWithin(el)).toBe(true)
  })

  it('外れている要素は見えていない', () => {
    const el = document.createElement('div')
    expect(isShownWithin(el)).toBe(false)
    expect(isShownWithin(null)).toBe(false)
  })
})
