// 操作の列の元に戻す・やり直す（ボタン・キー）で戻した・やり直した時のお知らせと目立たせ（docs/SPEC.md の 7.13・3.9・4.9。■26 の
// 今の決め方。common/undoFeedback.ts）: 何を戻したかの文（ボタンの名前と同じ言葉）、前のお知らせを置き換えること、見えていない時
// だけ［見る］（今のモードのままその日の期間へ。履歴は置き換える）、見えている時はすぐ目立たせること、読み上げ（お知らせの aria-live）
import { act, fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { undoText } from '../../../domain/itemText'
import { mkItem } from '../../../domain/testData'
import type { Item } from '../../../domain/types'
import type { UndoStep } from '../../../domain/undo'
import { actions } from '../../../store/actions'
import { getData, useApp } from '../../../store/appStore'
import { TOAST_MS, useCalendarUi, useToasts } from '../../../store/uiStore'
import { itemChange, recordStep, undoIdle } from '../../../store/undoStore'
import { renderAt, setupCalendarTests } from '../../../test/renderCalendar'
import { toastInset } from '../../../ui/scrollWithin'
import { flashKey } from './parts'
import { testIds } from './testIds'
import { planUndoFeedback } from './undoFeedback'

// お知らせの上の高さは src/ui/scrollWithin.ts（中身はそのまま動かし、呼ばれた物を見る）
vi.mock('../../../ui/scrollWithin', { spy: true })

setupCalendarTests()
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const meeting = mkItem({ id: 'a', title: '打ち合わせ', start: '2026-11-10' })
const undoBtn = () => screen.getByTestId(testIds.calUndo)
const redoBtn = () => screen.getByTestId(testIds.calRedo)
const settle = () => act(async () => void (await undoIdle()))
/** 出ているお知らせの文 */
const toastTexts = () => useToasts.getState().toasts.map((t) => t.message)
/** その文のお知らせ（画面の物） */
const toastEl = (text: string) => screen.getByText(text).closest('.toast') as HTMLElement
const flashed = (el: HTMLElement) => el.classList.contains('flash')

/** ドラッグで動かした時と同じ記録の仕方で、予定 a をその日へ動かす（jsdom ではドラッグできない） */
function moveA(date: string) {
  act(() => {
    const before = getData().items.a
    actions.moveItemDates('a', { start: date, due: null, clearEnd: false })
    recordStep(undoText.moved('打ち合わせ'), [itemChange('a', before, getData().items.a)])
  })
}

async function open(path: string, width: 'L' | 'S' = 'L', more: Item[] = []) {
  const user = userEvent.setup()
  const items = Object.fromEntries([meeting, ...more].map((it) => [it.id, it]))
  const r = await renderAt(path, { width, data: { items } })
  return { ...r, user }
}

/** 予定 id を直して、その操作を積む（label の操作として） */
function change(id: string, label: string, patch: Partial<Item>) {
  act(() => {
    const before = getData().items[id]
    actions.restoreItemContent(id, { ...before, ...patch })
    recordStep(label, [itemChange(id, before, getData().items[id])])
  })
}

/** ほかの端末で直した（並びの外） */
const elsewhere = (id: string, patch: Partial<Item>) =>
  act(() => actions.restoreItemContent(id, { ...getData().items[id], ...patch }))

describe('文（ボタンの名前と同じ言葉）', () => {
  it('移したのを戻す・やり直す: 「元に戻しました：『打ち合わせ』を移した（11/12（木）→ 11/10（火））」と逆向き', async () => {
    const { user } = await open('/week/2026-11-08')
    moveA('2026-11-12')
    await user.click(undoBtn())
    await settle()
    expect(toastTexts()).toEqual(['元に戻しました：『打ち合わせ』を移した（11/12（木）→ 11/10（火））'])
    await user.click(redoBtn())
    await settle()
    // 前のお知らせは置き換える（重ねない）
    expect(toastTexts()).toEqual(['やり直しました：『打ち合わせ』を移した（11/10（火）→ 11/12（木））'])
  })

  it('休み・完了も、ボタンの名前の言葉で。キー（Ctrl+Z・Ctrl+Y）でも出す', async () => {
    const { user } = await open('/week/2026-11-08')
    await user.click(screen.getByTestId(testIds.weekOff('2026-11-11')))
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true })
    await settle()
    expect(toastTexts()).toEqual(['元に戻しました：11/11（水）を休みにした'])
    fireEvent.keyDown(document.body, { key: 'y', ctrlKey: true })
    await settle()
    expect(toastTexts()).toEqual(['やり直しました：11/11（水）を休みにした'])
    await user.click(screen.getByTestId(testIds.done('a')))
    expect(toastTexts()).toContain('『打ち合わせ』を完了にしました')
    await user.click(undoBtn())
    await settle()
    // 戻した操作のお知らせ（［元に戻す］付き）は消え、戻したお知らせだけ
    expect(toastTexts()).toEqual(['元に戻しました：『打ち合わせ』を完了にした'])
  })

  it('お知らせの［元に戻す］で戻した時は出さない（押したお知らせの操作なので分かる）。断った時は今までどおり', async () => {
    const { user } = await open('/week/2026-11-08')
    await user.click(screen.getByTestId(testIds.done('a')))
    await user.click(within(toastEl('『打ち合わせ』を完了にしました')).getByRole('button', { name: '元に戻す' }))
    await settle()
    expect(toastTexts()).toEqual([])
    // やり直した後に、ほかの所で直された
    await user.click(redoBtn())
    await settle()
    act(() => actions.restoreItemContent('a', { ...getData().items.a, title: 'ほかの端末で直した' }))
    await user.click(undoBtn())
    await settle()
    // 前に出した「やり直しました：…」は消す（「戻せません」と並べない）
    expect(toastTexts()).toEqual(['ほかの所で直されたので戻せません'])
  })

  it('読み上げ: お知らせは画面の下の aria-live の所に、role="status" で出す（ほかのお知らせと同じ）', async () => {
    const { user } = await open('/week/2026-11-08')
    await user.click(screen.getByTestId(testIds.weekOff('2026-11-11')))
    await user.click(undoBtn())
    await settle()
    const el = toastEl('元に戻しました：11/11（水）を休みにした')
    expect(el.getAttribute('role')).toBe('status')
    expect(el.closest('[aria-live]')?.getAttribute('aria-live')).toBe('assertive')
  })
})

