// 端末の中の保存（docs/SPEC.md の 2.4・6.1・6.10・6.11・6.16・19.5。fake-indexeddb）: Dexie v1 の表の一覧、別のタブとの3者マージ、
// 送信待ち（送る順・受け取り箱の依頼ごとのまとまり g）、反映（3者マージ・自分の書き込みの返事・ほかの端末の復元・消えた親の子の片付け）、
// _gone（内容から作った id の削除の印）・_pack（月の束）、復元で残す物、全部を受け取り直した時の片付け
import { describe, expect, it } from 'vitest'
import { emptyData, type AppData, type InboxRecord } from '../domain/types'
import { dataWith, mkCheck, mkFavorite, mkInbox, mkItem, mkMim, mkOffDay, mkRoutine } from '../domain/testData'
import { revOf } from '../domain/hash'
import { createConflictHooks } from '../sync/conflicts'
import {
  SEND_ORDER,
  V1_SCHEMA,
  createPersistence,
  type AnyRecord,
  type Change,
  type ConflictNote,
  type Persistence,
} from './persistence'

let seq = 0
const fresh = () => createPersistence(`test-${++seq}-${Math.random().toString(36).slice(2)}`)

function hooks(notes: ConflictNote[] = [], data: AppData = emptyData()) {
  let n = 0
  return createConflictHooks({ device: 'テスト', data: () => data, newId: () => `c${++n}`, report: (x) => notes.push(x) })
}

const put = <T extends keyof AppData>(d: AppData, table: T, rec: AppData[T][string]): AppData => ({
  ...d,
  [table]: { ...d[table], [rec.id]: rec },
})

const remove = <T extends keyof AppData>(d: AppData, table: T, id: string): AppData => {
  const rows = { ...d[table] } as Record<string, unknown>
  delete rows[id]
  return { ...d, [table]: rows }
}

/** 保存して、送り終えた状態（送信待ち無し）にする */
async function seed(p: Persistence, data: AppData): Promise<void> {
  await p.save(emptyData(), data)
  const sent: Change[] = []
  for (const it of await p.readOutbox(10_000)) sent.push({ table: it.table, id: it.id, record: it.local })
  await p.completeUpload(sent)
}

describe('Dexie v1 の表', () => {
  it('表の一覧は固定（10表と、端末だけの _outbox・_meta・_gone・_pack）', () => {
    expect(V1_SCHEMA).toEqual({
      items: 'id',
      offDays: 'id',
      labelNames: 'id',
      routines: 'id',
      routineChecks: 'id',
      favorites: 'id',
      mimNotes: 'id',
      inbox: 'id',
      trashEntries: 'id',
      trashRecords: 'id',
      _outbox: 'k, g',
      _meta: 'key',
      _gone: 'k',
      _pack: 'id, month',
    })
  })
  it('送る順: ゴミ箱 → routineChecks → routines → … → inbox', () => {
    expect(SEND_ORDER).toEqual([
      'trashRecords',
      'trashEntries',
      'routineChecks',
      'routines',
      'items',
      'favorites',
      'mimNotes',
      'offDays',
      'labelNames',
      'inbox',
    ])
  })
})

