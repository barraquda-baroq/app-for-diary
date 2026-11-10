// 同期の結合テスト（docs/SPEC.md の 2.10）。Firebase エミュレーター（Auth・Firestore）の中で、2台の端末を動かして確かめる。
// 実行: npm run test:sync
// NS の src/sync/sync.emu.test.ts の仕組み（vi.mock の listen・goOffline・makeDevice・settle・waitFor・putRecord・emulatorRequest で
// 本番のルールを入れる）と一般の場面を DS のデータで書き直し、DS の場面（休み・ルーチンのチェック・MIM・Task List の修復・月の束・
// 受け取り箱・持ち主）を足した。
import { deleteApp, initializeApp, type FirebaseApp } from 'firebase/app'
import { GoogleAuthProvider, connectAuthEmulator, getAuth, signInWithCredential } from 'firebase/auth'
import {
  collection,
  connectFirestoreEmulator,
  doc,
  getDoc,
  getDocs,
  initializeFirestore,
  memoryLocalCache,
  serverTimestamp,
  setDoc,
  terminate,
  type Firestore,
} from 'firebase/firestore'
import emuRules from '../../firestore.emu.rules?raw'
import prodRules from '../../firestore.rules?raw'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPersistence, type ConflictNote, type Persistence, type ReplaceOptions } from '../db/persistence'
import { adminCreateOwner, EMU_PROJECT, emulatorRequest, useRules } from '../test/emulatorAdmin'
import { mimTrashIds, parseBackup, restoreData, backupJson, type RestoreKeep } from '../domain/backup'
import { todayStr } from '../domain/dates'
import { derivedItemId } from '../domain/derivedId'
import { revOf } from '../domain/hash'
import * as I from '../domain/inbox'
import { isInTaskList } from '../domain/items'
import * as O from '../domain/ops'
import { repairData } from '../domain/repair'
import * as T from '../domain/trash'
import type { AppData, InboxRecord, Item, MimNote } from '../domain/types'
import { DAY_MS, newId } from '../domain/util'
import { appModelRef, type AppModel } from './appModel'
import { encodeRecord, type ChunkDoc, type RecordDoc } from './codec'
import { createConflictHooks } from './conflicts'
import { createSyncEngine, SYNC_SCHEMA, type SyncEngine, type SyncTarget } from './engine'
import { stableStringify } from './merge'
import { decodePack } from './packs'

/**
 * 購読の通知を端末ごとに間引く（ページが止まった・裏に回った間に、自分の書き込みの通知を受け取れなかった時の再現）。
 * dropOwn に Firestore と端末の名前を入れると、その端末の書き込みだけの通知を捨てる（ほかの端末の書き込みは届く）
 */
const listen = vi.hoisted(() => ({
  dropOwn: new Map<unknown, string>(),
  /** 次の送信のトランザクションの返事を受け取れない Firestore（書き込みはクラウドに届く） */
  loseReply: new Set<unknown>(),
  /** 通信できない Firestore（goOffline。送信のトランザクションも「通信できない」で失敗させる） */
  offline: new Set<unknown>(),
  /** 記録の購読の通知を捨てる Firestore（ほかの端末の書き込みを受け取る前に送った時の再現） */
  deaf: new Set<unknown>(),
}))
vi.mock('firebase/firestore', async (importOriginal) => {
  const m = await importOriginal<typeof import('firebase/firestore')>()
  type Snap = {
    docChanges?: () => { doc: { data: () => { device?: unknown } } }[]
    metadata?: { fromCache: boolean }
  }
  const onSnapshot = (ref: { firestore: unknown; path?: string }, ...rest: unknown[]) => {
    const i = rest.findIndex((x) => typeof x === 'function')
    const next = rest[i] as (snap: Snap) => void
    rest[i] = (snap: Snap) => {
      if (listen.deaf.has(ref.firestore) && !ref.path?.endsWith('/meta/app')) return
      const own = listen.dropOwn.get(ref.firestore)
      const changes = own && snap.docChanges ? snap.docChanges() : []
      if (own && changes.length && changes.every((c) => c.doc.data().device === own)) return
      next(snap)
    }
    return (m.onSnapshot as unknown as (...a: unknown[]) => () => void)(ref, ...rest)
  }
  const runTransaction = (async (fs: unknown, ...rest: unknown[]) => {
    if (listen.offline.has(fs))
      throw Object.assign(new Error('通信できません（テスト）'), { name: 'FirebaseError', code: 'unavailable' })
    const r = await (m.runTransaction as unknown as (...a: unknown[]) => Promise<unknown>)(fs, ...rest)
    if (listen.loseReply.delete(fs))
      throw Object.assign(new Error('返事を受け取れませんでした（テスト）'), { name: 'FirebaseError', code: 'unavailable' })
    return r
  }) as unknown as typeof m.runTransaction
  return { ...m, onSnapshot, runTransaction }
})

const PROJECT = EMU_PROJECT
/** 受け取り箱の許可（テストでは直接渡す。6.14） */
const PERMS: I.InboxPerms = { linked: true, adds: true, edits: true, proposals: true }
let seq = 0

interface Device {
  name: string
  uid: string
  p: Persistence
  fs: Firestore
  engine: SyncEngine | null
  /** 競合の知らせ（applyRemote の report） */
  notes: ConflictNote[]
  load(): Promise<AppData>
  edit(fn: (d: AppData) => AppData): Promise<void>
  /** 受け取り箱の当て方を raw に当てて、依頼ごとのまとまりで保存する（ストアの commitRaw と同じ） */
  inbox(fn: (d: AppData, ctx: I.InboxContext) => { data: AppData; touched: I.Touched }): Promise<void>
  /** バックアップからの復元 */
  restore(data: AppData, keep?: RestoreKeep): Promise<void>
  online(): Promise<void>
  offline(): void
}

const apps: { app: FirebaseApp; fs: Firestore }[] = []
const devices: Device[] = []

afterEach(async () => {
  listen.dropOwn.clear()
  listen.loseReply.clear()
  listen.offline.clear()
  listen.deaf.clear()
  for (const d of devices.splice(0)) {
    d.offline()
    d.p.close()
  }
  for (const { app, fs } of apps.splice(0)) {
    await terminate(fs)
    await deleteApp(app)
  }
})

function keepOptions(keep?: RestoreKeep): ReplaceOptions {
  if (!keep?.mimNotes) return {}
  return {
    tables: ['mimNotes'],
    keys: [...keep.trashEntryIds.map((id) => `trashEntries/${id}`), ...keep.trashRecordIds.map((id) => `trashRecords/${id}`)],
    keepMimTrash: true,
  }
}

async function makeDevice(
  name: string,
  account: string,
  opts: { chunkSize?: number; batchChars?: number; ownerLock?: boolean; appModel?: AppModel; now?: () => number } = {},
): Promise<Device> {
  const app = initializeApp({ projectId: PROJECT, apiKey: 'fake-api-key', authDomain: 'localhost' }, `${name}-${++seq}`)
  const auth = getAuth(app)
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
  const cred = GoogleAuthProvider.credential(
    JSON.stringify({ sub: account, email: `${account}@example.com`, email_verified: true }),
  )
  const { user } = await signInWithCredential(auth, cred)
  const fs = initializeFirestore(app, { localCache: memoryLocalCache() })
  connectFirestoreEmulator(fs, '127.0.0.1', 8080)
  apps.push({ app, fs })
  const p = createPersistence(`emu-${name}-${seq}-${Math.random().toString(36).slice(2)}`)
  const notes: ConflictNote[] = []
  const hooksFor = async () => {
    const before = repairData(await p.load()).data
    return createConflictHooks({ device: name, data: () => before, newId, report: (n) => notes.push(n) })
  }
  const target: SyncTarget = {
    readOutbox: (n) => p.readOutbox(n),
    completeUpload: (s) => p.completeUpload(s),
    markUnconfirmed: (keys) => p.markUnconfirmed(keys),
    applyRemote: async (changes, cursor, o) => p.applyRemote(changes, { cursor, ...(await hooksFor()), ...o }),
    outboxCount: () => p.outboxCount(),
    outboxKeys: () => p.outboxKeys(),
    markAllDirty: () => p.markAllDirty(),
    localKeys: () => p.localKeys(),
    getMeta: (k) => p.getMeta(k),
    setMeta: (k, v) => p.setMeta(k, v),
    packsOf: () => p.packsOf(),
    setPacks: (e) => p.setPacks(e),
    clearPacks: () => p.clearPacks(),
    items: async () => Object.values((await p.load()).items),
    dropMissing: (keys) => p.dropMissing(keys),
  }
  const device: Device = {
    name,
    uid: user.uid,
    p,
    fs,
    engine: null,
    notes,
    load() {
      return p.load()
    },
    async edit(fn) {
      const prev = await device.load()
      await p.save(prev, fn(prev), await hooksFor())
      device.engine?.requestUpload(true)
    },
    async inbox(fn) {
      const prev = await device.load()
      const gone = await p.goneKeys()
      const ctx: I.InboxContext = { now: Date.now(), perms: PERMS, isGone: (t, id) => gone.has(`${t}/${id}`) }
      const r = fn(prev, ctx)
      await p.save(prev, r.data, await hooksFor(), { groups: r.touched })
      device.engine?.requestUpload(true)
    },
    async restore(data, keep) {
      await p.replaceAll(data, keepOptions(keep))
      device.engine?.requestUpload(true)
    },
    async online() {
      if (device.engine) return
      device.engine = createSyncEngine({
        firestore: fs,
        uid: user.uid,
        deviceId: name,
        target,
        uploadDelay: 10,
        uploadMaxWait: 50,
        chunkSize: opts.chunkSize,
        batchChars: opts.batchChars,
        ownerLock: opts.ownerLock ?? false,
        appModel: opts.appModel,
        now: opts.now,
      })
      await device.engine.start()
    },
    offline() {
      device.engine?.stop()
      device.engine = null
    },
  }
  devices.push(device)
  return device
}

