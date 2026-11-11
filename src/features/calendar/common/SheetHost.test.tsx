// 登録・詳細の小さな画面と履歴（docs/SPEC.md の 3.1・3.8。D03）: 開くと同じ行き先を state.sheet 付きで積み、［×］・Esc は
// 1つ戻して閉じ、「戻る」でも閉じる（モード・期間はそのまま）。開いている時に別の物を開くと替える。読み込み直した後は、詳細は
// 予定があれば開き直し、無ければ・登録の画面は印を外す。データを読み終えるまでは決めない
import { act, fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { mkItem } from '../../../domain/testData'
import { useApp } from '../../../store/appStore'
import { renderAt, renderView, setupCalendarTests } from '../../../test/renderCalendar'
import { PAGE_ID, sheetOf, useItemSheets } from './sheets'
import { SheetHost } from './SheetHost'

setupCalendarTests()

const items = {
  a: mkItem({ id: 'a', title: '定例ミーティング', start: '2026-11-10' }),
  b: mkItem({ id: 'b', title: '資料の確認', start: '2026-11-12', kind: 'private' }),
}

/** 小さな画面を開くボタンと SheetHost だけの画面 */
function Harness() {
  const s = useItemSheets()
  return (
    <>
      <button type="button" onClick={() => s.openRegister({ start: '2026-11-12', kind: 'private' })}>
        登録を開く
      </button>
      <button type="button" onClick={() => s.openDetail('a')}>
        a を開く
      </button>
      <button type="button" onClick={() => s.openDetail('b')}>
        b を開く
      </button>
      <button type="button" onClick={s.closeSheet}>
        閉じる
      </button>
      <SheetHost />
    </>
  )
}

const sheet = () => screen.queryByTestId('item-sheet')

describe('開く・閉じる（履歴）', () => {
  it('登録を開くと同じ行き先を state.sheet 付きで積み、［×］で1つ戻って閉じる', async () => {
    const user = userEvent.setup()
    const { router } = await renderView(Harness, {}, { path: '/week/2026-11-08' })
    await user.click(screen.getByText('登録を開く'))
    expect(router.state.historyAction).toBe('PUSH')
    expect(router.state.location.pathname).toBe('/week/2026-11-08')
    expect(sheetOf(router.state.location.state)).toEqual({ kind: 'register', init: { start: '2026-11-12', kind: 'private' } })
    expect(sheet()?.getAttribute('data-kind')).toBe('private')
    await user.click(screen.getByTestId('modal-close'))
    expect(router.state.historyAction).toBe('POP')
    expect(router.state.location.pathname).toBe('/week/2026-11-08')
    expect(sheetOf(router.state.location.state)).toBeNull()
    expect(sheet()).toBeNull()
  })

  it('Esc でも閉じる。詳細は予定の id だけを持つ（URL に出さない）', async () => {
    const user = userEvent.setup()
    const { router } = await renderView(Harness, {}, { path: '/day/2026-11-10', data: { items } })
    await user.click(screen.getByText('a を開く'))
    expect(router.state.location.pathname).toBe('/day/2026-11-10')
    expect(screen.getByTestId('item-title').textContent).toBe('定例ミーティング')
    await user.keyboard('{Escape}')
    expect(sheet()).toBeNull()
    expect(router.state.historyAction).toBe('POP')
  })

  it('「戻る」で閉じ、行き先（モード・期間）はそのまま', async () => {
    const user = userEvent.setup()
    const { router } = await renderView(Harness, {}, { path: '/month/2026-11', data: { items } })
    await user.click(screen.getByText('a を開く'))
    expect(sheet()).toBeTruthy()
    await act(() => router.navigate(-1))
    expect(sheet()).toBeNull()
    expect(router.state.location.pathname).toBe('/month/2026-11')
  })

  it('開いている時に別の予定を開くと、積まずに替える（［×］1回でカレンダーへ戻る）', async () => {
    const user = userEvent.setup()
    const { router } = await renderView(Harness, {}, { path: '/month/2026-11', data: { items } })
    await user.click(screen.getByText('a を開く'))
    await user.click(screen.getByText('b を開く'))
    expect(router.state.historyAction).toBe('REPLACE')
    expect(screen.getByTestId('item-title').textContent).toBe('資料の確認')
    await user.click(screen.getByTestId('modal-close'))
    expect(sheet()).toBeNull()
    expect(sheetOf(router.state.location.state)).toBeNull()
  })

  it('続けて2回閉じても、履歴は1つだけ戻る', async () => {
    const user = userEvent.setup()
    const { router } = await renderView(Harness, {}, { path: '/year/2026' })
    await act(() => router.navigate('/month/2026-11'))
    await user.click(screen.getByText('登録を開く'))
    const close = screen.getByText('閉じる')
    act(() => {
      fireEvent.click(close)
      fireEvent.click(close)
    })
    await act(async () => {})
    expect(router.state.location.pathname).toBe('/month/2026-11')
    expect(sheet()).toBeNull()
  })

  it('戻る物が無い時（印付きの行き先を最初に開いた）は、印を外して置き換える', async () => {
    const user = userEvent.setup()
    const { router } = await renderView(
      Harness,
      {},
      {
        path: {
          pathname: '/month/2026-11',
          state: { sheet: { kind: 'register', init: { start: '2026-11-10' } }, sheetPage: PAGE_ID },
        },
      },
    )
    expect(sheet()).toBeTruthy()
    await user.click(screen.getByTestId('modal-close'))
    expect(router.state.historyAction).toBe('REPLACE')
    expect(router.state.location.pathname).toBe('/month/2026-11')
    expect(sheet()).toBeNull()
  })

  it('閉じている時に閉じても何もしない', async () => {
    const user = userEvent.setup()
    const { router } = await renderView(Harness, {}, { path: '/month/2026-11' })
    await user.click(screen.getByText('閉じる'))
    expect(router.state.historyAction).toBe('POP')
    expect(router.state.location.pathname).toBe('/month/2026-11')
  })
})

describe('読み込み直した後（D03）', () => {
  const before = (sheet: object) => ['/month/2026-11', { pathname: '/month/2026-11', state: { sheet } }]

  it('詳細は、予定があれば開き直す（このページの印に替える）。［×］で1つ前へ戻る', async () => {
    const user = userEvent.setup()
    const { router } = await renderAt(before({ kind: 'detail', id: 'a' }), { data: { items } })
    expect(screen.getByTestId('item-title').textContent).toBe('定例ミーティング')
    expect(router.state.location.state).toMatchObject({ sheetPage: PAGE_ID })
    await user.click(screen.getByTestId('modal-close'))
    expect(router.state.historyAction).toBe('POP')
    expect(sheet()).toBeNull()
  })

  it('詳細の予定が無ければ（ゴミ箱へ移した・ほかの端末で消した）、開かずに印を外す', async () => {
    const { router } = await renderAt(before({ kind: 'detail', id: 'gone' }), { data: { items } })
    expect(sheet()).toBeNull()
    expect(router.state.historyAction).toBe('REPLACE')
    expect(sheetOf(router.state.location.state)).toBeNull()
  })

  it('登録の画面は開き直さずに印を外す', async () => {
    const { router } = await renderAt(before({ kind: 'register', init: { start: '2026-11-10' } }), {})
    expect(sheet()).toBeNull()
    expect(sheetOf(router.state.location.state)).toBeNull()
    expect(router.state.location.pathname).toBe('/month/2026-11')
  })

  it('端末の中のデータを読み終えるまでは決めない（予定が無いと見誤って印を外さない）', async () => {
    const { router } = await renderView(SheetHost, {}, { path: '/month/2026-11', data: { items } })
    act(() => useApp.setState({ status: 'loading' }))
    await act(() => router.navigate('/month/2026-11', { state: { sheet: { kind: 'detail', id: 'a' } } }))
    expect(sheet()).toBeNull()
    expect(sheetOf(router.state.location.state)).toEqual({ kind: 'detail', id: 'a' })
    act(() => useApp.setState({ status: 'ready' }))
    expect(screen.getByTestId('item-title').textContent).toBe('定例ミーティング')
  })

  it('形の違う印は小さな画面として扱わない', () => {
    expect(sheetOf(null)).toBeNull()
    expect(sheetOf({ sheet: { kind: 'detail' } })).toBeNull()
    expect(sheetOf({ sheet: { kind: 'register', init: {} } })).toBeNull()
    expect(sheetOf({ sheet: { kind: 'other', id: 'a' } })).toBeNull()
    expect(sheetOf({ mimFromCalendar: true })).toBeNull()
  })
})
