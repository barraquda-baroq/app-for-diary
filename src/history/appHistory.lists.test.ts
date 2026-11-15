// Android・PC のアプリの履歴（src/history/appHistory.ts の AppHistory。docs/SPEC.md の 3.1・■22・■25・■34）とリスト（段階3）:
// S・M のカレンダーで開いているリストを見ている時の OS の「戻る」は、閉じるかを聞かず・もう一度［戻る］で閉じる所にもせず、
// handlers.closeList でそのリストを畳む（履歴の形は「戻る」の前と同じ・ルーターには渡さない）。「進む」は何もしない。確かめの
// ダイアログ・掴んでいる間は片付けるだけ。リストの［詳しく］のパネル・［予定にする］の登録は1つずつ積み、「戻る」で閉じる（先に
// 開いている物を閉じ、その次の「戻る」でリストを畳む）。カレンダーでない画面（設定など）では listOpen を見ない。最後に、本物のトップの
// 画面（S の StackedTop）と本物の listOpenNow・closeShownList でも確かめる
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import type { Location } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screenOf } from '../features/calendar/common/calendarHistory'
import { draftKey } from '../features/lists/common/listInputModel'
import { listTestIds } from '../features/lists/common/testIds'
import { consumeBackPress } from '../features/top/closeApp'
import { closeShownList, listOpenNow } from '../features/top/listBack'
import { useStackedLists } from '../store/uiStore'
import { renderAt, setupCalendarTests } from '../test/renderCalendar'
import { FakeWindow } from '../test/fakeHistoryWindow'
import { AppHistory, createAppHistory, setHistoryHandler } from './appHistory'
import type { ExitStyle } from './popRules'

type Update = Parameters<Parameters<AppHistory['listen']>[0]>[0]

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
  register: { sheet: { kind: 'register', init: { start: '2026-11-10', title: 'x' }, from: 'favorite' }, sheetPage: 'p' },
} as const

interface Setup {
  win: FakeWindow
  h: AppHistory
  updates: Update[]
  askExit: ReturnType<typeof vi.fn>
  armExit: ReturnType<typeof vi.fn>
  closeList: ReturnType<typeof vi.fn>
  /** 開いているリストを見ているか（listOpen が返す物） */
  open: { value: boolean }
}

const disposers: (() => void)[] = []

function setup(hash = '#/month/2026-11', { exit }: { exit?: ExitStyle } = {}): Setup {
  const win = new FakeWindow(hash)
  const h = createAppHistory({ window: win, source: 'os-back', exit, armOnLeaveFail: false, screenOf }) as AppHistory
  const updates: Update[] = []
  const askExit = vi.fn()
  const armExit = vi.fn()
  const open = { value: false }
  // 本番（src/features/top/listBack.ts の closeShownList）と同じく、畳むと開いているリストは無くなる
  const closeList = vi.fn(() => {
    open.value = false
  })
  h.handlers = { askExit, armExit, listOpen: () => open.value, closeList }
  h.listen((u) => updates.push(u))
  disposers.push(() => h.dispose())
  return { win, h, updates, askExit, armExit, closeList, open }
}

async function settle(h: AppHistory) {
  await vi.runAllTimersAsync()
  await h.whenIdle()
}

/** 押して、土台と印の履歴を作らせる */
async function arm(s: Setup) {
  s.win.press()
  await settle(s.h)
}

/** 利用者の「戻る」（-1）・「進む」（1） */
async function userGo(s: Setup, delta: -1 | 1) {
  s.win.userGo(delta)
  await settle(s.h)
}

/** 履歴に積んだ・動かした物（置き換えは数えない） */
const moves = (s: Setup) => s.win.calls.filter((c) => c.op !== 'replaceState').length

/** 偽物のタイマーで流す（本物のトップの画面で確かめる所の外） */
function fakeTimers() {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    for (const d of disposers.splice(0)) d()
    vi.useRealTimers()
  })
}

