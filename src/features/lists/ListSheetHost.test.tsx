// リストから開く小さな画面を出す所（src/features/lists/ListSheetHost.tsx。docs/SPEC.md の 3.1・3.6・12.2・12.3。開発）:
// リストから開いた印だけを出し（カレンダーから開いた物は SheetHost）、読み込み直した後は、登録は1つ戻って閉じ、「タスク」の詳細・
// ルーチンとやりたいことのパネルは記録があれば同じ形で開き直す（無ければ1つ戻って閉じる）。開く物は押した時の今の行き先で決める
import { act, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { mkFavorite, mkItem, mkRoutine } from '../../domain/testData'
import { useApp } from '../../store/appStore'
import { renderAt, renderView, setupCalendarTests } from '../../test/renderCalendar'
import { PAGE_ID, sheetOf, useItemSheets } from '../calendar/common/sheets'
import { SheetHost } from '../calendar/common/SheetHost'
import { ListSheetHost } from './ListSheetHost'

setupCalendarTests()

const items = { a: mkItem({ id: 'a', title: '見積もりの返事', origin: 'list', start: null, due: '2026-11-11', listed: true }) }
const routines = { r1: mkRoutine({ id: 'r1', title: '植物に水をやる' }) }
const favorites = { f1: mkFavorite({ id: 'f1', text: '近所のパン屋を調べる' }) }

function Harness() {
  const s = useItemSheets()
  return (
    <>
      <button type="button" onClick={() => s.openTaskDetail('a')}>
        タスクを開く
      </button>
      <button type="button" onClick={() => s.openDetail('a')}>
        予定を開く
      </button>
      <button type="button" onClick={() => s.openRoutineDetail('r1')}>
        ルーチンを開く
      </button>
      <button type="button" onClick={() => s.openFavoriteDetail('f1')}>
        やりたいことを開く
      </button>
      <button
        type="button"
        onClick={() => s.openRegister({ start: '2026-11-10', title: '近所のパン屋を調べる' }, { from: 'favorite' })}
      >
        予定にする
      </button>
      <SheetHost />
      <ListSheetHost />
    </>
  )
}

const sheets = () => screen.queryAllByTestId('item-sheet')

describe('S3 リストから開く（S3-FRAME-004・S3-FRAME-018・S3-TASK-141）', () => {
  it('「タスク」の詳細は ListSheetHost だけが出し（題は「タスク」）、カレンダーから開いた詳細は SheetHost だけが出す（題は「予定」）', async () => {
    const user = userEvent.setup()
    const { router } = await renderView(Harness, {}, { path: '/week/2026-11-08', data: { items } })
    await user.click(screen.getByText('タスクを開く'))
    expect(router.state.historyAction).toBe('PUSH')
    expect(sheetOf(router.state.location.state)).toEqual({ kind: 'detail', id: 'a', from: 'task' })
    expect(sheets()).toHaveLength(1)
    expect(within(sheets()[0]).getByRole('heading').textContent).toBe('タスク')
    await user.click(screen.getByTestId('modal-close'))
    expect(router.state.historyAction).toBe('POP')
    expect(sheets()).toHaveLength(0)
    await user.click(screen.getByText('予定を開く'))
    expect(sheets()).toHaveLength(1)
    expect(within(sheets()[0]).getByRole('heading').textContent).toBe('予定')
  })

  it('［予定にする］は from favorite の登録の画面を積み、件名を入れて開く', async () => {
    const user = userEvent.setup()
    const { router } = await renderView(Harness, {}, { path: '/month/2026-11' })
    await user.click(screen.getByText('予定にする'))
    expect(sheetOf(router.state.location.state)).toMatchObject({ kind: 'register', from: 'favorite' })
    expect(sheets()).toHaveLength(1)
    expect(within(sheets()[0]).getByRole('heading').textContent).toBe('予定を登録')
    expect(screen.getByTestId('item-title')).toHaveProperty('value', '近所のパン屋を調べる')
  })

  it('ルーチン・やりたいことのパネルの印を積む（もう開いている時は置き換える）', async () => {
    const user = userEvent.setup()
    const { router } = await renderView(Harness, {}, { path: '/month/2026-11', data: { routines, favorites } })
    await user.click(screen.getByText('ルーチンを開く'))
    expect(router.state.historyAction).toBe('PUSH')
    expect(sheetOf(router.state.location.state)).toEqual({ kind: 'routine', id: 'r1' })
    await user.click(screen.getByText('やりたいことを開く'))
    expect(router.state.historyAction).toBe('REPLACE')
    expect(sheetOf(router.state.location.state)).toEqual({ kind: 'favorite', id: 'f1' })
  })

  it('開いている間にルーチンが無くなった（ほかの端末で消した）時は、1つ戻って閉じる', async () => {
    const user = userEvent.setup()
    const { router } = await renderView(Harness, {}, { path: '/month/2026-11', data: { routines } })
    await user.click(screen.getByText('ルーチンを開く'))
    act(() => useApp.setState((s) => ({ data: { ...s.data, routines: {} } })))
    await act(async () => {})
    expect(router.state.historyAction).toBe('POP')
    expect(sheetOf(router.state.location.state)).toBeNull()
  })
})

describe('S3 読み込み直した後（開発）', () => {
  const before = (sheet: object, path = '/month/2026-11') => [path, { pathname: path, state: { sheet } }]

  it('「タスク」の詳細は、予定があれば同じ題で開き直す（このページの印に替える）', async () => {
    const { router } = await renderAt(before({ kind: 'detail', id: 'a', from: 'task' }), { data: { items } })
    expect(within(screen.getByTestId('item-sheet')).getByRole('heading').textContent).toBe('タスク')
    expect(router.state.location.state).toMatchObject({ sheetPage: PAGE_ID, sheet: { from: 'task' } })
  })

  it.each([
    ['ルーチン', { kind: 'routine', id: 'r1' }],
    ['やりたいこと', { kind: 'favorite', id: 'f1' }],
  ])('%sのパネルは、記録があれば開き直す（このページの印に替える）', async (_name, sheet) => {
    const { router } = await renderAt(before(sheet), { data: { routines, favorites } })
    await act(async () => {})
    expect(router.state.location.state).toMatchObject({ sheetPage: PAGE_ID, sheet })
  })

  it.each([
    ['「タスク」の詳細', { kind: 'detail', id: 'gone', from: 'task' }],
    ['ルーチンのパネル', { kind: 'routine', id: 'gone' }],
    ['やりたいことのパネル', { kind: 'favorite', id: 'gone' }],
  ])('%sの記録が無ければ、開かずに1つ戻って閉じる', async (_name, sheet) => {
    const { router } = await renderAt(before(sheet), { data: { items, routines, favorites } })
    await act(async () => {})
    expect(router.state.historyAction).toBe('POP')
    expect(sheetOf(router.state.location.state)).toBeNull()
    expect(sheets()).toHaveLength(0)
  })

  it('［予定にする］の登録の画面は開き直さずに1つ戻って閉じる', async () => {
    const { router } = await renderAt(
      ['/year/2026', ...before({ kind: 'register', init: { start: '2026-11-10', title: 'x' }, from: 'favorite' })],
      {},
    )
    await act(async () => {})
    expect(sheets()).toHaveLength(0)
    expect(router.state.historyAction).toBe('POP')
    expect(router.state.location.pathname).toBe('/month/2026-11')
    await act(() => router.navigate(-1))
    expect(router.state.location.pathname).toBe('/year/2026')
  })

  it('L・M の MIM（#/mim）の上の印も同じく開き直す（MIM の横・下のリストから開いた物。開発）', async () => {
    const { router } = await renderAt(before({ kind: 'detail', id: 'a', from: 'task' }, '/mim'), { data: { items } })
    expect(within(screen.getByTestId('item-sheet')).getByRole('heading').textContent).toBe('タスク')
    expect(router.state.location.pathname).toBe('/mim')
  })
})
