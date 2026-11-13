// アプリの外枠（AppFrame）の新しい版の帯（docs/SPEC.md の 2.8）: 新しい版を受け取った時だけ「新しい版があります ［更新する］」を出し、
// 押すと入力中の下書きを保存してから新しい版に切り替える（保存は帯の1か所だけ。src/main.tsx の apply は切り替えるだけ）。
// 段階2: 左のアイコンと名前の行き先（積むか置き換えるか。D05）、カレンダーの4つのモードから開いた MIM の戻り先（FRAME-007）、
// カレンダーの中の置き換えでスクロールを戻さないこと（D54）、iPhone のキーボードの高さ --kb、
// お知らせのボタンは指を離した時に効く（3.9。iPhone で、ドラッグの後の［元に戻す］が効かなかった時の手当て。iPhone が click を
// 作らなかった見込み）
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { markDraftClean, markDraftDirty } from '../store/draftRegistry'
import {
  DEFAULT_PREFS,
  initialCalendarUi,
  notify,
  notifyUntilOk,
  useAppUpdate,
  useCalendarUi,
  usePrefs,
  useToasts,
} from '../store/uiStore'
import { AppFrame, AppHeader, brandReplaces, scrollsToTop, useMim } from './Layout'

function renderFrame() {
  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: (
          <AppFrame>
            <p>中身</p>
          </AppFrame>
        ),
      },
    ],
    { initialEntries: ['/'] },
  )
  render(<RouterProvider router={router} />)
}

const draftKey = Symbol('下書き')

beforeEach(() => {
  useAppUpdate.setState({ ready: false, apply: null })
})

afterEach(() => {
  cleanup()
  markDraftClean(draftKey)
  useAppUpdate.setState({ ready: false, apply: null })
})

