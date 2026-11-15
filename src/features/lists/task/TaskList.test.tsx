// Task List の中身（src/features/lists/task。docs/SPEC.md の 13.・6.3・6.4・12.5・12.8・4.3・7.13・3.9）: 4通りとカレンダー生まれの行、
// 期限切れ・今日（0時で替わる）・済んで 168時間で隠す、入力欄（Enter・Shift+Enter・変換中・チップ・今週金曜・201字）、その場の直し、
// 件名のハイライト（済み・直している間は無い・ラベルの色は出さない）、「…」と日付のメニュー（通りごと・6.4 で断る）、チェック（お知らせ
// 無し・積まない・済みの区切りを目立たせる）、削除（12.8）、［詳しく］は「タスク」の題
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DATE_REFUSED } from '../../../domain/itemInput'
import { DAY, HOUR, T0, mkItem, mkTask } from '../../../domain/testData'
import type { Item } from '../../../domain/types'
import { actions } from '../../../store/actions'
import { getData, useApp } from '../../../store/appStore'
import { useCalendarUi, usePrefs, useToasts } from '../../../store/uiStore'
import { undoScopeActive, useUndo } from '../../../store/undoStore'
import { renderAt, renderView, setupCalendarTests } from '../../../test/renderCalendar'
import type { WidthClass } from '../../../ui/hooks'
import { DATE_PICKER_TEST_ID } from '../../item/fields/MiniMonth'
import { listFlashKey } from '../common/listFlash'
import { draftKey } from '../common/listInputModel'
import { listTestIds } from '../common/testIds'
import { TaskListBody } from './TaskListBody'
import { taskTestIds } from './taskTestIds'

setupCalendarTests()
afterEach(() => {
  vi.restoreAllMocks()
})

const byId = (id: string) => screen.getByTestId(id)
const items = (...list: Item[]) => Object.fromEntries(list.map((it) => [it.id, it]))
const stored = (id: string) => getData().items[id]
const toasts = () => useToasts.getState().toasts.map((t) => t.message)

/**
 * ゴミ箱へ移す・戻すの代わり（この保存先は何も書かないので、表示のデータだけを動かす。src/features/item/DetailSheet.test.tsx と同じ）
 */
function fakeTrash() {
  const kept = new Map<string, Item>()
  const trash = vi.spyOn(actions, 'trashItem').mockImplementation(async (id) => {
    act(() =>
      useApp.setState((st) => {
        const { [id]: gone, ...rest } = st.data.items
        kept.set(`entry-${id}`, gone)
        return {
          data: {
            ...st.data,
            items: rest,
            trashEntries: { ...st.data.trashEntries, [`entry-${id}`]: { id: `entry-${id}` } as never },
          },
        }
      }),
    )
    return `entry-${id}`
  })
  const restore = vi.spyOn(actions, 'restoreTrashEntry').mockImplementation(async (entry) => {
    const it = kept.get(entry)
    act(() =>
      useApp.setState((st) => ({
        data: { ...st.data, items: it ? { ...st.data.items, [it.id]: it } : st.data.items, trashEntries: {} },
      })),
    )
    return { restored: 1 } as never
  })
  return { trash, restore }
}

/** 作り物の Task List（今日は 2026-11-10（火）） */
const FIXTURE = [
  mkTask({ id: 'none', title: '資料を印刷する', createdAt: T0 - 3 * HOUR }),
  mkTask({ id: 'due', title: '見積もりの返事', due: '2026-11-11', requester: '営業部', createdAt: T0 - 2 * HOUR }),
  mkTask({ id: 'span', title: '会議室の予約を見直す', start: '2026-11-10', due: '2026-11-13', requester: '総務' }),
  mkTask({ id: 'start', title: '図書館の本を返す', kind: 'private', start: '2026-11-12', createdAt: T0 - HOUR }),
  mkTask({ id: 'late', title: '請求書の確認', due: '2026-11-09' }),
  mkTask({ id: 'today', title: 'トナーを頼む', due: '2026-11-10' }),
  mkItem({
    id: 'cal',
    title: '歯医者',
    kind: 'private',
    start: '2026-11-12',
    listed: true,
    startTime: '10:00',
    endTime: '11:00',
  }),
]

