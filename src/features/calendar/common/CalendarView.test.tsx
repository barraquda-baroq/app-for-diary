// カレンダーの領域（docs/SPEC.md の 3.4・3.5・3.7・6.4・7.3）: モードの画面に渡す物（ViewProps。領域の大きさは ResizeObserver）、
// S・M のウィークリー・デイリーの高さの固定、スワイプ（S・M の指だけ。どのモードでも）、期間を移った時にページをめくること、
// 0時を過ぎた時は今日の印だけが移ること、裏から戻って6時間たった時に今日へ移ること（めくらない）、最後の操作の時刻。
// モードの画面は受け取った物を出すだけの物に差し替えて確かめる（めくる部品そのものは PageTurn.test.tsx）
import { act, fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { HOUR, T0 } from '../../../domain/testData'
import { useCalendarUi } from '../../../store/uiStore'
import { renderAt, resizeObserved, setupCalendarTests } from '../../../test/renderCalendar'
import type { ViewProps } from './types'

// モードの画面は、受け取った物をそのまま字にして出す（中身は各モードの担当。ここでは渡し方だけを見る）
const probe = vi.hoisted(() => async (mode: string) => {
  const { createElement } = await import('react')
  return (p: object) =>
    createElement(
      'div',
      { 'data-testid': `view-${mode}` },
      createElement('pre', { 'data-testid': 'view-props' }, JSON.stringify(p)),
    )
})
vi.mock('../year/YearView', async () => ({ YearView: await probe('year') }))
vi.mock('../month/MonthView', async () => ({ MonthView: await probe('month') }))
vi.mock('../week/WeekView', async () => ({ WeekView: await probe('week') }))
vi.mock('../day/DayView', async () => ({ DayView: await probe('day') }))

setupCalendarTests()

/** モードの画面が受け取った物 */
const props = (): ViewProps => JSON.parse(screen.getByTestId('view-props').textContent ?? '{}') as ViewProps

/** 画面が見えている・隠れているの切り替え（visibilitychange） */
function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'))
  })
}

/** 指（pointerType）で要素の上をなぞる（押す → 離す） */
function drag(el: Element, from: [number, number], to: [number, number], pointerType = 'touch', cancel = false) {
  act(() => {
    fireEvent(
      el,
      new PointerEvent('pointerdown', {
        bubbles: true,
        pointerType,
        pointerId: 3,
        isPrimary: true,
        clientX: from[0],
        clientY: from[1],
      }),
    )
    if (cancel) document.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerType, pointerId: 3 }))
    document.dispatchEvent(
      new PointerEvent('pointerup', { bubbles: true, pointerType, pointerId: 3, clientX: to[0], clientY: to[1] }),
    )
  })
}

describe('モードの画面に渡す物（ViewProps）', () => {
  it('モード・見ている日・今日・幅の区分・領域の大きさ（ResizeObserver で測る。D53）', async () => {
    await renderAt('/week/2026-11-12', { width: 'M' })
    expect(props()).toMatchObject({ mode: 'week', viewed: '2026-11-12', today: '2026-11-10', width: 'M' })
    const body = screen.getByTestId('calendar-body')
    act(() => resizeObserved(869, 500, body))
    expect(props().area).toEqual({ width: 869, height: 500 })
    act(() => resizeObserved(870, 512, body))
    expect(props().area).toEqual({ width: 870, height: 512 })
  })

  it('モードを替えるとそのモードの画面だけを出す', async () => {
    const user = userEvent.setup()
    await renderAt('/month/2026-11')
    expect(screen.getByTestId('view-month')).toBeTruthy()
    await user.click(screen.getByTestId('cal-mode-year'))
    expect(screen.getByTestId('view-year')).toBeTruthy()
    expect(screen.queryByTestId('view-month')).toBeNull()
    expect(props()).toMatchObject({ mode: 'year', viewed: '2026-11-10', width: 'L' })
  })
})

