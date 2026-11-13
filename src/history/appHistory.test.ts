// アプリの履歴（docs/SPEC.md の 3.1。22. の段階2の終わりの確かめの「画面の外からのフリックの決め」・■22・■23）: 履歴の形（土台の前後に
// 「戻る」「進む」の印）を押した時に作り、カレンダーの中の行き来は土台を置き換えるだけで増やさない。「戻る」「進む」が来たら、
// iPhone（端からのフリック）はモードを回し、Android・PC（OS の戻る）は閉じるかを聞き、どちらも土台へ戻す（ルーターには渡さない）。
// 登録・詳細の画面・ほかの画面での扱い、ルーターの戻る（閉じる・書きかけの確かめ）、読み込み直し、アプリを閉じる。
// 押している間・ドラッグの途中は、アプリから履歴を動かさない（印の履歴は押し終えてから作る。その間も「戻る」「進む」から戻すのは待たない。
// 離す出来事が来ないまま残った指は、次に指を下ろした時に捨てる）。印の履歴は、スクロールの位置を戻させない
import type { Location } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screenOf } from '../features/calendar/common/calendarHistory'
import { FakeWindow } from '../test/fakeHistoryWindow'
import { AppHistory, PRESS_STALE_MS, type LeaveResult } from './appHistory'
import type { PopSource } from './popRules'

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
  { armOnLeaveFail = false, before = 0, win }: { armOnLeaveFail?: boolean; before?: number; win?: FakeWindow } = {},
): Setup {
  const w = win ?? new FakeWindow(hash, { before })
  const h = new AppHistory({ window: w, source, armOnLeaveFail, screenOf })
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

  it('登録の画面: どちらへ払っても何もしない（開いたまま。後ろに「進む」の印は置かない）', async () => {
    const s = setup('#/day/2026-11-10', 'edge-flick')
    await arm(s)
    s.win.navigator.userActivation.isActive = true
    s.h.push(loc('/day/2026-11-10', register))
    await settle(s.h)
    expect(s.win.describe()).toEqual(['[back]', '/day/2026-11-10', '*/day/2026-11-10+register'])
    s.win.userGo(-1)
    await settle(s.h)
    expect(s.win.describe()).toEqual(['[back]', '/day/2026-11-10', '*/day/2026-11-10+register'])
    expect(s.updates).toEqual([])
    expect(s.ring).not.toHaveBeenCalled()
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
function setupSwipes(mode: Mode, hooks: SwipeHooks = {}): Setup {
  const win = new FakeWindow(`#${PATHS[mode]}`, { swipes: true })
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
  disposers.push(() => h.dispose())
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

/** 土台の前後の履歴（「戻る」の印・土台・後ろの履歴）の絵 */
function aroundBase(s: Setup): string[] {
  const base = s.h.shape().base as number
  return s.win.pictures().slice(base - 1, base + 2)
}

/**
 * すぐ続けて払う（n 回）: 身振りの絵が消えてから gap ms で次の指を下ろし（離す出来事は来ない。身振りが取る）、0.15秒後に払う。
 * 最後に落ち着くまで待つ
 */
async function quickFlicks(s: Setup, n: number, gap: number, dir: 1 | -1 = 1) {
  for (let i = 0; i < n; i++) {
    await vi.advanceTimersByTimeAsync(1)
    for (let k = 0; k < 400 && s.win.overlay; k++) await vi.advanceTimersByTimeAsync(5)
    await vi.advanceTimersByTimeAsync(gap)
    fire(s, pointer('pointerdown', 'touch', 1, { id: 100 + i, primary: true }))
    fire(s, touch('touchstart', 1))
    await vi.advanceTimersByTimeAsync(150)
    s.win.userGo(dir)
  }
  await settle(s.h)
}

describe('iPhone の身振りの絵（端からのフリックの間に見える絵。WebKit のまね）', () => {
  it('作者の報告3: ウィークリーで詳細を開き、右の端から閉じた後、右の端から払うたびに出る絵は閉じた詳細の画面でなく、今のモードのカレンダー（履歴は増えない）', async () => {
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
    // 1回目（詳細を閉じた身振り）は詳細の後ろの「進む」の印の絵（開いた時のカレンダー）。その後は回すたびに、その時のモード
    expect(s.win.slid).toEqual(['week', 'week', 'day', 'year', 'month'])
    expect(s.win.screen).toBe('week')
    expect(aroundBase(s)).toEqual(['week', 'week', 'week'])
    // 閉じた詳細の画面とその後ろの印の履歴は、閉じた時に切り捨てた（押した直後。開く前と同じ数）
    expect(s.win.entries.length).toBe(length)
    expect(s.win.describe()).toEqual(['[back]', '*/week/2026-11-08', '[fwd]'])
  })

  it('左の端から払っても、どちらの印の絵もその時のモード（前に見ていたモード・上に出ていた物は出ない）', async () => {
    const s = setupSwipes('day')
    await arm(s)
    for (let i = 0; i < 4; i++) {
      s.win.userGo(-1)
      await settle(s.h)
    }
    s.win.userGo(1)
    await settle(s.h)
    expect(s.win.slid).toEqual(['day', 'week', 'month', 'year', 'day'])
    expect(s.win.screen).toBe('year')
    expect(aroundBase(s)).toEqual(['year', 'year', 'year'])
  })

  it('作者の報告2: 登録の画面を［×］で閉じた後、すばやく足すを開いたまま払っても、出る絵に登録の画面は無い（閉じる前に隠して描かせてから戻る）', async () => {
    const hooks: SwipeHooks = {}
    const s = setupSwipes('week', hooks)
    await arm(s)
    await openSheet(s, 'register')
    expect(s.win.painted).toBe('week+register')
    // ［×］（ルーターの戻る）。戻ってすぐ、すばやく足すを開いた（カレンダーだけの画面にならないので、絵は写し直せない）
    hooks.afterClose = () => s.win.show('week+quick')
    s.h.go(-1)
    await vi.advanceTimersByTimeAsync(20)
    // 戻る前に隠した（まだ履歴は動かしていない）
    expect(s.win.screen).toBe('week')
    expect(s.win.index).toBe(2)
    await settle(s.h)
    hooks.afterClose = undefined
    expect(s.win.screen).toBe('week+quick')
    expect(s.win.describe()).toEqual(['[back]', '*/week/2026-11-08', '/week/2026-11-08+register'])
    // 右の端から: すばやく足すは閉じてモードが回る。出た絵は閉じた登録の画面の履歴の絵だが、隠した後のカレンダー
    s.win.userGo(1)
    await settle(s.h)
    expect(s.win.slid).toEqual(['week'])
    expect(s.ring).toHaveBeenCalledWith(1)
    expect(s.win.screen).toBe('day')
    expect(aroundBase(s)).toEqual(['day', 'day', 'day'])
    expect(s.win.describe()).toEqual(['[back]', '*/day/2026-11-10', '[fwd]'])
  })

  it('すばやく足すを開いたまま払ってモードを回した後も、次に払った時の絵はすばやく足すの無い今のモード', async () => {
    const s = setupSwipes('week')
    await arm(s)
    s.win.show('week+quick')
    await settle(s.h)
    s.win.userGo(1)
    await settle(s.h)
    s.win.userGo(1)
    await settle(s.h)
    expect(s.win.slid).toEqual(['week', 'day'])
    expect(s.win.pictures().filter((p) => p.includes('+'))).toEqual([])
  })

  it('作者の報告1: 登録の画面で左の端から払うと、ブラウザは土台の絵（カレンダー）を出してから戻り、アプリは登録の画面へ戻す（止められない。履歴は変わらない）', async () => {
    const s = setupSwipes('week')
    await arm(s)
    await openSheet(s, 'register')
    s.win.userGo(-1)
    await settle(s.h)
    expect(s.win.slid).toEqual(['week'])
    expect(s.win.describe()).toEqual(['[back]', '/week/2026-11-08', '*/week/2026-11-08+register'])
    expect(s.updates).toEqual([])
    // 右の端からは、後ろに履歴が無いので身振りにならない
    s.win.userGo(1)
    await settle(s.h)
    expect(s.win.slid).toEqual(['week'])
  })

  it('写し直すのは押し終えてから（押している間は履歴を動かさない）。身振りに取られた指（離す出来事が来ない）は待たない', async () => {
    const s = setupSwipes('week')
    await arm(s)
    // 右の端からの身振り: 指を下ろした出来事だけが来る
    fire(s, pointer('pointerdown', 'touch', 1, { id: 5, primary: true }))
    fire(s, touch('touchstart', 1))
    s.win.userGo(1)
    await settle(s.h)
    expect(s.h.shape().held).toBe(false)
    expect(aroundBase(s)).toEqual(['day', 'day', 'day'])
    // 次の身振りの後、絵を写し直す前に別の指で押した: 離すまで写さない
    s.win.userGo(1)
    await vi.advanceTimersByTimeAsync(5)
    fire(s, pointer('pointerdown', 'touch', 1, { id: 6, primary: true }))
    fire(s, touch('touchstart', 1))
    await vi.advanceTimersByTimeAsync(2000)
    expect(s.win.screen).toBe('year')
    expect(aroundBase(s)).toEqual(['day', 'day', 'day'])
    expect(s.h.shape()).toMatchObject({ held: true, refreshing: false, busy: false })
    fire(s, pointer('pointerup', 'touch', 0, { id: 6, primary: true }))
    fire(s, touch('touchend', 0))
    await settle(s.h)
    expect(aroundBase(s)).toEqual(['year', 'year', 'year'])
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
    // 月から週（描く物が足りている）は足さない
    const counts: number[] = []
    s.h.handlers.ballast = (n) => counts.push(n)
    s.win.userGo(1)
    await settle(s.h)
    expect(counts).toEqual([])
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

  it('ほかの端末（Android・PC）は写し直さない（自分で履歴を動かさない）', async () => {
    const win = new FakeWindow('#/month/2026-11', { swipes: true })
    const s = setup('#/month/2026-11', 'os-back', { win })
    const cleanScreen = vi.fn(() => true)
    s.h.handlers.cleanScreen = cleanScreen
    await arm(s)
    const go = vi.spyOn(win.history, 'go')
    s.win.userGo(-1)
    await settle(s.h)
    expect(s.askExit).toHaveBeenCalled()
    expect(go).toHaveBeenCalledTimes(1)
    expect(cleanScreen).not.toHaveBeenCalled()
  })

  // ---------- 検査の直し（2回目） ----------

  it('［×］で登録の画面を隠して描かせている間に左の端から払っても、閉じ終えた時にブラウザの今いる所と出している所が合う（その間に来た払いから戻すのを先に済ませる）', async () => {
    const s = setupSwipes('week')
    await arm(s)
    const length = s.win.entries.length
    await openSheet(s, 'register')
    s.h.go(-1)
    await vi.advanceTimersByTimeAsync(10)
    s.win.userGo(-1)
    await settle(s.h)
    await vi.advanceTimersByTimeAsync(5000)
    await settle(s.h)
    expect(s.h.shape()).toMatchObject({ cur: 1, base: 1, shownIdx: 1, busy: false, refreshing: false })
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

  it('右の端から詳細の画面を閉じた時、押してから間もなければ、閉じた画面の履歴をすぐ切り捨てる: すぐ続けて払っても閉じた詳細の画面は出ない（写し直すまでは絵が無く、地の色）。少し待つと今のモードの絵', async () => {
    const s = setupSwipes('week')
    await arm(s)
    const length = s.win.entries.length
    await openSheet(s, 'detail')
    s.win.userGo(1)
    await vi.advanceTimersByTimeAsync(1)
    // 閉じた身振りの絵を出している間に、詳細の画面とその後ろの印の履歴を切り捨てた（新しい「進む」の印には、まだ絵が無い）
    await vi.advanceTimersByTimeAsync(20)
    expect(s.win.describe()).toEqual(['[back]', '*/week/2026-11-08', '[fwd]'])
    expect(s.win.pictures()[2]).toBe('-')
    // 絵が消えて 0.12秒で次の指を下ろす（写し直す前）。それを4回
    await quickFlicks(s, 4, 120)
    expect(s.win.slid).toEqual(['week', 'none', 'none', 'none', 'none'])
    // 少し待ってから払うと、今のモードの絵
    const mode = modeOf(s.win.screen)
    s.win.userGo(1)
    await settle(s.h)
    expect(s.win.slid.at(-1)).toBe(mode)
    expect(s.win.entries.length).toBe(length)
  })

  it('左の端から詳細の画面を閉じた時も、押してから間もなければ、閉じた画面の履歴をすぐ切り捨てる（すぐ右の端から払っても閉じた画面は出ない）', async () => {
    const s = setupSwipes('day')
    await arm(s)
    await openSheet(s, 'detail')
    s.win.userGo(-1)
    await quickFlicks(s, 1, 120)
    expect(s.win.slid).toEqual(['day', 'none'])
    expect(s.win.describe()).toEqual(['[back]', '*/year/2026', '[fwd]'])
  })

  it('押してから時間がたってから右の端から詳細の画面を閉じた時（ブラウザが積んだ履歴を行き先から外すので、切り捨てられない）は、すぐ続けて払うと閉じた詳細の画面が出る（iPhone の限界）。指を離して少し待つと、今のモードの絵', async () => {
    const s = setupSwipes('week')
    await arm(s)
    await openSheet(s, 'detail')
    s.win.navigator.userActivation.isActive = false
    s.win.userGo(1)
    await quickFlicks(s, 2, 120)
    expect(s.win.slid).toEqual(['week', 'week+detail', 'week+detail'])
    expect(s.win.screen).toBe('year')
    s.win.userGo(1)
    await settle(s.h)
    expect(s.win.slid.at(-1)).toBe('year')
    expect(s.win.describe()).toEqual(['[back]', '*/month/2026-11', '[fwd]', '[fwd]'])
  })

  it('閉じた直後にすばやく足すを開き、押し終わりの無い閉じ方（Esc・キーボードの完了）で閉じた時も、閉じた後に絵を写し直す（画面の側が知らせる）', async () => {
    const s = setupSwipes('week')
    await arm(s)
    await openSheet(s, 'detail')
    s.win.navigator.userActivation.isActive = false
    s.win.userGo(1)
    await vi.advanceTimersByTimeAsync(40)
    s.win.show('week+quick')
    await settle(s.h)
    // すばやく足すを開いている間は写さない
    expect(aroundBase(s)[2]).toBe('week+detail')
    // Esc で閉じた（押し終わりは無い。QuickAdd が外れた時に知らせる）
    s.win.show('week')
    s.h.uncovered(150)
    expect(s.h.shape().refreshing).toBe(true)
    await settle(s.h)
    expect(aroundBase(s)).toEqual(['week', 'week', 'week'])
    s.win.userGo(1)
    await settle(s.h)
    expect(s.win.slid).toEqual(['week', 'week'])
  })

  it('写し直す時に画面がカレンダーだけでなくても（上の物が消える動きの途中など）、少し後にもう一度確かめる（決めた回数まで）', async () => {
    const s = setupSwipes('week')
    s.win.weights['day+menu'] = WEIGHTS.day + 20
    s.win.weights['year+menu'] = WEIGHTS.year + 20
    await arm(s)
    s.win.userGo(1)
    await vi.advanceTimersByTimeAsync(40)
    // 回した後すぐ、上に物が出て、出来事の無いまま 0.3秒で消えた
    s.win.show('day+menu')
    await vi.advanceTimersByTimeAsync(300)
    s.win.show('day')
    await settle(s.h)
    expect(aroundBase(s)).toEqual(['day', 'day', 'day'])
    // 出たままなら、決めた回数で止める（動かし続けない）
    s.win.userGo(1)
    await vi.advanceTimersByTimeAsync(40)
    s.win.show('year+menu')
    await settle(s.h)
    expect(s.h.shape()).toMatchObject({ refreshing: false, busy: false })
    expect(aroundBase(s)).toEqual(['day', 'day', 'day'])
  })

  it('読み込み直した後も、右の端から払って土台の後ろが「進む」の印と分かったら、その絵も写し直す（払うたびにその時のモード）', async () => {
    const s = setupSwipes('week')
    await arm(s)
    s.win.userGo(1)
    await settle(s.h)
    s.h.dispose()
    const win = s.win
    const h2 = new AppHistory({ window: win, source: 'edge-flick', armOnLeaveFail: false, screenOf })
    h2.handlers = {
      ring: (dir) => {
        const next = (dir === 1 ? RING_NEXT : RING_PREV)[modeOf(win.screen)]
        win.show(next)
        h2.replace(loc(PATHS[next]))
      },
      cleanScreen: () => !win.screen.includes('+'),
      renderWeight: () => win.weight() - win.ballastCount,
      ballast: (n) => {
        win.ballastCount = n
      },
    }
    h2.listen(() => {})
    disposers.push(() => h2.dispose())
    await settle(h2)
    for (let i = 0; i < 4; i++) {
      win.userGo(1)
      await settle(h2)
    }
    expect(win.slid).toEqual(['week', 'day', 'year', 'month', 'week'])
    expect(win.describe()).toEqual(['[back]', '*/day/2026-11-10', '[fwd]'])
  })

  it('写し直すのに自分で動いている間に利用者の払いが来た（思った所と違う所へ着いた）時は、その払いの身振りの絵の間とみなし、絵は古いままにして後で写し直す', async () => {
    const s = setupSwipes('week')
    await arm(s)
    await openSheet(s, 'detail')
    s.win.navigator.userActivation.isActive = false
    s.win.userGo(1)
    await vi.advanceTimersByTimeAsync(1)
    const go = vi.spyOn(s.win.history, 'go')
    let n = 0
    go.mockImplementation((d: number) => {
      n++
      s.win.move(d)
      // 写し直す1つ目の動き（土台の後ろへ）の直後に、利用者が右の端から払った
      if (n === 1) {
        s.win.overlay = false
        s.win.userGo(1)
      }
    })
    await vi.advanceTimersByTimeAsync(6000)
    await settle(s.h)
    go.mockRestore()
    const shape = s.h.shape()
    expect(shape.cur).toBe(shape.shownIdx)
    expect(s.win.index).toBe(shape.base)
    const mode = modeOf(s.win.screen)
    expect(aroundBase(s)).toEqual([mode, mode, mode])
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

  it('登録の画面: 「戻る」はルーターに渡し、書きかけの確かめで止めた時のルーターの戻し（go(1)）と続け（go(-1)）も渡す', async () => {
    const s = setup('#/day/2026-11-10', 'os-back')
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

  it('前が無いと分かる時（ホーム画面から開いた Android のアプリ）は、前へ戻って待たずに、すぐ「もう一度［戻る］で閉じる」所にする', async () => {
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

  it('土台で読み込み直した後に前が無い時（ホーム画面から開いた Android のアプリ）も、前へ戻ってから「もう一度［戻る］で閉じる」所にする', async () => {
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
