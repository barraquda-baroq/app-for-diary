// 元に戻す・やり直すの並びの決まり（docs/SPEC.md の 7.13。src/domain/undo.ts）: 戻す・やり直すの順、新しい操作でやり直せる物が
// 消えること、50 までに切ること、ほかの所で直された時に断ること、詳細の画面で直した所を1つにまとめること
import { describe, expect, it } from 'vitest'
import { mkItem } from './testData'
import type { Item } from './types'
import {
  conflictOf,
  dropStep,
  emptyUndoStack,
  isNoopChange,
  itemIdsOf,
  nextRedo,
  nextUndo,
  placeOf,
  pushStep,
  sessionStep,
  settleStep,
  UNDO_LIMIT,
  type UndoReader,
  type UndoStack,
  type UndoStep,
} from './undo'

const before = mkItem({ id: 'a', title: '会議', start: '2026-11-10' })
const after: Item = { ...before, start: '2026-11-12', updatedAt: before.updatedAt + 1000 }

const move = (id: number): UndoStep => ({
  id,
  label: `${id}`,
  changes: [{ table: 'items', id: 'a', before, after, entry: null }],
})

/** 番号だけのステップ */
const step = (id: number): UndoStep => ({ id, label: `${id}`, changes: [] })
const ids = (s: UndoStack) => ({ past: s.past.map((x) => x.id), future: s.future.map((x) => x.id) })

/** 予定・ゴミ箱・休みを渡して読む物を作る */
function reader(items: Item[], trash: string[] = [], off: string[] = []): UndoReader {
  return {
    item: (id) => items.find((i) => i.id === id),
    inTrash: (e) => trash.includes(e),
    off: (d) => off.includes(d),
  }
}

describe('並びの順', () => {
  it('戻すのはいちばん新しい物から、やり直すのはいちばん新しく戻した物から（settleStep で行き来する）', () => {
    let s = emptyUndoStack()
    for (const n of [1, 2, 3]) s = pushStep(s, step(n))
    expect(nextUndo(s)?.id).toBe(3)
    expect(nextRedo(s)).toBeNull()
    s = settleStep(s, nextUndo(s)!, 'undo')
    s = settleStep(s, nextUndo(s)!, 'undo')
    expect(ids(s)).toEqual({ past: [1], future: [3, 2] })
    expect(nextRedo(s)?.id).toBe(2)
    s = settleStep(s, nextRedo(s)!, 'redo')
    expect(ids(s)).toEqual({ past: [1, 2], future: [3] })
    expect(nextUndo(s)?.id).toBe(2)
  })

  it('新しい操作を積むと、やり直せる物は消える', () => {
    let s = emptyUndoStack()
    for (const n of [1, 2]) s = pushStep(s, step(n))
    s = settleStep(s, nextUndo(s)!, 'undo')
    expect(ids(s)).toEqual({ past: [1], future: [2] })
    s = pushStep(s, step(3))
    expect(ids(s)).toEqual({ past: [1, 3], future: [] })
    expect(nextRedo(s)).toBeNull()
  })

  it(`戻せるのは ${UNDO_LIMIT} まで（古い物から捨てる）`, () => {
    let s = emptyUndoStack()
    for (let n = 1; n <= UNDO_LIMIT + 5; n++) s = pushStep(s, step(n))
    expect(s.past).toHaveLength(UNDO_LIMIT)
    expect(s.past[0].id).toBe(6)
    expect(nextUndo(s)?.id).toBe(UNDO_LIMIT + 5)
    expect(UNDO_LIMIT).toBe(50)
  })

  it('いちばん新しくないステップを戻すと（お知らせの［元に戻す］）、そこから外してやり直せる物の後ろへ', () => {
    let s = emptyUndoStack()
    for (const n of [1, 2, 3]) s = pushStep(s, step(n))
    s = settleStep(s, step(2), 'undo')
    expect(ids(s)).toEqual({ past: [1, 3], future: [2] })
    expect(placeOf(s, 2)).toBe('future')
    expect(placeOf(s, 3)).toBe('past')
    expect(placeOf(s, 9)).toBeNull()
  })

  it('捨てる（dropStep）と、どちらの並びからも消える', () => {
    let s = emptyUndoStack()
    for (const n of [1, 2]) s = pushStep(s, step(n))
    s = settleStep(s, nextUndo(s)!, 'undo')
    expect(ids(dropStep(s, 2))).toEqual({ past: [1], future: [] })
    expect(ids(dropStep(s, 1))).toEqual({ past: [], future: [2] })
  })

  it('戻した後のステップ（ゴミ箱の1件が替わった物）で置き換わる', () => {
    let s = pushStep(emptyUndoStack(), move(1))
    const undone: UndoStep = { ...move(1), changes: [{ table: 'items', id: 'a', before, after, entry: 'e9' }] }
    s = settleStep(s, undone, 'undo')
    expect(s.future[0]).toBe(undone)
  })
})

