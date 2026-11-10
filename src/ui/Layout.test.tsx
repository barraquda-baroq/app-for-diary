// アプリの外枠（AppFrame）の新しい版の帯（docs/SPEC.md の 2.8）: 新しい版を受け取った時だけ「新しい版があります ［更新する］」を出し、
// 押すと入力中の下書きを保存してから新しい版に切り替える（保存は帯の1か所だけ。src/main.tsx の apply は切り替えるだけ）
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { markDraftClean, markDraftDirty } from '../store/draftRegistry'
import { useAppUpdate } from '../store/uiStore'
import { AppFrame } from './Layout'

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