describe('見えている時は目立たせ、見えていない時は［見る］', () => {
  it('ウィークリー: 戻したカードが今の週にあれば、［見る］を付けずにカードを目立たせる（4秒で消える）', async () => {
    const { user } = await open('/week/2026-11-08')
    moveA('2026-11-12')
    await user.click(undoBtn())
    await settle()
    expect(flashed(screen.getByTestId(testIds.weekCard('a')))).toBe(true)
    const t = toastEl('元に戻しました：『打ち合わせ』を移した（11/12（木）→ 11/10（火））')
    expect(within(t).queryByRole('button', { name: '見る' })).toBeNull()
    expect(useToasts.getState().toasts[0].action).toBeUndefined()
  })

  it('ウィークリー: 別の週へ移った時は［見る］。押すと今のモード（週）のままその週へ（置き換える）、カードを目立たせる', async () => {
    const { user, router } = await open('/week/2026-11-08')
    moveA('2026-11-17')
    await user.click(undoBtn())
    await settle()
    expect(flashed(screen.getByTestId(testIds.weekCard('a')))).toBe(true)
    await user.click(redoBtn())
    await settle()
    expect(screen.queryByTestId(testIds.weekCard('a'))).toBeNull()
    const t = toastEl('やり直しました：『打ち合わせ』を移した（11/10（火）→ 11/17（火））')
    await user.click(within(t).getByRole('button', { name: '見る' }))
    await settle()
    expect(router.state.location.pathname).toBe('/week/2026-11-15')
    expect(router.state.historyAction).toBe('REPLACE')
    // 押したお知らせは消える
    expect(toastTexts()).toEqual([])
    expect(flashed(await screen.findByTestId(testIds.weekCard('a')))).toBe(true)
  })

  it('デイリー（作者の手順）: カードの無い日で戻すと［見る］。押すとその日のデイリーへ（置き換える）、行を目立たせる', async () => {
    const { user, router } = await open('/week/2026-11-08')
    moveA('2026-11-12')
    await user.click(undoBtn())
    await settle()
    await user.click(redoBtn())
    await settle()
    // 日の画面に替えて、カードの無い日（11/11）へ
    await user.click(screen.getByTestId(testIds.calMode('day')))
    await user.click(screen.getByTestId(testIds.calNext))
    expect(router.state.location.pathname).toBe('/day/2026-11-11')
    await user.click(undoBtn())
    await settle()
    const t = toastEl('元に戻しました：『打ち合わせ』を移した（11/12（木）→ 11/10（火））')
    await user.click(within(t).getByRole('button', { name: '見る' }))
    await settle()
    expect(router.state.location.pathname).toBe('/day/2026-11-10')
    expect(router.state.historyAction).toBe('REPLACE')
    expect(flashed(await screen.findByTestId(testIds.dayRow('a')))).toBe(true)
  })

  it('デイリー: 戻した予定がその日にあれば［見る］を付けずに目立たせる', async () => {
    const { user } = await open('/day/2026-11-10')
    moveA('2026-11-12')
    await user.click(undoBtn())
    await settle()
    expect(flashed(screen.getByTestId(testIds.dayRow('a')))).toBe(true)
    expect(useToasts.getState().toasts.map((t) => t.action)).toEqual([undefined])
  })

  it('予定が無くなった（削除をやり直した・足したのを戻した）時は［見る］も目立たせも無い', async () => {
    // ゴミ箱へ移す・戻すの代わり（この保存先は何も書かないので、表示のデータだけを動かす。DetailSheet.test.tsx と同じ）
    let kept: Item | null = null
    vi.spyOn(actions, 'trashItem').mockImplementation(async (id) => {
      act(() =>
        useApp.setState((st) => {
          const { [id]: gone, ...items } = st.data.items
          kept = gone
          return { data: { ...st.data, items, trashEntries: { ...st.data.trashEntries, e1: { id: 'e1' } as never } } }
        }),
      )
      return 'e1'
    })
    vi.spyOn(actions, 'restoreTrashEntry').mockImplementation(async () => {
      act(() => useApp.setState((st) => ({ data: { ...st.data, items: { ...st.data.items, a: kept! }, trashEntries: {} } })))
      return { restored: 1 } as never
    })
    const { user } = await open('/week/2026-11-15')
    await act(async () => {
      const before = getData().items.a
      const entry = await actions.trashItem('a')
      recordStep(undoText.deleted('打ち合わせ'), [itemChange('a', before, null, entry)])
    })
    await user.click(undoBtn())
    await settle()
    // 戻った予定は前の週（見えていない）: ［見る］
    const back = useToasts.getState().toasts
    expect(back.map((t) => t.message)).toEqual(['元に戻しました：『打ち合わせ』を削除した（ゴミ箱から戻した）'])
    expect(back[0].action?.label).toBe('見る')
    await user.click(redoBtn())
    await settle()
    const gone = useToasts.getState().toasts
    expect(gone.map((t) => t.message)).toEqual(['やり直しました：『打ち合わせ』を削除した（ゴミ箱へ）'])
    expect(gone[0].action).toBeUndefined()
  })

  it('休み: 見えていれば日の見出しを目立たせる。デイリーで別の日なら［見る］で、その日の見出しを目立たせる', async () => {
    const { user, router } = await open('/week/2026-11-08')
    await user.click(screen.getByTestId(testIds.weekOff('2026-11-12')))
    await user.click(undoBtn())
    await settle()
    expect(flashed(screen.getByTestId(testIds.weekHead('2026-11-12')))).toBe(true)
    expect(useToasts.getState().toasts[0].action).toBeUndefined()
    // デイリーのその日: 見出しを目立たせる
    await user.click(screen.getByTestId(testIds.calMode('day')))
    await user.click(screen.getByTestId(testIds.calNext))
    await user.click(screen.getByTestId(testIds.calNext))
    expect(router.state.location.pathname).toBe('/day/2026-11-12')
    act(() => useCalendarUi.setState({ flash: null }))
    await user.click(redoBtn())
    await settle()
    expect(getData().offDays['2026-11-12']?.off).toBe(true)
    expect(toastTexts()).toEqual(['やり直しました：11/12（木）を休みにした'])
    expect(useToasts.getState().toasts[0].action).toBeUndefined()
    expect(flashed(screen.getByTestId(testIds.dayHead))).toBe(true)
    // 別の日（11/13）で戻す: ［見る］で 11/12 へ
    await user.click(screen.getByTestId(testIds.calNext))
    await user.click(undoBtn())
    await settle()
    // 11/13 の見出しには目立たせない（見せる日は 11/12）
    expect(useCalendarUi.getState().flash?.keys ?? []).not.toContain(flashKey.dayHead('2026-11-13'))
    act(() => useCalendarUi.setState({ flash: null }))
    await user.click(within(toastEl('元に戻しました：11/12（木）を休みにした')).getByRole('button', { name: '見る' }))
    await settle()
    expect(router.state.location.pathname).toBe('/day/2026-11-12')
    expect(useCalendarUi.getState().flash?.keys).toEqual([flashKey.dayHead('2026-11-12')])
    expect(flashed(await screen.findByTestId(testIds.dayHead))).toBe(true)
  })

  it('年・月へ替えると、戻したお知らせは消す（［見る］の行き先は週・日の物）', async () => {
    const { user } = await open('/week/2026-11-08')
    moveA('2026-11-17')
    await user.click(undoBtn())
    await settle()
    await user.click(redoBtn())
    await settle()
    expect(toastTexts()).toHaveLength(1)
    await user.click(screen.getByTestId(testIds.calMode('month')))
    expect(toastTexts()).toEqual([])
  })
})

