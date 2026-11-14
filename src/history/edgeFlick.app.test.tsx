// iPhone・iPad の画面の端からのフリックを、アプリの行き先（src/App.tsx の routes）の上で通しで確かめる（docs/SPEC.md の 3.1・12.1。
// 22. の ■31〜■33）: ブラウザの履歴を1つのままにする履歴（SingleEntryHistory）と、window で端の指を受け取る所（edgeFlick.ts）を
// 付け、画面の端から指で払う（pointer と touch の出来事。iPhone と同じく pointer が先）。カレンダーではモードを1つ回し（左の端から
// ＝年→月→週→日→年、右の端から＝日→週→月→年→日）、前後の期間へは移らない（1回の払いで1つだけ）。すばやく足すに字を打ったまま
// 払うと、足さずに閉じてモードを回し、打った字は書きかけに残る（同じ＋を開き直すと出る）。ブラウザの履歴は増えない
import { act, fireEvent, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { screenOf } from '../features/calendar/common/calendarHistory'
import { testIds } from '../features/calendar/common/testIds'
import { getData } from '../store/appStore'
import { quickDraftKey, readLocal } from '../store/localDrafts'
import { FakeWindow } from '../test/fakeHistoryWindow'
import { renderAt, setupCalendarTests } from '../test/renderCalendar'
import * as device from '../ui/device'
import { createAppHistory, type DsHistory } from './appHistory'
import { attachEdgeFlick } from './edgeFlick'

setupCalendarTests()

const cleanups: (() => void)[] = []
/** 端の指を受け取る所の時計（払った後 300ms の間の click は打ち消すので、押す前に進める） */
let clock = 0
afterEach(() => {
  for (const c of cleanups.splice(0)) c()
  vi.restoreAllMocks()
})

/** 指の PointerEvent（pointerType: touch） */
const pointer = (type: string, x: number, y: number) =>
  new PointerEvent(type, { bubbles: true, pointerType: 'touch', pointerId: 21, isPrimary: true, clientX: x, clientY: y })

/** touch の出来事（jsdom には Touch が無いので、座標の入った物を持たせる） */
function touch(target: EventTarget, type: string, x: number, y: number, down: boolean) {
  const ev = new Event(type, { bubbles: true, cancelable: true })
  const point = { clientX: x, clientY: y }
  Object.defineProperty(ev, 'touches', { value: down ? [point] : [] })
  Object.defineProperty(ev, 'changedTouches', { value: [point] })
  target.dispatchEvent(ev)
}

/** 画面の端から指で払う（-1 = 左の端から右へ、1 = 右の端から左へ。押した所はカレンダーの区切りの上） */
async function edgeFlick(side: -1 | 1) {
  const el = screen.getByTestId(testIds.calendarBody)
  const w = window.innerWidth
  const x0 = side < 0 ? 4 : w - 4
  const dx = side < 0 ? 140 : -140
  const y = 400
  await act(async () => {
    fireEvent(el, pointer('pointerdown', x0, y))
    touch(el, 'touchstart', x0, y, true)
    for (const f of [0.25, 0.5, 0.75, 1]) {
      document.dispatchEvent(pointer('pointermove', x0 + dx * f, y))
      touch(el, 'touchmove', x0 + dx * f, y, true)
    }
    document.dispatchEvent(pointer('pointerup', x0 + dx, y))
    touch(el, 'touchend', x0 + dx, y, false)
  })
  // 払った指の click を打ち消す間（300ms）を過ぎる
  clock += 1000
}

async function open(path: string) {
  vi.spyOn(device, 'currentPopSource').mockReturnValue('edge-flick')
  const win = new FakeWindow(`#${path}`)
  const h: DsHistory = createAppHistory({
    window: win,
    source: 'edge-flick',
    armOnLeaveFail: false,
    screenOf,
    isLoginPath: (p) => p === '/login',
  })
  const detach = attachEdgeFlick(h, { win: window, now: () => clock })
  cleanups.push(() => {
    detach?.()
    h.dispose()
  })
  const r = await renderAt(path, { width: 'S', history: h })
  return { ...r, win, h }
}

describe('iPhone・iPad の画面の端からのフリック（アプリの行き先の上で通しで）', () => {
  it('カレンダー: 左の端から 週→日、右の端から 日→週→月（1回の払いでモードだけが1つ替わる。期間はそのまま）。ブラウザの履歴は1つのまま', async () => {
    const { router, win } = await open('/week/2026-11-08')
    await edgeFlick(-1)
    expect(router.state.location.pathname).toBe('/day/2026-11-10')
    await edgeFlick(1)
    expect(router.state.location.pathname).toBe('/week/2026-11-08')
    await edgeFlick(1)
    expect(router.state.location.pathname).toBe('/month/2026-11')
    expect(win.history.length).toBe(1)
    expect(win.calls.filter((c) => c.op !== 'replaceState')).toEqual([])
  })

  it('すばやく足すに字を打ったまま払うと、足さずに閉じてモードを回す。打った字は書きかけに残り、同じ＋を開き直すと出る（12.1）', async () => {
    const { router } = await open('/week/2026-11-08')
    fireEvent.click(screen.getByTestId(testIds.weekAdd('2026-11-12', 'work')))
    const input = screen.getByTestId(testIds.quickAddInput) as HTMLInputElement
    fireEvent.change(input, { target: { value: '資料を送る' } })
    await edgeFlick(-1)
    expect(router.state.location.pathname).toBe('/day/2026-11-10')
    expect(screen.queryByTestId(testIds.quickAddInput)).toBeNull()
    expect(Object.values(getData().items)).toHaveLength(0)
    expect(readLocal(quickDraftKey('2026-11-12', 'work'))).toBe('資料を送る')
    await edgeFlick(1)
    expect(router.state.location.pathname).toBe('/week/2026-11-08')
    fireEvent.click(screen.getByTestId(testIds.weekAdd('2026-11-12', 'work')))
    expect((screen.getByTestId(testIds.quickAddInput) as HTMLInputElement).value).toBe('資料を送る')
    expect(Object.values(getData().items)).toHaveLength(0)
  })
})