describe('高さ（3.4・3.5。D15）', () => {
  it.each([
    ['S', '/week/2026-11-08', true],
    ['S', '/day/2026-11-10', true],
    ['M', '/week/2026-11-08', true],
    ['S', '/month/2026-11', false],
    ['M', '/year/2026', false],
    ['L', '/week/2026-11-08', false],
    ['L', '/day/2026-11-10', false],
  ] as const)('%s の %s は高さを固定する: %s（S・M のウィークリー・デイリーだけ）', async (width, path, fixed) => {
    await renderAt(path, { width })
    const cal = screen.getByTestId('calendar')
    expect(cal.classList.contains('is-fixed')).toBe(fixed)
    expect(cal.getAttribute('data-mode')).toBe(path.split('/')[1])
  })
})

describe('スワイプ（3.7。S・M の指だけ。どのモードでも）', () => {
  it('S のマンスリーで左へ 60px 以上なぞると次の月、右へなぞると前の月（置き換える）', async () => {
    const { router } = await renderAt('/month/2026-11', { width: 'S' })
    const body = screen.getByTestId('calendar-body')
    expect(screen.getByTestId('calendar').classList.contains('is-swipe')).toBe(true)
    drag(body, [300, 400], [200, 420])
    expect(router.state.location.pathname).toBe('/month/2026-12')
    expect(router.state.historyAction).toBe('REPLACE')
    drag(screen.getByTestId('calendar-body'), [100, 400], [240, 380])
    drag(screen.getByTestId('calendar-body'), [100, 400], [240, 380])
    expect(router.state.location.pathname).toBe('/month/2026-10')
  })

  it('M のデイリー・イヤーでも前後へ', async () => {
    const { router } = await renderAt('/day/2026-11-10', { width: 'M' })
    drag(screen.getByTestId('calendar-body'), [300, 400], [200, 400])
    expect(router.state.location.pathname).toBe('/day/2026-11-11')
    await act(() => router.navigate('/year/2026'))
    drag(screen.getByTestId('calendar-body'), [100, 400], [200, 400])
    expect(router.state.location.pathname).toBe('/year/2025')
  })

  it('短い（59px）・斜め（31°）・縦のスクロールで止められた・マウスの時は移らない', async () => {
    const { router } = await renderAt('/month/2026-11', { width: 'S' })
    const body = () => screen.getByTestId('calendar-body')
    drag(body(), [300, 400], [241, 400])
    drag(body(), [300, 400], [200, 400 + 100 * Math.tan((31 * Math.PI) / 180)])
    drag(body(), [300, 400], [100, 400], 'touch', true)
    drag(body(), [300, 400], [100, 400], 'mouse')
    expect(router.state.location.pathname).toBe('/month/2026-11')
  })

  it('長押し（400ms 止まってから動かす。ドラッグの掴み方）ではなぞったとみなさない。すぐ動かせばなぞる', async () => {
    const { router } = await renderAt('/month/2026-11', { width: 'S' })
    const body = screen.getByTestId('calendar-body')
    const gesture = (holdMs: number) =>
      act(() => {
        const t = Date.now()
        const ev = (type: string, x: number) =>
          new PointerEvent(type, { bubbles: true, pointerType: 'touch', pointerId: 4, isPrimary: true, clientX: x, clientY: 300 })
        fireEvent(body, ev('pointerdown', 300))
        vi.setSystemTime(t + holdMs)
        document.dispatchEvent(ev('pointermove', 290))
        document.dispatchEvent(ev('pointermove', 150))
        document.dispatchEvent(ev('pointerup', 150))
        vi.setSystemTime(t)
      })
    gesture(450)
    expect(router.state.location.pathname).toBe('/month/2026-11')
    gesture(120)
    expect(router.state.location.pathname).toBe('/month/2026-12')
  })

  it('ウィークリーも S・M ではなぞると前後の週へ（置き換える。22. の段階2の終わりの確かめ。左へなぞる＝次の週）', async () => {
    const week = await renderAt('/week/2026-11-08', { width: 'S' })
    expect(screen.getByTestId('calendar').classList.contains('is-swipe')).toBe(true)
    drag(screen.getByTestId('calendar-body'), [300, 400], [100, 400])
    expect(week.router.state.location.pathname).toBe('/week/2026-11-15')
    expect(week.router.state.historyAction).toBe('REPLACE')
    drag(screen.getByTestId('calendar-body'), [100, 400], [300, 400])
    drag(screen.getByTestId('calendar-body'), [100, 400], [300, 400])
    expect(week.router.state.location.pathname).toBe('/week/2026-11-01')
    week.unmount()

    const tablet = await renderAt('/week/2026-11-08', { width: 'M' })
    drag(screen.getByTestId('calendar-body'), [300, 400], [100, 400])
    expect(tablet.router.state.location.pathname).toBe('/week/2026-11-15')
  })

  it('文字を打っている間（入力欄にフォーカス）・入力欄の上から・横にスクロールできる所の上から・ドラッグ中はなぞっても移らない', async () => {
    const { router } = await renderAt('/week/2026-11-08', { width: 'S' })
    const body = screen.getByTestId('calendar-body')
    const view = screen.getByTestId('view-week')
    // すばやく足すの入力欄の代わり
    const input = document.createElement('input')
    view.appendChild(input)
    act(() => input.focus())
    drag(body, [300, 400], [100, 400])
    expect(router.state.location.pathname).toBe('/week/2026-11-08')
    // 入力欄の上から押した時（フォーカスが無くても）
    act(() => input.blur())
    drag(input, [300, 400], [100, 400])
    expect(router.state.location.pathname).toBe('/week/2026-11-08')
    // 横にスクロールできる所の上から
    const wide = document.createElement('div')
    wide.style.overflowX = 'auto'
    Object.defineProperty(wide, 'scrollWidth', { configurable: true, value: 800 })
    Object.defineProperty(wide, 'clientWidth', { configurable: true, value: 300 })
    const inner = document.createElement('span')
    wide.appendChild(inner)
    view.appendChild(wide)
    drag(inner, [300, 400], [100, 400])
    expect(router.state.location.pathname).toBe('/week/2026-11-08')
    // ドラッグ中（dnd-kit が掴んだ物に付ける印）
    const grabbed = document.createElement('div')
    grabbed.setAttribute('data-dnd-dragging', '')
    view.appendChild(grabbed)
    drag(body, [300, 400], [100, 400])
    expect(router.state.location.pathname).toBe('/week/2026-11-08')
    grabbed.remove()
    // チェックの欄（押すだけの物）の上からはなぞれる
    const check = document.createElement('input')
    check.type = 'checkbox'
    view.appendChild(check)
    drag(check, [300, 400], [100, 400])
    expect(router.state.location.pathname).toBe('/week/2026-11-15')
  })

  it('操作の列の上から払っても前後へ（なぞりを聞くのはカレンダーの区切りの全部。22. の段階2の終わりの確かめ）', async () => {
    const { router } = await renderAt('/month/2026-11', { width: 'S' })
    drag(screen.getByTestId('calendar-toolbar'), [370, 120], [40, 110])
    expect(router.state.location.pathname).toBe('/month/2026-12')
    // ［年｜月｜週｜日］の上から払い始めても、モードは替わらず期間が移る
    drag(screen.getByTestId('cal-mode-day'), [120, 180], [380, 175])
    expect(router.state.location.pathname).toBe('/month/2026-11')
    expect(router.state.historyAction).toBe('REPLACE')
  })

  it('初めに少し縦へ動いてブラウザに取られた（pointercancel）指も、横に払い続けて離せば移る（touch の出来事で追う）。端末が取った指（touchcancel）・縦のスクロールは移らない', async () => {
    const { router } = await renderAt('/week/2026-11-08', { width: 'S' })
    const body = screen.getByTestId('calendar-body')
    /** touch の出来事（jsdom には Touch が無いので、座標の入った物を持たせる） */
    const touch = (type: string, x: number, y: number, down: boolean) => {
      const ev = new Event(type, { bubbles: true })
      const list = [{ clientX: x, clientY: y }]
      Object.defineProperty(ev, 'touches', { value: down ? list : [] })
      Object.defineProperty(ev, 'changedTouches', { value: list })
      document.dispatchEvent(ev)
    }
    const gesture = (moves: [number, number][], end: 'touchend' | 'touchcancel') =>
      act(() => {
        const pe = (type: string, x: number, y: number) =>
          new PointerEvent(type, { bubbles: true, pointerType: 'touch', pointerId: 7, isPrimary: true, clientX: x, clientY: y })
        fireEvent(body, pe('pointerdown', 360, 500))
        document.dispatchEvent(pe('pointermove', 350, 488))
        document.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerType: 'touch', pointerId: 7 }))
        for (const [x, y] of moves) touch('touchmove', x, y, true)
        const [x, y] = moves[moves.length - 1]
        touch(end, x, y, false)
      })
    gesture(
      [
        [300, 485],
        [180, 472],
        [60, 460],
      ],
      'touchend',
    )
    expect(router.state.location.pathname).toBe('/week/2026-11-15')
    expect(router.state.historyAction).toBe('REPLACE')
    // iPhone の画面の端からの「戻る」の身振りなど、端末が指を取った時
    gesture(
      [
        [300, 485],
        [60, 460],
      ],
      'touchcancel',
    )
    // 縦のスクロール（払い始めが縦）
    gesture(
      [
        [345, 450],
        [330, 200],
      ],
      'touchend',
    )
    expect(router.state.location.pathname).toBe('/week/2026-11-15')
  })

  it('なぞって移った直後（300ms）にカレンダーの中へ来た click は打ち消す（払った指で［年｜月｜週｜日］を押さない）。その後の click は効く', async () => {
    const { router } = await renderAt('/week/2026-11-08', { width: 'S' })
    const now = vi.spyOn(performance, 'now').mockReturnValue(10_000)
    try {
      drag(screen.getByTestId('calendar-body'), [300, 400], [100, 400])
      expect(router.state.location.pathname).toBe('/week/2026-11-15')
      now.mockReturnValue(10_200)
      act(() => screen.getByTestId('cal-mode-day').click())
      expect(router.state.location.pathname).toBe('/week/2026-11-15')
      now.mockReturnValue(10_400)
      act(() => screen.getByTestId('cal-mode-day').click())
      // 見ている日（11/10）を7日送った 11/17
      expect(router.state.location.pathname).toBe('/day/2026-11-17')
    } finally {
      now.mockRestore()
    }
  })

  it('L ではスワイプしない（FRAME-075）', async () => {
    const wide = await renderAt('/month/2026-11', { width: 'L' })
    expect(screen.getByTestId('calendar').classList.contains('is-swipe')).toBe(false)
    drag(screen.getByTestId('calendar-body'), [300, 400], [100, 400])
    expect(wide.router.state.location.pathname).toBe('/month/2026-11')
  })
})