describe('複数日の予定・「+n」の中・［見る］を押す時の予定', () => {
  const expo = mkItem({ id: 'x', title: '展示会の手配', start: '2026-11-11', due: '2026-11-13' })

  it('デイリー: 複数日の予定の始点を戻すと、動いた端の日（11/10）が見ている日（11/12）の外でも、出ている行を目立たせる（［見る］無し）', async () => {
    const { user } = await open('/day/2026-11-12', 'L', [{ ...expo, start: '2026-11-10', due: '2026-11-12' }])
    change('x', undoText.moved('展示会の手配'), { start: '2026-11-11', due: '2026-11-13' })
    await user.click(undoBtn())
    await settle()
    expect(getData().items.x.start).toBe('2026-11-10')
    expect(toastTexts()).toEqual(['元に戻しました：『展示会の手配』を移した（11/11（水）→ 11/10（火））'])
    expect(useToasts.getState().toasts[0].action).toBeUndefined()
    expect(flashed(screen.getByTestId(testIds.dayRow('x')))).toBe(true)
  })

  it('デイリー: タイムスケジュールの「+n」の中に隠れた予定は、「+n」の札を目立たせる（その日なら［見る］無し、別の日なら［見る］の後）', async () => {
    const timed = (id: string, startTime: string) => mkItem({ id, title: id, start: '2026-11-10', startTime, endTime: '15:30' })
    const { user, router } = await open('/day/2026-11-10', 'L', [
      timed('p', '14:00'),
      timed('q', '14:00'),
      timed('r', '14:15'),
      timed('s', '14:30'),
      timed('t', '14:45'),
    ])
    expect(screen.queryByTestId(testIds.dayEvent('t'))).toBeNull()
    change('t', undoText.done('t', true), { done: true })
    await user.click(undoBtn())
    await settle()
    expect(useToasts.getState().toasts.map((t) => [t.message, t.action])).toEqual([
      ['元に戻しました：『t』を完了にした', undefined],
    ])
    expect(flashed(screen.getByTestId(testIds.dayMore))).toBe(true)
    // 別の日で［やり直す］→［見る］でその日へ移って札を目立たせる
    await user.click(screen.getByTestId(testIds.calNext))
    act(() => useCalendarUi.setState({ flash: null }))
    await user.click(redoBtn())
    await settle()
    await user.click(within(toastEl('やり直しました：『t』を完了にした')).getByRole('button', { name: '見る' }))
    await settle()
    expect(router.state.location.pathname).toBe('/day/2026-11-10')
    expect(flashed(await screen.findByTestId(testIds.dayMore))).toBe(true)
  })

  it('［見る］を押す前に、ほかの所で予定の日が替わった時は、今の日へ行く。無くなっていれば移らない', async () => {
    const { user, router } = await open('/day/2026-11-11')
    moveA('2026-11-12')
    await user.click(undoBtn())
    await settle()
    expect(useToasts.getState().toasts[0].action?.label).toBe('見る')
    // ほかの端末で 11/20 へ
    elsewhere('a', { start: '2026-11-20' })
    await user.click(
      within(toastEl('元に戻しました：『打ち合わせ』を移した（11/12（木）→ 11/10（火））')).getByRole('button', { name: '見る' }),
    )
    await settle()
    expect(router.state.location.pathname).toBe('/day/2026-11-20')
    expect(flashed(await screen.findByTestId(testIds.dayRow('a')))).toBe(true)
    // 戻す・やり直すの後に、ほかの所でゴミ箱へ移した（data.items から無くなった）
    await user.click(screen.getByTestId(testIds.calNext))
    moveA('2026-11-22')
    await user.click(undoBtn())
    await settle()
    const look = useToasts.getState().toasts[0].action
    expect(look?.label).toBe('見る')
    act(() =>
      useApp.setState((st) => {
        const { a: gone, ...items } = st.data.items
        void gone
        return { data: { ...st.data, items } }
      }),
    )
    act(() => look?.run())
    await settle()
    expect(router.state.location.pathname).toBe('/day/2026-11-21')
  })
})

