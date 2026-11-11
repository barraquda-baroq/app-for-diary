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

  // 書き込みは届いたが返事が無く、ほかの端末がその書き込みの上に書いた（題名を戻し、メモに足した）。送る書き込みの印でその書き込みが
  // 届いていたと分かるので、送った内容を base にして合わせる（古い base で合わせると、題名が戻らず、メモが二重につながる）
  for (const order of ['受け取ってから送る', 'もう一度直して送ってから受け取る'] as const) {
    it(`その上にほかの端末が書いた版を、送った内容を base にして合わせる（${order}）`, async () => {
      const { a, b } = await pair()
      let id = ''
      await a.edit((d) => {
        const r = O.addItem(d, { origin: 'calendar', title: '元の題名', start: '2026-12-01' })
        id = r.result
        return r.data
      })
      await settle(a, b)
      await a.edit((d) => O.updateItem(d, id, { title: 'Aの題名', memo: 'Aが書いた' }).data)
      await a.uploadBatch({ replyLost: true })
      // B は A の書き込みを受け取り、題名を戻して、メモに足した
      await b.sync()
      expect((await b.load()).items[id].title).toBe('Aの題名')
      await b.edit((d) => O.updateItem(d, id, { title: '元の題名', memo: 'Aが書いた\nBが足した' }).data)
      await b.sync()
      // A が戻る（A の書き込みはクラウドで B の版に置き換わっていて、A の版の通知は届かない）
      a.offline()
      if (order === 'もう一度直して送ってから受け取る') {
        await a.edit((d) => O.updateItem(d, id, { requester: 'A社' }).data)
        await a.uploadBatch()
      } else await a.receive()
      await settle(a, b)
      expect(await sameData(a, b)).toBe(true)
      const got = (await b.load()).items[id]
      expect(got.title).toBe('元の題名')
      expect(got.memo).toBe('Aが書いた\nBが足した')
      expect(got.requester).toBe(order === 'もう一度直して送ってから受け取る' ? 'A社' : '')
      expect(a.notes).toEqual([])
      expect(Object.keys((await a.load()).trashEntries)).toEqual([])
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
  // createdAt と updatedAt は同じ値にする（pending の依頼で違うと invalid。19.5 の初めの確かめ）。Date.now() を2回呼ぶと、ミリ秒が
  // 変わった時だけ食い違って落ちる
  const now = Date.now()
  const req = mkInbox({
    id: 'xa-1',
    op: 'add',
    table: 'items',
    targetId: itemId,
    patch,
    sourceKey: '<m@x>',
    via: 'メール',
    createdAt: now,
    updatedAt: now,
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
