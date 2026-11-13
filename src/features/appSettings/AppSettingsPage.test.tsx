// 設定の画面（docs/SPEC.md の 18.1。段階0は「表示」と「同期」のログアウトだけ）: 別のページで右の列は出さず、ヘッダーの［MIM］は出す。
// ［‹ 戻る］・［MIM］からの行き来と、ログアウトでログインの画面へ戻ること。iPhone・iPad だけの「開発」（端からのフリックの記録。3.1）
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { routes } from '../../App'
import { setSwipeLogEnabled, swipeLog, swipeLogEnabled, swipeLogText } from '../../history/swipeLog'
import { DEFAULT_PREFS, usePrefs } from '../../store/uiStore'
import { fakeSignInForTest, resetSyncForTests } from '../../sync/controller'
import { setTestWidth, TEST_WIDTHS } from '../../test/width'
import * as device from '../../ui/device'

/** トップ #/ は前回のモード（初めはマンスリー）の今日を含む期間へ置き換わる（FRAME-001。このテストは時刻を決めない） */
const THIS_MONTH = /^\/month\/\d{4}-\d{2}$/

function renderAt(path: string) {
  setTestWidth(TEST_WIDTHS.L)
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(<RouterProvider router={router} />)
  return router
}

beforeEach(() => {
  localStorage.clear()
  usePrefs.setState(DEFAULT_PREFS)
  resetSyncForTests()
  fakeSignInForTest({ uid: 'u1', name: 'テスト', email: 'me@example.com' })
})

afterEach(() => {
  cleanup()
  resetSyncForTests()
  setSwipeLogEnabled(false)
  vi.restoreAllMocks()
})

describe('AppSettingsPage', () => {
  it('「表示」と「同期」を出す。右の列は出さず、ヘッダーの［MIM］は出す', async () => {
    renderAt('/settings')
    expect(await screen.findByTestId('app-settings')).toBeTruthy()
    expect(screen.getByTestId('display-settings')).toBeTruthy()
    expect(screen.getByTestId('sync-account').textContent).toBe('me@example.com')
    expect(screen.getByTestId('open-mim')).toBeTruthy()
    expect(screen.queryByTestId('side-column')).toBeNull()
    expect(document.title).toBe('設定 — Diary Studio')
  })

  it('［‹ 戻る］: 歯車から開いた時は1つ前（トップ）へ、直接開いた時はトップへ置き換える', async () => {
    const user = userEvent.setup()
    const router = renderAt('/')
    await user.click(screen.getByTestId('open-settings'))
    await user.click(await screen.findByTestId('settings-back'))
    expect(router.state.location.pathname).toMatch(THIS_MONTH)
    expect(router.state.historyAction).toBe('POP')
    cleanup()

    const direct = renderAt('/settings')
    await user.click(await screen.findByTestId('settings-back'))
    expect(direct.state.location.pathname).toMatch(THIS_MONTH)
    expect(direct.state.historyAction).toBe('REPLACE')
  })

  it('設定の画面で［MIM］を押すと、トップの画面に戻って MIM を開く。［‹ カレンダーに戻る］はトップへ', async () => {
    const user = userEvent.setup()
    const router = renderAt('/settings')
    await user.click(await screen.findByTestId('open-mim'))
    expect(router.state.location.pathname).toBe('/mim')
    expect(screen.getByTestId('mim-placeholder')).toBeTruthy()
    await user.click(screen.getByTestId('mim-back'))
    expect(router.state.location.pathname).toMatch(THIS_MONTH)
    expect(screen.getByTestId('calendar')).toBeTruthy()
  })

  it('［ログアウト］でログインの画面に戻る', async () => {
    const user = userEvent.setup()
    const router = renderAt('/settings')
    await user.click(await screen.findByTestId('sign-out'))
    expect(await screen.findByTestId('login-page')).toBeTruthy()
    expect(router.state.location.pathname).toBe('/login')
  })
})

describe('開発（iPhone・iPad だけ。端からのフリックの記録。3.1・18.1）', () => {
  const onIPhone = () => vi.spyOn(device, 'currentPopSource').mockReturnValue('edge-flick')

  it('iPhone・iPad だけ「開発」を出す（Android・PC には出さない）', async () => {
    renderAt('/settings')
    expect(await screen.findByTestId('app-settings')).toBeTruthy()
    expect(screen.queryByTestId('dev-settings')).toBeNull()
    cleanup()
    onIPhone()
    renderAt('/settings')
    const card = await screen.findByTestId('dev-settings')
    expect(card.querySelector('h2')?.textContent).toBe('開発')
    expect(card.textContent).toContain('端からのフリックの記録を取る')
    expect(screen.getByTestId('swipe-log-copy').textContent).toBe('記録をコピー')
    expect(screen.getByTestId('swipe-log-clear').textContent).toBe('記録を消す')
  })

  it('「端からのフリックの記録を取る」を入れると端末に覚えて控え始め（開き直しても入ったまま）、外すと控えた物も消す', async () => {
    onIPhone()
    const user = userEvent.setup()
    renderAt('/settings')
    const toggle = (await screen.findByTestId('swipe-log')) as HTMLInputElement
    expect(toggle.checked).toBe(false)
    await user.click(toggle)
    expect(toggle.checked).toBe(true)
    expect(swipeLogEnabled()).toBe(true)
    expect(localStorage.getItem('diary-studio:swipe-log')).toBe('1')
    swipeLog('pop', { idx: 2 })
    expect(swipeLogText()).toMatch(/ pop /)
    cleanup()
    renderAt('/settings')
    const again = (await screen.findByTestId('swipe-log')) as HTMLInputElement
    expect(again.checked).toBe(true)
    await user.click(again)
    expect(again.checked).toBe(false)
    expect(localStorage.getItem('diary-studio:swipe-log')).toBeNull()
    expect(swipeLogText()).toBe('')
  })

  it('［記録をコピー］で控えた物をクリップボードへ入れ、［記録を消す］で消す。コピーできない時は、字を選んでコピーできる欄に出す', async () => {
    onIPhone()
    const user = userEvent.setup()
    renderAt('/settings')
    await user.click(await screen.findByTestId('swipe-log'))
    swipeLog('guard')
    swipeLog('pop', { idx: 1, ua: true })
    await user.click(screen.getByTestId('swipe-log-copy'))
    expect(await navigator.clipboard.readText()).toBe(swipeLogText())
    expect(swipeLogText().split('\n')).toHaveLength(2)
    await waitFor(() => expect(screen.getByTestId('swipe-log-status').textContent).toBe('コピーしました（2件）'))
    expect(screen.queryByTestId('swipe-log-text')).toBeNull()
    // コピーできない（クリップボードを使えない）時
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('使えない'))
    await user.click(screen.getByTestId('swipe-log-copy'))
    const text = (await screen.findByTestId('swipe-log-text')) as HTMLTextAreaElement
    expect(text.value).toBe(swipeLogText())
    expect(text.readOnly).toBe(true)
    expect(screen.getByTestId('swipe-log-status').textContent).toBe('コピーできませんでした。下の字を選んでコピーしてください')
    // 消す
    await user.click(screen.getByTestId('swipe-log-clear'))
    expect(swipeLogText()).toBe('')
    expect(screen.queryByTestId('swipe-log-text')).toBeNull()
    expect(screen.getByTestId('swipe-log-status').textContent).toBe('消しました')
    // 控えた物が無い時のコピー
    await user.click(screen.getByTestId('swipe-log-copy'))
    expect(screen.getByTestId('swipe-log-status').textContent).toBe('記録はまだありません')
    act(() => setSwipeLogEnabled(false))
  })
})
