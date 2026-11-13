// アプリの履歴（docs/SPEC.md の 3.1。22. の段階2の終わりの確かめの「画面の外からのフリックの決め」・■22・■23）: 履歴の形（土台の前後に
// 「戻る」「進む」の印）を押した時に作り、カレンダーの中の行き来は土台を置き換えるだけで増やさない。「戻る」「進む」が来たら、
// iPhone（端からのフリック）はモードを回し、Android のブラウザのタブ・PC（OS の戻る）は閉じるかを聞き、ホーム画面から開いた Android の
// アプリは聞かずに、もう一度［戻る］で閉じる所にし（■25）、どれも土台へ戻す（ルーターには渡さない）。
// 登録・詳細の画面・ほかの画面での扱い、ルーターの戻る（閉じる・書きかけの確かめ）、読み込み直し、アプリを閉じる。
// 押している間・ドラッグの途中は、アプリから履歴を動かさない（印の履歴は押し終えてから作る。その間も「戻る」「進む」から戻すのは待たない。
// 離す出来事が来ないまま残った指は、次に指を下ろした時に捨てる）。印の履歴は、スクロールの位置を戻させない。
// iPhone の身振りの絵（WebKit のまね: src/test/fakeHistoryWindow.ts）: 払いの popstate で最初に今の履歴を置き換え、popstate の中では
// 積まない。回した後は動かない。閉じた後に1度だけ「進む」の印の絵を写す（指が下りている間は動かない）。行き先は身振りの始まりに決まる
import type { Location } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screenOf } from '../features/calendar/common/calendarHistory'
import { FakeWindow, type FakeWindowOptions, type HistoryCall } from '../test/fakeHistoryWindow'
import { AppHistory, ARM_HOLD_MS, createAppHistory, PRESS_STALE_MS, userPopSince, type LeaveResult } from './appHistory'
import { clearSwipeLog, setSwipeLogEnabled, swipeLogText } from './swipeLog'
import type { ExitStyle, PopSource } from './popRules'

type Update = Parameters<Parameters<AppHistory['listen']>[0]>[0]

let keySeq = 0
/** ルーターが渡す形の行き先 */
function loc(pathname: string, state: unknown = null): Location {
  return { pathname, search: '', hash: '', state, key: `k${++keySeq}` }
}

const register = { sheet: { kind: 'register', init: { start: '2026-11-10', kind: 'work' } }, sheetPage: 'p' }
const detail = { sheet: { kind: 'detail', id: 'i1' }, sheetPage: 'p' }

interface Setup {
  win: FakeWindow
  h: AppHistory
  updates: Update[]
  ring: ReturnType<typeof vi.fn>
  askExit: ReturnType<typeof vi.fn>
}

function setup(
  hash: string,
  source: PopSource,
  {
    armOnLeaveFail = false,
    before = 0,
    win,
    exit,
  }: { armOnLeaveFail?: boolean; before?: number; win?: FakeWindow; exit?: ExitStyle } = {},
): Setup {
  const w = win ?? new FakeWindow(hash, { before })
  const h = new AppHistory({ window: w, source, exit, armOnLeaveFail, screenOf })
  const updates: Update[] = []
  const ring = vi.fn()
  const askExit = vi.fn()
  h.handlers = { ring, askExit }
  h.listen((u) => updates.push(u))
  disposers.push(() => h.dispose())
  return { win: w, h, updates, ring, askExit }
}

const disposers: (() => void)[] = []

/** 履歴が落ち着くまで（ブラウザの go の popstate・待つ時間を進める） */
async function settle(h: AppHistory) {
  await vi.runAllTimersAsync()
  await h.whenIdle()
}

/** 押して、土台と印の履歴を作らせる */
async function arm(s: Setup) {
  s.win.press()
  await settle(s.h)
}

/** pointer の出来事（pointerId と押しているボタン付き。番号は、決めなければマウスは 1、指は 2、ペンは 3。primary = isPrimary） */
function pointer(
  type: string,
  pointerType: 'mouse' | 'touch' | 'pen',
  buttons = 0,
  { id, primary = false }: { id?: number; primary?: boolean } = {},
): Event {
  const pointerId = id ?? { mouse: 1, touch: 2, pen: 3 }[pointerType]
  return Object.assign(new Event(type), { pointerType, pointerId, buttons, isPrimary: primary })
}

/** touch の出来事（画面に触れている指の数） */
function touch(type: string, count: number): Event {
  return Object.assign(new Event(type), { touches: { length: count } })
}

/** 送る */
function fire(s: Setup, event: Event) {
  s.win.dispatch(event.type, event)
}

/**
 * 指で軽く押して離す（本物の順: pointerdown・touchstart・pointerup・touchend・click。指は離した時に「押した」になる）。id はこの指の
 * pointerId（ブラウザは指を下ろすたびに新しい番号を付ける）
 */
function tapFinger(s: Setup, id: number) {
  s.win.navigator.userActivation.isActive = false
  fire(s, pointer('pointerdown', 'touch', 1, { id, primary: true }))
  fire(s, touch('touchstart', 1))
  s.win.navigator.userActivation.isActive = true
  fire(s, pointer('pointerup', 'touch', 0, { id, primary: true }))
  fire(s, touch('touchend', 0))
  fire(s, new Event('click'))
}

/** 少しだけ時間を進める（押し終えるのを待っている物は、待たせたまま） */
async function tick(ms = 100) {
  await vi.advanceTimersByTimeAsync(ms)
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  for (const d of disposers.splice(0)) d()
  vi.useRealTimers()
})

describe('履歴の形を作る', () => {
  it('開いた直後（まだ押していない）は作らず、最初に押した時に「戻る」の印・土台・「進む」の印にする（ルーターには何も渡さない）', async () => {
    const s = setup('#/month/2026-11', 'os-back')
    expect(s.win.describe()).toEqual(['*/month/2026-11'])
    expect(s.h.shape()).toMatchObject({ base: null, buildPending: true })
    await arm(s)
    expect(s.win.describe()).toEqual(['[back]', '*/month/2026-11', '[fwd]'])
    expect(s.h.shape()).toMatchObject({ base: 1, cur: 1, shownIdx: 1, buildPending: false, busy: false })
    expect(s.updates).toEqual([])
  })

  it('押していない時のカレンダーの書き込みは今の履歴を置き換え、押した時に作る（指は離した時に「押した」になる）', async () => {
    const s = setup('#/', 'edge-flick')
    s.h.replace(loc('/month/2026-11'))
    expect(s.win.describe()).toEqual(['*/month/2026-11'])
    s.win.navigator.userActivation.isActive = false
    s.win.dispatch('pointerdown', Object.assign(new Event('pointerdown'), { pointerType: 'touch' }))
    await settle(s.h)
    expect(s.win.describe()).toEqual(['*/month/2026-11'])
    s.win.press('touch')
    await settle(s.h)
    expect(s.win.describe()).toEqual(['[back]', '*/month/2026-11', '[fwd]'])
  })

  it('カレンダーの中の行き来（モードの切り替え・期間）は、積む書き込みでも土台を置き換えるだけ（履歴は増えない）', async () => {
    const s = setup('#/month/2026-11', 'os-back')
    await arm(s)
    s.h.push(loc('/week/2026-11-08'))
    s.h.replace(loc('/week/2026-11-15'))
    s.h.push(loc('/day/2026-11-17'))
    await settle(s.h)
    expect(s.win.describe()).toEqual(['[back]', '*/day/2026-11-17', '[fwd]'])
    expect(s.h.action).toBe('PUSH')
  })
})

