// iPhone・iPad で打っている間の端からのフリック（docs/SPEC.md の 3.1・12.1・22. の ■36 の作者の答え）を、本物のトップの画面
// （src/App.tsx の routes）と iPhone・iPad の1つの履歴（SingleEntryHistory）・src/App.tsx と同じ handlers（consumePop・listOpen・
// closeList）で確かめる: カレンダー・MIM の画面で、すばやく足すが開いている時か、3つのリストの中の文字を打つ欄にフォーカスがある時の
// フリックは、打っていた物をやめて欄から外すだけ（モードは替えない・リストは畳まない・行き先も替えない）。打っていない時は今までどおり
// （■34 で畳む・モードを回す）。Android・PC の OS の戻るは今までどおり（打っている欄をやめない）。端に指を置いた時に打っていて、
// 払い終える前に欄が閉じた時も、そのフリックは使い切る。指の出来事は iPhone と同じ順（touchstart・pointerdown・pointercancel・
// touchmove・touchend。pointer が先の順も）で送る
import { act, fireEvent, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkFavorite, mkTask } from '../../domain/testData'
import type { Item } from '../../domain/types'
import { createAppHistory, setHistoryHandler } from '../../history/appHistory'
import { attachEdgeFlick } from '../../history/edgeFlick'
import type { SingleEntryHistory } from '../../history/singleEntryHistory'
import { clearSwipeLog, setSwipeLogEnabled, swipeLogText } from '../../history/swipeLog'
import { getData } from '../../store/appStore'
import { flushAllDrafts, hasDirtyDrafts } from '../../store/draftRegistry'
import { quickDraftKey, readLocal } from '../../store/localDrafts'
import { useStackedLists } from '../../store/uiStore'
import { FakeWindow } from '../../test/fakeHistoryWindow'
import { renderAt, setupCalendarTests } from '../../test/renderCalendar'
import * as device from '../../ui/device'
import { BLUR_SETTLE_MS } from '../calendar/common/parts/QuickAdd'
import { screenOf } from '../calendar/common/calendarHistory'
import { testIds } from '../calendar/common/testIds'
import { draftKey } from '../lists/common/listInputModel'
import { listTestIds } from '../lists/common/testIds'
import { taskTestIds } from '../lists/task/taskTestIds'
import { consumeBackPress } from './closeApp'
import { closeShownList, listOpenNow } from './listBack'

setupCalendarTests()

const disposers: (() => void)[] = []
afterEach(() => {
  for (const d of disposers.splice(0)) d()
  setSwipeLogEnabled(false)
  vi.restoreAllMocks()
})

const lists = () => useStackedLists.getState()
const items = (...list: Item[]) => Object.fromEntries(list.map((it) => [it.id, it]))
const DATA = {
  items: items(mkTask({ id: 't1', title: '見積もりの返事' })),
  favorites: { f1: mkFavorite({ id: 'f1', text: '近所のパン屋に寄る' }) },
}

/**
 * src/App.tsx と同じく、作った履歴に consumePop・listOpen・closeList を置いて path を描く（iPhone・iPad: 端からのフリック）。
 * edge は window で端の指を受け取る所（src/history/edgeFlick.ts）も付ける
 */
async function openTop(
  path = '/month/2026-11',
  { width = 'S', edge = false, data = DATA }: { width?: 'S' | 'M' | 'L'; edge?: boolean; data?: typeof DATA } = {},
) {
  vi.spyOn(device, 'currentPopSource').mockReturnValue('edge-flick')
  const win = new FakeWindow(`#${path}`, { swipes: true })
  const history = createAppHistory({ window: win, source: 'edge-flick', armOnLeaveFail: false, screenOf }) as SingleEntryHistory
  const offs = [
    setHistoryHandler('listOpen', listOpenNow),
    setHistoryHandler('closeList', closeShownList),
    setHistoryHandler('consumePop', consumeBackPress),
  ]
  const detach = edge ? attachEdgeFlick(history, { win: window, now: () => performance.now() }) : null
  const r = await renderAt(path, { width, history, data })
  disposers.push(() => {
    detach?.()
    for (const off of offs) off()
    r.router.dispose()
    history.dispose()
  })
  return { ...r, win, history }
}

/** 切り替えの列でそのリストを開いて先頭へ（見ている所がそのリストになる） */
async function openList(list: 'task' | 'routine' | 'favorite') {
  fireEvent.click(screen.getByTestId(`top-jump-${list}`))
  await act(async () => {
    await new Promise((r) => requestAnimationFrame(() => r(null)))
  })
  expect(lists().collapsed[list]).toBe(false)
  expect(lists().shown).toBe(list)
}

const field = (list: 'task' | 'routine' | 'favorite') =>
  screen.getByTestId(listTestIds.input(list)) as HTMLInputElement | HTMLTextAreaElement

/** 記録を取り始める */
function startLog() {
  setSwipeLogEnabled(true)
  clearSwipeLog()
}

/** 指の出来事（touch の座標だけを持つ Event。jsdom には Touch が無い） */
function touch(target: EventTarget, type: string, x: number, y: number, down: boolean) {
  const ev = new Event(type, { bubbles: true, cancelable: true })
  const point = { clientX: x, clientY: y }
  Object.defineProperty(ev, 'touches', { value: down ? [point] : [] })
  Object.defineProperty(ev, 'changedTouches', { value: [point] })
  target.dispatchEvent(ev)
}
const pointer = (target: EventTarget, type: string, x: number, y: number) =>
  target.dispatchEvent(
    new PointerEvent(type, { bubbles: true, pointerType: 'touch', pointerId: 31, isPrimary: true, clientX: x, clientY: y }),
  )

/**
 * 端から指で払う（iPhone と同じ順: touchstart・pointerdown、少し動いた所で pointercancel（ブラウザが指を取った）、その後は
 * touchmove だけ、最後に touchend。pointerFirst は pointerdown を先に送る順）。side は -1 が左の端から右へ、1 が右の端から左へ
 * （右の端は jsdom の窓の幅の端）。hold は pointercancel の後、離すまで待つ長さ（ms）
 */
async function swipeFrom(
  target: Element,
  { side = -1, pointerFirst = false, hold = 0 }: { side?: -1 | 1; pointerFirst?: boolean; hold?: number } = {},
) {
  const y = 300
  const at = (x: number) => (side === -1 ? x : window.innerWidth - x)
  await act(async () => {
    if (pointerFirst) {
      pointer(target, 'pointerdown', at(3), y)
      touch(target, 'touchstart', at(3), y, true)
    } else {
      touch(target, 'touchstart', at(3), y, true)
      pointer(target, 'pointerdown', at(3), y)
    }
    touch(target, 'touchmove', at(20), y, true)
    pointer(target, 'pointercancel', at(20), y)
    if (hold) await new Promise((r) => setTimeout(r, hold))
    for (const x of [60, 100, 143]) touch(target, 'touchmove', at(x), y - 4, true)
    touch(target, 'touchend', at(143), y - 4, false)
  })
}
const swipeFromLeft = (target: Element, opts: { pointerFirst?: boolean; hold?: number } = {}) => swipeFrom(target, opts)

