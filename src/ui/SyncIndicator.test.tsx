// ヘッダーの同期の表示（docs/SPEC.md の 18.4）: 8つの状態の言葉と色、L・M はアイコンと字で設定の「同期」へ、S はアイコンだけで小さな窓に
// 詳しい字と［今すぐ同期］。持ち主の記録が無い時は手順書の場所も出す
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setTestWidth, TEST_WIDTHS } from '../test/width'

const mocks = vi.hoisted(() => ({ syncNow: vi.fn(async () => {}) }))
vi.mock('../sync/controller', () => ({ syncNow: mocks.syncNow }))

const { SyncIndicator, syncBadge, syncDetail, useSyncView } = await import('./SyncIndicator')

function renderAt(width: number) {
  setTestWidth(width)
  const router = createMemoryRouter(
    [
      { path: '/', element: <SyncIndicator /> },
      { path: '/settings', element: <p>設定</p> },
    ],
    { initialEntries: ['/'] },
  )
  render(<RouterProvider router={router} />)
  return router
}

afterEach(() => {
  cleanup()
  useSyncView.setState({ view: null })
  mocks.syncNow.mockClear()
})

describe('同期の表示（18.4）', () => {
  it('8つの状態の言葉と色', () => {
    expect(syncBadge({ kind: 'synced' })).toEqual({ tone: 'ok', off: false, label: '同期済み' })
    expect(syncBadge({ kind: 'sending' }).label).toBe('送信中…')
    expect(syncBadge({ kind: 'pending', count: 3 }).label).toBe('未送信 3件')
    expect(syncBadge({ kind: 'downloading' }).label).toBe('受け取り中…')
    expect(syncBadge({ kind: 'offline' })).toMatchObject({ tone: 'warn', off: true })
    expect(syncBadge({ kind: 'quota', resumeAt: '17:00' }).label).toBe('今日の無料枠を使い切りました（17:00 ごろに戻ります）')
    expect(syncBadge({ kind: 'outdated' }).label).toBe('要更新（アプリを更新してください）')
    expect(syncBadge({ kind: 'error', reason: '持ち主の記録がまだありません' }).label).toBe(
      '同期できません（持ち主の記録がまだありません）',
    )
    expect(syncDetail({ kind: 'error', reason: '持ち主の記録がまだありません' })).toBe(
      '持ち主の記録がまだありません（docs/manual/5-owner-record.md）',
    )
  })

  it('状態が無い（ログインしていない・持ち主だと確かめていない）間は何も出さない', () => {
    renderAt(TEST_WIDTHS.L)
    expect(screen.queryByTestId('sync-indicator')).toBeNull()
  })

  it('L はアイコンと字で、押すと設定の「同期」へ', async () => {
    useSyncView.setState({ view: { kind: 'pending', count: 2 } })
    const router = renderAt(TEST_WIDTHS.L)
    const el = screen.getByTestId('sync-indicator')
    expect(el.textContent).toBe('未送信 2件')
    expect(el.getAttribute('data-tone')).toBe('busy')
    await userEvent.setup().click(el)
    expect(router.state.location.pathname).toBe('/settings')
  })

  it('S はアイコンだけで、押すと小さな窓に詳しい字と［今すぐ同期］', async () => {
    useSyncView.setState({ view: { kind: 'error', reason: '持ち主の記録がまだありません' } })
    renderAt(TEST_WIDTHS.S)
    const el = screen.getByTestId('sync-indicator')
    expect(el.textContent).toBe('')
    const user = userEvent.setup()
    await user.click(el)
    expect(screen.getByTestId('sync-popup-detail').textContent).toContain('docs/manual/5-owner-record.md')
    await user.click(screen.getByTestId('sync-now-popup'))
    expect(mocks.syncNow).toHaveBeenCalledTimes(1)
  })
})
