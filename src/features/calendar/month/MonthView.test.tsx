// マンスリーの画面（docs/SPEC.md の 9.・7.12・3.10。D06・D19・D29・D30・D32。CALENDAR-227〜259・FRAME-066・103・133・158・255・281）
import { act, fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { mkItem, mkOffDay } from '../../../domain/testData'
import type { AppData } from '../../../domain/types'
import { useApp } from '../../../store/appStore'
import { useCalendarUi } from '../../../store/uiStore'
import { renderAt, setupCalendarTests } from '../../../test/renderCalendar'
import { testIds } from '../common/testIds'

setupCalendarTests()

/** 11月の見本: 11/10 は仕事 2・プライベート 1、11/12 は仕事 1（プライベートは飾りの 0）、11/11 は休み */
function sample(): Partial<AppData> {
  return {
    items: {
      w1: mkItem({ id: 'w1', start: '2026-11-10' }),
      w2: mkItem({ id: 'w2', start: '2026-11-09', due: '2026-11-10' }),
      p1: mkItem({ id: 'p1', kind: 'private', start: '2026-11-10' }),
      w3: mkItem({ id: 'w3', start: '2026-11-12' }),
      d1: mkItem({ id: 'd1', start: '2026-11-13', done: true, doneAt: 1, doneOn: '2026-11-13' }),
    },
    offDays: { '2026-11-11': mkOffDay('2026-11-11') },
  }
}

const cell = (date: string) => screen.getByTestId(testIds.monthCell(date))
/** マスいっぱいのボタン */
const hit = (date: string) => cell(date).querySelector('.mo-hit') as HTMLButtonElement
const count = (date: string, kind: 'work' | 'private') => screen.getByTestId(testIds.monthCount(date, kind))
const offOn = (date: string) => useApp.getState().data.offDays[date]?.off

describe('マス目と中身（9.1・9.2）', () => {
  it('曜日の行（SUN〜SAT・丸いラベルにしない）と、その月に掛かる週の数のマス（2026年11月は5行・35マス）', async () => {
    await renderAt('/month/2026-11', { data: sample() })
    const month = screen.getByTestId('calendar-month')
    expect(month.getAttribute('data-rows')).toBe('5')
    const head = month.querySelector('.mo-head') as HTMLElement
    expect(head.getAttribute('aria-hidden')).toBe('true')
    expect([...head.children].map((e) => e.textContent)).toEqual(['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'])
    expect([...head.children].map((e) => e.getAttribute('data-tone'))).toEqual(['sun', null, null, null, null, null, 'sat'])
    expect(head.querySelector('.pill')).toBeNull()
    const cells = month.querySelectorAll('.cal-cell')
    expect(cells).toHaveLength(35)
    expect(cells[0].getAttribute('data-testid')).toBe(testIds.monthCell('2026-11-01'))
    expect(cells[34].getAttribute('data-testid')).toBe(testIds.monthCell('2026-12-05'))
    // 仮の画面の文はもう無い（e2e/samples が「まだ撮れない」と見分ける文）
    expect(screen.getByTestId(testIds.view('month')).textContent).not.toMatch(/段階2で/)
  })

  it('今日は日付の丸（.today-mark・aria-current）、休みの日は地と「休」、祝日は日付の色と右上の祝日名（L）', async () => {
    await renderAt('/month/2026-11', { data: sample() })
    const marks = screen.getByTestId('calendar-month').querySelectorAll('.today-mark')
    expect([...marks].map((m) => m.textContent)).toEqual(['10'])
    expect(marks[0].classList.contains('is-today')).toBe(true)
    expect(hit('2026-11-10').getAttribute('aria-current')).toBe('date')
    expect(cell('2026-11-11').classList.contains('cp-offday')).toBe(true)
    expect(cell('2026-11-11').querySelector('.cp-off')?.textContent).toContain('休')
    expect(cell('2026-11-12').classList.contains('cp-offday')).toBe(false)
    expect(cell('2026-11-03').getAttribute('data-tone')).toBe('sun')
    expect(cell('2026-11-03').querySelector('.cp-holiday')?.textContent).toBe('文化の日')
    expect(cell('2026-11-07').getAttribute('data-tone')).toBe('sat')
    // 前後の月の日は日付だけ（data-outside）
    expect(cell('2026-12-01').getAttribute('data-outside')).toBe('true')
    expect(cell('2026-12-01').querySelector('.mo-counts')).toBeNull()
  })

  it('L・M: 件数「2 / 1」は仕事・プライベートの別々のボタン。片方が 0 なら飾りの「0」もボタン、両方 0 の日は何も書かない（D19・D29）', async () => {
    await renderAt('/month/2026-11', { data: sample() })
    expect(count('2026-11-10', 'work').tagName).toBe('BUTTON')
    expect(count('2026-11-10', 'work').textContent).toBe('2')
    expect(count('2026-11-10', 'work').getAttribute('aria-label')).toBe('仕事 2件をデイリーで見る')
    expect(count('2026-11-10', 'private').textContent).toBe('1')
    expect(cell('2026-11-10').querySelector('.mo-sep')?.textContent).toBe('/')
    const zero = count('2026-11-12', 'private')
    expect([zero.tagName, zero.textContent, zero.classList.contains('is-zero')]).toEqual(['BUTTON', '0', true])
    expect(count('2026-11-12', 'work').classList.contains('is-zero')).toBe(false)
    // 全部完了した日・何も無い日
    expect(cell('2026-11-13').querySelector('.mo-counts')).toBeNull()
    expect(cell('2026-11-14').querySelector('.mo-counts')).toBeNull()
    // マスのボタンの読み上げは1つにまとめる（4.12）
    expect(hit('2026-11-10').getAttribute('aria-label')).toBe('11月10日（火）、仕事 2件、プライベート 1件')
    expect(hit('2026-11-11').getAttribute('aria-label')).toBe('11月11日（水）、予定なし、休み')
    expect(hit('2026-11-03').getAttribute('aria-label')).toBe('11月3日（火）、予定なし、文化の日')
    // 中身の字は読み上げない（ボタンの読み上げと重ならないように）
    expect(cell('2026-11-10').querySelector('.mo-top')?.getAttribute('aria-hidden')).toBe('true')
  })

  it('S: 件数は「2/1」の字だけ（ボタンにしない）、祝日名は出さない。マスのボタンは1つ（D19・CALENDAR-067・239）', async () => {
    await renderAt('/month/2026-11', { data: sample(), width: 'S' })
    expect(screen.getByTestId('calendar-month').classList.contains('is-compact')).toBe(true)
    expect(count('2026-11-10', 'work').tagName).toBe('SPAN')
    expect(cell('2026-11-10').querySelector('.mo-counts')?.textContent).toBe('2/1')
    expect(within(cell('2026-11-10')).getAllByRole('button')).toHaveLength(1)
    expect(cell('2026-11-03').querySelector('.cp-holiday')).toBeNull()
    expect(cell('2026-11-03').getAttribute('data-tone')).toBe('sun')
    // 祝日名は読み上げには入れる
    expect(hit('2026-11-03').getAttribute('aria-label')).toBe('11月3日（火）、予定なし、文化の日')
  })

  it('どちらかが「99+」のマスは件数の行に is-wide（字を小さくして「99+」を半分の幅に収める。7.6・D27）', async () => {
    const items = Object.fromEntries(
      Array.from({ length: 100 }, (_, i) => [`m${i}`, mkItem({ id: `m${i}`, kind: 'private', start: '2026-11-20' })]),
    )
    await renderAt('/month/2026-11', { data: { ...sample(), items: { ...sample().items, ...items } }, width: 'S' })
    expect(cell('2026-11-20').querySelector('.mo-counts')?.textContent).toBe('0/99+')
    expect(cell('2026-11-20').querySelector('.mo-counts')?.classList.contains('is-wide')).toBe(true)
    expect(cell('2026-11-10').querySelector('.mo-counts')?.classList.contains('is-wide')).toBe(false)
  })

  it('予定を完了にすると、その期間の毎日の数が減る（7.6）', async () => {
    await renderAt('/month/2026-11', { data: sample() })
    expect(count('2026-11-09', 'work').textContent).toBe('1')
    await act(async () => {
      const { actions } = await import('../../../store/actions')
      actions.setItemDone('w2', true)
    })
    expect(cell('2026-11-09').querySelector('.mo-counts')).toBeNull()
    expect(count('2026-11-10', 'work').textContent).toBe('1')
  })
})

describe('押した時（7.12・9.3）', () => {
  it.each(['L', 'M'] as const)(
    '%s: 数字はその日のデイリーへ（置き換える。3.1）、押した区分の区切りと予定を目立たせる（CALENDAR-188・247）',
    async (width) => {
      const user = userEvent.setup()
      const { router } = await renderAt('/month/2026-11', { data: sample(), width })
      await user.click(count('2026-11-10', 'private'))
      expect(router.state.location.pathname).toBe('/day/2026-11-10')
      expect(router.state.historyAction).toBe('REPLACE')
      expect(useCalendarUi.getState().flash?.keys).toEqual(['day-area:private', 'day-events:private'])
      expect(useCalendarUi.getState().viewed).toBe('2026-11-10')
    },
  )

  it('飾りの「0」も同じ（その区分を目立たせる。D29）', async () => {
    const user = userEvent.setup()
    const { router } = await renderAt('/month/2026-11', { data: sample() })
    await user.click(count('2026-11-12', 'private'))
    expect(router.state.location.pathname).toBe('/day/2026-11-12')
    expect(useCalendarUi.getState().flash?.keys).toEqual(['day-area:private', 'day-events:private'])
  })

  it('L・M: マスのほかの所はその日のデイリーへ（目立たせない。CALENDAR-189・248）', async () => {
    const user = userEvent.setup()
    const { router } = await renderAt('/month/2026-11', { data: sample() })
    await user.click(hit('2026-11-12'))
    expect(router.state.location.pathname).toBe('/day/2026-11-12')
    expect(router.state.historyAction).toBe('REPLACE')
    expect(useCalendarUi.getState().flash).toBeNull()
  })

  it('数字からデイリーへ移って、目立たせるキーが消える前にマンスリーへ戻ってマスを押しても、前の数字の区分は目立たせない（CALENDAR-189）', async () => {
    const user = userEvent.setup()
    const { router } = await renderAt('/month/2026-11', { data: sample() })
    await user.click(count('2026-11-10', 'private'))
    expect(useCalendarUi.getState().flash?.keys).toEqual(['day-area:private', 'day-events:private'])
    await user.click(screen.getByTestId(testIds.calMode('month')))
    expect(router.state.location.pathname).toBe('/month/2026-11')
    await user.click(hit('2026-11-12'))
    expect(router.state.location.pathname).toBe('/day/2026-11-12')
    expect(useCalendarUi.getState().flash).toBeNull()
  })

  it('マスから移る時に消すのはデイリーの区切り・予定のキーだけ（登録した予定などのキーは残す）', async () => {
    const user = userEvent.setup()
    const { router } = await renderAt('/month/2026-11', { data: sample() })
    act(() => useCalendarUi.getState().flashTarget('item:w3'))
    await user.click(hit('2026-11-12'))
    expect(router.state.location.pathname).toBe('/day/2026-11-12')
    expect(useCalendarUi.getState().flash?.keys).toEqual(['item:w3'])
  })

  it('S: マスのどこを押してもその日のデイリーへ（目立たせない。D32・CALENDAR-190・250）', async () => {
    const user = userEvent.setup()
    const { router } = await renderAt('/month/2026-11', { data: sample(), width: 'S' })
    await user.click(hit('2026-11-10'))
    expect(router.state.location.pathname).toBe('/day/2026-11-10')
    expect(useCalendarUi.getState().flash).toBeNull()
  })

  it('前後の月の日はその月のマンスリーへ（同じモードの中なので置き換える。見ている日はその日。CALENDAR-191・233）', async () => {
    const user = userEvent.setup()
    const { router } = await renderAt('/month/2026-11', { data: sample() })
    await user.click(hit('2026-12-02'))
    expect(router.state.location.pathname).toBe('/month/2026-12')
    expect(router.state.historyAction).toBe('REPLACE')
    expect(useCalendarUi.getState().viewed).toBe('2026-12-02')
  })
})

describe('休みを付ける状態（9.5・D30）', () => {
  async function openOffMode(opts: { width?: 'S' | 'L' } = {}) {
    const user = userEvent.setup()
    const r = await renderAt('/month/2026-11', { data: sample(), ...opts })
    await user.click(screen.getByTestId(testIds.calOff))
    return { user, ...r }
  }

  it('［休み］を押すと押した状態になり、帯と点線の枠を出す。数字もボタンにせず、マスのボタンは今の休みを伝える（CALENDAR-252〜255）', async () => {
    const { user } = await openOffMode()
    expect(useCalendarUi.getState().offMode).toBe(true)
    expect(screen.getByTestId(testIds.calOff).getAttribute('aria-pressed')).toBe('true')
    const banner = screen.getByTestId(testIds.offBanner)
    expect(banner.textContent).toContain('休みを付ける: 日付を押すと休みが付いたり外れたりします')
    expect(within(banner).getByTestId(testIds.offEnd).textContent).toBe('終わる')
    expect(screen.getByTestId('calendar-month').classList.contains('is-off')).toBe(true)
    expect(count('2026-11-10', 'work').tagName).toBe('SPAN')
    expect(within(cell('2026-11-10')).getAllByRole('button')).toHaveLength(1)
    expect(hit('2026-11-11').getAttribute('aria-pressed')).toBe('true')
    expect(hit('2026-11-12').getAttribute('aria-pressed')).toBe('false')
    // もう一度押すと終わる（CALENDAR-256）
    await user.click(screen.getByTestId(testIds.calOff))
    expect(useCalendarUi.getState().offMode).toBe(false)
    expect(screen.queryByTestId(testIds.offBanner)).toBeNull()
    expect(hit('2026-11-11').hasAttribute('aria-pressed')).toBe(false)
  })

  it('マスを押すとデイリーへ移らず、その日の休みが付いたり外れたりする（記録は消さずに off を切り替える。前後の月の日も。CALENDAR-046・254・258）', async () => {
    const { user, router } = await openOffMode()
    await user.click(hit('2026-11-12'))
    expect(router.state.location.pathname).toBe('/month/2026-11')
    expect(offOn('2026-11-12')).toBe(true)
    expect(cell('2026-11-12').classList.contains('cp-offday')).toBe(true)
    await user.click(hit('2026-11-11'))
    expect(offOn('2026-11-11')).toBe(false)
    expect(useApp.getState().data.offDays['2026-11-11']).toBeTruthy()
    await user.click(hit('2026-12-02'))
    expect(router.state.location.pathname).toBe('/month/2026-11')
    expect(offOn('2026-12-02')).toBe(true)
    expect(cell('2026-12-02').querySelector('.cp-off')).toBeTruthy()
    expect(useCalendarUi.getState().flash).toBeNull()
  })

  it('S でも同じ（マスを押すと休みが付く）', async () => {
    const { user, router } = await openOffMode({ width: 'S' })
    await user.click(hit('2026-11-10'))
    expect(router.state.location.pathname).toBe('/month/2026-11')
    expect(offOn('2026-11-10')).toBe(true)
  })

  it('［終わる］で終わり、フォーカスは操作の列の［休み］へ', async () => {
    const { user } = await openOffMode()
    await user.click(screen.getByTestId(testIds.offEnd))
    expect(useCalendarUi.getState().offMode).toBe(false)
    expect(screen.queryByTestId(testIds.offBanner)).toBeNull()
    expect(document.activeElement).toBe(screen.getByTestId(testIds.calOff))
  })

  it('Esc で終わる。ほかの部品が先に受けた Esc（preventDefault 済み）では終わらない（FRAME-103・CALENDAR-268）', async () => {
    await openOffMode()
    const prevented = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    prevented.preventDefault()
    act(() => {
      document.body.dispatchEvent(prevented)
    })
    expect(useCalendarUi.getState().offMode).toBe(true)
    fireEvent.keyDown(document.body, { key: 'Escape', isComposing: true })
    expect(useCalendarUi.getState().offMode).toBe(true)
    // Safari は変換を取り消す Esc を、変換が終わってから keyCode 229 で送る
    fireEvent.keyDown(document.body, { key: 'Escape', keyCode: 229 })
    expect(useCalendarUi.getState().offMode).toBe(true)
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(useCalendarUi.getState().offMode).toBe(false)
  })

  it('［終わる］にフォーカスがある時に Esc で終えると、フォーカスは操作の列の［休み］へ（帯と一緒に消えないように）', async () => {
    await openOffMode()
    const end = screen.getByTestId(testIds.offEnd)
    act(() => end.focus())
    fireEvent.keyDown(end, { key: 'Escape' })
    expect(useCalendarUi.getState().offMode).toBe(false)
    expect(document.activeElement).toBe(screen.getByTestId(testIds.calOff))
  })

  it('［＋ 登録］を開いても続き、その画面で Esc を押すと画面だけが閉じる（D30）', async () => {
    const { user, router } = await openOffMode()
    await user.click(screen.getByTestId(testIds.calAdd))
    expect(screen.getByTestId(testIds.itemSheet)).toBeTruthy()
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    expect(screen.queryByTestId(testIds.itemSheet)).toBeNull()
    expect(router.state.location.pathname).toBe('/month/2026-11')
    expect(useCalendarUi.getState().offMode).toBe(true)
    expect(screen.getByTestId(testIds.offBanner)).toBeTruthy()
  })

  it('‹ ›・［今日］でほかの月へ移っても続く（CALENDAR-257）', async () => {
    const { user, router } = await openOffMode()
    await user.click(screen.getByTestId(testIds.calNext))
    expect(router.state.location.pathname).toBe('/month/2026-12')
    expect(useCalendarUi.getState().offMode).toBe(true)
    await user.click(hit('2026-12-24'))
    expect(offOn('2026-12-24')).toBe(true)
    await user.click(screen.getByTestId(testIds.calToday))
    expect(router.state.location.pathname).toBe('/month/2026-11')
    expect(screen.getByTestId(testIds.offBanner)).toBeTruthy()
  })

  it('モードを替える・「戻る」でマンスリーを離れる・設定を開くと終わる（CALENDAR-256・D30）', async () => {
    const { user, router } = await openOffMode()
    await user.click(screen.getByTestId(testIds.calMode('week')))
    expect(useCalendarUi.getState().offMode).toBe(false)
    // 週の後ろに月を積んで入り直し（アプリでは、カレンダーの中の行き来は積まない。ここでは「戻る」でマンスリーを離れる時を作る）、
    // 「戻る」で週へ
    await act(() => router.navigate('/month/2026-11'))
    await user.click(screen.getByTestId(testIds.calOff))
    expect(useCalendarUi.getState().offMode).toBe(true)
    await act(() => router.navigate(-1))
    expect(router.state.location.pathname).toBe('/week/2026-11-08')
    expect(useCalendarUi.getState().offMode).toBe(false)
    // 月へ戻って入り直し、設定の画面へ
    await act(() => router.navigate('/month/2026-11'))
    await user.click(screen.getByTestId(testIds.calOff))
    expect(useCalendarUi.getState().offMode).toBe(true)
    await act(() => router.navigate('/settings'))
    await screen.findByTestId('app-settings')
    expect(useCalendarUi.getState().offMode).toBe(false)
  })
})

describe('キーボード（PC。マスの間は矢印キー。4.12・開発）', () => {
  /** Tab で止まるマス（tabIndex 0 のマスのボタン）の日付 */
  const tabbable = () =>
    [...screen.getByTestId('calendar-month').querySelectorAll<HTMLButtonElement>('.mo-hit')]
      .filter((b) => b.tabIndex === 0)
      .map((b) => b.closest<HTMLElement>('[data-date]')?.dataset.date)
  /** フォーカスのあるボタンのマスの日付 */
  const focusedDate = () => (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('[data-date]')?.dataset.date
  const key = (k: string, init: KeyboardEventInit = {}) =>
    fireEvent.keyDown(document.activeElement ?? document.body, { key: k, ...init })

  it('Tab で止まるのは見ている日（今日）のマスのボタンと、その数字のボタンだけ（ほかのマスは tabIndex -1）', async () => {
    await renderAt('/month/2026-11', { data: sample() })
    expect(tabbable()).toEqual(['2026-11-10'])
    expect(count('2026-11-10', 'work').tabIndex).toBe(0)
    expect(count('2026-11-10', 'private').tabIndex).toBe(0)
    expect(count('2026-11-12', 'work').tabIndex).toBe(-1)
    expect(count('2026-11-12', 'private').tabIndex).toBe(-1)
  })

  it('← → ↑ ↓・Home・End でマスからマスへフォーカスが動き、Tab で止まるマスも移る。端では動かない（ページもスクロールしない）', async () => {
    await renderAt('/month/2026-11', { data: sample() })
    act(() => hit('2026-11-10').focus())
    // 受け持ったキーは preventDefault（fireEvent は止められた時に false を返す）
    expect(key('ArrowRight')).toBe(false)
    expect(focusedDate()).toBe('2026-11-11')
    expect(tabbable()).toEqual(['2026-11-11'])
    key('ArrowDown')
    expect(focusedDate()).toBe('2026-11-18')
    key('Home')
    expect(focusedDate()).toBe('2026-11-15')
    key('End')
    expect(focusedDate()).toBe('2026-11-21')
    key('ArrowUp')
    key('ArrowUp')
    key('ArrowUp')
    expect(focusedDate()).toBe('2026-11-07')
    expect(key('ArrowUp')).toBe(false)
    expect(focusedDate()).toBe('2026-11-07')
    // 土曜の → は次の週の日曜へ
    key('ArrowRight')
    expect(focusedDate()).toBe('2026-11-08')
    // 前後の月の日へも動ける（マス目の外へは出ない）
    act(() => hit('2026-11-01').focus())
    key('ArrowLeft')
    expect(focusedDate()).toBe('2026-11-01')
    act(() => hit('2026-12-04').focus())
    key('ArrowRight')
    key('ArrowRight')
    expect(focusedDate()).toBe('2026-12-05')
    expect(tabbable()).toEqual(['2026-12-05'])
  })

  it('数字のボタンから矢印キーを押すと、隣のマスのボタンへ。Shift・Alt・Ctrl・⌘ と一緒の矢印キーは受け持たない', async () => {
    await renderAt('/month/2026-11', { data: sample() })
    act(() => count('2026-11-10', 'private').focus())
    expect(tabbable()).toEqual(['2026-11-10'])
    key('ArrowDown')
    expect(document.activeElement).toBe(hit('2026-11-17'))
    for (const mod of [{ shiftKey: true }, { altKey: true }, { ctrlKey: true }, { metaKey: true }]) {
      expect(key('ArrowRight', mod)).toBe(true)
      expect(focusedDate()).toBe('2026-11-17')
    }
    // Tab・Enter などは受け持たない
    expect(key('Tab')).toBe(true)
  })

  it('Enter でフォーカスのあるマスのデイリーへ。前後の月の日ならその月へ移り、フォーカスはその日のマスに残る', async () => {
    const user = userEvent.setup()
    const { router } = await renderAt('/month/2026-11', { data: sample() })
    act(() => hit('2026-12-01').focus())
    key('ArrowRight')
    await user.keyboard('{Enter}')
    expect(router.state.location.pathname).toBe('/month/2026-12')
    expect(cell('2026-12-02').getAttribute('data-outside')).toBeNull()
    expect(document.activeElement).toBe(hit('2026-12-02'))
    expect(tabbable()).toEqual(['2026-12-02'])
    key('ArrowRight')
    await user.keyboard('{Enter}')
    expect(router.state.location.pathname).toBe('/day/2026-12-03')
  })

  it('‹ › で月を移ると、Tab で止まるのはその月の見ている日（今のマス目に無いマスは使わない）', async () => {
    const user = userEvent.setup()
    await renderAt('/month/2026-11', { data: sample() })
    act(() => hit('2026-11-03').focus())
    expect(tabbable()).toEqual(['2026-11-03'])
    await user.click(screen.getByTestId(testIds.calNext))
    // 11/10 を見ていた 11月の次は 12/10
    expect(tabbable()).toEqual(['2026-12-10'])
  })

  it('前に動いた先が次の月のマス目にもある日でも、‹ ›・［今日］で見ている日が替わった後は見ている日が Tab で止まるマス', async () => {
    const user = userEvent.setup()
    await renderAt('/month/2026-11', { data: sample() })
    // 12/3（11月のマス目の前後の月の日。12月のマス目にもある）へ動いてから ›
    act(() => hit('2026-12-03').focus())
    expect(tabbable()).toEqual(['2026-12-03'])
    await user.click(screen.getByTestId(testIds.calNext))
    expect(tabbable()).toEqual(['2026-12-10'])
    // 12月のマス目の 11/30（11月にもある）へ動いてから ‹
    act(() => hit('2026-11-30').focus())
    await user.click(screen.getByTestId(testIds.calPrev))
    expect(tabbable()).toEqual(['2026-11-10'])
    // 11/20 へ動いて › → ［今日］
    act(() => hit('2026-11-20').focus())
    await user.click(screen.getByTestId(testIds.calNext))
    await user.click(screen.getByTestId(testIds.calToday))
    expect(tabbable()).toEqual(['2026-11-10'])
  })

  it('休みを付ける状態でも矢印キーで動き、Space・Enter でフォーカスのあるマスの休みが付いたり外れたりする', async () => {
    const user = userEvent.setup()
    await renderAt('/month/2026-11', { data: sample() })
    await user.click(screen.getByTestId(testIds.calOff))
    act(() => hit('2026-11-10').focus())
    key('ArrowRight')
    key('ArrowRight')
    await user.keyboard(' ')
    expect(offOn('2026-11-12')).toBe(true)
    expect(document.activeElement).toBe(hit('2026-11-12'))
    expect(hit('2026-11-12').getAttribute('aria-pressed')).toBe('true')
    key('ArrowLeft')
    await user.keyboard('{Enter}')
    expect(offOn('2026-11-11')).toBe(false)
  })

  it('マウスで押したマスも Tab で止まるマスになる', async () => {
    const user = userEvent.setup()
    await renderAt('/month/2026-11', { data: sample() })
    await user.click(screen.getByTestId(testIds.calOff))
    await user.click(hit('2026-11-20'))
    expect(tabbable()).toEqual(['2026-11-20'])
  })
})
