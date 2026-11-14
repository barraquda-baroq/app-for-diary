// 操作の列の元に戻す・やり直す（ボタン・キー）で戻した・やり直した時のお知らせと見せ方（docs/SPEC.md の 7.13・3.9・4.9。■26 の
// 作者の答え「アンドゥ、リドゥ元のページに強制移行させ、画面下に説明のお知らせをユーザーが確認ボタンを押すまで表示し続ける」と、
// ■28 の作者の答え「モードまたがりなのでこのケースの場合には週に戻りカードの移動前の状態になるべきだと思っています」。
// common/undoFeedback.ts・src/store/undoStore.ts）: 何を戻したかの文（ボタンの名前と同じ言葉）、お知らせは［OK］を押すまで出して
// 次に戻すと置き換えること、操作をしたモード（週・日）が今のモードと違えばそのモードへ戻ること（履歴は置き換える）、同じモードで
// 当てた予定・休みの日が今の画面に無ければそのモードのままその日へ移る（履歴は置き換える）こと、あれば移らずに目立たせること、
// 読み上げ（お知らせの aria-live）
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
 * ゴミ箱へ移す・戻すの代わり（この保存先は何も書かないので、表示のデータだけを動かす。DetailSheet.test.tsx と同じ）。移した予定は
 * ゴミ箱の1件（e-{id}）に覚え、戻すと元の所へ
 */
function mockTrash() {
  const kept = new Map<string, Item>()
  vi.spyOn(actions, 'trashItem').mockImplementation(async (id) => {
    const entry = `e-${id}`
    act(() =>
      useApp.setState((st) => {
        const { [id]: gone, ...items } = st.data.items
        kept.set(entry, gone)
        return { data: { ...st.data, items, trashEntries: { ...st.data.trashEntries, [entry]: { id: entry } as never } } }
      }),
    )
    return entry
  })
  vi.spyOn(actions, 'restoreTrashEntry').mockImplementation(async (entry) => {
    act(() =>
      useApp.setState((st) => {
        const it = kept.get(entry)!
        const trashEntries = Object.fromEntries(Object.entries(st.data.trashEntries).filter(([k]) => k !== entry))
        return { data: { ...st.data, items: { ...st.data.items, [it.id]: it }, trashEntries } }
      }),
    )
    return { restored: 1 } as never
  })
}

