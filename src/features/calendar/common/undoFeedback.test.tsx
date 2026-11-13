// 操作の列の元に戻す・やり直す（ボタン・キー）で戻した・やり直した時のお知らせと見せ方（docs/SPEC.md の 7.13・3.9・4.9。■26 の
// 作者の答え「アンドゥ、リドゥ元のページに強制移行させ、画面下に説明のお知らせをユーザーが確認ボタンを押すまで表示し続ける」。
// common/undoFeedback.ts・src/store/undoStore.ts）: 何を戻したかの文（ボタンの名前と同じ言葉）、お知らせは［OK］を押すまで出して
// 次に戻すと置き換えること、当てた予定・休みの日が今の画面に無ければ今のモードのままその日へ移る（履歴は置き換える）こと、
// あれば移らずに目立たせること、読み上げ（お知らせの aria-live）
import { act, fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { undoText } from '../../../domain/itemText'
import { mkItem } from '../../../domain/testData'
import type { Item } from '../../../domain/types'
import type { UndoStep } from '../../../domain/undo'
import { actions } from '../../../store/actions'
import { getData, useApp } from '../../../store/appStore'
import { quickDraftKey, readLocal } from '../../../store/localDrafts'
import { useCalendarUi, useToasts } from '../../../store/uiStore'
import { itemChange, recordStep, redo, UNDO_FEEDBACK_SLOT, undoIdle } from '../../../store/undoStore'
import { renderAt, setupCalendarTests } from '../../../test/renderCalendar'
import { toastInset } from '../../../ui/scrollWithin'
import { flashKey } from './parts'
import { testIds } from './testIds'
import { planUndoReveal } from './undoFeedback'

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
/** 出ているお知らせ（文・［OK］まで出すか・ボタン） */
const toastShapes = () => useToasts.getState().toasts.map((t) => [t.message, t.untilOk ?? false, t.action?.label ?? null])
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

/**
 * ゴミ箱へ移す・戻すの代わり（この保存先は何も書かないので、表示のデータだけを動かす。DetailSheet.test.tsx と同じ）。予定 a を
 * ゴミ箱へ移して、削除の操作として積む
 */
async function deleteA() {
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
  await act(async () => {
    const before = getData().items.a
    const entry = await actions.trashItem('a')
    recordStep(undoText.deleted('打ち合わせ'), [itemChange('a', before, null, entry)])
  })
}

describe('文（ボタンの名前と同じ言葉）', () => {
  it('移したのを戻す・やり直す: 「元に戻しました：『打ち合わせ』を移した（11/12（木）→ 11/10（火））」と逆向き。前の物は置き換える', async () => {
    const { user } = await open('/week/2026-11-08')
    moveA('2026-11-12')
    await user.click(undoBtn())
    await settle()
    expect(toastShapes()).toEqual([['元に戻しました：『打ち合わせ』を移した（11/12（木）→ 11/10（火））', true, null]])
    await user.click(redoBtn())
    await settle()
    // 前のお知らせは置き換える（重ねない）
    expect(toastShapes()).toEqual([['やり直しました：『打ち合わせ』を移した（11/10（火）→ 11/12（木））', true, null]])
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
    // ほかの操作のお知らせとは重ねる（［OK］まで出す物は残る）
    expect(toastTexts()).toEqual(['やり直しました：11/11（水）を休みにした', '『打ち合わせ』を完了にしました'])
    await user.click(undoBtn())
    await settle()
    // 戻した操作のお知らせ（［元に戻す］付き）は消え、前の「やり直しました：…」は置き換える
    expect(toastTexts()).toEqual(['元に戻しました：『打ち合わせ』を完了にした'])
  })

  it('お知らせの［元に戻す］で戻した時は出さない（押したお知らせの操作なので分かる）。ボタンで断った時は「戻せません」を［OK］まで出す', async () => {
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
    // 前に出した「やり直しました：…」は置き換える（「戻せません」と並べない）。押した結果なので、これも［OK］まで
    expect(useToasts.getState().toasts.map((t) => [t.kind, t.message, t.untilOk, t.slot])).toEqual([
      ['error', 'ほかの所で直されたので戻せません', true, UNDO_FEEDBACK_SLOT],
    ])
    const el = toastEl('ほかの所で直されたので戻せません')
    expect(el.getAttribute('role')).toBe('alert')
    expect(within(el).getByRole('button', { name: 'OK' })).toBeTruthy()
  })

  it('読み上げ: お知らせは画面の下の aria-live の所に、role="status" で出す（ほかのお知らせと同じ）。フォーカスはお知らせへ動かさない', async () => {
    const { user } = await open('/week/2026-11-08')
    await user.click(screen.getByTestId(testIds.weekOff('2026-11-11')))
    const before = document.activeElement
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true })
    await settle()
    const el = toastEl('元に戻しました：11/11（水）を休みにした')
    expect(el.getAttribute('role')).toBe('status')
    expect(el.closest('[aria-live]')?.getAttribute('aria-live')).toBe('assertive')
    expect(document.activeElement).toBe(before)
    expect(el.contains(document.activeElement)).toBe(false)
  })
})