async function open(list: Item[] = FIXTURE, opts: { width?: WidthClass; now?: number } = {}) {
  const width = opts.width ?? 'L'
  const r = await renderView(TaskListBody, { width }, { data: { items: items(...list) }, width, now: opts.now })
  return { ...r, user: userEvent.setup() }
}

/** まだの行の id（上から） */
const openOrder = () =>
  Array.from(document.querySelectorAll<HTMLElement>('.list-row'))
    .filter((el) => el.dataset.done !== 'true')
    .map((el) => el.dataset.testid?.replace('list-task-row-', ''))

describe('行（13.3・6.3）', () => {
  it('L: 4通りとカレンダー生まれの日付の列（1日・複数日・④の「〜」・①の「—」）。年は列に出さず読み上げに入れる（S3-TASK-076・077）', async () => {
    await open()
    const date = (id: string) => byId(listTestIds.taskDate(id))
    expect(date('due').textContent).toBe('11/11')
    expect(date('span').textContent).toBe('11/10〜11/13')
    expect(date('span').querySelector('.task-date-sub')?.textContent).toBe('11/10〜')
    expect(date('start').textContent).toBe('11/12〜')
    expect(date('start').dataset.case).toBe('start')
    expect(date('none').textContent).toBe('—')
    expect(date('none').dataset.faint).toBe('true')
    expect(date('cal').textContent).toBe('11/12')
    expect(date('due').getAttribute('aria-label')).toBe('日付（2026年11月11日（水））')
    // 依頼者の欄は名前がある行だけ
    expect(byId(listTestIds.taskRequester('due')).textContent).toBe('営業部')
    expect(screen.queryByTestId(listTestIds.taskRequester('none'))).toBeNull()
    expect(byId(listTestIds.row('task', 'due')).className).toContain('has-requester')
    expect(byId(listTestIds.row('task', 'none')).className).not.toContain('has-requester')
  })

  it('M・S: 2行の行の上の行（〆は Task List 生まれの1日だけ・依頼者は「・」でつなぐ・①で依頼者も無ければ出さない。S3-TASK-090・092）', async () => {
    await open(FIXTURE, { width: 'S' })
    const line = (id: string) => screen.queryByTestId(listTestIds.taskLine(id))?.textContent ?? null
    expect(line('due')).toBe('〆11/11・営業部')
    expect(line('span')).toBe('11/10〜11/13・総務')
    expect(line('start')).toBe('11/12〜')
    expect(line('cal')).toBe('11/12')
    expect(line('none')).toBeNull()
    expect(screen.queryByTestId(listTestIds.taskDate('due'))).toBeNull()
    expect(byId(listTestIds.row('task', 'due')).className).toContain('is-stacked')
  })

  it('並び: カレンダーに出ている物を to の近い順、その下に①④を新しい順（13.4。S3-TASK-110）', async () => {
    await open()
    expect(openOrder()).toEqual(['late', 'today', 'due', 'cal', 'span', 'start', 'none'])
  })

  it('期限切れは日付を --overdue（data-overdue）、今日は太字（data-today）。M・S は上の行の日付の所だけ（S3-TASK-078）', async () => {
    await open()
    expect(byId(listTestIds.taskDate('late')).dataset.overdue).toBe('true')
    expect(byId(listTestIds.taskDate('today')).dataset.today).toBe('true')
    expect(byId(listTestIds.taskDate('due')).dataset.overdue).toBeUndefined()
    cleanup()
    await open(FIXTURE, { width: 'S' })
    const lateLine = byId(listTestIds.taskLine('late'))
    expect(lateLine.querySelector<HTMLElement>('.task-line-date')?.dataset.overdue).toBe('true')
  })

  it('0時を過ぎると（タイマー）、今日の物が期限切れになり、明日の物が今日になる（6.4・S3-FRAME-141・S3-TASK-079）', async () => {
    function Host({ show }: { show: boolean }) {
      return show ? <TaskListBody width="L" /> : null
    }
    const r = await renderView(Host, { show: false }, { data: { items: items(...FIXTURE) } })
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(new Date(2026, 10, 10, 23, 59, 30))
    r.setProps({ show: true })
    expect(byId(listTestIds.taskDate('today')).dataset.today).toBe('true')
    expect(byId(listTestIds.taskDate('today')).dataset.overdue).toBeUndefined()
    act(() => {
      vi.advanceTimersByTime(2 * 60_000)
    })
    expect(byId(listTestIds.taskDate('today')).dataset.overdue).toBe('true')
    expect(byId(listTestIds.taskDate('today')).dataset.today).toBeUndefined()
    expect(byId(listTestIds.taskDate('due')).dataset.today).toBe('true')
  })

  it('済んで 168時間を過ぎた物は、1分の内に済みの区切りから消える（ちょうど 168時間はまだ出す。S3-TASK-015）', async () => {
    const doneAt = T0 - 7 * DAY + 30_000
    const list = [mkTask({ id: 'old', title: '古い用事', done: true, doneAt, doneOn: '2026-11-03' }), FIXTURE[0]]
    function Host({ show }: { show: boolean }) {
      return show ? <TaskListBody width="L" /> : null
    }
    usePrefs.getState().setCollapsed({ taskDone: false })
    const r = await renderView(Host, { show: false }, { data: { items: items(...list) } })
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(T0)
    r.setProps({ show: true })
    expect(byId(listTestIds.done('task')).textContent).toContain('済み 1件')
    expect(screen.getByTestId(listTestIds.row('task', 'old'))).toBeTruthy()
    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    expect(screen.queryByTestId(listTestIds.row('task', 'old'))).toBeNull()
    expect(screen.queryByTestId(listTestIds.done('task'))).toBeNull()
  })

  it('件名のハイライト: 件名の字だけを .kind-marker で包み、区分は件名の data-kind。日付・依頼者・区分の印には付けない（4.3・S3-TASK-100・102）', async () => {
    await open()
    const title = byId(listTestIds.rowTitle('task', 'start'))
    expect(title.dataset.kind).toBe('private')
    expect(title.querySelector('.kind-marker')?.textContent).toBe('図書館の本を返す')
    expect(byId(listTestIds.rowTitle('task', 'due')).dataset.kind).toBe('work')
    expect(byId(listTestIds.taskDate('due')).querySelector('.kind-marker')).toBeNull()
    expect(byId(listTestIds.taskRequester('due')).closest('.kind-marker')).toBeNull()
    expect(byId(listTestIds.row('task', 'due')).querySelectorAll('.kind-marker')).toHaveLength(1)
  })

  it('済んだ行と、その場で直している間はハイライトを付けない（S3-TASK-104・106）', async () => {
    usePrefs.getState().setCollapsed({ taskDone: false })
    const { user } = await open([...FIXTURE, mkTask({ id: 'fin', title: '片付けた', done: true, doneAt: T0 - HOUR })])
    const fin = byId(listTestIds.rowTitle('task', 'fin'))
    expect(fin.className).toContain('is-done')
    expect(fin.querySelector('.kind-marker')).toBeNull()
    await user.click(byId(listTestIds.rowTitle('task', 'due')))
    expect(byId(listTestIds.row('task', 'due')).querySelector('.kind-marker')).toBeNull()
  })

  it('ラベルを付けたタスクでも、行にラベルの色（data-label）を出さない（4.3。区分の色の帯だけ）', async () => {
    await open([mkTask({ id: 'lab', title: 'ラベル付き', due: '2026-11-12', label: 'rose-l' })])
    const row = byId(listTestIds.row('task', 'lab'))
    expect(row.querySelector('[data-label]')).toBeNull()
    expect(row.hasAttribute('data-label')).toBe(false)
  })

  it('区分の印を押すと仕事とプライベートを入れ替えてすぐ保存し、帯の色（data-kind）も替わる（S3-TASK-072・107）', async () => {
    const { user } = await open()
    const kind = byId(listTestIds.taskKind('due'))
    expect(kind.getAttribute('aria-label')).toBe('区分: 仕事（押すとプライベートにする）')
    await user.click(kind)
    expect(stored('due').kind).toBe('private')
    expect(byId(listTestIds.rowTitle('task', 'due')).dataset.kind).toBe('private')
    await user.click(byId(listTestIds.taskKind('due')))
    expect(stored('due').kind).toBe('work')
  })
})