describe('保存と送信待ち', () => {
  it('書いた記録は送信待ちに積まれ、送る順に並ぶ', async () => {
    const p = fresh()
    const data = dataWith({
      inbox: [mkInbox({ id: 'xa-1', op: 'add', table: 'items', targetId: 'ce-1' })],
      items: [mkItem()],
      offDays: [mkOffDay('2026-11-23')],
      routines: [mkRoutine()],
      routineChecks: [mkCheck('r1', '2026-11', ['2026-11-10'])],
      favorites: [mkFavorite()],
      mimNotes: [mkMim()],
    })
    await p.save(emptyData(), data)
    const rows = await p.readOutbox(100)
    expect(rows.map((r) => r.table)).toEqual(['routineChecks', 'routines', 'items', 'favorites', 'mimNotes', 'offDays', 'inbox'])
    expect(rows.every((r) => r.base === null)).toBe(true)
    expect(await p.outboxCount()).toBe(7)
  })

  it('別のタブが先に書き換えていた記録は、このタブが変えた項目だけを重ねる', async () => {
    const p = fresh()
    const base = dataWith({ items: [mkItem({ title: '会議', memo: '元' })] })
    await seed(p, base)
    // 別のタブがメモを直した
    await p.save(base, put(base, 'items', { ...base.items.i1, memo: '別のタブ' }))
    // このタブは古い表示のまま件名を直した
    const out = await p.save(base, put(base, 'items', { ...base.items.i1, title: 'このタブ' }), hooks())
    expect(out.merged.items?.length).toBe(1)
    expect((await p.load()).items.i1).toMatchObject({ title: 'このタブ', memo: '別のタブ' })
  })

  it('このタブが新しく作ったつもりの記録が保存先にもうあったら（id の決まった表）、丸ごと置き換えずに合わせる', async () => {
    const p = fresh()
    const base = dataWith({ routines: [mkRoutine()] })
    await seed(p, base)
    // ほかのタブ（ほかの端末）が先に 11/09 のチェックの記録を作った
    await p.save(base, put(base, 'routineChecks', mkCheck('r1', '2026-11', ['2026-11-09'])))
    // このタブは古い表示のまま 11/10 にチェックした（同じ id の記録を新しく作るつもり）
    const outcome = await p.save(base, put(base, 'routineChecks', mkCheck('r1', '2026-11', ['2026-11-10'])), hooks())
    const id = Object.keys((await p.load()).routineChecks)[0]
    expect((await p.load()).routineChecks[id].dates).toEqual(['2026-11-09', '2026-11-10'])
    expect(outcome.merged.routineChecks?.[0]).toMatchObject({ dates: ['2026-11-09', '2026-11-10'] })
  })

  it('別のタブで消された記録への編集は、戻さずにゴミ箱に控える', async () => {
    const p = fresh()
    const base = dataWith({ favorites: [mkFavorite({ text: '元' })] })
    await seed(p, base)
    await p.save(base, remove(base, 'favorites', 'f1'))
    const notes: ConflictNote[] = []
    const out = await p.save(base, put(base, 'favorites', { ...base.favorites.f1, text: '直した' }), hooks(notes))
    expect(out.dropped.favorites).toEqual(['f1'])
    const d = await p.load()
    expect(d.favorites.f1).toBeUndefined()
    const kept = Object.values(d.trashRecords).map((r) => r.record as { text?: string })
    expect(kept.map((r) => r.text)).toEqual(['直した'])
    expect(notes.map((n) => n.kind)).toEqual(['trash'])
  })
})

