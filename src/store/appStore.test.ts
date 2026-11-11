// アプリ全体のデータ（docs/SPEC.md の 6.12・6.13・19.5。NS の appStore.test の DS 版）: 保存（形3: raw に、変えた項目と日付・時刻の
// 並びの直しだけを重ねる）、回復の控え、別のタブの変更の重ね方、受け取り箱の当て方のまとまりが保存に渡ること、復元で MIM を残すこと
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createPersistence, type Persistence } from '../db/persistence'
import * as O from '../domain/ops'
import { dataWith, mkInbox, mkItem, mkMim, mkTask } from '../domain/testData'
import { emptyData, type AppData, type Item } from '../domain/types'
import { actions } from './actions'
import {
  applyRemoteChanges,
  commit,
  commitRaw,
  flushNow,
  getData,
  getRaw,
  initStore,
  rebaseView,
  replaceAllData,
  resetStoreForTests,
  useApp,
  writeRecoveryJournal,
} from './appStore'

let seq = 0
let p: Persistence

async function start(data: AppData = emptyData()): Promise<void> {
  p = createPersistence(`store-${++seq}-${Math.random().toString(36).slice(2)}`)
  // 送り終えた状態（送信待ち無し）から始める
  await p.save(emptyData(), data)
  await p.completeUpload((await p.readOutbox(10_000)).map((it) => ({ table: it.table, id: it.id, record: it.local })))
  await initStore(p)
}

beforeEach(() => {
  resetStoreForTests()
  localStorage.clear()
})

afterEach(() => {
  p?.close()
  resetStoreForTests()
})

describe('保存（形3）', () => {
  it('知らない値（新しい版が足した kind・label・項目）は、件名を直して保存しても raw に残る', async () => {
    const future = { ...mkItem({ title: '家族の予定' }), kind: 'family', label: 'new-color', extra: { x: 1 } } as unknown as Item
    await start(dataWith({ items: [future] }))
    // 表示では直す
    expect(getData().items.i1.kind).toBe('work')
    expect(getData().items.i1.label).toBeNull()
    commit(O.updateItem(getData(), 'i1', { title: '直した件名' }).data)
    expect(await flushNow()).toBe(true)
    const stored = (await p.load()).items.i1 as unknown as Record<string, unknown>
    expect(stored).toMatchObject({ title: '直した件名', kind: 'family', label: 'new-color', extra: { x: 1 } })
  })

  it('日付と時刻の並びの直しだけは書き戻す（start > due の list 生まれは start を消す）', async () => {
    const broken = mkTask({ start: '2026-11-20', due: '2026-11-10', listed: false })
    await start(dataWith({ items: [broken] }))
    commit(O.updateItem(getData(), 't1', { title: '直した' }).data)
    await flushNow()
    expect((await p.load()).items.t1).toMatchObject({ title: '直した', start: null, due: '2026-11-10' })
  })

  it('直していない記録は書かない（表示用の直しは書き戻さない）', async () => {
    const odd = { ...mkItem({ id: 'odd' }), kind: 'family' } as unknown as Item
    await start(dataWith({ items: [odd, mkItem({ id: 'other' })] }))
    commit(O.updateItem(getData(), 'other', { title: '別の予定' }).data)
    await flushNow()
    expect(((await p.load()).items.odd as unknown as { kind: string }).kind).toBe('family')
    expect((await p.readOutbox(10)).map((r) => r.k)).toEqual(['items/other'])
  })
})