describe('押している間・ドラッグの途中は、アプリから履歴を動かさない', () => {
  it('最初の押し方がマウスのドラッグでも、押している間・掴んでいる間・落とした後の片付けの間は作らず、ドラッグが終わってから作る', async () => {
    const s = setup('#/week/2026-11-08', 'os-back')
    let dragging = false
    s.h.handlers.dragging = () => dragging
    // マウスは押した時から「押した」になる
    s.win.navigator.userActivation.isActive = true
    fire(s, pointer('pointerdown', 'mouse', 1))
    fire(s, new Event('mousedown'))
    await tick()
    expect(s.win.describe()).toEqual(['*/week/2026-11-08'])
    expect(s.h.shape()).toMatchObject({ base: null, buildPending: true, held: true })
    // 5px を超えて動かして掴んだ
    fire(s, pointer('pointermove', 'mouse', 1))
    dragging = true
    await tick()
    expect(s.win.describe()).toEqual(['*/week/2026-11-08'])
    // 離した（落とした後の片付けの間は、まだドラッグの印がある）
    fire(s, pointer('pointerup', 'mouse'))
    await tick()
    expect(s.win.describe()).toEqual(['*/week/2026-11-08'])
    expect(s.h.shape()).toMatchObject({ base: null, held: true })
    dragging = false
    await settle(s.h)
    expect(s.win.describe()).toEqual(['[back]', '*/week/2026-11-08', '[fwd]'])
    expect(s.h.shape()).toMatchObject({ base: 1, cur: 1, shownIdx: 1, buildPending: false, held: false, busy: false })
    expect(s.updates).toEqual([])
  })

  it('指で長押しして掴み、掴んだまま端で週が替わっても（ルーターの置き換え）、指を離してドラッグが終わるまで作らない（指は離した時に「押した」になる。前の作りは落とす最中に作っていた）', async () => {
    const s = setup('#/week/2026-11-08', 'edge-flick')
    let dragging = false
    s.h.handlers.dragging = () => dragging
    s.win.navigator.userActivation.isActive = false
    fire(s, pointer('pointerdown', 'touch', 1, { primary: true }))
    fire(s, touch('touchstart', 1))
    await tick(450)
    expect(s.win.describe()).toEqual(['*/week/2026-11-08'])
    dragging = true
    s.h.replace(loc('/week/2026-11-15'))
    await tick()
    // 置き換えはその場で書く（履歴は動かさない）
    expect(s.win.describe()).toEqual(['*/week/2026-11-15'])
    // 指を離した（ここでブラウザは「押した」と数える）。落とした後の片付けの間（ドラッグの印がある間）は作らない
    s.win.navigator.userActivation.isActive = true
    fire(s, pointer('pointerup', 'touch'))
    await tick()
    expect(s.win.describe()).toEqual(['*/week/2026-11-15'])
    fire(s, touch('touchend', 0))
    await tick()
    expect(s.win.describe()).toEqual(['*/week/2026-11-15'])
    dragging = false
    await settle(s.h)
    expect(s.win.describe()).toEqual(['[back]', '*/week/2026-11-15', '[fwd]'])
    expect(s.updates).toEqual([])
  })

  it('指の pointer を離しても、touch の指が画面に残っている間（WebKit がスクロールに取った指など）は作らず、touchend で作る', async () => {
    const s = setup('#/month/2026-11', 'edge-flick')
    s.win.navigator.userActivation.isActive = true
    fire(s, touch('touchstart', 1))
    fire(s, pointer('pointerdown', 'touch', 1))
    fire(s, pointer('pointercancel', 'touch'))
    await tick()
    expect(s.win.describe()).toEqual(['*/month/2026-11'])
    fire(s, touch('touchend', 0))
    await settle(s.h)
    expect(s.win.describe()).toEqual(['[back]', '*/month/2026-11', '[fwd]'])
  })

  it('押した要素が描き直しで外れて、touchend が window まで来なくても、押した要素で聞いて作る（掴んで動かしたカード）', async () => {
    const s = setup('#/week/2026-11-08', 'os-back')
    s.win.navigator.userActivation.isActive = true
    const card = new EventTarget()
    const start = Object.defineProperty(touch('touchstart', 1), 'target', { value: card })
    fire(s, start)
    fire(s, pointer('pointerdown', 'touch', 1))
    fire(s, pointer('pointerup', 'touch'))
    await tick()
    expect(s.win.describe()).toEqual(['*/week/2026-11-08'])
    card.dispatchEvent(touch('touchend', 0))
    await settle(s.h)
    expect(s.win.describe()).toEqual(['[back]', '*/week/2026-11-08', '[fwd]'])
  })

  it('押し終えた時にブラウザが「押した直後」と数えていなければ作らず、次に押し終えた時に作る', async () => {
    const s = setup('#/month/2026-11', 'os-back')
    s.win.navigator.userActivation.isActive = false
    fire(s, pointer('pointerdown', 'touch', 1))
    fire(s, pointer('pointercancel', 'touch'))
    await settle(s.h)
    expect(s.win.describe()).toEqual(['*/month/2026-11'])
    s.win.press('touch')
    await settle(s.h)
    expect(s.win.describe()).toEqual(['[back]', '*/month/2026-11', '[fwd]'])
  })

  it('押している間のルーターの戻る（詳細の画面を閉じる）・ほかの画面からカレンダーへ移るのは、押し終えるまで待つ（後の書き込みも順に待つ）', async () => {
    const s = setup('#/month/2026-11', 'os-back')
    await arm(s)
    s.win.navigator.userActivation.isActive = true
    s.h.push(loc('/month/2026-11', detail))
    await settle(s.h)
    fire(s, pointer('pointerdown', 'touch', 1))
    s.h.go(-1)
    await tick(300)
    expect(s.win.index).toBe(2)
    expect(s.updates).toEqual([])
    expect(s.h.shape()).toMatchObject({ busy: true, held: true })
    fire(s, pointer('pointerup', 'touch'))
    await settle(s.h)
    expect(s.win.index).toBe(1)
    expect(s.updates.map((u) => u.delta)).toEqual([-1])
    // 設定の画面から、押している間にカレンダーへ（左のアイコン）
    s.h.push(loc('/settings'))
    await settle(s.h)
    fire(s, pointer('pointerdown', 'mouse', 1))
    s.h.push(loc('/week/2026-11-08'))
    await tick(300)
    expect(s.win.describe()).toEqual(['[back]', '/month/2026-11', '*/settings'])
    fire(s, pointer('pointerup', 'mouse'))
    await settle(s.h)
    expect(s.win.describe()).toEqual(['[back]', '*/week/2026-11-08', '/settings'])
  })

  it('iPhone: 押している間に開いた詳細の画面の後ろの「進む」の印は、押し終えてから置く', async () => {
    const s = setup('#/day/2026-11-10', 'edge-flick')
    await arm(s)
    s.win.navigator.userActivation.isActive = true
    fire(s, pointer('pointerdown', 'touch', 1))
    s.h.push(loc('/day/2026-11-10', detail))
    await tick()
    expect(s.win.describe()).toEqual(['[back]', '/day/2026-11-10', '*/day/2026-11-10+detail'])
    fire(s, pointer('pointerup', 'touch'))
    await settle(s.h)
    expect(s.win.describe()).toEqual(['[back]', '/day/2026-11-10', '*/day/2026-11-10+detail', '[fwd]'])
  })

  it('「戻る」が来た所から出していた所へ戻すのは、ドラッグの途中でも待たない（待つ間に、もう一度の「戻る」でアプリを離れないように）', async () => {
    const s = setup('#/week/2026-11-08', 'os-back')
    await arm(s)
    let dragging = true
    s.h.handlers.dragging = () => dragging
    s.h.handlers.consumePop = () => dragging
    fire(s, pointer('pointerdown', 'mouse', 1))
    s.win.userGo(-1)
    await tick()
    expect(s.win.index).toBe(1)
    expect(s.h.shape()).toMatchObject({ cur: 1, shownIdx: 1, busy: false, held: true })
    expect(s.askExit).not.toHaveBeenCalled()
    fire(s, pointer('pointerup', 'mouse'))
    dragging = false
    await settle(s.h)
    expect(s.win.describe()).toEqual(['[back]', '*/week/2026-11-08', '[fwd]'])
  })

  it('離したのを見落としても、いつまでも待たない（マウスのボタンが離れた pointermove・ウインドウを離れた・しばらく出来事が無い）', async () => {
    const s = setup('#/month/2026-11', 'os-back')
    await arm(s)
    s.win.navigator.userActivation.isActive = true
    const close = async () => {
      s.h.push(loc('/month/2026-11', detail))
      await settle(s.h)
    }
    // ウインドウの外でマウスを離した（pointerup が来ない）: 次に動かした時のボタンで分かる
    await close()
    fire(s, pointer('pointerdown', 'mouse', 1))
    s.h.go(-1)
    await tick(300)
    expect(s.win.index).toBe(2)
    fire(s, pointer('pointermove', 'mouse', 0))
    await tick(300)
    expect(s.win.index).toBe(1)
    // ほかのアプリへ移った
    await close()
    fire(s, pointer('pointerdown', 'touch', 1))
    s.h.go(-1)
    await tick(300)
    expect(s.win.index).toBe(2)
    fire(s, new Event('blur'))
    await tick(300)
    expect(s.win.index).toBe(1)
    // 指を離したのが届かなかった
    await close()
    fire(s, pointer('pointerdown', 'touch', 1))
    s.h.go(-1)
    await tick(PRESS_STALE_MS - 500)
    expect(s.win.index).toBe(2)
    await tick(1000)
    expect(s.win.index).toBe(1)
    expect(s.updates.map((u) => u.delta)).toEqual([-1, -1, -1])
  })

  it('離したのが届かなかった物は、その物の最後の出来事から外す（ほかの物で押し続けても、いつまでも待たない）', async () => {
    const s = setup('#/month/2026-11', 'os-back')
    await arm(s)
    s.win.navigator.userActivation.isActive = true
    s.h.push(loc('/month/2026-11', detail))
    await settle(s.h)
    // ペンを下ろして、離したのが届かなかった
    fire(s, pointer('pointerdown', 'pen', 1, { primary: true }))
    s.h.go(-1)
    // その間もマウスで 4秒ごとに押す
    for (let i = 0; i < 3; i++) {
      await tick(4000)
      fire(s, pointer('pointerdown', 'mouse', 1))
      fire(s, pointer('pointerup', 'mouse'))
    }
    await tick(300)
    expect(s.win.index).toBe(1)
    expect(s.updates.map((u) => u.delta)).toEqual([-1])
  })

  it('iPhone: 端の身振りを端末が取って離す出来事が来なかった指は、次に指を下ろした時に捨てる（詳細の画面の後ろに「進む」の印を置き、［×］はすぐ閉じる）', async () => {
    const s = setup('#/day/2026-11-10', 'edge-flick')
    await arm(s)
    // 左の端からの身振り: 指を下ろした後、端末が身振りに取って、pointerup・touchend は来ない
    fire(s, pointer('pointerdown', 'touch', 1, { id: 5, primary: true }))
    fire(s, touch('touchstart', 1))
    s.win.userGo(-1)
    await tick()
    expect(s.ring).toHaveBeenCalledWith(-1)
    expect(s.win.index).toBe(1)
    // 次に指で軽く押して、詳細の画面を開く（押し終えた後の click で開く）
    tapFinger(s, 6)
    s.h.push(loc('/day/2026-11-10', detail))
    await tick()
    expect(s.win.describe()).toEqual(['[back]', '/day/2026-11-10', '*/day/2026-11-10+detail', '[fwd]'])
    expect(s.h.shape()).toMatchObject({ held: false, busy: false })
    // ［×］を指で押す: すぐ閉じる
    tapFinger(s, 7)
    s.h.go(-1)
    await tick()
    expect(s.win.index).toBe(1)
    expect(s.updates.map((u) => u.delta)).toEqual([-1])
  })

  it('touch の指が残ったまま（touchend が来ない）でも、次の指を離して画面に触れている指が無くなれば捨てる', async () => {
    const s = setup('#/month/2026-11', 'os-back')
    await arm(s)
    s.win.navigator.userActivation.isActive = true
    s.h.push(loc('/month/2026-11', detail))
    await settle(s.h)
    // 番号の無い指（primary でない）が残った
    fire(s, pointer('pointerdown', 'touch', 1, { id: 8 }))
    fire(s, touch('touchstart', 1))
    s.h.go(-1)
    await tick(300)
    expect(s.win.index).toBe(2)
    fire(s, pointer('pointerdown', 'touch', 1, { id: 9 }))
    fire(s, touch('touchstart', 2))
    fire(s, pointer('pointerup', 'touch', 0, { id: 9 }))
    fire(s, touch('touchend', 0))
    await tick()
    expect(s.win.index).toBe(1)
  })

  it('押し終えるのを待っている物があっても、「戻る」が来た所から出していた所へはすぐ戻す（Android: もう一度の「戻る」でアプリを離れない）', async () => {
    const s = setup('#/month/2026-11', 'os-back')
    await arm(s)
    s.win.navigator.userActivation.isActive = true
    s.h.push(loc('/month/2026-11', detail))
    await settle(s.h)
    // 指を画面に置いたまま、詳細の画面を閉じる（ルーターの戻る。押し終えるまで待つ）
    fire(s, pointer('pointerdown', 'touch', 1, { id: 4, primary: true }))
    fire(s, touch('touchstart', 1))
    s.h.go(-1)
    await tick()
    expect(s.win.index).toBe(2)
    // OS の戻る: 詳細の画面を閉じる（ルーターに渡す）
    s.win.userGo(-1)
    await tick()
    expect(s.win.index).toBe(1)
    expect(s.updates.map((u) => u.delta)).toEqual([-1])
    // もう一度: 閉じるかを聞き、すぐ土台へ戻す（「戻る」の印に残らない）
    s.win.userGo(-1)
    await tick()
    expect(s.askExit).toHaveBeenCalledTimes(1)
    expect(s.win.index).toBe(1)
    expect(s.h.shape()).toMatchObject({ cur: 1, shownIdx: 1, held: true })
    // 指を離す: 待っていたルーターの戻るは、もう閉じているので何もしない
    fire(s, pointer('pointerup', 'touch', 0, { id: 4, primary: true }))
    fire(s, touch('touchend', 0))
    await settle(s.h)
    expect(s.win.describe()).toEqual(['[back]', '*/month/2026-11', '/month/2026-11+detail'])
    expect(s.updates.map((u) => u.delta)).toEqual([-1])
  })
})

describe('印の履歴とスクロールの位置', () => {
  it('「戻る」「進む」の印は、来た時にスクロールの位置を戻させない（manual）。土台は戻り終えた後に auto に戻す（設定などから戻った時はブラウザが戻す）', async () => {
    const s = setup('#/day/2026-11-10', 'edge-flick')
    expect(s.win.history.scrollRestoration).toBe('auto')
    await arm(s)
    expect(s.win.describe()).toEqual(['[back]', '*/day/2026-11-10', '[fwd]'])
    expect(s.win.scrollModes()).toBe('mam')
    // iPhone: 詳細の画面の後ろの「進む」の印も
    s.win.navigator.userActivation.isActive = true
    s.h.push(loc('/day/2026-11-10', detail))
    await settle(s.h)
    expect(s.win.describe()).toEqual(['[back]', '/day/2026-11-10', '*/day/2026-11-10+detail', '[fwd]'])
    expect(s.win.scrollModes()).toBe('maam')
  })

  it('印を作った後、自分で土台へ戻るより先に次のルーターの書き込みが来ても、積む画面に manual を写さない', async () => {
    const s = setup('#/day/2026-11-10', 'os-back')
    s.win.press()
    s.h.push(loc('/settings'))
    await settle(s.h)
    expect(s.win.describe()).toEqual(['[back]', '/day/2026-11-10', '*/settings'])
    expect(s.win.scrollModes()).toBe('maa')
  })

  it('土台が manual のまま残っていても（auto に戻す前に「戻る」「進む」が来た）、画面を積む時に土台と積む画面を auto にする', async () => {
    const s = setup('#/day/2026-11-10', 'os-back')
    await arm(s)
    s.win.history.scrollRestoration = 'manual'
    expect(s.win.scrollModes()).toBe('mmm')
    s.win.press()
    s.h.push(loc('/settings'))
    await settle(s.h)
    expect(s.win.describe()).toEqual(['[back]', '/day/2026-11-10', '*/settings'])
    expect(s.win.scrollModes()).toBe('maa')
  })
})