describe('期間を移った時にページをめくる（3.7・4.9。22. の段階2の終わりの確かめ）', () => {
  /** めくっているページの箱（無ければ null） */
  const turn = () => screen.getByTestId('calendar').querySelector<HTMLElement>('.cal-turn')

  it('［›］は次へ（is-next）、［‹］は前へ（is-prev）めくる。めくる箱は .cal-body の横に置き、読み上げに出さず押せない', async () => {
    const user = userEvent.setup()
    await renderAt('/month/2026-11')
    expect(turn()).toBeNull()
    await user.click(screen.getByTestId('cal-next'))
    expect(turn()?.dataset.turn).toBe('next')
    expect(turn()?.getAttribute('aria-hidden')).toBe('true')
    expect(turn()?.hasAttribute('inert')).toBe(true)
    expect(turn()?.previousElementSibling).toBe(screen.getByTestId('calendar-body'))
    expect(screen.getByTestId('calendar').dataset.turning).toBe('next')
    // 写した前の期間には、テストの印が残らない（本物の画面の印は1つのまま）
    expect(screen.getAllByTestId('view-month')).toHaveLength(1)
    expect(turn()?.textContent).toContain('"viewed":"2026-11-10"')
    await user.click(screen.getByTestId('cal-prev'))
    expect(screen.getByTestId('calendar').querySelectorAll('.cal-turn')).toHaveLength(1)
    expect(turn()?.dataset.turn).toBe('prev')
  })

  it('モードを替えた時・［今日］で期間が替わらない時はめくらない。［今日］で期間が替わる時はめくる', async () => {
    const user = userEvent.setup()
    await renderAt('/month/2026-11')
    await user.click(screen.getByTestId('cal-mode-week'))
    expect(turn()).toBeNull()
    await user.click(screen.getByTestId('cal-today'))
    expect(turn()).toBeNull()
    await user.click(screen.getByTestId('cal-next'))
    await user.click(screen.getByTestId('cal-mode-day'))
    expect(turn()).toBeNull()
    await user.click(screen.getByTestId('cal-today'))
    expect(turn()?.dataset.turn).toBe('prev')
  })

  it('なぞって移った時もめくる（S のウィークリー）', async () => {
    await renderAt('/week/2026-11-08', { width: 'S' })
    drag(screen.getByTestId('calendar-body'), [300, 400], [100, 400])
    expect(turn()?.dataset.turn).toBe('next')
  })

  it('視差効果を減らす設定ではめくらない（すぐ替える。4.9）', async () => {
    const user = userEvent.setup()
    const { router } = await renderAt('/month/2026-11', { reducedMotion: true })
    await user.click(screen.getByTestId('cal-next'))
    expect(router.state.location.pathname).toBe('/month/2026-12')
    expect(turn()).toBeNull()
  })
})