/**
 * WebKit が、欄から外れた時に変換の途中の字を決めて書く（入力の出来事を送る）のを真似る（Chromium・jsdom は書かない）。その欄が
 * 次に外れた時に1回だけ、text を入れて input を送る
 */
function commitOnBlur(el: HTMLInputElement | HTMLTextAreaElement, text: string) {
  el.addEventListener('blur', () => fireEvent.input(el, { target: { value: text } }), { once: true })
}

describe('■36 打っている間の端からのフリック（iPhone・iPad。本物のトップの画面で）', () => {
  it('Task List の入力欄に字と［締め切り日］［依頼者］のチップがある時: 打ちかけを捨てて欄から外すだけ（リストは開いたまま・モードも行き先もそのまま。記録は dialog と type-cancel）。次のフリック（打っていない）は今までどおり畳む（■34）', async () => {
    localStorage.setItem(
      draftKey('task'),
      JSON.stringify({ text: '名刺を頼む', start: null, due: '2026-11-11', requester: '人事' }),
    )
    const { router, history, win } = await openTop()
    await openList('task')
    const input = field('task')
    expect(input.value).toBe('名刺を頼む')
    expect(screen.getByTestId(listTestIds.taskChip('requester')).textContent).toBe('人事')
    act(() => input.focus())
    startLog()
    act(() => history.flick(-1))
    expect(input.value).toBe('')
    expect(localStorage.getItem(draftKey('task'))).toBeNull()
    expect(screen.getByTestId(listTestIds.taskChip('due')).textContent).toBe('締め切り日')
    expect(screen.getByTestId(listTestIds.taskChip('requester')).textContent).toBe('依頼者')
    expect(document.activeElement).not.toBe(input)
    expect(lists().collapsed.task).toBe(false)
    expect(router.state.location.pathname).toBe('/month/2026-11')
    const log = swipeLogText()
    expect(log).toMatch(/ type-cancel \{"kind":"list-input","list":"task"\}/)
    expect(log).toMatch(/ flick \{"side":-1,"screen":"calendar","action":"dialog"\}/)
    expect(log).not.toContain('名刺')
    // 次のフリック（何も打っていない）は ■34 のとおり畳む
    act(() => history.flick(-1))
    expect(lists().collapsed.task).toBe(true)
    expect(router.state.location.pathname).toBe('/month/2026-11')
    expect(win.entries).toHaveLength(1)
    expect(win.calls.filter((c) => c.op !== 'replaceState')).toEqual([])
  })

  it('［依頼者］の欄（入力欄の下のチップ）に打っている時: 入力欄の打ちかけと一緒に捨てる（件名の字・［締め切り日］・依頼者の欄の字を決めずに捨てて閉じ、書きかけも消す。件名の欄へは戻さない）', async () => {
    localStorage.setItem(draftKey('task'), JSON.stringify({ text: '名刺を頼む', start: null, due: '2026-11-11', requester: '' }))
    const { history } = await openTop()
    await openList('task')
    expect(field('task').value).toBe('名刺を頼む')
    fireEvent.click(screen.getByTestId(listTestIds.taskChip('requester')))
    const box = screen.getByTestId(taskTestIds.chipRequesterInput) as HTMLInputElement
    expect(document.activeElement).toBe(box)
    fireEvent.change(box, { target: { value: '総務' } })
    startLog()
    act(() => history.flick(1))
    expect(screen.queryByTestId(taskTestIds.chipRequesterInput)).toBeNull()
    expect(field('task').value).toBe('')
    expect(screen.getByTestId(listTestIds.taskChip('due')).textContent).toBe('締め切り日')
    expect(screen.getByTestId(listTestIds.taskChip('requester')).textContent).toBe('依頼者')
    expect(localStorage.getItem(draftKey('task'))).toBeNull()
    expect(document.activeElement).not.toBe(field('task'))
    expect(lists().collapsed.task).toBe(false)
    expect(swipeLogText()).toMatch(/ type-cancel \{"kind":"list-input","list":"task"\}/)
  })

  it('Favorite List の本文の欄（複数行）・Routine List の欄も同じ: 打ちかけを捨てて外すだけ', async () => {
    const { router, history } = await openTop()
    await openList('favorite')
    const area = field('favorite')
    act(() => area.focus())
    fireEvent.change(area, { target: { value: 'あとで読む本\n2冊目' } })
    act(() => history.flick(-1))
    expect(area.value).toBe('')
    expect(document.activeElement).not.toBe(area)
    expect(lists().collapsed.favorite).toBe(false)
    await openList('routine')
    const routine = field('routine')
    act(() => routine.focus())
    fireEvent.change(routine, { target: { value: '朝の体操' } })
    act(() => history.flick(1))
    expect(routine.value).toBe('')
    expect(document.activeElement).not.toBe(routine)
    expect(lists().collapsed.routine).toBe(false)
    expect(router.state.location.pathname).toBe('/month/2026-11')
    expect(localStorage.getItem(draftKey('favorite'))).toBeNull()
    expect(localStorage.getItem(draftKey('routine'))).toBeNull()
  })

  it('変換の途中の字: 決めずに捨てる（変換の終わりの後に決まった字も入れない）。フォーカスはそのリストの畳む・開くボタンへ（■34 と同じ）', async () => {
    const { history } = await openTop()
    await openList('task')
    const input = field('task')
    act(() => input.focus())
    fireEvent.compositionStart(input)
    fireEvent.change(input, { target: { value: 'かいぎしつ' } })
    act(() => history.flick(-1))
    // 外れた後にブラウザが変換を決めて書く
    fireEvent.compositionEnd(input)
    fireEvent.change(input, { target: { value: '会議室' } })
    expect(input.value).toBe('')
    expect(document.activeElement).toBe(screen.getByTestId(listTestIds.fold('task')))
    expect(lists().collapsed.task).toBe(false)
    expect(Object.values(getData().items).map((i) => i.title)).toEqual(['見積もりの返事'])
  })

  it('Task List の行の件名をその場で直している時: Esc と同じく保存せずにやめ（件名はそのまま）、欄から外す。リストは開いたまま・入力欄の打ちかけも残る', async () => {
    localStorage.setItem(draftKey('task'), JSON.stringify({ text: '残す字', start: null, due: null, requester: '' }))
    const { history } = await openTop()
    await openList('task')
    startLog()
    fireEvent.click(screen.getByTestId(listTestIds.rowTitle('task', 't1')))
    const edit = screen.getByTestId(listTestIds.rowEdit('task', 't1')) as HTMLInputElement
    expect(document.activeElement).toBe(edit)
    fireEvent.change(edit, { target: { value: '見積もりの返事を送る' } })
    act(() => history.flick(-1))
    expect(getData().items.t1.title).toBe('見積もりの返事')
    expect(screen.queryByTestId(listTestIds.rowEdit('task', 't1'))).toBeNull()
    expect(document.activeElement?.tagName).not.toBe('INPUT')
    expect(lists().collapsed.task).toBe(false)
    expect(field('task').value).toBe('残す字')
    expect(swipeLogText()).toMatch(/ type-cancel \{"kind":"inline-edit","list":"task"\}/)
  })

  it('Favorite List の行の本文を直している時: 自動保存（0.6秒）より前の字は保存しない。自動保存した後の分は Esc と同じく残る（その後の字は捨てる）', async () => {
    const { history } = await openTop()
    await openList('favorite')
    fireEvent.click(screen.getByTestId(listTestIds.rowTitle('favorite', 'f1')))
    const edit = () => screen.getByTestId(listTestIds.rowEdit('favorite', 'f1')) as HTMLTextAreaElement
    fireEvent.change(edit(), { target: { value: '近所のパン屋に寄る（土曜）' } })
    act(() => history.flick(-1))
    expect(getData().favorites.f1.text).toBe('近所のパン屋に寄る')
    expect(screen.queryByTestId(listTestIds.rowEdit('favorite', 'f1'))).toBeNull()
    // 直し始めて、自動保存まで待ってから続けて打つ
    fireEvent.click(screen.getByTestId(listTestIds.rowTitle('favorite', 'f1')))
    fireEvent.change(edit(), { target: { value: '近所のパン屋' } })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 700))
    })
    expect(getData().favorites.f1.text).toBe('近所のパン屋')
    fireEvent.change(edit(), { target: { value: '近所のパン屋と本屋' } })
    act(() => history.flick(-1))
    expect(getData().favorites.f1.text).toBe('近所のパン屋')
    expect(lists().collapsed.favorite).toBe(false)
  })

  it('すばやく足す（S の週）: 字を足さずに閉じ、その日・その区分の書きかけも消す。モードは替わらない。次のフリックでモードを回す', async () => {
    const { router, history } = await openTop('/week/2026-11-08')
    startLog()
    fireEvent.click(screen.getByTestId(testIds.weekAdd('2026-11-12', 'work')))
    const input = screen.getByTestId(testIds.quickAddInput) as HTMLInputElement
    fireEvent.change(input, { target: { value: '資料を送る' } })
    expect(readLocal(quickDraftKey('2026-11-12', 'work'))).toBe('資料を送る')
    act(() => history.flick(-1))
    expect(screen.queryByTestId(testIds.quickAddInput)).toBeNull()
    expect(readLocal(quickDraftKey('2026-11-12', 'work'))).toBeNull()
    expect(Object.values(getData().items).map((i) => i.title)).toEqual(['見積もりの返事'])
    expect(router.state.location.pathname).toBe('/week/2026-11-08')
    expect(swipeLogText()).toMatch(/ type-cancel \{"kind":"quick-add","list":null\}/)
    await act(async () => history.flick(-1))
    expect(router.state.location.pathname).toBe('/day/2026-11-10')
  })

  it('L（iPad の横向きの右の列）: Task List の入力欄で打っている時も、入力をやめるだけ（モードは回さない）', async () => {
    const { router, history } = await openTop('/week/2026-11-08', { width: 'L' })
    const input = field('task')
    act(() => input.focus())
    fireEvent.change(input, { target: { value: '右の列で打つ' } })
    act(() => history.flick(1))
    expect(input.value).toBe('')
    expect(document.activeElement).not.toBe(input)
    expect(router.state.location.pathname).toBe('/week/2026-11-08')
    await act(async () => history.flick(1))
    expect(router.state.location.pathname).toBe('/month/2026-11')
  })

  for (const width of ['M', 'L'] as const) {
    it(`MIM の横のリストで打っている時（${width}）も、入力をやめるだけ（MIM のまま。キーボードを出したまま画面が替わらない）。次のフリック（打っていない）は今までどおり1つ戻る`, async () => {
      const { router, history } = await openTop('/mim', { width })
      startLog()
      const input = field('task')
      act(() => input.focus())
      fireEvent.change(input, { target: { value: 'MIM の横で打つ' } })
      act(() => history.flick(-1))
      expect(input.value).toBe('')
      expect(document.activeElement).not.toBe(input)
      expect(localStorage.getItem(draftKey('task'))).toBeNull()
      expect(router.state.location.pathname).toBe('/mim')
      expect(swipeLogText()).toMatch(/ type-cancel \{"kind":"list-input","list":"task"\}/)
      await act(async () => history.flick(-1))
      expect(router.state.location.pathname).not.toBe('/mim')
    })
  }

  it('打っていない時（キーボードの✓で外した後）は今までどおり: 見ている開いたリストを畳み、打ちかけを捨てる（■34）', async () => {
    const { history } = await openTop()
    await openList('task')
    const input = field('task')
    act(() => input.focus())
    fireEvent.change(input, { target: { value: '外してから払う' } })
    act(() => input.blur())
    act(() => history.flick(-1))
    expect(lists().collapsed.task).toBe(true)
    expect(localStorage.getItem(draftKey('task'))).toBeNull()
  })
})