describe('iPhone（端からのフリック）', () => {
  it('カレンダー: 左の端から（戻る）でモードを1つ前へ、右の端から（進む）で1つ次へ回し、土台へ戻す。20回払っても履歴は増えない', async () => {
    const s = setup('#/day/2026-11-10', 'edge-flick')
    await arm(s)
    for (let i = 0; i < 10; i++) {
      s.win.userGo(-1)
      await settle(s.h)
      s.win.userGo(1)
      await settle(s.h)
    }
    expect(s.ring.mock.calls.map((c) => c[0])).toEqual(Array.from({ length: 20 }, (_, i) => (i % 2 === 0 ? -1 : 1)))
    expect(s.win.describe()).toEqual(['[back]', '*/day/2026-11-10', '[fwd]'])
    expect(s.updates).toEqual([])
    expect(s.askExit).not.toHaveBeenCalled()
  })

  it('回した先（ルーターの置き換え）は、印の履歴でなく土台に書く', async () => {
    const s = setup('#/day/2026-11-10', 'edge-flick')
    await arm(s)
    s.h.handlers.ring = () => s.h.replace(loc('/year/2026'))
    s.win.userGo(1)
    await settle(s.h)
    expect(s.win.describe()).toEqual(['[back]', '*/year/2026', '[fwd]'])
  })

  it('すばやく続けた払いは、戻している間に来た物を捨てる（積み上がらず、土台に落ち着く）', async () => {
    const s = setup('#/week/2026-11-08', 'edge-flick')
    await arm(s)
    s.win.userGo(-1)
    s.win.userGo(1)
    s.win.userGo(1)
    await settle(s.h)
    expect(s.win.describe()).toEqual(['[back]', '*/week/2026-11-08', '[fwd]'])
    expect(s.ring.mock.calls.length).toBeLessThanOrEqual(2)
    expect(s.h.shape().busy).toBe(false)
  })

  it('登録の画面: 左右どちらへ払っても閉じる（詳細の画面と同じ。■27）。後ろに「進む」の印を置き、閉じる前に flickDiscard（書きかけの確かめを通さずに捨てる）を呼んでからルーターに渡す', async () => {
    for (const dir of [-1, 1] as const) {
      const s = setup('#/day/2026-11-10', 'edge-flick')
      let seen: number | null = null
      s.h.handlers.flickDiscard = () => {
        seen = s.updates.length
      }
      await arm(s)
      s.win.navigator.userActivation.isActive = true
      s.h.push(loc('/day/2026-11-10', register))
      await settle(s.h)
      expect(s.win.describe(), `${dir}`).toEqual(['[back]', '/day/2026-11-10', '*/day/2026-11-10+register', '[fwd]'])
      s.win.userGo(dir)
      await settle(s.h)
      // 呼んだのは、ルーターに渡す前（RegisterSheet が閉じてよいと控えてから、ルーターの POP が来る）
      expect(seen, `${dir}`).toBe(0)
      expect(
        s.updates.map((u) => [u.location.state, u.delta]),
        `${dir}`,
      ).toEqual([[null, -1]])
      expect(s.win.index, `${dir}`).toBe(1)
      expect(s.ring).not.toHaveBeenCalled()
    }
  })

  it('詳細の画面: 左の端から（戻る）でも右の端から（進む）でも閉じる（土台へ1つ戻ってルーターに渡す。押した直後なら、後ろに残った詳細の画面の履歴は切り捨てて「進む」の印を積み直す）', async () => {
    const s = setup('#/day/2026-11-10', 'edge-flick')
    await arm(s)
    s.win.navigator.userActivation.isActive = true
    s.h.push(loc('/day/2026-11-10', detail))
    await settle(s.h)
    expect(s.win.describe()).toEqual(['[back]', '/day/2026-11-10', '*/day/2026-11-10+detail', '[fwd]'])
    s.win.userGo(1)
    await settle(s.h)
    expect(s.win.describe()).toEqual(['[back]', '*/day/2026-11-10', '[fwd]'])
    expect(s.updates.map((u) => [u.location.pathname, u.location.state, u.delta])).toEqual([['/day/2026-11-10', null, -1]])
    // もう一度開いて、左の端から
    s.h.push(loc('/day/2026-11-10', detail))
    await settle(s.h)
    s.win.userGo(-1)
    await settle(s.h)
    expect(s.updates.length).toBe(2)
    expect(s.updates[1].delta).toBe(-1)
    expect(s.win.index).toBe(1)
    expect(s.ring).not.toHaveBeenCalled()
  })

  it('閉じた詳細の画面が後ろに残っていても、カレンダーで右の端から払うとモードを回す（開き直さない）', async () => {
    const s = setup('#/day/2026-11-10', 'edge-flick')
    await arm(s)
    s.win.navigator.userActivation.isActive = true
    s.h.push(loc('/day/2026-11-10', detail))
    await settle(s.h)
    s.h.go(-1)
    await settle(s.h)
    s.win.userGo(1)
    await settle(s.h)
    expect(s.ring).toHaveBeenCalledWith(1)
    expect(s.win.index).toBe(1)
    expect(s.updates.length).toBe(1)
  })

  it('登録の画面を詳細の画面に置き換えた時（複製のお知らせの［開く］）も後ろに「進む」の印を置き、右の端からでも閉じる', async () => {
    const s = setup('#/day/2026-11-10', 'edge-flick')
    await arm(s)
    s.win.navigator.userActivation.isActive = true
    s.h.push(loc('/day/2026-11-10', register))
    await settle(s.h)
    s.h.replace(loc('/day/2026-11-10', detail))
    await settle(s.h)
    expect(s.win.describe()).toEqual(['[back]', '/day/2026-11-10', '*/day/2026-11-10+detail', '[fwd]'])
    s.win.userGo(1)
    await settle(s.h)
    expect(s.updates.map((u) => [u.location.state, u.delta])).toEqual([[null, -1]])
    expect(s.win.index).toBe(1)
  })

  it('確かめのダイアログ（詳細の画面の削除の確かめなど）が開いている時は、払ってもダイアログを閉じるだけ（詳細の画面は閉じない）', async () => {
    const s = setup('#/day/2026-11-10', 'edge-flick')
    await arm(s)
    s.win.navigator.userActivation.isActive = true
    s.h.push(loc('/day/2026-11-10', detail))
    await settle(s.h)
    let open = true
    s.h.handlers.consumePop = () => {
      if (!open) return false
      open = false
      return true
    }
    s.win.userGo(-1)
    await settle(s.h)
    expect(open).toBe(false)
    expect(s.updates).toEqual([])
    expect(s.win.index).toBe(2)
    // ダイアログが閉じた後は、ふつうに閉じる
    s.win.userGo(-1)
    await settle(s.h)
    expect(s.updates.map((u) => u.delta)).toEqual([-1])
  })

  it('ほかの画面（設定）: どちらへ払っても1つ戻る（カレンダーの方へ）', async () => {
    const s = setup('#/month/2026-11', 'edge-flick')
    await arm(s)
    s.win.navigator.userActivation.isActive = true
    s.h.push(loc('/settings'))
    await settle(s.h)
    s.win.userGo(1)
    await settle(s.h)
    expect(s.updates.map((u) => u.location.pathname)).toEqual(['/month/2026-11'])
    expect(s.win.index).toBe(1)
  })
})

type Mode = 'year' | 'month' | 'week' | 'day'
/** 回す先（右の端から＝進む: 年→月→週→日→年、左の端から＝戻る: その逆） */
const RING_NEXT: Record<Mode, Mode> = { year: 'month', month: 'week', week: 'day', day: 'year' }
const RING_PREV: Record<Mode, Mode> = { year: 'day', month: 'year', week: 'month', day: 'week' }
const PATHS: Record<Mode, string> = {
  year: '/year/2026',
  month: '/month/2026-11',
  week: '/week/2026-11-08',
  day: '/day/2026-11-10',
}
/** モードごとの描く物の数（Chromium の iPhone の幅で、見本のデータの時に数えた物。詳細の画面は +137） */
const WEIGHTS: Record<Mode, number> = { year: 2744, month: 588, week: 760, day: 547 }
const modeOf = (screen: string) => screen.split('+')[0] as Mode

/** 画面の側の動きの差し込み（ルーターが描いた後） */
interface SwipeHooks {
  /** ルーターが小さな画面の無い行き先を描いた後 */
  afterClose?: () => void
}

/**
 * iPhone の身振りの絵をまねる作り物（src/test/fakeHistoryWindow.ts の swipes）と、画面の側の動き: 画面は「モード」か
 * 「モード+上に出ている物」（detail・register・quick）。描き替えは2回描いた後に描かれる（show）。モードを回すと上の物は消え、
 * ルーターが土台へ戻すと小さな画面は消える（隠した小さな画面を出し直すのは、まだ消えていない時だけ）
 */
function setupSwipes(mode: Mode, hooks: SwipeHooks = {}, options: Omit<FakeWindowOptions, 'swipes'> = {}): Setup {
  const win = new FakeWindow(`#${PATHS[mode]}`, { swipes: true, strict: true, ...options })
  win.screen = win.painted = mode
  for (const m of Object.keys(WEIGHTS) as Mode[]) {
    win.weights[m] = WEIGHTS[m]
    win.weights[`${m}+detail`] = WEIGHTS[m] + 137
    win.weights[`${m}+register`] = WEIGHTS[m] + 122
    win.weights[`${m}+quick`] = WEIGHTS[m] + 8
  }
  const h = new AppHistory({ window: win, source: 'edge-flick', armOnLeaveFail: false, screenOf })
  const updates: Update[] = []
  const ring = vi.fn((dir: 1 | -1) => {
    const next = (dir === 1 ? RING_NEXT : RING_PREV)[modeOf(win.screen)]
    win.show(next)
    h.replace(loc(PATHS[next]))
  })
  const askExit = vi.fn()
  h.handlers = {
    ring,
    askExit,
    cleanScreen: () => !win.screen.includes('+'),
    hideSheets: () => {
      const before = win.screen
      win.show(modeOf(before))
      return () => {
        if (sheetOpen) win.show(before)
      }
    },
    renderWeight: () => win.weight() - win.ballastCount,
    ballast: (n) => {
      win.ballastCount = n
    },
  }
  let sheetOpen = false
  h.listen((u) => {
    updates.push(u)
    sheetOpen = Boolean((u.location.state as { sheet?: unknown } | null)?.sheet)
    if (sheetOpen) return
    win.show(modeOf(win.screen))
    hooks.afterClose?.()
  })
  const push = h.push.bind(h)
  h.push = (to, state) => {
    if ((to as Location).state && ((to as Location).state as { sheet?: unknown }).sheet) sheetOpen = true
    push(to, state)
  }
  disposers.push(() => {
    h.dispose()
    // popstate を送っている間に積んだ（WebKit が身振りの絵を3秒外さない）
    if (win.violations.length > 0) throw new Error(win.violations.join('\n'))
  })
  return { win, h, updates, ring, askExit }
}

/** 小さな画面を開く（押した後。ルーターが積んでから描く） */
async function openSheet(s: Setup, kind: 'detail' | 'register') {
  s.win.navigator.userActivation.isActive = true
  const path = PATHS[modeOf(s.win.screen)]
  s.h.push(loc(path, kind === 'detail' ? detail : register))
  s.win.show(`${modeOf(s.win.screen)}+${kind}`)
  await settle(s.h)
}

/** 身振りの絵が消えるまで進める（長くて3秒） */
async function untilOverlayGone(s: Setup) {
  for (let k = 0; k < 700 && s.win.overlay; k++) await vi.advanceTimersByTimeAsync(5)
}

/** from 番目から後に、アプリが呼んだ履歴 */
const callsFrom = (s: Setup, from: number): HistoryCall[] => s.win.calls.slice(from)

/** 呼んだ履歴の短い名前（go は差、同じ物の置き換えは (same)） */
const callName = (c: HistoryCall): string => (c.op === 'go' ? `go(${c.delta})` : `${c.op}${c.same ? '(same)' : ''}`)

