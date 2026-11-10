// トップ画面の空の形（docs/SPEC.md の 3.2〜3.7）: ヘッダー、L の並べ方（カレンダーの領域と右の列）、S・M の積み方と切り替えの列、
// 右の列の3つのリストの見出し・畳む・入力欄、カレンダーの操作の列、MIM の仮の画面への切り替え
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { routes } from '../../App'
import { DEFAULT_PREFS, PREFS_KEY, usePrefs, useStackedLists, useToasts } from '../../store/uiStore'
import { useSync } from '../../sync/controller'
import { setTestWidth, TEST_WIDTHS } from '../../test/width'
import { ListPanel } from './ListPanel'

const saved = () => JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null') as { collapsed?: Record<string, unknown> } | null

function renderAt(path: string, width: number = TEST_WIDTHS.L) {
  setTestWidth(width)
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(<RouterProvider router={router} />)
  return router
}

beforeEach(() => {
  // 今日は 2026年11月10日（火）
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 10, 10, 9, 0))
  localStorage.clear()
  usePrefs.setState(DEFAULT_PREFS)
  useStackedLists.setState({ collapsed: { routine: true, task: true, favorite: true } })
  useToasts.setState({ toasts: [] })
  useSync.setState({
    auth: 'signedIn',
    user: { uid: 'u1', name: 'テスト', email: 'test@example.com' },
    busy: false,
    error: null,
    owner: 'ok',
    ownerSeen: true,
    accountMismatch: null,
  })
  Element.prototype.scrollIntoView = vi.fn()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('ヘッダー（3.3）', () => {
  it('左に DS のアイコンと名前、右に 設定の歯車 → いちばん右に［MIM］', () => {
    renderAt('/')
    const header = screen.getByTestId('app-header')
    const brand = within(header).getByTestId('brand')
    expect(brand.getAttribute('href')).toBe('/')
    expect(brand.textContent).toContain('Diary Studio')
    expect(brand.querySelector('img')?.getAttribute('src')).toBe('./icon.svg')
    const items = Array.from(header.children)
    expect(items.at(-1)).toBe(screen.getByTestId('open-mim'))
    expect(items.at(-2)).toBe(screen.getByTestId('open-settings'))
    expect(screen.getByTestId('open-settings').getAttribute('href')).toBe('/settings')
    expect(screen.getByTestId('open-mim').getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByTestId('open-mim').textContent).toBe('MIM')
  })

  it('［MIM］で MIM の仮の画面を開き（押した状態）、もう一度押すと閉じて前の画面へ戻る', async () => {
    const user = userEvent.setup()
    const router = renderAt('/')
    await user.click(screen.getByTestId('open-mim'))
    expect(router.state.location.pathname).toBe('/mim')
    expect(screen.getByTestId('open-mim').getAttribute('aria-pressed')).toBe('true')
    expect(within(screen.getByTestId('calendar-area')).getByTestId('mim-placeholder').textContent).toContain('段階4')
    // L は右の列がそのまま
    expect(screen.getByTestId('side-column')).toBeTruthy()
    await user.click(screen.getByTestId('open-mim'))
    expect(router.state.location.pathname).toBe('/')
    expect(screen.getByTestId('calendar')).toBeTruthy()
  })

  it('MIM の［‹ カレンダーに戻る］: カレンダーから開いた時は1つ前へ、直接開いた時はトップへ置き換える', async () => {
    const user = userEvent.setup()
    const router = renderAt('/')
    await user.click(screen.getByTestId('open-mim'))
    await user.click(screen.getByTestId('mim-back'))
    expect(router.state.location.pathname).toBe('/')
    expect(router.state.historyAction).toBe('POP')
    cleanup()

    const direct = renderAt('/mim')
    await user.click(screen.getByTestId('mim-back'))
    expect(direct.state.location.pathname).toBe('/')
    expect(direct.state.historyAction).toBe('REPLACE')
  })
})

