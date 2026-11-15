// リストから開く小さな画面の出し方（src/features/lists/ListSheetHost.tsx・src/ui/Modal.tsx の placement side。docs/SPEC.md の 3.6・
// 3.8・12.2・12.3）: 本物のトップの画面の上で、Task List の［詳しく］の「タスク」は L では右の列の上のパネル、S・M は下からのシート。
// 開いたまま幅を替えても閉じず、出し方だけが替わる。#/mim（L の MIM の横の右の列から開いた物）でも同じに出し、閉じると #/mim へ
// 戻る。Favorite List の［予定にする］の登録の画面は、カレンダーから開く登録と同じく L は真ん中の小さな画面
import { act, fireEvent, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { mkItem } from '../../domain/testData'
import { WIDTH_L } from '../../ui/hooks'
import { renderAt, setupCalendarTests } from '../../test/renderCalendar'
import { PAGE_ID, sheetOf } from '../calendar/common/sheets'

setupCalendarTests()

const items = {
  a: mkItem({ id: 'a', title: '見積もりの返事', origin: 'list', start: null, due: '2026-11-11', listed: true }),
}

const taskDetail = { sheet: { kind: 'detail', id: 'a', from: 'task' }, sheetPage: PAGE_ID }
const favoriteRegister = {
  sheet: { kind: 'register', init: { start: '2026-11-10', title: '近所のパン屋を調べる' }, from: 'favorite' },
  sheetPage: PAGE_ID,
}

/**
 * 幅を替えると change を知らせる matchMedia（幅だけに答える）。トップの画面も含めて幅の区分を替えられるように、renderAt の前に置き、
 * その中の setTestMedia の置き換えは受け流す。restore で元に戻す
 */
function liveWidth(initial: number): { setWidth: (next: number) => void; restore: () => void } {
  let width = initial
  const entries = new Set<{ query: string; matches: boolean; listeners: Set<() => void> }>()
  const evaluate = (query: string) =>
    query.split(',').some((part) => {
      const min = /min-width:\s*(\d+)px/.exec(part)
      const max = /max-width:\s*(\d+)px/.exec(part)
      return Boolean(min || max) && (!min || width >= Number(min[1])) && (!max || width <= Number(max[1]))
    })
  const live = ((query: string) => {
    const entry = { query, matches: evaluate(query), listeners: new Set<() => void>() }
    entries.add(entry)
    return {
      get matches() {
        return entry.matches
      },
      media: query,
      onchange: null,
      addEventListener: (_t: string, fn: () => void) => entry.listeners.add(fn),
      removeEventListener: (_t: string, fn: () => void) => entry.listeners.delete(fn),
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    } as unknown as MediaQueryList
  }) as typeof window.matchMedia
  const before = window.matchMedia
  Object.defineProperty(window, 'matchMedia', { configurable: true, get: () => live, set: () => {} })
  return {
    setWidth: (next) => {
      width = next
      act(() => {
        for (const e of entries) {
          const m = evaluate(e.query)
          if (m === e.matches) continue
          e.matches = m
          for (const fn of [...e.listeners]) fn()
        }
      })
    },
    restore: () => Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: before }),
  }
}

const sheet = () => screen.getByTestId('item-sheet')

describe('S3 リストから開く小さな画面の出し方（S3-FRAME-075・076・101・106・TASK-140・149）', () => {
  it('L: Task List の［詳しく］の「タスク」は、右の列の上のパネル（題は「タスク」・区分の地）', async () => {
    const r = await renderAt('/month/2026-11', { width: 'L', data: { items } })
    await act(() => r.router.navigate('/month/2026-11', { state: taskDetail }))
    expect(sheet().classList.contains('is-side')).toBe(true)
    expect(sheet().classList.contains('it-sheet')).toBe(true)
    expect(within(sheet()).getByRole('heading').textContent).toBe('タスク')
    expect(screen.getByTestId('side-column')).not.toBeNull()
  })

  it('S・M: 同じ物は下からのシート（パネルにしない）', async () => {
    for (const width of ['S', 'M'] as const) {
      const r = await renderAt('/month/2026-11', { width, data: { items } })
      await act(() => r.router.navigate('/month/2026-11', { state: taskDetail }))
      expect(sheet().classList.contains('is-side')).toBe(false)
      r.unmount()
    }
  })

  it('開いたまま幅を L → M → L と替えても閉じず、出し方だけが替わる（トップの画面は右の列 ↔ 積んだ所に替わり、小さな画面は同じ物のまま・フォーカスも残る・履歴も動かさない）', async () => {
    const { setWidth, restore } = liveWidth(1400)
    try {
      const r = await renderAt('/month/2026-11', { width: 'L', data: { items } })
      await act(() => r.router.navigate('/month/2026-11', { state: taskDetail }))
      const first = sheet()
      const key = r.router.state.location.key
      const title = screen.getByTestId('item-title') as HTMLInputElement
      title.focus()
      expect(screen.getByTestId('top-page').getAttribute('data-width')).toBe('L')
      setWidth(WIDTH_L - 1)
      expect(screen.getByTestId('top-page').getAttribute('data-width')).toBe('M')
      expect(screen.getByTestId('item-sheet')).toBe(first)
      expect(first.classList.contains('is-side')).toBe(false)
      expect(screen.getByTestId('item-title')).toBe(title)
      expect(document.activeElement).toBe(title)
      setWidth(WIDTH_L)
      expect(screen.getByTestId('top-page').getAttribute('data-width')).toBe('L')
      expect(screen.getByTestId('item-sheet')).toBe(first)
      expect(first.classList.contains('is-side')).toBe(true)
      expect(document.activeElement).toBe(title)
      expect(title.value).toBe('見積もりの返事')
      expect(r.router.state.location.key).toBe(key)
      expect(sheetOf(r.router.state.location.state)).toEqual(taskDetail.sheet)
    } finally {
      restore()
    }
  })

  it('L の MIM（#/mim）の上でも右の列の上のパネルで開き、［×］で閉じると #/mim へ戻る（MIM の横の右の列から開いた物）', async () => {
    const r = await renderAt(['/month/2026-11', '/mim'], { width: 'L', data: { items } })
    await act(() => r.router.navigate('/mim', { state: taskDetail }))
    expect(sheet().classList.contains('is-side')).toBe(true)
    fireEvent.click(within(sheet()).getByTestId('modal-close'))
    await act(async () => {})
    expect(screen.queryByTestId('item-sheet')).toBeNull()
    expect(r.router.state.location.pathname).toBe('/mim')
    expect(sheetOf(r.router.state.location.state)).toBeNull()
  })

  it('Favorite List の［予定にする］の登録の画面は、L でもカレンダーから開く登録と同じ真ん中の小さな画面（パネルにしない。12.2）', async () => {
    const r = await renderAt('/month/2026-11', { width: 'L' })
    await act(() => r.router.navigate('/month/2026-11', { state: favoriteRegister }))
    expect(within(sheet()).getByRole('heading').textContent).toBe('予定を登録')
    expect(sheet().classList.contains('is-side')).toBe(false)
    expect((screen.getByTestId('item-title') as HTMLInputElement).value).toBe('近所のパン屋を調べる')
  })
})
