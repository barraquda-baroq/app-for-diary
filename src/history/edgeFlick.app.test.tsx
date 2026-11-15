// iPhone・iPad の画面の端からのフリックを、アプリの行き先（src/App.tsx の routes）の上で通しで確かめる（docs/SPEC.md の 3.1・12.1。
// 22. の ■31〜■33）: ブラウザの履歴を1つのままにする履歴（SingleEntryHistory）と、window で端の指を受け取る所（edgeFlick.ts）を
// 付け、画面の端から指で払う（pointer と touch の出来事。iPhone と同じく pointer が先）。カレンダーではモードを1つ回し（左の端から
// ＝年→月→週→日→年、右の端から＝日→週→月→年→日）、前後の期間へは移らない（1回の払いで1つだけ）。端の幅（初めは 44px。設定の
// 「開発」で選ぶ。src/history/edgeZone.ts）は、端の指を受け取る所・なぞりの所の両方で同じ。すばやく足すに字を打ったまま払うと、
// 足さずに閉じてモードを回し、打った字も捨てる（同じ＋を開き直すと空。22. の「端からのフリックの3回目の直した版（788e842）を試した
// 答え」）。ブラウザの履歴は増えない
import { act, fireEvent, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { screenOf } from '../features/calendar/common/calendarHistory'
import { EDGE_ZONE_PX } from '../features/calendar/common/swipe'
import { testIds } from '../features/calendar/common/testIds'
import { getData } from '../store/appStore'
import { quickDraftKey, readLocal } from '../store/localDrafts'
import { FakeWindow } from '../test/fakeHistoryWindow'
import { renderAt, setupCalendarTests } from '../test/renderCalendar'
import * as device from '../ui/device'
import { createAppHistory, type DsHistory } from './appHistory'
import { attachEdgeFlick } from './edgeFlick'
import { setEdgeZonePx } from './edgeZone'

setupCalendarTests()

const cleanups: (() => void)[] = []
/** 端の指を受け取る所の時計（払った後 300ms の間の click は打ち消すので、押す前に進める） */
let clock = 0
afterEach(() => {
  for (const c of cleanups.splice(0)) c()
  vi.restoreAllMocks()
  setEdgeZonePx(EDGE_ZONE_PX)
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

/** 画面の端から inset（px。初めは 4px）の所から指で払う（-1 = 左の端から右へ、1 = 右の端から左へ。押した所はカレンダーの区切りの上） */
async function edgeFlick(side: -1 | 1, inset = 4) {
  const el = screen.getByTestId(testIds.calendarBody)
  const w = window.innerWidth
  const x0 = side < 0 ? inset : w - inset
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

/** path を開く（seed は、前の版が残した履歴を並べるなど、履歴を作る前に window へすること） */
async function open(path: string, seed?: (win: FakeWindow) => void) {
  vi.spyOn(device, 'currentPopSource').mockReturnValue('edge-flick')
  const win = new FakeWindow(`#${path}`)
  seed?.(win)
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

  it('端から 40px（初めの端の幅 44px の中）の払いはモードを回し、前後の期間へは移らない。60px の所からは前後の期間へ。設定の「開発」で 36px（前の幅）にすると、読み込み直さずに 40px の所からも前後の期間へ（どちらの所も同じ幅で決める。1回の払いで1つだけ）', async () => {
    const { router, win } = await open('/week/2026-11-08')
    await edgeFlick(-1, 40)
    expect(router.state.location.pathname).toBe('/day/2026-11-10')
    await edgeFlick(1, 40)
    expect(router.state.location.pathname).toBe('/week/2026-11-08')
    await edgeFlick(1, 60)
    expect(router.state.location.pathname).toBe('/week/2026-11-15')
    setEdgeZonePx(36)
    await edgeFlick(-1, 40)
    expect(router.state.location.pathname).toBe('/week/2026-11-08')
    await edgeFlick(-1, 4)
    expect(router.state.location.pathname).toBe('/day/2026-11-10')
    expect(win.history.length).toBe(1)
    expect(win.calls.filter((c) => c.op !== 'replaceState')).toEqual([])
  })

  it('すばやく足すに字を打ったまま払うと、足さずに閉じてモードを回し、打った字も捨てる（同じ＋を開き直すと空。12.1）', async () => {
    const { router } = await open('/week/2026-11-08')
    fireEvent.click(screen.getByTestId(testIds.weekAdd('2026-11-12', 'work')))
    const input = screen.getByTestId(testIds.quickAddInput) as HTMLInputElement
    fireEvent.change(input, { target: { value: '資料を送る' } })
    expect(readLocal(quickDraftKey('2026-11-12', 'work'))).toBe('資料を送る')
    await edgeFlick(-1)
    expect(router.state.location.pathname).toBe('/day/2026-11-10')
    expect(screen.queryByTestId(testIds.quickAddInput)).toBeNull()
    expect(Object.values(getData().items)).toHaveLength(0)
    expect(readLocal(quickDraftKey('2026-11-12', 'work'))).toBeNull()
    await edgeFlick(1)
    expect(router.state.location.pathname).toBe('/week/2026-11-08')
    fireEvent.click(screen.getByTestId(testIds.weekAdd('2026-11-12', 'work')))
    expect((screen.getByTestId(testIds.quickAddInput) as HTMLInputElement).value).toBe('')
    expect(Object.values(getData().items)).toHaveLength(0)
  })

  it('前の版が残した履歴へ「戻る」が来て（更新した直後の iPhone の身振り）モードを回す時も、すばやく足すは足さずに閉じ、打った字を捨てる', async () => {
    const path = '/week/2026-11-08'
    const { router, win } = await open(path, (w) =>
      w.seed(
        [
          { hash: `#${path}`, state: { usr: null, key: 'a', idx: 0, ds: { base: 1, mark: 'back' } } },
          { hash: `#${path}`, state: { usr: null, key: 'b', idx: 1, ds: { base: 1 } } },
        ],
        1,
      ),
    )
    fireEvent.click(screen.getByTestId(testIds.weekAdd('2026-11-12', 'work')))
    const input = screen.getByTestId(testIds.quickAddInput) as HTMLInputElement
    fireEvent.change(input, { target: { value: '古い履歴' } })
    expect(readLocal(quickDraftKey('2026-11-12', 'work'))).toBe('古い履歴')
    await act(async () => {
      win.userGo(-1)
      await new Promise((r) => setTimeout(r, 20))
    })
    expect(router.state.location.pathname).toBe('/day/2026-11-10')
    expect(screen.queryByTestId(testIds.quickAddInput)).toBeNull()
    expect(Object.values(getData().items)).toHaveLength(0)
    expect(readLocal(quickDraftKey('2026-11-12', 'work'))).toBeNull()
  })
})