describe('入力欄（13.2）', () => {
  it('Enter で足す: Task List 生まれ・仕事・Task List に出す・ラベルなし。2行目からはメモ。欄は空に戻りフォーカスは残る。お知らせは出さない（S3-TASK-001・036・040・050）', async () => {
    const { user } = await open([])
    const input = byId(listTestIds.input('task')) as HTMLTextAreaElement
    await user.click(input)
    await user.type(input, '資料を送る{Shift>}{Enter}{/Shift}先方の分も')
    expect(input.value).toBe('資料を送る\n先方の分も')
    await user.keyboard('{Enter}')
    const added = Object.values(getData().items)
    expect(added).toHaveLength(1)
    expect(added[0]).toMatchObject({
      title: '資料を送る',
      memo: '先方の分も',
      origin: 'list',
      kind: 'work',
      listed: true,
      label: null,
      start: null,
      due: null,
      requester: '',
      done: false,
    })
    expect(input.value).toBe('')
    expect(document.activeElement).toBe(input)
    expect(toasts()).toEqual([])
    // 足した行を目立たせる
    expect(useCalendarUi.getState().flash?.keys).toEqual([listFlashKey.row('task', added[0].id)])
    // 元に戻すの並びには積まない
    expect(useUndo.getState().stack.past).toHaveLength(0)
  })

  it('変換中の Enter（keyCode 229）では足さない（S3-TASK-034）', async () => {
    const { user } = await open([])
    const input = byId(listTestIds.input('task')) as HTMLTextAreaElement
    await user.click(input)
    fireEvent.change(input, { target: { value: 'みつもり' } })
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 })
    expect(Object.keys(getData().items)).toHaveLength(0)
    expect(input.value).toBe('みつもり')
  })

  it('件名が 200字を超える時は足さず、理由を知らせて字を残す（S3-TASK-044）', async () => {
    const { user } = await open([])
    const input = byId(listTestIds.input('task')) as HTMLTextAreaElement
    const long = 'あ'.repeat(201)
    fireEvent.change(input, { target: { value: long } })
    await user.click(byId(listTestIds.add('task')))
    expect(Object.keys(getData().items)).toHaveLength(0)
    expect(input.value).toBe(long)
    expect(toasts()).toEqual(['件名は1〜200字で入れてください'])
  })

  it('チップ: ［開始日］今日・［締め切り日］今週金曜・［依頼者］候補から選ぶと「開始 11/10」「〆 11/13」「営業部」になり、足すとその値で足して空に戻る（S3-TASK-055〜061）', async () => {
    const { user } = await open([mkTask({ id: 'old', title: '前の物', requester: '営業部', createdAt: T0 - DAY })])
    await user.click(byId(listTestIds.taskChip('start')))
    expect(
      within(byId('task-chip-start-menu'))
        .getAllByRole('menuitem')
        .map((b) => b.textContent),
    ).toEqual(['今日', '明日', '日付を選ぶ'])
    await user.click(screen.getByRole('menuitem', { name: '今日' }))
    expect(byId(listTestIds.taskChip('start')).textContent).toBe('開始 11/10')
    await user.click(byId(listTestIds.taskChip('due')))
    expect(
      within(byId('task-chip-due-menu'))
        .getAllByRole('menuitem')
        .map((b) => b.textContent),
    ).toEqual(['今日', '明日', '今週金曜', '日付を選ぶ'])
    await user.click(screen.getByRole('menuitem', { name: '今週金曜' }))
    expect(byId(listTestIds.taskChip('due')).textContent).toBe('〆 11/13')
    await user.click(byId(listTestIds.taskChip('requester')))
    const req = byId(taskTestIds.chipRequesterInput) as HTMLInputElement
    expect(document.activeElement).toBe(req)
    await user.type(req, '営')
    await user.click(screen.getByRole('option', { name: '営業部' }))
    expect(byId(listTestIds.taskChip('requester')).textContent).toBe('営業部')
    // 書きかけにチップも入る
    await vi.waitFor(() =>
      expect(JSON.parse(localStorage.getItem(draftKey('task')) ?? '{}')).toMatchObject({
        start: '2026-11-10',
        due: '2026-11-13',
        requester: '営業部',
      }),
    )
    const input = byId(listTestIds.input('task')) as HTMLTextAreaElement
    await user.click(input)
    await user.type(input, '日程を決める{Enter}')
    const added = Object.values(getData().items).find((it) => it.title === '日程を決める')
    expect(added).toMatchObject({ start: '2026-11-10', due: '2026-11-13', requester: '営業部' })
    expect(byId(listTestIds.taskChip('start')).textContent).toBe('開始日')
    expect(byId(listTestIds.taskChip('due')).textContent).toBe('締め切り日')
    expect(byId(listTestIds.taskChip('requester')).textContent).toBe('依頼者')
  })

  it('土曜は［締め切り日］の「来週金曜」で次の金曜。締め切り日より後の開始日を選ぶと締め切り日もそろう（6.3・S3-TASK-058・063）', async () => {
    const { user } = await open([], { now: new Date(2026, 10, 14, 9, 0).getTime() })
    await user.click(byId(listTestIds.taskChip('due')))
    await user.click(screen.getByRole('menuitem', { name: '来週金曜' }))
    expect(byId(listTestIds.taskChip('due')).textContent).toBe('〆 11/20')
    // 開始日を 11/20 より後（日付を選ぶ → 11/25）にすると、締め切り日も 11/25
    await user.click(byId(listTestIds.taskChip('start')))
    await user.click(screen.getByRole('menuitem', { name: '開始日を選ぶ' }))
    await user.click(within(byId(DATE_PICKER_TEST_ID)).getByRole('button', { name: /11月25日/ }))
    expect(byId(listTestIds.taskChip('start')).textContent).toBe('開始 11/25')
    expect(byId(listTestIds.taskChip('due')).textContent).toBe('〆 11/25')
    // ［×］で外す
    await user.click(byId(taskTestIds.chipClear('start')))
    expect(byId(listTestIds.taskChip('start')).textContent).toBe('開始日')
    expect(byId(listTestIds.taskChip('due')).textContent).toBe('〆 11/25')
  })
})