describe('iPhone の身振りの絵（端からのフリックの間に見える絵。WebKit のまね）', () => {
  // ---------- 払った後に固まる（S2）・白（S3）・閉じた画面の絵（S0） ----------

  it('詳細を左の端から払って閉じた時、払いの popstate で最初にするのは今の履歴を同じ物で置き換えること（WebKit が絵を3秒外さず固まって見えたのを直す）。popstate の中では積まない', async () => {
    const s = setupSwipes('week')
    await arm(s)
    await openSheet(s, 'detail')
    const from = s.win.calls.length
    s.win.userGo(-1)
    await settle(s.h)
    const during = callsFrom(s, from).filter((c) => c.inPop)
    expect(during[0]).toMatchObject({ op: 'replaceState', same: true })
    expect(s.win.violations).toEqual([])
    expect(s.win.overlayEnds[0]).toBeLessThan(1000)
    expect(s.updates.map((u) => [u.location.state, u.delta])).toEqual([[null, -1]])
  })

  it.each([
    ['左', -1],
    ['右', 1],
  ] as const)(
    '詳細を%sの端から払って閉じた後: 押した直後なら閉じた画面の履歴は動きの間に切り捨て（popstate の後の処理で積む）、動きが終わった後に1度だけ後ろの「進む」の印へ行って戻り、その絵を今のカレンダーにする。次に右の端から払うと今のカレンダーの絵',
    async (_side, dir) => {
      const s = setupSwipes('week')
      await arm(s)
      const length = s.win.entries.length
      await openSheet(s, 'detail')
      s.win.userGo(dir)
      await settle(s.h)
      expect(s.win.violations).toEqual([])
      expect(s.win.describe()).toEqual(['[back]', '*/week/2026-11-08', '[fwd]'])
      expect(s.h.shape()).toMatchObject({ base: 1, cur: 1, top: 2, forwardDirty: false, recording: false })
      expect(s.win.pictures()[2]).toBe('week')
      expect(s.win.entries.length).toBe(length)
      s.win.userGo(1)
      await settle(s.h)
      expect(s.win.slid.at(-1)).toBe('week')
      expect(s.ring).toHaveBeenCalledWith(1)
      expect(s.win.hazards).toEqual([])
    },
  )

  it('押してから時間がたって（6秒）から右の端から詳細を閉じた時は、積まず（ブラウザが行き先から外すので）、動きが終わった後に閉じた画面の履歴を「進む」の印に替えて今のカレンダーの絵にする', async () => {
    const s = setupSwipes('week')
    await arm(s)
    await openSheet(s, 'detail')
    s.win.navigator.userActivation.isActive = false
    await vi.advanceTimersByTimeAsync(6000)
    const from = s.win.calls.length
    s.win.userGo(1)
    await settle(s.h)
    expect(callsFrom(s, from).filter((c) => c.op === 'pushState')).toEqual([])
    expect(s.win.describe()).toEqual(['[back]', '*/week/2026-11-08', '[fwd]', '[fwd]'])
    expect(s.win.pictures()[2]).toBe('week')
    s.win.userGo(1)
    await settle(s.h)
    expect(s.win.slid.at(-1)).toBe('week')
    expect(s.win.screen).toBe('day')
  })

  // ---------- モードを回す払い（S1） ----------

  it('モードを回す払いは、払いの popstate で置き換え・土台へ戻る go・回した先の置き換えだけ。動きが終わった後も履歴を動かさない（20回）', async () => {
    const s = setupSwipes('day')
    await arm(s)
    const shape = s.win.describe()
    for (let i = 0; i < 20; i++) {
      const dir = i % 2 === 0 ? -1 : 1
      const from = s.win.calls.length
      s.win.userGo(dir)
      await settle(s.h)
      expect(callsFrom(s, from).map(callName), `${i}`).toEqual(['replaceState(same)', `go(${-dir})`, 'replaceState'])
    }
    expect(s.win.describe()).toEqual(shape)
    expect(s.win.hazards).toEqual([])
    expect(s.win.refused).toBe(0)
  })

  it.each([1, -1] as const)(
    'モードを回した後、すぐ次を払う（%i。0〜0.9秒後に 25ms ごと）: 行き先が消える・今いる所になることは無く、始まった払いはどれも1度だけ回し、始まらなかった払いは履歴を変えない',
    async (dir) => {
      for (let t = 0; t <= 900; t += 25) {
        const s = setupSwipes('week')
        await arm(s)
        s.win.userGo(1)
        await vi.advanceTimersByTimeAsync(0)
        await vi.advanceTimersByTimeAsync(t)
        const result = s.win.userGo(dir)
        await settle(s.h)
        expect(s.win.hazards, `${t}ms`).toEqual([])
        expect(s.ring.mock.calls.length, `${t}ms`).toBe(result === 'started' ? 2 : 1)
        expect(s.win.entries.length, `${t}ms`).toBe(3)
        expect(s.h.shape(), `${t}ms`).toMatchObject({ cur: 1, base: 1, shownIdx: 1, busy: false, recording: false })
        s.h.dispose()
      }
    },
  )

  // ---------- 身振りの始まりの blur・押している間 ----------

  it('身振りの始まりにページが window の blur を受けても、指は離したとみなさない（指を下ろしている間は履歴を動かさない）', async () => {
    const s = setupSwipes('week', {}, { focused: true, edgeTouch: true })
    await arm(s)
    await openSheet(s, 'detail')
    s.win.userGo(-1)
    await vi.advanceTimersByTimeAsync(0)
    await untilOverlayGone(s)
    expect(s.h.shape().forwardDirty).toBe(true)
    // 次の身振り（右の端から）: 指を下ろし、身振りが始まると blur が来る。0.25秒で離す
    const from = s.win.calls.length
    expect(s.win.userGo(1, { fingerMs: 250 })).toBe('started')
    const held: boolean[] = []
    for (let k = 0; k < 24; k++) {
      await vi.advanceTimersByTimeAsync(10)
      held.push(s.h.shape().held)
    }
    expect(held.every(Boolean)).toBe(true)
    expect(callsFrom(s, from)).toEqual([])
    await settle(s.h)
    expect(s.ring).toHaveBeenCalledWith(1)
    expect(s.win.hazards).toEqual([])
    expect(s.h.shape()).toMatchObject({ cur: 1, shownIdx: 1, forwardDirty: false, held: false })
  })

  it('ウインドウを離れた時、iPhone では指は残し（身振りの始まりの blur）、マウスなどは離したとみなす。ページが隠れた時はどれも離したとみなす', async () => {
    const s = setupSwipes('week')
    await arm(s)
    fire(s, pointer('pointerdown', 'touch', 1, { id: 5, primary: true }))
    fire(s, touch('touchstart', 1))
    fire(s, pointer('pointerdown', 'mouse', 1))
    s.win.dispatch('blur', new Event('blur'))
    expect(s.h.shape().held).toBe(true)
    fire(s, pointer('pointerup', 'touch', 0, { id: 5, primary: true }))
    fire(s, touch('touchend', 0))
    expect(s.h.shape().held).toBe(false)
    fire(s, pointer('pointerdown', 'touch', 1, { id: 6, primary: true }))
    fire(s, touch('touchstart', 1))
    s.win.document.visibilityState = 'hidden'
    s.win.dispatch('visibilitychange', new Event('visibilitychange'))
    expect(s.h.shape().held).toBe(false)
  })

  it('動きが終わった時に指が下りていれば「進む」の印へは行かず、離した時（押し終えた時）に行って戻る', async () => {
    const s = setupSwipes('week')
    await arm(s)
    await openSheet(s, 'detail')
    s.win.userGo(-1)
    await vi.advanceTimersByTimeAsync(200)
    expect(s.win.describe()).toEqual(['[back]', '*/week/2026-11-08', '[fwd]'])
    expect(s.win.pictures()[2]).toBe('-')
    fire(s, pointer('pointerdown', 'touch', 1, { id: 7, primary: true }))
    fire(s, touch('touchstart', 1))
    const from = s.win.calls.length
    await vi.advanceTimersByTimeAsync(2000)
    expect(callsFrom(s, from)).toEqual([])
    expect(s.h.shape()).toMatchObject({ held: true, forwardDirty: true, recording: false })
    const lift = s.win.calls.length
    fire(s, pointer('pointerup', 'touch', 0, { id: 7, primary: true }))
    fire(s, touch('touchend', 0))
    await settle(s.h)
    expect(callsFrom(s, lift).map(callName)).toEqual(['go(1)', 'go(-1)'])
    expect(s.win.pictures()[2]).toBe('week')
    expect(s.h.shape()).toMatchObject({ forwardDirty: false, recording: false })
  })

  /** 払って閉じ、動きの後に「進む」の印へ着いた時（戻る前）に指を下ろす */
  async function parkOnForward(s: Setup): Promise<void> {
    await arm(s)
    await openSheet(s, 'detail')
    s.win.userGo(-1)
    await vi.advanceTimersByTimeAsync(0)
    let downed = false
    s.win.addEventListener('popstate', () => {
      const last = s.win.calls.at(-1)
      if (downed || s.win.index !== 2 || last?.op !== 'go' || last.delta !== 1) return
      downed = true
      fire(s, pointer('pointerdown', 'touch', 1, { id: 8, primary: true }))
      fire(s, touch('touchstart', 1))
    })
    await vi.advanceTimersByTimeAsync(2000)
    expect(downed).toBe(true)
  }

  it('「進む」の印へ着いた後（戻る前）に指が下りたら、そこで待つ（指を下ろしている間は動かない）。その指で左の端から払うと土台へ着き、モードを回す（履歴は動かさない）', async () => {
    const s = setupSwipes('week')
    await parkOnForward(s)
    const from = s.win.calls.length
    await vi.advanceTimersByTimeAsync(1000)
    expect(callsFrom(s, from)).toEqual([])
    expect(s.win.index).toBe(2)
    expect(s.h.shape()).toMatchObject({ cur: 2, shownIdx: 1, held: true, recording: true })
    expect(s.win.userGo(-1)).toBe('started')
    await settle(s.h)
    expect(s.ring).toHaveBeenCalledWith(-1)
    expect(callsFrom(s, from).filter((c) => c.op === 'go')).toEqual([])
    expect(s.win.index).toBe(1)
    expect(s.win.describe()).toEqual(['[back]', '*/month/2026-11', '[fwd]'])
    expect(s.h.shape()).toMatchObject({ cur: 1, shownIdx: 1, held: false, recording: false, forwardDirty: false })
    expect(s.win.pictures()[2]).toBe('week')
    expect(s.win.hazards).toEqual([])
  })

  it('「進む」の印で待っている時に、払わずに離した（押した）時は、土台へ戻る', async () => {
    const s = setupSwipes('week')
    await parkOnForward(s)
    fire(s, pointer('pointerup', 'touch', 0, { id: 8, primary: true }))
    fire(s, touch('touchend', 0))
    await settle(s.h)
    expect(s.win.index).toBe(1)
    expect(s.ring).not.toHaveBeenCalled()
    expect(s.win.describe()).toEqual(['[back]', '*/week/2026-11-08', '[fwd]'])
    expect(s.win.pictures()[2]).toBe('week')
    expect(s.h.shape()).toMatchObject({ cur: 1, shownIdx: 1, recording: false, forwardDirty: false })
  })

  it.each([
    ['go(+1) を送ってから着くまでに、左の端からの身振りが始まった', 1, -1, []],
    ['go(+1) を送ってから着くまでに、右の端からの身振りが始まった（行き先は今いる所になる: 残る窓）', 1, 1, ['reload']],
    ['go(+1) が着いた後に、左の端からの身振りが始まった', 0, -1, []],
    ['go(-1) を送ってから着くまでに、左の端からの身振りが始まった（行き先は今いる所になる: 残る窓）', -1, -1, ['reload']],
    ['go(-1) を送ってから着くまでに、右の端からの身振りを始めようとした（後ろに履歴が無く始まらない）', -1, 1, []],
  ] as const)(
    '「進む」の印の絵を写すのに自分で行き来する間に身振りが始まった（行き先は始まった時に決まる）: %s',
    async (_name, at, dir, hazards) => {
      const s = setupSwipes('week', {}, { edgeTouch: true })
      await arm(s)
      await openSheet(s, 'detail')
      s.win.userGo(-1)
      await vi.advanceTimersByTimeAsync(0)
      const go = s.win.history.go
      let started = false
      // recordForward の go(+1) と、その後の go(-1)（閉じた時に積み直して戻る go(-1) は数えない）
      let forward = false
      vi.spyOn(s.win.history, 'go').mockImplementation((delta: number) => {
        go(delta)
        if (delta === 1) forward = true
        if (!started && forward && at !== 0 && delta === at) {
          started = true
          expect(s.win.userGo(dir, { fingerMs: 150 })).toBe(dir === 1 && at === -1 ? 'none' : 'started')
        }
      })
      if (at === 0) {
        s.win.addEventListener('popstate', () => {
          if (started || s.win.index !== 2) return
          started = true
          s.win.userGo(dir, { fingerMs: 150 })
        })
      }
      await vi.advanceTimersByTimeAsync(2000)
      await settle(s.h)
      expect(started).toBe(true)
      expect(s.win.hazards).toEqual(hazards)
      if (hazards.length > 0) return
      // 始まった身振りは、左の端からならモードを回した。どれも土台に落ち着く
      expect(s.ring.mock.calls.map((c) => c[0])).toEqual(dir === -1 ? [-1] : [])
      expect(s.h.shape()).toMatchObject({ cur: 1, shownIdx: 1, busy: false, recording: false })
      expect(s.win.index).toBe(1)
    },
  )

  // ---------- 印の絵を作る時（開いて最初に押し終えた時） ----------

  it('開いて最初に押し終えた時にカレンダーの上に物が出ていれば作らず（積まない）、カレンダーだけが描かれた後に押し終えた時に作る（印の絵はどれもカレンダー）', async () => {
    const s = setupSwipes('week')
    s.win.show('week+quick')
    await settle(s.h)
    s.win.press()
    await settle(s.h)
    expect(s.win.calls.filter((c) => c.op === 'pushState')).toEqual([])
    expect(s.h.shape()).toMatchObject({ base: null, buildPending: true })
    s.win.show('week')
    await settle(s.h)
    s.win.press()
    await settle(s.h)
    expect(s.win.describe()).toEqual(['[back]', '*/week/2026-11-08', '[fwd]'])
    expect(s.win.pictures()).toEqual(['week', 'week', 'week'])
  })

  // ---------- 印の絵は写し直さない ----------

  it('印の絵は作った時のカレンダーのまま（モードを回した後に写し直さない）。閉じた詳細の画面の絵は出ず、履歴は増えない', async () => {
    const s = setupSwipes('week')
    await arm(s)
    const length = s.win.entries.length
    await openSheet(s, 'detail')
    s.win.userGo(1)
    await settle(s.h)
    expect(s.win.screen).toBe('week')
    for (let i = 0; i < 4; i++) {
      s.win.userGo(1)
      await settle(s.h)
    }
    expect(s.win.slid).toEqual(['week', 'week', 'week', 'week', 'week'])
    expect(s.win.screen).toBe('week')
    expect(s.win.entries.length).toBe(length)
    expect(s.win.describe()).toEqual(['[back]', '*/week/2026-11-08', '[fwd]'])
    s.win.userGo(-1)
    await settle(s.h)
    expect(s.win.slid.at(-1)).toBe('week')
  })

  it('登録の画面を［×］で閉じた後、すばやく足すを開いたまま払っても、出る絵に登録の画面・すばやく足すは無い（閉じる前に隠して描かせてから戻る）', async () => {
    const hooks: SwipeHooks = {}
    const s = setupSwipes('week', hooks)
    await arm(s)
    await openSheet(s, 'register')
    expect(s.win.painted).toBe('week+register')
    // ［×］（ルーターの戻る）。戻ってすぐ、すばやく足すを開いた
    hooks.afterClose = () => s.win.show('week+quick')
    s.h.go(-1)
    await vi.advanceTimersByTimeAsync(20)
    // 戻る前に隠した（まだ履歴は動かしていない）
    expect(s.win.screen).toBe('week')
    expect(s.win.index).toBe(2)
    await settle(s.h)
    hooks.afterClose = undefined
    expect(s.win.screen).toBe('week+quick')
    expect(s.win.describe()).toEqual(['[back]', '*/week/2026-11-08', '/week/2026-11-08+register', '[fwd]'])
    // 右の端から: すばやく足すは閉じてモードが回る。出た絵は閉じた登録の画面の履歴の絵だが、隠した後のカレンダー
    s.win.userGo(1)
    await settle(s.h)
    s.win.userGo(1)
    await settle(s.h)
    expect(s.win.slid).toEqual(['week', 'week'])
    expect(s.ring.mock.calls.map((c) => c[0])).toEqual([1, 1])
    expect(s.win.screen).toBe('year')
    expect(s.h.shape()).toMatchObject({ cur: 1, shownIdx: 1, forwardDirty: false })
  })

  it('すばやく足すを開いたまま払ってモードを回した後も、次に払った時の絵はすばやく足すの無いカレンダー', async () => {
    const s = setupSwipes('week')
    await arm(s)
    s.win.show('week+quick')
    await settle(s.h)
    s.win.userGo(1)
    await settle(s.h)
    s.win.userGo(1)
    await settle(s.h)
    expect(s.win.slid).toEqual(['week', 'week'])
  })

  it('設定をルーターの戻るで閉じた時（隠さない画面）は、閉じた後に閉じた画面の履歴を「進む」の印に替えて、今のカレンダーの絵にする', async () => {
    const hooks: SwipeHooks = {}
    const s = setupSwipes('month', hooks)
    await arm(s)
    s.win.navigator.userActivation.isActive = true
    s.h.push(loc('/settings'))
    s.win.show('settings')
    await settle(s.h)
    hooks.afterClose = () => s.win.show('month')
    s.h.go(-1)
    await settle(s.h)
    expect(s.win.describe()).toEqual(['[back]', '*/month/2026-11', '[fwd]', '[fwd]'])
    expect(s.win.pictures()[2]).toBe('month')
    s.win.userGo(1)
    await settle(s.h)
    expect(s.win.slid.at(-1)).toBe('month')
    expect(s.win.screen).toBe('week')
  })

  it('モードを回した先の描く物が行き先の絵の半分に届かない時（イヤーから月へ）は、見えない描く物を足してすぐ絵を外させ、後で外す', async () => {
    const s = setupSwipes('year')
    await arm(s)
    const placed: number[] = []
    const ballast = s.h.handlers.ballast
    s.h.handlers.ballast = (n) => {
      placed.push(n)
      ballast?.(n)
    }
    s.win.userGo(1)
    await settle(s.h)
    expect(s.win.screen).toBe('month')
    // イヤーの絵の描く物の半分を超えた（3秒待たずに外れた）
    expect(s.win.overlayEnds[0]).toBeLessThan(1000)
    expect(placed).toEqual([expect.any(Number), 0])
    expect(WEIGHTS.month + placed[0]).toBeGreaterThan(WEIGHTS.year / 2)
    expect(s.win.ballastCount).toBe(0)
    // 月から週: 「進む」の印の絵は作った時（イヤー）のまま（写し直さない）なので、週でも半分に届かず、足す
    placed.length = 0
    s.win.userGo(1)
    await settle(s.h)
    expect(placed).toEqual([expect.any(Number), 0])
    expect(WEIGHTS.week + placed[0]).toBeGreaterThan(WEIGHTS.year / 2)
    expect(s.win.overlayEnds[1]).toBeLessThan(1000)
    // 日からイヤーへ戻って、イヤーから日へ（左の端から）
    s.h.handlers.ballast = (n) => {
      s.win.ballastCount = n
    }
    s.win.userGo(1)
    await settle(s.h)
    s.win.userGo(1)
    await settle(s.h)
    s.win.userGo(-1)
    await settle(s.h)
    expect(s.win.screen).toBe('day')
    expect(s.win.overlayEnds.every((ms) => ms < 1000)).toBe(true)
  })

  it('行き先の絵の描く物の半分に届いていれば（日の印から週へ）、見えない描く物は足さない', async () => {
    const s = setupSwipes('day')
    await arm(s)
    const counts: number[] = []
    s.h.handlers.ballast = (n) => counts.push(n)
    s.win.userGo(-1)
    await settle(s.h)
    expect(s.win.screen).toBe('week')
    expect(counts).toEqual([])
    expect(s.win.overlayEnds[0]).toBeLessThan(1000)
  })

  it('身振りの絵を出している間にアプリの中で回して描く物が減った時（topUpBallast。続けて払った分）は、見えない描く物を足し直す', async () => {
    const s = setupSwipes('year')
    await arm(s)
    const placed: number[] = []
    const ballast = s.h.handlers.ballast
    s.h.handlers.ballast = (n) => {
      placed.push(n)
      ballast?.(n)
    }
    s.win.userGo(1)
    await vi.advanceTimersByTimeAsync(0)
    expect(placed).toHaveLength(1)
    // 月から日へ（アプリの中で回した）
    s.win.show('day')
    s.h.topUpBallast()
    await vi.advanceTimersByTimeAsync(0)
    expect(placed).toHaveLength(2)
    expect(placed[1]).toBeGreaterThan(placed[0])
    expect(WEIGHTS.day + placed[1]).toBeGreaterThanOrEqual(Math.ceil(WEIGHTS.year * 0.8))
    // 減っていなければ足さない
    s.h.topUpBallast()
    await vi.advanceTimersByTimeAsync(0)
    expect(placed).toHaveLength(2)
    await settle(s.h)
    expect(placed.at(-1)).toBe(0)
    // 絵を出していない時は何もしない
    s.h.topUpBallast()
    await vi.advanceTimersByTimeAsync(0)
    expect(placed.at(-1)).toBe(0)
    // 回さなかった払い（詳細の画面を閉じた）の絵の間は足さない
    await openSheet(s, 'detail')
    s.win.userGo(-1)
    await vi.advanceTimersByTimeAsync(0)
    s.h.topUpBallast()
    await vi.advanceTimersByTimeAsync(0)
    expect(placed.at(-1)).toBe(0)
  })

  it('ほかの端末（Android・PC）は、「戻る」「進む」が来ても今の履歴を置き換えず、閉じた後に自分で行き来しない。ウインドウを離れたら押している物は無い', async () => {
    const win = new FakeWindow('#/month/2026-11', { swipes: true })
    const s = setup('#/month/2026-11', 'os-back', { win })
    const cleanScreen = vi.fn(() => true)
    s.h.handlers.cleanScreen = cleanScreen
    await arm(s)
    s.win.navigator.userActivation.isActive = true
    s.h.push(loc('/month/2026-11', detail))
    await settle(s.h)
    const from = s.win.calls.length
    s.win.userGo(-1)
    await settle(s.h)
    await vi.advanceTimersByTimeAsync(5000)
    expect(callsFrom(s, from)).toEqual([])
    expect(s.updates.map((u) => u.delta)).toEqual([-1])
    s.win.userGo(-1)
    await settle(s.h)
    expect(s.askExit).toHaveBeenCalledTimes(1)
    expect(callsFrom(s, from).map(callName)).toEqual(['go(1)'])
    expect(cleanScreen).not.toHaveBeenCalled()
    fire(s, pointer('pointerdown', 'touch', 1, { id: 4, primary: true }))
    fire(s, touch('touchstart', 1))
    expect(s.h.shape().held).toBe(true)
    s.win.dispatch('blur', new Event('blur'))
    expect(s.h.shape().held).toBe(false)
  })

  // ---------- 検査の直し（2回目） ----------

  it('［×］で登録の画面を隠して描かせている間に左の端から払うと、払いで閉じる（書きかけは聞かずに捨てる）。閉じ終えた時にブラウザの今いる所と出している所が合う', async () => {
    const s = setupSwipes('week')
    const discard = vi.fn()
    s.h.handlers.flickDiscard = discard
    await arm(s)
    const length = s.win.entries.length
    await openSheet(s, 'register')
    s.h.go(-1)
    await vi.advanceTimersByTimeAsync(10)
    s.win.userGo(-1)
    await settle(s.h)
    await vi.advanceTimersByTimeAsync(5000)
    await settle(s.h)
    expect(discard).toHaveBeenCalledTimes(1)
    expect(s.h.shape()).toMatchObject({ cur: 1, base: 1, shownIdx: 1, busy: false, recording: false })
    expect(s.win.index).toBe(1)
    expect(s.win.screen).toBe('week')
    expect(s.updates.map((u) => [u.location.state, u.delta])).toEqual([[null, -1]])
    expect(s.win.entries.length).toBe(length)
    // 右の端から払うと、ふつうにモードを回す
    s.win.userGo(1)
    await settle(s.h)
    expect(s.win.screen).toBe('day')
    expect(s.h.shape()).toMatchObject({ cur: 1, shownIdx: 1 })
  })

  it('［×］で隠して描かせている間に指を下ろしたら、離すまで履歴を動かさない（離したら、描かせ直してから閉じる）', async () => {
    const s = setupSwipes('week')
    await arm(s)
    await openSheet(s, 'detail')
    const held: boolean[] = []
    vi.spyOn(s.win.history, 'go').mockImplementation((d: number) => {
      held.push(s.h.shape().held)
      s.win.move(d)
    })
    s.h.go(-1)
    await vi.advanceTimersByTimeAsync(10)
    fire(s, pointer('pointerdown', 'touch', 1, { id: 9, primary: true }))
    fire(s, touch('touchstart', 1))
    await vi.advanceTimersByTimeAsync(500)
    expect(held).toEqual([])
    expect(s.win.index).toBe(2)
    expect(s.updates).toEqual([])
    fire(s, pointer('pointerup', 'touch', 0, { id: 9, primary: true }))
    fire(s, touch('touchend', 0))
    await settle(s.h)
    expect(held.length).toBeGreaterThan(0)
    expect(held.filter(Boolean)).toEqual([])
    expect(s.updates.map((u) => u.delta)).toEqual([-1])
    expect(s.win.index).toBe(1)
  })

  it('閉じた直後（「進む」の印の絵を写す前）に右の端から払うと、印に絵が無く地の色が動く（iPhone の限界）。閉じた詳細の画面は出ない', async () => {
    const s = setupSwipes('day')
    await arm(s)
    await openSheet(s, 'detail')
    s.win.userGo(-1)
    await vi.advanceTimersByTimeAsync(0)
    await untilOverlayGone(s)
    expect(s.h.shape().forwardDirty).toBe(true)
    s.win.userGo(1)
    await settle(s.h)
    expect(s.win.slid).toEqual(['day', 'none'])
    expect(s.win.describe()).toEqual(['[back]', '*/year/2026', '[fwd]'])
    // その払いの動きの後に、印の絵を写した（今のモード）
    expect(s.h.shape().forwardDirty).toBe(false)
    s.win.userGo(1)
    await settle(s.h)
    expect(s.win.slid.at(-1)).toBe('year')
  })

  it.each([
    [1, '/settings'],
    [2, '/settings'],
    [1, '/year/2026'],
    [2, '/year/2026'],
  ])(
    '「進む」の印の絵を写すのに自分で動いている間（%i つ目の動きの直後）に # を書き換えた（%s。アドレス欄・ページの location.hash など、アプリが作っていない履歴が来た）時は、待っていた動きでなく利用者の行き先として描き（# と画面が合う）、そこから動かない',
    async (at, path) => {
      const s = setupSwipes('month')
      await arm(s)
      await openSheet(s, 'detail')
      s.win.userGo(-1)
      await vi.advanceTimersByTimeAsync(50)
      const go = vi.spyOn(s.win.history, 'go')
      let n = 0
      go.mockImplementation((d: number) => {
        n++
        s.win.move(d)
        if (n === at) s.win.typeHash(`#${path}`)
      })
      await vi.advanceTimersByTimeAsync(6000)
      await settle(s.h)
      go.mockRestore()
      expect(n).toBe(at)
      expect(s.win.hashPath()).toBe(path)
      expect(s.updates.map((u) => u.location.pathname)).toEqual(['/month/2026-11', path])
      const shape = s.h.shape()
      expect(shape.cur).toBe(shape.shownIdx)
      expect(s.win.index).toBe(shape.cur)
      expect(s.win.describe()[s.win.index]).toBe(`*${path}`)
      expect(shape.recording).toBe(false)
      if (path !== '/settings') expect(shape.base).toBe(shape.cur)
    },
  )

  it.each([1, 2])(
    '「進む」の印の絵を写すのに自分で動いている間（%i つ目の動きの直後）に # を書き換え、ブラウザが待っていた動きを書き換えた所から後で行った時も、# と出している画面は合う',
    async (at) => {
      const s = setupSwipes('month')
      await arm(s)
      await openSheet(s, 'detail')
      s.win.userGo(-1)
      await vi.advanceTimersByTimeAsync(50)
      const go = vi.spyOn(s.win.history, 'go')
      let n = 0
      go.mockImplementation((d: number) => {
        n++
        if (n === at) s.win.typeHash('#/settings')
        s.win.move(d)
      })
      await vi.advanceTimersByTimeAsync(6000)
      await settle(s.h)
      go.mockRestore()
      expect(s.updates[1]?.location.pathname).toBe('/settings')
      expect(s.updates.at(-1)?.location.pathname).toBe(s.win.hashPath())
      const shape = s.h.shape()
      expect(shape.cur).toBe(shape.shownIdx)
      expect(s.win.index).toBe(shape.cur)
      expect(s.win.describe().filter((e) => e.endsWith('/settings'))).toHaveLength(1)
    },
  )
})

