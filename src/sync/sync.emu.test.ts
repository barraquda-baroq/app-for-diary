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
  deleteDoc,
  disableNetwork,
  doc,
  enableNetwork,
  getDoc,
  getDocs,
  initializeFirestore,
  memoryLocalCache,
  serverTimestamp,
  setDoc,
  terminate,
  type Firestore,
  type Timestamp,
} from 'firebase/firestore'
import emuRules from '../../firestore.emu.rules?raw'
import prodRules from '../../firestore.rules?raw'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPersistence, type ConflictNote, type Persistence, type ReplaceOptions } from '../db/persistence'
import {
  adminCreateOwner,
  adminDeleteOwner,
  adminRecordIds,
  clearFirestore,
  EMU_PROJECT,
  emulatorRequest,
  useRules,
} from '../test/emulatorAdmin'
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
import { createSyncEngine, FULL_RESYNC_NOTICE, SYNC_SCHEMA, type SyncEngine, type SyncStatus, type SyncTarget } from './engine'
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
  /** 次のトランザクション・まとめた書き込みの前に1回だけ動かす（読んだ後・書く前に、ほかの端末が書いた時の再現） */
  beforeWrite: new Map<unknown, () => Promise<void>>(),
  /** Firestore ごとの、記録の購読（問い合わせの onSnapshot）を始めた回数 */
  queries: new Map<unknown, number>(),
  /** 記録の購読（問い合わせ）を、すぐに resource-exhausted（無料枠を使い切った）で止める Firestore */
  failQuery: new Set<unknown>(),
  /** 次のサーバーからの通知を渡した直後に、その購読を resource-exhausted で止める Firestore（その後の購読も failQuery で止める） */
  errorAfterServer: new Set<unknown>(),
  /** Firestore ごとの、トランザクションの中で読んだ文書の数 */
  txGets: new Map<unknown, number>(),
}))
vi.mock('firebase/firestore', async (importOriginal) => {
  const m = await importOriginal<typeof import('firebase/firestore')>()
  type Snap = {
    docChanges?: () => { doc: { data: () => { device?: unknown } } }[]
    metadata?: { fromCache: boolean }
  }
  const quota = () =>
    Object.assign(new Error('無料枠を使い切りました（テスト）'), { name: 'FirebaseError', code: 'resource-exhausted' })
  const onSnapshot = (ref: { firestore: unknown; path?: string }, ...rest: unknown[]) => {
    if (!ref.path) listen.queries.set(ref.firestore, (listen.queries.get(ref.firestore) ?? 0) + 1)
    const i = rest.findIndex((x) => typeof x === 'function')
    const next = rest[i] as (snap: Snap) => void
    const onError = rest[i + 1] as ((e: unknown) => void) | undefined
    if (!ref.path && listen.failQuery.has(ref.firestore)) {
      const t = setTimeout(() => onError?.(quota()), 20)
      return () => clearTimeout(t)
    }
    let stopped = false
    rest[i] = (snap: Snap) => {
      if (stopped) return
      if (!ref.path && listen.errorAfterServer.has(ref.firestore) && snap.metadata && !snap.metadata.fromCache) {
        listen.errorAfterServer.delete(ref.firestore)
        listen.failQuery.add(ref.firestore)
        stopped = true
        next(snap)
        setTimeout(() => onError?.(quota()), 0)
        return
      }
      if (listen.deaf.has(ref.firestore) && !ref.path?.endsWith('/meta/app')) return
      const own = listen.dropOwn.get(ref.firestore)
      const changes = own && snap.docChanges ? snap.docChanges() : []
      if (own && changes.length && changes.every((c) => c.doc.data().device === own)) return
      next(snap)
    }
    return (m.onSnapshot as unknown as (...a: unknown[]) => () => void)(ref, ...rest)
  }
  const beforeWrite = async (fs: unknown) => {
    const hook = listen.beforeWrite.get(fs)
    if (!hook) return
    listen.beforeWrite.delete(fs)
    await hook()
  }
  const writeBatch = ((fs: unknown) => {
    const batch = (m.writeBatch as unknown as (f: unknown) => { commit: () => Promise<void> })(fs)
    const commit = batch.commit.bind(batch)
    batch.commit = async () => {
      await beforeWrite(fs)
      return commit()
    }
    return batch
  }) as unknown as typeof m.writeBatch
  const runTransaction = (async (fs: unknown, ...rest: unknown[]) => {
    await beforeWrite(fs)
    if (listen.offline.has(fs))
      throw Object.assign(new Error('通信できません（テスト）'), { name: 'FirebaseError', code: 'unavailable' })
    type Tx = { get: (ref: unknown) => Promise<unknown> }
    const fn = rest[0] as (tx: Tx) => Promise<unknown>
    rest[0] = (tx: Tx) => {
      const get = tx.get.bind(tx)
      tx.get = (ref: unknown) => {
        listen.txGets.set(fs, (listen.txGets.get(fs) ?? 0) + 1)
        return get(ref)
      }
      return fn(tx)
    }
    const r = await (m.runTransaction as unknown as (...a: unknown[]) => Promise<unknown>)(fs, ...rest)
    if (listen.loseReply.delete(fs))
      throw Object.assign(new Error('返事を受け取れませんでした（テスト）'), { name: 'FirebaseError', code: 'unavailable' })
    return r
  }) as unknown as typeof m.runTransaction
  return { ...m, onSnapshot, runTransaction, writeBatch }
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
  /** エンジンのお知らせ（onNotice。全部を受け取り直した時など） */
  notices: string[]
  /** エンジンの同期の状態の移り変わり（onStatus） */
  statuses: SyncStatus[]
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
  listen.beforeWrite.clear()
  listen.queries.clear()
  listen.failQuery.clear()
  listen.errorAfterServer.clear()
  listen.txGets.clear()
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
  opts: {
    chunkSize?: number
    batchChars?: number
    ownerLock?: boolean
    appModel?: AppModel
    now?: () => number
    /** 端末の中の保存先の名前（同じ名前で作ると、アプリを開き直した端末になる） */
    dbName?: string
  } = {},
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
  const p = createPersistence(opts.dbName ?? `emu-${name}-${seq}-${Math.random().toString(36).slice(2)}`)
  const notes: ConflictNote[] = []
  const notices: string[] = []
  const statuses: SyncStatus[] = []
  const hooksFor = async () => {
    const before = repairData(await p.load()).data
    return createConflictHooks({ device: name, data: () => before, newId, report: (n) => notes.push(n) })
  }
  const target: SyncTarget = {
    readOutbox: (n) => p.readOutbox(n),
    completeUpload: (s) => p.completeUpload(s),
    markUnconfirmed: (rows, tx) => p.markUnconfirmed(rows, tx),
    unconfirmedTx: (keys) => p.unconfirmedTx(keys),
    confirmLanded: (tx) => p.confirmLanded(tx),
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
    notices,
    statuses,
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
        onNotice: (m) => notices.push(m),
        onStatus: (st) => statuses.push(st),
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
  // 作った時刻と直した時刻は同じ値（createdAt だけを渡した時も。待っている依頼は updatedAt = createdAt の形だけ）
  const at = p.createdAt ?? Date.now()
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
    updatedAt: p.updatedAt ?? at,
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

  it('返事を受け取れなかった書き込みの上にほかの端末が書いた版は、送った内容を base にして合わせる（送る書き込みの印）', async () => {
    const who = account()
    const a = await makeDevice('a', who)
    const b = await makeDevice('b', who)
    await a.online()
    await b.online()
    let id = ''
    await a.edit((d) => {
      const r = addItem(d, { title: '元の題名' })
      id = r.id
      return r.data
    })
    await settle(a, b)
    // A の書き込みはクラウドに届くが返事が無く、A は自分の書き込みの通知も受け取らないまま閉じる
    listen.loseReply.add(a.fs)
    listen.deaf.add(a.fs)
    await a.edit((d) => O.updateItem(d, id, { title: 'Aの題名', memo: 'Aが書いた' }).data)
    await waitFor(async () => (await b.load()).items[id]?.title === 'Aの題名', 'A の書き込みが B に届く')
    await waitFor(async () => (await a.p.readOutbox(5))[0]?.unconfirmed, 'A は返事を受け取っていない')
    a.offline()
    // B は A の版の上で、題名を戻し、メモに足した
    await b.edit((d) => O.updateItem(d, id, { title: '元の題名', memo: 'Aが書いた\nBが足した' }).data)
    await settle(b)
    // A は閉じている間にも直した（送信待ちが残る）。開き直すと、印で A の書き込みが届いていたと分かる
    await a.edit((d) => O.updateItem(d, id, { requester: 'A社' }).data)
    listen.deaf.delete(a.fs)
    await a.online()
    await settle(a, b)
    const got = (await b.load()).items[id]
    expect(got.title).toBe('元の題名')
    expect(got.memo).toBe('Aが書いた\nBが足した')
    expect(got.requester).toBe('A社')
    expect(a.notes).toEqual([])
    expect((await getDoc(doc(a.fs, 'users', a.uid, 'sync', 'a'))).data()?.tx).toEqual(expect.any(String))
  })

  it('送れない間に受け取った時も、送る書き込みの印で届いていた書き込みに気付き、送った内容を base にして合わせる', async () => {
    const who = account()
    const a = await makeDevice('a', who)
    const b = await makeDevice('b', who)
    await a.online()
    await b.online()
    let id = ''
    await a.edit((d) => {
      const r = addItem(d, { title: '元の題名' })
      id = r.id
      return r.data
    })
    await settle(a, b)
    listen.loseReply.add(a.fs)
    listen.deaf.add(a.fs)
    await a.edit((d) => O.updateItem(d, id, { title: 'Aの題名', memo: 'Aが書いた' }).data)
    await waitFor(async () => (await b.load()).items[id]?.title === 'Aの題名', 'A の書き込みが B に届く')
    await waitFor(async () => (await a.p.readOutbox(5))[0]?.unconfirmed, 'A は返事を受け取っていない')
    a.offline()
    await b.edit((d) => O.updateItem(d, id, { title: '元の題名', memo: 'Aが書いた\nBが足した' }).data)
    await settle(b)
    await a.edit((d) => O.updateItem(d, id, { requester: 'A社' }).data)
    // 開き直した A は送れない（送るトランザクションが通信できずに失敗する）が、受け取れる: 受け取る時に印を読んで気付く
    listen.deaf.delete(a.fs)
    listen.offline.add(a.fs)
    await a.online()
    await waitFor(async () => (await a.load()).items[id]?.memo === 'Aが書いた\nBが足した', 'A が B の版を受け取る')
    const got = (await a.load()).items[id]
    expect(got.title).toBe('元の題名')
    expect(got.requester).toBe('A社')
    listen.offline.delete(a.fs)
    a.engine?.requestUpload(true)
    await settle(a, b)
    expect((await b.load()).items[id]).toMatchObject({ title: '元の題名', memo: 'Aが書いた\nBが足した', requester: 'A社' })
    expect(a.notes).toEqual([])
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

  it('返事を受け取れなかった書き込みの後で、次に送る前に復元しても、復元を始めた後にほかの端末が直した記録と合わせる時に復元の内容が勝つ', async () => {
    const who = account()
    const a = await makeDevice('a', who)
    const b = await makeDevice('b', who)
    await a.online()
    await b.online()
    let id = ''
    await a.edit((d) => {
      const r = addItem(d, { title: '元の題名' })
      id = r.id
      return r.data
    })
    await settle(a, b)
    const backup = await a.load()
    // A の書き込みは届くが、返事も自分の書き込みの通知も受け取らないまま閉じる
    listen.loseReply.add(a.fs)
    listen.deaf.add(a.fs)
    await a.edit((d) => O.updateItem(d, id, { title: 'Aの題名' }).data)
    await waitFor(async () => (await b.load()).items[id]?.title === 'Aの題名', 'A の書き込みが B に届く')
    await waitFor(async () => (await a.p.readOutbox(5))[0]?.unconfirmed, 'A は返事を受け取っていない')
    a.offline()
    listen.deaf.delete(a.fs)
    await a.restore(backup)
    // 復元の境を決めた後・最初の送信の前に、B がメモを足した
    listen.beforeWrite.set(a.fs, async () => {
      await b.edit((d) => O.updateItem(d, id, { memo: 'Bが足した' }).data)
      await settle(b)
    })
    await a.online()
    await settle(a, b)
    expect((await b.load()).items[id]).toMatchObject({ title: '元の題名', memo: 'Bが足した' })
    expect(a.notes).toEqual([])
  })

  it('返事を受け取れなかった書き込みの後で、復元を始める前にほかの端末が直した記録は、届いていた書き込みを確かめた上で復元の内容で上書きする', async () => {
    const who = account()
    const a = await makeDevice('a', who)
    const b = await makeDevice('b', who)
    await a.online()
    await b.online()
    let id = ''
    await a.edit((d) => {
      const r = addItem(d, { title: '元の題名' })
      id = r.id
      return r.data
    })
    await settle(a, b)
    const backup = await a.load()
    listen.loseReply.add(a.fs)
    listen.deaf.add(a.fs)
    await a.edit((d) => O.updateItem(d, id, { title: 'Aの題名' }).data)
    await waitFor(async () => (await b.load()).items[id]?.title === 'Aの題名', 'A の書き込みが B に届く')
    await waitFor(async () => (await a.p.readOutbox(5))[0]?.unconfirmed, 'A は返事を受け取っていない')
    a.offline()
    listen.deaf.delete(a.fs)
    // 復元を始める前に、B がメモを足した（A はまだ受け取っていない）
    await b.edit((d) => O.updateItem(d, id, { memo: 'Bが足した' }).data)
    await settle(b)
    await a.restore(backup)
    await a.online()
    await settle(a, b)
    expect((await b.load()).items[id]).toMatchObject({ title: '元の題名', memo: '' })
  })

  it('送っている書き込みの途中で復元しても（ほかのタブで読み込んだ時など）、次の分を送る前にクラウドに当て、送り終わる', async () => {
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
    const backup = await a.load()
    await a.edit((d) => addItem(d, { title: 'バックアップの後の予定' }).data)
    await b.edit((d) => addItem(d, { title: 'B が足した予定' }).data)
    await settle(a, b)
    // A が送っている書き込み（送信待ちを読んだ後）の途中で、復元した
    listen.beforeWrite.set(a.fs, () => a.restore(backup))
    await a.edit((d) => addItem(d, { title: '送っている予定' }).data)
    const done = await Promise.race([
      a.engine!.idle().then(() => true),
      new Promise<false>((r) => setTimeout(() => r(false), 10_000)),
    ])
    expect(done).toBe(true)
    expect(listen.beforeWrite.has(a.fs)).toBe(false)
    expect(await a.p.outboxCount()).toBe(0)
    expect(await a.p.getMeta('authoritative')).toBeNull()
    await settle(a, b)
    expect(Object.keys((await b.load()).items)).toEqual([keepId])
  })

  it('復元をクラウドに当てている間にもう一度復元したら、後の復元を始める前にほかの端末が足した記録も消す', async () => {
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
    const right = await a.load()
    await a.edit((d) => addItem(d, { title: '違うファイルの予定' }).data)
    await settle(a, b)
    const wrong = await a.load()
    a.offline()
    await b.edit((d) => addItem(d, { title: 'B が前に足した予定' }).data)
    await settle(b)
    // 違うファイルを読み込んだ。クラウドに当てている間（B が前に足した予定に削除の印を書く前）に、B が足し、正しいファイルを読み込み直した
    await a.restore(wrong)
    let hooked = false
    listen.beforeWrite.set(a.fs, async () => {
      hooked = true
      await b.edit((d) => addItem(d, { title: 'B が後で足した予定' }).data)
      await settle(b)
      await a.restore(right)
    })
    await a.online()
    await settle(a, b)
    expect(hooked).toBe(true)
    expect(Object.keys((await b.load()).items)).toEqual([keepId])
    expect(await a.p.getMeta('authoritative')).toBeNull()
  })

  it('初めての受け取りの前に受け取りが止まったら（無料枠を使い切った）、最初の受け取りまで送らない項目だけの送信の後も、その理由を出したままにする', async () => {
    const who = account()
    const seed = await makeDevice('seed', who)
    await seed.online()
    await seed.edit((d) => addItem(d, { title: 'クラウドの予定' }).data)
    await settle(seed)
    seed.offline()
    // 段階0から上がった端末（共通の履歴が無い項目だけを持つ。最初の受け取りが終わるまで送らない。6.11）
    const a = await makeDevice('a', who)
    await a.edit((d) => addItem(d, { title: '端末の予定' }).data)
    listen.failQuery.add(a.fs)
    await a.online()
    await waitFor(async () => a.engine?.status.errorCode === 'quota', '無料枠を使い切った誤りが出る')
    a.engine!.requestUpload(true)
    await a.engine!.idle()
    expect(a.engine!.status).toMatchObject({ phase: 'error', errorCode: 'quota' })
    // 受け取りが戻ると、受け取ってから送る
    listen.failQuery.delete(a.fs)
    await waitFor(async () => a.engine?.status.phase === 'synced', '受け取りが戻る', 30_000)
    await settle(a)
    expect(Object.keys((await a.load()).items)).toHaveLength(2)
  })

  it('サーバーからの通知を反映している間に受け取りが止まったら（無料枠を使い切った）、反映し終えても「同期済み」にしない', async () => {
    const who = account()
    const a = await makeDevice('a', who)
    const b = await makeDevice('b', who)
    await a.online()
    await b.online()
    await a.edit((d) => addItem(d, { title: '予定' }).data)
    await settle(a, b)
    await waitFor(async () => a.engine?.status.phase === 'synced', 'A が揃う')
    const from = a.statuses.length
    listen.errorAfterServer.add(a.fs)
    await b.edit((d) => addItem(d, { title: 'B の予定' }).data)
    await waitFor(async () => a.statuses.slice(from).some((st) => st.errorCode === 'quota'), '受け取りが止まる')
    await new Promise((r) => setTimeout(r, 500))
    expect(a.engine!.status).toMatchObject({ phase: 'error', errorCode: 'quota' })
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
    // 暦の日付は1回だけ読む（送って揃うまでの間に日付が変わっても落ちないように）
    const day = today()
    await a.edit((d) => {
      let data = addItem(d, { title: '会議', startTime: '10:00', endTime: '11:00', start: day }).data
      data = O.addItem(data, { origin: 'list', title: 'タスク', due: day }).data
      data = O.setOffDay(data, '2026-11-23', true)
      data = O.setLabelName(data, 'sky-l', '会議')
      const r = O.addRoutine(data, { title: '朝の体操', cycle: 'daily' })
      routineId = r.result
      data = O.checkRoutine(r.data, routineId, day)
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
    expect(Object.values(d.routineChecks).flatMap((c) => c.dates)).toEqual([day])
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
  // テストが時間切れで終わっても、次のテストを本番のルールのまま流さない
  afterEach(() => useRules(emuRules))

  it('持ち主の記録が無い時は同期を始めず、アプリからは config/owner を作れない', async () => {
    await useRules(prodRules)
    await clearFirestore()
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
    await clearFirestore()
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
      // 送る書き込みの印は持ち主だけが書け、形は { tx } だけ
      const mark = (fs: Firestore, uid: string, data: object) => setDoc(doc(fs, 'users', uid, 'sync', 'dev-1'), data)
      expect((await getDoc(doc(owner.fs, 'users', owner.uid, 'sync', 'owner'))).data()?.tx).toEqual(expect.any(String))
      await expect(mark(owner.fs, owner.uid, { tx: 't-1' })).resolves.toBeUndefined()
      await expect(mark(owner.fs, owner.uid, { tx: 't-1', junk: 1 })).rejects.toThrow()
      await expect(mark(owner.fs, owner.uid, { tx: 1 })).rejects.toThrow()
      await expect(mark(owner.fs, owner.uid, { tx: 'x'.repeat(65) })).rejects.toThrow()
      await expect(mark(stranger.fs, stranger.uid, { tx: 't-1' })).rejects.toThrow()
      await expect(getDoc(doc(stranger.fs, 'users', owner.uid, 'sync', 'dev-1'))).rejects.toThrow()
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
    await clearFirestore()
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
  // テストが時間切れで終わっても、次のテストを本番のルールのまま流さない
  afterEach(() => useRules(emuRules))

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

  it('形の版の見張りが誤りで止まっても（持ち主の記録を移す途中など）、見張り直して、後で上がった版に気付く（本番のアクセスルール）', async () => {
    await useRules(prodRules)
    await clearFirestore()
    try {
      const a = await makeDevice('a', account(), { ownerLock: true, appModel: APP })
      await adminCreateOwner(a.uid)
      await a.online()
      const ref = appModelRef(a.fs, a.uid)
      await waitFor(async () => (await getDoc(ref)).data()?.model === 1, '形の版が記録される')
      await settle(a)
      // 持ち主の記録が無い間につなぎ直した: 見張りはどれも permission-denied で止まる（記録の購読が受け取り直すまで、その誤りの
      // ままにする。移り変わりの全部で確かめる）
      const from = a.statuses.length
      await adminDeleteOwner()
      await disableNetwork(a.fs)
      await enableNetwork(a.fs)
      await waitFor(async () => a.statuses.slice(from).some((st) => st.errorCode === 'permission-denied'), '読めなくなる')
      await new Promise((r) => setTimeout(r, 500))
      expect(a.engine?.status.errorCode).toBe('permission-denied')
      // 送る物の無い送信が終わっても、受け取りが止まっている間は「同期済み」に戻さない
      a.engine!.requestUpload(true)
      await a.engine!.idle()
      expect(a.engine?.status.errorCode).toBe('permission-denied')
      // 記録が戻った後に、新しい版のアプリが形の版を上げた
      await adminCreateOwner(a.uid)
      await waitFor(async () => a.engine?.status.phase === 'synced', '受け取りが戻る', 30_000)
      await emulatorRequest('PATCH', `/v1/projects/${PROJECT}/databases/(default)/documents/users/${a.uid}/meta/app`, {
        fields: {
          model: { integerValue: '2' },
          appVersion: { stringValue: '0.2' },
          updatedAt: { timestampValue: new Date().toISOString() },
        },
      })
      await waitFor(async () => a.engine?.status.outdated?.model === 2, '古い版の端末が気付く', 30_000)
      let aId = ''
      await a.edit((d) => {
        const r = O.addFavorite(d, '古い版で足した')
        aId = r.result
        return r.data
      })
      await new Promise((r) => setTimeout(r, 1500))
      await a.engine?.idle()
      expect(await cloud(a, `favorites:${aId}`)).toBeUndefined()
      expect(await a.p.outboxCount()).toBeGreaterThan(0)
    } finally {
      await useRules(emuRules)
    }
  }, 120_000)
})

describe('月の束（エミュレーター。6.11）', () => {
  /** 束にまとめる手入れの時刻（項目の文書も、書いてから 60日たった物だけを束に入れる。6.11） */
  const packTime = () => Date.now() + 61 * DAY_MS

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
    const result = await a.engine!.maintain(packTime())
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
    expect((await a.engine!.maintain(packTime())).packed).toEqual({})
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
    expect((await a.engine!.maintain(packTime())).packed).toEqual({ '2025-03': 3, '2025-04': 3 })
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
    // クラウドのいちばん新しい書き込みも B の時計で 85日より前だが、受け取り直すのは1回だけ（揃った時から測る）
    await expectResyncSettled(bb, 1)
  })

  /** 少し待っても、全部の受け取り直しが times 回のままで、記録の購読を始め直し続けていない */
  async function expectResyncSettled(d: Device, times: number): Promise<void> {
    await new Promise((r) => setTimeout(r, 1500))
    const subs = listen.queries.get(d.fs) ?? 0
    await new Promise((r) => setTimeout(r, 1500))
    expect(d.notices.filter((m) => m === FULL_RESYNC_NOTICE)).toHaveLength(times)
    expect(listen.queries.get(d.fs) ?? 0).toBe(subs)
    expect(subs).toBeLessThanOrEqual(times + 3)
  }

  /** クラウドの記録の文書の更新時刻を、管理者の権限で ms だけ前にする（長く書き込みの無かったクラウドの再現） */
  async function ageRecords(uid: string, ms: number): Promise<void> {
    const at = new Date(Date.now() - ms).toISOString()
    for (const id of await adminRecordIds(uid))
      await emulatorRequest(
        'PATCH',
        `/v1/projects/${PROJECT}/databases/(default)/documents/users/${uid}/records/${encodeURIComponent(id)}?updateMask.fieldPaths=updated`,
        { fields: { updated: { timestampValue: at } } },
      )
  }

  it('クラウドに 85日より前の書き込みしか無くても、全部を受け取り直すのを繰り返さない（新しい端末・長く使っていなかった端末）', async () => {
    const who = account()
    const a = await makeDevice('a', who)
    await a.online()
    await a.edit((d) => addItem(addItem(d, { title: '一つめ' }).data, { title: '二つめ' }).data)
    await settle(a)
    a.offline()
    // 86日、誰も書いていない
    await ageRecords(a.uid, 86 * DAY_MS)
    // 新しい端末: 初めての受け取りで、受け取り直しはしない
    const c = await makeDevice('c', who)
    await c.online()
    await waitFor(async () => Object.keys((await c.load()).items).length === 2, 'C が受け取る')
    await expectResyncSettled(c, 0)
    // 86日前に揃ったきりの端末: 1回だけ受け取り直す
    const dbName = `emu-d-idle-${Math.random().toString(36).slice(2)}`
    const d1 = await makeDevice('d', who, { dbName })
    await d1.p.setMeta('uid', a.uid)
    await d1.p.setMeta('syncSchema', SYNC_SCHEMA)
    await d1.p.setMeta('cursor', { s: Math.floor((Date.now() - 86 * DAY_MS) / 1000), n: 0 })
    await d1.p.setMeta('caughtUpAt', Date.now() - 86 * DAY_MS)
    await d1.online()
    await waitFor(async () => Object.keys((await d1.load()).items).length === 2, 'D が受け取る')
    await expectResyncSettled(d1, 1)
    // 開き直した時は、揃った時刻を覚えているので受け取り直さない
    d1.offline()
    d1.p.close()
    const d2 = await makeDevice('d2', who, { dbName })
    await d2.online()
    await waitFor(async () => d2.engine?.status.phase === 'synced', 'D が揃う')
    await expectResyncSettled(d2, 0)
  })

  /**
   * A で予定を足して消し、削除の印を片付ける（100日後の手入れ）。消した予定と、手入れをした時刻を返す。
   * beforeDelete = 足した予定が届いた後・消す前にすること
   */
  async function purgedItem(a: Device, beforeDelete?: () => Promise<void>): Promise<{ item: Item; later: number }> {
    let id = ''
    await a.edit((d) => {
      const r = addItem(d, { title: '消す予定' })
      id = r.id
      return r.data
    })
    await settle(a)
    await beforeDelete?.()
    const item = (await a.load()).items[id]
    await a.edit((d) => {
      const { [id]: _x, ...items } = d.items
      void _x
      return { ...d, items }
    })
    await settle(a)
    const later = Date.now() + 100 * DAY_MS
    expect((await a.engine!.maintain(later)).purged).toBeGreaterThanOrEqual(1)
    expect(await cloud(a, `items:${id}`)).toBeUndefined()
    return { item, later }
  }

  it('返事を受け取れなかった書き込みの記録が、その後ほかの端末で消されて印も片付いていたら、全部を受け取り直した時に消す', async () => {
    const who = account()
    const a = await makeDevice('a', who)
    const b = await makeDevice('b', who)
    await a.online()
    await b.online()
    let id = ''
    let favId = ''
    await a.edit((d) => {
      const r = addItem(d, { title: '元の題名' })
      id = r.id
      const f = O.addFavorite(r.data, 'お気に入り')
      favId = f.result
      return f.data
    })
    await settle(a, b)
    // A の書き込みは届くが、返事も自分の書き込みの通知も受け取らないまま閉じる
    listen.loseReply.add(a.fs)
    listen.deaf.add(a.fs)
    await a.edit((d) => O.updateItem(d, id, { title: 'Aの題名' }).data)
    await waitFor(async () => (await b.load()).items[id]?.title === 'Aの題名', 'A の書き込みが B に届く')
    await waitFor(async () => (await a.p.readOutbox(5))[0]?.unconfirmed, 'A は返事を受け取っていない')
    a.offline()
    listen.deaf.delete(a.fs)
    // B が消し、90日後に削除の印が片付いた（印の文書を消して代わりにする）
    await b.edit((d) => {
      const { [id]: _x, ...items } = d.items
      void _x
      return { ...d, items }
    })
    await settle(b)
    await deleteDoc(doc(b.fs, 'users', b.uid, 'records', `items:${id}`))
    // A はほかの物も直していて、86日後に開く。最初の送信は通信できずに失敗し、全部の受け取り直しが先に済む
    await a.edit((d) => O.updateFavorite(d, favId, { text: 'お気に入り2' }))
    await a.p.setMeta('cursor', { s: Math.floor(Date.now() / 1000) - 86 * 86400, n: 0 })
    await a.p.setMeta('caughtUpAt', Date.now() - 86 * DAY_MS)
    listen.offline.add(a.fs)
    await a.online()
    await waitFor(async () => (await a.p.getMeta('resyncPending')) == null && a.engine?.status.downloaded, '受け取り直す')
    expect((await a.load()).items[id]).toBeUndefined()
    listen.offline.delete(a.fs)
    a.engine?.requestUpload(true)
    await settle(a, b)
    expect((await a.load()).items[id]).toBeUndefined()
    expect(await cloud(a, `items:${id}`)).toBeUndefined()
    expect((await b.load()).favorites[favId].text).toBe('お気に入り2')
  })

  it('全部を受け取り直す前にアプリを閉じても、次に開いた時に受け取り直し、片付いた印の記録を消す', async () => {
    const who = account()
    const a = await makeDevice('a', who)
    await a.online()
    const { item, later } = await purgedItem(a)
    // B は 85日より前に受け取ったきりで、まだ記録を持っている（送信待ちは無い）
    const dbName = `emu-b-reopen-${Math.random().toString(36).slice(2)}`
    const b1 = await makeDevice('b', who, { now: () => later, dbName })
    await b1.p.setMeta('uid', a.uid)
    await b1.p.setMeta('syncSchema', SYNC_SCHEMA)
    await b1.p.setMeta('cursor', { s: Math.floor(Date.now() / 1000) - 10, n: 0 })
    await b1.p.save(await b1.load(), putItem(await b1.load(), item))
    await b1.p.completeUpload([{ table: 'items', id: item.id, record: (await b1.load()).items[item.id] }])
    expect(await b1.p.outboxCount()).toBe(0)
    // 開いてすぐ、最初の通知を受け取る前に閉じた
    listen.deaf.add(b1.fs)
    await b1.online()
    b1.offline()
    expect(await b1.p.getMeta('cursor')).toBeNull()
    b1.p.close()
    // 開き直す（同じ端末の中の保存先）
    const b2 = await makeDevice('b2', who, { now: () => later, dbName })
    await b2.online()
    await waitFor(async () => !(await b2.load()).items[item.id], '片付いた印の記録が消える')
    expect(await b2.p.getMeta('resyncPending')).toBeNull()
    expect(await b2.p.outboxCount()).toBe(0)
  })

  it('長く眠っていた画面も、購読し直す時に 85日より前の位置なら全部を受け取り直す', async () => {
    const who = account()
    const a = await makeDevice('a', who)
    let clock = Date.now()
    const b = await makeDevice('b', who, { now: () => clock })
    await a.online()
    await b.online()
    // 残る予定（クラウドのいちばん新しい書き込みが、目を覚ました B の時計で 85日より前になる）
    await a.edit((d) => addItem(d, { title: '残る予定' }).data)
    await settle(a, b)
    // B は予定を受け取った後、画面が眠っていて、A で消して印が片付いたのを受け取らない
    const { item, later } = await purgedItem(a, async () => {
      await settle(a, b)
      listen.deaf.add(b.fs)
    })
    expect((await b.load()).items[item.id]).toBeDefined()
    // 100日後に目を覚まし、購読し直す
    clock = later
    listen.deaf.delete(b.fs)
    b.engine!.reanchor()
    await waitFor(async () => !(await b.load()).items[item.id], '片付いた印の記録が消える')
    expect(await b.p.getMeta('resyncPending')).toBeNull()
    await expectResyncSettled(b, 1)
  })

  it('長く眠っていた画面の購読が、購読し直す前につながり直して通知を受け取っても、全部を受け取り直す', async () => {
    const who = account()
    const a = await makeDevice('a', who)
    let clock = Date.now()
    const b = await makeDevice('b', who, { now: () => clock })
    await a.online()
    await b.online()
    await settle(a, b)
    const { item, later } = await purgedItem(a, async () => {
      await settle(a, b)
      listen.deaf.add(b.fs)
    })
    expect((await b.load()).items[item.id]).toBeDefined()
    // 100日後に目を覚まし、購読がつながり直して A の新しい書き込みの通知が先に届く
    clock = later
    listen.deaf.delete(b.fs)
    let added = ''
    await a.edit((d) => {
      const r = addItem(d, { title: '目を覚ました後の予定' })
      added = r.id
      return r.data
    })
    await waitFor(async () => !(await b.load()).items[item.id], '片付いた印の記録が消える')
    expect((await b.load()).items[added]).toBeDefined()
    expect(await b.p.getMeta('resyncPending')).toBeNull()
    await expectResyncSettled(b, 1)
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
    // A の時計は 100日進んでいる（端末の時計だけで決めると、今日の削除の印が 90日より前に見える）。サーバーの時刻の見積もりは
    // 本当の時刻より後にならない（ゴミ箱の期限切れも、この見積もりで決める。6.15）
    expect(a.engine!.serverNow()!).toBeLessThanOrEqual(Date.now())
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

  it('復元を始めた後にほかの端末が書き直した束も開いて消す（消した項目が、次に束を書き直した時に戻らない）', async () => {
    const { a, b } = await packed()
    await waitFor(async () => (await b.p.packsOf()).size === 3, 'B が束を覚える')
    await settle(a, b)
    // A が old-1 の無いバックアップを読み込む。どこまでのクラウドに当てるか（境）は先に決まっていた（前の回の復元の送信が途中で止まった）
    a.offline()
    const pack = (await cloud(b, 'itemPack:2025-03')) as RecordDoc
    const at = pack.updated as Timestamp
    const d = await a.load()
    const { ['old-1']: _x, ...items } = d.items
    void _x
    await a.restore({ ...d, items })
    await a.p.setMeta('authoritativeFrom', { s: at.seconds, n: at.nanoseconds })
    // その間に B が old-2 を直した（束を境より後に書き直す）
    await b.edit((x) => O.updateItem(x, 'old-2', { memo: 'Bで直した' }).data)
    await settle(b)
    await a.online()
    await settle(a, b)
    expect(await cloud(a, 'itemPack:2025-03')).toBeUndefined()
    // 60日後の B の手入れで old-2・old-3 がまた束に入っても、old-1 は戻らない
    expect((await b.engine!.maintain(packTime())).packed).toEqual({ '2025-03': 2 })
    await waitFor(async () => (await a.p.packsOf()).get('old-3') === '2025-03', 'A が新しい束を受け取る')
    await settle(a, b)
    for (const dev of [a, b]) {
      const x = await dev.load()
      expect(x.items['old-1']).toBeUndefined()
      expect(x.items['old-2'].memo).toBe('Bで直した')
      expect(x.items['old-3']).toBeDefined()
    }
  })

  it('文書を書いてから 60日たっていない項目は束に入れない（復元を始めた後にゴミ箱から戻した古い項目を、復元が消さない）', async () => {
    const { a, b } = await packed()
    await waitFor(async () => (await b.p.packsOf()).size === 3, 'B が束を覚える')
    await settle(a, b)
    // B が old-2 をゴミ箱に移す（復元を始める前）
    let entryId = ''
    await b.edit((d) => {
      const r = T.trashItem(d, 'old-2')
      entryId = r.result
      return r.data
    })
    await settle(a, b)
    // A がバックアップを読み込む。境は先に決まっていた（前の回の復元の送信が途中で止まった）
    a.offline()
    const pack = (await cloud(b, 'itemPack:2025-03')) as RecordDoc
    const at = pack.updated as Timestamp
    await a.restore(await a.load())
    await a.p.setMeta('authoritativeFrom', { s: at.seconds, n: at.nanoseconds })
    // 境より後に、B が old-2 をゴミ箱から戻した（updatedAt は古いまま）。その日の B の手入れは、まだ old-2 を束に入れない
    await b.edit((d) => T.restoreTrashEntry(d, entryId).data)
    await settle(b)
    expect((await cloud(b, 'items:old-2'))?.deleted).toBe(false)
    expect((await b.engine!.maintain()).packed).toEqual({})
    await a.online()
    await settle(a, b)
    for (const dev of [a, b]) {
      const x = await dev.load()
      expect(x.items['old-2']).toBeDefined()
      expect(Object.keys(x.trashEntries)).toEqual([])
    }
  })

  it('書いてから 60日たっていない古い項目は、その時刻を覚えて、それまでの手入れでは文書を読み直さない（段階0から上がった端末）', async () => {
    const who = account()
    const a = await makeDevice('a', who)
    await a.edit((d) => [oldItem('old-1', '三月の会議'), oldItem('old-2', '三月の面談')].reduce(putItem, d))
    await a.online()
    await settle(a)
    await waitFor(async () => a.engine?.serverNow() != null, 'サーバーの時刻の見積もりができる')
    const reads = () => listen.txGets.get(a.fs) ?? 0
    let before = reads()
    expect((await a.engine!.maintain()).packed).toEqual({})
    expect(reads() - before).toBeGreaterThanOrEqual(2)
    before = reads()
    for (const days of [1, 30, 59]) expect((await a.engine!.maintain(Date.now() + days * DAY_MS)).packed).toEqual({})
    expect(reads()).toBe(before)
    expect((await a.engine!.maintain(packTime())).packed).toEqual({ '2025-03': 2 })
    expect(await a.p.getMeta('packNotBefore')).toBeNull()
  })

  it('この端末が書き直した束の中の、ほかの端末が直した項目も 3者マージする（own として扱わない）', async () => {
    const who = account()
    const a = await makeDevice('a', who)
    const b = await makeDevice('b', who)
    await a.online()
    await a.edit((d) => [oldItem('Y', 'y'), oldItem('Z', 'z')].reduce(putItem, d))
    await settle(a)
    await b.online()
    await settle(a, b)
    expect((await a.engine!.maintain(packTime())).packed).toEqual({ '2025-03': 2 })
    await waitFor(async () => (await b.p.packsOf()).size === 2, 'B が束を覚える')
    await settle(a, b)
    // A はオフラインの間に、束の中の Y と Z を直した
    a.offline()
    await a.edit((d) => O.updateItem(O.updateItem(d, 'Y', { memo: 'Aのy' }).data, 'Z', { title: 'Aのz' }).data)
    // B は Z を直し（束から抜ける）、後の手入れで B の Z がまた束に入った
    await b.edit((d) => O.updateItem(d, 'Z', { memo: 'Bのz' }).data)
    await settle(b)
    expect((await b.engine!.maintain(Date.now() + 100 * DAY_MS)).packed).toEqual({ '2025-03': 1 })
    await settle(b)
    // A は B の束を受け取る前に送る: Y を束から抜いて束を書き直す（中に B の Z が入ったまま、書いた端末は A）
    listen.deaf.add(a.fs)
    await a.online()
    await waitFor(async () => ((await cloud(a, 'itemPack:2025-03')) as RecordDoc | undefined)?.device === 'a', 'A が束を書き直す')
    listen.deaf.delete(a.fs)
    await b.edit((d) => O.addFavorite(d, '通知を起こす').data)
    await settle(a, b)
    for (const dev of [a, b]) {
      const z = (await dev.load()).items['Z']
      expect(z.title).toBe('Aのz')
      expect(z.memo).toBe('Bのz')
      expect((await dev.load()).items['Y'].memo).toBe('Aのy')
    }
  })

  it('復元の削除の印は、読んだ後にほかの端末が書いた記録には書かない（その記録は消さずに残す）', async () => {
    const who = account()
    const a = await makeDevice('a', who)
    const b = await makeDevice('b', who)
    await a.online()
    await b.online()
    await settle(a, b)
    // A が受け取っていない記録 R（A がオフラインの間に B が足した）
    a.offline()
    let rId = ''
    await b.edit((d) => {
      const r = O.addFavorite(d, 'Bで足した')
      rId = r.result
      return r.data
    })
    await settle(b)
    await a.restore(await a.load())
    // A がクラウドを読んだ後・削除の印を書く前に、B が R を直した
    listen.beforeWrite.set(a.fs, async () => {
      await b.edit((d) => O.updateFavorite(d, rId, { text: 'Bで直した' }))
      await settle(b)
    })
    await a.online()
    await settle(a, b)
    for (const dev of [a, b]) expect((await dev.load()).favorites[rId]?.text).toBe('Bで直した')
    expect(Object.keys((await b.load()).trashEntries)).toEqual([])
  })

  it('復元は、この版の知らない表（後の版が足した表）の文書を消さない', async () => {
    const who = account()
    const a = await makeDevice('a', who)
    await a.online()
    await a.edit((d) => addItem(d, { title: '残す予定' }).data)
    await settle(a)
    // 後の版のアプリが足した表の文書（このテストでは管理者の権限で置く）
    const path = `/v1/projects/${PROJECT}/databases/(default)/documents/users/${a.uid}/records/attachments:a1`
    await emulatorRequest('PATCH', path, {
      fields: {
        table: { stringValue: 'attachments' },
        id: { stringValue: 'a1' },
        json: { stringValue: '{"id":"a1"}' },
        chunks: { integerValue: '0' },
        deleted: { booleanValue: false },
        hash: { stringValue: 'x' },
        updated: { timestampValue: new Date().toISOString() },
        device: { stringValue: 'newer-app' },
      },
    })
    await a.restore(await a.load())
    await settle(a)
    await waitFor(async () => !(await a.p.getMeta('authoritative')), '復元をクラウドに当て終わる')
    const got = (await emulatorRequest('GET', path)) as { fields: { deleted: { booleanValue: boolean } } }
    expect(got.fields.deleted.booleanValue).toBe(false)
    expect(a.engine?.status.phase).toBe('synced')
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
