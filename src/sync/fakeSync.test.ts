// 仮のクラウド（src/test/fakeCloud.ts。エンジンと同じ規則で送受信する）で確かめる同期の場面（docs/SPEC.md の 2.10・6.10・6.16・19.5）。
// エミュレーター無しで速く回す: 返事を受け取れなかった書き込みの後に消した物が生き返らない、復元がほかの端末に当たる（MIM を含まない
// 復元は、ほかの端末の MIM を上書きしない）、受け取り箱の依頼を2台で当てても1回分（まとまりは全部か無し）
import { describe, expect, it } from 'vitest'
import { backupJson, parseBackup, restoreData } from '../domain/backup'
import { derivedItemId } from '../domain/derivedId'
import { processInbox } from '../domain/inbox'
import * as O from '../domain/ops'
import { mkInbox } from '../domain/testData'
import type { AppData, MimNote } from '../domain/types'
import { FakeCloud, FakeDevice, sameData, settle } from '../test/fakeCloud'

async function pair() {
  const cloud = new FakeCloud()
  const a = new FakeDevice('A', cloud)
  const b = new FakeDevice('B', cloud)
  return { cloud, a, b }
}

const without = (d: AppData, table: 'favorites' | 'items', id: string): AppData => {
  const rows = { ...d[table] } as Record<string, unknown>
  delete rows[id]
  return { ...d, [table]: rows }
}

describe('返事を受け取れなかった書き込み', () => {
  for (const order of ['消したことを先に送る', '自分の書き込みの通知が先に届く'] as const) {
    it(`その後にオフラインのまま消しても、クラウドに残った版で生き返らない（${order}）`, async () => {
      const { cloud, a, b } = await pair()
      let id = ''
      await a.edit((d) => {
        const r = O.addFavorite(d, '足した')
        id = r.result
        return r.data
      })
      await a.uploadBatch({ replyLost: true })
      await b.sync()
      a.offline()
      await a.edit((d) => without(d, 'favorites', id))
      if (order === '消したことを先に送る') await a.uploadBatch()
      else await a.receive()
      await settle(a, b)
      expect(await sameData(a, b)).toBe(true)
      expect((await b.load()).favorites[id]).toBeUndefined()
      expect(cloud.docs.get(`favorites:${id}`)?.record).toBeNull()
    })
  }
})

describe('復元', () => {
  it('ほかの端末にも当たり、この端末が受け取っていない記録も消える。受け取り箱は消さない', async () => {
    const { cloud, a, b } = await pair()
    await a.edit((d) => O.addFavorite(d, '残す').data)
    await settle(a, b)
    const backup = parseBackup(backupJson(await a.load(), { includesMim: true, appVersion: '0.1' }))
    let laterId = ''
    await b.edit((d) => {
      const r = O.addFavorite(d, '後で足した')
      laterId = r.result
      return r.data
    })
    await settle(b)
    cloud.put('inbox', mkInbox({ id: 'xa-keep', op: 'add', table: 'items', targetId: 'ce-x' }))
    const r = restoreData(await a.load(), backup)
    await a.restore(r.data)
    await settle(a, b)
    const d = await b.load()
    expect(Object.values(d.favorites).map((f) => f.text)).toEqual(['残す'])
    expect(d.favorites[laterId]).toBeUndefined()
    expect(d.inbox['xa-keep']).toBeDefined()
  })

  it('MIM を含まないファイルの復元は、ほかの端末で直した MIM を上書きしない（形4）', async () => {
    const { a, b } = await pair()
    let mimId = ''
    await a.edit((d) => {
      const m = O.addMimNote(d, { title: 'Wi-Fi' })
      mimId = m.result
      return O.updateMimNote(m.data, mimId, { secrets: [{ id: 's', name: 'pw', value: '古い' }] })
    })
    await settle(a, b)
    const json = backupJson(await a.load(), { includesMim: false, appVersion: '0.1' })
    await b.edit((d) => O.updateMimNote(d, mimId, { secrets: [{ id: 's', name: 'pw', value: '新しい' }] }))
    await settle(b)
    const r = restoreData(await a.load(), parseBackup(json))
    await a.restore(r.data, {
      tables: ['mimNotes'],
      keys: [...r.keep.trashEntryIds.map((x) => `trashEntries/${x}`), ...r.keep.trashRecordIds.map((x) => `trashRecords/${x}`)],
      keepMimTrash: true,
    })
    await settle(a, b)
    for (const dev of [a, b]) expect(((await dev.load()).mimNotes[mimId] as MimNote).secrets[0].value).toBe('新しい')
  })
})

describe('受け取り箱の依頼を2台で当てる（19.5）', () => {
  const patch = { origin: 'calendar', kind: 'work', title: '打ち合わせ', start: '2026-12-03' }
  const itemId = derivedItemId(patch as never, '<m@x>')
  const req = mkInbox({
    id: 'xa-1',
    op: 'add',
    table: 'items',
    targetId: itemId,
    patch,
    sourceKey: '<m@x>',
    via: 'メール',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  })

  it('同時に当てても予定は1件、依頼は applied（記録と依頼は1つのまとまりで届く）', async () => {
    const { cloud, a, b } = await pair()
    cloud.put('inbox', req)
    await a.receive()
    await b.receive()
    await a.inbox((d, ctx) => processInbox(d, ctx))
    await b.inbox((d, ctx) => processInbox(d, ctx))
    // A が先に送る。B のまとまり（予定と依頼）は、依頼が先に変わっていたので1つも書かない
    await a.sync()
    const before = cloud.ts
    const r = await b.uploadBatch()
    expect(r.progressed).toBe(0)
    expect(cloud.ts).toBe(before + 1)
    expect(cloud.log[cloud.log.length - 1]).toContain('書いた  |')
    await settle(a, b)
    const d = await b.load()
    expect(Object.keys(d.items)).toEqual([itemId])
    expect(d.inbox['xa-1'].status).toBe('applied')
    expect(await sameData(a, b)).toBe(true)
    expect(a.notes).toEqual([])
    expect(b.notes).toEqual([])
  })
})