describe('端からのフリックの記録（src/history/swipeLog.ts。設定で記録を取る時だけ）', () => {
  afterEach(() => {
    setSwipeLogEnabled(false)
    localStorage.clear()
  })

  it('払って閉じた時の popstate・置き換え・切り捨て・動きの後・「進む」の印へ行って戻るを、順に控える', async () => {
    setSwipeLogEnabled(true)
    clearSwipeLog()
    const s = setupSwipes('week')
    await arm(s)
    await openSheet(s, 'detail')
    clearSwipeLog()
    s.win.userGo(-1)
    await settle(s.h)
    const kinds = swipeLogText()
      .split('\n')
      .map((line) => line.split(' ')[1])
    expect(kinds.slice(0, 2)).toEqual(['guard', 'pop'])
    for (const kind of ['drop-closed', 'raf1', 'settle', 'go', 'recorded']) expect(kinds, kind).toContain(kind)
    expect(kinds.indexOf('drop-closed')).toBeLessThan(kinds.indexOf('settle'))
    expect(swipeLogText()).toMatch(/ pop \{"idx":1,"from":2,"ua":true,"expect":null\}/)
  })

  it('記録を取っていない時は控えない', async () => {
    clearSwipeLog()
    const s = setupSwipes('week')
    await arm(s)
    s.win.userGo(1)
    await settle(s.h)
    expect(swipeLogText()).toBe('')
  })
})