describe('すばやく足す・小さな画面を開いている時', () => {
  it('すばやく足すを開いたまま戻す・やり直すと、［見る］を付けず（押すと打っている字を足して閉じるため）、入力欄をお知らせの上まで送る', async () => {
    const { user } = await open('/week/2026-11-08')
    moveA('2026-11-17')
    await user.click(undoBtn())
    await settle()
    await user.click(screen.getByTestId(testIds.weekAdd('2026-11-12', 'work')))
    const input = screen.getByTestId(testIds.quickAddInput) as HTMLInputElement
    await user.type(input, '打ちかけ')
    // 送る時の欄の下の余白（お知らせの分）を控える
    const margins: string[] = []
    const intoView = vi.mocked(Element.prototype.scrollIntoView)
    intoView.mockClear()
    intoView.mockImplementation(function (this: Element) {
      if (this === input) margins.push(input.style.scrollMarginBottom)
    })
    vi.mocked(toastInset).mockImplementation((el) => (el === input ? 60 : 0))
    await user.click(redoBtn())
    await settle()
    expect(getData().items.a.start).toBe('2026-11-17')
    expect(useToasts.getState().toasts.map((t) => [t.message, t.action])).toEqual([
      ['やり直しました：『打ち合わせ』を移した（11/10（火）→ 11/17（火））', undefined],
    ])
    expect(screen.getByTestId(testIds.quickAddInput)).toBe(input)
    expect(input.value).toBe('打ちかけ')
    expect(document.activeElement).toBe(input)
    // 打っている欄はページも動かしてよい（開いた時と同じ scrollIntoView）。お知らせの分（60px）を欄の下の余白に見込み、送った後は戻す
    expect(intoView.mock.contexts.filter((c) => c === input)).toHaveLength(1)
    expect(intoView).toHaveBeenCalledWith({ block: 'nearest', behavior: 'smooth' })
    expect(margins).toEqual(['60px'])
    expect(input.style.scrollMarginBottom).toBe('')
    intoView.mockReset()
  })

  it('［見る］付きのお知らせを出している間に小さな画面（詳細）を開くと、［見る］を外す（開いている間は移れない）', async () => {
    const other = mkItem({ id: 'b', title: '資料', start: '2026-11-11' })
    const { user } = await open('/week/2026-11-08', 'L', [other])
    moveA('2026-11-17')
    await user.click(undoBtn())
    await settle()
    await user.click(redoBtn())
    await settle()
    const text = 'やり直しました：『打ち合わせ』を移した（11/10（火）→ 11/17（火））'
    expect(useToasts.getState().toasts.map((t) => [t.message, t.action?.label])).toEqual([[text, '見る']])
    await user.click(screen.getByTestId(testIds.weekCard('b')).querySelector('.wk-open') as HTMLElement)
    expect(await screen.findByRole('dialog')).toBeTruthy()
    expect(useToasts.getState().toasts.map((t) => [t.message, t.action])).toEqual([[text, undefined]])
  })
})