describe('受け取り箱の当て方（commitRaw）', () => {
  it('raw に当て、依頼ごとのまとまりを送信待ちに付ける', async () => {
    const req = mkInbox({ id: 'xa-1', op: 'add', table: 'items', targetId: 'ce-1' })
    await start(dataWith({ inbox: [req] }))
    await commitRaw((raw) => {
      const data = {
        ...raw,
        items: { ...raw.items, 'ce-1': mkItem({ id: 'ce-1', by: 'connector', ai: 'claude' }) },
        inbox: { ...raw.inbox, 'xa-1': { ...req, status: 'applied' as const } },
      }
      return { data, groups: new Map([['xa-1', ['items/ce-1', 'inbox/xa-1']]]) }
    })
    expect(getData().items['ce-1']).toBeDefined()
    expect(getRaw().inbox['xa-1'].status).toBe('applied')
    const rows = await p.readOutbox(10)
    expect(rows.filter((r) => r.k === 'items/ce-1' || r.k === 'inbox/xa-1').every((r) => r.group === 'xa-1')).toBe(true)
  })

  it('先にこのタブの未保存の編集を保存してから当てる', async () => {
    await start()
    commit(O.addFavorite(getData(), '先の編集').data)
    await commitRaw((raw) => ({ data: raw }))
    expect(Object.values((await p.load()).favorites).map((f) => f.text)).toEqual(['先の編集'])
  })

  it('このタブの raw が古くても（ほかのタブが書いた後）、端末の中を読み直してから当てる', async () => {
    await start(dataWith({ items: [mkItem({ title: '古い件名' })] }))
    // ほかのタブ（同期を受け持つタブ）が新しい版を書いた。このタブには知らせが届いていない
    const disk = await p.load()
    await p.save(disk, { ...disk, items: { i1: { ...disk.items.i1, title: '新しい件名', updatedAt: Date.now() } } })
    expect(getRaw().items.i1.title).toBe('古い件名')
    let seen = ''
    await commitRaw((raw) => {
      seen = raw.items.i1.title
      return { data: raw }
    })
    expect(seen).toBe('新しい件名')
    expect(getData().items.i1.title).toBe('新しい件名')
    // ゴミ箱へ移すと、新しい版が1件だけ入る（古い版との競合の控えを作らない）
    const entryId = await actions.trashItem('i1')
    const trash = await p.load()
    expect(Object.keys(trash.trashEntries)).toEqual([entryId])
    expect(trash.trashEntries[entryId].label).toBe('新しい件名')
  })
})

describe('ゴミ箱の出し入れ（6.15・形3: raw の記録に当てる）', () => {
  it('知らない値のある予定をゴミ箱へ移して戻しても、知らない値（kind・項目）が残る', async () => {
    const future = { ...mkItem({ title: '家族の予定' }), kind: 'family', extra: { x: 1 } } as unknown as Item
    await start(dataWith({ items: [future] }))
    expect(getData().items.i1.kind).toBe('work')
    const entryId = await actions.trashItem('i1')
    expect(getData().items.i1).toBeUndefined()
    // ゴミ箱の中身は、表示用に直す前の記録
    const inTrash = Object.values((await p.load()).trashRecords).find((r) => r.entryId === entryId)
    expect(inTrash?.record).toMatchObject({ id: 'i1', kind: 'family', extra: { x: 1 } })
    const restored = await actions.restoreTrashEntry(entryId)
    expect(restored.id).toBe('i1')
    expect(getData().items.i1).toMatchObject({ title: '家族の予定', kind: 'work' })
    expect((await p.load()).items.i1 as unknown as Record<string, unknown>).toMatchObject({ kind: 'family', extra: { x: 1 } })
    expect(Object.keys((await p.load()).trashEntries)).toEqual([])
  })

  it('先にこのタブの未保存の編集を保存してから移す（直した件名がゴミ箱に入る）', async () => {
    await start(dataWith({ items: [mkItem({ title: '元の件名' })] }))
    commit(O.updateItem(getData(), 'i1', { title: '直した件名' }).data)
    const entryId = await actions.trashItem('i1')
    expect(getRaw().trashEntries[entryId].label).toBe('直した件名')
    await actions.emptyTrash()
    expect(Object.keys((await p.load()).trashRecords)).toEqual([])
  })
})

