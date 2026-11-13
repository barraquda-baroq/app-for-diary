// 元に戻す・やり直すを当てる所（docs/SPEC.md の 7.13・3.9。src/store/undoStore.ts）: 画面と同じ actions で戻し・やり直し、保存も
// ふつうに流れること。足した物・消した物はゴミ箱を通ること。ほかの所で直された時は断ってステップを捨てること。積むのはウィークリー・
// デイリーを出している間だけで、積まなかった操作もお知らせの［元に戻す］では戻ること。詳細の画面は開いてから閉じるまでを1つに
// まとめること
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createPersistence, type Persistence } from '../db/persistence'
import { dataWith, mkItem } from '../domain/testData'
import { emptyData, type AppData, type Item } from '../domain/types'
import type { UndoStep } from '../domain/undo'
import { actions } from './actions'
import { flushNow, getData, initStore, resetStoreForTests } from './appStore'
import { useToasts } from './uiStore'
import {
  beginItemSession,
  enterUndoScope,
  itemChange,
  notifyUndoable,
  recordStep,
  redo,
  resetUndoForTests,
  undo,
  UNDO_CONFLICT,
  undoScopeActive,
  undoStep,
  useUndo,
} from './undoStore'

let seq = 0
let p: Persistence
let leave: () => void = () => {}

async function start(data: AppData = emptyData()): Promise<void> {
  p = createPersistence(`undo-store-${++seq}-${Math.random().toString(36).slice(2)}`)
  await p.save(emptyData(), data)
  await p.completeUpload((await p.readOutbox(10_000)).map((it) => ({ table: it.table, id: it.id, record: it.local })))
  await initStore(p)
}

const meeting = mkItem({ id: 'a', title: '会議', start: '2026-11-10', startTime: '10:00' })
const item = (id = 'a'): Item | undefined => getData().items[id]
const labels = () => useUndo.getState().stack.past.map((s) => s.label)
const futureLabels = () => useUndo.getState().stack.future.map((s) => s.label)
const toastTexts = () => useToasts.getState().toasts.map((t) => t.message)

/** ドラッグで日を動かした時と同じ（動かして、前・後を積む） */
function moveTo(date: string, label = '移した'): UndoStep {
  const b = item()
  actions.moveItemDates('a', { start: date, due: null, clearEnd: false })
  const s = recordStep(label, [itemChange('a', b, item())])
  if (!s) throw new Error('積まれませんでした')
  return s
}

beforeEach(() => {
  resetStoreForTests()
  resetUndoForTests()
  useToasts.setState({ toasts: [] })
  localStorage.clear()
  leave = enterUndoScope()
})

afterEach(() => {
  leave()
  p?.close()
  resetStoreForTests()
  resetUndoForTests()
})