describe('今日（6.4・7.3）', () => {
  it('0時を過ぎてフォーカスが戻ると今日だけが変わり、見ている期間は動かさない（FRAME-277・CALENDAR-029）', async () => {
    const { router } = await renderAt('/day/2026-11-10')
    expect(props().today).toBe('2026-11-10')
    vi.setSystemTime(new Date(2026, 10, 11, 0, 0, 5))
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    expect(props()).toMatchObject({ today: '2026-11-11', viewed: '2026-11-10' })
    expect(router.state.location.pathname).toBe('/day/2026-11-10')
  })

  it('月の行き先を直接開いたまま 0時を過ぎて今日が次の月になっても、見ている日は変えない（「週」で前の今日の週へ。FRAME-277・071）', async () => {
    const user = userEvent.setup()
    const { router } = await renderAt('/month/2026-11', { now: new Date(2026, 10, 30, 23, 59) })
    expect(props()).toMatchObject({ today: '2026-11-30', viewed: '2026-11-30' })
    vi.setSystemTime(new Date(2026, 11, 1, 0, 0, 5))
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    expect(props()).toMatchObject({ today: '2026-12-01', viewed: '2026-11-30' })
    expect(router.state.location.pathname).toBe('/month/2026-11')
    await user.click(screen.getByTestId('cal-mode-week'))
    expect(router.state.location.pathname).toBe('/week/2026-11-29')
  })

  it('最後に押した・キーを打った時刻を覚える（capture で拾う。D31）', async () => {
    await renderAt('/month/2026-11')
    useCalendarUi.setState({ lastInteraction: 0 })
    vi.setSystemTime(T0 + HOUR)
    act(() => {
      screen.getByTestId('cal-next').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    })
    expect(useCalendarUi.getState().lastInteraction).toBe(T0 + HOUR)
    vi.setSystemTime(T0 + 2 * HOUR)
    fireEvent.keyDown(document.body, { key: 'a' })
    expect(useCalendarUi.getState().lastInteraction).toBe(T0 + 2 * HOUR)
  })
})

