// iPhone・iPad のアプリの履歴（src/history/singleEntryHistory.ts の SingleEntryHistory。docs/SPEC.md の 3.1・22. の ■31〜■34）と
// リスト（段階3）: S・M のカレンダーで開いているリストを見ている時は、左右どちらの端からのフリックでも handlers.closeList でそのリストを
// 畳み（記録の名前は list）、アプリの中の並びもブラウザの履歴も動かさない（書くのは置き換えだけ・履歴は1つのまま）。畳んだ後の
// フリックはモードを回す。リストの［詳しく］のパネル・［予定にする］の登録はアプリの中の並びにだけ積み、フリックで閉じる（登録は
// 書きかけを聞かずに捨てる。■27）。読み込み直した時は、開いていたパネルの下にカレンダーを置く。前の版が残した履歴への身振りでも
// 同じことを1回だけする。最後に、本物のトップの画面（S の StackedTop）と本物の listOpenNow・closeShownList でも確かめる
import { act, fireEvent, screen } from '@testing-library/react'
import type { Location } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screenOf } from '../features/calendar/common/calendarHistory'
import { sheetOf } from '../features/calendar/common/sheets'
import { draftKey } from '../features/lists/common/listInputModel'
import { listTestIds } from '../features/lists/common/testIds'
import { consumeBackPress } from '../features/top/closeApp'
import { closeShownList, listOpenNow } from '../features/top/listBack'
import { useStackedLists } from '../store/uiStore'
import { renderAt, setupCalendarTests } from '../test/renderCalendar'
import { FakeWindow } from '../test/fakeHistoryWindow'
import * as device from '../ui/device'
import { createAppHistory, setHistoryHandler, type HistoryHandlers } from './appHistory'
import { SingleEntryHistory } from './singleEntryHistory'
import { clearSwipeLog, setSwipeLogEnabled, swipeLogText } from './swipeLog'

type Update = Parameters<Parameters<SingleEntryHistory['listen']>[0]>[0]

let keySeq = 0
/** ルーターが渡す形の行き先 */
function loc(pathname: string, state: unknown = null): Location {
  return { pathname, search: '', hash: '', state, key: `k${++keySeq}` }
}

/** リストから開く印（src/features/calendar/common/sheets.ts の SheetState） */
const LIST_SHEETS = {
  task: { sheet: { kind: 'detail', id: 'list-t-1', from: 'task' }, sheetPage: 'p' },
  routine: { sheet: { kind: 'routine', id: 'list-r-1' }, sheetPage: 'p' },
  favorite: { sheet: { kind: 'favorite', id: 'list-f-1' }, sheetPage: 'p' },
} as const
const REGISTER = {
  sheet: { kind: 'register', init: { start: '2026-11-10', title: 'x' }, from: 'favorite' },
  sheetPage: 'p',
} as const

interface Setup {
  win: FakeWindow
  h: SingleEntryHistory
  updates: Update[]
  ring: ReturnType<typeof vi.fn>
  closeList: ReturnType<typeof vi.fn>
  flickDiscard: ReturnType<typeof vi.fn>
  /** 開いているリストを見ているか（listOpen が返す物） */
  open: { value: boolean }
}

const disposers: (() => void)[] = []

function setup(hash = '#/month/2026-11', { win, handlers = {} }: { win?: FakeWindow; handlers?: HistoryHandlers } = {}): Setup {
  const w = win ?? new FakeWindow(hash, { swipes: true })
  const h = new SingleEntryHistory({
    window: w,
    source: 'edge-flick',
    armOnLeaveFail: false,
    screenOf,
    isLoginPath: (p) => p === '/login',
    now: () => Date.now(),
  })
  const updates: Update[] = []
  const open = { value: false }
  const ring = vi.fn()
  const flickDiscard = vi.fn()
  // 本番（src/features/top/listBack.ts の closeShownList）と同じく、畳むと開いているリストは無くなる
  const closeList = vi.fn(() => {
    open.value = false
  })
  h.handlers = { ring, flickDiscard, listOpen: () => open.value, closeList, ...handlers }
  h.listen((u) => {
    updates.push(u)
    setTimeout(() => h.drawn(u.location.key), 0)
  })
  disposers.push(() => h.dispose())
  return { win: w, h, updates, ring, closeList, flickDiscard, open }
}

async function settle(s: Setup) {
  await vi.runAllTimersAsync()
  await s.h.whenIdle()
}

