// イヤーの画面（docs/SPEC.md の 8.・7.1〜7.4・7.9・7.12・4.12。D07・D28。CALENDAR-073・140・186・187・203〜225・FRAME-134・163・209・280・281）
import { act, fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { mkItem, mkOffDay } from '../../../domain/testData'
import type { AppData } from '../../../domain/types'
import { useApp } from '../../../store/appStore'
import { useCalendarUi } from '../../../store/uiStore'
import { renderAt, renderView, setupCalendarTests, viewProps } from '../../../test/renderCalendar'
import { testIds } from '../common/testIds'
import type { ViewProps } from '../common/types'
import { YearView } from './YearView'

setupCalendarTests()

/** 見本: 11/10 は仕事（済んでいない）とプライベート（完了）、11/5 は仕事が全部完了、11/28〜12/2 の仕事、11/11 は休み */
function sample(): Partial<AppData> {
  return {
    items: {
      w1: mkItem({ id: 'w1', start: '2026-11-10' }),
      p1: mkItem({ id: 'p1', kind: 'private', start: '2026-11-10', done: true, doneAt: 1, doneOn: '2026-11-10' }),
      d1: mkItem({ id: 'd1', start: '2026-11-05', done: true, doneAt: 1, doneOn: '2026-11-05' }),
      d2: mkItem({ id: 'd2', start: '2026-11-05', done: true, doneAt: 1, doneOn: '2026-11-05' }),
      m1: mkItem({ id: 'm1', start: '2026-11-28', due: '2026-12-02' }),
    },
    offDays: { '2026-11-11': mkOffDay('2026-11-11') },
  }
}

/** イヤーの画面に渡す物（1400×900 の窓の領域は 994px。viewProps の既定 1068px は「月を行・日を列」） */
const props = (over: Partial<ViewProps> = {}) => viewProps({ mode: 'year', ...over })

const cell = (date: string) => screen.getByTestId(testIds.yearCell(date))
const dots = (date: string) =>
  [...cell(date).querySelectorAll('.yr-dot')].map(
    (d) => `${d.classList.contains('is-work') ? 'work' : 'private'}:${d.getAttribute('data-state')}`,
  )
const view = () => screen.getByTestId(testIds.view('year'))

describe('並べ方（8.1・CALENDAR-205・206）', () => {
  it('領域の幅 870px 以上は「月を行・日を列」: 12行、各行に月の見出しの帯と、その月の日のマスだけ', async () => {
    await renderView(YearView, props({ area: { width: 870, height: 700 } }), { data: sample() })
    expect(view().getAttribute('data-layout')).toBe('rows')
    const rows = view().querySelectorAll('.yr-row')
    expect(rows).toHaveLength(12)
    expect(within(rows[10] as HTMLElement).getByTestId(testIds.yearMonth(11)).textContent).toBe('NOV2026')
    expect(rows[10].querySelectorAll('.yr-cell')).toHaveLength(30)
    expect(view().querySelectorAll('.yr-cell')).toHaveLength(365)
    // その月に無い日は何も描かない（CALENDAR-212）
    for (const d of ['2026-02-29', '2026-02-30', '2026-02-31', '2026-04-31'])
      expect(screen.queryByTestId(testIds.yearCell(d))).toBeNull()
    expect(rows[1].querySelectorAll('.yr-cell')).toHaveLength(28)
    // 日付と英字3文字の曜日
    expect(cell('2026-11-10').querySelector('.yr-date')?.textContent).toBe('10')
    expect(cell('2026-11-10').querySelector('.yr-wd')?.textContent).toBe('TUE')
    // 仮の画面の文はもう無い
    expect(view().textContent).not.toMatch(/段階2で/)
  })

  it('869px まで（M・S はいつも）は小さな月: 7列 × 6行の場所に、その月の日だけ（前後の月の日は出さない。D28・CALENDAR-219）', async () => {
    const { setProps } = await renderView(YearView, props({ area: { width: 869, height: 700 } }), { data: sample() })
    expect(view().getAttribute('data-layout')).toBe('mini')
    const minis = view().querySelectorAll('.yr-mini')
    expect(minis).toHaveLength(12)
    // floor(869 / 170) = 5 → 4 列
    expect(view().querySelector('.yr-minis')?.getAttribute('data-cols')).toBe('4')
    const nov = minis[10] as HTMLElement
    expect(within(nov).getByTestId(testIds.yearMonth(11)).textContent).toBe('NOV')
    expect([...nov.querySelectorAll('.yr-mini-wd')].map((e) => e.textContent).join('')).toBe('SMTWTFS')
    const grid = nov.querySelector('.yr-mini-grid') as HTMLElement
    expect(grid.children).toHaveLength(42)
    expect(grid.querySelectorAll('.yr-cell')).toHaveLength(30)
    // 2026年11月1日は日曜なので先頭、2月1日も日曜。1月1日は木曜なので 4つ空ける
    expect(grid.children[0].getAttribute('data-date')).toBe('2026-11-01')
    const jan = (minis[0] as HTMLElement).querySelector('.yr-mini-grid') as HTMLElement
    expect([...jan.children].slice(0, 5).map((c) => c.getAttribute('data-date'))).toEqual([null, null, null, null, '2026-01-01'])
    // 小さな月のマスは日付だけ（曜日は頭文字の行）
    expect(cell('2026-11-10').querySelector('.yr-wd')).toBeNull()
    // 列の数: 領域 509px は2列、S はいつも2列
    setProps(props({ area: { width: 509, height: 700 }, width: 'M' }))
    expect(view().querySelector('.yr-minis')?.getAttribute('data-cols')).toBe('2')
    setProps(props({ area: { width: 549, height: 700 }, width: 'S' }))
    expect(view().querySelector('.yr-minis')?.getAttribute('data-cols')).toBe('2')
  })

  it('領域の幅が変わるとすぐに並べ直す（CALENDAR-206）', async () => {
    const { setProps } = await renderView(YearView, props({ area: { width: 994, height: 700 } }))
    expect(view().getAttribute('data-layout')).toBe('rows')
    setProps(props({ area: { width: 794, height: 700 } }))
    expect(view().getAttribute('data-layout')).toBe('mini')
    setProps(props({ area: { width: 994, height: 700 } }))
    expect(view().getAttribute('data-layout')).toBe('rows')
  })

  it('L だけこの画面の中でスクロールする（測る箱はスクロールさせない。CALENDAR-217）', async () => {
    const { setProps } = await renderView(YearView, props())
    expect(view().classList.contains('is-scroll')).toBe(true)
    setProps(props({ width: 'M', area: { width: 700, height: 700 } }))
    expect(view().classList.contains('is-scroll')).toBe(false)
  })

  it('●の段: 日付と●が横に並ぶマスの幅（35px）からは右上、狭いと曜日の下の段（D28）', async () => {
    const { setProps } = await renderView(YearView, props({ area: { width: 994, height: 700 } }))
    // 994px の領域のマスは 28px
    expect(cell('2026-11-10').classList.contains('is-dots-below')).toBe(true)
    setProps(props({ area: { width: 1514, height: 700 } }))
    expect(cell('2026-11-10').classList.contains('is-dots-top')).toBe(true)
    expect(view().querySelector('.yr-rows')?.getAttribute('data-dots')).toBe('top')
  })
})

describe('マスの中身（8.2・8.3・7.1〜7.4・7.9）', () => {
  it.each([
    ['rows', 994],
    ['mini', 794],
  ])(
    '%s: ●は決まった2つの場所（左＝仕事・右＝プライベート）。予定の無い区分も場所は残し、全部完了は allDone（CALENDAR-140・213〜215）',
    async (_, width) => {
      await renderView(YearView, props({ area: { width, height: 700 } }), { data: sample() })
      expect(dots('2026-11-10')).toEqual(['work:open', 'private:allDone'])
      expect(dots('2026-11-05')).toEqual(['work:allDone', 'private:none'])
      expect(dots('2026-11-04')).toEqual(['work:none', 'private:none'])
      // 月をまたぐ複数日は期間中の毎日
      for (const d of ['2026-11-28', '2026-11-30', '2026-12-01', '2026-12-02'])
        expect(dots(d), d).toEqual(['work:open', 'private:none'])
      expect(dots('2026-12-03')).toEqual(['work:none', 'private:none'])
    },
  )

  it('今日はマスの内側に 2px の --accent の枠と日付の太さ 600（地と色はそのまま。CALENDAR-073・FRAME-280・D07）', async () => {
    await renderView(YearView, props(), { data: sample() })
    const today = view().querySelectorAll('.yr-cell.is-today')
    expect([...today].map((c) => c.getAttribute('data-date'))).toEqual(['2026-11-10'])
    expect(cell('2026-11-10').getAttribute('aria-current')).toBe('date')
    expect(cell('2026-11-09').hasAttribute('aria-current')).toBe(false)
    expect(cell('2026-11-10').classList.contains('today-mark')).toBe(false)
  })

  it('今月の帯は今日の印（.today-mark: 地 --today-bg・字 --on-primary・輪）。小さな月では名前を --accent に（CALENDAR-075・209・219・FRAME-281）', async () => {
    const { setProps } = await renderView(YearView, props())
    const band = screen.getByTestId(testIds.yearMonth(11))
    expect(band.classList.contains('today-mark')).toBe(true)
    expect(band.getAttribute('aria-current')).toBe('date')
    expect(screen.getByTestId(testIds.yearMonth(10)).classList.contains('today-mark')).toBe(false)
    setProps(props({ area: { width: 794, height: 700 } }))
    expect(screen.getByTestId(testIds.yearMonth(11)).classList.contains('is-this-month')).toBe(true)
    expect(screen.getByTestId(testIds.yearMonth(12)).classList.contains('is-this-month')).toBe(false)
    // 別の年には今日も今月も無い
    setProps(props({ viewed: '2027-03-01', area: { width: 994, height: 700 } }))
    expect(view().querySelector('.is-today, .today-mark')).toBeNull()
  })

  it('休みの日は地を --off-fill、日曜・祝日は sun、土曜は sat。祝日名は出さず読み上げで伝える（CALENDAR-216・067・FRAME-152）', async () => {
    await renderView(YearView, props(), { data: sample() })
    expect(cell('2026-11-11').classList.contains('cp-offday')).toBe(true)
    expect(cell('2026-11-12').classList.contains('cp-offday')).toBe(false)
    expect(cell('2026-11-03').getAttribute('data-tone')).toBe('sun')
    expect(cell('2026-11-07').getAttribute('data-tone')).toBe('sat')
    expect(cell('2026-11-04').hasAttribute('data-tone')).toBe(false)
    expect(view().textContent).not.toContain('文化の日')
    expect(view().querySelector('.cp-holiday, .cp-off')).toBeNull()
    expect(cell('2026-11-03').getAttribute('aria-label')).toBe('11月3日（火）、予定なし、文化の日')
    expect(cell('2026-11-11').getAttribute('aria-label')).toBe('11月11日（水）、予定なし、休み')
    expect(cell('2026-11-10').getAttribute('aria-label')).toBe('11月10日（火）、仕事の予定あり、プライベートの予定（すべて完了）')
    // 地の上書き（.yr-cell の地なし）より休みの地が強い・日のマスの上の線は 2px の --rule-strong
  })

  it('データが変わると、そのマスの●と読み上げを描き直す（マスごとの React.memo が古い印を残さない。7.9）', async () => {
    await renderView(YearView, props(), { data: sample() })
    expect(dots('2026-11-10')).toEqual(['work:open', 'private:allDone'])
    await act(async () => {
      const { actions } = await import('../../../store/actions')
      actions.setItemDone('w1', true)
    })
    expect(dots('2026-11-10')).toEqual(['work:allDone', 'private:allDone'])
    expect(cell('2026-11-10').getAttribute('aria-label')).toBe(
      '11月10日（火）、仕事の予定（すべて完了）、プライベートの予定（すべて完了）',
    )
    await act(async () => {
      const { actions } = await import('../../../store/actions')
      actions.setItemDone('w1', false)
    })
    expect(dots('2026-11-10')).toEqual(['work:open', 'private:allDone'])
  })

  it('日付が変わると（0時を過ぎる）、今日の枠を次の日のマスへ移す（7.3）', async () => {
    const { setProps } = await renderView(YearView, props(), { data: sample() })
    expect(view().querySelectorAll('.yr-cell.is-today')).toHaveLength(1)
    setProps(props({ today: '2026-11-11' }))
    expect([...view().querySelectorAll('.yr-cell.is-today')].map((c) => c.getAttribute('data-date'))).toEqual(['2026-11-11'])
    expect(cell('2026-11-10').hasAttribute('aria-current')).toBe(false)
    // 月が替わると今月の帯も移る
    setProps(props({ today: '2026-12-01' }))
    expect(screen.getByTestId(testIds.yearMonth(12)).classList.contains('today-mark')).toBe(true)
    expect(screen.getByTestId(testIds.yearMonth(11)).classList.contains('today-mark')).toBe(false)
  })
})

describe('押した時（7.12・8.4。CALENDAR-186・187・223・224）', () => {
  it('日のマスはその日の月のマンスリーへ（置き換える。3.1。見ている日はその日）', async () => {
    const { router } = await renderAt('/year/2026', { data: sample() })
    // jsdom の領域は 0×0 なので小さな月（押した時の動きは同じ）
    await userEvent.setup().click(cell('2026-11-28'))
    expect(router.state.location.pathname).toBe('/month/2026-11')
    expect(router.state.historyAction).toBe('REPLACE')
    expect(useCalendarUi.getState().viewed).toBe('2026-11-28')
  })

  it.each([
    ['rows', 994],
    ['mini', 794],
  ])('%s: 月の見出しはその月の1日を見ている日にしてマンスリーへ', async (_, width) => {
    const { router } = await renderView(YearView, props({ area: { width, height: 700 } }), { path: '/year/2026' })
    await userEvent.setup().click(screen.getByTestId(testIds.yearMonth(2)))
    expect(router.state.location.pathname).toBe('/month/2026-02')
    expect(useCalendarUi.getState().viewed).toBe('2026-02-01')
    expect(screen.getByTestId(testIds.yearMonth(2)).getAttribute('aria-label')).toBe('2026年2月をマンスリーで見る')
  })

  it('何も直せない（休みも付けられない。押してもデータは変わらない。CALENDAR-203）', async () => {
    const { router } = await renderView(YearView, props(), { path: '/year/2026', data: sample() })
    const before = useApp.getState().data
    await userEvent.setup().click(cell('2026-11-12'))
    expect(router.state.location.pathname).toBe('/month/2026-11')
    expect(useCalendarUi.getState().offMode).toBe(false)
    expect(useApp.getState().data.offDays).toBe(before.offDays)
    expect(useApp.getState().data.items).toBe(before.items)
  })
})

describe('キーボード（4.12）', () => {
  it('Tab で止まるのは見ている日のマスだけ。矢印キーで動くと、そのマスが Tab で止まるマスになる（受け持ったキーは preventDefault）', async () => {
    await renderView(YearView, props(), { path: '/year/2026' })
    const tabbable = () => [...view().querySelectorAll('.yr-cell')].filter((c) => (c as HTMLElement).tabIndex === 0)
    expect(tabbable().map((c) => c.getAttribute('data-date'))).toEqual(['2026-11-10'])
    act(() => cell('2026-11-10').focus())
    // 月を行・日を列: → は次の日、↓ は次の月の同じ日、Home は1日
    expect(fireEvent.keyDown(cell('2026-11-10'), { key: 'ArrowRight' })).toBe(false)
    expect(document.activeElement).toBe(cell('2026-11-11'))
    fireEvent.keyDown(cell('2026-11-11'), { key: 'ArrowDown' })
    expect(document.activeElement).toBe(cell('2026-12-11'))
    fireEvent.keyDown(cell('2026-12-11'), { key: 'Home' })
    expect(document.activeElement).toBe(cell('2026-12-01'))
    expect(tabbable().map((c) => c.getAttribute('data-date'))).toEqual(['2026-12-01'])
    // 年の端では動かないが、ページはスクロールさせない
    fireEvent.keyDown(cell('2026-12-01'), { key: 'ArrowDown' })
    expect(document.activeElement).toBe(cell('2026-12-01'))
    // 受け持たないキー・修飾キー付きは見送る
    expect(fireEvent.keyDown(cell('2026-12-01'), { key: 'a' })).toBe(true)
    expect(fireEvent.keyDown(cell('2026-12-01'), { key: 'ArrowRight', shiftKey: true })).toBe(true)
    // 月の見出しの帯は、それぞれ Tab で止まるボタン
    expect(screen.getByTestId(testIds.yearMonth(1)).tabIndex).toBe(0)
  })

  it('小さな月では ↑ ↓ が前・次の週', async () => {
    await renderView(YearView, props({ area: { width: 794, height: 700 } }), { path: '/year/2026' })
    act(() => cell('2026-11-10').focus())
    fireEvent.keyDown(cell('2026-11-10'), { key: 'ArrowDown' })
    expect(document.activeElement).toBe(cell('2026-11-17'))
  })

  it('見ている日が替わると（‹ › など）、Tab で止まるマスは見ている日に戻る', async () => {
    const { setProps } = await renderView(YearView, props(), { path: '/year/2026' })
    act(() => cell('2026-03-03').focus())
    expect(cell('2026-03-03').tabIndex).toBe(0)
    setProps(props({ viewed: '2027-11-10' }))
    expect(cell('2027-11-10').tabIndex).toBe(0)
    expect(view().querySelectorAll('.yr-cell[tabindex="0"]')).toHaveLength(1)
  })

  it('同じ年の中で見ている日が替わっても（マンスリーから来た年で［今日］など）、Tab で止まるマスは見ている日に戻る', async () => {
    const { setProps } = await renderView(YearView, props({ viewed: '2026-03-15' }), { path: '/year/2026' })
    expect(cell('2026-03-15').tabIndex).toBe(0)
    act(() => cell('2026-03-03').focus())
    expect(cell('2026-03-03').tabIndex).toBe(0)
    setProps(props({ viewed: '2026-11-10' }))
    expect([...view().querySelectorAll('.yr-cell[tabindex="0"]')].map((c) => c.getAttribute('data-date'))).toEqual(['2026-11-10'])
  })

  it('日のマスにフォーカスがある時に並べ方が替わったら（870px をまたいだ）、新しい並べ方の同じ日のマスへフォーカスを移す（開発）', async () => {
    const { setProps } = await renderView(YearView, props(), { path: '/year/2026' })
    act(() => cell('2026-03-03').focus())
    const before = cell('2026-03-03')
    setProps(props({ area: { width: 794, height: 700 } }))
    expect(view().getAttribute('data-layout')).toBe('mini')
    expect(cell('2026-03-03')).not.toBe(before)
    expect(document.activeElement).toBe(cell('2026-03-03'))
    // 矢印キーで続けて動ける（小さな月の ↓ は次の週）
    fireEvent.keyDown(cell('2026-03-03'), { key: 'ArrowDown' })
    expect(document.activeElement).toBe(cell('2026-03-10'))
    setProps(props({ area: { width: 994, height: 700 } }))
    expect(view().getAttribute('data-layout')).toBe('rows')
    expect(document.activeElement).toBe(cell('2026-03-10'))
  })

  it('日のマスにフォーカスが無い時は、並べ方が替わってもフォーカスを動かさない', async () => {
    const { setProps } = await renderView(YearView, props(), { path: '/year/2026' })
    const month = screen.getByTestId(testIds.yearMonth(3))
    act(() => month.focus())
    setProps(props({ area: { width: 794, height: 700 } }))
    expect(document.activeElement?.classList.contains('yr-cell')).toBe(false)
  })

  it('並べ方が替わっても（窓の幅を変えた時）、Tab で止まるマスはフォーカスの来たマスのまま', async () => {
    const { setProps } = await renderView(YearView, props(), { path: '/year/2026' })
    act(() => cell('2026-03-03').focus())
    setProps(props({ area: { width: 794, height: 700 } }))
    expect(view().getAttribute('data-layout')).toBe('mini')
    expect([...view().querySelectorAll('.yr-cell[tabindex="0"]')].map((c) => c.getAttribute('data-date'))).toEqual(['2026-03-03'])
  })
})
