// 予定の操作を actions から呼んだ時の保存（docs/SPEC.md の 6.12・形3・ITEMS-037・039・7.11・12.7）: 新しい版が足した知らない値
// （kind: 'family'・知らない label・知らない項目）は、件名を直しても、ドラッグで日を動かしても、元に戻しても、複製しても、端末の
// raw の記録にそのまま残る（画面の操作は actions を通し、保存は raw に、変えた項目と書き戻す直しだけを重ねる）。
// 区分は詳細で選んだ時だけその値を書く
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createPersistence, type Persistence } from '../db/persistence'
import { UNDO_REFUSED } from '../domain/ops'
import { dataWith, mkItem } from '../domain/testData'
import { DomainError, emptyData, type AppData, type Item } from '../domain/types'
import { actions, type Actions } from './actions'
import { flushNow, getData, initStore, resetStoreForTests } from './appStore'

let seq = 0
let p: Persistence

async function start(data: AppData = emptyData()): Promise<void> {
  p = createPersistence(`actions-items-${++seq}-${Math.random().toString(36).slice(2)}`)
  // 送り終えた状態（送信待ち無し）から始める
  await p.save(emptyData(), data)
  await p.completeUpload((await p.readOutbox(10_000)).map((it) => ({ table: it.table, id: it.id, record: it.local })))
  await initStore(p)
}

/** 新しい版が足した値を持つ記録（今の版は kind を仕事、label をラベルなしとして出す） */
const future = {
  ...mkItem({ title: '家族の予定', start: '2026-11-10', due: '2026-11-12', startTime: '10:00', endTime: '15:00' }),
  kind: 'family',
  label: 'new-color',
  extra: { x: 1 },
} as unknown as Item

const rawItem = async (id: string) => (await p.load()).items[id] as unknown as Record<string, unknown>

beforeEach(() => {
  resetStoreForTests()
  localStorage.clear()
})

afterEach(() => {
  p?.close()
  resetStoreForTests()
})

describe('知らない値は actions の操作で消えない（形3・ITEMS-037）', () => {
  it('updateItem: 件名を直しても kind・label・知らない項目は raw のまま', async () => {
    await start(dataWith({ items: [future] }))
    expect(getData().items.i1).toMatchObject({ kind: 'work', label: null })
    expect(actions.updateItem('i1', { title: '直した件名' })).toEqual({ relisted: false })
    expect(await flushNow()).toBe(true)
    expect(await rawItem('i1')).toMatchObject({ title: '直した件名', kind: 'family', label: 'new-color', extra: { x: 1 } })
  })

  it('moveItemDates・restoreItemDates: 日付だけが変わり、戻すと元の日付に戻る（知らない値はどちらでも残る）', async () => {
    await start(dataWith({ items: [future] }))
    const prev = actions.moveItemDates('i1', { start: '2026-11-11', due: '2026-11-12', clearEnd: false })
    expect(prev).toEqual({ start: '2026-11-10', due: '2026-11-12', endTime: '15:00' })
    await flushNow()
    expect(await rawItem('i1')).toMatchObject({
      start: '2026-11-11',
      due: '2026-11-12',
      startTime: '10:00',
      endTime: '15:00',
      kind: 'family',
      label: 'new-color',
      extra: { x: 1 },
    })
    actions.restoreItemDates('i1', prev)
    await flushNow()
    expect(await rawItem('i1')).toMatchObject({ start: '2026-11-10', due: '2026-11-12', kind: 'family', extra: { x: 1 } })
    expect((await p.readOutbox(10)).map((r) => r.k)).toEqual(['items/i1'])
  })

  it('duplicateItem: 元の raw は変えず、新しい記録は今の版の形で作る（知らない項目は写さない）', async () => {
    await start(dataWith({ items: [future] }))
    const before = await rawItem('i1')
    const id = actions.duplicateItem('i1', { start: '2026-11-17', due: '2026-11-19' })
    await flushNow()
    expect(await rawItem('i1')).toEqual(before)
    const dup = await rawItem(id)
    expect(dup).toMatchObject({ kind: 'work', label: null, start: '2026-11-17', due: '2026-11-19', by: 'user', done: false })
    expect(dup).not.toHaveProperty('extra')
    expect((await p.readOutbox(10)).map((r) => r.k)).toEqual([`items/${id}`])
  })

  it('知らない kind は、詳細で区分を選んだ時だけその値を書く（ITEMS-039）', async () => {
    await start(dataWith({ items: [future] }))
    actions.updateItem('i1', { memo: 'メモだけ' })
    await flushNow()
    expect((await rawItem('i1')).kind).toBe('family')
    actions.updateItem('i1', { kind: 'private' })
    await flushNow()
    expect(await rawItem('i1')).toMatchObject({ kind: 'private', label: 'new-color', extra: { x: 1 } })
  })
})

describe('断る時は DomainError（画面は attempt で受けてお知らせにする）', () => {
  it('ゴミ箱へ移した予定の［元に戻す］は UNDO_REFUSED、ロック中は動かせない', async () => {
    await start(dataWith({ items: [mkItem({ id: 'a' }), mkItem({ id: 'b', locked: true })] }))
    const prev = actions.moveItemDates('a', { start: '2026-11-12', due: null, clearEnd: false })
    await actions.trashItem('a')
    expect(() => actions.restoreItemDates('a', prev)).toThrow(UNDO_REFUSED)
    expect(() => actions.moveItemDates('b', { start: '2026-11-12', due: null, clearEnd: false })).toThrow(DomainError)
    expect(getData().items.b.start).toBe('2026-11-10')
  })

  it('Actions の型は actions と同じ（E2E の __ds の型に使う）', () => {
    const typed: Actions = actions
    expect(typeof typed.moveItemDates).toBe('function')
    expect(typeof typed.restoreItemDates).toBe('function')
    expect(typeof typed.duplicateItem).toBe('function')
  })
})