async function waitFor<T>(fn: () => Promise<T | undefined | null | false>, label: string, timeout = 15_000): Promise<T> {
  const until = Date.now() + timeout
  let last: unknown
  for (;;) {
    try {
      const v = await fn()
      if (v) return v
    } catch (e) {
      last = e
    }
    if (Date.now() > until) throw new Error(`待ちきれませんでした: ${label}${last ? ` (${String(last)})` : ''}`)
    await new Promise((r) => setTimeout(r, 50))
  }
}

/** 両方の端末の送信待ちが空になり、内容が揃うまで待つ */
async function settle(...ds: Device[]): Promise<void> {
  let why = ''
  await waitFor(async () => {
    for (const d of ds) {
      await d.engine?.idle()
      const n = await d.p.outboxCount()
      if (n > 0) {
        why = `${d.name} の送信待ち ${n} 件: ${JSON.stringify(await d.p.readOutbox(3)).slice(0, 600)} / ${JSON.stringify(d.engine?.status)}`
        return false
      }
    }
    const [first, ...rest] = await Promise.all(ds.map((d) => d.load()))
    const ok = rest.every((r) => stableStringify(r) === stableStringify(first))
    if (!ok) why = `内容が違う: ${stableStringify(first).slice(0, 800)} <> ${stableStringify(rest[0]).slice(0, 800)}`
    return ok
  }, '端末の内容が揃う').catch((e) => {
    throw new Error(`${(e as Error).message}\n${why}`)
  })
}