describe('裏から戻って6時間（6.4。FRAME-278・CALENDAR-030）', () => {
  /** 22:00 に最後の操作をして裏へ回り、ms 後に戻る */
  async function leaveAndReturn(path: string, ms: number) {
    const at = new Date(2026, 10, 10, 22, 0).getTime()
    const r = await renderAt(path, { now: at })
    useCalendarUi.setState({ lastInteraction: at })
    setVisibility('hidden')
    vi.setSystemTime(at + ms)
    setVisibility('visible')
    return r
  }

  it('6時間たって、見ている期間が前の今日を含んでいれば、新しい今日を含む期間へ置き換える（開いた時と同じく、ページはめくらない）', async () => {
    const { router } = await leaveAndReturn('/day/2026-11-10', 6 * HOUR)
    expect(router.state.location.pathname).toBe('/day/2026-11-11')
    expect(router.state.historyAction).toBe('REPLACE')
    expect(screen.getByTestId('calendar').querySelector('.cal-turn')).toBeNull()
    expect(useCalendarUi.getState().viewed).toBe('2026-11-11')
    setVisibility('visible')
  })

  it('5時間59分では動かさない', async () => {
    const { router } = await leaveAndReturn('/day/2026-11-10', 6 * HOUR - 60_000)
    expect(router.state.location.pathname).toBe('/day/2026-11-10')
    setVisibility('visible')
  })

  it('一度 6時間より前に戻ってから、操作しないままもう一度裏へ回って 6時間を過ぎた時も移す（前の今日は最後に操作した日）', async () => {
    const at = new Date(2026, 10, 10, 22, 0).getTime()
    const { router } = await leaveAndReturn('/day/2026-11-10', 5 * HOUR)
    expect(router.state.location.pathname).toBe('/day/2026-11-10')
    setVisibility('hidden')
    vi.setSystemTime(at + 6 * HOUR + 60_000)
    setVisibility('visible')
    expect(router.state.location.pathname).toBe('/day/2026-11-11')
  })

  it('開いたまま 0時を過ぎて今日の印だけが移った後でも、操作していなければ、裏から戻った時に移す', async () => {
    const at = new Date(2026, 10, 10, 22, 0).getTime()
    const { router } = await renderAt('/day/2026-11-10', { now: at })
    useCalendarUi.setState({ lastInteraction: at })
    vi.setSystemTime(at + 3 * HOUR)
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    expect(props().today).toBe('2026-11-11')
    vi.setSystemTime(at + 7 * HOUR)
    setVisibility('hidden')
    setVisibility('visible')
    expect(router.state.location.pathname).toBe('/day/2026-11-11')
  })

  it('見ている期間が前の今日を含まなければ動かさない（ほかの週を見ていた）', async () => {
    const { router } = await leaveAndReturn('/week/2026-11-15', 12 * HOUR)
    expect(router.state.location.pathname).toBe('/week/2026-11-15')
    setVisibility('visible')
  })

  it('同じ期間のままでも、見ている日を今日にする（マンスリー）', async () => {
    const user = userEvent.setup()
    const { router } = await leaveAndReturn('/day/2026-11-25', 0)
    await user.click(screen.getByTestId('cal-mode-month'))
    expect(useCalendarUi.getState().viewed).toBe('2026-11-25')
    useCalendarUi.setState({ lastInteraction: new Date(2026, 10, 10, 22, 0).getTime() })
    setVisibility('hidden')
    vi.setSystemTime(new Date(2026, 10, 11, 7, 0))
    setVisibility('visible')
    expect(router.state.location.pathname).toBe('/month/2026-11')
    expect(useCalendarUi.getState().viewed).toBe('2026-11-11')
  })

  it('設定の画面での操作も「最後の操作」に数える（設定から戻ってすぐ裏へ回した時に、設定に入る前の操作から数えない。D31）', async () => {
    const user = userEvent.setup()
    const at = new Date(2026, 10, 10, 22, 0).getTime()
    const { router } = await renderAt('/day/2026-11-10', { now: at })
    useCalendarUi.setState({ lastInteraction: at })
    await act(() => router.navigate('/settings'))
    await screen.findByTestId('app-settings')
    // 設定の画面で 3時間後に操作して、カレンダーへ戻る
    vi.setSystemTime(at + 3 * HOUR)
    fireEvent.keyDown(document.body, { key: 'Tab' })
    act(() => {
      screen.getByTestId('settings-back').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    })
    await user.click(screen.getByTestId('settings-back'))
    expect(router.state.location.pathname).toBe('/day/2026-11-10')
    // 設定に入る前の操作からは 6時間を過ぎたが、最後の操作（設定の画面）からは 3時間ほど
    setVisibility('hidden')
    vi.setSystemTime(at + 6 * HOUR + 5 * 60_000)
    setVisibility('visible')
    expect(router.state.location.pathname).toBe('/day/2026-11-10')
    setVisibility('visible')
  })

  it('登録・詳細の画面を開いている間は動かさない（書きかけを消さない）', async () => {
    const user = userEvent.setup()
    const at = new Date(2026, 10, 10, 22, 0).getTime()
    const { router } = await renderAt('/day/2026-11-10', { now: at })
    await user.click(screen.getByTestId('cal-add'))
    useCalendarUi.setState({ lastInteraction: at })
    setVisibility('hidden')
    vi.setSystemTime(at + 8 * HOUR)
    setVisibility('visible')
    expect(router.state.location.pathname).toBe('/day/2026-11-10')
    expect(screen.getByTestId('item-sheet')).toBeTruthy()
  })
})
