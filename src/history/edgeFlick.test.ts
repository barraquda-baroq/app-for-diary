// 画面の端からのフリックを受け取る所（src/history/edgeFlick.ts。docs/SPEC.md の 3.1・3.7。22. の ■31〜■33）: iPhone・iPad では
// ブラウザの履歴を1つのままにしているので、画面の端から払った指はブラウザの身振りにならず、ページに来る。それを window の
// 捕まえる段の touch の出来事で受け取り、画面の左右の端から端の幅（初めは EDGE_ZONE_PX の 44px。設定の「開発」の「端の幅」で
// 20・28・36・44px から選ぶ。src/history/edgeZone.ts）の中で押して、内へ払って離した指だけを flick に渡す（-1 = 左の端から右へ、
// 1 = 右の端から左へ）。決まり（60px・30°・払い始めが横なら 45°・400ms の長押し）は swipe.ts と同じ。横にスクロールできる所・
// フォーカスのある入力欄の上から押した指・ドラッグの途中・押した後に前の版の履歴への身振り（popstate）が来た指は渡さない
// （フォーカスの無い入力欄の上から押した指は渡す。22. の「端からのフリックの3回目の直した版（788e842）を試した答え」。拡大している
// 時は、フォーカスの無い入力欄の上からも渡さず、端の幅も画面の上の長さで決める）。
// 渡した後 300ms の間の click は打ち消す。付けるのは iPhone・iPad の1つの履歴の形（SingleEntryHistory）の時だけ
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screenOf } from '../features/calendar/common/calendarHistory'
import { EDGE_ZONE_PX, SWIPE_CLICK_GUARD_MS, SWIPE_SLOP_PX } from '../features/calendar/common/swipe'
import { FakeWindow } from '../test/fakeHistoryWindow'
import { AppHistory } from './appHistory'
import { attachEdgeFlick, edgeOfScreen, installEdgeFlick } from './edgeFlick'
import { SingleEntryHistory } from './singleEntryHistory'
import { setEdgeZonePx } from './edgeZone'
import { clearSwipeLog, setSwipeLogEnabled, swipeLogText } from './swipeLog'

/** テストの時計（installEdgeFlick の now。押した時刻・長押し・click を打ち消す間を決める） */
let clock = 1000
const now = () => clock

const width = () => window.innerWidth

/** touch の出来事を target へ送る（jsdom には Touch が無いので、座標の入った物を持たせる。fingers は今触れている指の数） */
function send(target: EventTarget, type: string, x: number, y: number, fingers: number) {
  const ev = new Event(type, { bubbles: true, cancelable: true })
  const point = { clientX: x, clientY: y }
  Object.defineProperty(ev, 'touches', { value: Array.from({ length: fingers }, () => point) })
  Object.defineProperty(ev, 'changedTouches', { value: [point] })
  target.dispatchEvent(ev)
}

interface SwipeOptions {
  dy?: number
  ms?: number
  steps?: number
  /** 押してから動かし始めるまで（ms） */
  holdMs?: number
  target?: EventTarget
}

/** x0 で押し、横へ dx（縦へ dy）を steps 回に分けて ms で動かして離す */
function swipe(x0: number, dx: number, { dy = 0, ms = 120, steps = 4, holdMs = 0, target = document.body }: SwipeOptions = {}) {
  const y0 = 300
  send(target, 'touchstart', x0, y0, 1)
  clock += holdMs
  for (let i = 1; i <= steps; i++) {
    clock += ms / steps
    send(target, 'touchmove', x0 + (dx * i) / steps, y0 + (dy * i) / steps, 1)
  }
  send(target, 'touchend', x0 + dx, y0 + dy, 0)
}

/** 拡大した見えている所（visualViewport）を window に持たせる（jsdom には無い。後で外す） */
function zoomTo(vv: { offsetLeft: number; width: number; scale: number }) {
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: vv })
}

let uninstall: (() => void) | null = null
const disposers: (() => void)[] = []

function install(over: { userPopSince?: (t: number) => boolean; dragging?: () => boolean } = {}) {
  const flick = vi.fn()
  uninstall = installEdgeFlick(window, { flick, now, ...over })
  return flick
}

beforeEach(() => {
  clock = 1000
})