const account = () => `user-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

/** 端末と同じ形で記録をクラウドに置く（device を渡す。コネクタは ds-connector） */
async function putRecord(d: Device, table: string, rec: { id: string }, device: string): Promise<void> {
  const enc = encodeRecord(rec as never)
  await setDoc(doc(d.fs, 'users', d.uid, 'records', `${table}:${rec.id}`), {
    table,
    id: rec.id,
    json: enc.json,
    chunks: 0,
    deleted: false,
    hash: enc.hash,
    updated: serverTimestamp(),
    device,
  })
}

/** コネクタと同じ形で受け取り箱に依頼を作る（device: ds-connector。段階6のコネクタの代わり） */
const connectorPut = (d: Device, rec: InboxRecord) => putRecord(d, 'inbox', rec, 'ds-connector')

/** クラウドの文書 */
const cloud = async (d: Device, docId: string) => (await getDoc(doc(d.fs, 'users', d.uid, 'records', docId))).data()

// ---------- 記録を作る道具 ----------

const now = () => Date.now()
const today = () => todayStr()

function addItem(d: AppData, input: Partial<O.ItemInput> & { title: string }): { data: AppData; id: string } {
  const r = O.addItem(d, { origin: 'calendar', start: today(), ...input })
  return { data: r.data, id: r.result }
}

function putItem(d: AppData, item: Item): AppData {
  return { ...d, items: { ...d.items, [item.id]: item } }
}

/** 古い月の項目（月の束の候補。2025年3月・最後に直したのは1年前） */
function oldItem(id: string, title: string, p: Partial<Item> = {}): Item {
  const at = Date.now() - 365 * DAY_MS
  return {
    id,
    v: 1,
    kind: 'work',
    title,
    origin: 'calendar',
    start: '2025-03-10',
    due: null,
    startTime: null,
    endTime: null,
    listed: false,
    done: false,
    doneAt: null,
    doneOn: null,
    locked: false,
    label: null,
    requester: '',
    memo: '',
    order: at,
    by: 'user',
    ai: null,
    via: null,
    createdAt: at,
    updatedAt: at,
    ...p,
  }
}

/** 受け取り箱の1件（コネクタが作った時の形） */
function inboxRec(p: Partial<InboxRecord> & Pick<InboxRecord, 'id' | 'op' | 'table' | 'targetId'>): InboxRecord {
  const at = Date.now()
  return {
    v: 1,
    proposeOp: null,
    baseHash: null,
    patch: null,
    sourceKey: null,
    requestQuote: null,
    why: null,
    proposalId: null,
    by: 'connector',
    ai: 'claude',
    via: null,
    createdAt: at,
    updatedAt: at,
    status: 'pending',
    reason: null,
    message: null,
    appliedAt: null,
    answeredVia: null,
    answerId: null,
    supersededBy: null,
    undo: null,
    undoneAt: null,
    ...p,
  }
}

const MAIL = '<mail-1@example.com>'

/** メールから予定を足す依頼（19.4） */
function addRequest(id: string, title = '打ち合わせ', mail = MAIL): { rec: InboxRecord; itemId: string } {
  const patch = { origin: 'calendar', kind: 'work', title, start: '2026-12-03', startTime: '10:00', endTime: '11:00' }
  const itemId = derivedItemId(patch as never, mail)
  return {
    itemId,
    rec: inboxRec({ id, op: 'add', table: 'items', targetId: itemId, patch, sourceKey: mail, via: 'メール: 打ち合わせのご案内' }),
  }
}

describe('同期（エミュレーター）', () => {
  it('初めてのログインで、両方の端末の内容がクラウドで1つにまとまる', async () => {
    const who = account()
    const a = await makeDevice('a', who)
    const b = await makeDevice('b', who)
    let itemId = ''
    await a.edit((d) => {
      const r = addItem(d, { title: 'Aの予定', memo: 'Aのメモ' })
      itemId = r.id
      return r.data
    })
    await b.edit((d) => O.addFavorite(d, 'Bのやりたいこと').data)
    // a が送り終えてから b をつなぐ（エミュレーターの serverTimestamp の順が本番と違うため。NS と同じ）
    await a.online()
    await settle(a)
    await b.online()
    await settle(a, b)
    const db = await b.load()
    expect(db.items[itemId].title).toBe('Aの予定')
    expect(db.items[itemId].memo).toBe('Aのメモ')
    expect(Object.values(db.favorites).map((f) => f.text)).toContain('Bのやりたいこと')
  })

  it('編集がもう一方の端末にリアルタイムで届く（ゴミ箱へ移すのも）', async () => {
    const who = account()
    const a = await makeDevice('a', who)
    const b = await makeDevice('b', who)
    await a.online()
    await b.online()
    let id = ''
    await a.edit((d) => {
      const r = addItem(d, { title: '予定' })
      id = r.id
      return r.data
    })
    await waitFor(async () => (await b.load()).items[id], '予定が届く')
    await b.edit((d) => O.updateItem(d, id, { memo: 'Bで追記' }).data)
    await waitFor(async () => (await a.load()).items[id]?.memo === 'Bで追記', '追記が届く')
    await a.edit((d) => T.trashItem(d, id).data)
    await waitFor(async () => !(await b.load()).items[id], 'ゴミ箱へ移したのが届く')
    await settle(a, b)
    const entries = Object.values((await b.load()).trashEntries)
    expect(entries.map((e) => e.label)).toEqual(['予定'])
  })

  it('オフラインの間に別々の項目を変えたら、両方の変更が残る（メモを両方で書き換えたらつなぐ）', async () => {
    const who = account()
    const a = await makeDevice('a', who)
    const b = await makeDevice('b', who)
    await a.online()
    let id = ''
    await a.edit((d) => {
      const r = addItem(d, { title: '予定', memo: '元のメモ' })
      id = r.id
      return r.data
    })
    await settle(a)
    await b.online()
    await settle(a, b)
    a.offline()
    b.offline()
    await a.edit((d) => O.updateItem(d, id, { title: 'Aで直した件名', memo: 'Aのメモ' }).data)
    await b.edit((d) => O.updateItem(d, id, { requester: '山田さん', memo: 'Bのメモ' }).data)
    await a.online()
    await settle(a)
    await b.online()
    await settle(a, b)
    const it = (await a.load()).items[id]
    expect(it.title).toBe('Aで直した件名')
    expect(it.requester).toBe('山田さん')
    expect(it.memo).toContain('Aのメモ')
    expect(it.memo).toContain('Bのメモ')
    expect(it.memo).toContain('同期の競合')
  })

  it('片方でゴミ箱へ移し・片方で編集したら、削除しつつ編集された内容をゴミ箱に残す', async () => {
    const who = account()
    const a = await makeDevice('a', who)
    const b = await makeDevice('b', who)
    await a.online()
    let id = ''
    await a.edit((d) => {
      const r = addItem(d, { title: '予定' })
      id = r.id
      return r.data
    })
    await settle(a)
    await b.online()
    await settle(a, b)
    a.offline()
    b.offline()
    await a.edit((d) => T.trashItem(d, id).data)
    await b.edit((d) => O.updateItem(d, id, { memo: 'Bで書いた大事なメモ' }).data)
    await a.online()
    await settle(a)
    await b.online()
    await settle(a, b)
    const d = await b.load()
    expect(d.items[id]).toBeUndefined()
    const kept = Object.values(d.trashEntries).filter((e) => e.reason === 'conflict')
    expect(kept).toHaveLength(1)
    const rec = d.trashRecords[kept[0].recordIds[0]].record as Item
    expect(rec.memo).toBe('Bで書いた大事なメモ')
  })

  it('大きなメモは分けて送り（分けた文書に親の表の名前 parentTable）、そのまま受け取れる。小さくなったら分けた文書を消す', async () => {
    const who = account()
    const a = await makeDevice('a', who, { chunkSize: 1000 })
    const b = await makeDevice('b', who, { chunkSize: 1000 })
    await a.online()
    await b.online()
    let id = ''
    let mimId = ''
    const big = 'あ'.repeat(3500)
    await a.edit((d) => {
      const r = addItem(d, { title: '大きなメモ', memo: big })
      id = r.id
      const m = O.addMimNote(r.data, { title: '金庫', body: 'い'.repeat(2500) })
      mimId = m.result
      return m.data
    })
    await waitFor(async () => (await b.load()).items[id]?.memo === big, '大きなメモが届く')
    await settle(a, b)
    const chunks = (await getDocs(collection(a.fs, 'users', a.uid, 'records'))).docs
      .map((x) => ({ id: x.id, data: x.data() as ChunkDoc }))
      .filter((x) => x.data.table === '_chunk')
    expect(chunks.filter((c) => c.data.parent === `items:${id}`).map((c) => c.data.parentTable)).toEqual(
      expect.arrayContaining(['items']),
    )
    expect(chunks.filter((c) => c.data.parent === `items:${id}`).length).toBeGreaterThan(1)
    expect(chunks.filter((c) => c.data.parent === `mimNotes:${mimId}`).every((c) => c.data.parentTable === 'mimNotes')).toBe(true)
    await a.edit((d) => O.updateItem(d, id, { memo: '短い' }).data)
    await settle(a, b)
    const left = (await getDocs(collection(a.fs, 'users', a.uid, 'records'))).docs.filter((x) => x.id.startsWith(`items:${id}#`))
    expect(left).toEqual([])
    expect((await b.load()).items[id].memo).toBe('短い')
  })

  it('送り終わると送信待ちが空になり、同じ内容を書き直し続けない', async () => {
    const who = account()
    const a = await makeDevice('a', who)
    await a.online()
    let id = ''
    await a.edit((d) => {
      const r = addItem(d, { title: '予定' })
      id = r.id
      return r.data
    })
    await settle(a)
    const first = (await cloud(a, `items:${id}`))?.updated
    await new Promise((r) => setTimeout(r, 800))
    await a.engine?.idle()
    expect(await a.p.outboxCount()).toBe(0)
    expect((await cloud(a, `items:${id}`))?.updated).toEqual(first)
    expect(a.engine?.status.phase).toBe('synced')
  })

  it('別のアカウントのデータは読めない', async () => {
    const a = await makeDevice('a', account())
    await a.online()
    await a.edit((d) => addItem(d, { title: '予定' }).data)
    await settle(a)
    const other = await makeDevice('other', account())
    await expect(getDocs(collection(other.fs, 'users', a.uid, 'records'))).rejects.toThrow()
  })

  it('続けて書いて送っても、先に送った古い版の通知で巻き戻らず、競合の控えも作らない', async () => {
    const who = account()
    const a = await makeDevice('a', who)
    const b = await makeDevice('b', who)
    await a.online()
    await b.online()
    let id = ''
    await a.edit((d) => {
      const r = addItem(d, { title: '予定' })
      id = r.id
      return r.data
    })
    await settle(a, b)
    for (let i = 1; i <= 8; i++) {
      await a.edit((d) => O.updateItem(d, id, { memo: `メモ${i}` }).data)
      await new Promise((r) => setTimeout(r, 30))
    }
    await settle(a, b)
    expect((await a.load()).items[id].memo).toBe('メモ8')
    expect((await b.load()).items[id].memo).toBe('メモ8')
    expect(a.notes).toEqual([])
    expect(Object.keys((await a.load()).trashEntries)).toEqual([])
  })

  it('送った書き込みの返事を受け取れず、その後に消して送っても、消した物はクラウドに残らない', async () => {
    const who = account()
    const a = await makeDevice('a', who)
    const b = await makeDevice('b', who)
    await a.online()
    await b.online()
    await settle(a, b)
    let id = ''
    listen.loseReply.add(a.fs)
    await a.edit((d) => {
      const r = O.addFavorite(d, '一度だけ足した')
      id = r.result
      return r.data
    })
    await waitFor(async () => (await cloud(a, `favorites:${id}`))?.deleted === false, '書き込みはクラウドに届いた')
    // 返事は届かなかった（送信待ちは返事待ちの印のまま）。その後に消した
    await a.edit((d) => {
      const { [id]: _gone, ...favorites } = d.favorites
      void _gone
      return { ...d, favorites }
    })
    await settle(a, b)
    expect((await cloud(a, `favorites:${id}`))?.deleted).toBe(true)
    expect((await b.load()).favorites[id]).toBeUndefined()
  })

  it('バックアップからの復元は、ほかの端末にも当たる（この端末が受け取っていない記録も消える）', async () => {
    const who = account()
    const a = await makeDevice('a', who)
    const b = await makeDevice('b', who)
    await a.online()
    await b.online()
    let keepId = ''
    await a.edit((d) => {
      const r = addItem(d, { title: '残す予定' })
      keepId = r.id
      return r.data
    })
    await settle(a, b)
    const backup = parseBackup(backupJson(await a.load(), { includesMim: true, appVersion: '0.1' }))
    // バックアップの後に、B で予定を足した（A は受け取らずに復元する）
    a.offline()
    let laterId = ''
    await b.edit((d) => {
      const r = addItem(d, { title: '後で足した予定' })
      laterId = r.id
      return r.data
    })
    await settle(b)
    const restored = restoreData(await a.load(), backup)
    await a.restore(restored.data, restored.keep)
    await a.online()
    await settle(a, b)
    const d = await b.load()
    expect(d.items[keepId]).toBeDefined()
    expect(d.items[laterId]).toBeUndefined()
  })

  it('「MIM を含めない」バックアップを読み込んでも、ほかの端末で直した MIM は上書きされず、クラウドから消えない（形4）', async () => {
    const who = account()
    const a = await makeDevice('a', who)
    const b = await makeDevice('b', who)
    await a.online()
    await b.online()
    let mimId = ''
    let trashedMim = ''
    await a.edit((d) => {
      const m = O.addMimNote(d, { title: '会社の Wi-Fi' })
      mimId = m.result
      const m2 = O.addMimNote(m.data, { title: '消したメモ' })
      trashedMim = m2.result
      return O.updateMimNote(m2.data, mimId, { secrets: [{ id: 's1', name: 'パスワード', value: '古いパスワード' }] })
    })
    await a.edit((d) => T.trashMimNote(d, trashedMim).data)
    await settle(a, b)
    const json = backupJson(await a.load(), { includesMim: false, appVersion: '0.1' })
    expect(json).not.toContain('古いパスワード')
    expect(json).not.toContain('消したメモ')
    // A がオフラインの間に、B でパスワードを直した
    a.offline()
    await b.edit((d) => O.updateMimNote(d, mimId, { secrets: [{ id: 's1', name: 'パスワード', value: '新しいパスワード' }] }))
    await settle(b)
    const restored = restoreData(await a.load(), parseBackup(json))
    expect(restored.keep.mimNotes).toBe(true)
    await a.restore(restored.data, restored.keep)
    await a.online()
    await settle(a, b)
    for (const dev of [a, b]) {
      const d = await dev.load()
      expect((d.mimNotes[mimId] as MimNote).secrets[0].value).toBe('新しいパスワード')
      expect(mimTrashIds(d).entries.size).toBe(1)
    }
  })

  it('同期の形の版が変わった端末は、次の同期で全件を受け取り直す', async () => {
    const who = account()
    const a = await makeDevice('a', who)
    const b = await makeDevice('b', who)
    await a.online()
    await b.online()
    await settle(a, b)
    b.offline()
    let id = ''
    await a.edit((d) => {
      const r = addItem(d, { title: '予定' })
      id = r.id
      return r.data
    })
    await settle(a)
    // b は受け取った位置を進めたまま、その記録を知らない（古い版が知らない表を飛ばした時の再現）
    await b.p.setMeta('cursor', { s: Math.floor(Date.now() / 1000) + 60, n: 0 })
    await b.p.setMeta('syncSchema', SYNC_SCHEMA - 1)
    await b.online()
    await waitFor(async () => (await b.load()).items[id], '受け取り直して届く')
    expect(await b.p.getMeta('syncSchema')).toBe(SYNC_SCHEMA)
  })
})