describe('その場で直す（13.3）', () => {
  it('件名を押すとその場の1行の欄（フォーカスは欄）。Enter で保存、空にして離れると元に戻す（S3-TASK-005・132）', async () => {
    const { user } = await open()
    await user.click(byId(listTestIds.rowTitle('task', 'due')))
    const edit = byId(listTestIds.rowEdit('task', 'due')) as HTMLInputElement
    expect(document.activeElement).toBe(edit)
    await user.clear(edit)
    await user.type(edit, '見積もりの返事を出す{Enter}')
    expect(stored('due').title).toBe('見積もりの返事を出す')
    await user.click(byId(listTestIds.rowTitle('task', 'due')))
    await user.clear(byId(listTestIds.rowEdit('task', 'due')))
    act(() => (byId(listTestIds.rowEdit('task', 'due')) as HTMLInputElement).blur())
    expect(stored('due').title).toBe('見積もりの返事を出す')
    expect(byId(listTestIds.rowTitle('task', 'due')).textContent).toBe('見積もりの返事を出す')
  })

  it('L の依頼者を押すと候補付きの欄。空にして決めると依頼者を消し、列を詰める（S3-TASK-081・133）', async () => {
    const { user } = await open()
    await user.click(byId(listTestIds.taskRequester('due')))
    const edit = byId(taskTestIds.requesterEdit('due')) as HTMLInputElement
    expect(document.activeElement).toBe(edit)
    expect(edit.value).toBe('営業部')
    await user.clear(edit)
    await user.type(edit, '経理{Enter}')
    expect(stored('due').requester).toBe('経理')
    await user.click(byId(listTestIds.taskRequester('due')))
    await user.clear(byId(taskTestIds.requesterEdit('due')))
    await user.keyboard('{Enter}')
    expect(stored('due').requester).toBe('')
    expect(screen.queryByTestId(listTestIds.taskRequester('due'))).toBeNull()
    expect(byId(listTestIds.row('task', 'due')).className).not.toContain('has-requester')
  })

  it('依頼者の欄の Esc は保存せずにやめる', async () => {
    const { user } = await open()
    await user.click(byId(listTestIds.taskRequester('span')))
    await user.clear(byId(taskTestIds.requesterEdit('span')))
    await user.type(byId(taskTestIds.requesterEdit('span')), '人事')
    await user.keyboard('{Escape}')
    expect(stored('span').requester).toBe('総務')
    expect(byId(listTestIds.taskRequester('span')).textContent).toBe('総務')
  })
})