describe('利用者の「戻る」「進む」が来たか（userPopSince。src/ui/useSwipe.ts が使う）', () => {
  it('その時刻より後に利用者の「戻る」「進む」（端からのフリック）が来たら true。アプリが自分で動いた分は数えない', async () => {
    const win = new FakeWindow('#/week/2026-11-08', { swipes: true })
    const h = createAppHistory({ window: win, source: 'edge-flick', armOnLeaveFail: false, screenOf, now: () => Date.now() })
    disposers.push(() => h.dispose())
    h.listen(() => {})
    win.press()
    await settle(h)
    const t0 = Date.now()
    expect(userPopSince(t0)).toBe(false)
    win.userGo(1)
    await vi.advanceTimersByTimeAsync(0)
    expect(userPopSince(t0)).toBe(true)
    await settle(h)
    await vi.advanceTimersByTimeAsync(10)
    const t1 = Date.now()
    // アプリが自分で動いた（詳細の画面の後ろに「進む」の印を置いて戻る）
    win.navigator.userActivation.isActive = true
    h.push(loc('/week/2026-11-08', detail))
    await settle(h)
    expect(win.calls.some((c) => c.op === 'go' && c.at >= t1)).toBe(true)
    expect(userPopSince(t1)).toBe(false)
  })
})

describe('Android・PC（OS の戻る）', () => {
  it('カレンダー: 「戻る」で閉じるかを聞き（もう一度でもまた聞く）、「進む」は何もしない。どちらも土台へ戻す', async () => {
    const s = setup('#/month/2026-11', 'os-back')
    await arm(s)
    s.win.userGo(-1)
    await settle(s.h)
    expect(s.askExit).toHaveBeenCalledTimes(1)
    expect(s.win.index).toBe(1)
    s.win.userGo(-1)
    await settle(s.h)
    expect(s.askExit).toHaveBeenCalledTimes(2)
    s.win.userGo(1)
    await settle(s.h)
    expect(s.askExit).toHaveBeenCalledTimes(2)
    expect(s.win.describe()).toEqual(['[back]', '*/month/2026-11', '[fwd]'])
    expect(s.updates).toEqual([])
    expect(s.ring).not.toHaveBeenCalled()
  })

  it('詳細の画面: 「戻る」で閉じ（ルーターに渡す）、次の「戻る」は閉じるかを聞く。後ろに「進む」の印は置かない', async () => {
    const s = setup('#/month/2026-11', 'os-back')
    await arm(s)
    s.win.navigator.userActivation.isActive = true
    s.h.push(loc('/month/2026-11', detail))
    await settle(s.h)
    expect(s.win.describe()).toEqual(['[back]', '/month/2026-11', '*/month/2026-11+detail'])
    s.win.userGo(-1)
    await settle(s.h)
    expect(s.updates.map((u) => [u.location.state, u.delta])).toEqual([[null, -1]])
    s.win.userGo(-1)
    await settle(s.h)
    expect(s.askExit).toHaveBeenCalledTimes(1)
    expect(s.win.index).toBe(1)
  })

  it('登録の画面: 「戻る」はルーターに渡し（書きかけの確かめを通す: flickDiscard は呼ばない）、書きかけの確かめで止めた時のルーターの戻し（go(1)）と続け（go(-1)）も渡す', async () => {
    const s = setup('#/day/2026-11-10', 'os-back')
    const discard = vi.fn()
    s.h.handlers.flickDiscard = discard
    await arm(s)
    s.h.push(loc('/day/2026-11-10', register))
    await settle(s.h)
    // 書きかけの確かめ（useBlocker）: 来た「戻る」を止めて go(1) で戻す
    let blocked = false
    s.h.listen((u) => {
      s.updates.push(u)
      if (!blocked && u.delta === -1) {
        blocked = true
        s.h.go(1)
      }
    })
    s.win.userGo(-1)
    await settle(s.h)
    expect(s.updates.map((u) => u.delta)).toEqual([-1, 1])
    expect(s.win.index).toBe(2)
    // ［捨てる］: 止めた「戻る」を続ける
    s.h.go(-1)
    await settle(s.h)
    expect(s.updates.map((u) => u.delta)).toEqual([-1, 1, -1])
    expect(s.win.index).toBe(1)
    expect(discard).not.toHaveBeenCalled()
  })

  it('確かめのダイアログが開いている・ドラッグの途中の「戻る」は、片付けるだけ（詳細の画面を閉じない・閉じるかを聞かない）', async () => {
    const s = setup('#/month/2026-11', 'os-back')
    await arm(s)
    s.win.navigator.userActivation.isActive = true
    s.h.push(loc('/month/2026-11', detail))
    await settle(s.h)
    s.h.handlers.consumePop = () => true
    s.win.userGo(-1)
    await settle(s.h)
    expect(s.updates).toEqual([])
    expect(s.win.index).toBe(2)
    s.h.go(-1)
    await settle(s.h)
    s.win.userGo(-1)
    await settle(s.h)
    expect(s.askExit).not.toHaveBeenCalled()
    expect(s.win.index).toBe(1)
  })

  it('閉じた登録の画面が後ろに残っていても、PC の「進む」で開き直さない（何もしない）', async () => {
    const s = setup('#/day/2026-11-10', 'os-back')
    await arm(s)
    s.h.push(loc('/day/2026-11-10', register))
    await settle(s.h)
    s.h.go(-1)
    await settle(s.h)
    s.win.userGo(1)
    await settle(s.h)
    expect(s.win.index).toBe(1)
    expect(s.updates.length).toBe(1)
  })
})

describe('ほかの画面とカレンダーの行き来', () => {
  it('設定の画面からカレンダーへ移る（左のアイコン）と、土台まで戻ってそこを置き換える（履歴は増えない）', async () => {
    const s = setup('#/day/2026-11-10', 'os-back')
    await arm(s)
    s.h.push(loc('/settings'))
    await settle(s.h)
    s.h.push(loc('/'))
    await settle(s.h)
    expect(s.win.describe()).toEqual(['[back]', '*/', '/settings'])
    s.h.push(loc('/settings'))
    s.h.push(loc('/'))
    await settle(s.h)
    expect(s.win.entries.length).toBe(3)
  })

  it('設定の画面を直接開いた時は作らず、カレンダーへ移った時（押した時）に、その履歴を「戻る」の印にして作る', async () => {
    const s = setup('#/settings', 'os-back')
    await settle(s.h)
    expect(s.h.shape()).toMatchObject({ base: null, buildPending: false })
    s.win.navigator.userActivation.isActive = true
    s.h.push(loc('/'))
    await settle(s.h)
    expect(s.win.describe()).toEqual(['[back]', '*/', '[fwd]'])
  })

  it('アドレス欄で # を書き換えた時は、今の次に積まれた物として番号を付けて描く（カレンダーならそこを土台にする）', async () => {
    const s = setup('#/month/2026-11', 'os-back')
    await arm(s)
    s.win.typeHash('#/week/2026-11-08')
    await settle(s.h)
    expect(s.updates.map((u) => u.location.pathname)).toEqual(['/week/2026-11-08'])
    expect(s.h.shape()).toMatchObject({ base: 2, cur: 2 })
    s.win.userGo(-1)
    await settle(s.h)
    expect(s.askExit).toHaveBeenCalledTimes(1)
    expect(s.win.index).toBe(2)
  })
})

describe('読み込み直す', () => {
  it('土台で読み込み直すと、今の形をそのまま使う（作り直さない・履歴を増やさない）', async () => {
    const first = setup('#/week/2026-11-08', 'edge-flick')
    await arm(first)
    first.h.dispose()
    const s = setup('', 'edge-flick', { win: first.win })
    await settle(s.h)
    expect(s.h.shape()).toMatchObject({ base: 1, cur: 1, buildPending: false })
    s.win.press()
    await settle(s.h)
    expect(s.win.describe()).toEqual(['[back]', '*/week/2026-11-08', '[fwd]'])
    s.win.userGo(1)
    await settle(s.h)
    expect(s.ring).toHaveBeenCalledWith(1)
  })

  it('印の履歴で読み込み直すと、土台へ戻ってルーターに渡す', async () => {
    const first = setup('#/week/2026-11-08', 'os-back')
    await arm(first)
    first.h.dispose()
    first.win.index = 0
    const s = setup('', 'os-back', { win: first.win })
    await settle(s.h)
    expect(s.win.index).toBe(1)
    expect(s.updates.map((u) => [u.location.pathname, u.delta])).toEqual([['/week/2026-11-08', 1]])
  })
})