describe('DS の表の同期（エミュレーター）', () => {
  it('項目・休み・ラベルの呼び名・ルーチンとチェック・やりたいこと・MIM が2台で合う', async () => {
    const who = account()
    const a = await makeDevice('a', who)
    const b = await makeDevice('b', who)
    await a.online()
    await b.online()
    let routineId = ''
    await a.edit((d) => {
      let data = addItem(d, { title: '会議', startTime: '10:00', endTime: '11:00' }).data
      data = O.addItem(data, { origin: 'list', title: 'タスク', due: today() }).data
      data = O.setOffDay(data, '2026-11-23', true)
      data = O.setLabelName(data, 'sky-l', '会議')
      const r = O.addRoutine(data, { title: '朝の体操', cycle: 'daily' })
      routineId = r.result
      data = O.checkRoutine(r.data, routineId, today())
      data = O.addFavorite(data, '本を読む').data
      return O.addMimNote(data, { title: 'メモ', body: '本文' }).data
    })
    await settle(a, b)
    const d = await b.load()
    expect(
      Object.values(d.items)
        .map((i) => i.title)
        .sort(),
    ).toEqual(['タスク', '会議'])
    expect(d.offDays['2026-11-23'].off).toBe(true)
    expect(d.labelNames['sky-l'].name).toBe('会議')
    expect(Object.values(d.routineChecks).flatMap((c) => c.dates)).toEqual([today()])
    expect(Object.values(d.favorites).map((f) => f.text)).toEqual(['本を読む'])
    expect(Object.values(d.mimNotes).map((m) => m.title)).toEqual(['メモ'])
    // 休みを外すのも届く（記録は消さない）
    await b.edit((x) => O.setOffDay(x, '2026-11-23', false))
    await waitFor(async () => (await a.load()).offDays['2026-11-23']?.off === false, '休みを外したのが届く')
    await settle(a, b)
  })

  it('ルーチンのチェックを2台で同時に付け外しても、両方の変更が残り、日付は小さい順・重なりなし', async () => {
    const who = account()
    const a = await makeDevice('a', who)
    const b = await makeDevice('b', who)
    await a.online()
    const month = today().slice(0, 7)
    const day = (n: number) => `${month}-${String(n).padStart(2, '0')}`
    let routineId = ''
    await a.edit((d) => {
      const r = O.addRoutine(d, { title: '週の振り返り', cycle: 'weekly' })
      routineId = r.result
      const check = {
        id: `${routineId}:${month}`,
        routineId,
        month,
        dates: [day(2)],
        updatedAt: now(),
        by: 'user' as const,
        ai: null,
        via: null,
      }
      return { ...r.data, routineChecks: { ...r.data.routineChecks, [check.id]: check } }
    })
    await settle(a)
    await b.online()
    await settle(a, b)
    a.offline()
    b.offline()
    const setDates = (dates: string[]) => (d: AppData) => {
      const c = d.routineChecks[`${routineId}:${month}`]
      return { ...d, routineChecks: { ...d.routineChecks, [c.id]: { ...c, dates, updatedAt: now() } } }
    }
    // A は前の日のチェックを外し、B は2つ足した（後ろの日を先に）
    await a.edit(setDates([]))
    await b.edit(setDates([day(2), day(9), day(5)]))
    await a.online()
    await settle(a)
    await b.online()
    await settle(a, b)
    expect((await a.load()).routineChecks[`${routineId}:${month}`].dates).toEqual([day(5), day(9)])
  })

  it('片方で Task List から外し、片方で締め切り日を消したら、Task List に出る（6.12）', async () => {
    const who = account()
    const a = await makeDevice('a', who)
    const b = await makeDevice('b', who)
    await a.online()
    let id = ''
    await a.edit((d) => {
      const r = O.addItem(d, { origin: 'list', title: '見積書', due: '2026-11-20' })
      id = r.result
      return r.data
    })
    await settle(a)
    await b.online()
    await settle(a, b)
    a.offline()
    b.offline()
    await a.edit((d) => O.updateItem(d, id, { listed: false }).data)
    await b.edit((d) => O.updateItem(d, id, { due: null }).data)
    await a.online()
    await settle(a)
    await b.online()
    await settle(a, b)
    const raw = (await a.load()).items[id]
    // 記録は両方の変更のまま（どこにも出ない形）。表示では Task List に出す（記録は書き戻さない。形3）
    expect(raw.due).toBeNull()
    const shown = repairData(await b.load()).data.items[id]
    expect(shown.listed).toBe(true)
    expect(isInTaskList(shown, now())).toBe(true)
  })

  it('MIM の欄の中身を2台で別々に変えたら、この端末の中身を採り、相手のメモをゴミ箱に控える', async () => {
    const who = account()
    const a = await makeDevice('a', who)
    const b = await makeDevice('b', who)
    await a.online()
    let mimId = ''
    await a.edit((d) => {
      const m = O.addMimNote(d, { title: 'ルーター' })
      mimId = m.result
      return O.updateMimNote(m.data, mimId, { secrets: [{ id: 's1', name: 'パスワード', value: '元' }] })
    })
    await settle(a)
    await b.online()
    await settle(a, b)
    a.offline()
    b.offline()
    await a.edit((d) => O.updateMimNote(d, mimId, { secrets: [{ id: 's1', name: 'パスワード', value: 'Aの値' }] }))
    await b.edit((d) => O.updateMimNote(d, mimId, { secrets: [{ id: 's1', name: 'パスワード', value: 'Bの値' }] }))
    await a.online()
    await settle(a)
    await b.online()
    await settle(a, b)
    const d = await a.load()
    // 後から合わせた B の中身を採り、先に送った A の中身はゴミ箱に控える（パスワードをつながない）
    expect((d.mimNotes[mimId] as MimNote).secrets[0].value).toBe('Bの値')
    const kept = Object.values(d.trashEntries).filter((e) => e.reason === 'conflict' && e.kind === 'mimNote')
    expect(kept).toHaveLength(1)
    expect((d.trashRecords[kept[0].recordIds[0]].record as MimNote).secrets[0].value).toBe('Aの値')
  })

  it('別の端末でルーチンをゴミ箱へ移したら、こちらで付けたチェックの記録も片付く', async () => {
    const who = account()
    const a = await makeDevice('a', who)
    const b = await makeDevice('b', who)
    await a.online()
    let routineId = ''
    await a.edit((d) => {
      const r = O.addRoutine(d, { title: '水やり', cycle: 'daily' })
      routineId = r.result
      return r.data
    })
    await settle(a)
    await b.online()
    await settle(a, b)
    b.offline()
    await a.edit((d) => T.trashRoutine(d, routineId).data)
    await settle(a)
    await b.edit((d) => O.checkRoutine(d, routineId, today()))
    await b.online()
    await settle(a, b)
    const d = await b.load()
    expect(d.routines[routineId]).toBeUndefined()
    expect(Object.values(d.routineChecks).filter((c) => c.routineId === routineId)).toEqual([])
  })
})