describe('L の並べ方（3.4）', () => {
  it('左にカレンダーの領域、右の列に Routine → Task → Favorite。切り替えの列は出さない', () => {
    renderAt('/')
    expect(screen.getByTestId('top-page').getAttribute('data-width')).toBe('L')
    expect(screen.getByTestId('calendar-area')).toBeTruthy()
    const side = screen.getByTestId('side-column')
    const lists = Array.from(side.querySelectorAll('[data-list]')).map((el) => el.getAttribute('data-list'))
    expect(lists).toEqual(['routine', 'task', 'favorite'])
    expect(screen.queryByTestId('top-switcher')).toBeNull()
  })

  it('リストの見出し: 英語の名前・小さな日本語・まだ済んでいない数・山形。入力欄は開いている間いつも出す', () => {
    renderAt('/')
    const task = screen.getByTestId('list-task')
    expect(within(task).getByRole('heading', { level: 2 }).textContent).toBe('Task Listタスク')
    expect(within(task).getByTestId('list-task-count').textContent).toContain('0')
    expect(within(task).getByTestId('list-task-fold').getAttribute('aria-expanded')).toBe('true')
    expect(within(task).getByPlaceholderText('タスクを入れる…')).toBeTruthy()
    expect(screen.getByPlaceholderText('ルーチンを足す…')).toBeTruthy()
    expect(screen.getByPlaceholderText('気になったことを入れる…')).toBeTruthy()
  })

  it('畳む・開く（山形でも見出しでも）。L の畳んだ状態は端末ごとに覚える', async () => {
    const user = userEvent.setup()
    renderAt('/')
    await user.click(screen.getByTestId('list-task-fold'))
    const task = screen.getByTestId('list-task')
    expect(task.getAttribute('data-collapsed')).toBe('true')
    expect(screen.getByTestId('list-task-body').className).toContain('is-closed')
    expect(saved()?.collapsed).toMatchObject({ task: true, routine: false, favorite: false })
    // 見出しを押しても開く
    await user.click(within(task).getByText('Task List'))
    expect(task.getAttribute('data-collapsed')).toBe('false')
    expect(saved()?.collapsed).toMatchObject({ task: false })
  })

  it('Routine List の［すべて開く／畳む］は、畳む種類のかたまりが無い間（段階0）は出さない', () => {
    renderAt('/')
    expect(within(screen.getByTestId('list-routine')).getByRole('heading', { level: 2 })).toBeTruthy()
    expect(screen.queryByTestId('routine-toggle-all')).toBeNull()
  })

  it('Routine List の［すべて畳む］／［すべて開く］で種類ごとのかたまりを切り替える（見出しは畳まない）', async () => {
    const user = userEvent.setup()
    // 種類のかたまりがある時（段階3でルーチンの中身から数える）
    render(<ListPanel listKey="routine" stacked={false} groupCount={2} />)
    const toggle = screen.getByTestId('routine-toggle-all')
    expect(toggle.textContent).toBe('すべて畳む')
    await user.click(toggle)
    expect(Object.values(usePrefs.getState().collapsed.routineGroups)).toEqual([true, true, true, true, true])
    expect(screen.getByTestId('routine-toggle-all').textContent).toBe('すべて開く')
    expect(screen.getByTestId('list-routine').getAttribute('data-collapsed')).toBe('false')
    await user.click(screen.getByTestId('routine-toggle-all'))
    expect(Object.values(usePrefs.getState().collapsed.routineGroups)).toEqual([false, false, false, false, false])
  })

  it('入力欄で Enter を押すと、まだ作っていない（段階3）ことを知らせる', async () => {
    const user = userEvent.setup()
    renderAt('/')
    await user.type(screen.getByTestId('list-favorite-input'), 'あれを見る{Enter}')
    expect(useToasts.getState().toasts.map((t) => t.message)).toEqual(['Favorite List に足すのは段階3で作ります'])
  })
})

describe('カレンダーの操作の列（3.7）', () => {
  const numeral = () => screen.getByTestId('cal-numeral').textContent
  const period = () => screen.getByTestId('cal-period').textContent
  const hidden = (id: string) => screen.getByTestId(id).className.includes('cal-tool-hidden')

  it('初めは前回のモード（マンスリー）: 大きな数字 11、NOV・2026。［休み］［＋ 登録］［Task View］を出す', () => {
    renderAt('/')
    expect(numeral()).toBe('11')
    expect(period()).toContain('NOV')
    expect(period()).toContain('2026年11月')
    expect(screen.getByTestId('cal-mode-month').getAttribute('aria-pressed')).toBe('true')
    expect([hidden('cal-off'), hidden('cal-add'), hidden('cal-taskview')]).toEqual([false, false, false])
    expect(screen.getByTestId('calendar-month').getAttribute('data-rows')).toBe('5')
  })

  it('モードを替えると表記と出すボタンが替わる（無いボタンは消すが場所は残す）。最後のモードを覚える', async () => {
    const user = userEvent.setup()
    renderAt('/')
    await user.click(screen.getByTestId('cal-mode-year'))
    expect(numeral()).toBe('2026')
    expect(period()).toContain('YEAR')
    expect([hidden('cal-off'), hidden('cal-add'), hidden('cal-taskview')]).toEqual([true, true, false])
    await user.click(screen.getByTestId('cal-mode-week'))
    expect(numeral()).toBe('11')
    expect(period()).toContain('11.08–11.14')
    expect([hidden('cal-off'), hidden('cal-add'), hidden('cal-taskview')]).toEqual([true, false, true])
    await user.click(screen.getByTestId('cal-mode-day'))
    expect(numeral()).toBe('10')
    expect(period()).toContain('TUE')
    expect(period()).toContain('NOV 2026')
    expect(usePrefs.getState().lastMode).toBe('day')
    expect(screen.getByTestId('calendar-placeholder').textContent).toContain('段階2')
  })

  it('‹ › でそのモードの期間を移り、［今日］で今日を含む期間へ戻る', async () => {
    const user = userEvent.setup()
    renderAt('/')
    await user.click(screen.getByTestId('cal-next'))
    expect(numeral()).toBe('12')
    expect(period()).toContain('DEC')
    await user.click(screen.getByTestId('cal-prev'))
    await user.click(screen.getByTestId('cal-prev'))
    expect(numeral()).toBe('10')
    await user.click(screen.getByTestId('cal-today'))
    expect(numeral()).toBe('11')
    expect(screen.getByTestId('cal-prev').getAttribute('aria-label')).toBe('前の月')
  })

  it('［休み］［＋ 登録］［Task View］は、まだ作っていない段階を知らせる', async () => {
    const user = userEvent.setup()
    renderAt('/')
    await user.click(screen.getByTestId('cal-off'))
    await user.click(screen.getByTestId('cal-add'))
    await user.click(screen.getByTestId('cal-taskview'))
    expect(useToasts.getState().toasts.map((t) => t.message)).toEqual([
      '休みを付けるのは段階2で作ります',
      '予定の登録は段階2で作ります',
      'Task View は段階4で作ります',
    ])
  })

  it('今日の日付に印を付ける（マス目の仮の絵）', () => {
    renderAt('/')
    const marks = screen.getByTestId('calendar-month').querySelectorAll('.today-mark')
    expect(Array.from(marks).map((m) => m.textContent)).toEqual(['10'])
  })
})