describe('チェック（13.4・12.5・3.9）', () => {
  it('済みにすると完了（doneAt・doneOn）になり「済み n件」へ沈む。お知らせは出さず、積まない。畳んでいれば区切りを目立たせる（S3-TASK-112〜116・FRAME-199）', async () => {
    const { user } = await open()
    await user.click(byId(listTestIds.rowCheck('task', 'due')))
    expect(stored('due')).toMatchObject({ done: true, doneOn: '2026-11-10' })
    expect(typeof stored('due').doneAt).toBe('number')
    expect(toasts()).toEqual([])
    expect(useUndo.getState().stack.past).toHaveLength(0)
    expect(screen.queryByTestId(listTestIds.row('task', 'due'))).toBeNull()
    expect(byId(listTestIds.done('task')).textContent).toContain('済み 1件')
    expect(useCalendarUi.getState().flash?.keys).toEqual([listFlashKey.done('task')])
    // 開くと、済んだ行（斜線）。外すと元の位置へ戻り、その行を目立たせる
    await user.click(within(byId(listTestIds.done('task'))).getByRole('button', { name: /済み 1件/ }))
    expect(usePrefs.getState().collapsed.taskDone).toBe(false)
    const check = byId(listTestIds.rowCheck('task', 'due'))
    expect(check.getAttribute('aria-label')).toBe('『見積もりの返事』の済みを外す')
    await user.click(check)
    expect(stored('due')).toMatchObject({ done: false, doneAt: null, doneOn: null })
    expect(openOrder()).toEqual(['late', 'today', 'due', 'cal', 'span', 'start', 'none'])
    expect(useCalendarUi.getState().flash?.keys).toEqual([listFlashKey.row('task', 'due')])
  })

  it('ウィークリー・デイリーを出している（元に戻すの並びがある）時も、チェックは並びに積まない（7.13・S3-TASK-210）', async () => {
    const r = await renderAt('/week/2026-11-08', { data: { items: items(...FIXTURE) } })
    expect(undoScopeActive()).toBe(true)
    await userEvent.setup().click(within(r.container).getByTestId(listTestIds.rowCheck('task', 'due')))
    expect(stored('due').done).toBe(true)
    expect(useUndo.getState().stack.past).toHaveLength(0)
  })
})

