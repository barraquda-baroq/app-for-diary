// ログインの画面（docs/SPEC.md の 2.5・Q27）: ログインしていない間はこの画面だけを出す。表紙の見た目の中身（名前・今日の日付・
// ［Google でログイン］・左下の版）、Firebase の設定が仮の値の時の言葉、電波が無い時の言葉、iPhone の案内（Chrome を基準に、Safari でも）
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ placeholder: true, signIn: vi.fn(async () => {}) }))

vi.mock('../../sync/firebaseConfig', () => ({
  get firebaseConfigIsPlaceholder() {
    return mocks.placeholder
  },
  EMULATOR_PROJECT_ID: 'demo-diary-studio',
  firebaseConfig: {},
}))

vi.mock('../../sync/controller', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../sync/controller')>()),
  signIn: mocks.signIn,
}))

const { routes } = await import('../../App')
const { useSync } = await import('../../sync/controller')
const { homeScreenMessage, NOT_READY_MESSAGE, OFFLINE_MESSAGE } = await import('./LoginPage')

const IPHONE_CHROME_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/142.0.7444.77 Mobile/15E148 Safari/604.1'
const IPHONE_SAFARI_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
const IPHONE_FIREFOX_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/132.0 Mobile/15E148 Safari/605.1.15'

function setNavigator(key: 'userAgent' | 'onLine' | 'standalone', value: unknown) {
  Object.defineProperty(window.navigator, key, { value, configurable: true })
}

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(<RouterProvider router={router} />)
  return router
}

const originalUA = navigator.userAgent

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 10, 10, 9, 0))
  mocks.placeholder = true
  mocks.signIn.mockClear()
  useSync.setState({ auth: 'signedOut', user: null, busy: false, error: null })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  setNavigator('userAgent', originalUA)
  setNavigator('onLine', true)
  setNavigator('standalone', undefined)
})

describe('ログインの関所', () => {
  it('ログインしていなければ、どの行き先もログインの画面に置き換える（ヘッダーも［MIM］も出さない）', async () => {
    for (const path of ['/', '/mim', '/settings']) {
      const router = renderAt(path)
      expect(await screen.findByTestId('login-page')).toBeTruthy()
      expect(router.state.location.pathname).toBe('/login')
      expect(screen.queryByTestId('app-header')).toBeNull()
      expect(screen.queryByTestId('open-mim')).toBeNull()
      expect(screen.queryByTestId('top-page')).toBeNull()
      cleanup()
    }
  })

  it('ログインの状態を確かめている間は「読み込み中…」', () => {
    useSync.setState({ auth: 'checking' })
    renderAt('/')
    expect(screen.getByRole('status').textContent).toBe('読み込み中…')
  })

  it('ログインしたら、ログインの画面からトップへ', () => {
    useSync.setState({ auth: 'signedIn', user: { uid: 'u1', name: '', email: 'a@example.com' } })
    const router = renderAt('/login')
    expect(router.state.location.pathname).toBe('/')
    expect(screen.getByTestId('top-page')).toBeTruthy()
  })
})