describe('今の画面に無ければ今のモードのままその日へ移り、あれば移らずに目立たせる（■26 の答え）', () => {
  it('ウィークリー: 戻したカードが今の週にあれば、移らずにカードを目立たせる（［見る］は無い）', async () => {
    const { user, router } = await open('/week/2026-11-08')
    moveA('2026-11-12')
    await user.click(undoBtn())
    await settle()
    expect(flashed(screen.getByTestId(testIds.weekCard('a')))).toBe(true)
    expect(router.state.location.pathname).toBe('/week/2026-11-08')
    const t = toastEl('元に戻しました：『打ち合わせ』を移した（11/12（木）→ 11/10（火））')
    expect(within(t).queryByRole('button', { name: '見る' })).toBeNull()
  })

  it('ウィークリー: 別の週へ移った時は、今のモード（週）のままその週へ移り（置き換える）、カードを目立たせる。お知らせは残る', async () => {
    const { user, router } = await open('/week/2026-11-08')
    moveA('2026-11-17')
    await user.click(undoBtn())
    await settle()
    expect(router.state.location.pathname).toBe('/week/2026-11-08')
    expect(flashed(screen.getByTestId(testIds.weekCard('a')))).toBe(true)
    act(() => useCalendarUi.setState({ flash: null }))
    await user.click(redoBtn())
    await settle()
    expect(router.state.location.pathname).toBe('/week/2026-11-15')
    expect(router.state.historyAction).toBe('REPLACE')
    expect(flashed(await screen.findByTestId(testIds.weekCard('a')))).toBe(true)
    expect(toastShapes()).toEqual([['やり直しました：『打ち合わせ』を移した（11/10（火）→ 11/17（火））', true, null]])
  })

  it('デイリー（作者の手順）: カードの無い日で戻すと、その日のデイリーへ移って（置き換える）行を目立たせる。やり直すと、移した日へ', async () => {
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
    expect(router.state.location.pathname).toBe('/day/2026-11-10')
    expect(router.state.historyAction).toBe('REPLACE')
    expect(flashed(await screen.findByTestId(testIds.dayRow('a')))).toBe(true)
    expect(toastShapes()).toEqual([['元に戻しました：『打ち合わせ』を移した（11/12（木）→ 11/10（火））', true, null]])
    act(() => useCalendarUi.setState({ flash: null }))
    await user.click(redoBtn())
    await settle()
    expect(router.state.location.pathname).toBe('/day/2026-11-12')
    expect(flashed(await screen.findByTestId(testIds.dayRow('a')))).toBe(true)
    expect(toastTexts()).toEqual(['やり直しました：『打ち合わせ』を移した（11/10（火）→ 11/12（木））'])
  })

  it('デイリー: 戻した予定がその日にあれば、移らずに目立たせる', async () => {
    const { user, router } = await open('/day/2026-11-10')
    moveA('2026-11-12')
    await user.click(undoBtn())
    await settle()
    expect(flashed(screen.getByTestId(testIds.dayRow('a')))).toBe(true)
    expect(router.state.location.pathname).toBe('/day/2026-11-10')
  })

  it('削除を戻すと（ゴミ箱から戻った予定のある週へ）移って目立たせる。削除をやり直すと（ゴミ箱へ）移らずに文だけ', async () => {
    const { user, router } = await open('/week/2026-11-15')
    await deleteA()
    await user.click(undoBtn())
    await settle()
    expect(toastTexts()).toEqual(['元に戻しました：『打ち合わせ』を削除した（ゴミ箱から戻した）'])
    expect(router.state.location.pathname).toBe('/week/2026-11-08')
    expect(flashed(await screen.findByTestId(testIds.weekCard('a')))).toBe(true)
    // 前の週へ移ってから、やり直す（ゴミ箱へ）: 移らない
    await user.click(screen.getByTestId(testIds.calPrev))
    expect(router.state.location.pathname).toBe('/week/2026-11-01')
    act(() => useCalendarUi.setState({ flash: null }))
    await user.click(redoBtn())
    await settle()
    expect(toastShapes()).toEqual([['やり直しました：『打ち合わせ』を削除した（ゴミ箱へ）', true, null]])
    expect(router.state.location.pathname).toBe('/week/2026-11-01')
    expect(useCalendarUi.getState().flash).toBeNull()
  })

  it('休み: 見えていれば日の見出しを目立たせる。デイリーで別の日なら、その日へ移って見出しを目立たせる', async () => {
    const { user, router } = await open('/week/2026-11-08')
    await user.click(screen.getByTestId(testIds.weekOff('2026-11-12')))
    await user.click(undoBtn())
    await settle()
    expect(flashed(screen.getByTestId(testIds.weekHead('2026-11-12')))).toBe(true)
    expect(router.state.location.pathname).toBe('/week/2026-11-08')
    // デイリーのその日: 見出しを目立たせる（移らない）
    await user.click(screen.getByTestId(testIds.calMode('day')))
    await user.click(screen.getByTestId(testIds.calNext))
    await user.click(screen.getByTestId(testIds.calNext))
    expect(router.state.location.pathname).toBe('/day/2026-11-12')
    act(() => useCalendarUi.setState({ flash: null }))
    await user.click(redoBtn())
    await settle()
    expect(getData().offDays['2026-11-12']?.off).toBe(true)
    expect(toastTexts()).toEqual(['やり直しました：11/12（木）を休みにした'])
    expect(flashed(screen.getByTestId(testIds.dayHead))).toBe(true)
    expect(router.state.location.pathname).toBe('/day/2026-11-12')
    // 別の日（11/13）で戻す: 11/12 へ移って見出しを目立たせる（11/13 の見出しは目立たせない）
    await user.click(screen.getByTestId(testIds.calNext))
    act(() => useCalendarUi.setState({ flash: null }))
    await user.click(undoBtn())
    await settle()
    expect(router.state.location.pathname).toBe('/day/2026-11-12')
    expect(router.state.historyAction).toBe('REPLACE')
    expect(useCalendarUi.getState().flash?.keys).toEqual([flashKey.dayHead('2026-11-12')])
    expect(flashed(await screen.findByTestId(testIds.dayHead))).toBe(true)
  })

  it('年・月へ替えても、お知らせは消さない（［OK］を押すまで出す）', async () => {
    const { user } = await open('/week/2026-11-08')
    moveA('2026-11-12')
    await user.click(undoBtn())
    await settle()
    const text = '元に戻しました：『打ち合わせ』を移した（11/12（木）→ 11/10（火））'
    await user.click(screen.getByTestId(testIds.calMode('month')))
    expect(toastTexts()).toEqual([text])
    await user.click(screen.getByTestId(testIds.calMode('year')))
    expect(toastTexts()).toEqual([text])
    await user.click(within(toastEl(text)).getByRole('button', { name: 'OK' }))
    expect(toastTexts()).toEqual([])
  })
})