describe('S・M の並べ方（3.5・3.6）', () => {
  it.each([
    ['S', TEST_WIDTHS.S],
    ['M', TEST_WIDTHS.M],
  ])('%s: 切り替えの列（カレンダー｜Routine｜Task｜Favorite）と、カレンダー → Routine → Task → Favorite の積み', (cls, width) => {
    renderAt('/', width)
    expect(screen.getByTestId('top-page').getAttribute('data-width')).toBe(cls)
    const names = Array.from(screen.getByTestId('top-switcher').querySelectorAll('button')).map(
      (b) => b.querySelector('.top-switcher-name')?.textContent,
    )
    expect(names).toEqual(['カレンダー', 'Routine', 'Task', 'Favorite'])
    const order = Array.from(screen.getByTestId('top-page').querySelectorAll('.top-pane')).map(
      (el) => el.getAttribute('data-list') ?? 'calendar',
    )
    expect(order).toEqual(['calendar', 'routine', 'task', 'favorite'])
    expect(screen.queryByTestId('side-column')).toBeNull()
  })

  it('3つのリストは畳んだ状態で始まる（L で開いていても）。開いた・畳んだは端末に覚えない', async () => {
    const user = userEvent.setup()
    renderAt('/', TEST_WIDTHS.S)
    for (const key of ['routine', 'task', 'favorite']) {
      expect(screen.getByTestId(`list-${key}`).getAttribute('data-collapsed')).toBe('true')
    }
    await user.click(screen.getByTestId('list-routine-fold'))
    expect(screen.getByTestId('list-routine').getAttribute('data-collapsed')).toBe('false')
    expect(useStackedLists.getState().collapsed.routine).toBe(false)
    // 端末に覚える L の状態（初めは開いている）は変えず、保存もしない
    expect(usePrefs.getState().collapsed.routine).toBe(false)
    expect(localStorage.getItem(PREFS_KEY)).toBeNull()
  })

  it('切り替えの列で畳んでいるリストを押すと、開いてからその先頭へスクロールし、押した物を表示中にする', async () => {
    const user = userEvent.setup()
    renderAt('/', TEST_WIDTHS.S)
    await user.click(screen.getByTestId('top-jump-task'))
    expect(screen.getByTestId('list-task').getAttribute('data-collapsed')).toBe('false')
    expect(screen.getByTestId('list-routine').getAttribute('data-collapsed')).toBe('true')
    expect(screen.getByTestId('top-jump-task').getAttribute('aria-current')).toBe('true')
    expect(screen.getByTestId('top-jump-calendar').getAttribute('aria-current')).toBeNull()
    await vi.waitFor(() => expect(Element.prototype.scrollIntoView).toHaveBeenCalled())
    expect(document.activeElement?.textContent).toBe('Task Listタスク')
  })

  it('S の MIM は全面（切り替えの列とリストを隠す）。M はカレンダーの区切りが MIM に替わり、リストと切り替えの列は残す', () => {
    renderAt('/mim', TEST_WIDTHS.S)
    expect(screen.getByTestId('mim-placeholder')).toBeTruthy()
    expect(screen.queryByTestId('top-switcher')).toBeNull()
    expect(screen.queryByTestId('list-task')).toBeNull()
    cleanup()

    renderAt('/mim', TEST_WIDTHS.M)
    expect(within(screen.getByTestId('calendar-area')).getByTestId('mim-placeholder')).toBeTruthy()
    expect(screen.getByTestId('top-switcher')).toBeTruthy()
    expect(screen.getByTestId('list-task')).toBeTruthy()
  })
})