describe('別の端末の変更', () => {
  it('反映すると表示にも重なり、このタブの未保存の編集は残る', async () => {
    await start(dataWith({ items: [mkItem({ title: '会議' })] }))
    commit(O.updateItem(getData(), 'i1', { memo: 'このタブ' }).data)
    const remote = { ...getRaw().items.i1, requester: '山田', updatedAt: Date.now() }
    await applyRemoteChanges([{ table: 'items', id: 'i1', record: remote }])
    expect(getData().items.i1).toMatchObject({ memo: 'このタブ', requester: '山田' })
    await flushNow()
    expect((await p.load()).items.i1).toMatchObject({ memo: 'このタブ', requester: '山田' })
  })

  it('保存の途中に直した予定がほかのタブで消されていても、ゴミ箱の控えは表示用に直す前の記録（知らない値が残る。形3）', async () => {
    const name = `store-rebase-${++seq}-${Math.random().toString(36).slice(2)}`
    p = createPersistence(name)
    const future = { ...mkItem({ title: '家族の予定' }), kind: 'family', label: 'new-color', extra: { x: 1 } } as unknown as Item
    await p.save(emptyData(), dataWith({ items: [future] }))
    await p.completeUpload((await p.readOutbox(100)).map((it) => ({ table: it.table, id: it.id, record: it.local })))
    await initStore(p)
    // ほかのタブがこの予定を消した（このタブには知らせが届いていない）
    const other = createPersistence(name)
    const disk = await other.load()
    await other.save(disk, { ...disk, items: {} })
    other.close()
    // このタブで直して保存を始め、保存の途中にもう一度直す
    commit(O.updateItem(getData(), 'i1', { memo: '1回目' }).data)
    const saving = flushNow()
    await Promise.resolve()
    commit(O.updateItem(getData(), 'i1', { memo: '2回目' }).data)
    await saving
    await flushNow()
    const copies = Object.values((await p.load()).trashRecords).map((r) => r.record as unknown as Record<string, unknown>)
    expect(copies.map((c) => c.memo).sort()).toEqual(['1回目', '2回目'])
    for (const c of copies) expect(c).toMatchObject({ kind: 'family', label: 'new-color', extra: { x: 1 } })
  })

  it('rebaseView: このタブで変えていない記録は新しい内容に置き換える', () => {
    const a = dataWith({ items: [mkItem({ title: 'A' })] })
    const b = dataWith({ items: [mkItem({ title: 'B' })] })
    expect(rebaseView(a, a, b)).toBe(b)
  })
})

describe('回復の控え（diary-studio:recovery:{タブ}）', () => {
  it('当て直す時は、その後にほかのタブ・ほかの端末が変えた項目を消さず、このタブで変えた項目だけを重ねる', async () => {
    await start(dataWith({ items: [mkItem({ title: '元', memo: '' })] }))
    commit(O.updateItem(getData(), 'i1', { title: '閉じる前の編集' }).data)
    writeRecoveryJournal()
    // 閉じた後に、ほかの端末がメモを直した（直した日時はこちらより新しい）
    const disk = await p.load()
    await p.save(disk, { ...disk, items: { i1: { ...disk.items.i1, memo: 'ほかの端末のメモ', updatedAt: Date.now() + 60_000 } } })
    const db = p
    resetStoreForTests()
    await initStore(db)
    expect(getData().items.i1).toMatchObject({ title: '閉じる前の編集', memo: 'ほかの端末のメモ' })
    await flushNow()
    expect((await db.load()).items.i1).toMatchObject({ title: '閉じる前の編集', memo: 'ほかの端末のメモ' })
  })

  it('保存が終わる前に閉じた編集を控え、次に開いた時に当て直す', async () => {
    await start(dataWith({ items: [mkItem({ title: '元' })] }))
    commit(O.updateItem(getData(), 'i1', { title: '閉じる前の編集' }).data)
    writeRecoveryJournal()
    const keys = Object.keys(localStorage).filter((k) => k.startsWith('diary-studio:recovery:'))
    expect(keys).toHaveLength(1)
    // 保存しないまま閉じた（同じ端末の DB で開き直す）
    const db = p
    resetStoreForTests()
    await initStore(db)
    expect(useApp.getState().recoveredCount).toBe(1)
    expect(getData().items.i1.title).toBe('閉じる前の編集')
    await flushNow()
    expect((await db.load()).items.i1.title).toBe('閉じる前の編集')
  })
})