describe('複数日の予定・「+n」の中', () => {
  const expo = mkItem({ id: 'x', title: '展示会の手配', start: '2026-11-11', due: '2026-11-13' })

  it('デイリー: 複数日の予定の始点を戻すと、動いた端の日（11/10）が見ている日（11/12）の外でも、出ている行を目立たせる（移らない）', async () => {
    const { user, router } = await open('/day/2026-11-12', 'L', [{ ...expo, start: '2026-11-10', due: '2026-11-12' }])
    change('x', undoText.moved('展示会の手配'), { start: '2026-11-11', due: '2026-11-13' })
    await user.click(undoBtn())
    await settle()
    expect(getData().items.x.start).toBe('2026-11-10')
    expect(toastTexts()).toEqual(['元に戻しました：『展示会の手配』を移した（11/11（水）→ 11/10（火））'])
    expect(flashed(screen.getByTestId(testIds.dayRow('x')))).toBe(true)
    expect(router.state.location.pathname).toBe('/day/2026-11-12')
  })

  it('デイリー: タイムスケジュールの「+n」の中に隠れた予定は、「+n」の札を目立たせる（その日なら移らず、別の日ならその日へ移って）', async () => {
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
    expect(toastTexts()).toEqual(['元に戻しました：『t』を完了にした'])
    expect(flashed(screen.getByTestId(testIds.dayMore))).toBe(true)
    // 別の日で［やり直す］: その日へ移って札を目立たせる
    await user.click(screen.getByTestId(testIds.calNext))
    act(() => useCalendarUi.setState({ flash: null }))
    await user.click(redoBtn())
    await settle()
    expect(router.state.location.pathname).toBe('/day/2026-11-10')
    expect(flashed(await screen.findByTestId(testIds.dayMore))).toBe(true)
  })
})