describe('アプリを閉じる', () => {
  async function leave(s: Setup): Promise<LeaveResult> {
    const result = s.h.leave()
    await settle(s.h)
    return result
  }

  it('アプリの前にほかのページの履歴があれば、そこまで戻る（ページが離れる）', async () => {
    const s = setup('#/month/2026-11', 'os-back', { before: 1 })
    await arm(s)
    expect(await leave(s)).toBe('left')
    expect(s.win.left).toBe(true)
    expect(s.win.index).toBe(0)
  })

  it('前が無い時は window.close() を試し、Android では最初の履歴へ戻って「もう一度［戻る］で閉じる」所にする。押すと土台へ戻る', async () => {
    const s = setup('#/month/2026-11', 'os-back', { armOnLeaveFail: true })
    await arm(s)
    expect(await leave(s)).toBe('armed')
    expect(s.win.closeCalls).toBe(1)
    expect(s.win.index).toBe(0)
    expect(s.h.shape().exitArmed).toBe(true)
    s.win.press()
    await settle(s.h)
    expect(s.win.index).toBe(1)
    expect(s.h.shape().exitArmed).toBe(false)
  })

  it('前が無くて「もう一度［戻る］で閉じる」所にした Android のブラウザのタブも、ホーム画面から開いたアプリ（■25）と同じく押し終えた時（指を離した・キーを打った）に終える。指を下ろしただけ・取り消された指（戻る身振りの始まり）では終わらない。時間の限りは無い', async () => {
    const s = setup('#/month/2026-11', 'os-back', { armOnLeaveFail: true })
    await arm(s)
    expect(await leave(s)).toBe('armed')
    // 戻る身振りの始まり: ページに指を下ろした出来事が来てから、身振りと分かった所で取り消される
    fire(s, pointer('pointerdown', 'touch', 1, { id: 5, primary: true }))
    fire(s, touch('touchstart', 1))
    await tick(100)
    expect(s.h.shape()).toMatchObject({ cur: 0, exitArmed: true, held: true })
    fire(s, pointer('pointercancel', 'touch', 0, { id: 5, primary: true }))
    fire(s, touch('touchcancel', 0))
    await tick(100)
    expect(s.h.shape()).toMatchObject({ cur: 0, exitArmed: true, held: false })
    // 時間が過ぎても終えない（■22 のまま）
    await tick(10_000)
    expect(s.h.shape()).toMatchObject({ cur: 0, exitArmed: true })
    // 押し終えた: 出していた所へ戻る
    tapFinger(s, 6)
    await tick(100)
    expect(s.h.shape()).toMatchObject({ cur: 1, shownIdx: 1, exitArmed: false, held: false })
    // キーを打った時も
    expect(await leave(s)).toBe('armed')
    fire(s, new Event('keydown'))
    await tick(100)
    expect(s.h.shape()).toMatchObject({ cur: 1, shownIdx: 1, exitArmed: false })
    expect(s.askExit).not.toHaveBeenCalled()
  })

  it('前が無くて「もう一度［戻る］で閉じる」所にした時は、その所が終わった時（押し終えた・長押し・「進む」など）に、leave に渡した物を1度呼ぶ（お知らせを消す。■25 の armExit と同じ）', async () => {
    const s = setup('#/month/2026-11', 'os-back', { armOnLeaveFail: true })
    await arm(s)
    const onEnd = vi.fn()
    const result = s.h.leave(onEnd)
    await settle(s.h)
    expect(await result).toBe('armed')
    // 指を下ろしただけでは終わらない
    fire(s, pointer('pointerdown', 'touch', 1, { id: 8, primary: true }))
    fire(s, touch('touchstart', 1))
    await tick(100)
    expect(onEnd).not.toHaveBeenCalled()
    fire(s, pointer('pointerup', 'touch', 0, { id: 8, primary: true }))
    fire(s, touch('touchend', 0))
    await tick(100)
    expect(onEnd).toHaveBeenCalledTimes(1)
    expect(s.h.shape()).toMatchObject({ cur: 1, exitArmed: false })
    // 次の所の終わりは、次に渡した物だけを呼ぶ
    const next = vi.fn()
    const again = s.h.leave(next)
    await settle(s.h)
    expect(await again).toBe('armed')
    s.win.userGo(1)
    await settle(s.h)
    expect(next).toHaveBeenCalledTimes(1)
    expect(onEnd).toHaveBeenCalledTimes(1)
    // 離れた・離れられなかった時は呼ばない
    const stay = setup('#/month/2026-11', 'os-back')
    await arm(stay)
    const never = vi.fn()
    const stayed = stay.h.leave(never)
    await settle(stay.h)
    expect(await stayed).toBe('stayed')
    stay.win.press()
    await settle(stay.h)
    expect(never).not.toHaveBeenCalled()
  })

  it('前が無くて「もう一度［戻る］で閉じる」所にした Android のブラウザのタブで押したまま（長押しで掴む）にした時は、掴む前（ARM_HOLD_MS）に終えて、離すのを待たずに出していた所へ戻る（掴んでいる間の「戻る」でアプリを離れない）', async () => {
    const s = setup('#/month/2026-11', 'os-back', { armOnLeaveFail: true })
    await arm(s)
    expect(await leave(s)).toBe('armed')
    fire(s, pointer('pointerdown', 'touch', 1, { id: 7, primary: true }))
    fire(s, touch('touchstart', 1))
    await tick(ARM_HOLD_MS - 50)
    expect(s.h.shape()).toMatchObject({ cur: 0, exitArmed: true, held: true })
    await tick(100)
    expect(s.h.shape()).toMatchObject({ cur: 1, shownIdx: 1, exitArmed: false, held: true })
    // 掴んだ。掴んでいる間の「戻る」は何もしない（閉じるかを聞かない）
    s.h.handlers.dragging = () => true
    s.h.handlers.consumePop = () => true
    s.win.userGo(-1)
    await tick(100)
    expect(s.h.shape()).toMatchObject({ cur: 1, exitArmed: false })
    expect(s.askExit).not.toHaveBeenCalled()
    s.h.handlers.dragging = () => false
    s.h.handlers.consumePop = () => false
    fire(s, pointer('pointerup', 'touch', 0, { id: 7, primary: true }))
    fire(s, touch('touchend', 0))
    await tick(100)
    expect(s.h.shape()).toMatchObject({ cur: 1, exitArmed: false, held: false })
  })

  it('前が無いと分かる時（ほかのアプリから開いたブラウザのタブなど）は、前へ戻って待たずに、すぐ「もう一度［戻る］で閉じる」所にする', async () => {
    const s = setup('#/month/2026-11', 'os-back', { armOnLeaveFail: true })
    await arm(s)
    let result: LeaveResult | null = null
    void s.h.leave().then((r) => (result = r))
    await vi.advanceTimersByTimeAsync(50)
    expect(result).toBe('armed')
    expect(s.win.closeCalls).toBe(1)
    expect(s.win.index).toBe(0)
  })

  it('「もう一度［戻る］で閉じる」所から、押さずに自分で土台へ戻った（今日へ戻すなど）後の「戻る」は、また閉じるかを聞く', async () => {
    const s = setup('#/month/2026-11', 'os-back', { armOnLeaveFail: true })
    await arm(s)
    expect(await leave(s)).toBe('armed')
    s.win.navigator.userActivation.isActive = false
    s.h.replace(loc('/month/2026-12'))
    await settle(s.h)
    expect(s.h.shape()).toMatchObject({ cur: 1, base: 1, exitArmed: false })
    s.win.userGo(-1)
    await settle(s.h)
    expect(s.askExit).toHaveBeenCalledTimes(1)
    expect(s.win.index).toBe(1)
  })

  it('前が無く、Android でない時はそのまま（離れられなかった）', async () => {
    const s = setup('#/month/2026-11', 'os-back')
    await arm(s)
    expect(await leave(s)).toBe('stayed')
    expect(s.win.index).toBe(1)
  })

  it('土台で読み込み直した後（土台の後ろの数は分からない）は、前が無いと決めずに前へ戻る: アドレス欄で # を書き換えて土台が最後の履歴でも離れる', async () => {
    const first = setup('#/month/2026-11', 'os-back', { before: 1 })
    await arm(first)
    // アドレス欄の書き換えで、新しい土台が最後の履歴になる（後ろの「進む」の印は消える）。押さずに読み込み直す
    first.win.typeHash('#/month/2026-12')
    await settle(first.h)
    first.h.dispose()
    const s = setup('', 'os-back', { win: first.win })
    await settle(s.h)
    expect(s.win.history.length).toBe(4)
    expect(await leave(s)).toBe('left')
    expect(s.win.left).toBe(true)
  })

  it('土台で読み込み直した後に前が無い時（ほかのアプリから開いたブラウザのタブなど）も、前へ戻ってから「もう一度［戻る］で閉じる」所にする', async () => {
    const first = setup('#/month/2026-11', 'os-back', { armOnLeaveFail: true })
    await arm(first)
    first.h.dispose()
    const s = setup('', 'os-back', { armOnLeaveFail: true, win: first.win })
    await settle(s.h)
    expect(await leave(s)).toBe('armed')
    expect(s.win.index).toBe(0)
    expect(s.h.shape().exitArmed).toBe(true)
  })

  it('読み込み直した後でも、アプリが積んだ後は数が分かる（前が無ければ待たずに「もう一度［戻る］で閉じる」所にする）', async () => {
    const first = setup('#/month/2026-11', 'os-back', { armOnLeaveFail: true })
    await arm(first)
    first.h.dispose()
    const s = setup('', 'os-back', { armOnLeaveFail: true, win: first.win })
    await settle(s.h)
    // 詳細の画面を開いて閉じる（積んだので、後ろの数が分かる）
    s.win.navigator.userActivation.isActive = true
    s.h.push(loc('/month/2026-11', detail))
    await settle(s.h)
    s.h.go(-1)
    await settle(s.h)
    let result: LeaveResult | null = null
    void s.h.leave().then((r) => (result = r))
    await vi.advanceTimersByTimeAsync(50)
    expect(result).toBe('armed')
    expect(s.win.index).toBe(0)
  })

  /** 押して印を作ってから、押さずに読み込み直す（同じ window で作り直す） */
  async function reloaded(win: FakeWindow, armOnLeaveFail: boolean): Promise<Setup> {
    const first = setup('', 'os-back', { armOnLeaveFail, win })
    await arm(first)
    first.h.dispose()
    const s = setup('', 'os-back', { armOnLeaveFail, win })
    await settle(s.h)
    return s
  }

  it('読み込み直した後でも、タブの履歴がどれもアプリの物で前が無いと分かる時（Navigation API）は、待たずに「もう一度［戻る］で閉じる」所にする', async () => {
    const s = await reloaded(new FakeWindow('#/month/2026-11', { navigationApi: true }), true)
    let result: LeaveResult | null = null
    void s.h.leave().then((r) => (result = r))
    await vi.advanceTimersByTimeAsync(50)
    expect(result).toBe('armed')
    expect(s.win.closeCalls).toBe(1)
    expect(s.h.shape()).toMatchObject({ cur: 0, exitArmed: true })
  })

  it('Navigation API でも、アプリの前にほかのページがあれば前へ戻る（読み込み直した後・アドレス欄で # を書き換えて土台が最後の履歴の時も）', async () => {
    const s = await reloaded(new FakeWindow('#/month/2026-11', { before: 1, navigationApi: true }), true)
    expect(await leave(s)).toBe('left')
    const win = new FakeWindow('#/month/2026-11', { before: 1, navigationApi: true })
    const first = setup('', 'os-back', { win })
    await arm(first)
    win.typeHash('#/month/2026-12')
    await settle(first.h)
    first.h.dispose()
    const t = setup('', 'os-back', { win })
    await settle(t.h)
    expect(await leave(t)).toBe('left')
    expect(win.left).toBe(true)
  })

  // 前へ戻って待つ 0.7秒（LEAVE_WAIT_MS）の間と、window.close() を試して待つ 0.3秒（CLOSE_WAIT_MS）の間
  for (const ms of [300, 850]) {
    it(`前が分からず前へ戻って待つ間（${ms}ms 後）に「戻る」が来た時（前へは戻れなかった）は、前が無いとみなす: Android は「もう一度［戻る］で閉じる」所にし、閉じるかを聞き直さない`, async () => {
      const s = await reloaded(new FakeWindow('#/month/2026-11'), true)
      let result: LeaveResult | null = null
      void s.h.leave().then((r) => (result = r))
      await vi.advanceTimersByTimeAsync(ms)
      expect(result).toBeNull()
      s.win.userGo(-1)
      await settle(s.h)
      expect(result).toBe('armed')
      expect(s.h.shape()).toMatchObject({ cur: 0, exitArmed: true })
      expect(s.askExit).not.toHaveBeenCalled()
    })

    it(`PC でも、待つ間（${ms}ms 後）の「戻る」で閉じるかを聞き直さず、出していた所へ戻る（離れられなかった）`, async () => {
      const s = await reloaded(new FakeWindow('#/month/2026-11'), false)
      let result: LeaveResult | null = null
      void s.h.leave().then((r) => (result = r))
      await vi.advanceTimersByTimeAsync(ms)
      s.win.userGo(-1)
      await settle(s.h)
      expect(result).toBe('stayed')
      expect(s.win.index).toBe(1)
      expect(s.askExit).not.toHaveBeenCalled()
    })
  }
})