/** 予定 id をゴミ箱へ移して、削除の操作として積む（mockTrash の中で） */
async function deleteItem(id = 'a', title = '打ち合わせ') {
  mockTrash()
  await act(async () => {
    const before = getData().items[id]
    const entry = await actions.trashItem(id)
    recordStep(undoText.deleted(title), [itemChange(id, before, null, entry)])
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

describe('操作をしたモードと同じモードでは、今の画面に無ければそのモードのままその日へ移り、あれば移らずに目立たせる（■26 の答え）', () => {
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
    await deleteItem()
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

describe('操作をしたモード（週・日）が今のモードと違えば、そのモードへ戻る（■28 の答え）', () => {
  /** 予定 a のカードが出ている週の日（カードの入っている列の日付） */
  const cardDay = () => screen.getByTestId(testIds.weekCard('a')).closest('[data-date]')?.getAttribute('data-date')

  it('作者の手順: 週で動かして日に替え、カードの無い日（11/11）で戻すと、元の日（11/10）の週へ戻って（置き換える）カードを目立たせる。やり直すも週で、動かした先', async () => {
    const { user, router } = await open('/week/2026-11-08')
    moveA('2026-11-12')
    await user.click(screen.getByTestId(testIds.calMode('day')))
    await user.click(screen.getByTestId(testIds.calNext))
    expect(router.state.location.pathname).toBe('/day/2026-11-11')
    await user.click(undoBtn())
    await settle()
    expect(router.state.location.pathname).toBe('/week/2026-11-08')
    expect(router.state.historyAction).toBe('REPLACE')
    expect(getData().items.a.start).toBe('2026-11-10')
    expect(flashed(await screen.findByTestId(testIds.weekCard('a')))).toBe(true)
    expect(cardDay()).toBe('2026-11-10')
    expect(useCalendarUi.getState().flash?.keys).toEqual([flashKey.item('a')])
    expect(toastShapes()).toEqual([['元に戻しました：『打ち合わせ』を移した（11/12（木）→ 11/10（火））', true, null]])
    // やり直すも、操作をした週のまま（動かした先のカード）
    act(() => useCalendarUi.setState({ flash: null }))
    await user.click(redoBtn())
    await settle()
    expect(router.state.location.pathname).toBe('/week/2026-11-08')
    expect(flashed(screen.getByTestId(testIds.weekCard('a')))).toBe(true)
    expect(cardDay()).toBe('2026-11-12')
    expect(toastTexts()).toEqual(['やり直しました：『打ち合わせ』を移した（11/10（火）→ 11/12（木））'])
  })

  it('日でカードの出ている日（11/12）で押しても週へ戻る。やり直すを日で押しても週へ（同じ操作のモード）', async () => {
    const { user, router } = await open('/week/2026-11-08')
    moveA('2026-11-12')
    await user.click(screen.getByTestId(testIds.calMode('day')))
    await user.click(screen.getByTestId(testIds.calNext))
    await user.click(screen.getByTestId(testIds.calNext))
    expect(router.state.location.pathname).toBe('/day/2026-11-12')
    expect(screen.getByTestId(testIds.dayRow('a'))).toBeTruthy()
    await user.click(undoBtn())
    await settle()
    expect(router.state.location.pathname).toBe('/week/2026-11-08')
    expect(flashed(await screen.findByTestId(testIds.weekCard('a')))).toBe(true)
    expect(cardDay()).toBe('2026-11-10')
    // 日の画面へ替えて（11/10 のデイリー。行が出ている）、やり直す
    await user.click(screen.getByTestId(testIds.calMode('day')))
    expect(router.state.location.pathname).toBe('/day/2026-11-10')
    act(() => useCalendarUi.setState({ flash: null }))
    await user.click(redoBtn())
    await settle()
    expect(router.state.location.pathname).toBe('/week/2026-11-08')
    expect(router.state.historyAction).toBe('REPLACE')
    expect(flashed(await screen.findByTestId(testIds.weekCard('a')))).toBe(true)
    expect(cardDay()).toBe('2026-11-12')
  })

  it('別の週へ動かしたのを日で戻す・やり直すと、当てた後の日の週へ（戻すと 11/10 の週、やり直すと 11/17 の週）', async () => {
    const { user, router } = await open('/week/2026-11-08')
    moveA('2026-11-17')
    await user.click(screen.getByTestId(testIds.calMode('day')))
    await user.click(screen.getByTestId(testIds.calNext))
    await user.click(undoBtn())
    await settle()
    expect(router.state.location.pathname).toBe('/week/2026-11-08')
    expect(flashed(await screen.findByTestId(testIds.weekCard('a')))).toBe(true)
    await user.click(screen.getByTestId(testIds.calMode('day')))
    act(() => useCalendarUi.setState({ flash: null }))
    await user.click(redoBtn())
    await settle()
    expect(router.state.location.pathname).toBe('/week/2026-11-15')
    expect(flashed(await screen.findByTestId(testIds.weekCard('a')))).toBe(true)
    expect(cardDay()).toBe('2026-11-17')
  })

  it('キー（Ctrl+Z・Ctrl+Y）でも同じ: 日で押すと、週でした操作の週へ戻る', async () => {
    const { user, router } = await open('/week/2026-11-08')
    moveA('2026-11-12')
    await user.click(screen.getByTestId(testIds.calMode('day')))
    await user.click(screen.getByTestId(testIds.calNext))
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true })
    await settle()
    expect(router.state.location.pathname).toBe('/week/2026-11-08')
    expect(flashed(await screen.findByTestId(testIds.weekCard('a')))).toBe(true)
    await user.click(screen.getByTestId(testIds.calMode('day')))
    fireEvent.keyDown(document.body, { key: 'y', ctrlKey: true })
    await settle()
    expect(router.state.location.pathname).toBe('/week/2026-11-08')
    expect(toastTexts()).toEqual(['やり直しました：『打ち合わせ』を移した（11/10（火）→ 11/12（木））'])
  })

  it('デイリーでした操作は、週で戻す・やり直すと日（その予定の日）へ戻って行を目立たせる', async () => {
    const { user, router } = await open('/day/2026-11-10')
    change('a', undoText.done('打ち合わせ', true), { done: true })
    await user.click(screen.getByTestId(testIds.calMode('week')))
    await user.click(screen.getByTestId(testIds.calNext))
    expect(router.state.location.pathname).toBe('/week/2026-11-15')
    await user.click(undoBtn())
    await settle()
    expect(getData().items.a.done).toBe(false)
    expect(router.state.location.pathname).toBe('/day/2026-11-10')
    expect(router.state.historyAction).toBe('REPLACE')
    expect(flashed(await screen.findByTestId(testIds.dayRow('a')))).toBe(true)
    expect(toastTexts()).toEqual(['元に戻しました：『打ち合わせ』を完了にした'])
    // 週（予定のある週）へ替えて、やり直す: 日へ
    await user.click(screen.getByTestId(testIds.calMode('week')))
    expect(router.state.location.pathname).toBe('/week/2026-11-08')
    act(() => useCalendarUi.setState({ flash: null }))
    await user.click(redoBtn())
    await settle()
    expect(getData().items.a.done).toBe(true)
    expect(router.state.location.pathname).toBe('/day/2026-11-10')
    expect(flashed(await screen.findByTestId(testIds.dayRow('a')))).toBe(true)
  })

  it('休み（ウィークリーのチェックで付ける）: 日で戻す・やり直すと週へ戻って、その日の見出しを目立たせる（日の見出しではない）', async () => {
    const { user, router } = await open('/week/2026-11-08')
    await user.click(screen.getByTestId(testIds.weekOff('2026-11-12')))
    await user.click(screen.getByTestId(testIds.calMode('day')))
    await user.click(screen.getByTestId(testIds.calNext))
    await user.click(screen.getByTestId(testIds.calNext))
    expect(router.state.location.pathname).toBe('/day/2026-11-12')
    await user.click(undoBtn())
    await settle()
    expect(getData().offDays['2026-11-12']?.off ?? false).toBe(false)
    expect(router.state.location.pathname).toBe('/week/2026-11-08')
    expect(useCalendarUi.getState().flash?.keys).toEqual([flashKey.dayHead('2026-11-12')])
    expect(flashed(await screen.findByTestId(testIds.weekHead('2026-11-12')))).toBe(true)
    await user.click(screen.getByTestId(testIds.calMode('day')))
    await user.click(screen.getByTestId(testIds.calNext))
    act(() => useCalendarUi.setState({ flash: null }))
    await user.click(redoBtn())
    await settle()
    expect(getData().offDays['2026-11-12']?.off).toBe(true)
    expect(toastTexts()).toEqual(['やり直しました：11/12（木）を休みにした'])
    expect(router.state.location.pathname).toBe('/week/2026-11-08')
    expect(flashed(await screen.findByTestId(testIds.weekHead('2026-11-12')))).toBe(true)
  })

  it('目立たせる所が無い時（削除をやり直した。ゴミ箱へ）も、操作をしたモードへ戻る。行き先は操作をした時に見ていた日の週（予定の初めの日の週ではない）。文だけ', async () => {
    // 前の週（11/6）から続く予定を、11/8 の週で消した
    const expo = mkItem({ id: 'x', title: '展示会の手配', start: '2026-11-06', due: '2026-11-10' })
    const { user, router } = await open('/week/2026-11-08', 'L', [expo])
    await deleteItem('x', '展示会の手配')
    await user.click(undoBtn())
    await settle()
    expect(getData().items.x).toBeTruthy()
    await user.click(screen.getByTestId(testIds.calMode('day')))
    act(() => void router.navigate('/day/2026-11-20'))
    await screen.findByTestId(testIds.view('day'))
    expect(router.state.location.pathname).toBe('/day/2026-11-20')
    act(() => useCalendarUi.setState({ flash: null }))
    await user.click(redoBtn())
    await settle()
    expect(getData().items.x).toBeUndefined()
    expect(toastShapes()).toEqual([['やり直しました：『展示会の手配』を削除した（ゴミ箱へ）', true, null]])
    expect(router.state.location.pathname).toBe('/week/2026-11-08')
    expect(router.state.historyAction).toBe('REPLACE')
    await screen.findByTestId(testIds.view('week'))
    expect(useCalendarUi.getState().flash).toBeNull()
  })

  it('目立たせる所が無い時（すばやく足したのを戻した）: デイリーで足したのを週で戻すと、足した日のデイリーへ戻って文だけ', async () => {
    mockTrash()
    const { user, router } = await open('/day/2026-11-10')
    await user.click(screen.getByTestId(testIds.dayAdd('work')))
    await user.type(screen.getByTestId(testIds.quickAddInput), '花{Enter}')
    expect(Object.values(getData().items).some((it) => it.title === '花')).toBe(true)
    await user.keyboard('{Escape}')
    await user.click(screen.getByTestId(testIds.calMode('week')))
    await user.click(screen.getByTestId(testIds.calNext))
    expect(router.state.location.pathname).toBe('/week/2026-11-15')
    act(() => useCalendarUi.setState({ flash: null }))
    await user.click(undoBtn())
    await settle()
    expect(Object.values(getData().items).some((it) => it.title === '花')).toBe(false)
    expect(toastTexts()).toEqual(['元に戻しました：『花』を足した'])
    expect(router.state.location.pathname).toBe('/day/2026-11-10')
    expect(router.state.historyAction).toBe('REPLACE')
    await screen.findByTestId(testIds.view('day'))
    expect(useCalendarUi.getState().flash).toBeNull()
  })

  it('すばやく足すを開いたまま、モードを替えて戻る時も、打っている字は足さずに閉じる（書きかけに残る）', async () => {
    const { user, router } = await open('/week/2026-11-08')
    moveA('2026-11-12')
    await user.click(screen.getByTestId(testIds.calMode('day')))
    await user.click(screen.getByTestId(testIds.calNext))
    await user.click(screen.getByTestId(testIds.dayAdd('work')))
    await user.type(screen.getByTestId(testIds.quickAddInput), '打ちかけ')
    await user.click(undoBtn())
    await settle()
    expect(router.state.location.pathname).toBe('/week/2026-11-08')
    expect(screen.queryByTestId(testIds.quickAddInput)).toBeNull()
    expect(Object.values(getData().items).some((it) => it.title === '打ちかけ')).toBe(false)
    expect(toastTexts()).toEqual(['元に戻しました：『打ち合わせ』を移した（11/12（木）→ 11/10（火））'])
    expect(readLocal(quickDraftKey('2026-11-11', 'work'))).toBe('打ちかけ')
  })

  it('小さな画面（詳細）を開いている間に当たった時は、モードも替えない（開いている画面の履歴を置き換えない）', async () => {
    const other = mkItem({ id: 'b', title: '資料', start: '2026-11-11' })
    const { user, router } = await open('/week/2026-11-08', 'L', [other])
    moveA('2026-11-12')
    await user.click(undoBtn())
    await settle()
    await user.click(screen.getByTestId(testIds.calMode('day')))
    await user.click(screen.getByTestId(testIds.calNext))
    await user.click(within(screen.getByTestId(testIds.dayRow('b'))).getByText('資料'))
    expect(await screen.findByRole('dialog')).toBeTruthy()
    const at = router.state.location
    await act(async () => void (await redo()))
    expect(getData().items.a.start).toBe('2026-11-12')
    expect(router.state.location.pathname).toBe(at.pathname)
    expect(router.state.location.key).toBe(at.key)
    expect(screen.getByRole('dialog')).toBeTruthy()
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
    // 当てたカードは目立たせるが、送らない（同じ週の中を入力欄と二つの送りで動かすと、後の送りが入力欄の送りを止めるので）
    expect(useCalendarUi.getState().flash).toMatchObject({ key: flashKey.item('a'), scroll: false })
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

  it('すばやく足すを開いたまま［OK］を押しても、入力欄は閉じず、打っている字を足さない（フォーカスも入力欄のまま）', async () => {
    const { user } = await open('/week/2026-11-08')
    moveA('2026-11-12')
    await user.click(screen.getByTestId(testIds.weekAdd('2026-11-13', 'work')))
    const input = screen.getByTestId(testIds.quickAddInput) as HTMLInputElement
    await user.type(input, '打ちかけ')
    await user.click(undoBtn())
    await settle()
    const text = '元に戻しました：『打ち合わせ』を移した（11/12（木）→ 11/10（火））'
    expect(toastTexts()).toEqual([text])
    await user.click(within(toastEl(text)).getByRole('button', { name: 'OK' }))
    expect(toastTexts()).toEqual([])
    expect(screen.getByTestId(testIds.quickAddInput)).toBe(input)
    expect(input.value).toBe('打ちかけ')
    expect(document.activeElement).toBe(input)
    expect(Object.values(getData().items).some((it) => it.title === '打ちかけ')).toBe(false)
  })

  it('［OK］まで出すお知らせが出ている間に開いたすばやく足すも、入力欄をお知らせの上まで送る（開いた時・足した後）', async () => {
    const { user } = await open('/week/2026-11-08')
    moveA('2026-11-12')
    await user.click(undoBtn())
    await settle()
    expect(toastTexts()).toEqual(['元に戻しました：『打ち合わせ』を移した（11/12（木）→ 11/10（火））'])
    // 送る時の欄の下の余白（お知らせの分）を控える
    const margins: string[] = []
    const intoView = vi.mocked(Element.prototype.scrollIntoView)
    intoView.mockClear()
    intoView.mockImplementation(function (this: Element) {
      if (this instanceof HTMLInputElement) margins.push(this.style.scrollMarginBottom)
    })
    vi.mocked(toastInset).mockImplementation((el) => (el instanceof HTMLInputElement ? 60 : 0))
    await user.click(screen.getByTestId(testIds.weekAdd('2026-11-14', 'work')))
    const input = screen.getByTestId(testIds.quickAddInput) as HTMLInputElement
    expect(margins).toEqual(['60px'])
    expect(input.style.scrollMarginBottom).toBe('')
    // 足した後も（足した予定の分だけ入力欄が下へ動く）
    await user.type(input, '花{Enter}')
    expect(Object.values(getData().items).some((it) => it.title === '花')).toBe(true)
    expect(margins).toEqual(['60px', '60px'])
    expect(input.style.scrollMarginBottom).toBe('')
    intoView.mockReset()
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

describe('続けて押した時（前に押した分で移る途中に、次が当たった）', () => {
  it('前の分で別の週へ移る途中（まだ描いていない）に次が当たっても、次の所を出す（移った先で決め直し、無ければそこへ移る）', async () => {
    const { user, router } = await open('/week/2026-11-08')
    // この週の 11/12 と、次の週の 11/16 を休みにして、この週へ戻る
    await user.click(screen.getByTestId(testIds.weekOff('2026-11-12')))
    await user.click(screen.getByTestId(testIds.calNext))
    await user.click(screen.getByTestId(testIds.weekOff('2026-11-16')))
    await user.click(screen.getByTestId(testIds.calPrev))
    expect(router.state.location.pathname).toBe('/week/2026-11-08')
    // 移るのを止めておく（移った週を描くのが、次に押した分より後になる時の代わり。キーを押したままにした時など）
    const navigate = router.navigate.bind(router)
    const held: Array<() => Promise<void>> = []
    vi.spyOn(router, 'navigate').mockImplementation(
      (...args: Parameters<typeof router.navigate>) =>
        new Promise<void>((resolve) => held.push(async () => resolve(await navigate(...args)))),
    )
    const release = async () => {
      while (held.length) await act(async () => void (await held.shift()!()))
    }
    // 1回目: 11/16 の休み（次の週）を戻す → 次の週へ移る途中
    await user.click(undoBtn())
    await settle()
    expect(held).toHaveLength(1)
    // 2回目: 11/12 の休み（描いている週の中）を戻す
    act(() => useCalendarUi.setState({ flash: null }))
    await user.click(undoBtn())
    await settle()
    await release()
    expect(getData().offDays['2026-11-12']?.off ?? false).toBe(false)
    expect(getData().offDays['2026-11-16']?.off ?? false).toBe(false)
    // 終わりは、2回目の所（11/12 のある週）。お知らせも2回目の物
    expect(router.state.location.pathname).toBe('/week/2026-11-08')
    expect(toastTexts()).toEqual(['元に戻しました：11/12（木）を休みにした'])
    expect(useCalendarUi.getState().flash?.keys).toEqual([flashKey.dayHead('2026-11-12')])
    expect(flashed(await screen.findByTestId(testIds.weekHead('2026-11-12')))).toBe(true)
  })

  it('前の分で移る途中に、次の分の所が移る先の週にあれば、移った先でそれを目立たせる（前の分の所は目立たせない）', async () => {
    const { user, router } = await open('/week/2026-11-08')
    // 次の週の 11/16 と 11/17 を休みにして、この週へ戻る
    await user.click(screen.getByTestId(testIds.calNext))
    await user.click(screen.getByTestId(testIds.weekOff('2026-11-16')))
    await user.click(screen.getByTestId(testIds.weekOff('2026-11-17')))
    await user.click(screen.getByTestId(testIds.calPrev))
    const navigate = router.navigate.bind(router)
    const held: Array<() => Promise<void>> = []
    vi.spyOn(router, 'navigate').mockImplementation(
      (...args: Parameters<typeof router.navigate>) =>
        new Promise<void>((resolve) => held.push(async () => resolve(await navigate(...args)))),
    )
    await user.click(undoBtn())
    await settle()
    await user.click(undoBtn())
    await settle()
    while (held.length) await act(async () => void (await held.shift()!()))
    expect(router.state.location.pathname).toBe('/week/2026-11-15')
    expect(toastTexts()).toEqual(['元に戻しました：11/16（月）を休みにした'])
    expect(useCalendarUi.getState().flash?.keys).toEqual([flashKey.dayHead('2026-11-16')])
  })

  it('1回目でモードを替えて移る途中（まだ描いていない）に2回目が当たっても、終わりは2回目の所（移る先のモードで決め直す。■28）', async () => {
    const other = mkItem({ id: 'c', title: '資料', start: '2026-11-17' })
    const { user, router } = await open('/week/2026-11-08', 'L', [other])
    // 週で a を動かし、次の週で c を動かして、日（11/20）へ替える
    moveA('2026-11-12')
    await user.click(screen.getByTestId(testIds.calNext))
    change('c', undoText.moved('資料'), { start: '2026-11-19' })
    await user.click(screen.getByTestId(testIds.calMode('day')))
    for (let i = 0; i < 3; i++) await user.click(screen.getByTestId(testIds.calNext))
    expect(router.state.location.pathname).toBe('/day/2026-11-20')
    const navigate = router.navigate.bind(router)
    const held: Array<() => Promise<void>> = []
    vi.spyOn(router, 'navigate').mockImplementation(
      (...args: Parameters<typeof router.navigate>) =>
        new Promise<void>((resolve) => held.push(async () => resolve(await navigate(...args)))),
    )
    // 1回目: c の移動を戻す → c の週（11/15 の週）へ替える途中。2回目: a の移動を戻す
    await user.click(undoBtn())
    await settle()
    expect(held).toHaveLength(1)
    await user.click(undoBtn())
    await settle()
    while (held.length) await act(async () => void (await held.shift()!()))
    expect(getData().items.c.start).toBe('2026-11-17')
    expect(getData().items.a.start).toBe('2026-11-10')
    // 終わりは、2回目の所（a の週。モードは週のまま）。お知らせも2回目の物
    expect(router.state.location.pathname).toBe('/week/2026-11-08')
    expect(toastTexts()).toEqual(['元に戻しました：『打ち合わせ』を移した（11/12（木）→ 11/10（火））'])
    expect(useCalendarUi.getState().flash?.keys).toEqual([flashKey.item('a')])
    expect(flashed(await screen.findByTestId(testIds.weekCard('a')))).toBe(true)
  })

  it('1回目でモードを替えて移る途中に、2回目が元のモードでした操作なら、終わりは元のモードの2回目の所', async () => {
    const other = mkItem({ id: 'b', title: '資料', start: '2026-11-10' })
    const { user, router } = await open('/day/2026-11-10', 'L', [other])
    // デイリーで b を完了にし、週へ替えて a を動かし、日（11/11）へ戻る
    change('b', undoText.done('資料', true), { done: true })
    await user.click(screen.getByTestId(testIds.calMode('week')))
    moveA('2026-11-12')
    await user.click(screen.getByTestId(testIds.calMode('day')))
    await user.click(screen.getByTestId(testIds.calNext))
    expect(router.state.location.pathname).toBe('/day/2026-11-11')
    const navigate = router.navigate.bind(router)
    const held: Array<() => Promise<void>> = []
    vi.spyOn(router, 'navigate').mockImplementation(
      (...args: Parameters<typeof router.navigate>) =>
        new Promise<void>((resolve) => held.push(async () => resolve(await navigate(...args)))),
    )
    // 1回目: 週でした a の移動を戻す → 週へ替える途中。2回目: デイリーでした b の完了を戻す
    await user.click(undoBtn())
    await settle()
    expect(held).toHaveLength(1)
    await user.click(undoBtn())
    await settle()
    while (held.length) await act(async () => void (await held.shift()!()))
    expect(getData().items.a.start).toBe('2026-11-10')
    expect(getData().items.b.done).toBe(false)
    // 終わりは、2回目の操作をした日（11/10 のデイリー）。お知らせも2回目の物
    expect(router.state.location.pathname).toBe('/day/2026-11-10')
    expect(toastTexts()).toEqual(['元に戻しました：『資料』を完了にした'])
    expect(useCalendarUi.getState().flash?.keys).toEqual([flashKey.item('b')])
    expect(flashed(await screen.findByTestId(testIds.dayRow('b')))).toBe(true)
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
  const week = { mode: 'week', from: '2026-11-08', to: '2026-11-14' } as const
  const el = document.createElement('div')
  /** 週・日の、その日へ移る */
  const toWeek = (date: string) => ({ mode: 'week', date }) as const
  const toDay = (date: string) => ({ mode: 'day', date }) as const

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

  it('今の期間の外なら、目立たせる所を探さずに、今のモードのまま戻した・やり直した後の日へ移る', () => {
    const find = vi.fn(() => [el])
    const next = { mode: 'week', from: '2026-11-15', to: '2026-11-21' } as const
    expect(planUndoReveal({ dir: 'undo', step }, next, find)).toEqual({
      key: flashKey.item('a'),
      goTo: toWeek('2026-11-12'),
      lift: false,
    })
    expect(planUndoReveal({ dir: 'redo', step }, next, find)).toEqual({
      key: flashKey.item('a'),
      goTo: toWeek('2026-11-14'),
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
  const day12 = { mode: 'day', from: '2026-11-12', to: '2026-11-12' } as const

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
      goTo: toDay('2026-11-10'),
      lift: false,
    })
    expect(
      planUndoReveal({ dir: 'undo', step: multi }, { mode: 'day', from: '2026-11-14', to: '2026-11-14' }, () => [el]),
    ).toEqual({
      key: flashKey.item('x'),
      goTo: toDay('2026-11-10'),
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
      goTo: toWeek('2026-11-20'),
      lift: false,
    })
    expect(
      planUndoReveal(
        { dir: 'redo', step: off },
        { mode: 'week', from: '2026-11-15', to: '2026-11-21' },
        () => [el],
        () => true,
      ),
    ).toEqual({
      key: flashKey.dayHead('2026-11-20'),
      goTo: null,
      lift: true,
    })
  })

  const add: UndoStep = {
    ...step,
    label: undoText.added('花'),
    changes: [{ table: 'items', id: 'a', before: null, after: { ...meeting, title: '花' }, entry: 'e' }],
  }

  it('当てた後に予定が無い（足したのを戻した・削除をやり直した）時は、移らず目立たせもしない（文だけ）', () => {
    expect(
      planUndoReveal({ dir: 'undo', step: add }, { mode: 'week', from: '2026-12-01', to: '2026-12-07' }, () => [el]),
    ).toEqual({
      key: null,
      goTo: null,
      lift: true,
    })
  })

  describe('操作をしたモード（step.place。■28）', () => {
    const inWeek: UndoStep = { ...step, place: { mode: 'week', date: '2026-11-09' } }

    it('今のモードと違えば、目立たせる所を探さずに、操作をしたモードの、当てた後の日の期間へ移る（やり直すも、同じステップのモード）', () => {
      const find = vi.fn(() => [el])
      // 日で、カードが出ている日（11/14）を見ていても
      const day14 = { mode: 'day', from: '2026-11-14', to: '2026-11-14' } as const
      expect(planUndoReveal({ dir: 'undo', step: inWeek }, day14, find)).toEqual({
        key: flashKey.item('a'),
        goTo: toWeek('2026-11-12'),
        lift: false,
      })
      expect(planUndoReveal({ dir: 'redo', step: inWeek }, day14, find)).toEqual({
        key: flashKey.item('a'),
        goTo: toWeek('2026-11-14'),
        lift: false,
      })
      expect(find).not.toHaveBeenCalled()
      // デイリーでした操作を週で
      const inDay: UndoStep = { ...multi, place: { mode: 'day', date: '2026-11-12' } }
      expect(planUndoReveal({ dir: 'undo', step: inDay }, week, find)).toEqual({
        key: flashKey.item('x'),
        goTo: toDay('2026-11-10'),
        lift: false,
      })
    })

    it('今のモードと違って目立たせる所が無い時は、操作をした時に見ていた日の、そのモードの期間へ移る（文だけ）', () => {
      const added: UndoStep = { ...add, place: { mode: 'week', date: '2026-11-09' } }
      expect(
        planUndoReveal({ dir: 'undo', step: added }, { mode: 'day', from: '2026-12-01', to: '2026-12-01' }, () => [el]),
      ).toEqual({ key: null, goTo: toWeek('2026-11-09'), lift: false })
    })

    it('同じモードなら今までどおり（出ていれば移らない・無ければ当てた後の日へ。見ていた日へは行かない）', () => {
      expect(
        planUndoReveal(
          { dir: 'undo', step: inWeek },
          week,
          () => [el],
          () => true,
        ),
      ).toEqual({
        key: flashKey.item('a'),
        goTo: null,
        lift: true,
      })
      expect(
        planUndoReveal({ dir: 'undo', step: inWeek }, { mode: 'week', from: '2026-11-15', to: '2026-11-21' }, () => []),
      ).toEqual({ key: flashKey.item('a'), goTo: toWeek('2026-11-12'), lift: false })
      const added: UndoStep = { ...add, place: { mode: 'week', date: '2026-11-09' } }
      expect(
        planUndoReveal({ dir: 'undo', step: added }, { mode: 'week', from: '2026-12-01', to: '2026-12-07' }, () => []),
      ).toEqual({ key: null, goTo: null, lift: true })
    })
  })
})