describe('すばやく足す・小さな画面を開いている時', () => {
  it('すばやく足すを開いたまま戻す・やり直して移らない時は、入力欄をお知らせの上まで送る（打っている字・フォーカスはそのまま）', async () => {
    const { user, router } = await open('/week/2026-11-08')
    moveA('2026-11-12')
    await user.click(undoBtn())
    await settle()
    await user.click(screen.getByTestId(testIds.weekAdd('2026-11-13', 'work')))
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
    expect(getData().items.a.start).toBe('2026-11-12')
    expect(router.state.location.pathname).toBe('/week/2026-11-08')
    expect(toastShapes()).toEqual([['やり直しました：『打ち合わせ』を移した（11/10（火）→ 11/12（木））', true, null]])
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

  it('すばやく足すを開いたまま戻す・やり直して別の週へ移る時は、打っている字を足さずに閉じる（書きかけに残り、開き直すと出る）', async () => {
    const { user, router } = await open('/week/2026-11-08')
    moveA('2026-11-17')
    await user.click(undoBtn())
    await settle()
    await user.click(screen.getByTestId(testIds.weekAdd('2026-11-12', 'work')))
    await user.type(screen.getByTestId(testIds.quickAddInput), '打ちかけ')
    await user.click(redoBtn())
    await settle()
    expect(router.state.location.pathname).toBe('/week/2026-11-15')
    expect(screen.queryByTestId(testIds.quickAddInput)).toBeNull()
    expect(Object.values(getData().items).some((it) => it.title === '打ちかけ')).toBe(false)
    // 「『打ちかけ』を足しました［元に戻す］」は出ない
    expect(toastTexts()).toEqual(['やり直しました：『打ち合わせ』を移した（11/10（火）→ 11/17（火））'])
    expect(readLocal(quickDraftKey('2026-11-12', 'work'))).toBe('打ちかけ')
    // 元の週へ戻って同じ所を開くと、書きかけが出る
    await user.click(screen.getByTestId(testIds.calPrev))
    await user.click(screen.getByTestId(testIds.weekAdd('2026-11-12', 'work')))
    expect((screen.getByTestId(testIds.quickAddInput) as HTMLInputElement).value).toBe('打ちかけ')
  })

  it('小さな画面（詳細）を開いている間に当たった時は移らない（開いている画面の履歴を置き換えない）。お知らせは出す', async () => {
    const other = mkItem({ id: 'b', title: '資料', start: '2026-11-11' })
    const { user, router } = await open('/week/2026-11-08', 'L', [other])
    moveA('2026-11-17')
    await user.click(undoBtn())
    await settle()
    await user.click(screen.getByTestId(testIds.weekCard('b')).querySelector('.wk-open') as HTMLElement)
    expect(await screen.findByRole('dialog')).toBeTruthy()
    const at = router.state.location
    // （開いている間はボタン・キーは効かないが、押した分の当てるのが後から終わった時と同じ）
    await act(async () => void (await redo()))
    expect(getData().items.a.start).toBe('2026-11-17')
    expect(router.state.location.pathname).toBe(at.pathname)
    expect(router.state.location.key).toBe(at.key)
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(toastTexts()).toEqual(['やり直しました：『打ち合わせ』を移した（11/10（火）→ 11/17（火））'])
  })
})

describe('お知らせは［OK］を押すまで出す（■26 の答え）', () => {
  it('時間では消えない。［OK］で消える。次に戻す・やり直すと新しい文に置き換わる', async () => {
    await open('/week/2026-11-08')
    moveA('2026-11-12')
    vi.useFakeTimers({ now: Date.now(), toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    fireEvent.click(undoBtn())
    await settle()
    const undone = '元に戻しました：『打ち合わせ』を移した（11/12（木）→ 11/10（火））'
    expect(toastTexts()).toEqual([undone])
    act(() => vi.advanceTimersByTime(60_000))
    expect(toastTexts()).toEqual([undone])
    fireEvent.click(redoBtn())
    await settle()
    const redone = 'やり直しました：『打ち合わせ』を移した（11/10（火）→ 11/12（木））'
    expect(toastTexts()).toEqual([redone])
    act(() => vi.advanceTimersByTime(60_000))
    expect(toastTexts()).toEqual([redone])
    fireEvent.click(within(toastEl(redone)).getByRole('button', { name: 'OK' }))
    expect(toastTexts()).toEqual([])
  })
})

describe('planUndoReveal（移るか・目立たせるかの決め方）', () => {
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

  it('今の期間の中に目立たせる所が出ていれば、移らずに目立たせる（スクロールの外でも。見える所まで送るのは目立たせる側）', () => {
    const find = vi.fn(() => [el])
    expect(planUndoReveal({ dir: 'undo', step }, week, find, () => true)).toEqual({
      key: flashKey.item('a'),
      goTo: null,
      lift: true,
    })
    expect(find).toHaveBeenCalledWith(flashKey.item('a'))
    // スクロールの外: 目立たせる側がそこまで送るので、すばやく足すの入力欄は送らない
    expect(planUndoReveal({ dir: 'undo', step }, week, find, () => false)).toEqual({
      key: flashKey.item('a'),
      goTo: null,
      lift: false,
    })
  })

  it('今の期間の外なら、目立たせる所を探さずに、戻した・やり直した後の日へ移る', () => {
    const find = vi.fn(() => [el])
    const next = { from: '2026-11-15', to: '2026-11-21' }
    expect(planUndoReveal({ dir: 'undo', step }, next, find)).toEqual({
      key: flashKey.item('a'),
      goTo: '2026-11-12',
      lift: false,
    })
    expect(planUndoReveal({ dir: 'redo', step }, next, find)).toEqual({
      key: flashKey.item('a'),
      goTo: '2026-11-14',
      lift: false,
    })
    expect(find).not.toHaveBeenCalled()
  })

  it('今の期間の中なのに目立たせる所が出ていない時は、移らず目立たせもしない（文だけ）', () => {
    expect(planUndoReveal({ dir: 'undo', step }, week, () => [])).toEqual({ key: null, goTo: null, lift: true })
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

  it('複数日の予定: 動いた端（始点の日）が今の期間の外でも、予定の期間が今の期間に掛かって出ている物があれば、移らずに目立たせる', () => {
    expect(
      planUndoReveal(
        { dir: 'undo', step: multi },
        day12,
        () => [el],
        () => true,
      ),
    ).toEqual({
      key: flashKey.item('x'),
      goTo: null,
      lift: true,
    })
  })

  it('複数日の予定: 今の期間に掛かっても出ている物が無い時・掛からない時は、動いた端の日へ移る', () => {
    expect(planUndoReveal({ dir: 'undo', step: multi }, day12, () => [])).toEqual({
      key: flashKey.item('x'),
      goTo: '2026-11-10',
      lift: false,
    })
    expect(planUndoReveal({ dir: 'undo', step: multi }, { from: '2026-11-14', to: '2026-11-14' }, () => [el])).toEqual({
      key: flashKey.item('x'),
      goTo: '2026-11-10',
      lift: false,
    })
  })

  it('休み: その日の見出し。今の期間の外ならその日へ移る', () => {
    const off: UndoStep = {
      id: 3,
      label: undoText.off('2026-11-20', true),
      changes: [{ table: 'offDays', id: '2026-11-20', before: false, after: true }],
    }
    expect(planUndoReveal({ dir: 'undo', step: off }, week, () => [el])).toEqual({
      key: flashKey.dayHead('2026-11-20'),
      goTo: '2026-11-20',
      lift: false,
    })
    expect(
      planUndoReveal(
        { dir: 'redo', step: off },
        { from: '2026-11-15', to: '2026-11-21' },
        () => [el],
        () => true,
      ),
    ).toEqual({
      key: flashKey.dayHead('2026-11-20'),
      goTo: null,
      lift: true,
    })
  })

  it('当てた後に予定が無い（足したのを戻した・削除をやり直した）時は、移らず目立たせもしない（文だけ）', () => {
    const add: UndoStep = {
      ...step,
      label: undoText.added('花'),
      changes: [{ table: 'items', id: 'a', before: null, after: { ...meeting, title: '花' }, entry: 'e' }],
    }
    expect(planUndoReveal({ dir: 'undo', step: add }, { from: '2026-12-01', to: '2026-12-07' }, () => [el])).toEqual({
      key: null,
      goTo: null,
      lift: true,
    })
  })
})
