// 設定の画面（docs/SPEC.md の 18.1。段階0は「表示」と「同期」のログアウトだけ）: 別のページで右の列は出さず、ヘッダーの［MIM］は出す。
// ［‹ 戻る］・［MIM］からの行き来と、ログアウトでログインの画面へ戻ること
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { routes } from '../../App'
import { DEFAULT_PREFS, usePrefs } from '../../store/uiStore'
import { fakeSignInForTest, resetSyncForTests } from '../../sync/controller'
import { setTestWidth, TEST_WIDTHS } from '../../test/width'

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