describe('持ち主とアクセスルール（エミュレーター。形1）', () => {
  it('持ち主の記録が無い時は同期を始めず、アプリからは config/owner を作れない', async () => {
    await useRules(prodRules)
    await emulatorRequest('DELETE', `/emulator/v1/projects/${PROJECT}/databases/(default)/documents`)
    try {
      const a = await makeDevice('a', account(), { ownerLock: true })
      await a.edit((d) => addItem(d, { title: '予定' }).data)
      await a.online()
      await waitFor(async () => a.engine?.status.phase === 'error', '同期を始めない')
      expect(a.engine?.status.errorCode).toBe('owner-missing')
      expect(a.engine?.status.error).toBe('持ち主の記録がまだありません（docs/manual/5-owner-record.md）')
      expect(await a.p.outboxCount()).toBe(1)
      // アプリ（クライアント）からは作れない
      await expect(setDoc(doc(a.fs, 'config', 'owner'), { uid: a.uid, createdAt: serverTimestamp() })).rejects.toThrow()
      expect((await getDoc(doc(a.fs, 'config', 'owner'))).exists()).toBe(false)
    } finally {
      await useRules(emuRules)
    }
  })

  it('本番のアクセスルール: 持ち主だけが使え、ほかのアカウントは同期できず、形の違う文書・合わない分けた文書は拒む', async () => {
    await useRules(prodRules)
    await emulatorRequest('DELETE', `/emulator/v1/projects/${PROJECT}/databases/(default)/documents`)
    try {
      const ownerAccount = account()
      const owner = await makeDevice('owner', ownerAccount, { ownerLock: true, chunkSize: 1000 })
      await adminCreateOwner(owner.uid)
      await owner.online()
      let id = ''
      await owner.edit((d) => {
        const r = addItem(d, { title: '持ち主の予定', memo: 'う'.repeat(2500) })
        id = r.id
        return r.data
      })
      await settle(owner)
      expect(await owner.p.getMeta('ownerSeen')).toBe(owner.uid)
      expect((await cloud(owner, `items:${id}`))?.chunks).toBeGreaterThan(0)
      const stranger = await makeDevice('stranger', account(), { ownerLock: true })
      await stranger.p.setMeta('ownerSeen', stranger.uid)
      await stranger.online()
      await waitFor(async () => stranger.engine?.status.phase === 'error', 'ほかのアカウントは同期できない')
      expect(stranger.engine?.status.errorCode).toBe('owner-mismatch')
      expect(stranger.engine?.status.error).toBe('このアカウントは Diary Studio の持ち主ではありません')
      expect(await stranger.p.getMeta('ownerSeen')).toBeNull()
      // ルールでも、持ち主以外は自分の場所にさえ書けない・持ち主のデータは読めない
      await expect(getDocs(collection(stranger.fs, 'users', owner.uid, 'records'))).rejects.toThrow()
      const recDoc = (table: string, recId: string) => ({
        table,
        id: recId,
        json: '{}',
        chunks: 0,
        deleted: false,
        hash: 'h',
        updated: serverTimestamp(),
        device: 'd',
      })
      await expect(setDoc(doc(stranger.fs, 'users', stranger.uid, 'records', 'items:x'), recDoc('items', 'x'))).rejects.toThrow()
      const own = (docId: string, data: object) => setDoc(doc(owner.fs, 'users', owner.uid, 'records', docId), data)
      // 持ち主も、決まった形でない文書・知らない表・文書の id と中身が合わない文書は書けない
      await expect(own('items:y', { table: 'items', junk: 'x' })).rejects.toThrow()
      await expect(own('titles:y', recDoc('titles', 'y'))).rejects.toThrow()
      await expect(own('items:y', recDoc('items', 'z'))).rejects.toThrow()
      await expect(own('items:y', { ...recDoc('items', 'y'), parentTable: 'items' })).rejects.toThrow()
      // 項目の型（削除の印・分けた数・指紋・書いた端末・復元の印）も確かめる（受け取る端末が読めない文書を書かせない）
      await expect(own('items:y', { ...recDoc('items', 'y'), deleted: 'yes' })).rejects.toThrow()
      await expect(own('items:y', { ...recDoc('items', 'y'), chunks: 'x' })).rejects.toThrow()
      await expect(own('items:y', { ...recDoc('items', 'y'), hash: 1 })).rejects.toThrow()
      await expect(own('items:y', { ...recDoc('items', 'y'), device: null })).rejects.toThrow()
      await expect(own('items:y', { ...recDoc('items', 'y'), reset: 'true' })).rejects.toThrow()
      await expect(own('items:y', { ...recDoc('items', 'y'), reset: true })).resolves.toBeUndefined()
      await expect(own('items:y', recDoc('items', 'y'))).resolves.toBeUndefined()
      const chunk = (parent: string, parentTable: string | undefined, index: number) => ({
        table: '_chunk',
        parent,
        ...(parentTable ? { parentTable } : {}),
        index,
        json: 'x',
        hash: 'h',
        updated: serverTimestamp(),
        device: 'd',
        deleted: false,
      })
      // 分けた文書は parentTable が要り、parent の頭と合う物だけ（MIM の分けた文書に別の表の名前を付けられない）
      await expect(own('mimNotes:m#0', chunk('mimNotes:m', undefined, 0))).rejects.toThrow()
      await expect(own('mimNotes:m#0', chunk('mimNotes:m', 'items', 0))).rejects.toThrow()
      await expect(own('mimNotes:m#0', chunk('mimNotes:m', 'mimNotes', 1))).rejects.toThrow()
      await expect(own('mimNotes:m#0', chunk('mimNotes:m', 'mimNotes', 0))).resolves.toBeUndefined()
      await expect(own('itemPack:2025-03#0', chunk('itemPack:2025-03', 'itemPack', 0))).resolves.toBeUndefined()
      // 持ち主の記録はアプリから書き換えられない
      await expect(setDoc(doc(owner.fs, 'config', 'owner'), { uid: owner.uid, createdAt: serverTimestamp() })).rejects.toThrow()
      // config/connector は持ち主が読める（無ければ連携していない）・作れない
      expect((await getDoc(doc(owner.fs, 'config', 'connector'))).exists()).toBe(false)
      await expect(
        setDoc(doc(owner.fs, 'config', 'connector'), {
          uid: 'connector-anon',
          pairing: 'p',
          pairedAt: serverTimestamp(),
          approvedOn: 'PC',
          adds: true,
          edits: true,
          proposals: true,
          v: 1,
        }),
      ).rejects.toThrow()
      await expect(getDoc(doc(stranger.fs, 'config', 'connector'))).rejects.toThrow()
    } finally {
      await useRules(emuRules)
    }
  })

  it('本番のアクセスルール: データの形の版は持ち主だけが書け、下げられない', async () => {
    await useRules(prodRules)
    await emulatorRequest('DELETE', `/emulator/v1/projects/${PROJECT}/databases/(default)/documents`)
    try {
      const APP = { model: 1, appVersion: '0.1' }
      const owner = await makeDevice('owner', account(), { ownerLock: true, appModel: APP })
      await adminCreateOwner(owner.uid)
      await owner.online()
      const ref = appModelRef(owner.fs, owner.uid)
      await waitFor(async () => (await getDoc(ref)).data()?.model === 1, '持ち主が形の版を記録できる')
      await setDoc(ref, { model: 2, appVersion: '0.2', updatedAt: serverTimestamp() })
      await expect(setDoc(ref, { model: 1, appVersion: '0.1', updatedAt: serverTimestamp() })).rejects.toThrow()
      const stranger = await makeDevice('stranger', account())
      await expect(getDoc(appModelRef(stranger.fs, owner.uid))).rejects.toThrow()
    } finally {
      await useRules(emuRules)
    }
  })
})

