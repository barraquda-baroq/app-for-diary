// 予定・タスクを消す（src/features/item/deleteItem.ts。docs/SPEC.md の 12.8・7.13）と元に戻す・やり直すの並び: 詳細の画面で直してから
// 中で消した時は、直した所を先に1つ、削除を別の1つに積むこと。消せなかった時（ゴミ箱へ移せない）は、直した所を分けず（閉じた時に
// 1つ）、やり直せる物も消さないこと
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPersistence, type Persistence } from '../../db/persistence'
import { dataWith, mkItem } from '../../domain/testData'
import { emptyData, type AppData } from '../../domain/types'
import { actions } from '../../store/actions'
import { getData, initStore, resetStoreForTests } from '../../store/appStore'
import { useToasts } from '../../store/uiStore'
import { beginItemSession, enterUndoScope, itemChange, recordStep, resetUndoForTests, undo, useUndo } from '../../store/undoStore'
import { deleteItem } from './deleteItem'

let p: Persistence
let leave: () => void = () => {}

async function start(data: AppData): Promise<void> {
  p = createPersistence(`delete-item-${Math.random().toString(36).slice(2)}`)
  await p.save(emptyData(), data)
  await p.completeUpload((await p.readOutbox(10_000)).map((it) => ({ table: it.table, id: it.id, record: it.local })))
  await initStore(p)
}

const labels = () => useUndo.getState().stack.past.map((s) => s.label)
const futureLabels = () => useUndo.getState().stack.future.map((s) => s.label)
/** カレンダーに出ていないタスク（確かめずに消す） */
const task = mkItem({ id: 't', title: '買い物', origin: 'list', start: null, due: null, listed: true })
const other = mkItem({ id: 'o', title: '会議', start: '2026-11-10' })

beforeEach(() => {
  resetStoreForTests()
  resetUndoForTests()
  useToasts.setState({ toasts: [] })
  leave = enterUndoScope()
})

afterEach(() => {
  vi.restoreAllMocks()
  leave()
  p?.close()
  resetStoreForTests()
  resetUndoForTests()
})

describe('詳細の画面の中で消す（7.13）', () => {
  it('直してから消すと、直した所を先に1つ、削除を別の1つに積む（消して詳細の画面が閉じても）', async () => {
    await start(dataWith({ items: [task] }))
    const end = beginItemSession('t')
    actions.updateItem('t', { title: '買い物（駅前）' })
    const trash = actions.trashItem.bind(actions)
    vi.spyOn(actions, 'trashItem').mockImplementation(async (id) => {
      const entry = await trash(id)
      // 消して予定が無くなると、詳細の画面はすぐ閉じる（削除のステップを積む前に）
      end()
      return entry
    })
    expect(await deleteItem(getData().items.t!)).toBe(true)
    expect(labels()).toEqual(['『買い物（駅前）』を直した', '『買い物（駅前）』を削除した'])
    expect(await undo()).toBe(true)
    expect(getData().items.t?.title).toBe('買い物（駅前）')
    expect(await undo()).toBe(true)
    expect(getData().items.t?.title).toBe('買い物')
  })

  it('消せなかった時は、直した所を分けずに開いたまま続け（閉じた時に1つ）、やり直せる物も消さない', async () => {
    await start(dataWith({ items: [task, other] }))
    const b = getData().items.o
    actions.moveItemDates('o', { start: '2026-11-12', due: null, clearEnd: false })
    recordStep('移した', [itemChange('o', b, getData().items.o)])
    expect(await undo()).toBe(true)
    const end = beginItemSession('t')
    actions.updateItem('t', { title: '買い物（駅前）' })
    vi.spyOn(actions, 'trashItem').mockRejectedValue(new Error('端末に保存できませんでした'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await deleteItem(getData().items.t!)).toBe(false)
    expect(labels()).toEqual([])
    expect(futureLabels()).toEqual(['移した'])
    actions.updateItem('t', { memo: 'あとで' })
    end()
    expect(labels()).toEqual(['『買い物（駅前）』を直した'])
    expect(await undo()).toBe(true)
    expect(getData().items.t).toMatchObject({ title: '買い物', memo: task.memo })
  })
})