describe('戻す・やり直す', () => {
  it('動かした予定を戻すと前の日、やり直すとまた動かした日。保存される', async () => {
    await start(dataWith({ items: [meeting] }))
    moveTo('2026-11-12')
    expect(labels()).toEqual(['移した'])
    expect(await undo()).toBe(true)
    expect(item()?.start).toBe('2026-11-10')
    expect(labels()).toEqual([])
    expect(futureLabels()).toEqual(['移した'])
    expect(await flushNow()).toBe(true)
    expect((await p.load()).items.a.start).toBe('2026-11-10')
    expect(await redo()).toBe(true)
    expect(item()?.start).toBe('2026-11-12')
    expect(labels()).toEqual(['移した'])
    expect(futureLabels()).toEqual([])
  })

  it('戻す物・やり直す物が無ければ何もしない。何も変わらなかった操作は積まない', async () => {
    await start(dataWith({ items: [meeting] }))
    expect(await undo()).toBe(false)
    expect(await redo()).toBe(false)
    expect(recordStep('同じ', [itemChange('a', item(), { ...item()!, updatedAt: 1 })])).toBeNull()
    expect(recordStep('休み', [{ table: 'offDays', id: '2026-11-11', before: true, after: true }])).toBeNull()
    expect(labels()).toEqual([])
  })

  it('続けて押した分は順に当てる（2回押すと2つ戻る）', async () => {
    await start(dataWith({ items: [meeting] }))
    moveTo('2026-11-11', '1')
    moveTo('2026-11-12', '2')
    const both = await Promise.all([undo(), undo()])
    expect(both).toEqual([true, true])
    expect(item()?.start).toBe('2026-11-10')
    expect(futureLabels()).toEqual(['2', '1'])
  })

  it('足した予定を戻すとゴミ箱へ、やり直すとゴミ箱から戻る（同じ id）', async () => {
    await start()
    const id = actions.addItem({ origin: 'calendar', title: '買い物', start: '2026-11-10' })
    recordStep('足した', [itemChange(id, null, item(id))])
    expect(await undo()).toBe(true)
    expect(item(id)).toBeUndefined()
    expect(Object.values(getData().trashEntries)).toHaveLength(1)
    expect(await redo()).toBe(true)
    expect(item(id)?.title).toBe('買い物')
    expect(Object.values(getData().trashEntries)).toHaveLength(0)
    // もう一度戻す（やり直した後も同じ）
    expect(await undo()).toBe(true)
    expect(item(id)).toBeUndefined()
  })

  it('消した予定（ゴミ箱へ）を戻すと元に戻り、やり直すとまたゴミ箱へ', async () => {
    await start(dataWith({ items: [meeting] }))
    const b = item()
    const entry = await actions.trashItem('a')
    recordStep('削除した', [itemChange('a', b, null, entry)])
    expect(item()).toBeUndefined()
    expect(await undo()).toBe(true)
    expect(item()).toMatchObject({ title: '会議', start: '2026-11-10' })
    expect(await redo()).toBe(true)
    expect(item()).toBeUndefined()
    expect(await undo()).toBe(true)
    expect(item()?.title).toBe('会議')
  })

  it('休みを付けたのを戻すと外れ、やり直すとまた付く', async () => {
    await start()
    actions.setOffDay('2026-11-11', true)
    recordStep('休み', [{ table: 'offDays', id: '2026-11-11', before: false, after: true }])
    expect(await undo()).toBe(true)
    expect(getData().offDays['2026-11-11']?.off).toBe(false)
    expect(await redo()).toBe(true)
    expect(getData().offDays['2026-11-11']?.off).toBe(true)
  })

  it('新しい操作をするとやり直せる物は消える', async () => {
    await start(dataWith({ items: [meeting] }))
    moveTo('2026-11-11', '1')
    await undo()
    expect(futureLabels()).toEqual(['1'])
    moveTo('2026-11-13', '2')
    expect(futureLabels()).toEqual([])
    expect(await redo()).toBe(false)
  })

  it('戻した・やり直した後にすること（すばやく足すの書きかけ）を呼ぶ', async () => {
    await start()
    const calls: string[] = []
    const id = actions.addItem({ origin: 'calendar', title: 'x', start: '2026-11-10' })
    recordStep('足した', [itemChange(id, null, item(id))], {
      afterUndo: () => calls.push('undo'),
      afterRedo: () => calls.push('redo'),
    })
    await undo()
    await redo()
    expect(calls).toEqual(['undo', 'redo'])
  })
})

describe('ほかの所で直された時', () => {
  it('並びの外で直した予定は戻さず「ほかの所で直されたので戻せません」。そのステップは捨てる', async () => {
    await start(dataWith({ items: [meeting] }))
    moveTo('2026-11-11', '1')
    moveTo('2026-11-12', '2')
    // ほかの所（ほかの端末・並びの外の画面）で件名を直した
    actions.updateItem('a', { title: '別の所で直した' })
    expect(await undo()).toBe(false)
    expect(toastTexts()).toContain(UNDO_CONFLICT)
    expect(item()).toMatchObject({ start: '2026-11-12', title: '別の所で直した' })
    // 捨てたのは '2' だけ。次の '1' も、今の記録が「後」と違うので断って捨てる
    expect(labels()).toEqual(['1'])
    expect(await undo()).toBe(false)
    expect(labels()).toEqual([])
  })

  it('やり直す時も、戻した後にほかの所で直されていれば断る', async () => {
    await start(dataWith({ items: [meeting] }))
    moveTo('2026-11-12')
    await undo()
    actions.updateItem('a', { memo: 'ほかの端末' })
    expect(await redo()).toBe(false)
    expect(toastTexts()).toContain(UNDO_CONFLICT)
    expect(futureLabels()).toEqual([])
    expect(item()?.start).toBe('2026-11-10')
  })

  it('足した予定がもう無い（ほかの所でゴミ箱へ移した）時は断る', async () => {
    await start()
    const id = actions.addItem({ origin: 'calendar', title: 'x', start: '2026-11-10' })
    recordStep('足した', [itemChange(id, null, item(id))])
    await actions.trashItem(id)
    expect(await undo()).toBe(false)
    expect(toastTexts()).toContain(UNDO_CONFLICT)
  })
})