describe('受け取り箱の依頼ごとのまとまり（g。19.5）', () => {
  const req = mkInbox({ id: 'xa-1', op: 'add', table: 'items', targetId: 'ce-1' })
  const applied: InboxRecord = { ...req, status: 'applied', appliedAt: 5, undo: { created: true, afterHash: 'h' } }

  it('まとまりは続けて並び（中の受け取り箱が最後）、上限で切らない', async () => {
    const p = fresh()
    const base = dataWith({ inbox: [req], favorites: [mkFavorite({ id: 'a' }), mkFavorite({ id: 'z' })] })
    await seed(p, base)
    const next = put(
      put(put(base, 'items', mkItem({ id: 'ce-1' })), 'inbox', applied),
      'favorites',
      mkFavorite({ id: 'z', text: '直した' }),
    )
    await p.save(base, next, hooks(), { groups: new Map([['xa-1', ['items/ce-1', 'inbox/xa-1']]]) })
    const rows = await p.readOutbox(1)
    expect(rows.map((r) => [r.k, r.group ?? null])).toEqual([
      ['items/ce-1', 'xa-1'],
      ['inbox/xa-1', 'xa-1'],
    ])
    expect((await p.readOutbox(10)).map((r) => r.k)).toEqual(['items/ce-1', 'inbox/xa-1', 'favorites/z'])
  })

  it('反映・送った後・返事待ちの印を付けても g が残る', async () => {
    const p = fresh()
    const base = dataWith({ inbox: [req] })
    await seed(p, base)
    const next = put(put(base, 'items', mkItem({ id: 'ce-1' })), 'inbox', applied)
    await p.save(base, next, hooks(), { groups: new Map([['xa-1', ['items/ce-1', 'inbox/xa-1']]]) })
    await p.markUnconfirmed([{ key: 'inbox/xa-1', record: applied as AnyRecord }], 'tx-1')
    // クラウドの受け取り箱が先に変わっていた（別の端末が当てた）: 3者マージしても、まとまりの印は残る
    await p.applyRemote([{ table: 'inbox', id: 'xa-1', record: { ...applied, appliedAt: 9 } as AnyRecord }], hooks())
    // 送った後に端末で変わった（completeUpload は base を書き直して残す）
    await p.completeUpload([{ table: 'items', id: 'ce-1', record: { ...mkItem({ id: 'ce-1' }), title: '前の版' } as AnyRecord }])
    const rows = await p.readOutbox(10)
    expect(rows.map((r) => [r.k, r.group])).toEqual([
      ['items/ce-1', 'xa-1'],
      ['inbox/xa-1', 'xa-1'],
    ])
    expect(rows.find((r) => r.k === 'inbox/xa-1')?.unconfirmed).toBeUndefined()
  })

  it('2つの依頼が同じ記録を書いたら、2つのまとまりを1つにつなぐ', async () => {
    const p = fresh()
    const r2 = mkInbox({ id: 'xe-2', op: 'update', table: 'items', targetId: 'ce-1' })
    const base = dataWith({ inbox: [req, r2] })
    await seed(p, base)
    const s1 = put(put(base, 'items', mkItem({ id: 'ce-1' })), 'inbox', applied)
    await p.save(base, s1, hooks(), { groups: new Map([['xa-1', ['items/ce-1', 'inbox/xa-1']]]) })
    const s2 = put(put(s1, 'items', mkItem({ id: 'ce-1', title: '直した' })), 'inbox', { ...r2, status: 'applied' as const })
    await p.save(s1, s2, hooks(), { groups: new Map([['xe-2', ['items/ce-1', 'inbox/xe-2']]]) })
    const groups = new Set((await p.readOutbox(10)).map((r) => r.group))
    expect([...groups]).toEqual(['xe-2'])
  })
})