afterEach(() => {
  uninstall?.()
  uninstall = null
  for (const d of disposers.splice(0)) d()
  setSwipeLogEnabled(false)
  clearSwipeLog()
  setEdgeZonePx(EDGE_ZONE_PX)
  localStorage.clear()
  delete (window as { visualViewport?: unknown }).visualViewport
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('画面の端から内へ払った指を受け取る（installEdgeFlick）', () => {
  it('左の端（5px）から右へ 100px を 0.2秒の内に払うと flick(-1)、右の端（幅 − 5px）から左へ 100px は flick(1)。端から 30px・40px・43px（初めの端の幅 44px の中）からも渡し、44px・50px の所からは何もしない', () => {
    const flick = install()
    swipe(5, 100)
    expect(flick.mock.calls).toEqual([[-1]])
    swipe(width() - 5, -100)
    expect(flick.mock.calls).toEqual([[-1], [1]])
    swipe(30, 100)
    swipe(width() - 30, -100)
    expect(flick.mock.calls).toEqual([[-1], [1], [-1], [1]])
    swipe(40, 100)
    swipe(width() - 40, -100)
    swipe(EDGE_ZONE_PX - 1, 100)
    swipe(width() - EDGE_ZONE_PX + 1, -100)
    expect(flick.mock.calls).toEqual([[-1], [1], [-1], [1], [-1], [1], [-1], [1]])
    swipe(EDGE_ZONE_PX, 100)
    swipe(width() - EDGE_ZONE_PX, -100)
    swipe(50, 100)
    swipe(width() - 50, -100)
    expect(flick).toHaveBeenCalledTimes(8)
  })

  it('設定の「開発」で端の幅を替えると、付けたまま（読み込み直さずに）次の指から効く: 20px なら 30px の所からは何もせず、36px（前の幅）なら 40px の所からは何もせず、44px（初めの幅）に戻すと 40px の所からも渡す', () => {
    const flick = install()
    setEdgeZonePx(20)
    swipe(30, 100)
    swipe(width() - 30, -100)
    expect(flick).not.toHaveBeenCalled()
    swipe(19, 100)
    expect(flick.mock.calls).toEqual([[-1]])
    setEdgeZonePx(36)
    swipe(40, 100)
    swipe(width() - 40, -100)
    expect(flick.mock.calls).toEqual([[-1]])
    swipe(35, 100)
    swipe(width() - 35, -100)
    expect(flick.mock.calls).toEqual([[-1], [-1], [1]])
    setEdgeZonePx(44)
    swipe(40, 100)
    swipe(width() - 40, -100)
    expect(flick.mock.calls).toEqual([[-1], [-1], [1], [-1], [1]])
  })

  it('外へ払った指・短い指（50px）・縦寄りの指・2本の指・止まってから動かした指（400ms。ドラッグの掴み方）・端末が取った指（touchcancel）では何もしない', () => {
    const flick = install()
    // 外へ
    swipe(5, -100)
    swipe(width() - 5, 100)
    // 短い
    swipe(5, 50)
    // 縦寄り（払い始めから 63°）
    swipe(5, 70, { dy: 140 })
    // 2本の指: 2本目が触れたらやめる
    send(document.body, 'touchstart', 5, 300, 1)
    send(document.body, 'touchstart', 200, 300, 2)
    send(document.body, 'touchmove', 105, 300, 2)
    send(document.body, 'touchend', 105, 300, 1)
    send(document.body, 'touchend', 105, 300, 0)
    // 初めから2本
    send(document.body, 'touchstart', 5, 300, 2)
    send(document.body, 'touchend', 105, 300, 0)
    // 400ms 止まってから動かす
    swipe(5, 120, { holdMs: 400 })
    // touchcancel
    send(document.body, 'touchstart', 5, 300, 1)
    clock += 30
    send(document.body, 'touchmove', 60, 300, 1)
    send(document.body, 'touchcancel', 60, 300, 0)
    send(document.body, 'touchend', 120, 300, 0)
    expect(flick).not.toHaveBeenCalled()
    // 弧で終わりが逸れても、払い始めが横なら 45° まで渡す（swipe.ts と同じ）
    send(document.body, 'touchstart', 5, 300, 1)
    clock += 20
    send(document.body, 'touchmove', 35, 302, 1)
    clock += 60
    send(document.body, 'touchend', 165, 420, 0)
    expect(flick.mock.calls).toEqual([[-1]])
  })

  it('押した後に前の版の履歴への身振り（popstate）が来た指・ドラッグの途中の指では何もしない。比べる時刻は押した時', () => {
    let popped = true
    let dragging = false
    const userPopSince = vi.fn(() => popped)
    const flick = install({ userPopSince, dragging: () => dragging })
    swipe(5, 100)
    expect(flick).not.toHaveBeenCalled()
    expect(userPopSince).toHaveBeenCalledWith(1000)
    popped = false
    dragging = true
    swipe(5, 100)
    expect(flick).not.toHaveBeenCalled()
    // 押した時はドラッグの途中でなくても、離した時にドラッグの途中なら渡さない
    dragging = false
    send(document.body, 'touchstart', 5, 300, 1)
    dragging = true
    send(document.body, 'touchmove', 105, 300, 1)
    send(document.body, 'touchend', 105, 300, 0)
    expect(flick).not.toHaveBeenCalled()
    dragging = false
    swipe(5, 100)
    expect(flick).toHaveBeenCalledTimes(1)
  })

  it('フォーカスの無い入力欄（件名・メモの欄。端から 16px ほどまで届く）の上から押した指は渡す（開発。端を甘くする）。ほかの所の入力欄にフォーカスがあっても（すばやく足す・キーボードが出ている）、端から払えば渡す', () => {
    const flick = install()
    document.body.innerHTML =
      '<input data-testid="field" /><div data-testid="pad">余白</div><textarea data-testid="memo"></textarea><select data-testid="pick"><option>a</option></select>'
    const field = document.querySelector('[data-testid="field"]')!
    const memo = document.querySelector('[data-testid="memo"]')!
    const pad = document.querySelector('[data-testid="pad"]')!
    const pick = document.querySelector('[data-testid="pick"]')!
    swipe(24, 100, { target: field })
    swipe(width() - 24, -100, { target: memo })
    swipe(5, 100, { target: pick })
    expect(flick.mock.calls).toEqual([[-1], [1], [-1]])
    ;(field as HTMLInputElement).focus()
    expect(document.activeElement).toBe(field)
    swipe(5, 100, { target: pad })
    swipe(width() - 5, -100, { target: memo })
    expect(flick.mock.calls).toEqual([[-1], [1], [-1], [-1], [1]])
  })

  it('拡大している時（2本の指で広げた・ダブルタップ。visualViewport.scale）は、端の幅を画面の上の長さで決め（2倍なら見えている所の端から 22px）、フォーカスの無い入力欄の上から押した指も渡さない（拡大した画面を動かす指と分ける。788e842 と同じ）。欄の外の端からは渡す', () => {
    setSwipeLogEnabled(true)
    const flick = install()
    zoomTo({ offsetLeft: 0, width: width() / 2, scale: 2 })
    document.body.innerHTML = '<input data-testid="field" /><textarea data-testid="memo"></textarea>'
    const field = document.querySelector('[data-testid="field"]')!
    const memo = document.querySelector('[data-testid="memo"]')!
    swipe(5, 100, { target: field })
    swipe(width() / 2 - 5, -100, { target: memo })
    // 見えている所の端から 25px（画面の上で 50px。端の幅 44px の外）は、欄の外でも端の指ではない
    swipe(25, 100)
    expect(flick).not.toHaveBeenCalled()
    swipe(5, 100)
    swipe(width() / 2 - 5, -100)
    expect(flick.mock.calls).toEqual([[-1], [1]])
    const log = swipeLogText()
    expect(log.split('\n').filter((l) => / edge-skip \{"why":"zoomed"\}/.test(l))).toHaveLength(2)
    expect(log).toMatch(/ edge-down \{"x":5,"y":300,"side":-1,"w":\d+,"zone":44,"scale":2\}/)
  })

  it('フォーカスのある入力欄（カーソル・字を選ぶつまみがある）の上から押した指は渡さない。書ける要素（contenteditable）は、フォーカスのある要素の中の物の上からも渡さない', () => {
    const flick = install()
    document.body.innerHTML =
      '<input data-testid="field" /><textarea data-testid="memo"></textarea><div data-testid="note" contenteditable="true" tabindex="0"><span data-testid="word">字</span></div>'
    const field = document.querySelector('[data-testid="field"]') as HTMLInputElement
    const memo = document.querySelector('[data-testid="memo"]') as HTMLTextAreaElement
    const note = document.querySelector('[data-testid="note"]') as HTMLElement
    const word = document.querySelector('[data-testid="word"]')!
    // jsdom は contenteditable の isContentEditable を持たないので、ブラウザと同じく中の物も書ける物にする
    for (const el of [note, word]) Object.defineProperty(el, 'isContentEditable', { value: true })
    field.focus()
    swipe(24, 100, { target: field })
    memo.focus()
    swipe(width() - 24, -100, { target: memo })
    note.focus()
    swipe(5, 100, { target: word })
    expect(flick).not.toHaveBeenCalled()
    // フォーカスを外せば渡す
    note.blur()
    swipe(5, 100, { target: word })
    expect(flick.mock.calls).toEqual([[-1]])
  })

  it('横にスクロールできる所・範囲（スライダー）の上から押した指は、フォーカスが無くても渡さない', () => {
    const flick = install()
    document.body.innerHTML =
      '<div data-testid="wide" style="overflow-x: auto"><div data-testid="inner">横に長い物</div></div><input type="range" data-testid="slider" />'
    const wide = document.querySelector('[data-testid="wide"]') as HTMLElement
    Object.defineProperty(wide, 'scrollWidth', { value: 800 })
    Object.defineProperty(wide, 'clientWidth', { value: 300 })
    swipe(5, 100, { target: document.querySelector('[data-testid="inner"]')! })
    swipe(5, 100, { target: document.querySelector('[data-testid="slider"]')! })
    expect(flick).not.toHaveBeenCalled()
  })

  it(`渡した後 ${SWIPE_CLICK_GUARD_MS}ms の間に、離した所（${SWIPE_SLOP_PX}px の内）に来た click は1つだけ打ち消す（払った指で、離した所のボタンを押さない）。その後の click は効く`, () => {
    install()
    document.body.innerHTML = '<button type="button">押せる物</button>'
    const button = document.querySelector('button')!
    const clicked = vi.fn()
    button.addEventListener('click', clicked)
    /** 離した所（5 + 100, 300）の近くの click */
    const clickAtLift = () => button.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 105 + 3, clientY: 300 - 2 }))
    swipe(5, 100)
    clock += 100
    clickAtLift()
    expect(clicked).not.toHaveBeenCalled()
    clickAtLift()
    expect(clicked).toHaveBeenCalledTimes(1)
    swipe(5, 100)
    clock += SWIPE_CLICK_GUARD_MS + 1
    clickAtLift()
    expect(clicked).toHaveBeenCalledTimes(2)
    // 渡さなかった指（外へ）の後は打ち消さない
    swipe(5, -100)
    clickAtLift()
    expect(clicked).toHaveBeenCalledTimes(3)
  })

  it(`払った後 ${SWIPE_CLICK_GUARD_MS}ms の内でも、離した所から離れた所を押した click（すぐ次に押した別の指・キーボード）は打ち消さない`, () => {
    install()
    document.body.innerHTML = '<button type="button">押せる物</button>'
    const button = document.querySelector('button')!
    const clicked = vi.fn()
    button.addEventListener('click', clicked)
    swipe(5, 100)
    clock += 50
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 300, clientY: 500 }))
    expect(clicked).toHaveBeenCalledTimes(1)
    // キーボードの Enter・Space の click（座標は 0, 0）
    swipe(5, 100)
    clock += 50
    button.click()
    expect(clicked).toHaveBeenCalledTimes(2)
    // 打ち消す分は残らない（その後に離した所へ来た click も効く。打ち消すのは、払った直後の1つだけ）
    clock += SWIPE_CLICK_GUARD_MS + 1
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 105, clientY: 300 }))
    expect(clicked).toHaveBeenCalledTimes(3)
  })

  it('押した要素が払っている間に外れても（画面が替わった。外れた要素へ送られる touch の出来事は window まで伝わらない）、離すまで追って渡す', () => {
    const flick = install()
    document.body.innerHTML = '<div data-testid="pressed">カレンダー</div>'
    const pressed = document.querySelector('[data-testid="pressed"]')!
    send(pressed, 'touchstart', 5, 300, 1)
    pressed.remove()
    clock += 60
    send(pressed, 'touchmove', 60, 300, 1)
    clock += 60
    send(pressed, 'touchend', 120, 300, 0)
    expect(flick.mock.calls).toEqual([[-1]])
    // window にも押した要素にも来る（ふつうの）時は1回だけ
    swipe(5, 100, { target: document.body })
    expect(flick.mock.calls).toEqual([[-1], [-1]])
  })

  it('外すと、もう受け取らない', () => {
    const flick = install()
    uninstall?.()
    uninstall = null
    swipe(5, 100)
    expect(flick).not.toHaveBeenCalled()
  })

  it('記録を取る時は、端で押した指（edge-down: 位置・端・見えている所の幅・端の幅）と離した指（edge-up: 動き・長さ・向き・どうしたか）を控える。端でない指は控えない', () => {
    setSwipeLogEnabled(true)
    install()
    swipe(5, 100)
    swipe(width() - 5, 100)
    swipe(200, 100)
    setEdgeZonePx(20)
    swipe(6, 100)
    const log = swipeLogText()
    expect(log).toMatch(/ edge-down \{"x":5,"y":300,"side":-1,"w":\d+,"zone":44\}/)
    expect(log).toMatch(/ edge-down \{"x":6,"y":300,"side":-1,"w":\d+,"zone":20\}/)
    expect(log).toMatch(/ edge-up \{"x0":5,"dx":100,"dy":0,"ms":120,"dir":-1,"result":"flick"\}/)
    expect(log).toMatch(/ edge-up \{"x0":\d+,"dx":100,"dy":0,"ms":120,"dir":-1,"result":"outward"\}/)
    expect(log.split('\n').filter((l) => / edge-down /.test(l))).toHaveLength(3)
  })

  it('押した時にドラッグの途中なら、その指は追わずに数えなかった訳（edge-skip drag）を控える。フォーカスのある入力欄の上は focused、横にスクロールできる所の上は sideways', () => {
    setSwipeLogEnabled(true)
    let dragging = true
    const flick = install({ dragging: () => dragging })
    send(document.body, 'touchstart', 5, 300, 1)
    dragging = false
    clock += 60
    send(document.body, 'touchmove', 105, 300, 1)
    send(document.body, 'touchend', 105, 300, 0)
    expect(flick).not.toHaveBeenCalled()
    document.body.innerHTML = '<input data-testid="field" /><div data-testid="wide" style="overflow-x: scroll">横</div>'
    const field = document.querySelector('[data-testid="field"]') as HTMLInputElement
    field.focus()
    swipe(5, 100, { target: field })
    const wide = document.querySelector('[data-testid="wide"]') as HTMLElement
    Object.defineProperty(wide, 'scrollWidth', { value: 800 })
    Object.defineProperty(wide, 'clientWidth', { value: 300 })
    swipe(5, 100, { target: wide })
    const lines = swipeLogText().split('\n')
    expect(lines.filter((l) => / edge-skip /.test(l)).map((l) => l.replace(/^\d+ /, ''))).toEqual([
      'edge-skip {"why":"drag"}',
      'edge-skip {"why":"focused"}',
      'edge-skip {"why":"sideways"}',
    ])
    expect(lines.some((l) => / edge-up /.test(l))).toBe(false)
  })
})

