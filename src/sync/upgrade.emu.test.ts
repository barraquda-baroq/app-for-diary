// 段階0でログインしたままの作者の端末が、段階1の版に上がった時の流れ（docs/SPEC.md の 2.5 の 3・21. の段階1・形1）を、Firebase
// エミュレーターと本番のアクセスルールで確かめる。実行: npm run test:sync
// 本物の司令塔（src/sync/controller.ts）・ストア（src/store/appStore.ts・actions.ts）・保存先（Dexie。fake-indexeddb）・同期のエンジンを
// 動かし、Firebase の部品（src/sync/firebase.ts・firestore.ts）だけを、エミュレーターにつないだ物に差し替える。usingEmulator は false に
// して、公開した版と同じく持ち主を確かめさせる（開発サーバーをエミュレーターにつないだ時は確かめないため）。
// 段階0の版はクラウドに何も書かず、端末の中にもデータを持たない（ログインの状態だけを Firebase が覚えている）。
import { deleteApp, initializeApp, type FirebaseApp } from 'firebase/app'
import { GoogleAuthProvider, connectAuthEmulator, getAuth, signInWithCredential, type Auth } from 'firebase/auth'
import {
  connectFirestoreEmulator,
  doc,
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
import { createPersistence, type Persistence } from '../db/persistence'
import { todayStr } from '../domain/dates'
import * as O from '../domain/ops'
import { emptyData } from '../domain/types'
import { actions } from '../store/actions'
import { flushNow, getData, initStore, resetStoreForTests } from '../store/appStore'
import {
  adminCreateOwner,
  adminDeleteOwner,
  adminExists,
  adminRecordIds,
  clearFirestore,
  EMU_PROJECT,
  useRules,
} from '../test/emulatorAdmin'
import { encodeRecord } from './codec'
import { canShowData, initSync, noteAppVisible, resetSyncForTests, syncNow, useSync, whenAuthKnown } from './controller'
import { OWNER_MISSING_MESSAGE, useSyncView } from './syncView'

// 同期を受け持つ画面を決める Web Locks（ブラウザと Node 24 にはある。Node 22 には無い）が無い時は、同じ順に1つずつ渡す物を置く。
// 司令塔は、Web Locks がある時は受け持ちを待つ間に形の版の見張りも始める（ブラウザと同じ道筋を、どの Node でも確かめる）
if (typeof navigator !== 'undefined' && !navigator.locks) {
  const held = new Map<string, Promise<unknown>>()
  const request = (name: string, cb: () => Promise<unknown>) => {
    const run = (held.get(name) ?? Promise.resolve()).then(() => cb())
    held.set(
      name,
      run.catch(() => undefined),
    )
    return run
  }
  Object.defineProperty(navigator, 'locks', { value: { request }, configurable: true })
}

/** 司令塔が使う Firebase（ログインとクラウドの保存先）。テストごとに、エミュレーターにつないだアプリを入れる */
const fb = vi.hoisted(() => ({
  services: null as { app: FirebaseApp; auth: Auth } | null,
  fs: null as Firestore | null,
}))

vi.mock('./firebase', async () => {
  const a = await import('firebase/auth')
  const services = () => {
    if (!fb.services) throw new Error('テストの Firebase がまだありません')
    return fb.services
  }
  return {
    // 公開した版と同じく、持ち主を確かめる
    usingEmulator: false,
    emulatorHost: undefined,
    REDIRECT_MARK: 'diary-studio:auth-redirect',
    firebase: services,
    completeRedirect: async () => undefined,
    watchUser: (fn: (u: unknown) => void) => a.onAuthStateChanged(services().auth, fn as never),
    signInWithGoogle: async () => undefined,
    signOutUser: () => a.signOut(services().auth),
    signInForTest: async () => undefined,
    describeAuthError: () => null,
  }
})

// クラウドの保存先（src/sync/firestore.ts と同じ作り方。テストごとにアプリを作り直すので、作った物を覚えずにテストの物を返す）
vi.mock('./firestore', () => ({
  firestore: () => {
    if (!fb.fs) throw new Error('テストの Firestore がまだありません')
    return fb.fs
  },
}))

let seq = 0
const apps: FirebaseApp[] = []
const stores: Persistence[] = []

afterEach(async () => {
  resetSyncForTests()
  resetStoreForTests()
  for (const p of stores.splice(0)) p.close()
  if (fb.fs) await terminate(fb.fs)
  fb.fs = null
  fb.services = null
  for (const app of apps.splice(0)) await deleteApp(app)
  await useRules(emuRules)
})

const account = () => `author-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

/** エミュレーターのアカウントでログインしたアプリ（段階0でログインしたまま＝Firebase が端末にログインの状態を覚えている） */
async function signedInApp(sub: string): Promise<{ app: FirebaseApp; auth: Auth; uid: string }> {
  const app = initializeApp({ projectId: EMU_PROJECT, apiKey: 'fake-api-key', authDomain: 'localhost' }, `upgrade-${++seq}`)
  apps.push(app)
  const auth = getAuth(app)
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
  const cred = GoogleAuthProvider.credential(JSON.stringify({ sub, email: `${sub}@example.com`, email_verified: true }))
  const { user } = await signInWithCredential(auth, cred)
  return { app, auth, uid: user.uid }
}

/** 司令塔に、作者のアカウントでログインしたアプリを使わせる */
function useAuthor(author: { app: FirebaseApp; auth: Auth }): void {
  fb.services = { app: author.app, auth: author.auth }
  fb.fs = initializeFirestore(author.app, { localCache: memoryLocalCache() })
  connectFirestoreEmulator(fb.fs, '127.0.0.1', 8080)
}

/** アプリを開く（端末の中のデータを読み、ログインの状態を確かめ始める。src/main.tsx と同じ順） */
async function openApp(dbName: string): Promise<Persistence> {
  const p = createPersistence(dbName)
  stores.push(p)
  await initStore(p)
  await initSync()
  await whenAuthKnown()
  return p
}

/** アプリを閉じる（同じ端末の DB は残る） */
function closeApp(): void {
  resetSyncForTests()
  resetStoreForTests()
  for (const p of stores.splice(0)) p.close()
}

async function waitFor<T>(fn: () => Promise<T | undefined | null | false> | T, label: string, timeout = 20_000): Promise<T> {
  const until = Date.now() + timeout
  let last: unknown
  for (;;) {
    try {
      const v = await fn()
      if (v) return v
    } catch (e) {
      last = e
    }
    if (Date.now() > until) {
      const s = useSync.getState()
      const state = JSON.stringify({ owner: s.owner, ownerSeen: s.ownerSeen, status: s.status, error: s.error })
      throw new Error(`待ちきれませんでした: ${label}${last ? ` (${String(last)})` : ''} ${state}`)
    }
    await new Promise((r) => setTimeout(r, 50))
  }
}

const synced = () => {
  const s = useSync.getState()
  return s.leader && s.status?.phase === 'synced' && s.status.pending === 0
}

/** ほかの端末（同じアカウント）がクラウドに予定を書く（端末と同じ文書の形） */
async function otherDeviceAddsItem(sub: string, title: string): Promise<string> {
  const { app, uid } = await signedInApp(sub)
  const fs: Firestore = initializeFirestore(app, { localCache: memoryLocalCache() })
  connectFirestoreEmulator(fs, '127.0.0.1', 8080)
  const r = O.addItem(emptyData(), { origin: 'calendar', title, start: todayStr() })
  const item = r.data.items[r.result]
  const enc = encodeRecord(item as never)
  await setDoc(doc(fs, 'users', uid, 'records', `items:${item.id}`), {
    table: 'items',
    id: item.id,
    json: enc.json,
    chunks: 0,
    deleted: false,
    hash: enc.hash,
    updated: serverTimestamp(),
    device: 'other-device',
  })
  await terminate(fs)
  return item.id
}

describe('段階0から段階1の版に上がった作者の端末（エミュレーター・本番のアクセスルール。形1）', () => {
  it('持ち主の記録が無い間は同期を始めずに案内を出し、管理者が記録を作ってアプリに戻ると同期が始まる', async () => {
    await useRules(prodRules)
    await clearFirestore()
    const sub = account()
    const author = await signedInApp(sub)
    useAuthor(author)

    const p = await openApp(`upgrade-${seq}-${Math.random().toString(36).slice(2)}`)
    // ログインしたままなので、ログインの画面のボタンでなく、持ち主を確かめる
    expect(useSync.getState()).toMatchObject({ auth: 'signedIn', ownerSeen: false })
    await waitFor(() => useSync.getState().owner === 'missing', '持ち主の記録が無いと分かる')
    // 案内（ログインの画面の文と［ログアウト］。src/features/login/LoginPage.tsx の SignedInGate）を出し、データの画面は出さない
    expect(canShowData(useSync.getState())).toBe(false)
    expect(OWNER_MISSING_MESSAGE).toBe('持ち主の記録がまだありません（docs/manual/5-owner-record.md）')
    expect(useSyncView.getState().view).toBeNull()
    // 同期を始めない（エンジンを動かさず、クラウドに何も書かず、この端末をこのアカウントの物と覚えない）
    await new Promise((r) => setTimeout(r, 1000))
    expect(useSync.getState()).toMatchObject({ owner: 'missing', leader: false, status: null })
    expect(await adminRecordIds(author.uid)).toEqual([])
    expect(await adminExists(`users/${author.uid}/meta/app`)).toBe(false)
    expect(await adminExists('config/owner')).toBe(false)
    expect(await p.getMeta('ownerSeen')).toBeUndefined()
    expect(await p.getMeta('uid')).toBeUndefined()

    // 作者が Firebase の画面で持ち主の記録を作る（docs/manual/5-owner-record.md）
    await adminCreateOwner(author.uid)
    // アプリに戻る（画面が表に戻る）と確かめ直し、同期が始まる
    noteAppVisible()
    await waitFor(() => canShowData(useSync.getState()), 'データの画面を出せる')
    expect(useSync.getState().owner).toBe('ok')
    expect(await p.getMeta('ownerSeen')).toBe(author.uid)
    await waitFor(synced, 'クラウドと揃う')
    expect(useSyncView.getState().view).toEqual({ kind: 'synced' })
    expect(await p.getMeta('uid')).toBe(author.uid)
    await waitFor(() => adminExists(`users/${author.uid}/meta/app`), 'データの形の版を書く')

    // 端末で足した予定がクラウドに届き、ほかの端末で足した予定がこの端末に届く
    const mine = actions.addItem({ origin: 'calendar', title: '段階1で足した予定', start: todayStr() })
    await flushNow()
    await syncNow()
    await waitFor(async () => (await adminRecordIds(author.uid)).includes(`items:${mine}`), '足した予定がクラウドに届く')
    const theirs = await otherDeviceAddsItem(sub, 'ほかの端末の予定')
    await waitFor(() => getData().items[theirs]?.title === 'ほかの端末の予定', 'ほかの端末の予定が届く')
  })

  it('記録を作った後にアプリを開き直しても進み、次からはネットで確かめる前にトップ画面を出す', async () => {
    await useRules(prodRules)
    await clearFirestore()
    const sub = account()
    const author = await signedInApp(sub)
    useAuthor(author)
    const dbName = `upgrade-${seq}-${Math.random().toString(36).slice(2)}`

    await openApp(dbName)
    await waitFor(() => useSync.getState().owner === 'missing', '持ち主の記録が無いと分かる')
    closeApp()

    await adminCreateOwner(author.uid)
    // 開き直す: まだこの端末で確かめていないので、「確かめています…」の後に進む
    await openApp(dbName)
    expect(useSync.getState()).toMatchObject({ auth: 'signedIn', ownerSeen: false })
    expect(canShowData(useSync.getState())).toBe(false)
    await waitFor(() => canShowData(useSync.getState()), 'データの画面を出せる')
    await waitFor(synced, 'クラウドと揃う')
    actions.addItem({ origin: 'calendar', title: '開き直して足した予定', start: todayStr() })
    await flushNow()
    await syncNow()
    closeApp()

    // 次に開いた時は、この端末で持ち主だと確かめたアカウントなので、ログインの状態と一緒にすぐデータの画面を出す（2.5）
    await openApp(dbName)
    expect(canShowData(useSync.getState())).toBe(true)
    expect(Object.values(getData().items).map((i) => i.title)).toEqual(['開き直して足した予定'])
    await waitFor(synced, 'クラウドと揃う')
  })

  it('前に持ち主だと確かめた端末で記録が消えていたら、トップ画面は出して同期だけを止め、記録が戻ってアプリに戻ると同期を始め直す', async () => {
    await useRules(prodRules)
    await clearFirestore()
    const author = await signedInApp(account())
    useAuthor(author)
    await adminCreateOwner(author.uid)
    const dbName = `upgrade-${seq}-${Math.random().toString(36).slice(2)}`
    await openApp(dbName)
    await waitFor(synced, 'クラウドと揃う')
    closeApp()

    // 持ち主を移す途中などで、記録を消した
    await adminDeleteOwner()
    await openApp(dbName)
    expect(canShowData(useSync.getState())).toBe(true)
    await waitFor(() => useSync.getState().status?.errorCode === 'owner-missing', '同期だけを止める')
    expect(canShowData(useSync.getState())).toBe(true)
    expect(useSyncView.getState().view).toEqual({ kind: 'error', reason: '持ち主の記録がまだありません' })

    await adminCreateOwner(author.uid)
    noteAppVisible()
    await waitFor(synced, '同期を始め直してクラウドと揃う')
    expect(useSync.getState().owner).toBe('ok')
    expect(useSyncView.getState().view).toEqual({ kind: 'synced' })
  })
})