describe('依頼で書いてまだ送っていない記録の反映（2台で当てても1回分・previously_deleted。19.5）', () => {
  const ID = 'ce-a.b.1'
  const created = mkItem({ id: ID, title: 'Claude の予定', by: 'connector', ai: 'claude' })
  const req = mkInbox({ id: 'xa-1', op: 'add', table: 'items', targetId: ID })
  const applied = (at: number): InboxRecord => ({
    ...req,
    status: 'applied',
    appliedAt: at,
    updatedAt: at,
    undo: { created: true, afterHash: revOf(created) },
  })

  /** 足す依頼を当てて、まだ送っていない端末（受け取り箱の依頼は「待っています」でクラウドと揃っている） */
  async function appliedOffline(): Promise<{ p: Persistence; after: AppData }> {
    const p = fresh()
    const base = dataWith({ inbox: [req] })
    await seed(p, base)
    const after = put(put(base, 'items', created), 'inbox', applied(10))
    await p.save(base, after, hooks(), { groups: new Map([['xa-1', [`items/${ID}`, 'inbox/xa-1']]]) })
    return { p, after }
  }

  it('ほかの端末が当ててから消した記録は、生き返らせない（ゴミ箱にも控えない）', async () => {
    const { p } = await appliedOffline()
    const notes: ConflictNote[] = []
    await p.applyRemote(
      [
        { table: 'inbox', id: 'xa-1', record: applied(20) as AnyRecord },
        { table: 'items', id: ID, record: null },
      ],
      hooks(notes),
    )
    const d = await p.load()
    expect(d.items[ID]).toBeUndefined()
    expect(d.trashEntries).toEqual({})
    expect(notes).toEqual([])
    // 送信待ちに残るのは受け取り箱の記録だけ（記録を書き戻さない）
    expect((await p.readOutbox(10)).map((r) => r.k)).toEqual(['inbox/xa-1'])
  })

  it('受け取り箱がまだ届いていなくても、内容から作った id の削除の印が届いたら削除を採る。当てた後に直した内容はゴミ箱に控える', async () => {
    const { p, after } = await appliedOffline()
    await p.save(after, put(after, 'items', { ...created, memo: 'この端末で書き足した' }), hooks())
    const notes: ConflictNote[] = []
    await p.applyRemote([{ table: 'items', id: ID, record: null }], hooks(notes))
    const d = await p.load()
    expect(d.items[ID]).toBeUndefined()
    expect(Object.values(d.trashRecords).map((r) => (r.record as { memo?: string }).memo)).toEqual(['この端末で書き足した'])
    expect((await p.readOutbox(10)).some((r) => r.k === `items/${ID}`)).toBe(false)
  })

  it('ほかの端末が同じ依頼で作った記録が届き、その後に手で直されていた: クラウドの内容を採り、この端末の当てた結果は送らない', async () => {
    const { p } = await appliedOffline()
    const edited = { ...created, title: 'ほかの端末で直した', updatedAt: 30 }
    await p.applyRemote(
      [
        { table: 'inbox', id: 'xa-1', record: applied(20) as AnyRecord },
        { table: 'items', id: ID, record: edited },
      ],
      hooks(),
    )
    expect((await p.load()).items[ID].title).toBe('ほかの端末で直した')
    expect((await p.readOutbox(10)).map((r) => r.k)).toEqual(['inbox/xa-1'])
  })

  it('この端末で作ってすぐ消した記録は、ほかの端末が同じ依頼で作った記録が届いても戻さず、削除を送る', async () => {
    const { p, after } = await appliedOffline()
    await p.save(after, remove(after, 'items', ID), hooks())
    await p.applyRemote(
      [
        { table: 'inbox', id: 'xa-1', record: applied(20) as AnyRecord },
        { table: 'items', id: ID, record: { ...created, updatedAt: 20 } },
      ],
      hooks(),
    )
    const d = await p.load()
    expect(d.items[ID]).toBeUndefined()
    // 中身は同じなので控えない
    expect(d.trashEntries).toEqual({})
    const row = (await p.readOutbox(10)).find((r) => r.k === `items/${ID}`)!
    expect(row).toMatchObject({ local: null, base: { id: ID, updatedAt: 20 }, group: 'xa-1' })
  })

  it('削除の印を知った後で戻した記録（ゴミ箱から戻す・元に戻す）は、同じ削除の印が届き直しても消さない', async () => {
    // Claude のゴミ箱への依頼を当てた（削除の印を受け取った）後に、［元に戻す］で戻した
    const trashReq = mkInbox({ id: 'xt-1', op: 'trash', table: 'items', targetId: ID, baseHash: revOf(created) })
    const trashed: InboxRecord = { ...trashReq, status: 'applied', appliedAt: 10, undo: { trashEntryId: 'te-xt-1' } }
    const p = fresh()
    const base = dataWith({ inbox: [trashed] })
    await seed(p, base)
    await p.applyRemote([{ table: 'items', id: ID, record: null }], hooks())
    const undone = put(put(base, 'items', created), 'inbox', { ...trashed, undoneAt: 20 })
    await p.save(base, undone, hooks(), { groups: new Map([['xt-1', [`items/${ID}`, 'inbox/xt-1']]]) })
    await p.applyRemote([{ table: 'items', id: ID, record: null }], hooks())
    expect((await p.load()).items[ID]).toBeDefined()
    expect((await p.readOutbox(10)).map((r) => r.k)).toEqual([`items/${ID}`, 'inbox/xt-1'])
  })
})