describe('画面の端の決め方（edgeOfScreen）', () => {
  it(`見えている所（visualViewport）の左右の端から端の幅（初めは ${EDGE_ZONE_PX}px）の中: 左 -1・右 1、ほか null。拡大している時は、見えている所の端で決める`, () => {
    const win = { innerWidth: 390 } as unknown as Window
    expect(edgeOfScreen(5, win)).toBe(-1)
    expect(edgeOfScreen(385, win)).toBe(1)
    expect(edgeOfScreen(30, win)).toBe(-1)
    expect(edgeOfScreen(40, win)).toBe(-1)
    expect(edgeOfScreen(43, win)).toBe(-1)
    expect(edgeOfScreen(44, win)).toBeNull()
    expect(edgeOfScreen(50, win)).toBeNull()
    expect(edgeOfScreen(346, win)).toBeNull()
    expect(edgeOfScreen(347, win)).toBe(1)
    expect(edgeOfScreen(350, win)).toBe(1)
    const zoomed = { innerWidth: 390, visualViewport: { offsetLeft: 100, width: 195, scale: 2 } } as unknown as Window
    expect(edgeOfScreen(105, zoomed)).toBe(-1)
    expect(edgeOfScreen(290, zoomed)).toBe(1)
    expect(edgeOfScreen(5 + 0, { innerWidth: 390, visualViewport: { offsetLeft: 0, width: 390 } } as unknown as Window)).toBe(-1)
    expect(edgeOfScreen(200, zoomed)).toBeNull()
  })

  it('拡大している時は、端の幅を画面の上の長さ（拡大する前の px）で決める: 2倍なら見えている所の端から 22px（36px を選んでいれば 18px）の中だけ。倍率が無い・おかしい時は 1倍', () => {
    const zoomed = { innerWidth: 390, visualViewport: { offsetLeft: 100, width: 195, scale: 2 } } as unknown as Window
    expect(edgeOfScreen(100 + 21, zoomed)).toBe(-1)
    expect(edgeOfScreen(100 + 23, zoomed)).toBeNull()
    expect(edgeOfScreen(100 + 30, zoomed)).toBeNull()
    expect(edgeOfScreen(100 + 195 - 21, zoomed)).toBe(1)
    expect(edgeOfScreen(100 + 195 - 23, zoomed)).toBeNull()
    setEdgeZonePx(36)
    expect(edgeOfScreen(100 + 17, zoomed)).toBe(-1)
    expect(edgeOfScreen(100 + 19, zoomed)).toBeNull()
    expect(edgeOfScreen(100 + 195 - 17, zoomed)).toBe(1)
    expect(edgeOfScreen(100 + 195 - 19, zoomed)).toBeNull()
    setEdgeZonePx(44)
    for (const scale of [NaN, 0, -1, undefined]) {
      const odd = { innerWidth: 390, visualViewport: { offsetLeft: 0, width: 390, scale } } as unknown as Window
      expect(edgeOfScreen(43, odd)).toBe(-1)
      expect(edgeOfScreen(45, odd)).toBeNull()
    }
  })
})