describe('復元（6.16・形4）', () => {
  it('MIM を含まないファイルの時は、今の MIM を残し「必ず上書き」にしない', async () => {
    await start(dataWith({ mimNotes: [mkMim()], items: [mkItem()] }))
    await p.setMeta('uid', 'u')
    await replaceAllData(dataWith({ mimNotes: [mkMim()], items: [mkItem({ id: 'i2' })] }), {
      mimNotes: true,
      trashEntryIds: [],
      trashRecordIds: [],
    })
    const rows = await p.readOutbox(10)
    expect(rows.some((r) => r.table === 'mimNotes')).toBe(false)
    expect(rows.filter((r) => r.table === 'items').every((r) => r.force)).toBe(true)
    expect(Object.keys(getData().items)).toEqual(['i2'])
  })

  it('このタブの raw が古くても、ほかの端末で直した MIM と、当てた依頼の結果を、MIM を含まないファイルで戻さない', async () => {
    const req = mkInbox({ id: 'xa-1', op: 'add', table: 'items', targetId: 'ce-1' })
    await start(dataWith({ mimNotes: [mkMim({ title: '銀行', body: '古いパスワード' })], items: [mkItem()], inbox: [req] }))
    await p.setMeta('uid', 'u')
    const file = await actions.exportBackup({ includesMim: false, appVersion: '0.1' })
    // その後に、同期を受け持つタブが、ほかの端末の新しい MIM・直した MIM・当てた依頼の結果を書いた（このタブの raw は古いまま）
    const disk = await p.load()
    await p.save(disk, {
      ...disk,
      mimNotes: {
        m1: { ...disk.mimNotes.m1, body: '新しいパスワード', updatedAt: Date.now() },
        m2: mkMim({ id: 'm2', title: 'カード' }),
      },
      inbox: { 'xa-1': { ...req, status: 'applied', appliedAt: 5, undo: { created: true, afterHash: 'h' } } },
    })
    expect(getRaw().mimNotes.m1.body).toBe('古いパスワード')
    await actions.importBackup(file)
    const after = await p.load()
    expect(after.mimNotes.m1.body).toBe('新しいパスワード')
    expect(after.mimNotes.m2).toBeDefined()
    expect(after.inbox['xa-1'].status).toBe('applied')
    // MIM と受け取り箱は送信待ちに積まない（ほかの端末の内容を、古い内容で上書きして送らない）
    const rows = await p.readOutbox(100)
    expect(rows.filter((r) => r.table === 'mimNotes' || r.table === 'inbox').every((r) => !r.force)).toBe(true)
    expect(getRaw().mimNotes.m1.body).toBe('新しいパスワード')
  })

  it('書き出しは、このタブの変更を保存してから、端末の中の今の記録で作る', async () => {
    await start(dataWith({ items: [mkItem({ title: '古い' })] }))
    const disk = await p.load()
    await p.save(disk, { ...disk, items: { ...disk.items, i9: mkItem({ id: 'i9', title: 'ほかのタブで足した' }) } })
    commit(O.updateItem(getData(), 'i1', { title: 'このタブで直した' }).data)
    const file = JSON.parse(await actions.exportBackup({ includesMim: true, appVersion: '0.1' }))
    expect(file.tables.items.i1.title).toBe('このタブで直した')
    expect(file.tables.items.i9.title).toBe('ほかのタブで足した')
  })
})