describe('データの形の版（エミュレーター）', () => {
  const APP = { model: 1, appVersion: '0.1' }

  it('新しい版のアプリで書かれたデータがあると、受け取りは続け、送るのは止める。記録が消えたら書き直して送る', async () => {
    const who = account()
    const a = await makeDevice('a', who, { appModel: APP })
    const b = await makeDevice('b', who)
    await a.online()
    await b.online()
    const ref = appModelRef(a.fs, a.uid)
    await waitFor(async () => (await getDoc(ref)).data()?.model === 1, '形の版が記録される')
    await setDoc(ref, { model: 2, appVersion: '0.2', updatedAt: serverTimestamp() })
    await waitFor(async () => a.engine?.status.outdated?.model === 2, '古い版の端末が気付く')
    let bId = ''
    await b.edit((d) => {
      const r = addItem(d, { title: 'Bの予定' })
      bId = r.id
      return r.data
    })
    await waitFor(async () => (await a.load()).items[bId], 'B の変更が届く')
    let aId = ''
    await a.edit((d) => {
      const r = O.addFavorite(d, 'Aのやりたいこと')
      aId = r.result
      return r.data
    })
    await new Promise((r) => setTimeout(r, 1500))
    await a.engine?.idle()
    expect(await a.p.outboxCount()).toBeGreaterThan(0)
    expect(await cloud(a, `favorites:${aId}`)).toBeUndefined()
    await emulatorRequest('DELETE', `/v1/projects/${PROJECT}/databases/(default)/documents/users/${a.uid}/meta/app`)
    await waitFor(async () => (await getDoc(ref)).data()?.model === 1, '形の版が書き直される')
    await waitFor(async () => (await cloud(a, `favorites:${aId}`))?.deleted === false, '残していた変更が送られる')
    await settle(a, b)
  })
})

describe('月の束（エミュレーター。6.11）', () => {
  /** A に古い月の項目を入れて送り、B と揃えてから、A が束にまとめる */
  async function packed() {
    const who = account()
    const a = await makeDevice('a', who)
    const b = await makeDevice('b', who)
    await a.online()
    const olds = [oldItem('old-1', '去年の会議'), oldItem('old-2', '去年の打ち合わせ'), oldItem('old-3', '去年の面談')]
    await a.edit((d) => {
      let data = d
      for (const it of olds) data = putItem(data, it)
      return addItem(data, { title: '今月の予定' }).data
    })
    await settle(a)
    await b.online()
    await settle(a, b)
    const result = await a.engine!.maintain()
    return { who, a, b, olds, result }
  }

  it('古い月の項目を月ごとの1文書にまとめ、項目の文書は消す。もう一方の端末も項目を持ったまま束を覚える', async () => {
    const { a, b, olds, result } = await packed()
    expect(result.packed).toEqual({ '2025-03': 3 })
    const pack = (await cloud(a, 'itemPack:2025-03')) as RecordDoc
    const body = decodePack(pack.json!)!
    expect(Object.keys(body.items).sort()).toEqual(['old-1', 'old-2', 'old-3'])
    for (const it of olds) expect(await cloud(a, `items:${it.id}`)).toBeUndefined()
    await waitFor(async () => (await b.p.packsOf()).size === 3, 'B が束を覚える')
    await settle(a, b)
    expect(Object.keys((await b.load()).items)).toHaveLength(4)
    // もう一度呼んでも、まとめる物は無い
    expect((await a.engine!.maintain()).packed).toEqual({})
  })

  it('束の中の項目を直す・消すと、束から抜いて個別の文書を書く（もう一方の端末にも届く）', async () => {
    const { a, b } = await packed()
    await waitFor(async () => (await b.p.packsOf()).size === 3, 'B が束を覚える')
    await b.edit((d) => O.updateItem(d, 'old-1', { memo: 'Bで追記' }).data)
    await settle(a, b)
    expect((await a.load()).items['old-1'].memo).toBe('Bで追記')
    expect((await cloud(a, 'items:old-1'))?.deleted).toBe(false)
    const body = decodePack(((await cloud(a, 'itemPack:2025-03')) as RecordDoc).json!)!
    expect(Object.keys(body.items).sort()).toEqual(['old-2', 'old-3'])
    await a.edit((d) => T.trashItem(d, 'old-2').data)
    await settle(a, b)
    expect((await b.load()).items['old-2']).toBeUndefined()
    expect((await cloud(a, 'items:old-2'))?.deleted).toBe(true)
    expect(Object.keys(decodePack(((await cloud(a, 'itemPack:2025-03')) as RecordDoc).json!)!.items)).toEqual(['old-3'])
    // 束を知らない端末（_pack が空）でも、直接読んで束の中の項目を見つけ、消さずに直せる
    await b.p.clearPacks()
    await b.edit((d) => O.updateItem(d, 'old-3', { title: '束を知らずに直した' }).data)
    await settle(a, b)
    expect((await a.load()).items['old-3'].title).toBe('束を知らずに直した')
    // 全部抜けた束は items: {} のまま残る
    expect(decodePack(((await cloud(a, 'itemPack:2025-03')) as RecordDoc).json!)!.items).toEqual({})
  })

  it('いくつもの月の束の中の項目をまとめて直しても、書き直す束が 1回の書き込みの上限を超えないよう分けて送る', async () => {
    const who = account()
    const a = await makeDevice('a', who)
    await a.online()
    const march = ['三月の会議', '三月の面談', '三月の研修'].map((t, i) => oldItem(`m3-${i}`, t))
    const april = ['四月の会議', '四月の面談', '四月の研修'].map((t, i) => oldItem(`m4-${i}`, t, { start: '2025-04-10' }))
    await a.edit((d) => [...march, ...april].reduce(putItem, d))
    await settle(a)
    expect((await a.engine!.maintain()).packed).toEqual({ '2025-03': 3, '2025-04': 3 })
    const size = async (month: string) => ((await cloud(a, `itemPack:${month}`)) as RecordDoc).json!.length
    // 上限は「束1つと直した記録」は入り、「束2つ」は入らない大きさ
    const b = await makeDevice('b', who, { batchChars: (await size('2025-03')) + 1200 })
    await b.online()
    await settle(a, b)
    await waitFor(async () => (await b.p.packsOf()).size === 6, 'B が束を覚える')
    b.offline()
    await b.edit(
      (d) => O.updateItem(O.updateItem(d, 'm3-0', { memo: '三月を直した' }).data, 'm4-0', { memo: '四月を直した' }).data,
    )
    await b.online()
    await settle(a, b)
    expect((await a.load()).items['m3-0'].memo).toBe('三月を直した')
    expect((await a.load()).items['m4-0'].memo).toBe('四月を直した')
    for (const [month, left] of [
      ['2025-03', ['m3-1', 'm3-2']],
      ['2025-04', ['m4-1', 'm4-2']],
    ] as const) {
      const body = decodePack(((await cloud(a, `itemPack:${month}`)) as RecordDoc).json!)!
      expect(Object.keys(body.items).sort()).toEqual(left)
    }
  })

  it('新しい端末は束から項目を受け取る', async () => {
    const { who, a } = await packed()
    const c = await makeDevice('c', who)
    await c.online()
    await settle(a, c)
    expect(Object.keys((await c.load()).items).sort()).toEqual(expect.arrayContaining(['old-1', 'old-2', 'old-3']))
    expect((await c.p.packsOf()).get('old-1')).toBe('2025-03')
  })

  it('90日より前の削除の印を片付ける（内容から作った id の物は残す）。85日より前に受け取ったきりの端末は全部を受け取り直す', async () => {
    const who = account()
    const a = await makeDevice('a', who)
    const b = await makeDevice('b', who)
    await a.online()
    await b.online()
    const derived = { ...oldItem('ce-test.derived.1', 'Claude の予定'), start: '2026-11-01' }
    let plain = ''
    await a.edit((d) => {
      const r = addItem(putItem(d, derived), { title: '消す予定' })
      plain = r.id
      return r.data
    })
    await settle(a, b)
    // B はオフラインの間に、A で2つとも消された（B はそれを受け取らないまま、印が片付く）
    b.offline()
    await a.edit((d) => {
      const { [plain]: _x, [derived.id]: _y, ...items } = d.items
      void _x
      void _y
      return { ...d, items }
    })
    await settle(a)
    expect((await cloud(a, `items:${plain}`))?.deleted).toBe(true)
    const later = Date.now() + 100 * DAY_MS
    const r = await a.engine!.maintain(later)
    expect(r.purged).toBeGreaterThanOrEqual(1)
    expect(await cloud(a, `items:${plain}`)).toBeUndefined()
    expect((await cloud(a, `items:${derived.id}`))?.deleted).toBe(true)
    // B は 85日より前に受け取ったきり: 全部を受け取り直し、クラウドに無い記録を消す（送信待ちに積まず、ゴミ箱にも入れない）
    const bb = await makeDevice('b2', who, { now: () => later })
    await bb.p.setMeta('uid', b.uid)
    await bb.p.setMeta('syncSchema', SYNC_SCHEMA)
    await bb.p.setMeta('cursor', { s: Math.floor(Date.now() / 1000) - 10, n: 0 })
    await bb.p.save(
      (await bb.load()) as AppData,
      putItem(putItem(await bb.load(), (await b.load()).items[plain]), (await b.load()).items[derived.id]),
    )
    // 上の保存は送信待ちに積まれるので、揃えた後の状態（送信待ち無し）にする
    await bb.p.completeUpload([
      { table: 'items', id: plain, record: (await bb.load()).items[plain] },
      { table: 'items', id: derived.id, record: (await bb.load()).items[derived.id] },
    ])
    expect(await bb.p.outboxCount()).toBe(0)
    await bb.online()
    await waitFor(async () => !(await bb.load()).items[plain], '片付いた印の記録が消える')
    expect((await bb.load()).items[derived.id]).toBeUndefined()
    expect(await bb.p.outboxCount()).toBe(0)
    expect(Object.keys((await bb.load()).trashEntries)).toEqual([])
  })

  it('時計が進んでいる端末が手入れをしても、新しい削除の印は片付けない（境はサーバーの時刻）', async () => {
    const who = account()
    const a = await makeDevice('a', who, { now: () => Date.now() + 100 * DAY_MS })
    const b = await makeDevice('b', who)
    await a.online()
    await b.online()
    let id = ''
    await b.edit((d) => {
      const r = addItem(d, { title: '消す予定' })
      id = r.id
      return r.data
    })
    await settle(a, b)
    await b.edit((d) => {
      const { [id]: _x, ...items } = d.items
      void _x
      return { ...d, items }
    })
    await settle(a, b)
    expect((await cloud(a, `items:${id}`))?.deleted).toBe(true)
    // A の時計は 100日進んでいる（端末の時計だけで決めると、今日の削除の印が 90日より前に見える）
    const r = await a.engine!.maintain()
    expect(r.purged).toBe(0)
    expect((await cloud(a, `items:${id}`))?.deleted).toBe(true)
  })

  it('復元は束を開き、この端末に無い項目は消し、束の文書は消す', async () => {
    const { a, b } = await packed()
    await waitFor(async () => (await b.p.packsOf()).size === 3, 'B が束を覚える')
    await settle(a, b)
    // old-1 の無いバックアップを A で読み込む
    const d = await a.load()
    const { ['old-1']: _x, ...items } = d.items
    void _x
    await a.restore({ ...d, items })
    await settle(a, b)
    expect((await b.load()).items['old-1']).toBeUndefined()
    expect((await b.load()).items['old-2']).toBeDefined()
    expect(await cloud(a, 'itemPack:2025-03')).toBeUndefined()
    expect((await cloud(a, 'items:old-1'))?.deleted).toBe(true)
    expect((await cloud(a, 'items:old-2'))?.deleted).toBe(false)
  })
})