describe('■36 行の依頼者（L）・やめた後に遅れて来る入力の字', () => {
  it('L の行の依頼者をその場で直している時: Esc と同じく決めずにやめる（依頼者はそのまま・欄は閉じる・モードもそのまま）', async () => {
    const data = { ...DATA, items: items(mkTask({ id: 't1', title: '見積もりの返事', requester: '営業部' })) }
    const { router, history } = await openTop('/week/2026-11-08', { width: 'L', data })
    startLog()
    fireEvent.click(screen.getByTestId(listTestIds.taskRequester('t1')))
    const box = screen.getByTestId(taskTestIds.requesterEdit('t1')) as HTMLInputElement
    expect(document.activeElement).toBe(box)
    fireEvent.change(box, { target: { value: '経理' } })
    act(() => history.flick(-1))
    expect(screen.queryByTestId(taskTestIds.requesterEdit('t1'))).toBeNull()
    expect(getData().items.t1.requester).toBe('営業部')
    expect(screen.getByTestId(listTestIds.taskRequester('t1')).textContent).toBe('営業部')
    expect(document.activeElement?.tagName).not.toBe('INPUT')
    expect(router.state.location.pathname).toBe('/week/2026-11-08')
    expect(swipeLogText()).toMatch(/ type-cancel \{"kind":"inline-edit","list":"task"\}/)
  })

  it('すばやく足す: やめて欄から外した時に変換の途中の字が決まって書かれても（WebKit）、書きかけに戻さない（開き直すと空）', async () => {
    const { history } = await openTop('/week/2026-11-08')
    fireEvent.click(screen.getByTestId(testIds.weekAdd('2026-11-12', 'work')))
    const input = screen.getByTestId(testIds.quickAddInput) as HTMLInputElement
    fireEvent.compositionStart(input)
    fireEvent.change(input, { target: { value: 'かいぎ' } })
    commitOnBlur(input, '会議')
    act(() => history.flick(-1))
    expect(screen.queryByTestId(testIds.quickAddInput)).toBeNull()
    expect(readLocal(quickDraftKey('2026-11-12', 'work'))).toBeNull()
    fireEvent.click(screen.getByTestId(testIds.weekAdd('2026-11-12', 'work')))
    expect((screen.getByTestId(testIds.quickAddInput) as HTMLInputElement).value).toBe('')
    expect(Object.values(getData().items).map((i) => i.title)).toEqual(['見積もりの返事'])
  })

  it('Task List の行の件名: やめて欄から外した時に変換の字が決まって書かれても、保存しない（閉じる・裏に回る時に保存する分にも入れない）', async () => {
    const { history } = await openTop()
    await openList('task')
    fireEvent.click(screen.getByTestId(listTestIds.rowTitle('task', 't1')))
    const edit = screen.getByTestId(listTestIds.rowEdit('task', 't1')) as HTMLInputElement
    fireEvent.compositionStart(edit)
    fireEvent.change(edit, { target: { value: '見積もりの返事へんしん' } })
    commitOnBlur(edit, '見積もりの返事返信')
    act(() => history.flick(-1))
    expect(hasDirtyDrafts()).toBe(false)
    act(() => flushAllDrafts())
    expect(getData().items.t1.title).toBe('見積もりの返事')
    expect(screen.queryByTestId(listTestIds.rowEdit('task', 't1'))).toBeNull()
  })

  it('Favorite List の行の本文: やめて欄から外した時に変換の字が決まって書かれても、自動保存（0.6秒）しない', async () => {
    const { history } = await openTop()
    await openList('favorite')
    fireEvent.click(screen.getByTestId(listTestIds.rowTitle('favorite', 'f1')))
    const edit = screen.getByTestId(listTestIds.rowEdit('favorite', 'f1')) as HTMLTextAreaElement
    fireEvent.compositionStart(edit)
    fireEvent.change(edit, { target: { value: '近所のパン屋に寄るどようび' } })
    commitOnBlur(edit, '近所のパン屋に寄る土曜日')
    act(() => history.flick(-1))
    await act(async () => {
      await new Promise((r) => setTimeout(r, 700))
    })
    expect(getData().favorites.f1.text).toBe('近所のパン屋に寄る')
    expect(hasDirtyDrafts()).toBe(false)
  })
})