describe('反映（applyRemote）', () => {
  it('送信待ちのある記録は3者マージし、クラウドと同じになったら送信待ちを外す', async () => {
    const p = fresh()
    const base = dataWith({ items: [mkItem({ title: '会議' })] })
    await seed(p, base)
    await p.save(base, put(base, 'items', { ...base.items.i1, requester: '山田' }))
    await p.applyRemote([{ table: 'items', id: 'i1', record: { ...base.items.i1, label: 'sky-l' } as AnyRecord }], hooks())
    expect((await p.load()).items.i1).toMatchObject({ requester: '山田', label: 'sky-l' })
    expect((await p.readOutbox(10))[0].base).toMatchObject({ label: 'sky-l' })
    await p.applyRemote([{ table: 'items', id: 'i1', record: (await p.load()).items.i1 }], hooks())
    expect(await p.outboxCount()).toBe(0)
  })

  it('別の端末でルーチンが消されたら、この端末で付けたチェックの記録も片付ける（控えない）', async () => {
    const p = fresh()
    const base = dataWith({ routines: [mkRoutine()] })
    await seed(p, base)
    await p.save(base, put(base, 'routineChecks', mkCheck('r1', '2026-11', ['2026-11-10'])))
    await p.applyRemote([{ table: 'routines', id: 'r1', record: null }], hooks())
    const d = await p.load()
    expect(d.routines.r1).toBeUndefined()
    expect(d.routineChecks).toEqual({})
    expect(d.trashEntries).toEqual({})
  })

  it('自分の書き込みの返事（own）は base だけ進め、ほかの端末の復元（reset）はその内容を正とする', async () => {
    const p = fresh()
    const base = dataWith({ items: [mkItem({ memo: '元' })] })
    await seed(p, base)
    await p.save(base, put(base, 'items', { ...base.items.i1, memo: '新しい' }))
    await p.applyRemote(
      [{ table: 'items', id: 'i1', record: { ...base.items.i1, memo: '途中' } as AnyRecord, own: true }],
      hooks(),
    )
    expect((await p.load()).items.i1.memo).toBe('新しい')
    expect((await p.readOutbox(10))[0].base).toMatchObject({ memo: '途中' })
    const notes: ConflictNote[] = []
    await p.applyRemote(
      [{ table: 'items', id: 'i1', record: { ...base.items.i1, memo: '復元' } as AnyRecord, reset: true }],
      hooks(notes),
    )
    expect((await p.load()).items.i1.memo).toBe('復元')
    // 控え（ゴミ箱の件と中身）の送信待ちだけが残る
    expect((await p.readOutbox(10)).map((r) => r.table)).toEqual(['trashRecords', 'trashEntries'])
    expect(notes.map((n) => n.kind)).toEqual(['trash'])
  })

  it('この端末の復元をクラウドに当てるまでは反映しない', async () => {
    const p = fresh()
    await p.setMeta('uid', 'u')
    await p.replaceAll(dataWith({ items: [mkItem()] }))
    expect(await p.applyRemote([{ table: 'items', id: 'x', record: mkItem({ id: 'x' }) }], hooks())).toBeNull()
    expect((await p.load()).items.x).toBeUndefined()
  })

  it('内容から作った id の削除の印を受け取った・書いた時は _gone に控える（19.5）', async () => {
    const p = fresh()
    const base = dataWith({
      items: [mkItem({ id: 'ce-a.b.1' }), mkItem({ id: 'plain' })],
      favorites: [mkFavorite({ id: 'cf-x' })],
    })
    await seed(p, base)
    await p.applyRemote([{ table: 'items', id: 'ce-a.b.1', record: null }], hooks())
    await p.save(base, remove(base, 'favorites', 'cf-x'))
    await p.applyRemote([{ table: 'items', id: 'plain', record: null }], hooks())
    expect([...(await p.goneKeys())].sort()).toEqual(['favorites/cf-x', 'items/ce-a.b.1'])
    // 作ってすぐ消した内容から作った id も、削除の印を送る（送信待ちは base が null のまま残る）
    const rows = await p.readOutbox(10)
    expect(rows.map((r) => [r.k, r.base, r.local])).toEqual([['favorites/cf-x', expect.anything(), null]])
  })

  it('月の束の中の項目として届いたら _pack に覚え、個別の文書で届いたら外す（6.11）', async () => {
    const p = fresh()
    const it1 = mkItem({ id: 'a' })
    await p.applyRemote(
      [
        { table: 'items', id: 'a', record: it1, pack: '2025-03' },
        { table: 'items', id: 'b', record: mkItem({ id: 'b' }), pack: '2025-03' },
      ],
      hooks(),
    )
    expect([...(await p.packsOf())]).toEqual([
      ['a', '2025-03'],
      ['b', '2025-03'],
    ])
    await p.applyRemote([{ table: 'items', id: 'a', record: { ...it1, title: '束から出た' } as AnyRecord }], hooks())
    expect([...(await p.packsOf()).keys()]).toEqual(['b'])
    expect(await p.outboxCount()).toBe(0)
  })
})