/** ブラウザの履歴が1つのままで、書いたのは置き換えだけ */
function expectSingle(s: Setup) {
  expect(s.win.entries).toHaveLength(1)
  expect(s.win.history.length).toBe(1)
  expect(s.win.calls.filter((c) => c.op !== 'replaceState')).toEqual([])
}

describe('S3 iPhone・iPad: 開いているリストを見ている時の端からのフリック（S3-FRAME-005・007・010・028）', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    for (const d of disposers.splice(0)) d()
    vi.useRealTimers()
    setSwipeLogEnabled(false)
    localStorage.clear()
  })

  it('左右どちらのフリックでも closeList を1回呼び、モードを回さない。アプリの中の並び・行き先・ブラウザの履歴は動かさず、ルーターにも渡さない', async () => {
    for (const side of [-1, 1] as const) {
      const s = setup()
      s.open.value = true
      const key = s.h.location.key
      const before = s.h.shape()
      s.h.flick(side)
      expect(s.closeList).toHaveBeenCalledTimes(1)
      expect(s.ring).not.toHaveBeenCalled()
      await settle(s)
      expect(s.updates).toEqual([])
      expect(s.h.location.key).toBe(key)
      expect(s.h.shape()).toEqual(before)
      expectSingle(s)
    }
  })

  it('畳んだ後のフリックは今までどおりモードを回す。開いているリストを見ていない時（L・カレンダーを見ている・畳んでいる）は closeList を呼ばない', async () => {
    const s = setup()
    s.open.value = true
    s.h.flick(-1)
    s.h.flick(-1)
    expect(s.closeList).toHaveBeenCalledTimes(1)
    expect(s.ring.mock.calls).toEqual([[1]])
    const t = setup()
    t.h.flick(1)
    expect(t.closeList).not.toHaveBeenCalled()
    expect(t.ring.mock.calls).toEqual([[-1]])
  })

  it('記録を取っている時は、払い（flick）のしたことに list と控える（リストの中身は控えない。S3-FRAME-028）', () => {
    setSwipeLogEnabled(true)
    clearSwipeLog()
    const s = setup()
    s.open.value = true
    s.h.flick(-1)
    expect(swipeLogText()).toMatch(/ flick \{"side":-1,"screen":"calendar","action":"list"\}/)
  })

  it('確かめのダイアログはそれだけを閉じ（畳まない）、ドラッグの途中は何もしない。ログインの画面は何もしない（S3-FRAME-014・025）', async () => {
    const consumePop = vi.fn(() => true)
    const s = setup('#/month/2026-11', { handlers: { consumePop } })
    s.open.value = true
    s.h.flick(-1)
    expect(consumePop).toHaveBeenCalledTimes(1)
    expect(s.closeList).not.toHaveBeenCalled()
    const d = setup('#/month/2026-11', { handlers: { dragging: () => true } })
    d.open.value = true
    d.h.flick(1)
    expect(d.closeList).not.toHaveBeenCalled()
    const login = setup('#/login')
    login.open.value = true
    login.h.flick(-1)
    expect(login.closeList).not.toHaveBeenCalled()
    await settle(login)
    expectSingle(login)
  })

  it('カレンダーでない画面（設定・MIM）では listOpen を見ず、1つ戻る（M の MIM の下に開いたリストがあっても、MIM からカレンダーへ）', async () => {
    for (const [path, state] of [
      ['/settings', null],
      ['/mim', { mimFromCalendar: true }],
    ] as const) {
      const listOpen = vi.fn(() => true)
      const s = setup('#/month/2026-11', { handlers: { listOpen } })
      s.h.push(loc(path, state))
      s.h.flick(-1)
      await settle(s)
      expect(listOpen).not.toHaveBeenCalled()
      expect(s.closeList).not.toHaveBeenCalled()
      expect(s.updates.map((u) => [u.location.pathname, u.delta])).toEqual([['/month/2026-11', -1]])
      expectSingle(s)
    }
  })

  it.each(Object.entries(LIST_SHEETS))(
    'リストの［詳しく］（%s）: アプリの中の並びにだけ積み（ブラウザの履歴は1つのまま）、左右どちらのフリックでも閉じる。開いているリストは、その次のフリックで畳む（S3-FRAME-013・S3-TASK-150）',
    async (_name, state) => {
      for (const side of [-1, 1] as const) {
        const s = setup()
        s.open.value = true
        s.h.push(loc('/month/2026-11', state))
        expect(s.h.shape()).toMatchObject({ depth: 2, index: 1 })
        expect(screenOf(s.h.location)).toBe('detail')
        s.h.flick(side)
        await settle(s)
        expect(s.updates.map((u) => [u.location.pathname, sheetOf(u.location.state), u.delta])).toEqual([
          ['/month/2026-11', null, -1],
        ])
        expect(s.closeList).not.toHaveBeenCalled()
        s.h.flick(side)
        expect(s.closeList).toHaveBeenCalledTimes(1)
        await settle(s)
        expect(s.updates).toHaveLength(1)
        expectSingle(s)
      }
    },
  )

  it('Favorite List の［予定にする］の登録の画面: フリックで書きかけを聞かずに捨てて閉じる（flickDiscard。■27。S3-FRAME-011・S3-TASK-239）', async () => {
    for (const side of [-1, 1] as const) {
      const s = setup()
      s.open.value = true
      s.h.push(loc('/month/2026-11', REGISTER))
      expect(screenOf(s.h.location)).toBe('register')
      s.h.flick(side)
      expect(s.flickDiscard).toHaveBeenCalledTimes(1)
      await settle(s)
      expect(s.updates.map((u) => u.delta)).toEqual([-1])
      expect(s.closeList).not.toHaveBeenCalled()
      expectSingle(s)
    }
  })

  it('読み込み直した時（裏で捨てられて開き直した時も）: 開いていたパネルの下にカレンダーを置き、フリックで閉じるとカレンダーへ戻る（S3-FRAME-019・020）', async () => {
    const s = setup('#/day/2026-11-12')
    s.h.push(loc('/day/2026-11-12', LIST_SHEETS.routine))
    s.h.dispose()
    const r = setup('', { win: s.win })
    expect(screenOf(r.h.location)).toBe('detail')
    expect(r.h.shape()).toMatchObject({ depth: 2, index: 1 })
    r.h.flick(1)
    await settle(r)
    expect(r.updates.map((u) => [u.location.pathname, u.location.state])).toEqual([['/day/2026-11-12', null]])
    expect(r.closeList).not.toHaveBeenCalled()
    expectSingle(r)
  })

  it('前の版が残した履歴への身振り（popstate）でも、開いているリストを見ていれば1回だけ畳む（同じ払いのフリックは数えない）', async () => {
    const win = new FakeWindow('#/week/2026-11-08', { swipes: true })
    win.seed(
      [
        { hash: '#/week/2026-11-08', state: { usr: null, key: 'a', idx: 0, ds: { base: 1, mark: 'back' } } },
        { hash: '#/week/2026-11-08', state: { usr: null, key: 'b', idx: 1, ds: { base: 1 } } },
        { hash: '#/week/2026-11-08', state: { usr: null, key: 'c', idx: 2, ds: { base: 1, mark: 'fwd' } } },
      ],
      1,
    )
    const s = setup('', { win })
    s.open.value = true
    expect(s.win.userGo(-1)).toBe('started')
    await vi.advanceTimersByTimeAsync(10)
    expect(s.closeList).toHaveBeenCalledTimes(1)
    s.h.flick(-1)
    expect(s.closeList).toHaveBeenCalledTimes(1)
    expect(s.ring).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1000)
    await s.h.whenIdle()
    expect(s.updates).toEqual([])
    expect(s.win.calls.filter((c) => c.op !== 'replaceState')).toEqual([])
  })
})

