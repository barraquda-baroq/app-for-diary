// 3つのリストのまだ済んでいない数（src/features/lists/counts.ts。docs/SPEC.md の 3.5・3.6）: 各リストの中身と同じ決まり（domain の
// taskListView・routineListView・favoriteListView の undone）で数え、記録の表か日が替わった時だけ数え直し、数が同じなら描き直さない。
// 決まりの中身（WP1）とは別に確かめるため、ここでは決まりを数えるだけの物に替える
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { mkFavorite, mkItem, mkRoutine } from '../../domain/testData'
import { emptyData } from '../../domain/types'
import { useApp } from '../../store/appStore'
import { setupCalendarTests } from '../../test/renderCalendar'
import { useListCounts } from './counts'

const calls = vi.hoisted(() => ({ task: 0, routine: 0, favorite: 0, today: [] as string[] }))

vi.mock('../../domain/taskList', () => ({
  taskListView: (items: { done: boolean }[], today: string) => {
    calls.task++
    calls.today.push(today)
    return { open: [], done: [], undone: items.filter((i) => !i.done).length }
  },
}))
vi.mock('../../domain/routineList', () => ({
  routineListView: (data: { routines: object }) => {
    calls.routine++
    return { groups: [], undone: Object.keys(data.routines).length }
  },
}))
vi.mock('../../domain/favoriteList', () => ({
  favoriteListView: (favorites: { done: boolean }[]) => {
    calls.favorite++
    return { open: [], done: [], undone: favorites.filter((f) => !f.done).length }
  },
}))

setupCalendarTests()

const data = () => ({
  ...emptyData(),
  items: {
    a: mkItem({ id: 'a', title: '見積もりの返事', origin: 'list', start: null, due: null, listed: true }),
    b: mkItem({ id: 'b', title: '請求書の確認', origin: 'list', start: null, due: null, listed: true, done: true }),
  },
  routines: { r1: mkRoutine({ id: 'r1' }), r2: mkRoutine({ id: 'r2' }) },
  favorites: { f1: mkFavorite({ id: 'f1' }) },
})

describe('S3 まだ済んでいない数（S3-FRAME-044・S3-ROUTINE-081）', () => {
  it('3つのリストの決まりの undone を、今日（端末の暦）で数える', () => {
    act(() => useApp.setState({ data: data() }))
    const { result } = renderHook(() => useListCounts())
    expect(result.current).toEqual({ routine: 2, task: 1, favorite: 1 })
    expect(calls.today.at(-1)).toBe('2026-11-10')
  })

  it('記録の表が替わらない間は数え直さず、数が同じなら同じ物を返す（トップの画面を描き直さない）', () => {
    act(() => useApp.setState({ data: data() }))
    const { result } = renderHook(() => useListCounts())
    const first = result.current
    const before = { ...calls }
    act(() => useApp.setState({ status: 'ready' }))
    act(() => useApp.setState((s) => ({ data: { ...s.data, offDays: {} } })))
    expect(result.current).toBe(first)
    expect([calls.task, calls.routine, calls.favorite]).toEqual([before.task, before.routine, before.favorite])
    act(() => useApp.setState((s) => ({ data: { ...s.data, favorites: {} } })))
    expect(result.current).toEqual({ routine: 2, task: 1, favorite: 0 })
    expect(calls.task).toBe(before.task)
  })
})