describe('返事を受け取れなかった書き込み（送る書き込みの印。2.4）', () => {
  it('送る前に id と送る内容を覚え、届いていたと分かったら送った内容を base にする（その後に変わっていなければ送り終わり）', async () => {
    const p = fresh()
    const a = mkItem({ id: 'a', title: '元' })
    const b = mkItem({ id: 'b', title: '元' })
    await seed(p, dataWith({ items: [a, b] }))
    const before = await p.load()
    const sentA = { ...a, title: '送ったA' }
    const sentB = { ...b, title: '送ったB' }
    await p.save(before, put(put(before, 'items', sentA), 'items', sentB))
    await p.markUnconfirmed(
      [
        { key: 'items/a', record: sentA as AnyRecord },
        { key: 'items/b', record: sentB as AnyRecord },
      ],
      'tx-1',
    )
    // 送った後に、b だけまた直した
    const now = await p.load()
    await p.save(now, put(now, 'items', { ...sentB, memo: '後で足した' }))
    expect(await p.unconfirmedTx(['items/a', 'items/b', 'items/x'])).toEqual(new Set(['tx-1']))
    const rows = await p.readOutbox(10)
    expect(rows.find((r) => r.k === 'items/a')).toMatchObject({ unconfirmed: true, tx: 'tx-1', sent: sentA, base: a })
    // 別の id の書き込みが届いていても、この行は変えない
    await p.confirmLanded('tx-0')
    expect((await p.readOutbox(10)).map((r) => r.k)).toEqual(['items/a', 'items/b'])
    await p.confirmLanded('tx-1')
    const left = await p.readOutbox(10)
    expect(left.map((r) => r.k)).toEqual(['items/b'])
    expect(left[0].base).toEqual(sentB)
    expect(left[0].unconfirmed).toBeUndefined()
    expect(left[0].tx).toBeUndefined()
    expect(await p.unconfirmedTx(['items/b'])).toEqual(new Set())
  })

  it('クラウドの内容から base を書き直したら（受け取った反映）、印と送った内容も外す', async () => {
    const p = fresh()
    const a = mkItem({ id: 'a', title: '元' })
    await seed(p, dataWith({ items: [a] }))
    const before = await p.load()
    const mine = { ...a, title: '送った' }
    await p.save(before, put(before, 'items', mine))
    await p.markUnconfirmed([{ key: 'items/a', record: mine as AnyRecord }], 'tx-1')
    const theirs = { ...a, requester: 'ほかの端末' }
    await p.applyRemote([{ table: 'items', id: 'a', record: theirs as AnyRecord }], hooks())
    const [row] = await p.readOutbox(10)
    expect(row.base).toEqual(theirs)
    expect(row.unconfirmed).toBeUndefined()
    expect(row.tx).toBeUndefined()
    expect(row.sent).toBeUndefined()
  })
})