describe('ホーム画面から開いた Android のアプリ: 聞かずに、もう一度［戻る］で閉じる（■25）', () => {
  /** お知らせを出している長さ（src/features/top/closeApp.ts の EXIT_ARMED_MS と同じ値で試す） */
  const ARM_MS = 3000

  interface HomeSetup extends Setup {
    /** armExit を頼まれた回数・その所が終わった回数・armExit の結果 */
    log: { arms: number; ends: number; results: boolean[] }
  }

  /** ホーム画面から開いた Android のアプリ（閉じ方 press-again）。armExit は closeApp と同じく（保存してから）armExit を呼ぶ */
  function homeApp({ before = 0 }: { before?: number } = {}): HomeSetup {
    const s = setup('#/month/2026-11', 'os-back', { exit: 'press-again', armOnLeaveFail: true, before })
    const log = { arms: 0, ends: 0, results: [] as boolean[] }
    s.h.handlers.armExit = () => {
      log.arms += 1
      void s.h.armExit(ARM_MS, () => (log.ends += 1)).then((r) => log.results.push(r))
    }
    return { ...s, log }
  }

  /** 利用者の「戻る」（決めた長さの見張りは進めない） */
  async function back(s: Setup) {
    s.win.userGo(-1)
    await tick(100)
  }

  it('カレンダーの1回目の「戻る」は聞かずに、最初の履歴へ移って、もう一度［戻る］で閉じる所にする（ルーターには何も渡さず、履歴は増えない）', async () => {
    const s = homeApp()
    await arm(s)
    expect(s.h.shape().exit).toBe('press-again')
    await back(s)
    expect(s.askExit).not.toHaveBeenCalled()
    expect(s.log).toEqual({ arms: 1, ends: 0, results: [true] })
    expect(s.h.shape()).toMatchObject({ cur: 0, base: 1, shownIdx: 1, exitArmed: true, busy: false })
    expect(s.win.describe()).toEqual(['*[back]', '/month/2026-11', '[fwd]'])
    expect(s.updates).toEqual([])
  })

  it('出ている間のもう一度の「戻る」で、ブラウザがアプリの前へ戻る（ページが離れる）', async () => {
    const s = homeApp({ before: 1 })
    await arm(s)
    await back(s)
    expect(s.h.shape()).toMatchObject({ cur: 0, exitArmed: true })
    await back(s)
    expect(s.win.left).toBe(true)
    expect(s.win.index).toBe(0)
    expect(s.log.arms).toBe(1)
  })

  it('もう一度の「戻る」が来ずに決めた長さが過ぎたら、出していた所（土台）へ戻って終わり（onEnd）、次の「戻る」でまた同じ所にする', async () => {
    const s = homeApp()
    await arm(s)
    await back(s)
    await tick(ARM_MS - 200)
    expect(s.h.shape()).toMatchObject({ cur: 0, exitArmed: true })
    expect(s.log.ends).toBe(0)
    await tick(200)
    expect(s.h.shape()).toMatchObject({ cur: 1, shownIdx: 1, exitArmed: false, busy: false })
    expect(s.win.index).toBe(1)
    expect(s.log.ends).toBe(1)
    await back(s)
    expect(s.log).toMatchObject({ arms: 2, ends: 1, results: [true, true] })
    expect(s.h.shape()).toMatchObject({ cur: 0, exitArmed: true })
    expect(s.updates).toEqual([])
  })

  it('出ている間に押し終えた（指を離した）・キーを打った時は、出していた所へ戻って終わり、次の「戻る」でまた同じ所にする', async () => {
    const s = homeApp()
    await arm(s)
    await back(s)
    tapFinger(s, 7)
    await tick(100)
    expect(s.h.shape()).toMatchObject({ cur: 1, exitArmed: false })
    expect(s.log.ends).toBe(1)
    await back(s)
    expect(s.h.shape()).toMatchObject({ cur: 0, exitArmed: true })
    fire(s, new Event('keydown'))
    await tick(100)
    expect(s.h.shape()).toMatchObject({ cur: 1, exitArmed: false })
    expect(s.log).toMatchObject({ arms: 2, ends: 2 })
    // 決めた長さの見張りも止まっている（後から土台を動かさない）
    await tick(ARM_MS)
    expect(s.h.shape()).toMatchObject({ cur: 1, exitArmed: false })
    expect(s.log.ends).toBe(2)
  })

  it('指を下ろしただけ・取り消された指（Android の戻る身振りの始まり）では終わらず、その身振りの「戻る」で離れる', async () => {
    const s = homeApp({ before: 1 })
    await arm(s)
    await back(s)
    fire(s, pointer('pointerdown', 'touch', 1, { id: 8, primary: true }))
    fire(s, touch('touchstart', 1))
    await tick(100)
    expect(s.h.shape()).toMatchObject({ cur: 0, exitArmed: true })
    fire(s, pointer('pointercancel', 'touch', 0, { id: 8, primary: true }))
    fire(s, touch('touchcancel', 0))
    await tick(100)
    expect(s.h.shape()).toMatchObject({ cur: 0, exitArmed: true })
    expect(s.log.ends).toBe(0)
    await back(s)
    expect(s.win.left).toBe(true)
  })

  it('10回くり返しても（時間が過ぎる・押す）履歴は増えず、形は同じ（行ったり来たりしない）', async () => {
    const s = homeApp()
    await arm(s)
    const shape = s.win.describe()
    for (let i = 0; i < 10; i++) {
      await back(s)
      expect(s.h.shape()).toMatchObject({ cur: 0, exitArmed: true })
      if (i % 2 === 0) await tick(ARM_MS)
      else {
        tapFinger(s, 20 + i)
        await tick(100)
      }
      expect(s.h.shape()).toMatchObject({ cur: 1, base: 1, shownIdx: 1, exitArmed: false, busy: false })
    }
    expect(s.win.describe()).toEqual(shape)
    expect(s.log).toMatchObject({ arms: 10, ends: 10 })
    expect(s.log.results.every(Boolean)).toBe(true)
    expect(s.askExit).not.toHaveBeenCalled()
    expect(s.updates).toEqual([])
  })

  it('シートが開いている時の「戻る」はシートを閉じ、確かめのダイアログ・掴んでいる間は先に片付け、登録の画面は1つ戻る（どれも、その所にしない）', async () => {
    const s = homeApp()
    await arm(s)
    s.win.navigator.userActivation.isActive = true
    // 詳細の画面
    s.h.push(loc('/month/2026-11', detail))
    await settle(s.h)
    await back(s)
    expect(s.log.arms).toBe(0)
    expect(s.updates.at(-1)).toMatchObject({ location: { pathname: '/month/2026-11', state: null }, delta: -1 })
    expect(s.h.shape()).toMatchObject({ cur: 1, shownIdx: 1, exitArmed: false })
    // 確かめのダイアログ・掴んでいる間（consumePop）
    s.h.handlers.consumePop = () => true
    await back(s)
    expect(s.log.arms).toBe(0)
    expect(s.h.shape()).toMatchObject({ cur: 1, shownIdx: 1, exitArmed: false })
    s.h.handlers.consumePop = () => false
    // 登録の画面（書きかけの確かめはルーターの所で）
    s.h.push(loc('/month/2026-11', register))
    await settle(s.h)
    const count = s.updates.length
    await back(s)
    expect(s.log.arms).toBe(0)
    expect(s.updates.length).toBe(count + 1)
    expect(s.updates.at(-1)?.delta).toBe(-1)
    // カレンダーでの次の「戻る」で、その所にする
    await back(s)
    expect(s.log.arms).toBe(1)
    expect(s.h.shape()).toMatchObject({ cur: 0, exitArmed: true })
  })

  it('押している間に来た「戻る」は、土台へはすぐ戻し、最初の履歴へ移るのは押し終えてから', async () => {
    const s = homeApp()
    await arm(s)
    fire(s, pointer('pointerdown', 'touch', 1, { id: 9, primary: true }))
    fire(s, touch('touchstart', 1))
    await back(s)
    expect(s.log.arms).toBe(1)
    expect(s.h.shape()).toMatchObject({ cur: 1, exitArmed: false, held: true })
    s.win.navigator.userActivation.isActive = true
    fire(s, pointer('pointerup', 'touch', 0, { id: 9, primary: true }))
    fire(s, touch('touchend', 0))
    await tick(100)
    expect(s.h.shape()).toMatchObject({ cur: 0, exitArmed: true, held: false })
    expect(s.log.results).toEqual([true])
  })

  it('出ている間に押したまま（長押しで掴む）にした時は、掴む前（ARM_HOLD_MS）に終えて出していた所へ戻る（掴んでいる間の「戻る」で離れない）', async () => {
    const s = homeApp({ before: 1 })
    await arm(s)
    await back(s)
    fire(s, pointer('pointerdown', 'touch', 1, { id: 11, primary: true }))
    fire(s, touch('touchstart', 1))
    await tick(ARM_HOLD_MS - 50)
    expect(s.h.shape()).toMatchObject({ cur: 0, exitArmed: true })
    await tick(100)
    expect(s.h.shape()).toMatchObject({ cur: 1, shownIdx: 1, exitArmed: false, held: true })
    expect(s.log.ends).toBe(1)
    // 掴んだ（指は 400ms）。掴んでいる間の「戻る」は何もしない
    s.h.handlers.dragging = () => true
    s.h.handlers.consumePop = () => true
    await back(s)
    expect(s.win.left).toBe(false)
    expect(s.h.shape()).toMatchObject({ cur: 1, exitArmed: false })
    expect(s.log.arms).toBe(1)
    // 落とした後の「戻る」で、また同じ所にする
    s.h.handlers.dragging = () => false
    s.h.handlers.consumePop = () => false
    fire(s, pointer('pointerup', 'touch', 0, { id: 11, primary: true }))
    fire(s, touch('touchend', 0))
    await tick(100)
    expect(s.h.shape()).toMatchObject({ cur: 1, exitArmed: false, held: false })
    await back(s)
    expect(s.h.shape()).toMatchObject({ cur: 0, exitArmed: true })
    expect(s.log).toMatchObject({ arms: 2, ends: 1 })
  })

  it('指を下ろしてすぐ取り消された（スクロールに取られた・戻る身振り）指は、押したままでも決めた長さまでは終えない。過ぎた時は離すのを待たずに戻る（お知らせが消えた後の「戻る」で離れない）', async () => {
    const s = homeApp({ before: 1 })
    await arm(s)
    await back(s)
    fire(s, pointer('pointerdown', 'touch', 1, { id: 12, primary: true }))
    fire(s, touch('touchstart', 1))
    fire(s, pointer('pointercancel', 'touch', 0, { id: 12, primary: true }))
    await tick(ARM_MS - 200)
    expect(s.h.shape()).toMatchObject({ cur: 0, exitArmed: true, held: true })
    await tick(200)
    expect(s.log.ends).toBe(1)
    expect(s.h.shape()).toMatchObject({ cur: 1, exitArmed: false, held: true })
    await back(s)
    expect(s.win.left).toBe(false)
    expect(s.h.shape()).toMatchObject({ cur: 1, exitArmed: false })
    // 離してから、その「戻る」の所にする
    fire(s, touch('touchend', 0))
    await tick(100)
    expect(s.h.shape()).toMatchObject({ cur: 0, exitArmed: true, held: false })
    expect(s.log).toMatchObject({ arms: 2, ends: 1, results: [true, true] })
  })

  it('出ている間に押したまま、ほかの画面を積んだ時は、終えて出していた所へ戻ってから積む（土台と「進む」の印を書きつぶさない）', async () => {
    const s = homeApp()
    await arm(s)
    await back(s)
    fire(s, pointer('pointerdown', 'touch', 1, { id: 13, primary: true }))
    fire(s, touch('touchstart', 1))
    s.h.push(loc('/month/2026-11', detail))
    await tick(100)
    expect(s.win.describe()).toEqual(['[back]', '/month/2026-11', '*/month/2026-11+detail'])
    expect(s.h.shape()).toMatchObject({ cur: 2, base: 1, shownIdx: 2, exitArmed: false })
    expect(s.log.ends).toBe(1)
  })

  it('書きかけを保存している間に押した・キーを打った時は、保存し終えても、その所にしない。もう一度の「戻る」の身振り（取り消された指）は押したに数えない', async () => {
    const s = homeApp()
    // 保存に時間がかかる: armExit を頼まれても、保存し終えた時（後で）呼ぶ
    const saved: (() => void)[] = []
    s.h.handlers.armExit = () => {
      s.log.arms += 1
      saved.push(() => void s.h.armExit(ARM_MS, () => (s.log.ends += 1)).then((r) => s.log.results.push(r)))
    }
    await arm(s)
    await back(s)
    expect(s.h.shape()).toMatchObject({ cur: 1, exitArmed: false })
    tapFinger(s, 14)
    await tick(100)
    saved.shift()!()
    await tick(100)
    expect(s.log.results).toEqual([false])
    expect(s.h.shape()).toMatchObject({ cur: 1, exitArmed: false })
    // キーを打った時も
    await back(s)
    fire(s, new Event('keydown'))
    saved.shift()!()
    await tick(100)
    expect(s.log.results).toEqual([false, false])
    expect(s.h.shape()).toMatchObject({ cur: 1, exitArmed: false })
    // 保存している間の、もう一度の「戻る」の身振り（指を下ろして取り消される）。closeApp は保存している間の2回目を頼み直さない
    await back(s)
    fire(s, pointer('pointerdown', 'touch', 1, { id: 15, primary: true }))
    fire(s, touch('touchstart', 1))
    fire(s, pointer('pointercancel', 'touch', 0, { id: 15, primary: true }))
    fire(s, touch('touchcancel', 0))
    await back(s)
    expect(s.h.shape()).toMatchObject({ cur: 1, exitArmed: false })
    saved.shift()!()
    await tick(100)
    expect(s.log.results).toEqual([false, false, true])
    expect(s.h.shape()).toMatchObject({ cur: 0, exitArmed: true })
  })

  it('アプリが自分で土台へ戻った時（今日へ戻すなど）・「進む」が来た時も終わり、次の「戻る」でまた同じ所にする', async () => {
    const s = homeApp()
    await arm(s)
    await back(s)
    s.win.navigator.userActivation.isActive = false
    s.h.replace(loc('/month/2026-12'))
    await tick(100)
    expect(s.h.shape()).toMatchObject({ cur: 1, base: 1, exitArmed: false })
    expect(s.win.hashPath()).toBe('/month/2026-12')
    expect(s.log.ends).toBe(1)
    await back(s)
    expect(s.h.shape()).toMatchObject({ cur: 0, exitArmed: true })
    s.win.userGo(1)
    await tick(100)
    expect(s.h.shape()).toMatchObject({ cur: 1, exitArmed: false })
    expect(s.log).toMatchObject({ arms: 2, ends: 2 })
    await back(s)
    expect(s.h.shape()).toMatchObject({ cur: 0, exitArmed: true })
    expect(s.win.entries.length).toBe(3)
  })

  it('カレンダーを出していない時に頼まれても、その所にしない（false。onEnd は呼ばない）', async () => {
    const s = homeApp()
    await arm(s)
    s.win.navigator.userActivation.isActive = true
    s.h.push(loc('/month/2026-11', detail))
    await settle(s.h)
    let result: boolean | null = null
    let ended = false
    void s.h.armExit(ARM_MS, () => (ended = true)).then((r) => (result = r))
    await tick(100)
    expect(result).toBe(false)
    expect(ended).toBe(false)
    expect(s.h.shape()).toMatchObject({ cur: 2, shownIdx: 2, exitArmed: false })
  })

  it('Android のブラウザのタブ（閉じ方 ask）は、今までどおり閉じるかを聞く', async () => {
    const s = setup('#/month/2026-11', 'os-back', { exit: 'ask', armOnLeaveFail: true })
    const armExit = vi.fn()
    s.h.handlers.armExit = armExit
    await arm(s)
    s.win.userGo(-1)
    await settle(s.h)
    expect(s.askExit).toHaveBeenCalledTimes(1)
    expect(armExit).not.toHaveBeenCalled()
    expect(s.h.shape()).toMatchObject({ cur: 1, exitArmed: false, exit: 'ask' })
  })
})
