// カレンダーの行き来（docs/SPEC.md の 3.1・3.7・7.12。FRAME-014・016・071。D02・D04・D30）: 履歴に積むのはモードを替えた時だけで、
// 同じモードの中で期間を移る（マンスリーの前後の月の日を押す）時は置き換える。デイリーへ移る時に区分を目立たせる。
// 年の端の週から移っても年の外の行き先にならない。返す物は行き先が変わっても同じ物（押した時の今の行き先から決める）
import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { useCalendarUi } from '../../../store/uiStore'
import { renderView, setupCalendarTests } from '../../../test/renderCalendar'
import { useCalendarNav, type CalendarNav } from './useCalendarRoute'

setupCalendarTests()

/** 描くたびに受け取った物を覚える（同じ物かを確かめる） */
const seen: CalendarNav[] = []

function Harness() {
  const nav = useCalendarNav()
  seen.push(nav)
  return (
    <>
      <button type="button" onClick={() => nav.openMonth('2026-12-03')}>
        12月3日の月へ
      </button>
      <button type="button" onClick={() => nav.openDay('2026-11-12', 'private')}>
        11月12日の日へ（プライベート）
      </button>
      <button type="button" onClick={() => nav.openDay('2026-11-13')}>
        11月13日の日へ
      </button>
      <button type="button" onClick={() => nav.goMode('month')}>
        月
      </button>
      <button type="button" onClick={() => nav.shift(-1)}>
        前へ
      </button>
    </>
  )
}

const click = (user: ReturnType<typeof userEvent.setup>, name: string) => user.click(screen.getByText(name))

describe('7.12 の行き来', () => {
  it('イヤーから月へはモードが替わるので積む（見ている日はその日）', async () => {
    const user = userEvent.setup()
    const { router } = await renderView(Harness, {}, { path: '/year/2026' })
    await click(user, '12月3日の月へ')
    expect(router.state.location.pathname).toBe('/month/2026-12')
    expect(router.state.historyAction).toBe('PUSH')
    expect(useCalendarUi.getState().viewed).toBe('2026-12-03')
  })

  it('マンスリーの前後の月の日からは、同じモードの中で期間を移るだけなので置き換える（積むのはモードを替えた時だけ。3.1・FRAME-016）', async () => {
    const user = userEvent.setup()
    const { router } = await renderView(Harness, {}, { path: '/year/2026' })
    await act(() => router.navigate('/month/2026-11'))
    await click(user, '12月3日の月へ')
    expect(router.state.location.pathname).toBe('/month/2026-12')
    expect(router.state.historyAction).toBe('REPLACE')
    expect(useCalendarUi.getState().viewed).toBe('2026-12-03')
    // 「戻る」1回で前のモードへ
    await act(() => router.navigate(-1))
    expect(router.state.location.pathname).toBe('/year/2026')
  })

  it('マンスリーからデイリーへは積み、区分を渡すとその区切りと予定を目立たせる。デイリーの中で日を移る時は置き換える', async () => {
    const user = userEvent.setup()
    const { router } = await renderView(Harness, {}, { path: '/month/2026-11' })
    await click(user, '11月12日の日へ（プライベート）')
    expect(router.state.location.pathname).toBe('/day/2026-11-12')
    expect(router.state.historyAction).toBe('PUSH')
    expect(useCalendarUi.getState().flash?.keys).toEqual(['day-area:private', 'day-events:private'])
    await click(user, '11月13日の日へ')
    expect(router.state.location.pathname).toBe('/day/2026-11-13')
    expect(router.state.historyAction).toBe('REPLACE')
  })

  it('区分を渡さずにデイリーへ移る時は、前に数字から移った時の区切り・予定のキーが残っていても消す（ほかのキーはそのまま。CALENDAR-189・190）', async () => {
    const user = userEvent.setup()
    const { router } = await renderView(Harness, {}, { path: '/month/2026-11' })
    await click(user, '11月12日の日へ（プライベート）')
    expect(useCalendarUi.getState().flash?.keys).toEqual(['day-area:private', 'day-events:private'])
    // 目立たせる前に戻って、ウィークリーの見出し・マンスリーのマスから移る
    await act(() => router.navigate(-1))
    await click(user, '11月13日の日へ')
    expect(router.state.location.pathname).toBe('/day/2026-11-13')
    expect(useCalendarUi.getState().flash).toBeNull()
    // 予定を目立たせるキー（'item:{id}'）は消さない
    act(() => useCalendarUi.getState().flashTarget('item:w3'))
    await act(() => router.navigate(-1))
    await click(user, '11月13日の日へ')
    expect(useCalendarUi.getState().flash?.keys).toEqual(['item:w3'])
  })

  it('休みを付ける状態は、マンスリーの中で月を移っても続き、デイリーへ移ると終わる（D30）', async () => {
    const user = userEvent.setup()
    await renderView(Harness, {}, { path: '/month/2026-11' })
    act(() => useCalendarUi.getState().setOffMode(true))
    await click(user, '12月3日の月へ')
    expect(useCalendarUi.getState().offMode).toBe(true)
    await click(user, '11月13日の日へ')
    expect(useCalendarUi.getState().offMode).toBe(false)
  })
})

describe('年の端（1900〜2199年。D04）', () => {
  it('1900年1月1日の週（日曜は 1899年12月31日）から月へ替えても 1900年1月へ（今日へ飛ばない）', async () => {
    const user = userEvent.setup()
    const { router } = await renderView(Harness, {}, { path: '/week/1900-01-07' })
    await click(user, '前へ')
    expect(router.state.location.pathname).toBe('/week/1899-12-31')
    expect(useCalendarUi.getState().viewed).toBe('1900-01-01')
    await click(user, '月')
    expect(router.state.location.pathname).toBe('/month/1900-01')
  })
})

describe('返す物', () => {
  it('行き先が変わっても同じ物（React.memo のカード・行に渡しても描き直さない）。押した時の今の行き先から決める', async () => {
    const user = userEvent.setup()
    seen.length = 0
    const { router } = await renderView(Harness, {}, { path: '/year/2026' })
    const first = seen[0]
    await act(() => router.navigate('/month/2026-11'))
    // 行き先が変わる前に受け取った物で押しても、今のモード（マンスリー）から決める（同じモードなので置き換える）
    act(() => first.openMonth('2027-01-05'))
    await act(async () => {})
    expect(router.state.location.pathname).toBe('/month/2027-01')
    expect(router.state.historyAction).toBe('REPLACE')
    await click(user, '月')
    expect(new Set(seen).size).toBe(1)
  })
})