describe('新しい版の帯（2.8）', () => {
  it('新しい版を受け取るまでは出さない', () => {
    renderFrame()
    expect(screen.queryByTestId('update-banner')).toBeNull()
    expect(screen.getByText('中身')).toBeTruthy()
  })

  it('受け取ったら「新しい版があります」と［更新する］を、中身より上に出す', () => {
    useAppUpdate.setState({ ready: true, apply: vi.fn(async () => {}) })
    renderFrame()
    const banner = screen.getByTestId('update-banner')
    expect(banner.textContent).toContain('新しい版があります')
    expect(banner.getAttribute('role')).toBe('status')
    expect(screen.getByRole('button', { name: '更新する' })).toBe(screen.getByTestId('app-update'))
    // 帯は .app の直下で中身の前（トップの L の高さの決まり .app:has(> .banner) が効く形）
    expect(banner.parentElement?.className).toBe('app')
    expect(banner.compareDocumentPosition(screen.getByText('中身')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('［更新する］を押すと、入力中の下書きを保存してから新しい版に切り替える（保存は1回だけ）', async () => {
    const order: string[] = []
    const flush = vi.fn(() => order.push('下書きを保存'))
    markDraftDirty(draftKey, flush)
    const apply = vi.fn(async () => {
      order.push('切り替え')
    })
    useAppUpdate.setState({ ready: true, apply })
    renderFrame()
    await userEvent.setup().click(screen.getByTestId('app-update'))
    expect(order).toEqual(['下書きを保存', '切り替え'])
    expect(flush).toHaveBeenCalledTimes(1)
    expect(apply).toHaveBeenCalledTimes(1)
  })

  it('apply が無い時（受け取った知らせが壊れている時）は出さない', () => {
    useAppUpdate.setState({ ready: true, apply: null })
    renderFrame()
    expect(screen.queryByTestId('update-banner')).toBeNull()
  })
})

describe('左のアイコンと名前（3.3・FRAME-029・D05）', () => {
  function renderHeaderAt(path: string) {
    const page = (
      <AppFrame>
        <AppHeader />
      </AppFrame>
    )
    const router = createMemoryRouter(
      [
        { path: '/', element: page },
        { path: '/month/:ym', element: page },
        { path: '/week/:ymd', element: page },
        { path: '/mim', element: page },
        { path: '/settings', element: page },
      ],
      { initialEntries: ['/settings', path], initialIndex: 1 },
    )
    render(<RouterProvider router={router} />)
    return router
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 10, 10, 9, 0))
    usePrefs.setState(DEFAULT_PREFS)
    useCalendarUi.setState({ ...initialCalendarUi(), viewed: '2026-12-15' })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('カレンダー（トップを含む。どのモードでも）では置き換え、ほかの画面からは積む行き来にする（カレンダーの中の行き来は積まない。3.1）', () => {
    expect(brandReplaces('/')).toBe(true)
    expect(brandReplaces('/month/2026-12')).toBe(true)
    expect(brandReplaces('/week/2026-11-08')).toBe(true)
    expect(brandReplaces('/settings')).toBe(false)
    expect(brandReplaces('/mim')).toBe(false)
  })

  it.each([
    ['/month/2026-12', 'REPLACE'],
    ['/', 'REPLACE'],
    ['/settings', 'PUSH'],
    ['/mim', 'PUSH'],
    ['/week/2026-11-08', 'REPLACE'],
  ])('%s から押すと、トップ（#/）へ %s し、見ている日を今日にする', async (from, action) => {
    const router = renderHeaderAt(from)
    const brand = screen.getByTestId('brand')
    expect(brand.getAttribute('href')).toBe('/')
    await userEvent.setup().click(brand)
    expect(router.state.location.pathname).toBe('/')
    expect(router.state.historyAction).toBe(action)
    expect(useCalendarUi.getState().viewed).toBe('2026-11-10')
  })
})

describe('カレンダーの4つのモードから開いた MIM（3.1・FRAME-007）', () => {
  /** MIM の上の列の［‹ カレンダーに戻る］（src/features/top/MimPlaceholder.tsx と同じ呼び方） */
  function MimBack() {
    const { backToCalendar } = useMim()
    return (
      <button type="button" onClick={backToCalendar} data-testid="mim-back">
        ‹ カレンダーに戻る
      </button>
    )
  }

  function renderMimAt(path: string) {
    const page = (
      <AppFrame>
        <AppHeader />
        <MimBack />
      </AppFrame>
    )
    const router = createMemoryRouter([{ path: '*', element: page }], { initialEntries: ['/settings', path], initialIndex: 1 })
    render(<RouterProvider router={router} />)
    return router
  }

  it.each(['/', '/year/2026', '/month/2026-11', '/week/2026-11-08', '/day/2026-11-10'])(
    '%s から［MIM］を開くと、［‹ カレンダーに戻る］で1つ前（開いたモードの画面）へ戻る',
    async (path) => {
      const router = renderMimAt(path)
      const user = userEvent.setup()
      await user.click(screen.getByTestId('open-mim'))
      expect(router.state.location.pathname).toBe('/mim')
      await user.click(screen.getByTestId('mim-back'))
      expect(router.state.location.pathname).toBe(path)
      expect(router.state.historyAction).toBe('POP')
    },
  )

  it('カレンダーでない画面（設定・行き先の無い #/month）から開いた時は、トップ（#/）へ置き換える', async () => {
    for (const path of ['/settings', '/month']) {
      const router = renderMimAt(path)
      const user = userEvent.setup()
      await user.click(screen.getByTestId('open-mim'))
      await user.click(screen.getByTestId('mim-back'))
      expect(router.state.location.pathname).toBe('/')
      expect(router.state.historyAction).toBe('REPLACE')
      cleanup()
    }
  })
})

describe('画面が変わった時のスクロール（D54）', () => {
  it('積む・ほかの画面への置き換え・モードを替える置き換えは先頭へ。戻る／進むと、同じモードの中の置き換えはそのまま', () => {
    expect(scrollsToTop('PUSH', '/month/2026-11', '/week/2026-11-08')).toBe(true)
    // モードの切り替え（積まずに置き換える。3.1）
    expect(scrollsToTop('REPLACE', '/month/2026-11', '/week/2026-11-08')).toBe(true)
    expect(scrollsToTop('REPLACE', '/day/2026-11-10', '/year/2026')).toBe(true)
    expect(scrollsToTop('PUSH', '/', '/settings')).toBe(true)
    expect(scrollsToTop('REPLACE', '/login', '/')).toBe(true)
    expect(scrollsToTop('REPLACE', '/month/2026-11', '/settings')).toBe(true)
    expect(scrollsToTop('POP', '/settings', '/month/2026-11')).toBe(false)
    // ‹ ›・［今日］・スワイプ・6時間で今日へ（置き換え）・トップから前回のモードへの置き換え
    expect(scrollsToTop('REPLACE', '/month/2026-11', '/month/2026-12')).toBe(false)
    expect(scrollsToTop('REPLACE', '/day/2026-11-10', '/day/2026-11-11')).toBe(false)
    expect(scrollsToTop('REPLACE', '/', '/month/2026-11')).toBe(false)
  })

  it('外枠は、パスが変わった時だけ決まりに沿ってスクロールする（同じパスに state を積んでも動かさない）', async () => {
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    const page = <AppFrame>中身</AppFrame>
    const router = createMemoryRouter(
      [
        { path: '/month/:ym', element: page },
        { path: '/week/:ymd', element: page },
        { path: '/settings', element: page },
      ],
      { initialEntries: ['/month/2026-11'] },
    )
    render(<RouterProvider router={router} />)
    expect(scrollTo).not.toHaveBeenCalled()
    await act(() => router.navigate('/month/2026-12', { replace: true }))
    expect(scrollTo).not.toHaveBeenCalled()
    await act(() => router.navigate('/month/2026-12', { state: { sheet: { kind: 'detail', id: 'a' } } }))
    expect(scrollTo).not.toHaveBeenCalled()
    await act(() => router.navigate('/week/2026-11-29'))
    expect(scrollTo).toHaveBeenCalledTimes(1)
    await act(() => router.navigate('/settings'))
    expect(scrollTo).toHaveBeenCalledTimes(2)
    await act(() => router.navigate(-1))
    expect(scrollTo).toHaveBeenCalledTimes(2)
    scrollTo.mockRestore()
  })
})

describe('iPhone のキーボードの高さ（2.7・FRAME-086）', () => {
  it('外枠を出している間は <html> の --kb に入れ、外すと消す', () => {
    const router = createMemoryRouter([{ path: '/', element: <AppFrame>中身</AppFrame> }], { initialEntries: ['/'] })
    const { unmount } = render(<RouterProvider router={router} />)
    // jsdom には visualViewport が無いので 0
    expect(document.documentElement.style.getPropertyValue('--kb')).toBe('0px')
    unmount()
    expect(document.documentElement.style.getPropertyValue('--kb')).toBe('')
  })
})

describe('お知らせのボタン（3.9）', () => {
  afterEach(() => useToasts.setState({ toasts: [] }))

  /** 指で押して離す（jsdom の TouchEvent は Touch を作れないので、ふつうの Event に指の一覧を載せる）。touchend を止めたら false */
  function fingerTap(el: Element): boolean {
    const finger = { identifier: 1, clientX: 10, clientY: 10 }
    const send = (type: string, touches: (typeof finger)[]) => {
      const e = new Event(type, { bubbles: true, cancelable: true })
      Object.assign(e, { touches, targetTouches: touches, changedTouches: [finger] })
      return el.dispatchEvent(e)
    }
    send('touchstart', [finger])
    return send('touchend', [])
  }

  it('［元に戻す］は指を離した時に、click を待たずに1回だけ効いて消える（後から click が来ても2回は戻さない）', () => {
    const run = vi.fn()
    renderFrame()
    act(() => notify('11/9（月）へ移しました', { label: '元に戻す', run }))
    const toast = screen.getByText('11/9（月）へ移しました').closest('.toast') as HTMLElement
    const undo = within(toast).getByRole('button', { name: '元に戻す' })
    let prevented = false
    act(() => {
      prevented = !fingerTap(undo)
    })
    // touchend を止めて、ブラウザに click を作らせない（消えたお知らせの下の物を押さないように）
    expect(prevented).toBe(true)
    expect(run).toHaveBeenCalledTimes(1)
    expect(useToasts.getState().toasts).toEqual([])
    expect(screen.queryByText('11/9（月）へ移しました')).toBeNull()
    act(() => {
      fireEvent.click(undo)
    })
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('［×］も指を離した時に消える。マウス・キーボードの click でもこれまでどおり効く', () => {
    const run = vi.fn()
    renderFrame()
    act(() => notify('ひとつめ', { label: '元に戻す', run }))
    act(() => {
      fingerTap(within(screen.getByText('ひとつめ').closest('.toast') as HTMLElement).getByRole('button', { name: '閉じる' }))
    })
    expect(useToasts.getState().toasts).toEqual([])
    expect(run).not.toHaveBeenCalled()
    act(() => notify('ふたつめ', { label: '元に戻す', run }))
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: '元に戻す' }))
    })
    expect(run).toHaveBeenCalledTimes(1)
    expect(useToasts.getState().toasts).toEqual([])
  })

  it('［OK］まで出すお知らせ（■26）: ［×］の代わりに［OK］のボタン（キーボードで届く本物のボタン）。押すと消える。フォーカスは動かさない', () => {
    renderFrame()
    const field = document.createElement('input')
    document.body.append(field)
    field.focus()
    act(() => void notifyUntilOk('元に戻しました：11/11（水）を休みにした', { slot: 'undo' }))
    const toast = screen.getByText('元に戻しました：11/11（水）を休みにした').closest('.toast') as HTMLElement
    expect(toast.getAttribute('role')).toBe('status')
    expect(toast.closest('[aria-live]')?.getAttribute('aria-live')).toBe('assertive')
    expect(within(toast).queryByRole('button', { name: '閉じる' })).toBeNull()
    const ok = within(toast).getByRole('button', { name: 'OK' })
    expect(ok.tagName).toBe('BUTTON')
    expect(ok.getAttribute('type')).toBe('button')
    // 出しただけではフォーカスを取らない（打っていた所のまま）
    expect(document.activeElement).toBe(field)
    // 指で押しても（離した時に）、マウス・キーボードの click でも消える
    act(() => {
      fingerTap(ok)
    })
    expect(useToasts.getState().toasts).toEqual([])
    act(() => void notifyUntilOk('やり直しました：11/11（水）を休みにした', { slot: 'undo' }))
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'OK' }))
    })
    expect(useToasts.getState().toasts).toEqual([])
    field.remove()
  })
})