describe('S3 Android・PC: 開いているリストを見ている時の OS の「戻る」（S3-FRAME-008・S3-FRAME-017）', () => {
  fakeTimers()

  it('「戻る」で closeList を1回だけ呼び、閉じるかを聞かない。土台へ戻し、ルーターには渡さず、履歴の形・数は「戻る」の前と同じ', async () => {
    const s = setup()
    await arm(s)
    s.open.value = true
    const before = s.win.describe()
    const length = s.win.history.length
    const shape = s.h.shape()
    await userGo(s, -1)
    expect(s.closeList).toHaveBeenCalledTimes(1)
    expect(s.askExit).not.toHaveBeenCalled()
    expect(s.updates).toEqual([])
    expect(s.win.describe()).toEqual(before)
    expect(s.win.describe()).toEqual(['[back]', '*/month/2026-11', '[fwd]'])
    expect(s.win.history.length).toBe(length)
    expect(s.h.shape()).toEqual(shape)
    // 畳んだ後の「戻る」は今までどおり閉じるかを聞く
    await userGo(s, -1)
    expect(s.closeList).toHaveBeenCalledTimes(1)
    expect(s.askExit).toHaveBeenCalledTimes(1)
  })

  it('ホーム画面の Android（press-again）でも、開いているリストを見ている時は、もう一度［戻る］で閉じる所にしない（■25 を構えない）。畳んだ後の「戻る」で構える', async () => {
    const s = setup('#/month/2026-11', { exit: 'press-again' })
    await arm(s)
    s.open.value = true
    await userGo(s, -1)
    expect(s.closeList).toHaveBeenCalledTimes(1)
    expect(s.armExit).not.toHaveBeenCalled()
    expect(s.h.shape()).toMatchObject({ exitArmed: false, cur: 1, shownIdx: 1 })
    await userGo(s, -1)
    expect(s.armExit).toHaveBeenCalledTimes(1)
    expect(s.closeList).toHaveBeenCalledTimes(1)
  })

  it('PC の「進む」は、開いているリストを見ていても何もしない（畳まない。S3-FRAME-009）', async () => {
    const s = setup()
    await arm(s)
    s.open.value = true
    await userGo(s, 1)
    expect(s.closeList).not.toHaveBeenCalled()
    expect(s.askExit).not.toHaveBeenCalled()
    expect(s.win.describe()).toEqual(['[back]', '*/month/2026-11', '[fwd]'])
  })

  it('確かめのダイアログが開いている・掴んでいる間（consumePop）は、片付けるだけで畳まない（S3-FRAME-014・015）', async () => {
    const s = setup()
    await arm(s)
    s.open.value = true
    let consumed = 0
    s.h.handlers.consumePop = () => {
      consumed += 1
      return true
    }
    await userGo(s, -1)
    expect(consumed).toBe(1)
    expect(s.closeList).not.toHaveBeenCalled()
    expect(s.askExit).not.toHaveBeenCalled()
    expect(s.win.describe()).toEqual(['[back]', '*/month/2026-11', '[fwd]'])
    delete s.h.handlers.consumePop
    await userGo(s, -1)
    expect(s.closeList).toHaveBeenCalledTimes(1)
  })

  it('開いているリストを見ていない時（L・カレンダーを見ている・畳んでいる）は、今までどおり閉じるかを聞く（S3-FRAME-010）', async () => {
    const s = setup()
    await arm(s)
    await userGo(s, -1)
    expect(s.closeList).not.toHaveBeenCalled()
    expect(s.askExit).toHaveBeenCalledTimes(1)
  })

  it('カレンダーでない画面（設定）では listOpen を見ず、1つ戻る', async () => {
    const s = setup()
    await arm(s)
    s.win.navigator.userActivation.isActive = true
    s.h.push(loc('/settings'))
    await settle(s.h)
    s.open.value = true
    const listOpen = vi.fn(() => true)
    s.h.handlers.listOpen = listOpen
    await userGo(s, -1)
    expect(listOpen).not.toHaveBeenCalled()
    expect(s.closeList).not.toHaveBeenCalled()
    expect(s.updates.map((u) => u.delta)).toEqual([-1])
  })
})

describe('S3 リストから開く画面（S3-FRAME-004・S3-TASK-150・S3-TASK-237・238）', () => {
  fakeTimers()

  it.each(Object.entries(LIST_SHEETS))(
    '%s: 開くと1つだけ積み、「戻る」で閉じる（ルーターに1つ戻ったと渡す）。開いているリストがあっても先に閉じ、次の「戻る」でリストを畳む',
    async (_name, state) => {
      const s = setup()
      await arm(s)
      s.open.value = true
      s.win.navigator.userActivation.isActive = true
      const length = s.win.history.length
      s.h.push(loc('/month/2026-11', state))
      await settle(s.h)
      expect(s.win.describe()).toEqual(['[back]', '/month/2026-11', `*/month/2026-11+${state.sheet.kind}`])
      expect(s.win.history.length).toBe(length)
      await userGo(s, -1)
      expect(s.updates.map((u) => u.delta)).toEqual([-1])
      expect(s.closeList).not.toHaveBeenCalled()
      expect(s.win.index).toBe(1)
      // 閉じた後のルーターの描画（印の無いカレンダー）
      await userGo(s, -1)
      expect(s.closeList).toHaveBeenCalledTimes(1)
      expect(s.askExit).not.toHaveBeenCalled()
      expect(s.win.index).toBe(1)
    },
  )

  it('PC の「進む」で、閉じたリストの［詳しく］を開き直さない（何もしない）', async () => {
    const s = setup()
    await arm(s)
    s.win.navigator.userActivation.isActive = true
    s.h.push(loc('/month/2026-11', LIST_SHEETS.routine))
    await settle(s.h)
    s.h.go(-1)
    await settle(s.h)
    const delivered = s.updates.length
    await userGo(s, 1)
    expect(s.updates.length).toBe(delivered)
    expect(s.win.index).toBe(1)
  })

  it('リストを開く・畳むのは履歴を動かさない（closeList の前後で積む・動かす物が増えるのは、「戻る」から土台へ戻す1つだけ）', async () => {
    const s = setup()
    await arm(s)
    s.open.value = true
    const before = moves(s)
    await userGo(s, -1)
    // 利用者の「戻る」で印の履歴へ移った所から、土台へ戻す go(1) だけ
    expect(s.win.calls.slice(-1)[0]).toMatchObject({ op: 'go', delta: 1 })
    expect(moves(s) - before).toBe(1)
    expect(s.closeList).toHaveBeenCalledTimes(1)
  })
})