describe('ほかの所で直された時は断る（conflictOf）', () => {
  it('戻す時は「後」、やり直す時は「前」と同じ中身なら当てられる（直した日時・並びの数は見ない。形2）', () => {
    expect(conflictOf(move(1), 'undo', reader([{ ...after, updatedAt: 1, order: 5 }]))).toBeNull()
    expect(conflictOf(move(1), 'redo', reader([before]))).toBeNull()
  })

  it('中身が違えば断る（ほかの端末で件名を直した・並びの外で直した）', () => {
    expect(conflictOf(move(1), 'undo', reader([{ ...after, title: '別の件名' }]))).not.toBeNull()
    expect(conflictOf(move(1), 'redo', reader([after]))).not.toBeNull()
    // 戻した後に、もう一度戻そうとしても（「後」ではない）断る
    expect(conflictOf(move(1), 'undo', reader([before]))).not.toBeNull()
  })

  it('予定が無くなっていれば（ゴミ箱へ移した・消えた）断る', () => {
    expect(conflictOf(move(1), 'undo', reader([]))).not.toBeNull()
  })

  it('足した物（前 = null）: 戻す時は今あって「後」のまま、やり直す時は無くて、覚えたゴミ箱の1件がまだある時だけ', () => {
    const add: UndoStep = { id: 1, label: '', changes: [{ table: 'items', id: 'a', before: null, after: before, entry: null }] }
    expect(conflictOf(add, 'undo', reader([before]))).toBeNull()
    expect(conflictOf(add, 'undo', reader([after]))).not.toBeNull()
    const undone: UndoStep = { ...add, changes: [{ table: 'items', id: 'a', before: null, after: before, entry: 'e1' }] }
    expect(conflictOf(undone, 'redo', reader([], ['e1']))).toBeNull()
    // ゴミ箱から戻した・完全に削除した（ほかの所で）
    expect(conflictOf(undone, 'redo', reader([], []))).not.toBeNull()
    expect(conflictOf(undone, 'redo', reader([before], ['e1']))).not.toBeNull()
  })

  it('消した物（後 = null）: 戻す時はゴミ箱にあって予定が無い時だけ、やり直す時は「前」のまま', () => {
    const del: UndoStep = { id: 1, label: '', changes: [{ table: 'items', id: 'a', before, after: null, entry: 'e1' }] }
    expect(conflictOf(del, 'undo', reader([], ['e1']))).toBeNull()
    expect(conflictOf(del, 'undo', reader([], []))).not.toBeNull()
    const restored: UndoStep = { ...del, changes: [{ table: 'items', id: 'a', before, after: null, entry: null }] }
    expect(conflictOf(restored, 'redo', reader([before]))).toBeNull()
    expect(conflictOf(restored, 'redo', reader([after]))).not.toBeNull()
  })

  it('休み: 戻す時は「後」、やり直す時は「前」の休みかどうかと同じ時だけ', () => {
    const off: UndoStep = { id: 1, label: '', changes: [{ table: 'offDays', id: '2026-11-11', before: false, after: true }] }
    expect(conflictOf(off, 'undo', reader([], [], ['2026-11-11']))).toBeNull()
    expect(conflictOf(off, 'undo', reader([]))).not.toBeNull()
    expect(conflictOf(off, 'redo', reader([]))).toBeNull()
    expect(conflictOf(off, 'redo', reader([], [], ['2026-11-11']))).not.toBeNull()
  })
})

describe('詳細の画面で直した所を1つにまとめる（sessionStep）', () => {
  it('開いた時の記録から閉じた時の記録までを1つのステップにする（2つの欄を直しても1つ）', () => {
    const edited: Item = { ...before, title: '定例会議', memo: '資料を持つ', updatedAt: before.updatedAt + 5 }
    const s = sessionStep(7, '『定例会議』を直した', before, edited)
    expect(s).toEqual({
      id: 7,
      label: '『定例会議』を直した',
      changes: [{ table: 'items', id: 'a', before, after: edited, entry: null }],
    })
    expect(itemIdsOf(s!)).toEqual(['a'])
  })

  it('変わっていない（直した日時だけ違う）・予定が無くなった時は積まない', () => {
    expect(sessionStep(1, '', before, { ...before, updatedAt: 99 })).toBeNull()
    expect(sessionStep(1, '', before, null)).toBeNull()
    expect(sessionStep(1, '', null, before)).toBeNull()
  })
})

describe('何も変えていない変わり方（isNoopChange）', () => {
  it('前と後が同じ中身（直した日時だけ違う）・同じ休み・どちらも無いは何も変えていない', () => {
    expect(isNoopChange({ table: 'items', id: 'a', before, after: { ...before, updatedAt: 9 }, entry: null })).toBe(true)
    expect(isNoopChange({ table: 'items', id: 'a', before, after, entry: null })).toBe(false)
    expect(isNoopChange({ table: 'items', id: 'a', before: null, after: before, entry: null })).toBe(false)
    expect(isNoopChange({ table: 'items', id: 'a', before: null, after: null, entry: null })).toBe(true)
    expect(isNoopChange({ table: 'offDays', id: 'd', before: true, after: true })).toBe(true)
    expect(isNoopChange({ table: 'offDays', id: 'd', before: false, after: true })).toBe(false)
  })
})