describe('受け取り箱（エミュレーター。19.5・形5）', () => {
  async function twoSynced() {
    const who = account()
    const a = await makeDevice('a', who)
    const b = await makeDevice('b', who)
    await a.online()
    await b.online()
    await settle(a, b)
    return { a, b }
  }

  it('同じ足す依頼を2台が同時に当てても、予定は1件・依頼は applied（競合にならない）', async () => {
    const { a, b } = await twoSynced()
    const { rec, itemId } = addRequest('xa-same-add')
    await connectorPut(a, rec)
    await waitFor(async () => (await a.load()).inbox[rec.id] && (await b.load()).inbox[rec.id], '両方に依頼が届く')
    await Promise.all([a.inbox((d, ctx) => I.processInbox(d, ctx)), b.inbox((d, ctx) => I.processInbox(d, ctx))])
    await settle(a, b)
    const d = await a.load()
    expect(Object.keys(d.items)).toEqual([itemId])
    expect(d.inbox[rec.id].status).toBe('applied')
    expect(d.items[itemId].by).toBe('connector')
    expect(Object.keys(d.trashEntries)).toEqual([])
    expect(a.notes).toEqual([])
    expect(b.notes).toEqual([])
  })

  it('同じ直す依頼・ゴミ箱へ移す依頼を2台が同時に当てても1回分（ゴミ箱の件も1つ）', async () => {
    const { a, b } = await twoSynced()
    let id = ''
    let favId = ''
    await a.edit((d) => {
      const r = addItem(d, { title: '打ち合わせ' })
      id = r.id
      const f = O.addFavorite(r.data, '本を読む')
      favId = f.result
      return f.data
    })
    await settle(a, b)
    const d0 = await a.load()
    const upd = inboxRec({
      id: 'xe-same-update',
      op: 'update',
      table: 'items',
      targetId: id,
      baseHash: revOf(d0.items[id]),
      patch: { start: '2026-12-05' },
      requestQuote: '12/5 に変えて',
    })
    const del = inboxRec({
      id: 'xe-same-trash',
      op: 'trash',
      table: 'favorites',
      targetId: favId,
      baseHash: revOf(d0.favorites[favId]),
      requestQuote: '消しておいて',
    })
    await connectorPut(a, upd)
    await connectorPut(a, del)
    await waitFor(async () => (await b.load()).inbox[del.id] && (await a.load()).inbox[del.id], '両方に依頼が届く')
    await Promise.all([a.inbox((d, ctx) => I.processInbox(d, ctx)), b.inbox((d, ctx) => I.processInbox(d, ctx))])
    await settle(a, b)
    const d = await b.load()
    expect(d.items[id].start).toBe('2026-12-05')
    expect(d.inbox[upd.id].status).toBe('applied')
    expect(d.inbox[del.id].status).toBe('applied')
    expect(d.favorites[favId]).toBeUndefined()
    expect(Object.keys(d.trashEntries)).toEqual([`te-${del.id}`])
    expect(d.trashEntries[`te-${del.id}`].inboxId).toBe(del.id)
    // 元に戻す控えのある組が残る（6.10）
    expect((d.inbox[upd.id].undo as { before?: unknown } | null)?.before).toBeDefined()
    // 後から after: の依頼を作っても、指紋が合って当たる（形2）
    const next = inboxRec({
      id: 'xe-after',
      op: 'update',
      table: 'items',
      targetId: id,
      baseHash: `after:${upd.id}`,
      patch: { title: '打ち合わせ（変更）' },
      requestQuote: '件名も変えて',
    })
    await connectorPut(a, next)
    await waitFor(async () => (await a.load()).inbox[next.id], '次の依頼が届く')
    await a.inbox((x, ctx) => I.processInbox(x, ctx))
    await settle(a, b)
    expect((await b.load()).inbox[next.id].status).toBe('applied')
  })

  it('依頼を当てた書き込みは1つのまとまりで届く。記録だけが先に届いた端末が断っても、結果は applied にまとまる', async () => {
    const { a, b } = await twoSynced()
    const { rec, itemId } = addRequest('xa-record-first')
    await connectorPut(a, rec)
    await waitFor(async () => (await a.load()).inbox[rec.id] && (await b.load()).inbox[rec.id], '両方に依頼が届く')
    b.offline()
    await a.inbox((d, ctx) => I.processInbox(d, ctx))
    await settle(a)
    expect((await cloud(a, `inbox:${rec.id}`))?.json).toContain('"applied"')
    // B には予定の記録だけが先に届いた（依頼はまだ待っている）: B は duplicate で断る
    const item = (await a.load()).items[itemId]
    await b.p.applyRemote([{ table: 'items', id: itemId, record: item }], {
      device: 'b',
      trashCopy: () => [],
    })
    await b.inbox((d, ctx) => I.processInbox(d, ctx))
    expect((await b.load()).inbox[rec.id].status).toBe('rejected')
    await b.online()
    await settle(a, b)
    for (const dev of [a, b]) {
      const d = await dev.load()
      expect(d.inbox[rec.id].status).toBe('applied')
      expect((d.inbox[rec.id].undo as { created?: boolean })?.created).toBe(true)
      expect(Object.keys(d.items)).toEqual([itemId])
    }
  })

  it('同じ提案に2台で別々に答えても（片方で［承認］・片方で［拒否］）、accepted の組にまとまる', async () => {
    const { a, b } = await twoSynced()
    let id = ''
    await a.edit((d) => {
      const r = addItem(d, { title: '打ち合わせ', start: '2026-12-03' })
      id = r.id
      return r.data
    })
    await settle(a, b)
    const proposal = inboxRec({
      id: 'xp-two-answers',
      op: 'propose',
      proposeOp: 'update',
      table: 'items',
      targetId: id,
      baseHash: revOf((await a.load()).items[id]),
      patch: { start: '2026-12-05' },
      why: '山田さんから、12/5 に変えるとメールがありました',
      via: 'メール: 【変更】打ち合わせは 12/5 に',
    })
    await connectorPut(a, proposal)
    await waitFor(async () => (await a.load()).inbox[proposal.id] && (await b.load()).inbox[proposal.id], '提案が届く')
    for (const dev of [a, b]) await dev.inbox((d, ctx) => I.processInbox(d, ctx))
    await settle(a, b)
    expect((await a.load()).inbox[proposal.id].status).toBe('pending')
    a.offline()
    b.offline()
    await a.inbox((d, ctx) => {
      const r = I.answerProposal(d, proposal.id, 'accept', ctx)
      return { data: r.data, touched: r.touched }
    })
    await b.inbox((d, ctx) => {
      const r = I.answerProposal(d, proposal.id, 'decline', ctx)
      return { data: r.data, touched: r.touched }
    })
    await b.online()
    await settle(b)
    await a.online()
    await settle(a, b)
    for (const dev of [a, b]) {
      const d = await dev.load()
      expect(d.inbox[proposal.id].status).toBe('accepted')
      expect(d.inbox[proposal.id].answeredVia).toBe('app')
      expect(d.items[id].start).toBe('2026-12-05')
    }
  })

  it('オフラインで当てた端末がつながっても、ほかの端末が当ててからゴミ箱へ移した予定・元に戻した予定は生き返らない', async () => {
    const { a, b } = await twoSynced()
    for (const undo of [false, true]) {
      const { rec, itemId } = undo
        ? addRequest('xa-late-undo', '元に戻す予定', '<mail-undo@example.com>')
        : addRequest('xa-late-trash', 'ゴミ箱の予定', '<mail-trash@example.com>')
      await connectorPut(a, rec)
      await waitFor(async () => (await a.load()).inbox[rec.id] && (await b.load()).inbox[rec.id], '両方に依頼が届く')
      b.offline()
      await b.inbox((d, ctx) => I.processInbox(d, ctx))
      await a.inbox((d, ctx) => I.processInbox(d, ctx))
      await settle(a)
      if (undo) {
        await a.inbox((d, ctx) => {
          const r = I.undoRequest(d, rec.id, ctx)
          return { data: r.data, touched: r.touched }
        })
      } else await a.edit((d) => T.trashItem(d, itemId).data)
      await settle(a)
      await b.online()
      await settle(a, b)
      for (const dev of [a, b]) {
        const d = await dev.load()
        expect(d.items[itemId]).toBeUndefined()
        expect(Object.values(d.trashEntries).filter((e) => e.label === (undo ? '元に戻す予定' : 'ゴミ箱の予定'))).toHaveLength(1)
        expect(d.inbox[rec.id].status).toBe('applied')
        if (undo) expect(d.inbox[rec.id].undoneAt).not.toBeNull()
      }
      expect((await cloud(a, `items:${itemId}`))?.deleted).toBe(true)
    }
    expect(a.notes).toEqual([])
    expect(b.notes).toEqual([])
  })

  it('オフラインで当ててすぐ消した予定は、ほかの端末が同じ依頼で作った予定が届いても戻らず、全部の端末から消える', async () => {
    const { a, b } = await twoSynced()
    const { rec, itemId } = addRequest('xa-late-delete', 'すぐ消す予定')
    await connectorPut(a, rec)
    await waitFor(async () => (await a.load()).inbox[rec.id] && (await b.load()).inbox[rec.id], '両方に依頼が届く')
    b.offline()
    await b.inbox((d, ctx) => I.processInbox(d, ctx))
    await b.edit((d) => T.trashItem(d, itemId).data)
    await a.inbox((d, ctx) => I.processInbox(d, ctx))
    await settle(a)
    expect((await a.load()).items[itemId]).toBeDefined()
    await b.online()
    await settle(a, b)
    for (const dev of [a, b]) {
      const d = await dev.load()
      expect(d.items[itemId]).toBeUndefined()
      expect(Object.keys(d.trashEntries)).toHaveLength(1)
    }
    expect((await cloud(a, `items:${itemId}`))?.deleted).toBe(true)
  })

  it('遅れて同じ直す依頼を当てた端末の値が、その後にほかの端末で手で直した値に勝たない', async () => {
    const { a, b } = await twoSynced()
    let id = ''
    await a.edit((d) => {
      const r = addItem(d, { title: '打ち合わせ' })
      id = r.id
      return r.data
    })
    await settle(a, b)
    const upd = inboxRec({
      id: 'xe-late-update',
      op: 'update',
      table: 'items',
      targetId: id,
      baseHash: revOf((await a.load()).items[id]),
      patch: { title: '打ち合わせ（Claude）' },
      requestQuote: '件名を変えて',
    })
    await connectorPut(a, upd)
    await waitFor(async () => (await a.load()).inbox[upd.id] && (await b.load()).inbox[upd.id], '両方に依頼が届く')
    b.offline()
    await b.inbox((d, ctx) => I.processInbox(d, ctx))
    await a.inbox((d, ctx) => I.processInbox(d, ctx))
    await settle(a)
    await a.edit((d) => O.updateItem(d, id, { title: '打ち合わせ（手で直した）' }).data)
    await settle(a)
    await b.online()
    await settle(a, b)
    for (const dev of [a, b]) {
      const d = await dev.load()
      expect(d.items[id].title).toBe('打ち合わせ（手で直した）')
      expect(d.inbox[upd.id].status).toBe('applied')
    }
  })

  it('依頼で作った内容から作った id の予定を消すと、送る前でも削除の印が残り、同じ依頼をまた作っても previously_deleted', async () => {
    const { a, b } = await twoSynced()
    const { rec, itemId } = addRequest('xa-gone-1')
    await connectorPut(a, rec)
    await waitFor(async () => (await a.load()).inbox[rec.id], '依頼が届く')
    a.offline()
    await a.inbox((d, ctx) => I.processInbox(d, ctx))
    // 送る前に消した
    await a.edit((d) => {
      const { [itemId]: _x, ...items } = d.items
      void _x
      return { ...d, items }
    })
    await a.online()
    await settle(a, b)
    expect((await cloud(a, `items:${itemId}`))?.deleted).toBe(true)
    expect((await b.p.goneKeys()).has(`items/${itemId}`)).toBe(true)
    // 同じメールから、もう一度足す依頼が来た（B が当てる）
    const again = { ...addRequest('xa-gone-2').rec }
    await connectorPut(b, again)
    await waitFor(async () => (await b.load()).inbox[again.id], '依頼が届く')
    await b.inbox((d, ctx) => I.processInbox(d, ctx))
    await settle(a, b)
    expect((await a.load()).inbox[again.id].reason).toBe('previously_deleted')
    expect((await a.load()).items[itemId]).toBeUndefined()
  })
})