// ---------- 本物のトップの画面（S の StackedTop）と本物の listOpenNow・closeShownList ----------
describe('S3 本物のトップの画面で（Pixel 7 の幅の S。■34）', () => {
  setupCalendarTests()

  const lists = () => useStackedLists.getState()

  afterEach(() => {
    for (const d of disposers.splice(0)) d()
  })

  /** src/App.tsx と同じく、作った履歴に askExit・listOpen・closeList を置いて S のトップを描き、押して印の履歴を作らせる */
  async function openTop(exit: ExitStyle = 'ask') {
    const win = new FakeWindow('#/month/2026-11')
    const history = createAppHistory({ window: win, source: 'os-back', exit, armOnLeaveFail: false, screenOf }) as AppHistory
    const askExit = vi.fn()
    const armExit = vi.fn()
    const offs = [
      setHistoryHandler('askExit', askExit),
      setHistoryHandler('armExit', armExit),
      setHistoryHandler('listOpen', listOpenNow),
      setHistoryHandler('closeList', closeShownList),
      setHistoryHandler('consumePop', consumeBackPress),
    ]
    const r = await renderAt('/month/2026-11', { width: 'S', history })
    disposers.push(() => {
      for (const off of offs) off()
      r.router.dispose()
      history.dispose()
    })
    win.press()
    await waitFor(() => expect(history.shape()).toMatchObject({ base: 1, busy: false }))
    return { ...r, win, history, askExit, armExit }
  }

  /** 利用者の「戻る」をして、落ち着くまで */
  async function back(win: FakeWindow, history: AppHistory) {
    win.userGo(-1)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20))
      await history.whenIdle()
    })
  }

  /** 切り替えの列で Task List を開いて先頭へ（見ている所が task になる） */
  async function openTask() {
    fireEvent.click(screen.getByTestId('top-jump-task'))
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(null)))
    })
    expect(lists().shown).toBe('task')
  }

  it('Task List を見ている時の「戻る」は Task List を畳み、打ちかけを捨てる（閉じるかを聞かない）。次の「戻る」で閉じるかを聞く。履歴の形は同じ', async () => {
    const { win, history, askExit } = await openTop()
    await openTask()
    fireEvent.change(screen.getByTestId(listTestIds.input('task')), { target: { value: '会議室の予約' } })
    const before = win.describe()
    await back(win, history)
    expect(lists().collapsed.task).toBe(true)
    expect(localStorage.getItem(draftKey('task'))).toBeNull()
    expect(askExit).not.toHaveBeenCalled()
    expect(win.describe()).toEqual(before)
    await back(win, history)
    expect(askExit).toHaveBeenCalledTimes(1)
    expect(win.describe()).toEqual(before)
  })

  it('リストのメニュー（［締め切り日］）を開いている時の「戻る」は、メニューだけを閉じ（consumePop）、Task List は開いたまま・打ちかけも残る（閉じるかを聞かない）。次の「戻る」で畳んで打ちかけを捨てる。履歴の形は同じ（3.1・■34。開発）', async () => {
    const { win, history, askExit } = await openTop()
    await openTask()
    fireEvent.change(screen.getByTestId(listTestIds.input('task')), { target: { value: '会議室の予約' } })
    fireEvent.click(screen.getByTestId(listTestIds.taskChip('due')))
    expect(screen.getByTestId('task-chip-due-menu')).toBeTruthy()
    const before = win.describe()
    await back(win, history)
    expect(screen.queryByTestId('task-chip-due-menu')).toBeNull()
    expect(lists().collapsed.task).toBe(false)
    expect((screen.getByTestId(listTestIds.input('task')) as HTMLTextAreaElement).value).toBe('会議室の予約')
    expect(askExit).not.toHaveBeenCalled()
    expect(win.describe()).toEqual(before)
    await back(win, history)
    expect(lists().collapsed.task).toBe(true)
    expect(localStorage.getItem(draftKey('task'))).toBeNull()
    expect(askExit).not.toHaveBeenCalled()
    expect(win.describe()).toEqual(before)
  })

  it('ホーム画面の Android（press-again）: Task List を見ている時の「戻る」は畳むだけで、もう一度［戻る］で閉じる所にしない。次の「戻る」で構える（■25）', async () => {
    const { win, history, armExit } = await openTop('press-again')
    await openTask()
    await back(win, history)
    expect(lists().collapsed.task).toBe(true)
    expect(armExit).not.toHaveBeenCalled()
    await back(win, history)
    expect(armExit).toHaveBeenCalledTimes(1)
  })
})