describe('「…」のメニュー（13.5）', () => {
  const menuLabels = () =>
    within(byId(listTestIds.rowMenu('task')))
      .getAllByRole('menuitem')
      .map((b) => b.textContent)

  it('通りごと: ①④は［日付を決める］、カレンダーに出ている物は［Task List から外す］。M・S は［日付…］も（S3-TASK-120）', async () => {
    const { user } = await open()
    await user.click(byId(listTestIds.rowMore('task', 'none')))
    expect(menuLabels()).toEqual(['詳しく', '日付を決める', '削除'])
    await user.keyboard('{Escape}')
    await user.click(byId(listTestIds.rowMore('task', 'due')))
    expect(menuLabels()).toEqual(['詳しく', 'Task List から外す', '削除'])
    await user.keyboard('{Escape}')
    cleanup()
    const s = await open(FIXTURE, { width: 'S' })
    await s.user.click(byId(listTestIds.rowMore('task', 'start')))
    expect(menuLabels()).toEqual(['詳しく', '日付…', '日付を決める', '削除'])
  })

  it('［日付を決める］: 小さな月のカレンダーで選んだ日が締め切り日になり、カレンダーに出る（④は開始日以後で期間。S3-TASK-121）', async () => {
    const { user } = await open()
    await user.click(byId(listTestIds.rowMore('task', 'start')))
    await user.click(screen.getByRole('menuitem', { name: '日付を決める' }))
    await user.click(within(byId(DATE_PICKER_TEST_ID)).getByRole('button', { name: /11月20日/ }))
    expect(stored('start')).toMatchObject({ start: '2026-11-12', due: '2026-11-20', listed: true })
    expect(byId(listTestIds.taskDate('start')).textContent).toBe('11/12〜11/20')
  })

  it('［Task List から外す］で行が消え、カレンダーにだけ残る（listed false。お知らせ無し。S3-TASK-122）', async () => {
    const { user } = await open()
    await user.click(byId(listTestIds.rowMore('task', 'span')))
    await user.click(screen.getByRole('menuitem', { name: 'Task List から外す' }))
    expect(stored('span')).toMatchObject({ listed: false, start: '2026-11-10', due: '2026-11-13' })
    expect(screen.queryByTestId(listTestIds.row('task', 'span'))).toBeNull()
    expect(toasts()).toEqual([])
  })

  it('［削除］: カレンダーに出ていない物は確かめずに消して［元に戻す］付きのお知らせ。積まない（12.8・S3-TASK-125・126）', async () => {
    const { trash, restore } = fakeTrash()
    const { user } = await open()
    await user.click(byId(listTestIds.rowMore('task', 'none')))
    await user.click(screen.getByRole('menuitem', { name: '削除' }))
    await vi.waitFor(() => expect(stored('none')).toBeUndefined())
    expect(trash).toHaveBeenCalledWith('none')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(toasts()).toEqual(['『資料を印刷する』を削除しました'])
    expect(useUndo.getState().stack.past).toHaveLength(0)
    const toast = useToasts.getState().toasts[0]
    expect(toast.action?.label).toBe('元に戻す')
    act(() => toast.action?.run())
    await vi.waitFor(() => expect(restore).toHaveBeenCalledWith('entry-none'))
    await vi.waitFor(() => expect(stored('none')?.title).toBe('資料を印刷する'))
  })

  it('［削除］: カレンダーに出ている物は「『件名』を削除しますか？」と確かめ、［やめる］なら消さない（12.8・S3-TASK-123）', async () => {
    fakeTrash()
    const { user } = await open()
    await user.click(byId(listTestIds.rowMore('task', 'due')))
    await user.click(screen.getByRole('menuitem', { name: '削除' }))
    const dialog = await screen.findByRole('dialog', { name: '『見積もりの返事』を削除しますか？' })
    expect(dialog.textContent).toContain('Task List からも消えます。')
    await user.click(within(dialog).getByRole('button', { name: 'やめる' }))
    expect(stored('due')).toBeTruthy()
    await user.click(byId(listTestIds.rowMore('task', 'due')))
    await user.click(screen.getByRole('menuitem', { name: '削除' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '削除' }))
    await vi.waitFor(() => expect(stored('due')).toBeUndefined())
    expect(toasts()).toEqual([])
  })

  it('［詳しく］は「タスク」の題の詳細を開く（12.3。カレンダー生まれでも）', async () => {
    const r = await renderAt('/month/2026-11', { data: { items: items(...FIXTURE) } })
    const user = userEvent.setup()
    await user.click(within(r.container).getByTestId(listTestIds.rowMore('task', 'cal')))
    await user.click(screen.getByRole('menuitem', { name: '詳しく' }))
    expect(r.router.state.location.state).toMatchObject({ sheet: { kind: 'detail', id: 'cal', from: 'task' } })
    expect(await screen.findByRole('dialog', { name: 'タスク' })).toBeTruthy()
  })
})

