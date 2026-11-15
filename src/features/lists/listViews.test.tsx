// 3つのリストの中身のフック（task/useTaskList・routine/useRoutineList・favorite/useFavoriteList。docs/SPEC.md の 13.〜15.）と、
// 見出し・切り替えの列の数（counts.ts の useListCounts。3.5・3.6）を、本物の決まり（src/domain の taskListView・routineListView・
// favoriteListView）で確かめる: 記録の表から作り、ほかの表が替わっても作り直さず、直していない記録の行は前と同じ物（行は React.memo）。
// 作り物のデータ（e2e/fixtures/listData.ts）の数は中身の数と同じ。Routine List の［すべて開く／畳む］はルーチンのある種類だけを数える
import { act, render, renderHook, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { LIST_IDS, LIST_TODAY, listData } from '../../../e2e/fixtures/listData'
import { favoriteListView } from '../../domain/favoriteList'
import { routineListView } from '../../domain/routineList'
import { taskListView } from '../../domain/taskList'
import { DAY, T0, mkCheck, mkFavorite, mkItem, mkRoutine, mkTask } from '../../domain/testData'
import { emptyData, type AppData } from '../../domain/types'
import { useApp } from '../../store/appStore'
import { usePrefs } from '../../store/uiStore'
import { setupCalendarTests } from '../../test/renderCalendar'
import { useListCounts } from './counts'
import { useFavoriteList } from './favorite/useFavoriteList'
import { RoutineAllToggle } from './routine/RoutineAllToggle'
import { useRoutineList } from './routine/useRoutineList'
import { useTaskList } from './task/useTaskList'

setupCalendarTests()

const TODAY = '2026-11-10'

/** 記録を置く（足りない表は空） */
function put(data: Partial<AppData>): void {
  act(() => useApp.setState({ data: { ...emptyData(), ...data } }))
}

/** 1つの表だけを替える */
function change(patch: (d: AppData) => Partial<AppData>): void {
  act(() => useApp.setState((s) => ({ data: { ...s.data, ...patch(s.data) } })))
}

const ids = (rows: readonly { id: string }[]) => rows.map((r) => r.id)

describe('S3 Task List の中身（useTaskList。S3-TASK-110・S3-FRAME-284）', () => {
  const items = () => ({
    due: mkTask({ id: 'due', title: '見積もりの返事', due: '2026-11-11', createdAt: T0 - 3 * DAY }),
    none: mkTask({ id: 'none', title: '資料を印刷する', createdAt: T0 - 2 * DAY }),
    // 済んで 2日（出す）・済んで 167時間と 59分（出す。1分後に 168時間を過ぎて隠す）
    done: mkTask({ id: 'done', title: '備品の棚を片付ける', done: true, doneAt: T0 - 2 * DAY, doneOn: '2026-11-08' }),
    edge: mkTask({ id: 'edge', title: '古い書類を捨てる', done: true, doneAt: T0 - 168 * 3600_000 + 60_000 }),
    // カレンダー生まれで Task List に出していない物（出さない）
    cal: mkItem({ id: 'cal', title: '定例会議', origin: 'calendar', start: TODAY, listed: false }),
  })

  it('予定の表から、Task List の決まり（taskListView）で中身を作る', () => {
    put({ items: items() })
    const { result } = renderHook(() => useTaskList(TODAY, T0))
    const want = taskListView(Object.values(items()), TODAY, T0)
    expect(ids(result.current.open)).toEqual(['due', 'none'])
    expect(ids(result.current.open)).toEqual(ids(want.open))
    expect(ids(result.current.done)).toEqual(ids(want.done))
    expect(result.current.undone).toBe(2)
    expect(result.current.open[0]).toEqual(want.open[0])
  })

  it('ほかの表が替わっても同じ中身。1つの記録を直すと、その行だけ新しく、ほかの行は前と同じ物', () => {
    put({ items: items() })
    const { result } = renderHook(() => useTaskList(TODAY, T0))
    const first = result.current
    change(() => ({ favorites: { f1: mkFavorite() } }))
    expect(result.current).toBe(first)
    change((d) => ({ items: { ...d.items, none: { ...d.items.none, title: '資料を2部印刷する' } } }))
    expect(result.current).not.toBe(first)
    expect(result.current.open[0]).toBe(first.open[0])
    expect(result.current.open[1]).not.toBe(first.open[1])
    expect(result.current.open[1].item.title).toBe('資料を2部印刷する')
    expect(result.current.done).toEqual(first.done)
    expect(result.current.done[0]).toBe(first.done[0])
  })

  it('今の時刻だけ進んでも、隠れる行が無ければ前と同じ中身。済んで 168時間を過ぎた行は隠す', () => {
    put({ items: items() })
    const { result, rerender } = renderHook(({ now }) => useTaskList(TODAY, now), { initialProps: { now: T0 } })
    const first = result.current
    expect(ids(first.done)).toEqual(['done', 'edge'])
    rerender({ now: T0 + 30_000 })
    expect(result.current).toBe(first)
    rerender({ now: T0 + 60_001 })
    expect(ids(result.current.done)).toEqual(['done'])
    expect(result.current.done[0]).toBe(first.done[0])
    expect(result.current.open).toEqual(first.open)
  })

  it('今日が替わると、期限切れ・今日の太字を決め直す（その行だけ新しい物）', () => {
    put({ items: items() })
    const { result, rerender } = renderHook(({ today }) => useTaskList(today, T0), { initialProps: { today: TODAY } })
    const first = result.current
    expect(first.open[0]).toMatchObject({ id: 'due', today: false, overdue: false })
    rerender({ today: '2026-11-11' })
    expect(result.current.open[0]).toMatchObject({ id: 'due', today: true, overdue: false })
    expect(result.current.open[1]).toBe(first.open[1])
    rerender({ today: '2026-11-12' })
    expect(result.current.open[0]).toMatchObject({ id: 'due', today: false, overdue: true })
  })
})

describe('S3 Routine List の中身（useRoutineList。S3-ROUTINE-041・S3-ROUTINE-081）', () => {
  const routines = () => ({
    a: mkRoutine({ id: 'a', title: '植物に水をやる', order: 0 }),
    b: mkRoutine({ id: 'b', title: 'ストレッチ', order: 1 }),
    w: mkRoutine({ id: 'w', title: 'ゴミ出し', cycle: 'weekly', weekdays: [1, 4] }),
  })

  it('記録から5つのかたまりを作り、チェックを付けると済みへ動く（ほかの行・ほかの種類のかたまりは前と同じ物）', () => {
    put({ routines: routines() })
    const { result } = renderHook(() => useRoutineList(TODAY))
    const first = result.current
    expect(first.groups.map((g) => g.cycle)).toEqual(['daily', 'weekly', 'monthly', 'quarterly', 'yearly'])
    expect(ids(first.groups[0].open)).toEqual(['a', 'b'])
    expect(first.undone).toBe(3)
    change(() => ({ offDays: {} }))
    expect(result.current).toBe(first)
    const check = mkCheck('a', '2026-11', [TODAY])
    change(() => ({ routineChecks: { [check.id]: check } }))
    const next = result.current
    expect(ids(next.groups[0].open)).toEqual(['b'])
    expect(ids(next.groups[0].done)).toEqual(['a'])
    expect(next.groups[0].open[0]).toBe(first.groups[0].open[1])
    expect(next.groups[1]).toBe(first.groups[1])
    expect(next.groups[2]).toBe(first.groups[2])
    expect(next.undone).toBe(2)
    expect(next).toEqual(routineListView({ routines: routines(), routineChecks: { [check.id]: check } }, TODAY))
  })

  it('0時を過ぎて今日が替わると、チェックの記録はそのままで行が戻る', () => {
    const check = mkCheck('a', '2026-11', [TODAY])
    put({ routines: routines(), routineChecks: { [check.id]: check } })
    const { result, rerender } = renderHook(({ today }) => useRoutineList(today), { initialProps: { today: TODAY } })
    expect(ids(result.current.groups[0].done)).toEqual(['a'])
    rerender({ today: '2026-11-11' })
    expect(ids(result.current.groups[0].open)).toEqual(['a', 'b'])
    expect(result.current.groups[0].done).toEqual([])
    expect(useApp.getState().data.routineChecks[check.id]).toBe(check)
  })
})

describe('S3 Favorite List の中身（useFavoriteList。S3-FRAME-284）', () => {
  it('記録から作り（新しい物が上・済みは別）、1つ直すとほかの行は前と同じ物', () => {
    put({
      favorites: {
        old: mkFavorite({ id: 'old', text: '近所のパン屋に行ってみる', order: 2 }),
        top: mkFavorite({ id: 'top', text: '週末に作りたい料理\nカレー', order: 1 }),
        done: mkFavorite({ id: 'done', text: '新しいノートを買う', done: true, doneAt: T0 - DAY }),
      },
    })
    const { result } = renderHook(() => useFavoriteList(TODAY))
    const first = result.current
    expect(ids(first.open)).toEqual(['top', 'old'])
    expect(ids(first.done)).toEqual(['done'])
    expect(first.undone).toBe(2)
    expect(first.open[0]).toMatchObject({ firstLine: '週末に作りたい料理', multiLine: true })
    change(() => ({ routines: {} }))
    expect(result.current).toBe(first)
    change((d) => ({ favorites: { ...d.favorites, old: { ...d.favorites.old, text: '駅前のパン屋に行ってみる' } } }))
    expect(result.current.open[0]).toBe(first.open[0])
    expect(result.current.open[1].firstLine).toBe('駅前のパン屋に行ってみる')
    expect(result.current.done[0]).toBe(first.done[0])
  })
})

describe('S3 見出し・切り替えの列の数（useListCounts。S3-FRAME-044・S3-ROUTINE-081）', () => {
  it('作り物のデータでは Routine 5・Task 7・Favorite 4 で、各リストの中身のまだ済んでいない数と同じ', () => {
    put(listData())
    const nowMs = Date.parse(`${LIST_TODAY}T09:00:00+09:00`)
    const counts = renderHook(() => useListCounts())
    const views = renderHook(() => ({
      routine: useRoutineList(LIST_TODAY).undone,
      task: useTaskList(LIST_TODAY, nowMs).undone,
      favorite: useFavoriteList(LIST_TODAY).undone,
    }))
    expect(counts.result.current).toEqual({ routine: 5, task: 7, favorite: 4 })
    expect(views.result.current).toEqual(counts.result.current)
    expect(favoriteListView(Object.values(listData().favorites), LIST_TODAY).undone).toBe(4)
  })

  it('記録が替わるとすぐ数え直す（チェック・済み・足す）', () => {
    put(listData())
    const { result } = renderHook(() => useListCounts())
    change((d) => ({
      items: { ...d.items, [LIST_IDS.printDocs]: { ...d.items[LIST_IDS.printDocs], done: true, doneAt: T0, doneOn: TODAY } },
      favorites: { ...d.favorites, extra: mkFavorite({ id: 'extra', text: '駅前の本屋をのぞく', order: -1 }) },
      routineChecks: { ...d.routineChecks, s: mkCheck(LIST_IDS.stretch, '2026-11', [TODAY], { id: 's' }) },
    }))
    expect(result.current).toEqual({ routine: 4, task: 6, favorite: 5 })
  })
})

describe('S3 Routine List の［すべて開く／畳む］（routine/RoutineAllToggle。14.2・D26）', () => {
  it('ルーチンが無い間は出さず、あるとルーチンのある種類のかたまりだけを切り替える', async () => {
    const user = userEvent.setup()
    put({})
    const { rerender } = render(<RoutineAllToggle />)
    expect(screen.queryByTestId('routine-toggle-all')).toBeNull()
    change(() => ({
      routines: {
        a: mkRoutine({ id: 'a' }),
        w: mkRoutine({ id: 'w', title: '週の振り返り', cycle: 'weekly' }),
      },
    }))
    rerender(<RoutineAllToggle />)
    const toggle = screen.getByTestId('routine-toggle-all')
    expect(toggle.textContent).toBe('すべて畳む')
    await user.click(toggle)
    expect(usePrefs.getState().collapsed.routineGroups).toEqual({
      daily: true,
      weekly: true,
      monthly: false,
      quarterly: false,
      yearly: false,
    })
    expect(screen.getByTestId('routine-toggle-all').textContent).toBe('すべて開く')
  })
})