describe('復元（replaceAll。6.16）', () => {
  it('同期したことのある端末は「必ず上書き」で積む。受け取り箱と、残す物（MIM）は必ず上書きにしない', async () => {
    const p = fresh()
    await p.setMeta('uid', 'u')
    const cur = dataWith({
      items: [mkItem()],
      mimNotes: [mkMim()],
      inbox: [mkInbox({ id: 'xa-1', op: 'add', table: 'items', targetId: 'ce-1' })],
    })
    await seed(p, cur)
    const next = { ...cur, items: { i2: mkItem({ id: 'i2' }) } }
    await p.replaceAll(next, { tables: ['mimNotes'], keys: [], keepMimTrash: true })
    const rows = await p.readOutbox(100)
    expect(rows.map((r) => [r.k, r.force])).toEqual([
      ['items/i1', true],
      ['items/i2', true],
    ])
    expect(await p.getMeta('authoritativeKeep')).toEqual({ tables: ['inbox', 'mimNotes'], keys: [], mimTrash: true })
    expect((await p.load()).mimNotes.m1).toBeDefined()
  })

  it('返事を受け取れなかった書き込みの印は「必ず上書き」の行にも残し、届いていたら、クラウドに当てる前は「必ず上書き」のまま送った内容を base にする', async () => {
    const p = fresh()
    await p.setMeta('uid', 'u')
    const a = mkItem({ id: 'a', title: '元' })
    await seed(p, dataWith({ items: [a] }))
    const backup = await p.load()
    const before = await p.load()
    const sent = { ...a, title: '送った' }
    await p.save(before, put(before, 'items', sent))
    await p.markUnconfirmed([{ key: 'items/a', record: sent as AnyRecord }], 'tx-1')
    // 復元の内容が送った内容と同じでも、送り終わりにしない（復元の印付きで書く）
    for (const data of [backup, await p.load()]) {
      await p.replaceAll(data)
      const [row] = await p.readOutbox(10)
      expect(row).toMatchObject({ force: true, unconfirmed: true, tx: 'tx-1', sent, base: a })
      expect(await p.unconfirmedTx(['items/a'])).toEqual(new Set(['tx-1']))
    }
    await p.confirmLanded('tx-1')
    const [row] = await p.readOutbox(10)
    expect(row).toMatchObject({ force: true, base: sent })
    expect(row.unconfirmed).toBeUndefined()
    expect(row.tx).toBeUndefined()
    // クラウドに当てた後（authoritative を外した後）は、ふつうに送り終わりにする
    await p.markUnconfirmed([{ key: 'items/a', record: sent as AnyRecord }], 'tx-2')
    await p.setMeta('authoritative', null)
    await p.confirmLanded('tx-2')
    expect(await p.outboxCount()).toBe(0)
  })

  it('関数を渡すと、トランザクションの中で読んだ端末の今の記録から作る。残す表・残すキーは古い内容で書き直さない', async () => {
    const p = fresh()
    await p.setMeta('uid', 'u')
    const req = mkInbox({ id: 'xa-1', op: 'add', table: 'items', targetId: 'ce-1' })
    const cur = dataWith({ items: [mkItem()], mimNotes: [mkMim({ body: '古い' })], inbox: [req] })
    await seed(p, cur)
    const stale = await p.load()
    // その後に、ほかの端末の新しい MIM・直した MIM・当てた依頼の結果・ゴミ箱の MIM が届いた
    const mimTrash = {
      trashEntries: [
        {
          id: 'te-m',
          kind: 'mimNote',
          label: 'MIM',
          place: '',
          origin: { index: 0 },
          recordIds: ['tr-m'],
          reason: 'deleted',
          by: 'user',
          ai: null,
          inboxId: null,
          deletedAt: 1,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      trashRecords: [{ id: 'tr-m', entryId: 'te-m', table: 'mimNotes', record: mkMim({ id: 'm3' }), createdAt: 1, updatedAt: 1 }],
    }
    await p.applyRemote(
      [
        { table: 'mimNotes', id: 'm1', record: { ...cur.mimNotes.m1, body: '新しい' } as AnyRecord },
        { table: 'mimNotes', id: 'm2', record: mkMim({ id: 'm2' }) },
        { table: 'inbox', id: 'xa-1', record: { ...req, status: 'applied', appliedAt: 5 } as AnyRecord },
        { table: 'trashEntries', id: 'te-m', record: mimTrash.trashEntries[0] as AnyRecord },
        { table: 'trashRecords', id: 'tr-m', record: mimTrash.trashRecords[0] as AnyRecord },
      ],
      hooks(),
    )
    // 古い読み取り（stale）から作った内容を渡しても、残す物は端末の今のまま
    const file = { ...stale, items: { i2: mkItem({ id: 'i2' }) }, trashEntries: {}, trashRecords: {} }
    const after = await p.replaceAll(file, { tables: ['mimNotes'], keys: [], keepMimTrash: true })
    expect(after.mimNotes.m1.body).toBe('新しい')
    expect(after.mimNotes.m2).toBeDefined()
    expect(after.inbox['xa-1'].status).toBe('applied')
    expect(after.trashEntries['te-m']).toBeDefined()
    expect(Object.keys(after.items)).toEqual(['i2'])
    const rows = await p.readOutbox(100)
    expect(rows.map((r) => r.k)).toEqual(['items/i1', 'items/i2'])
    expect((await p.getMeta<{ keys: string[] }>('authoritativeKeep'))?.keys.sort()).toEqual([
      'trashEntries/te-m',
      'trashRecords/tr-m',
    ])
    // 関数の形: 渡された端末の記録は、ほかの端末の内容まで入った今の物
    let seen = ''
    await p.replaceAll((disk) => {
      seen = disk.mimNotes.m1.body
      return { data: disk }
    })
    expect(seen).toBe('新しい')
  })

  it('_gone は復元で消さない', async () => {
    const p = fresh()
    await p.applyRemote([{ table: 'items', id: 'ce-a.b.1', record: null }], hooks())
    await p.replaceAll(emptyData())
    expect([...(await p.goneKeys())]).toEqual(['items/ce-a.b.1'])
  })

  it('境（authoritativeFrom）を書く・印を外すのは、印がまだその復元の物の時だけ', async () => {
    const p = fresh()
    await p.setMeta('uid', 'u')
    await p.replaceAll(emptyData(), { tables: ['mimNotes'], keys: [], keepMimTrash: true })
    const stamp = await p.getMeta('authoritative')
    expect(stamp).toBeTruthy()
    expect(await p.setAuthoritativeFrom('前の復元', { s: 1, n: 0 })).toBe(false)
    expect(await p.getMeta('authoritativeFrom')).toBeUndefined()
    expect(await p.finishAuthoritative('前の復元')).toBe(false)
    expect(await p.getMeta('authoritative')).toBe(stamp)
    expect(await p.getMeta('authoritativeKeep')).toMatchObject({ tables: ['inbox', 'mimNotes'] })
    expect(await p.setAuthoritativeFrom(stamp, { s: 2, n: 0 })).toBe(true)
    expect(await p.getMeta('authoritativeFrom')).toEqual({ s: 2, n: 0 })
    expect(await p.finishAuthoritative(stamp)).toBe(true)
    expect(await p.getMeta('authoritative')).toBeNull()
    expect(await p.getMeta('authoritativeKeep')).toBeNull()
    // 境は残す（「必ず上書き」の送信待ちを送る時に使う）
    expect(await p.getMeta('authoritativeFrom')).toEqual({ s: 2, n: 0 })
  })

  // 印を比べてから外すまでの間に、このタブ・ほかのタブで次の復元をした（比べるのと外すのが別のトランザクションだと、後の復元の印や
  // 残す物を外してしまい、後の復元をクラウドに当てない・MIM を含まないファイルなのにほかの端末の MIM を消す）
  it('印を外している最中に次の復元をしても、後の復元の印と残す物は残る', async () => {
    const p = fresh()
    await p.setMeta('uid', 'u')
    await p.replaceAll(emptyData())
    const stamp = await p.getMeta('authoritative')
    await new Promise((r) => setTimeout(r, 5))
    const finishing = p.finishAuthoritative(stamp)
    const again = p.replaceAll(emptyData(), { tables: ['mimNotes'], keys: [], keepMimTrash: true })
    await Promise.all([finishing, again])
    const later = await p.getMeta('authoritative')
    expect(later).toBeTruthy()
    expect(later).not.toBe(stamp)
    expect(await p.getMeta('authoritativeKeep')).toEqual({ tables: ['inbox', 'mimNotes'], keys: [], mimTrash: true })
  })
})

describe('全部を受け取り直した時（dropMissing。6.11）', () => {
  it('クラウドにも送信待ちにも無い記録だけを、端末の中だけで消す', async () => {
    const p = fresh()
    const base = dataWith({ items: [mkItem({ id: 'keep' }), mkItem({ id: 'gone' }), mkItem({ id: 'packed' })] })
    await seed(p, base)
    await p.save(base, put(base, 'favorites', mkFavorite({ id: 'mine' })))
    const dropped = await p.dropMissing(new Set(['items/keep', 'items/packed']))
    expect(dropped).toEqual([{ table: 'items', id: 'gone', record: null }])
    const d = await p.load()
    expect(Object.keys(d.items).sort()).toEqual(['keep', 'packed'])
    expect(d.favorites.mine).toBeDefined()
    expect((await p.readOutbox(10)).map((r) => r.k)).toEqual(['favorites/mine'])
  })
})

describe('アカウントの切り替え（markAllDirty）', () => {
  it('すべてを「共通の履歴が無い」送信待ちにし、前のアカウントの月の束を忘れる', async () => {
    const p = fresh()
    const base = dataWith({ items: [mkItem()] })
    await seed(p, base)
    await p.setPacks([['i1', '2025-03']])
    await p.markAllDirty()
    const rows = await p.readOutbox(10)
    expect(rows.map((r) => [r.k, r.noHistory, r.base])).toEqual([['items/i1', true, null]])
    expect((await p.packsOf()).size).toBe(0)
  })
})