// ---------- 本物のトップの画面（S の StackedTop）と本物の listOpenNow・closeShownList ----------
describe('S3 本物のトップの画面で（S の積んだ所。■34）', () => {
  setupCalendarTests()

  const lists = () => useStackedLists.getState()

  afterEach(() => {
    for (const d of disposers.splice(0)) d()
  })

  /** src/App.tsx と同じく、作った履歴に listOpen・closeList・consumePop を置いて S のトップを描く（端末は iPhone・iPad） */
  async function openTop(path = '/month/2026-11') {
    const source = vi.spyOn(device, 'currentPopSource').mockReturnValue('edge-flick')
    disposers.push(() => source.mockRestore())
    const win = new FakeWindow(`#${path}`, { swipes: true })
    const history = createAppHistory({ window: win, source: 'edge-flick', armOnLeaveFail: false, screenOf }) as SingleEntryHistory
    const offs = [
      setHistoryHandler('listOpen', listOpenNow),
      setHistoryHandler('closeList', closeShownList),
      setHistoryHandler('consumePop', consumeBackPress),
    ]
    const r = await renderAt(path, { width: 'S', history })
    disposers.push(() => {
      for (const off of offs) off()
      r.router.dispose()
      history.dispose()
    })
    return { ...r, win, history }
  }

  /** 切り替えの列で Task List を開いて先頭へ（見ている所が task になる） */
  async function openTask() {
    fireEvent.click(screen.getByTestId('top-jump-task'))
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(null)))
    })
    expect(lists().collapsed.task).toBe(false)
    expect(lists().shown).toBe('task')
  }

  it('Task List を見ている時の左の端からのフリックは、Task List を畳み、入力欄の打ちかけと端末の書きかけを捨てる（モードは回さない）。ブラウザの履歴は1つのまま', async () => {
    const { router, win, history } = await openTop()
    await openTask()
    expect(listOpenNow()).toBe(true)
    const input = screen.getByTestId(listTestIds.input('task')) as HTMLTextAreaElement
    fireEvent.change(input, { target: { value: '見積もりの返事' } })
    // フォーカスはリストの中の［足す］（打っている欄にフォーカスがある時のフリックは入力をやめるだけ。■36。src/features/top/typingCancel.test.tsx）
    screen.getByTestId(listTestIds.add('task')).focus()
    act(() => history.flick(-1))
    expect(lists().collapsed.task).toBe(true)
    expect(listOpenNow()).toBe(false)
    expect(localStorage.getItem(draftKey('task'))).toBeNull()
    expect(document.activeElement).toBe(screen.getByTestId(listTestIds.fold('task')))
    expect(router.state.location.pathname).toBe('/month/2026-11')
    // 開き直しても空
    fireEvent.click(screen.getByTestId(listTestIds.fold('task')))
    expect((screen.getByTestId(listTestIds.input('task')) as HTMLTextAreaElement).value).toBe('')
    expect(win.entries).toHaveLength(1)
    expect(win.calls.filter((c) => c.op !== 'replaceState')).toEqual([])
  })

  it('［締め切り日］のメニューを開いている時、メニューの外（画面の端）から押して払うと、押した時にメニューが閉じても、そのフリックはメニューを閉じただけで使い切る（畳まない・打ちかけも残る・記録は dialog）。次のフリックで畳む（3.1・■34。開発）', async () => {
    const { history, win } = await openTop()
    await openTask()
    const input = screen.getByTestId(listTestIds.input('task')) as HTMLTextAreaElement
    fireEvent.change(input, { target: { value: '見積もりの返事' } })
    fireEvent.click(screen.getByTestId(listTestIds.taskChip('due')))
    expect(screen.getByTestId('task-chip-due-menu')).toBeTruthy()
    setSwipeLogEnabled(true)
    clearSwipeLog()
    // 端で押す: メニューの外を押したので、払い終える前にメニューは閉じる
    act(() => {
      document.body.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', clientX: 3, clientY: 400 }),
      )
    })
    expect(screen.queryByTestId('task-chip-due-menu')).toBeNull()
    act(() => history.flick(-1))
    act(() => {
      document.body.dispatchEvent(new Event('touchend', { bubbles: true }))
    })
    const log = swipeLogText()
    setSwipeLogEnabled(false)
    expect(lists().collapsed.task).toBe(false)
    expect(input.value).toBe('見積もりの返事')
    expect(log).toContain('dialog')
    // 次に押して払うフリックは畳む（メニューはもう無い）
    act(() => {
      document.body.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', clientX: 3, clientY: 400 }),
      )
    })
    act(() => history.flick(-1))
    act(() => {
      document.body.dispatchEvent(new Event('touchend', { bubbles: true }))
    })
    expect(lists().collapsed.task).toBe(true)
    expect(localStorage.getItem(draftKey('task'))).toBeNull()
    expect(win.entries).toHaveLength(1)
    expect(win.calls.filter((c) => c.op !== 'replaceState')).toEqual([])
  })

  it('カレンダーを見ている時のフリックはモードを回し、リストは畳まない（打ちかけも残る）', async () => {
    const { router, history } = await openTop()
    await openTask()
    const input = screen.getByTestId(listTestIds.input('task')) as HTMLTextAreaElement
    fireEvent.change(input, { target: { value: '残す字' } })
    // 見ている所をカレンダーへ（切り替えの列で飛ぶ）
    fireEvent.click(screen.getByTestId('top-jump-calendar'))
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(null)))
    })
    expect(lists().shown).toBe('calendar')
    expect(listOpenNow()).toBe(false)
    await act(async () => history.flick(-1))
    expect(router.state.location.pathname).toBe('/week/2026-11-08')
    expect(lists().collapsed.task).toBe(false)
    expect((screen.getByTestId(listTestIds.input('task')) as HTMLTextAreaElement).value).toBe('残す字')
  })
})
