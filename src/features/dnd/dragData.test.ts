// 掴んだ物の値の見分け方（src/features/dnd/dragData.ts。docs/SPEC.md の 7.11・13.6・14.2・15.2。開発・S3-FRAME-224）: Task List の行・並べ替え・
// ウィークリーの予定を読み違えない（並べ替えの物をカレンダーの日へ落とせる物と読まない）
import { describe, expect, it } from 'vitest'
import { mkItem } from '../../domain/testData'
import { asSortDrag, asTaskRowDrag, dragTypeOf } from './dragData'

const item = mkItem({ id: 'a', title: '見積もりの返事', start: '2026-11-10' })
const week = { item, handle: 'card', week: { from: '2026-11-08', to: '2026-11-14' } }
const row = { type: 'task-row', item }
const sort = { type: 'sort', table: 'routines', group: 'weekly', id: 'r1', index: 2 }

describe('S3 掴んだ物の値の見分け方', () => {
  it('Task List の行・並べ替え・ウィークリーの予定を分ける', () => {
    expect(dragTypeOf(row)).toBe('task-row')
    expect(dragTypeOf(sort)).toBe('sort')
    expect(dragTypeOf(week)).toBe('week-item')
    expect(asTaskRowDrag(row)).toBe(row)
    expect(asSortDrag(sort)).toBe(sort)
  })

  it('印の付いた物はウィークリーの予定と読まない（並べ替えの物にウィークリーの形が混ざっていても）', () => {
    expect(dragTypeOf({ ...week, type: 'sort' })).toBeNull()
    expect(dragTypeOf({ ...week, type: 'other' })).toBeNull()
    expect(asTaskRowDrag(week)).toBeNull()
    expect(asSortDrag(week)).toBeNull()
  })

  it('形の正しくない物は読まない', () => {
    for (const bad of [
      null,
      'task-row',
      [],
      { type: 'task-row' },
      { type: 'task-row', item: { title: 'id が無い' } },
      { ...sort, table: 'items' },
      { ...sort, index: -1 },
      { ...sort, index: 1.5 },
      { ...sort, group: 3 },
      { ...sort, id: null },
    ]) {
      expect(dragTypeOf(bad), JSON.stringify(bad)).toBeNull()
    }
  })
})