describe('お知らせの長さ（3.9）', () => {
  it('［見る］の無い物は 4秒、［見る］付きは 6秒（ボタン付きのお知らせと同じ）', async () => {
    await open('/week/2026-11-08')
    moveA('2026-11-17')
    vi.useFakeTimers({ now: Date.now(), toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    fireEvent.click(undoBtn())
    await settle()
    expect(toastTexts()).toHaveLength(1)
    act(() => vi.advanceTimersByTime(TOAST_MS.info - 1))
    expect(toastTexts()).toHaveLength(1)
    act(() => vi.advanceTimersByTime(1))
    expect(toastTexts()).toEqual([])
    fireEvent.click(redoBtn())
    await settle()
    expect(useToasts.getState().toasts[0].action?.label).toBe('見る')
    act(() => vi.advanceTimersByTime(TOAST_MS.long - 1))
    expect(toastTexts()).toHaveLength(1)
    act(() => vi.advanceTimersByTime(1))
    expect(toastTexts()).toEqual([])
  })
})

describe('planUndoFeedback（見えているかの決め方）', () => {
  const step: UndoStep = {
    id: 1,
    label: undoText.moved('打ち合わせ'),
    changes: [
      {
        table: 'items',
        id: 'a',
        before: { ...meeting, start: '2026-11-12' },
        after: { ...meeting, start: '2026-11-14' },
        entry: null,
      },
    ],
  }
  const week = { from: '2026-11-08', to: '2026-11-14' }
  const el = document.createElement('div')

  it('今の期間の中で、目立たせる所が見えていれば［見る］無しですぐ目立たせる', () => {
    const plan = planUndoFeedback(
      { dir: 'undo', step },
      week,
      () => [el],
      () => true,
    )
    expect(plan).toMatchObject({ key: flashKey.item('a'), look: false, flashNow: true })
    expect(plan.text).toBe('元に戻しました：『打ち合わせ』を移した（11/14（土）→ 11/12（木））')
  })

  it('今の期間の中でも、スクロールの外（見えていない）なら［見る］', () => {
    expect(
      planUndoFeedback(
        { dir: 'undo', step },
        week,
        () => [el],
        () => false,
      ),
    ).toMatchObject({
      look: true,
      flashNow: false,
    })
  })

  it('今の期間の外なら［見る］（目立たせる所を探さない）。見に行くのは、戻した・やり直した後の日', () => {
    const find = vi.fn(() => [el])
    const next = { from: '2026-11-15', to: '2026-11-21' }
    expect(planUndoFeedback({ dir: 'undo', step }, next, find, () => true)).toMatchObject({
      look: true,
      flashNow: false,
      focus: { date: '2026-11-12' },
    })
    expect(planUndoFeedback({ dir: 'redo', step }, next, find, () => true)).toMatchObject({
      look: true,
      focus: { date: '2026-11-14' },
    })
    expect(find).not.toHaveBeenCalled()
  })

  it('今の期間の中なのに目立たせる所が出ていない時は、［見る］も目立たせも無い', () => {
    expect(
      planUndoFeedback(
        { dir: 'undo', step },
        week,
        () => [],
        () => true,
      ),
    ).toMatchObject({ look: false, flashNow: false })
  })

  /** 3日の予定（11/10〜11/12）の始点を 11/11 へ動かした（11/11〜11/13） */
  const multi: UndoStep = {
    id: 2,
    label: undoText.moved('展示会の手配'),
    changes: [
      {
        table: 'items',
        id: 'x',
        before: { ...meeting, id: 'x', start: '2026-11-10', due: '2026-11-12' },
        after: { ...meeting, id: 'x', start: '2026-11-11', due: '2026-11-13' },
        entry: null,
      },
    ],
  }
  const day12 = { from: '2026-11-12', to: '2026-11-12' }

  it('複数日の予定: 動いた端（始点の日）が今の期間の外でも、予定の期間が今の期間に掛かり、出ている物が見えていればすぐ目立たせる', () => {
    const find = vi.fn(() => [el])
    expect(planUndoFeedback({ dir: 'undo', step: multi }, day12, find, () => true)).toMatchObject({
      text: '元に戻しました：『展示会の手配』を移した（11/11（水）→ 11/10（火））',
      key: flashKey.item('x'),
      look: false,
      flashNow: true,
      focus: { date: '2026-11-10', span: { from: '2026-11-10', to: '2026-11-12' } },
    })
    expect(find).toHaveBeenCalledWith(flashKey.item('x'))
  })

  it('複数日の予定: 今の期間に掛かっても、出ている物が見えていない・出ていない時は［見る］（動いた端の日へ）', () => {
    expect(
      planUndoFeedback(
        { dir: 'undo', step: multi },
        day12,
        () => [el],
        () => false,
      ),
    ).toMatchObject({
      look: true,
      flashNow: false,
    })
    expect(
      planUndoFeedback(
        { dir: 'undo', step: multi },
        day12,
        () => [],
        () => true,
      ),
    ).toMatchObject({
      look: true,
      flashNow: false,
    })
    // 予定の期間が今の期間に掛からない（11/14 の日）
    expect(
      planUndoFeedback(
        { dir: 'undo', step: multi },
        { from: '2026-11-14', to: '2026-11-14' },
        () => [el],
        () => true,
      ),
    ).toMatchObject({ look: true, flashNow: false })
  })

  it('予定が無くなった時は文だけ', () => {
    const add: UndoStep = {
      ...step,
      label: undoText.added('花'),
      changes: [{ table: 'items', id: 'a', before: null, after: { ...meeting, title: '花' }, entry: 'e' }],
    }
    expect(
      planUndoFeedback(
        { dir: 'undo', step: add },
        week,
        () => [el],
        () => true,
      ),
    ).toEqual({
      text: '元に戻しました：『花』を足した',
      key: null,
      focus: null,
      look: false,
      flashNow: false,
    })
  })
})