describe('お知らせの［元に戻す］も同じ並び', () => {
  it('お知らせで戻すと、ボタンの元に戻すの1つ分になり（もうボタンでは戻さない）、やり直すで戻せる', async () => {
    await start(dataWith({ items: [meeting] }))
    const s = moveTo('2026-11-12')
    notifyUndoable('11/12（木）へ移しました', s)
    const toast = useToasts.getState().toasts[0]
    toast.action?.run()
    await undo() // 並びにはもう無い
    expect(item()?.start).toBe('2026-11-10')
    expect(labels()).toEqual([])
    expect(futureLabels()).toEqual(['移した'])
    expect(await redo()).toBe(true)
    expect(item()?.start).toBe('2026-11-12')
  })

  it('いちばん新しくない操作のお知らせでも、その操作だけを戻す', async () => {
    await start(dataWith({ items: [meeting, mkItem({ id: 'b', title: '昼食', start: '2026-11-10' })] }))
    const s = moveTo('2026-11-12', '会議')
    const bb = item('b')
    actions.setItemDone('b', true)
    recordStep('昼食', [itemChange('b', bb, item('b'))])
    expect(await undoStep(s.id)).toBe(true)
    expect(item()?.start).toBe('2026-11-10')
    expect(item('b')?.done).toBe(true)
    expect(labels()).toEqual(['昼食'])
  })

  it('ボタンで戻したら、その操作のお知らせを消す（もう一度押しても何もしない）', async () => {
    await start(dataWith({ items: [meeting] }))
    const s = moveTo('2026-11-12')
    notifyUndoable('11/12（木）へ移しました', s)
    expect(toastTexts()).toEqual(['11/12（木）へ移しました'])
    await undo()
    expect(toastTexts()).toEqual([])
    expect(await undoStep(s.id)).toBe(false)
  })

  it('ウィークリー・デイリーを出していない間の操作は積まないが、お知らせの［元に戻す］では戻る', async () => {
    await start(dataWith({ items: [meeting] }))
    leave()
    expect(undoScopeActive()).toBe(false)
    const s = moveTo('2026-11-12')
    expect(labels()).toEqual([])
    expect(await undoStep(s.id)).toBe(true)
    expect(item()?.start).toBe('2026-11-10')
    expect(futureLabels()).toEqual([])
    expect(await undoStep(s.id)).toBe(false)
  })

  it('年・月へ替えても（ウィークリー・デイリーの画面が外れても）並びは消さない（■24）', async () => {
    await start(dataWith({ items: [meeting] }))
    moveTo('2026-11-12')
    leave()
    leave = enterUndoScope()
    expect(labels()).toEqual(['移した'])
    expect(await undo()).toBe(true)
  })
})

describe('詳細の画面は開いてから閉じるまでを1つに', () => {
  it('2つの欄を直して閉じると1つのステップ。戻すと両方が戻る', async () => {
    await start(dataWith({ items: [meeting] }))
    const end = beginItemSession('a')
    actions.updateItem('a', { title: '定例会議' })
    actions.updateItem('a', { memo: '資料' })
    actions.setItemDone('a', true)
    expect(labels()).toEqual([])
    end()
    expect(labels()).toEqual(['『定例会議』を直した'])
    expect(await undo()).toBe(true)
    expect(item()).toMatchObject({ title: '会議', memo: '', done: false })
    expect(await redo()).toBe(true)
    expect(item()).toMatchObject({ title: '定例会議', memo: '資料', done: true })
  })

  it('何も直さずに閉じた時は積まない', async () => {
    await start(dataWith({ items: [meeting] }))
    beginItemSession('a')()
    expect(labels()).toEqual([])
  })

  it('中で複製した時は、それまでに直した所を先に積み、複製は別のステップ。続けて直した所は閉じた時に', async () => {
    await start(dataWith({ items: [meeting] }))
    const end = beginItemSession('a')
    actions.updateItem('a', { title: '定例会議' })
    const copy = actions.duplicateItem('a', { start: '2026-11-17', due: null })
    recordStep('複製した', [itemChange(copy, null, item(copy))])
    actions.updateItem('a', { memo: 'あとで' })
    end()
    expect(labels()).toEqual(['『定例会議』を直した', '複製した', '『定例会議』を直した'])
  })

  it('中で削除した時は、それまでに直した所を先に積み、削除は別のステップ', async () => {
    await start(dataWith({ items: [meeting] }))
    const end = beginItemSession('a')
    actions.updateItem('a', { title: '定例会議' })
    const b = item()
    const entry = await actions.trashItem('a')
    recordStep('削除した', [itemChange('a', b, null, entry)])
    end()
    expect(labels()).toEqual(['『定例会議』を直した', '削除した'])
    await undo()
    expect(item()?.title).toBe('定例会議')
    await undo()
    expect(item()?.title).toBe('会議')
  })

  it('ウィークリー・デイリーを出していない時に開いた詳細は積まない', async () => {
    await start(dataWith({ items: [meeting] }))
    leave()
    const end = beginItemSession('a')
    actions.updateItem('a', { title: '定例会議' })
    end()
    expect(labels()).toEqual([])
  })
})
