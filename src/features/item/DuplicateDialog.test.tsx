// 複製する日を選ぶ小さな画面（docs/SPEC.md の 12.7・3.9。D45・AMB-ITEMS-22）: 初めは空、calendar 生まれは開始日が必須、複数日の予定は
// 開始日を選ぶと元と同じ日数の締め切り日を入れる、締め切り日を開始日より前にすると開始日もそろえる、写す時刻で 1日の予定の
// 終了 < 開始になる日付は押せない（6.4 の理由）、list 生まれは開始日・締め切り日とも任意、複製の後のお知らせと［開く］
import { act, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { DATE_REFUSED } from '../../domain/itemInput'
import { mkItem, mkTask } from '../../domain/testData'
import type { Item } from '../../domain/types'
import { useApp } from '../../store/appStore'
import { useToasts } from '../../store/uiStore'
import { renderView, setupCalendarTests } from '../../test/renderCalendar'
import { sheetOf } from '../calendar/common/sheets'
import { testIds } from '../calendar/common/testIds'
import { DUP_NEED_START, DUP_TEST_IDS, DuplicateDialog } from './DuplicateDialog'
import { DATE_PICKER_TEST_ID } from './fields/MiniMonth'

setupCalendarTests()

const byId = (id: string) => screen.getByTestId(id)
const submit = () => byId(testIds.dupSubmit) as HTMLButtonElement

async function open(item: Item, others: Item[] = []) {
  const onClose = vi.fn()
  const data = { items: Object.fromEntries([item, ...others].map((i) => [i.id, i])) }
  const r = await renderView(DuplicateDialog, { item, onClose }, { data })
  return { ...r, onClose, user: userEvent.setup() }
}

async function pick(user: ReturnType<typeof userEvent.setup>, field: string, date: string) {
  await user.click(byId(field))
  await user.click(byId(DATE_PICKER_TEST_ID).querySelector(`[data-date="${date}"]`) as HTMLElement)
}

/** 足された予定（元と違う id の物） */
const added = (srcId: string) => Object.values(useApp.getState().data.items).filter((i) => i.id !== srcId)

const multi = mkItem({
  id: 'm',
  title: '研修',
  kind: 'work',
  label: 'sky-l',
  start: '2026-11-10',
  due: '2026-11-12',
  startTime: '09:30',
  endTime: '17:00',
  requester: '総務',
  locked: true,
  memo: '会場は2階',
  done: true,
  doneAt: 1,
  doneOn: '2026-11-12',
  by: 'connector',
  ai: 'claude',
  via: 'メール: 研修のご案内',
})

describe('複製する日を選ぶ（12.7）', () => {
  it('題は「複製する日を選ぶ」。日付の欄は初めは空で、calendar 生まれは開始日を選ぶまで［複製する］を押せない（ITEMS-253・254）', async () => {
    const { user } = await open(multi)
    const dialog = byId(DUP_TEST_IDS.dialog)
    expect(within(dialog).getByRole('heading').textContent).toBe('複製する日を選ぶ')
    expect(byId(testIds.dupStart).textContent).toBe('なし')
    expect(byId(testIds.dupDue).textContent).toBe('なし')
    expect(submit().disabled).toBe(true)
    expect(screen.getByText(DUP_NEED_START)).toBeTruthy()
    await pick(user, testIds.dupStart, '2026-11-17')
    expect(submit().disabled).toBe(false)
  })

  it('元が複数日の予定なら、開始日を選ぶと締め切り日を元と同じ日数で入れる（直せる。ITEMS-255）', async () => {
    const { user } = await open(multi)
    await pick(user, testIds.dupStart, '2026-11-17')
    expect(byId(testIds.dupDue).textContent).toBe('11月19日（木）')
    await pick(user, testIds.dupDue, '2026-11-20')
    expect(byId(testIds.dupDue).textContent).toBe('11月20日（金）')
  })

  it('締め切り日を開始日より前にすると開始日もそろえる（6.3）', async () => {
    const { user } = await open(mkItem({ id: 'o', start: '2026-11-10' }))
    await pick(user, testIds.dupStart, '2026-11-17')
    await pick(user, testIds.dupDue, '2026-11-15')
    expect(byId(testIds.dupStart).textContent).toBe('11月15日（日）')
    expect(byId(testIds.dupDue).textContent).toBe('11月15日（日）')
  })

  it('写す時刻で 1日の予定の終了 < 開始になる日付は［複製する］を押せず、6.4 の理由を出す（ITEMS-259・D45）', async () => {
    const night = mkItem({ id: 'n', start: '2026-11-10', due: '2026-11-11', startTime: '23:00', endTime: '01:00' })
    const { user } = await open(night)
    await pick(user, testIds.dupStart, '2026-11-17')
    expect(byId(testIds.dupDue).textContent).toBe('11月18日（水）')
    expect(submit().disabled).toBe(false)
    await pick(user, testIds.dupDue, '2026-11-17')
    expect(byId(DUP_TEST_IDS.error).textContent).toBe(DATE_REFUSED)
    expect(submit().disabled).toBe(true)
  })

  it('［複製する］で新しい予定を作り（完了・出どころは写さない）、閉じて「11/17（火）に複製しました［開く］」（6秒）。［開く］で新しい予定の詳細へ（ITEMS-257・258・260）', async () => {
    const { user, onClose, router } = await open(multi)
    await pick(user, testIds.dupStart, '2026-11-17')
    await user.click(submit())
    expect(onClose).toHaveBeenCalledTimes(1)
    const [copy] = added('m')
    expect(copy).toMatchObject({
      title: '研修',
      kind: 'work',
      label: 'sky-l',
      origin: 'calendar',
      start: '2026-11-17',
      due: '2026-11-19',
      startTime: '09:30',
      endTime: '17:00',
      requester: '総務',
      locked: true,
      memo: '会場は2階',
      done: false,
      doneAt: null,
      by: 'user',
      ai: null,
      via: null,
    })
    const [toast] = useToasts.getState().toasts
    expect(toast.message).toBe('11/17（火）に複製しました')
    expect(toast.action?.label).toBe('開く')
    act(() => toast.action?.run())
    expect(sheetOf(router.state.location.state)).toEqual({ kind: 'detail', id: copy.id })
  })

  it('list 生まれは開始日・締め切り日とも任意で、今どう出るかの1行を出す。日付の無い複製は「Task List に複製しました［開く］」（ITEMS-256・D45）', async () => {
    const task = mkTask({ id: 't', title: '見積書を出す', due: '2026-11-20', listed: false })
    const { user } = await open(task)
    expect(byId(DUP_TEST_IDS.status).textContent).toBe('カレンダーには出ません（Task List だけ）')
    expect(submit().disabled).toBe(false)
    await user.click(submit())
    const [copy] = added('t')
    // 締め切り日の無い list 生まれは Task List に出す（どこにも出ない項目を作らない）
    expect(copy).toMatchObject({ origin: 'list', start: null, due: null, listed: true })
    expect(useToasts.getState().toasts[0].message).toBe('Task List に複製しました')
  })

  it('list 生まれの開始日は［×］で消せる', async () => {
    const { user } = await open(mkTask({ id: 't', due: '2026-11-20' }))
    await pick(user, testIds.dupStart, '2026-11-12')
    await user.click(screen.getByRole('button', { name: '開始日を消す' }))
    expect(byId(testIds.dupStart).textContent).toBe('なし')
  })

  it('［やめる］で何も作らずに閉じる', async () => {
    const { user, onClose } = await open(multi)
    await pick(user, testIds.dupStart, '2026-11-17')
    await user.click(screen.getByRole('button', { name: 'やめる' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(added('m')).toEqual([])
  })
})