describe('付けるのは iPhone・iPad の1つの履歴の形の時だけ（attachEdgeFlick）', () => {
  it('Android・PC（OS の戻る。AppHistory）には付けない（端から払っても何もしない）', () => {
    const h = new AppHistory({ window: new FakeWindow('#/week/2026-11-08'), source: 'os-back', armOnLeaveFail: false, screenOf })
    disposers.push(() => h.dispose())
    const ring = vi.fn()
    h.handlers = { ring }
    expect(attachEdgeFlick(h, { win: window })).toBeNull()
    swipe(5, 100)
    expect(ring).not.toHaveBeenCalled()
  })

  it('iPhone・iPad（SingleEntryHistory）には付け、払った指をその flick に渡す（カレンダーでは左の端から ring(1)、右の端から ring(-1)）', () => {
    const h = new SingleEntryHistory({
      window: new FakeWindow('#/week/2026-11-08'),
      source: 'edge-flick',
      armOnLeaveFail: false,
      screenOf,
      now,
    })
    disposers.push(() => h.dispose())
    const ring = vi.fn()
    h.handlers = { ring }
    const detach = attachEdgeFlick(h, { win: window, now })
    expect(detach).not.toBeNull()
    disposers.push(() => detach?.())
    swipe(5, 100)
    swipe(width() - 5, -100)
    expect(ring.mock.calls).toEqual([[1], [-1]])
  })

  it('前の版が残した履歴の中で、指を下ろした後・離す前に iPhone の身振りの popstate が来た時は、履歴の方で1回だけ回し、離した指では回さない（1回の払いで2つ進まない）', () => {
    const win = new FakeWindow('#/week/2026-11-08')
    win.seed(
      [
        { hash: '#/week/2026-11-08', state: { usr: null, key: 'a', idx: 0, ds: { base: 1, mark: 'back' } } },
        { hash: '#/week/2026-11-08', state: { usr: null, key: 'b', idx: 1, ds: { base: 1 } } },
      ],
      1,
    )
    const h = new SingleEntryHistory({ window: win, source: 'edge-flick', armOnLeaveFail: false, screenOf, now })
    disposers.push(() => h.dispose())
    const ring = vi.fn()
    h.handlers = { ring }
    const detach = attachEdgeFlick(h, { win: window, now })
    disposers.push(() => detach?.())
    send(document.body, 'touchstart', 5, 300, 1)
    clock += 40
    send(document.body, 'touchmove', 45, 300, 1)
    // 身振りが指を取り、前の印の履歴へ着いた（WebKit は、離す出来事を popstate の前後に送る）
    win.index = 0
    win.dispatch('popstate', new Event('popstate'))
    expect(ring.mock.calls).toEqual([[1]])
    clock += 40
    send(document.body, 'touchmove', 125, 300, 1)
    send(document.body, 'touchend', 125, 300, 0)
    expect(ring.mock.calls).toEqual([[1]])
    // 後の払いは、ページの中で受け取って回す
    clock += 1000
    swipe(5, 100)
    expect(ring.mock.calls).toEqual([[1], [1]])
  })
})
