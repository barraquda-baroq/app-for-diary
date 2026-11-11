// 部品のテストの道具（src/test/renderCalendar.tsx）と、中身ができるまでの仮の画面（最後の形の受け取る物）が動くことの確かめ
import { act, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { mkItem } from '../domain/testData'
import { DayView } from '../features/calendar/day/DayView'
import { MonthView } from '../features/calendar/month/MonthView'
import { testIds } from '../features/calendar/common/testIds'
import { useDayDrop, useItemDrag, WeekDnd } from '../features/calendar/week/dnd'
import { WeekView } from '../features/calendar/week/WeekView'
import { YearView } from '../features/calendar/year/YearView'
import { DetailSheet } from '../features/item/DetailSheet'
import { RegisterSheet } from '../features/item/RegisterSheet'
import { getData } from '../store/appStore'
import { useCalendarUi, usePrefs, useToasts } from '../store/uiStore'
import { useHoverCapable, useWidthClass } from '../ui/hooks'
import { prefersReducedMotion } from '../ui/motion'
import { renderAt, renderView, setTestMedia, setupCalendarTests, viewProps } from './renderCalendar'

setupCalendarTests()

describe('setupCalendarTests', () => {
  it('今日は 2026年11月10日（火）9:00（Date だけ偽物）', () => {
    expect(new Date().toString()).toContain('Nov 10 2026 09:00')
  })

  it('テストごとに、カレンダーの画面の状態・端末の設定・お知らせを初めに戻す（前のテストで変えた物）', () => {
    useCalendarUi.getState().setOffMode(true)
    usePrefs.getState().setPrefs({ lastMode: 'week' })
    useToasts.getState().push('info', 'お知らせ')
  })

  it('（前のテストの続き）', () => {
    expect(useCalendarUi.getState().offMode).toBe(false)
    expect(usePrefs.getState().lastMode).toBe('month')
    expect(useToasts.getState().toasts).toEqual([])
  })
})

describe('setTestMedia', () => {
  function Probe() {
    return (
      <p data-testid="probe">
        {useWidthClass()} {String(useHoverCapable())} {String(prefersReducedMotion())}
      </p>
    )
  }

  it.each([
    [{ width: 'L' as const }, 'L true false'],
    [{ width: 'M' as const }, 'M true false'],
    [{ width: 'S' as const }, 'S false false'],
    [{ width: 360 }, 'S false false'],
    [{ width: 'M' as const, pointer: 'coarse' as const }, 'M false false'],
    [{ width: 'L' as const, reducedMotion: true }, 'L true true'],
  ])('%o → 幅の区分・上に載せられるか・視差効果を減らす設定', async (media, shown) => {
    await renderView(Probe, {}, media)
    expect(screen.getByTestId('probe').textContent).toBe(shown)
  })

  it('「,」はどれか・「and」は全部（src/styles.css の (max-width: 899px), (pointer: coarse)）', () => {
    setTestMedia({ width: 'L', pointer: 'coarse' })
    expect(window.matchMedia('(max-width: 899px), (pointer: coarse)').matches).toBe(true)
    setTestMedia({ width: 'L', pointer: 'fine' })
    expect(window.matchMedia('(max-width: 899px), (pointer: coarse)').matches).toBe(false)
    expect(window.matchMedia('(min-width: 600px) and (max-width: 899px)').matches).toBe(false)
    setTestMedia({ width: 700 })
    expect(window.matchMedia('(min-width: 600px) and (max-width: 899px)').matches).toBe(true)
  })
})

describe('renderAt（アプリの行き先）', () => {
  it('ログインした状態で、端末の中のデータ・端末の設定を置いて描く', async () => {
    const item = mkItem({ id: 'a', title: '資料の確認', start: '2026-11-10' })
    const { router } = await renderAt('/', { data: { items: { a: item } }, prefs: { lastMode: 'week' } })
    expect(router.state.location.pathname).toBe('/')
    expect(screen.getByTestId('top-page')).toBeTruthy()
    expect(getData().items.a.title).toBe('資料の確認')
    expect(usePrefs.getState().lastMode).toBe('week')
  })

  it('履歴を並べると最後の物を開き、state も渡せる', async () => {
    const { router } = await renderAt(['/', { pathname: '/settings', state: { from: 'test' } }])
    expect(router.state.location.pathname).toBe('/settings')
    expect(router.state.location.state).toEqual({ from: 'test' })
    await act(() => router.navigate(-1))
    expect(router.state.location.pathname).toBe('/')
  })

  it('時刻を渡すとその時刻で描く', async () => {
    await renderAt('/', { now: new Date(2027, 0, 2, 8, 0) })
    expect(new Date().getFullYear()).toBe(2027)
  })
})

describe('仮の画面（受け取る物は最後の形）', () => {
  it('マンスリーは段階0の空のマス目（日付と今日の丸）のまま', async () => {
    const { setProps } = await renderView(MonthView, viewProps({ mode: 'month' }))
    const view = screen.getByTestId(testIds.view('month'))
    const grid = within(view).getByTestId('calendar-month')
    expect(grid.getAttribute('data-rows')).toBe('5')
    expect(view.querySelectorAll('.cal-cell')).toHaveLength(35)
    expect(view.querySelector('.today-mark.is-today')?.textContent).toBe('10')
    expect(grid.classList.contains('is-compact')).toBe(false)
    // 2026年8月は6行、S は詰めた形。今日の無い月には今日の丸を出さない
    setProps(viewProps({ mode: 'month', viewed: '2026-08-15', width: 'S' }))
    expect(screen.getByTestId('calendar-month').getAttribute('data-rows')).toBe('6')
    expect(screen.getByTestId('calendar-month').classList.contains('is-compact')).toBe(true)
    expect(document.querySelector('.today-mark')).toBeNull()
  })

  it.each([
    ['week', WeekView],
    ['day', DayView],
    ['year', YearView],
  ] as const)('%s は「段階2で作ります」の仮の画面', async (mode, View) => {
    await renderView(View, viewProps({ mode }))
    expect(screen.getByTestId(testIds.view(mode)).textContent).toContain('段階2で作ります')
  })

  it('ドラッグの部品は何もしない（掴めない・落とせない。中身をそのまま出す）', async () => {
    const week = { from: '2026-11-08', to: '2026-11-14' }
    const item = mkItem({ id: 'a', start: '2026-11-10' })
    let drag: ReturnType<typeof useItemDrag> | null = null
    let drop: ReturnType<typeof useDayDrop> | null = null
    function Card() {
      drag = useItemDrag({ item, handle: 'card', week })
      drop = useDayDrop({ date: '2026-11-10', kind: 'work', week })
      return (
        <div ref={drag.ref} {...drag.grabProps} data-testid="card">
          カード
        </div>
      )
    }
    await renderView(
      () => (
        <WeekDnd week={week}>
          <Card />
        </WeekDnd>
      ),
      {},
    )
    expect(screen.getByTestId('card').textContent).toBe('カード')
    expect(drag).toMatchObject({ isDragging: false, grabProps: {} })
    expect(drop).toMatchObject({ state: 'none' })
  })

  it('登録の画面は題「予定を登録」と［×］。区分の印を付ける', async () => {
    const onClose = vi.fn()
    await renderView(RegisterSheet, { init: { start: '2026-11-10', kind: 'private' }, onClose })
    const sheet = screen.getByTestId(testIds.itemSheet)
    expect(within(sheet).getByRole('heading').textContent).toBe('予定を登録')
    expect(sheet.getAttribute('data-kind')).toBe('private')
    await userEvent.setup().click(within(sheet).getByTestId('modal-close'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('詳細の画面は題「予定」と件名。区分とラベルの印を付け、無い予定はそう出す', async () => {
    const item = mkItem({ id: 'a', title: '定例ミーティング', kind: 'private', label: 'peony-l', start: '2026-11-10' })
    const onClose = vi.fn()
    const { setProps } = await renderView(DetailSheet, { id: 'a', onClose }, { data: { items: { a: item } } })
    const sheet = screen.getByTestId(testIds.itemSheet)
    expect(within(sheet).getByRole('heading').textContent).toBe('予定')
    expect(within(sheet).getByTestId(testIds.itemTitle).textContent).toBe('定例ミーティング')
    expect(sheet.getAttribute('data-kind')).toBe('private')
    expect(sheet.getAttribute('data-label')).toBe('peony-l')
    expect(sheet.classList.contains('label-band')).toBe(true)
    setProps({ id: 'missing', onClose })
    expect(screen.getByTestId(testIds.itemTitle).textContent).toBe('この予定は見つかりません')
  })
})