describe('■36 何から来たかで分ける（consumeBackPress）', () => {
  it('iPhone・iPad（端からのフリック）は打っている欄をやめて true。Android・PC（OS の戻る）は打っている欄に触れず false（今までどおり）', async () => {
    await openTop()
    await openList('task')
    const input = field('task')
    act(() => input.focus())
    fireEvent.change(input, { target: { value: '戻るで残す' } })
    vi.spyOn(device, 'currentPopSource').mockReturnValue('os-back')
    expect(consumeBackPress()).toBe(false)
    expect(input.value).toBe('戻るで残す')
    expect(document.activeElement).toBe(input)
    vi.spyOn(device, 'currentPopSource').mockReturnValue('edge-flick')
    let consumed = false
    act(() => {
      consumed = consumeBackPress()
    })
    expect(consumed).toBe(true)
    expect(input.value).toBe('')
    // 打っていなければ false
    expect(consumeBackPress()).toBe(false)
  })
})

describe('■36 端の指の出来事の順（iPhone と同じ順で送る）', () => {
  for (const pointerFirst of [false, true]) {
    it(`すばやく足すを開いて打っている時に左の端から払う（${pointerFirst ? 'pointer が先' : 'touch が先'}）: 足さずに閉じ、書きかけも消し、モードは回さない`, async () => {
      const { router } = await openTop('/week/2026-11-08', { edge: true })
      fireEvent.click(screen.getByTestId(testIds.weekAdd('2026-11-12', 'work')))
      const input = screen.getByTestId(testIds.quickAddInput) as HTMLInputElement
      fireEvent.change(input, { target: { value: '払ってやめる' } })
      await swipeFromLeft(screen.getByTestId(testIds.calendarBody), { pointerFirst })
      expect(screen.queryByTestId(testIds.quickAddInput)).toBeNull()
      expect(readLocal(quickDraftKey('2026-11-12', 'work'))).toBeNull()
      expect(Object.values(getData().items).map((i) => i.title)).toEqual(['見積もりの返事'])
      expect(router.state.location.pathname).toBe('/week/2026-11-08')
    })
  }

  it('Task List の入力欄で打っている時に左の端から払う: 打ちかけを捨てて外すだけ（畳まない）', async () => {
    const { router } = await openTop('/month/2026-11', { edge: true })
    await openList('task')
    const input = field('task')
    act(() => input.focus())
    fireEvent.change(input, { target: { value: '端から払う' } })
    await swipeFromLeft(screen.getByTestId(listTestIds.section('task')))
    expect(input.value).toBe('')
    expect(document.activeElement).not.toBe(input)
    expect(lists().collapsed.task).toBe(false)
    expect(router.state.location.pathname).toBe('/month/2026-11')
  })

  it('端に指を置いた時にすばやく足すが開いていて、払い終える前に閉じた（キーボードの✓で外れていて、指を取られた後に少し待って足した）時も、そのフリックは使い切る（モードを回さない）', async () => {
    const { router } = await openTop('/week/2026-11-08', { edge: true })
    startLog()
    fireEvent.click(screen.getByTestId(testIds.weekAdd('2026-11-12', 'work')))
    const input = screen.getByTestId(testIds.quickAddInput) as HTMLInputElement
    fireEvent.change(input, { target: { value: '✓で決めた字' } })
    const body = screen.getByTestId(testIds.calendarBody)
    // 端に指を置いた直後に、キーボードの✓でフォーカスが外れる（端を押している間は、離すまで決めない）
    await act(async () => {
      touch(body, 'touchstart', 3, 300, true)
      pointer(body, 'pointerdown', 3, 300)
      vi.spyOn(document, 'hasFocus').mockReturnValue(true)
      input.blur()
    })
    // ブラウザが指を取った後、離すまでに少し待つ（その間に足して閉じる）
    await act(async () => {
      touch(body, 'touchmove', 20, 300, true)
      pointer(body, 'pointercancel', 20, 300)
      await new Promise((r) => setTimeout(r, BLUR_SETTLE_MS + 80))
    })
    expect(screen.queryByTestId(testIds.quickAddInput)).toBeNull()
    await act(async () => {
      for (const x of [60, 100, 143]) touch(body, 'touchmove', x, 296, true)
      touch(body, 'touchend', 143, 296, false)
    })
    expect(router.state.location.pathname).toBe('/week/2026-11-08')
    expect(swipeLogText()).toMatch(/ type-cancel \{"kind":"quick-add","list":null,"gone":true\}/)
  })

  for (const pointerFirst of [false, true]) {
    it(`Task List の入力欄で変換の途中に、右の端の幅の中の［足す］から払う（${pointerFirst ? 'pointer が先' : 'touch が先'}）: 押した時に［足す］が変換を決めるために欄から外しても、打ちかけを捨てるだけ（畳まない・行き先もそのまま）`, async () => {
      const { router } = await openTop('/month/2026-11', { edge: true })
      await openList('task')
      startLog()
      const input = field('task')
      act(() => input.focus())
      fireEvent.compositionStart(input)
      fireEvent.change(input, { target: { value: '会議室よやく' } })
      await swipeFrom(screen.getByTestId(listTestIds.add('task')), { side: 1, pointerFirst })
      expect(input.value).toBe('')
      expect(localStorage.getItem(draftKey('task'))).toBeNull()
      expect(lists().collapsed.task).toBe(false)
      expect(router.state.location.pathname).toBe('/month/2026-11')
      expect(Object.values(getData().items).map((i) => i.title)).toEqual(['見積もりの返事'])
      expect(swipeLogText()).toMatch(/ type-cancel \{"kind":"list-input","list":"task"/)
    })

    it(`すばやく足すで変換の途中に、右の端の幅の中の［足す］（✓）から払う（${pointerFirst ? 'pointer が先' : 'touch が先'}。指を取られてから離すまで ${BLUR_SETTLE_MS + 80}ms）: 足さずに閉じ、書きかけも消し、モードは回さない`, async () => {
      const { router } = await openTop('/week/2026-11-08', { edge: true })
      fireEvent.click(screen.getByTestId(testIds.weekAdd('2026-11-12', 'work')))
      const input = screen.getByTestId(testIds.quickAddInput) as HTMLInputElement
      fireEvent.compositionStart(input)
      fireEvent.change(input, { target: { value: 'かいぎ' } })
      vi.spyOn(document, 'hasFocus').mockReturnValue(true)
      await swipeFrom(screen.getByTestId(testIds.quickAddButton), { side: 1, pointerFirst, hold: BLUR_SETTLE_MS + 80 })
      await act(async () => {
        await new Promise((r) => setTimeout(r, BLUR_SETTLE_MS + 80))
      })
      expect(screen.queryByTestId(testIds.quickAddInput)).toBeNull()
      expect(readLocal(quickDraftKey('2026-11-12', 'work'))).toBeNull()
      expect(Object.values(getData().items).map((i) => i.title)).toEqual(['見積もりの返事'])
      expect(router.state.location.pathname).toBe('/week/2026-11-08')
    })
  }

  it('前の押しの離した出来事が来なかった時は、次の押しで控え直す（前に打っていたことを持ち越さない）: 打つのをやめた後の次のフリックは今までどおり畳む（■34）', async () => {
    const { router } = await openTop('/month/2026-11', { edge: true })
    await openList('task')
    const input = field('task')
    act(() => input.focus())
    fireEvent.change(input, { target: { value: '前の押し' } })
    const section = screen.getByTestId(listTestIds.section('task'))
    // 端に指を置いた（打っている）が、離した出来事も取り消しも来なかった
    act(() => {
      touch(section, 'touchstart', 3, 300, true)
      pointer(section, 'pointerdown', 3, 300)
    })
    act(() => input.blur())
    await swipeFrom(section)
    expect(lists().collapsed.task).toBe(true)
    expect(localStorage.getItem(draftKey('task'))).toBeNull()
    expect(router.state.location.pathname).toBe('/month/2026-11')
  })
})

describe('■36 打っている欄が見える所の上の外にある時（iPhone・iPad の WebKit にはスクロールの錨が無い）', () => {
  /** 次の描画まで待つ（やめた後の送りは、次の描画の前にする） */
  const nextFrame = () =>
    act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(null)))
    })

  /** 要素ごとの画面の上からの位置と高さ（と左の端・幅。既定は 0・320px）を決める（null を返した物は jsdom と同じく 0） */
  function fakeRects(of: (el: Element) => { top: number; height: number; left?: number; width?: number } | null) {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const r = of(this)
      return r ? new DOMRect(r.left ?? 0, r.top, r.width ?? 320, r.height) : new DOMRect(0, 0, 0, 0)
    })
  }

  /** ページのスクロールの位置を y にし、scrollTo を見張る（終わったら 0 に戻す） */
  function fakePageScroll(y: number) {
    Object.defineProperty(window, 'scrollY', { configurable: true, value: y })
    const scrollTo = vi.fn()
    window.scrollTo = scrollTo as typeof window.scrollTo
    disposers.push(() => Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 }))
    return scrollTo
  }

  /** S・M の見える所の上の端（ヘッダー 52px と切り替えの列 41px の下: 93px） */
  const bars = (el: Element) =>
    el.classList.contains('app-header')
      ? { top: 0, height: 52 }
      : el.classList.contains('top-switcher')
        ? { top: 52, height: 41 }
        : null

  it('S: Favorite List の入力欄（4行の書きかけ）が見える所（ヘッダーと切り替えの列の下）の上の外にある時に払うと、やめて欄が縮んだ分（64px）だけ、次の描画の前にページを送って、見えている下の行を同じ所に残す（記録は type-cancel-keep。打った字は控えない）', async () => {
    const { history } = await openTop()
    await openList('favorite')
    const area = field('favorite')
    act(() => area.focus())
    fireEvent.change(area, { target: { value: '1行目の書きかけ\n2行目\n3行目\n4行目' } })
    const box = area.closest('.list-input-box')
    const row = screen.getByTestId(listTestIds.row('favorite', 'f1'))
    // 伸びた入力欄は 104px（空にすると 40px）。下の行は、欄が縮むと 64px 上がる
    const grown = () => area.value !== ''
    fakeRects(
      (el) =>
        bars(el) ??
        (el === box
          ? { top: -300, height: grown() ? 112 : 48 }
          : el === area
            ? { top: -296, height: grown() ? 104 : 40 }
            : el === row
              ? { top: grown() ? 150 : 86, height: 44 }
              : null),
    )
    const scrollTo = fakePageScroll(1500)
    startLog()
    act(() => history.flick(-1))
    expect(area.value).toBe('')
    expect(document.activeElement).not.toBe(area)
    await nextFrame()
    expect(scrollTo).toHaveBeenCalledTimes(1)
    expect(scrollTo).toHaveBeenCalledWith({ top: 1436, behavior: 'auto' })
    const log = swipeLogText()
    expect(log).toMatch(/ type-cancel-keep \{"kind":"list-input","list":"favorite","moved":-64\}/)
    expect(log).not.toContain('書きかけ')
    expect(lists().collapsed.favorite).toBe(false)
  })

  it('入力欄が全部見えている時（上の端が見える所の上の端より下）は、欄が縮んで下の物が上がってきても、ページを送らない（今までどおり）', async () => {
    const { history } = await openTop()
    await openList('favorite')
    const area = field('favorite')
    act(() => area.focus())
    fireEvent.change(area, { target: { value: '1行目\n2行目\n3行目\n4行目' } })
    const box = area.closest('.list-input-box')
    const row = screen.getByTestId(listTestIds.row('favorite', 'f1'))
    const grown = () => area.value !== ''
    fakeRects(
      (el) =>
        bars(el) ??
        (el === box
          ? { top: 120, height: grown() ? 112 : 48 }
          : el === area
            ? { top: 124, height: grown() ? 104 : 40 }
            : el === row
              ? { top: grown() ? 240 : 176, height: 44 }
              : null),
    )
    const scrollTo = fakePageScroll(1500)
    startLog()
    act(() => history.flick(-1))
    expect(area.value).toBe('')
    await nextFrame()
    expect(scrollTo).not.toHaveBeenCalled()
    expect(swipeLogText()).not.toContain('type-cancel-keep')
  })

  it('ブラウザがもう見えている物を保っていた時（Chromium のスクロールの錨）は、足して送らない', async () => {
    const { history } = await openTop()
    await openList('favorite')
    const area = field('favorite')
    act(() => area.focus())
    fireEvent.change(area, { target: { value: '1行目\n2行目\n3行目\n4行目' } })
    const box = area.closest('.list-input-box')
    const row = screen.getByTestId(listTestIds.row('favorite', 'f1'))
    const grown = () => area.value !== ''
    // 欄は縮むが、ブラウザがページの位置を替えて、下の行は同じ所のまま
    fakeRects(
      (el) =>
        bars(el) ??
        (el === box
          ? { top: grown() ? -300 : -236, height: grown() ? 112 : 48 }
          : el === area
            ? { top: grown() ? -296 : -232, height: grown() ? 104 : 40 }
            : el === row
              ? { top: 150, height: 44 }
              : null),
    )
    const scrollTo = fakePageScroll(1500)
    act(() => history.flick(-1))
    expect(area.value).toBe('')
    await nextFrame()
    expect(scrollTo).not.toHaveBeenCalled()
  })

  it('L（iPad の横向き）: 右の列の中で入力欄が右の列の見える所の上の外にある時は、右の列を送る（ページは送らない）', async () => {
    const { history } = await openTop('/week/2026-11-08', { width: 'L' })
    const side = screen.getByTestId('side-column')
    side.style.overflowY = 'auto'
    Object.defineProperty(side, 'scrollHeight', { configurable: true, value: 3000 })
    Object.defineProperty(side, 'clientHeight', { configurable: true, value: 768 })
    Object.defineProperty(side, 'scrollTop', { configurable: true, writable: true, value: 900 })
    const sideScroll = vi.fn()
    side.scrollTo = sideScroll as typeof side.scrollTo
    const area = field('favorite')
    act(() => area.focus())
    fireEvent.change(area, { target: { value: '1行目\n2行目\n3行目\n4行目' } })
    const box = area.closest('.list-input-box')
    const row = screen.getByTestId(listTestIds.row('favorite', 'f1'))
    const grown = () => area.value !== ''
    fakeRects((el) =>
      el === side
        ? { top: 52, height: 768 }
        : el === box
          ? { top: -100, height: grown() ? 112 : 48 }
          : el === area
            ? { top: -96, height: grown() ? 104 : 40 }
            : el === row
              ? { top: grown() ? 350 : 286, height: 44 }
              : null,
    )
    const scrollTo = fakePageScroll(0)
    startLog()
    act(() => history.flick(1))
    expect(area.value).toBe('')
    await nextFrame()
    expect(sideScroll).toHaveBeenCalledWith({ top: 836, behavior: 'auto' })
    expect(scrollTo).not.toHaveBeenCalled()
    expect(swipeLogText()).toMatch(/ type-cancel-keep \{"kind":"list-input","list":"favorite","moved":-64\}/)
  })

  it('行の中で直している Favorite List の本文が見える所の上の外にある時: 払うと、保存せずにやめて行が縮んだ分だけ送り、下の行を同じ所に残す。Esc でやめた時は送らない（端からのフリックだけ）', async () => {
    const data = {
      ...DATA,
      favorites: {
        f1: mkFavorite({ id: 'f1', text: '読んでみたい本\n1冊目\n2冊目\n3冊目\n4冊目\n5冊目', order: 0 }),
        f2: mkFavorite({ id: 'f2', text: '近所のパン屋に寄る', order: 1 }),
      },
    }
    const { history } = await openTop('/month/2026-11', { data })
    await openList('favorite')
    const row = screen.getByTestId(listTestIds.row('favorite', 'f1'))
    const next = screen.getByTestId(listTestIds.row('favorite', 'f2'))
    const editId = listTestIds.rowEdit('favorite', 'f1')
    const editing = () => screen.queryByTestId(editId) !== null
    // 直している間の行は 160px（直す欄が 148px）、やめると3行の 124px
    fakeRects(
      (el) =>
        bars(el) ??
        (el === row
          ? { top: -200, height: editing() ? 160 : 124 }
          : el.getAttribute('data-testid') === editId
            ? { top: -194, height: 148 }
            : el === next
              ? { top: editing() ? -40 : -76, height: 200 }
              : null),
    )
    const scrollTo = fakePageScroll(1500)
    // Esc でやめる: 送らない
    fireEvent.click(screen.getByTestId(listTestIds.rowTitle('favorite', 'f1')))
    fireEvent.change(screen.getByTestId(editId), { target: { value: '読んでみたい本（直しかけ）' } })
    fireEvent.keyDown(screen.getByTestId(editId), { key: 'Escape' })
    expect(editing()).toBe(false)
    await nextFrame()
    expect(scrollTo).not.toHaveBeenCalled()
    // 直し始めて払う: 行が縮んだ 36px だけ送る
    fireEvent.click(screen.getByTestId(listTestIds.rowTitle('favorite', 'f1')))
    expect(document.activeElement).toBe(screen.getByTestId(editId))
    fireEvent.change(screen.getByTestId(editId), { target: { value: '読んでみたい本（直しかけ）' } })
    startLog()
    act(() => history.flick(-1))
    expect(editing()).toBe(false)
    expect(getData().favorites.f1.text).toBe('読んでみたい本\n1冊目\n2冊目\n3冊目\n4冊目\n5冊目')
    await nextFrame()
    expect(scrollTo).toHaveBeenCalledTimes(1)
    expect(scrollTo).toHaveBeenCalledWith({ top: 1464, behavior: 'auto' })
    expect(swipeLogText()).toMatch(/ type-cancel-keep \{"kind":"inline-edit","list":"favorite","moved":-36\}/)
    expect(swipeLogText()).not.toContain('直しかけ')
  })

  it('S: 入力欄の上の端が見える所の上の端より少し（2px）だけ上に隠れている時に払うと、隠れていた 2px だけ送って欄の上の端を見える所の上の端に合わせ、欄より上の物は下ろさない（縮んだ残りの 62px は、下の行が上がってくる）', async () => {
    const { history } = await openTop()
    await openList('favorite')
    const area = field('favorite')
    act(() => area.focus())
    fireEvent.change(area, { target: { value: '1行目の書きかけ\n2行目\n3行目\n4行目' } })
    const box = area.closest('.list-input-box')
    const row = screen.getByTestId(listTestIds.row('favorite', 'f1'))
    const grown = () => area.value !== ''
    // 見える所の上の端は 93px。欄の上の端は 91px（2px だけ隠れている）
    fakeRects(
      (el) =>
        bars(el) ??
        (el === box
          ? { top: 87, height: grown() ? 112 : 48 }
          : el === area
            ? { top: 91, height: grown() ? 104 : 40 }
            : el === row
              ? { top: grown() ? 207 : 143, height: 44 }
              : null),
    )
    const scrollTo = fakePageScroll(1500)
    startLog()
    act(() => history.flick(-1))
    expect(area.value).toBe('')
    await nextFrame()
    expect(scrollTo).toHaveBeenCalledTimes(1)
    expect(scrollTo).toHaveBeenCalledWith({ top: 1498, behavior: 'auto' })
    expect(swipeLogText()).toMatch(/ type-cancel-keep \{"kind":"list-input","list":"favorite","moved":-2\}/)
  })

  it('S の週: すばやく足すの入力欄が週の中のスクロールする所の見える所の上の外にある時に払うと、足さずに閉じて「＋」の行に戻り縮んだ分（12px）だけ、次の描画の前に週の中を送る（隣の半分の中の物は目印にしない。ページは送らない）', async () => {
    const { router, history } = await openTop('/week/2026-11-08')
    fireEvent.click(screen.getByTestId(testIds.weekAdd('2026-11-08', 'work')))
    const input = screen.getByTestId(testIds.quickAddInput) as HTMLInputElement
    fireEvent.change(input, { target: { value: '買い物' } })
    const quick = input.closest('.cp-quick')
    const week = screen.getByTestId(testIds.view('week'))
    week.style.overflowY = 'auto'
    Object.defineProperty(week, 'scrollHeight', { configurable: true, value: 2000 })
    Object.defineProperty(week, 'clientHeight', { configurable: true, value: 600 })
    Object.defineProperty(week, 'scrollTop', { configurable: true, writable: true, value: 142 })
    const weekScroll = vi.fn()
    week.scrollTo = weekScroll as typeof week.scrollTo
    const privateHalf = week.querySelector('.wk-half[data-tier="private"][data-date="2026-11-08"]')
    const privatePlus = screen.getByTestId(testIds.weekAdd('2026-11-08', 'private'))
    const nextDay = screen.getByTestId(testIds.weekCol('2026-11-09'))
    expect(privateHalf).not.toBeNull()
    const open = () => screen.queryByTestId(testIds.quickAddInput) !== null
    // 週の見える所は 192px から。入力欄（136〜176px）は上の外。隣（プライベート）の半分は同じ高さから始まり、その中の「＋」は
    // 入力欄より下にあるが、縮んでも動かない。次の日のかたまりは、閉じて縮んだ 12px だけ上がる
    fakeRects((el) =>
      el === week
        ? { top: 192, height: 600 }
        : el === quick || el === input
          ? { top: 136, height: 40, left: 0, width: 160 }
          : el === privateHalf
            ? { top: 100, height: 400, left: 160, width: 160 }
            : el === privatePlus
              ? { top: 300, height: 28, left: 160, width: 160 }
              : el === nextDay
                ? { top: open() ? 186 : 174, height: 300 }
                : null,
    )
    const scrollTo = fakePageScroll(0)
    startLog()
    act(() => history.flick(-1))
    expect(screen.queryByTestId(testIds.quickAddInput)).toBeNull()
    expect(readLocal(quickDraftKey('2026-11-08', 'work'))).toBeNull()
    await nextFrame()
    expect(weekScroll).toHaveBeenCalledTimes(1)
    expect(weekScroll).toHaveBeenCalledWith({ top: 130, behavior: 'auto' })
    expect(scrollTo).not.toHaveBeenCalled()
    expect(router.state.location.pathname).toBe('/week/2026-11-08')
    expect(swipeLogText()).toMatch(/ type-cancel-keep \{"kind":"quick-add","list":null,"moved":-12\}/)
    expect(swipeLogText()).not.toContain('買い物')
  })

  it('S: ページをいちばん下まで読み進めて、全部見えている入力欄（4行の書きかけ）で払うと、縮んだ分だけブラウザが位置を上へ止め直しても、いちばん下の空きをその分足して元の位置へ戻す（欄も、欄より上の物も下りてこない）', async () => {
    const { history } = await openTop()
    await openList('favorite')
    const area = field('favorite')
    act(() => area.focus())
    fireEvent.change(area, { target: { value: '1行目\n2行目\n3行目\n4行目' } })
    const box = area.closest('.list-input-box')
    const row = screen.getByTestId(listTestIds.row('favorite', 'f1'))
    // いちばん下の空きは今 100px
    const spacer = screen.getByTestId('top-stack-spacer')
    Object.defineProperty(spacer, 'offsetHeight', { configurable: true, value: 100 })
    const grown = () => area.value !== ''
    fakeRects(
      (el) =>
        bars(el) ??
        (el === box
          ? { top: 120, height: grown() ? 112 : 48 }
          : el === area
            ? { top: 124, height: grown() ? 104 : 40 }
            : el === row
              ? { top: grown() ? 240 : 176, height: 44 }
              : null),
    )
    // いちばん下（594px）にいて、欄が 64px 縮むと、ページの高さも 64px 縮み、ブラウザが位置を 530px へ止め直す
    const scrollTo = fakePageScroll(0)
    Object.defineProperty(window, 'scrollY', { configurable: true, get: () => (grown() ? 594 : 530) })
    Object.defineProperty(document.documentElement, 'scrollHeight', {
      configurable: true,
      get: () => (grown() ? 594 : 530) + window.innerHeight,
    })
    disposers.push(() => {
      delete (document.documentElement as { scrollHeight?: number }).scrollHeight
    })
    startLog()
    act(() => history.flick(-1))
    expect(area.value).toBe('')
    await nextFrame()
    expect(spacer.style.height).toBe('164px')
    expect(scrollTo).toHaveBeenCalledTimes(1)
    expect(scrollTo).toHaveBeenCalledWith({ top: 594, behavior: 'auto' })
    expect(swipeLogText()).toMatch(/ type-cancel-keep \{"kind":"list-input","list":"favorite","moved":64,"space":64\}/)
  })

  it('S: Task List の［依頼者］の欄（入力欄の下のチップの行）の上の端だけが 2px 隠れていて、その上の4行の書きかけの入力欄は見える所の上の外にある時に払うと、縮むのは見える所の上の入力欄と箱なので、縮んだ分（114px）を全部送って、見えている下の行を同じ所に残す（依頼者の欄の隠れていた 2px までにしない）', async () => {
    const { history } = await openTop()
    await openList('task')
    const input = field('task')
    act(() => input.focus())
    fireEvent.change(input, { target: { value: '1行目の頼まれ事\n2行目\n3行目\n4行目' } })
    fireEvent.click(screen.getByTestId(listTestIds.taskChip('requester')))
    const requester = screen.getByTestId(taskTestIds.chipRequesterInput) as HTMLInputElement
    expect(document.activeElement).toBe(requester)
    fireEvent.change(requester, { target: { value: '総務' } })
    const box = input.closest('.list-input-box')
    const row = screen.getByTestId(listTestIds.row('task', 't1'))
    const grown = () => input.value !== ''
    // 見える所の上の端は 93px。入力欄（-60〜44px）は上の外、依頼者の欄は 91px から（2px だけ隠れている）。やめると入力欄が 64px、
    // チップの行が 50px 縮み、下の行は 114px 上がる
    fakeRects(
      (el) =>
        bars(el) ??
        (el === box
          ? { top: -60, height: grown() ? 190 : 76 }
          : el === input
            ? { top: -60, height: grown() ? 104 : 40 }
            : el === requester
              ? { top: 91, height: 36 }
              : el === row
                ? { top: grown() ? 150 : 36, height: 44 }
                : null),
    )
    const scrollTo = fakePageScroll(1500)
    startLog()
    act(() => history.flick(-1))
    expect(input.value).toBe('')
    expect(screen.queryByTestId(taskTestIds.chipRequesterInput)).toBeNull()
    await nextFrame()
    expect(scrollTo).toHaveBeenCalledTimes(1)
    expect(scrollTo).toHaveBeenCalledWith({ top: 1386, behavior: 'auto' })
    expect(swipeLogText()).toMatch(/ type-cancel-keep \{"kind":"list-input","list":"task","moved":-114\}/)
    expect(swipeLogText()).not.toContain('総務')
  })

  it('S の週に物が少なく、週の中のスクロールする所が溢れていない（中では送れない）時: すばやく足すの入力欄がページの見える所の上の外にあって払っても、縮むのは高さの決まった週の中だけなので、ページを送らない（週の下のリストを動かさない。週の中も送らない）', async () => {
    const { history } = await openTop('/week/2026-11-08')
    fireEvent.click(screen.getByTestId(testIds.weekAdd('2026-11-08', 'work')))
    const input = screen.getByTestId(testIds.quickAddInput) as HTMLInputElement
    fireEvent.change(input, { target: { value: '買い物' } })
    const quick = input.closest('.cp-quick')
    const week = screen.getByTestId(testIds.view('week'))
    week.style.overflowY = 'auto'
    Object.defineProperty(week, 'scrollHeight', { configurable: true, value: 600 })
    Object.defineProperty(week, 'clientHeight', { configurable: true, value: 600 })
    Object.defineProperty(week, 'scrollTop', { configurable: true, writable: true, value: 0 })
    const weekScroll = vi.fn()
    week.scrollTo = weekScroll as typeof week.scrollTo
    const nextDay = screen.getByTestId(testIds.weekCol('2026-11-09'))
    const open = () => screen.queryByTestId(testIds.quickAddInput) !== null
    // ページは送ってあり、週（60px から高さ 600px）の入力欄（80〜120px）はヘッダーと切り替えの列（93px）の下に 13px 隠れている。
    // 閉じると次の日のかたまりは週の中で 12px 上がるが、週の高さは替わらない
    fakeRects(
      (el) =>
        bars(el) ??
        (el === week
          ? { top: 60, height: 600 }
          : el === quick || el === input
            ? { top: 80, height: 40, left: 0, width: 160 }
            : el === nextDay
              ? { top: open() ? 130 : 118, height: 300 }
              : null),
    )
    const scrollTo = fakePageScroll(206)
    startLog()
    act(() => history.flick(-1))
    expect(screen.queryByTestId(testIds.quickAddInput)).toBeNull()
    await nextFrame()
    expect(scrollTo).not.toHaveBeenCalled()
    expect(weekScroll).not.toHaveBeenCalled()
    expect(swipeLogText()).not.toContain('type-cancel-keep')
  })

  it('M: ページをいちばん下まで読み進めて、全部見えている入力欄（6行の書きかけ）で払い、縮むとページが画面より短くなる時も、いちばん下の空きを画面より短くなった分まで足して元の位置へ戻す（ブラウザに位置を上へ止め直させない）', async () => {
    const { history } = await openTop('/month/2026-11', { width: 'M' })
    // 見出しのボタンで開く（切り替えの列で飛ばないので、いちばん下の空きは 0 のまま）
    act(() => lists().setCollapsed('task', false))
    const input = field('task')
    act(() => input.focus())
    fireEvent.change(input, { target: { value: '1行目\n2行目\n3行目\n4行目\n5行目\n6行目' } })
    const spacer = screen.getByTestId('top-stack-spacer')
    const space = () => Number.parseFloat(spacer.style.height) || 0
    Object.defineProperty(spacer, 'offsetHeight', { configurable: true, get: space })
    const grown = () => input.value !== ''
    // 空きより上の中身は 823px（やめると 108px 縮んで 715px）。画面の高さは 768px なので、やめるとページは画面より短くなる
    const content = () => (grown() ? 823 : 715)
    const pageHeight = () => Math.max(content() + space(), window.innerHeight)
    // ブラウザは、ページの高さに合わせて位置を止め直す（いちばん下の 55px にいた）
    Object.defineProperty(window, 'scrollY', {
      configurable: true,
      get: () => Math.min(55, pageHeight() - window.innerHeight),
    })
    Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, get: pageHeight })
    disposers.push(() => {
      delete (document.documentElement as { scrollHeight?: number }).scrollHeight
    })
    fakeRects(
      (el) =>
        bars(el) ??
        (el === input
          ? { top: 600, height: grown() ? 148 : 40 }
          : el === spacer
            ? { top: content() - window.scrollY, height: space() }
            : null),
    )
    const scrollTo = vi.fn()
    window.scrollTo = scrollTo as typeof window.scrollTo
    expect(window.scrollY).toBe(55)
    startLog()
    act(() => history.flick(-1))
    expect(input.value).toBe('')
    await nextFrame()
    // 足りないのは、縮んだ 108px（今の位置 0px から 55px へ戻し、画面より短い 53px も埋める）
    expect(spacer.style.height).toBe('108px')
    expect(scrollTo).toHaveBeenCalledTimes(1)
    expect(scrollTo).toHaveBeenCalledWith({ top: 55, behavior: 'auto' })
    expect(swipeLogText()).toMatch(/ type-cancel-keep \{"kind":"list-input","list":"task","moved":55,"space":108\}/)
  })
})
