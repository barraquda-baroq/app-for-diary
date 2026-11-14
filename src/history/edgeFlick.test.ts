// 画面の端からのフリックを受け取る所（src/history/edgeFlick.ts。docs/SPEC.md の 3.1・3.7。22. の ■31〜■33）: iPhone・iPad では
// ブラウザの履歴を1つのままにしているので、画面の端から払った指はブラウザの身振りにならず、ページに来る。それを window の
// 捕まえる段の touch の出来事で受け取り、画面の左右の端から EDGE_ZONE_PX（20px）の中で押して、内へ払って離した指だけを flick に
// 渡す（-1 = 左の端から右へ、1 = 右の端から左へ）。決まり（60px・30°・払い始めが横なら 45°・400ms の長押し）は swipe.ts と同じ。
// 入力欄・横にスクロールできる所の上から押した指・ドラッグの途中・押した後に前の版の履歴への身振り（popstate）が来た指は渡さない。
// 渡した後 300ms の間の click は打ち消す。付けるのは iPhone・iPad の1つの履歴の形（SingleEntryHistory）の時だけ
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screenOf } from '../features/calendar/common/calendarHistory'
import { EDGE_ZONE_PX, SWIPE_CLICK_GUARD_MS } from '../features/calendar/common/swipe'
import { FakeWindow } from '../test/fakeHistoryWindow'
import { AppHistory } from './appHistory'
import { attachEdgeFlick, edgeOfScreen, installEdgeFlick } from './edgeFlick'
import { SingleEntryHistory } from './singleEntryHistory'
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
  localStorage.clear()
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('画面の端から内へ払った指を受け取る（installEdgeFlick）', () => {
  it('左の端（5px）から右へ 100px を 0.2秒の内に払うと flick(-1)、右の端（幅 − 5px）から左へ 100px は flick(1)。端から 25px の所からは何もしない', () => {
    const flick = install()
    swipe(5, 100)
    expect(flick.mock.calls).toEqual([[-1]])
    swipe(width() - 5, -100)
    expect(flick.mock.calls).toEqual([[-1], [1]])
    swipe(25, 100)
    swipe(width() - 25, -100)
    swipe(EDGE_ZONE_PX, 100)
    expect(flick).toHaveBeenCalledTimes(2)
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

  it('入力欄・横にスクロールできる所の上から押した指は渡さない。ほかの所の入力欄にフォーカスがあっても（すばやく足す・キーボードが出ている）、端から払えば渡す', () => {
    const flick = install()
    document.body.innerHTML =
      '<input data-testid="field" /><div data-testid="pad">余白</div><textarea data-testid="memo"></textarea>'
    const field = document.querySelector('[data-testid="field"]')!
    const memo = document.querySelector('[data-testid="memo"]')!
    const pad = document.querySelector('[data-testid="pad"]')!
    swipe(5, 100, { target: field })
    swipe(width() - 5, -100, { target: memo })
    expect(flick).not.toHaveBeenCalled()
    ;(field as HTMLInputElement).focus()
    expect(document.activeElement).toBe(field)
    swipe(5, 100, { target: pad })
    expect(flick.mock.calls).toEqual([[-1]])
  })

  it(`渡した後 ${SWIPE_CLICK_GUARD_MS}ms の間に来た click は1つだけ打ち消す（払った指で、離した所のボタンを押さない）。その後の click は効く`, () => {
    install()
    document.body.innerHTML = '<button type="button">押せる物</button>'
    const button = document.querySelector('button')!
    const clicked = vi.fn()
    button.addEventListener('click', clicked)
    swipe(5, 100)
    clock += 100
    button.click()
    expect(clicked).not.toHaveBeenCalled()
    button.click()
    expect(clicked).toHaveBeenCalledTimes(1)
    swipe(5, 100)
    clock += SWIPE_CLICK_GUARD_MS + 1
    button.click()
    expect(clicked).toHaveBeenCalledTimes(2)
    // 渡さなかった指（外へ）の後は打ち消さない
    swipe(5, -100)
    button.click()
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

  it('記録を取る時は、端で押した指（edge-down）と離した指（edge-up: 動き・長さ・向き・どうしたか）を控える。端でない指は控えない', () => {
    setSwipeLogEnabled(true)
    install()
    swipe(5, 100)
    swipe(width() - 5, 100)
    swipe(200, 100)
    const log = swipeLogText()
    expect(log).toMatch(/ edge-down \{"x":5,"y":300,"side":-1,"w":\d+\}/)
    expect(log).toMatch(/ edge-up \{"x0":5,"dx":100,"dy":0,"ms":120,"dir":-1,"result":"flick"\}/)
    expect(log).toMatch(/ edge-up \{"x0":\d+,"dx":100,"dy":0,"ms":120,"dir":-1,"result":"outward"\}/)
    expect(log.split('\n').filter((l) => / edge-down /.test(l))).toHaveLength(2)
  })
})

describe('画面の端の決め方（edgeOfScreen）', () => {
  it(`見えている所（visualViewport）の左右の端から ${EDGE_ZONE_PX}px の中: 左 -1・右 1、ほか null。拡大している時は、見えている所の端で決める`, () => {
    const win = { innerWidth: 390 } as unknown as Window
    expect(edgeOfScreen(5, win)).toBe(-1)
    expect(edgeOfScreen(385, win)).toBe(1)
    expect(edgeOfScreen(30, win)).toBeNull()
    const zoomed = { innerWidth: 390, visualViewport: { offsetLeft: 100, width: 195 } } as unknown as Window
    expect(edgeOfScreen(105, zoomed)).toBe(-1)
    expect(edgeOfScreen(290, zoomed)).toBe(1)
    expect(edgeOfScreen(5 + 0, { innerWidth: 390, visualViewport: { offsetLeft: 0, width: 390 } } as unknown as Window)).toBe(-1)
    expect(edgeOfScreen(200, zoomed)).toBeNull()
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
})
