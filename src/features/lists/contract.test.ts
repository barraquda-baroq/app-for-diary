// 段階3のリストの約束（契約）の確かめ: 段階0からある data-testid の名前を替えていないこと、E2E と見本の画面が使う作り物のデータ
// （e2e/fixtures/listData.ts）が今の決まり（6.2〜6.4・6.7）に合い、見せたい形（listData.ts の頭の「中身」）になっていること
import { describe, expect, it } from 'vitest'
import { LIST_IDS, LIST_TODAY, listData } from '../../../e2e/fixtures/listData'
import { isInTaskList, isOnCalendar, itemProblems } from '../../domain/items'
import { checkDatesOf, effectiveSpec, isRoutineDone, routineProblems } from '../../domain/routines'
import { listTestIds } from './common/testIds'

describe('S3 リストの data-testid', () => {
  it('段階0からある名前はそのまま（e2e/frame.spec.ts・e2e/smoke.spec.ts が探す）', () => {
    expect(listTestIds.section('routine')).toBe('list-routine')
    expect(listTestIds.count('task')).toBe('list-task-count')
    expect(listTestIds.fold('favorite')).toBe('list-favorite-fold')
    expect(listTestIds.body('task')).toBe('list-task-body')
    expect(listTestIds.input('routine')).toBe('list-routine-input')
    expect(listTestIds.routineToggleAll).toBe('routine-toggle-all')
  })
})

describe('S3 リストの作り物のデータ（e2e/fixtures/listData.ts）', () => {
  const nowMs = Date.parse(`${LIST_TODAY}T09:00:00+09:00`)
  const data = listData()

  it('予定・ルーチンはどれも決まりに合う', () => {
    for (const item of Object.values(data.items)) expect(itemProblems(item), item.id).toEqual([])
    for (const r of Object.values(data.routines)) expect(routineProblems(r), r.id).toEqual([])
  })

  it('済んで 8日たったタスクは Task List に出ず、2日前の物と済んでいない物は出る', () => {
    expect(isInTaskList(data.items[LIST_IDS.oldPapers], nowMs)).toBe(false)
    expect(isInTaskList(data.items[LIST_IDS.shelfTidy], nowMs)).toBe(true)
    expect(isInTaskList(data.items[LIST_IDS.quoteReply], nowMs)).toBe(true)
  })

  it('①④はカレンダーに出ず、②③とカレンダー生まれは出る', () => {
    expect(isOnCalendar(data.items[LIST_IDS.printDocs])).toBe(false)
    expect(isOnCalendar(data.items[LIST_IDS.libraryBooks])).toBe(false)
    expect(isOnCalendar(data.items[LIST_IDS.quoteReply])).toBe(true)
    expect(isOnCalendar(data.items[LIST_IDS.roomBooking])).toBe(true)
    expect(isOnCalendar(data.items[LIST_IDS.dentist])).toBe(true)
  })

  it('今日は「植物に水をやる」だけが済みで、四半期のルーチンは無い', () => {
    const done = Object.values(data.routines).filter((r) => isRoutineDone(effectiveSpec(r), checkDatesOf(data, r.id), LIST_TODAY))
    expect(done.map((r) => r.id)).toEqual([LIST_IDS.waterPlants])
    expect(Object.values(data.routines).some((r) => r.cycle === 'quarterly')).toBe(false)
  })

  it('やりたいことは上から決めた順に並び、済みは1件', () => {
    const open = Object.values(data.favorites)
      .filter((f) => !f.done)
      .sort((a, b) => a.order - b.order)
    expect(open.map((f) => f.id)).toEqual([LIST_IDS.bakery, LIST_IDS.recipes, LIST_IDS.article, LIST_IDS.trips])
    expect(Object.values(data.favorites).filter((f) => f.done)).toHaveLength(1)
  })
})