describe('日付のメニュー（13.5・6.3・6.4）', () => {
  const dateMenuLabels = () =>
    within(byId(listTestIds.taskDateMenu))
      .getAllByRole('menuitem')
      .map((b) => b.textContent)

  it('L は日付の列から開く: 締め切り日 今日・明日・今週金曜・日付を選ぶ・なし、開始日 日付を選ぶ（・なし）、［カレンダーで見る］（S3-TASK-128）', async () => {
    const { user } = await open()
    await user.click(byId(listTestIds.taskDate('span')))
    expect(dateMenuLabels()).toEqual([
      '締め切り日 今日',
      '締め切り日 明日',
      '締め切り日 今週金曜',
      '締め切り日 日付を選ぶ',
      '締め切り日 なし',
      '開始日 日付を選ぶ',
      '開始日 なし',
      'カレンダーで見る',
    ])
    await user.keyboard('{Escape}')
    // ①: カレンダーに出ていないので［カレンダーで見る］は無く、なしも無い
    await user.click(byId(listTestIds.taskDate('none')))
    expect(dateMenuLabels()).toEqual([
      '締め切り日 今日',
      '締め切り日 明日',
      '締め切り日 今週金曜',
      '締め切り日 日付を選ぶ',
      '開始日 日付を選ぶ',
    ])
  })

  it('calendar 生まれ: 開始日の「なし」は出さず、複数日の締め切り日の「なし」は「1日の予定にする（締め切り日を消す）」（S3-TASK-130）', async () => {
    const { user } = await open([mkItem({ id: 'c2', title: '研修', start: '2026-11-10', due: '2026-11-12', listed: true })])
    await user.click(byId(listTestIds.taskDate('c2')))
    expect(dateMenuLabels()).toContain('1日の予定にする（締め切り日を消す）')
    expect(dateMenuLabels()).not.toContain('開始日 なし')
    await user.click(screen.getByRole('menuitem', { name: '1日の予定にする（締め切り日を消す）' }))
    expect(stored('c2')).toMatchObject({ start: '2026-11-10', due: null })
  })

  it('締め切り日「なし」: Task List 生まれはカレンダーから外れて Task List に残る（S3-TASK-129）。明日にすると締め切り日が替わる', async () => {
    const { user } = await open()
    await user.click(byId(listTestIds.taskDate('due')))
    await user.click(screen.getByRole('menuitem', { name: '締め切り日を消す' }))
    expect(stored('due')).toMatchObject({ due: null, listed: true })
    expect(byId(listTestIds.taskDate('due')).textContent).toBe('—')
    await user.click(byId(listTestIds.taskDate('due')))
    await user.click(screen.getByRole('menuitem', { name: '締め切り日を明日にする' }))
    expect(stored('due').due).toBe('2026-11-11')
  })

  it('6.4 で断られる選び（1日の予定で終了 < 開始）は、理由を 4秒知らせて値はそのまま（S3-TASK-025）', async () => {
    const night = mkTask({
      id: 'night',
      title: '夜の作業',
      start: '2026-11-09',
      due: '2026-11-10',
      startTime: '23:00',
      endTime: '01:00',
    })
    const { user } = await open([night])
    await user.click(byId(listTestIds.taskDate('night')))
    await user.click(screen.getByRole('menuitem', { name: '開始日を消す' }))
    expect(stored('night')).toMatchObject({ start: '2026-11-09', due: '2026-11-10' })
    expect(toasts()).toEqual([DATE_REFUSED])
  })

  it('［カレンダーで見る］は to の日のデイリーへ、履歴を置き換えて移る（3.1・S3-FRAME-029・S3-TASK-131）', async () => {
    const r = await open()
    await r.user.click(byId(listTestIds.taskDate('span')))
    await r.user.click(screen.getByRole('menuitem', { name: 'カレンダーで見る' }))
    expect(r.router.state.location.pathname).toBe('/day/2026-11-13')
    expect(r.router.state.historyAction).toBe('REPLACE')
  })

  it('M・S は「…」の［日付…］から同じメニューを開く（開発）', async () => {
    const { user } = await open(FIXTURE, { width: 'S' })
    await user.click(byId(listTestIds.rowMore('task', 'due')))
    await user.click(screen.getByRole('menuitem', { name: '日付を直す' }))
    expect(dateMenuLabels()[0]).toBe('締め切り日 今日')
    await user.click(screen.getByRole('menuitem', { name: '締め切り日を今日にする' }))
    expect(stored('due').due).toBe('2026-11-10')
  })
})

describe('■34 で打ちかけを捨てる', () => {
  it('依頼者の小さな欄を開いて打っている間に捨てると、欄を閉じ、打った字を書きかけに戻さない', async () => {
    const { discardListDraft } = await import('../common/listDraft')
    const { user } = await open([])
    await user.click(byId(listTestIds.taskChip('requester')))
    await user.type(byId(taskTestIds.chipRequesterInput), '人事')
    act(() => {
      discardListDraft('task')
      ;(document.activeElement as HTMLElement | null)?.blur()
    })
    expect(screen.queryByTestId(taskTestIds.chipRequesterInput)).toBeNull()
    expect(byId(listTestIds.taskChip('requester')).textContent).toBe('依頼者')
    expect(localStorage.getItem(draftKey('task'))).toBeNull()
  })
})