describe('ログインの画面', () => {
  it('名前・今日の曜日と日付・［Google でログイン］・左下の版', () => {
    renderAt('/login')
    const page = screen.getByTestId('login-page')
    expect(within(page).getByRole('heading', { level: 1 }).textContent).toBe('Diary Studio')
    expect(screen.getByTestId('login-date').textContent).toBe('TUE · 2026.11.10')
    expect(screen.getByRole('button', { name: 'Google でログイン' })).toBeTruthy()
    expect(page.querySelector('.login-foot')?.textContent).toBe('DIARY STUDIOv0.1')
    expect(document.title).toBe('ログイン — Diary Studio')
  })

  it('Firebase の設定が仮の値の時は、ログインを始めずに「まだ公開の準備ができていません」と出す', async () => {
    const user = userEvent.setup()
    renderAt('/login')
    await user.click(screen.getByTestId('login-google'))
    expect(screen.getByRole('alert').textContent).toBe(NOT_READY_MESSAGE)
    expect(mocks.signIn).not.toHaveBeenCalled()
  })

  it('設定が本物の値になっていれば、ログインを始める（失敗の言葉は controller から出す）', async () => {
    mocks.placeholder = false
    const user = userEvent.setup()
    renderAt('/login')
    await user.click(screen.getByTestId('login-google'))
    expect(mocks.signIn).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('alert')).toBeNull()
    useSync.setState({ error: 'ログインできませんでした' })
    expect((await screen.findByRole('alert')).textContent).toBe('ログインできませんでした')
  })

  it('電波が無い時は「ネットにつながっていません…」と出し、Firebase を読み込めなかった言葉は出さない', () => {
    setNavigator('onLine', false)
    useSync.setState({ error: 'Failed to fetch dynamically imported module' })
    renderAt('/login')
    expect(screen.getByTestId('login-offline').textContent).toBe(OFFLINE_MESSAGE)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('PC・Android では、ホーム画面に追加の案内を出さない', () => {
    renderAt('/login')
    expect(screen.queryByTestId('login-home-notice')).toBeNull()
  })
})

describe('iPhone をホーム画面のアプリでなく開いた時（2.5・D44。Chrome を基準に）', () => {
  it('Chrome: ログインのボタンの上に案内と［追加の手順］、［このまま Chrome で使う］で案内を閉じる', async () => {
    setNavigator('userAgent', IPHONE_CHROME_UA)
    const user = userEvent.setup()
    renderAt('/login')
    const notice = screen.getByTestId('login-home-notice')
    expect(notice.textContent).toContain(homeScreenMessage('chrome'))
    expect(homeScreenMessage('chrome')).toBe(
      'ホーム画面に追加してから使ってください。Chrome のタブのままだと、ホーム画面のアプリとデータが別々になり、しばらく使わないとデータが消されることもあります。',
    )
    expect(notice.textContent).not.toContain('Safari')
    // 案内はログインのボタンより上
    expect(notice.compareDocumentPosition(screen.getByTestId('login-google')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    await user.click(screen.getByTestId('login-install-help'))
    const dialog = screen.getByRole('dialog', { name: 'ホーム画面に追加' })
    const guides = within(dialog)
      .getAllByRole('listitem')
      .filter((li) => li.dataset.testid?.startsWith('install-guide-'))
    expect(guides.map((g) => g.dataset.testid)).toEqual(['install-guide-ios', 'install-guide-android', 'install-guide-desktop'])
    expect(within(guides[0]).getByText('お使いの端末')).toBeTruthy()
    // iPhone の手順は Chrome を基準に、Safari も除かない
    expect(within(guides[0]).getByText('iPhone・iPad（Chrome または Safari）')).toBeTruthy()
    expect(guides[0].querySelector('ol li')?.textContent).toMatch(/^Chrome（または Safari）で開き、/)
    expect(dialog.textContent).not.toMatch(/Safari で開いて|Safari で開き/)
    await user.click(within(dialog).getByTestId('modal-close'))
    expect(screen.queryByRole('dialog')).toBeNull()

    const stay = screen.getByTestId('login-stay-browser')
    expect(stay.textContent).toBe('このまま Chrome で使う')
    await user.click(stay)
    expect(screen.queryByTestId('login-home-notice')).toBeNull()
    expect(screen.getByTestId('login-google')).toBeTruthy()
  })

  it('Safari で開いた時も同じ案内を、Safari の名前で出す', () => {
    setNavigator('userAgent', IPHONE_SAFARI_UA)
    renderAt('/login')
    expect(screen.getByTestId('login-home-notice').textContent).toContain(homeScreenMessage('safari'))
    expect(homeScreenMessage('safari')).toContain('Safari のタブのままだと、')
    expect(screen.getByTestId('login-stay-browser').textContent).toBe('このまま Safari で使う')
  })

  it('ほかのブラウザ（Firefox など）では「ブラウザ」と呼ぶ', () => {
    setNavigator('userAgent', IPHONE_FIREFOX_UA)
    renderAt('/login')
    expect(screen.getByTestId('login-home-notice').textContent).toContain(homeScreenMessage('other'))
    expect(homeScreenMessage('other')).toContain('ブラウザのタブのままだと、')
    expect(screen.getByTestId('login-stay-browser').textContent).toBe('このままブラウザで使う')
  })

  it('ホーム画面に追加したアプリで開いている時は出さない', () => {
    setNavigator('userAgent', IPHONE_CHROME_UA)
    setNavigator('standalone', true)
    renderAt('/login')
    expect(screen.queryByTestId('login-home-notice')).toBeNull()
  })
})
