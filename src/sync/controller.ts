// 同期の司令塔（docs/SPEC.md の 2.4・2.5・18.4）: ログインの状態を見て持ち主を確かめ、同期エンジンを動かし、状態を画面に知らせる。
// - DS は最初にログインの画面を出す（2.5）ので、NS と違い、起動のたびに Firebase（ログイン）を読み込んで状態を確かめる
// - 持ち主（形1）: config/owner はアプリから作らない。この端末で持ち主だと確かめたアカウント（_meta の ownerSeen）の時だけ、データの画面を
//   出す。まだ確かめていないアカウントは、ネットで確かめてから（記録が無い・ほかのアカウントの記録なら、ログインの画面に文と［ログアウト］）。
//   記録が無い・ほかのアカウントの記録だった時は、画面が表に戻った・窓を選んだ・つながった時に確かめ直す（作者が Firebase の画面で
//   持ち主の記録を作ってからアプリに戻ると、読み込み直さなくても同期が始まる。recheckOwner）
// - この端末で前に別のアカウントを使っていた時は、同期を始める前に確かめる（NS の accountMismatch）
// - 同じ端末で複数の画面（タブ・ウィンドウ）を開いている時は、1つの画面だけが同期を受け持つ（Web Locks の diary-studio-sync）。
//   画面どうしの知らせ（diary-studio-sync-status）にデータの形の版（DATA_MODEL）を載せ、受け持つ画面が自分より新しい版の画面に気付いたら
//   同期をやめて受け持ちを譲る。受け持たない画面も、クラウドのデータの形の版が自分より低ければ上げる（古い版の受け持ちの画面が、
//   新しい形の記録を古い版のまま送らないように。meta/app が上がると、古い版のエンジンは送るのをやめる）
// NS の src/sync/controller.ts（エンジンの起動・状態の BroadcastChannel・別のアカウントの確かめ・syncNow・裏に回った時）を写し、
// 段階0の DS の物（whenAuthKnown・fakeSignInForTest）に足した。
import { create } from 'zustand'
import { todayStr } from '../domain/dates'
import type { InboxContext, InboxPerms } from '../domain/inbox'
import type { DerivedTableName, ID } from '../domain/types'
import { newId } from '../domain/util'
import {
  applyRemoteChanges,
  dropMissingRecords,
  flushNow,
  getPersistence,
  getRaw,
  onExternalSave,
  onLocalSave,
  purgeTrashNow,
  setTrashClock,
} from '../store/appStore'
import { notify } from '../store/uiStore'
import { DATA_MODEL } from './appVersion'
import type { SyncEngine, SyncStatus, SyncTarget } from './engine'
import { syncViewOf, useSyncView, type OwnerState } from './syncView'

export interface SyncUser {
  uid: string
  name: string
  email: string
}

export interface SyncState {
  /** idle = まだ確かめていない、checking = 確かめている（Firebase を読み込んでいる） */
  auth: 'idle' | 'checking' | 'signedOut' | 'signedIn'
  user: SyncUser | null
  /** 持ち主の確かめ（2.5 の 3）。ok = このアカウントが持ち主、missing = 記録が無い、mismatch = ほかのアカウントの記録 */
  owner: OwnerState
  /** この端末で、このアカウントを持ち主だと確かめたことがある（_meta の ownerSeen。データの画面を出してよい） */
  ownerSeen: boolean
  /** 同期のエンジンの状態（同期を受け持たない画面は、受け持つ画面から届いた物） */
  status: SyncStatus | null
  /** この画面が同期を受け持っている */
  leader: boolean
  /** ログイン・ログアウトの途中 */
  busy: boolean
  /** ログインの画面に出す失敗の言葉 */
  error: string | null
  /**
   * この端末は以前、別のアカウント（previousEmail）と同期していた。確かめるまで同期を始めない・データを出さない
   * （間違えて別のアカウントを選んだ時に、データがそのアカウントへ写らないように。2.5 の 4）
   */
  accountMismatch: { previousEmail: string } | null
  /** Claude との連携と許可（config/connector。段階1〜5は読むだけ。null = まだ読めていない・読めなかった。6.14） */
  connector: InboxPerms | null
}

const initial: SyncState = {
  auth: 'idle',
  user: null,
  owner: 'unknown',
  ownerSeen: false,
  status: null,
  leader: false,
  busy: false,
  error: null,
  accountMismatch: null,
  connector: null,
}

export const useSync = create<SyncState>(() => ({ ...initial }))

// 同期の表示（ヘッダー・設定）を、司令塔の状態から決めて入れる
useSync.subscribe((s) => {
  const view = s.auth === 'signedIn' && s.ownerSeen ? syncViewOf(s) : null
  const cur = useSyncView.getState().view
  if (JSON.stringify(cur) !== JSON.stringify(view)) useSyncView.setState({ view })
})

/** データの画面（トップ・設定）を出してよいか（持ち主だと確かめたアカウントで、別のアカウントの確かめも済んでいる。2.5） */
export function canShowData(s: Pick<SyncState, 'auth' | 'owner' | 'ownerSeen' | 'accountMismatch'>): boolean {
  return s.auth === 'signedIn' && s.ownerSeen && s.owner !== 'mismatch' && !s.accountMismatch
}

/**
 * この画面が同期を受け持っていて、クラウドと揃っているか（送り待ちも受け取りの途中も無く、クラウドのデータの形の版が
 * このアプリより新しくなく、別のアカウントの確認も待っていない）。受け取り箱の依頼を当てる時（段階5）はこの時だけ（19.5）
 */
export function cloudSettled(s: Pick<SyncState, 'leader' | 'status' | 'accountMismatch'>): boolean {
  return s.leader && s.status?.phase === 'synced' && s.status.pending === 0 && !s.status.outdated && !s.accountMismatch
}

/**
 * ゴミ箱の期限切れ（30日）を決める時刻（6.15）。ログインしている時に、同期を受け持つ画面が、端末の時計とサーバーの時刻の見積もり
 * （同期で届いた文書の時刻から。src/sync/engine.ts の serverNow）の早い方で決める（時計が大きく進んだ端末が、ゴミ箱の中身（同期の
 * 競合の控えも）を消して、その削除をどの端末にも送らないように）。ログインしていない間・ログインの状態が分かる前・見積もりがまだ無い間・
 * 同期を受け持たない画面（serverNow が null）は消さない（null）。ログインしていない間に端末の時計で消すと、その削除が送信待ちに残り、
 * 次に同じアカウントでログインした時にどの端末にも送られる（ログインしていない間はデータを出さないので、消しても見える物は無い。2.5）
 */
export function trashPurgeTime(auth: SyncState['auth'], serverNow: number | null, deviceNow: number): number | null {
  if (auth !== 'signedIn' || serverNow === null) return null
  return Math.min(deviceNow, serverNow)
}

let engine: SyncEngine | null = null
let generation = 0
let releaseLeader: (() => void) | null = null
let booted: Promise<void> | null = null
let hooksInstalled = false
/** 画面のテスト用に、Firebase を使わずにログインした状態にしている（fakeSignInForTest） */
let faked = false

setTrashClock(() => (faked ? Date.now() : trashPurgeTime(useSync.getState().auth, engine?.serverNow() ?? null, Date.now())))

/**
 * 後から読み込む部品は、読み込みを1つにまとめる（受け持ちを待つ間の形の版の見張りと同期の始まりが、同時に読み込むことがある。
 * 読み込めなかった時は、次に呼んだ時に読み込み直す）。テストで部品を差し替える仕組み（vitest の vi.mock）は、同じ部品を同時に
 * 読み込むと片方に本物を返すことがあるので、そこでも差し替えた物が使われるようにする
 */
function loadOnce<T>(load: () => Promise<T>): () => Promise<T> {
  let loading: Promise<T> | null = null
  return () =>
    (loading ??= load().catch((e: unknown) => {
      loading = null
      throw e
    }))
}

const firebaseModule = loadOnce(() => import('./firebase'))
const firestoreModule = loadOnce(() => import('./firestore'))

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function storeTarget(): SyncTarget {
  const p = getPersistence()
  if (!p) throw new Error('保存先が初期化されていません')
  return {
    readOutbox: (n) => p.readOutbox(n),
    completeUpload: (sent) => p.completeUpload(sent),
    markUnconfirmed: (rows, tx) => p.markUnconfirmed(rows, tx),
    unconfirmedTx: (keys) => p.unconfirmedTx(keys),
    confirmLanded: (tx) => p.confirmLanded(tx),
    applyRemote: (changes, cursor, opts) => applyRemoteChanges(changes, cursor, opts),
    outboxCount: () => p.outboxCount(),
    outboxKeys: () => p.outboxKeys(),
    markAllDirty: () => p.markAllDirty(),
    localKeys: () => p.localKeys(),
    getMeta: (k) => p.getMeta(k),
    setMeta: (k, v) => p.setMeta(k, v),
    setAuthoritativeFrom: (stamp, bound) => p.setAuthoritativeFrom(stamp, bound),
    finishAuthoritative: (stamp) => p.finishAuthoritative(stamp),
    packsOf: () => p.packsOf(),
    setPacks: (entries) => p.setPacks(entries),
    clearPacks: () => p.clearPacks(),
    items: async () => Object.values(getRaw().items),
    dropMissing: (keys) => dropMissingRecords(keys),
    flush: () => flushNow(),
  }
}

async function deviceId(): Promise<string> {
  const p = getPersistence()
  const stored = await p?.getMeta<string>('deviceId')
  if (stored) return stored
  const id = newId()
  await p?.setMeta('deviceId', id)
  return id
}

/** 同期を受け持つ画面が、ほかの画面（タブ・ウィンドウ）に状態を知らせる（2.4） */
const STATUS_CHANNEL = 'diary-studio-sync-status'
/** 同期を受け持つ画面を1つにする Web Locks の名前（2.4） */
const LEADER_LOCK = 'diary-studio-sync'
let statusChannel: BroadcastChannel | null = null
/** 画面がこれより長く裏にあったら、戻った時に購読し直す（長く切れていた購読は全件を読み直すため） */
const REANCHOR_AFTER_MS = 20 * 60 * 1000
/** その日の最初の同期の後、操作の無いこの時間の後に手入れ（月の束・削除の印の片付け。6.11）をする */
const MAINTAIN_IDLE_MS = 30_000
/** 持ち主を確かめられなかった（通信できなかった）時に、確かめ直すまでの時間 */
const OWNER_RETRY_MS = 15_000

let maintainTimer: ReturnType<typeof setTimeout> | null = null

function scheduleMaintain(): void {
  if (maintainTimer) clearTimeout(maintainTimer)
  maintainTimer = null
  if (!engine || !useSync.getState().leader) return
  maintainTimer = setTimeout(() => {
    maintainTimer = null
    void runMaintain()
  }, MAINTAIN_IDLE_MS)
}

async function runMaintain(): Promise<void> {
  const e = engine
  const p = getPersistence()
  if (!e || !p || e.status.phase !== 'synced') return
  if ((await p.getMeta<string>('lastMaintainDay')) === todayStr()) return
  await e.maintain().catch((err: unknown) => console.warn('月の束をまとめられませんでした', err))
}

function installHooks(): void {
  if (hooksInstalled) return
  hooksInstalled = true
  onLocalSave(() => {
    engine?.requestUpload()
    // 操作があった: 手入れは操作の無い 30秒の後に
    if (maintainTimer) scheduleMaintain()
  })
  onExternalSave(() => engine?.requestUpload())
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') noteAppHidden()
      else noteAppVisible()
    })
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => retryOwnerCheck())
    // PC で Firebase の画面とアプリを別の窓で並べている時は、画面が裏に回らないので、窓を選んだ時にも確かめ直す
    window.addEventListener('focus', () => void recheckOwner())
  }
  try {
    statusChannel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(STATUS_CHANNEL)
    if (statusChannel) {
      statusChannel.onmessage = (ev: MessageEvent<TabMessage>) => onTabMessage(ev.data)
      statusChannel.postMessage({ request: true, model: DATA_MODEL } satisfies TabMessage)
    }
  } catch {
    statusChannel = null
  }
}

/** 画面どうしの知らせ（diary-studio-sync-status）。model はその画面のデータの形の版 */
export interface TabMessage {
  status?: SyncStatus
  request?: boolean
  model?: number
}

/** ほかの画面からの知らせ（同期の状態・状態を知らせてほしい・データの形の版） */
export function onTabMessage(data: TabMessage | null | undefined): void {
  // 新しいデータの形の版の画面が開かれた: 受け持ちを譲る（この画面は古い版のまま送らない）
  if (typeof data?.model === 'number' && data.model > DATA_MODEL) {
    yieldToNewerTab()
    return
  }
  const { leader, status } = useSync.getState()
  if (data?.request) {
    if (leader && status) publishStatus(status)
    return
  }
  if (!leader && data?.status) useSync.setState({ status: data.status })
}

/** 画面が裏に回った時刻（表に戻ったら 0） */
let hiddenAt = 0

/** 画面を閉じる・裏に回る時。待たずに送る */
export function noteAppHidden(): void {
  if (!hiddenAt) hiddenAt = Date.now()
  engine?.requestUpload(true)
}

/** 画面が表に戻った時。長く裏にあったら購読し直す。持ち主の記録が無かった時は確かめ直す */
export function noteAppVisible(): void {
  const since = hiddenAt
  hiddenAt = 0
  if (since && Date.now() - since > REANCHOR_AFTER_MS) engine?.reanchor()
  void recheckOwner()
}

function publishStatus(status: SyncStatus): void {
  try {
    statusChannel?.postMessage({ status, model: DATA_MODEL })
  } catch {
    /* noop */
  }
}

/** 新しいデータの形の版の画面に、同期の受け持ちを譲った（この画面では、読み込み直すまで同期を始めない） */
let yieldedToNewer = false

/** 新しいデータの形の版の画面が開かれた時（その画面の知らせで気付く） */
function yieldToNewerTab(): void {
  if (yieldedToNewer) return
  yieldedToNewer = true
  stopEngine()
  notify('新しい版のアプリが別の画面で開かれました。この画面を読み込み直してください。')
}

/** 受け持ちを待っている間の、データの形の版の見張り（クラウドの版が低ければ上げる） */
let modelWatch: (() => void) | null = null

function stopModelWatch(): void {
  modelWatch?.()
  modelWatch = null
}

/**
 * 同期を受け持っていない画面も、クラウドのデータの形の版が自分より低ければ上げる（受け持つ画面が古い版のままでも、そのエンジンが
 * 新しい版のデータに気付いて送るのをやめるように）。受け持ちを得たら、エンジンが見張りを引き継ぐ
 */
async function startModelWatch(uid: string, token: number): Promise<void> {
  const [model, store] = await Promise.all([import('./appModel'), firestoreModule()])
  if (token !== generation || engine || modelWatch) return
  modelWatch = model.watchAppModel(store.firestore(), uid, { model: model.DATA_MODEL, appVersion: model.APP_VERSION }, () => {
    /* 受け持たない画面は送らないので、状態は使わない */
  })
}

function stopEngine(): void {
  generation += 1
  stopModelWatch()
  engine?.stop()
  engine = null
  if (maintainTimer) clearTimeout(maintainTimer)
  maintainTimer = null
  releaseLeader?.()
  releaseLeader = null
  useSync.setState({ leader: false, status: null })
}

function startEngine(uid: string): void {
  stopEngine()
  if (yieldedToNewer) return
  const token = generation
  const run = async () => {
    if (token !== generation) return
    stopModelWatch()
    const [{ createSyncEngine, readConnectorPerms }, fb, store, model] = await Promise.all([
      import('./engine'),
      firebaseModule(),
      firestoreModule(),
      import('./appModel'),
    ])
    if (token !== generation) return
    /** 最初の受け取りが終わった（サーバーの時刻の見積もりができた）時に、ゴミ箱の期限切れを消す */
    let purged = false
    const e = createSyncEngine({
      firestore: store.firestore(),
      uid,
      deviceId: await deviceId(),
      target: storeTarget(),
      // エミュレーターにつないだ開発サーバーでは、持ち主の記録を確かめない（エミュレーターには config/owner が無い）
      ownerLock: !fb.usingEmulator,
      appModel: { model: model.DATA_MODEL, appVersion: model.APP_VERSION },
      onNotice: (text) => notify(text),
      onStatus: (status) => {
        if (engine !== e) return
        useSync.setState({ status })
        publishStatus(status)
        if (status.errorCode === 'owner-mismatch') {
          // 使っている間に、ほかのアカウントが持ち主だと分かった: 同期を止め、データを見えなくする（18.4）
          useSync.setState({ owner: 'mismatch', ownerSeen: false })
          stopEngine()
          return
        }
        if (status.errorCode === 'owner-missing') useSync.setState({ owner: 'missing' })
        else if (
          !status.errorCode &&
          (status.phase === 'downloading' || status.phase === 'uploading' || status.phase === 'synced') &&
          useSync.getState().owner === 'missing'
        ) {
          // 同期を始め直して、エンジンが持ち主を確かめられた（記録が作られた）: 同期の表示の「持ち主の記録がまだありません」を消す
          useSync.setState({ owner: 'ok' })
        }
        if (status.phase === 'synced' && !maintainTimer) scheduleMaintain()
        if (status.downloaded && !purged) {
          purged = true
          purgeTrashNow()
        }
      },
    })
    engine = e
    useSync.setState({ leader: true, status: e.status })
    await e.start()
    // Claude との連携と許可を読む（設定の表示用。受け取り箱を当てる時は inboxContext で読み直す。6.14）
    if (token === generation) {
      const perms = await readConnectorPerms(store.firestore(), uid)
      if (token === generation) useSync.setState({ connector: perms })
    }
  }
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks
  if (locks?.request) {
    const released = new Promise<void>((resolve) => {
      releaseLeader = resolve
    })
    // 受け持ちを待っている間も、データの形の版だけは見張る（上の startModelWatch）
    void startModelWatch(uid, token).catch((e: unknown) => console.warn('データの形の版を見張れませんでした', e))
    void locks
      .request(LEADER_LOCK, async () => {
        await run().catch(reportError)
        await released
      })
      .catch(reportError)
  } else {
    void run().catch(reportError)
  }
}

function reportError(e: unknown): void {
  console.warn('同期を始められませんでした', e)
  useSync.setState({ error: message(e) })
}

let ownerRetry: ReturnType<typeof setTimeout> | null = null
let ownerToken = 0

/** 持ち主を確かめ直す（通信できなかった時・つながった時） */
function retryOwnerCheck(): void {
  const { auth, user, owner } = useSync.getState()
  if (faked || auth !== 'signedIn' || !user) return
  if (owner === 'checking' || owner === 'unknown') void verifyOwner(user)
  else void recheckOwner()
}

/** 確かめ直している途中（画面が表に戻った時と窓を選んだ時が重なっても、1回だけ読む） */
let rechecking = false

/**
 * 持ち主の記録が無い・ほかのアカウントの記録だった時に、確かめ直す（画面が表に戻った・窓を選んだ・つながった時）。
 * 作者が Firebase の画面で持ち主の記録を作ってからアプリに戻ると、読み込み直さなくても同期が始まる（2.5 の 3「作者が記録を作った後に、
 * アプリを開き直すと進む」）。確かめている間も、ログインの画面の今の文は出したまま（「確かめています…」に替えない）。
 * この端末で前に持ち主だと確かめたアカウントで、同期が「持ち主の記録がまだありません」で止まっている時は、同期を始め直す
 * （エンジンがもう一度確かめる。18.4）
 */
export async function recheckOwner(): Promise<void> {
  const s = useSync.getState()
  const user = s.user
  if (faked || rechecking || s.auth !== 'signedIn' || !user) return
  if (s.ownerSeen) {
    if (s.leader && s.status?.errorCode === 'owner-missing') startEngine(user.uid)
    return
  }
  if (s.owner !== 'missing' && s.owner !== 'mismatch') return
  const token = ownerToken
  rechecking = true
  try {
    const [{ checkOwner }, store] = await Promise.all([import('./engine'), firestoreModule()])
    const state = await checkOwner(store.firestore(), user.uid)
    if (token !== ownerToken) return
    if (state === 'ok') {
      await getPersistence()?.setMeta('ownerSeen', user.uid)
      if (token !== ownerToken) return
      await startAfterOwner(user, token)
    } else if (state !== useSync.getState().owner) useSync.setState({ owner: state })
  } catch (e) {
    // 通信できない: 今の文のまま（次に表に戻った・つながった時に確かめ直す）
    console.warn('持ち主を確かめ直せませんでした', e)
  } finally {
    rechecking = false
  }
}

/**
 * ログインしたアカウントが持ち主か確かめてから、同期を始める（2.5 の 3・4）。
 * この端末で前に持ち主だと確かめたアカウントなら、すぐにデータの画面を出して同期を始める（同期のエンジンも持ち主を確かめる）
 */
async function verifyOwner(user: SyncUser): Promise<void> {
  const token = ++ownerToken
  if (ownerRetry) clearTimeout(ownerRetry)
  ownerRetry = null
  const p = getPersistence()
  const fb = await firebaseModule()
  const seen = (await p?.getMeta<string>('ownerSeen')) === user.uid
  if (token !== ownerToken) return
  if (seen || fb.usingEmulator) {
    await startAfterOwner(user, token)
    return
  }
  useSync.setState({ owner: 'checking', ownerSeen: false })
  try {
    const [{ checkOwner }, store] = await Promise.all([import('./engine'), firestoreModule()])
    const state = await checkOwner(store.firestore(), user.uid)
    if (token !== ownerToken) return
    if (state === 'ok') {
      await p?.setMeta('ownerSeen', user.uid)
      if (token !== ownerToken) return
      await startAfterOwner(user, token)
    } else useSync.setState({ owner: state, ownerSeen: false })
  } catch (e) {
    // 通信できない: 「確かめています…」のまま、つながったら・少し後で確かめ直す
    console.warn('持ち主を確かめられませんでした', e)
    if (token !== ownerToken) return
    ownerRetry = setTimeout(() => {
      ownerRetry = null
      retryOwnerCheck()
    }, OWNER_RETRY_MS)
  }
}

/** この端末で前に別のアカウントを使っていた時の、そのアカウント（2.5 の 4。同じアカウント・初めての端末なら null） */
async function previousAccount(uid: string): Promise<{ previousEmail: string } | null> {
  const p = getPersistence()
  const previous = await p?.getMeta<string>('uid')
  return previous && previous !== uid ? { previousEmail: (await p?.getMeta<string>('email')) ?? '' } : null
}

/**
 * 持ち主を確かめた後: 前に別のアカウントで使っていたら確かめ、そうでなければ同期を始める（2.5 の 4）。データの画面を出してよいことは、
 * 前に別のアカウントで使っていたかを読んでから1回で入れる（確かめる前に、データの画面が一瞬出ないように）
 */
async function startAfterOwner(user: SyncUser, token: number): Promise<void> {
  const mismatch = await previousAccount(user.uid)
  if (token !== ownerToken) return
  if (mismatch) {
    stopEngine()
    useSync.setState({ owner: 'ok', ownerSeen: true, accountMismatch: mismatch })
    return
  }
  await getPersistence()?.setMeta('email', user.email)
  if (token !== ownerToken) return
  useSync.setState({ owner: 'ok', ownerSeen: true, accountMismatch: null })
  startEngine(user.uid)
}

function boot(): Promise<void> {
  booted ??= (async () => {
    installHooks()
    // 画面のテスト用にもうログインした状態にしてあれば、その状態を上書きしない（確かめている間も 'signedIn' のまま）
    if (!faked) useSync.setState({ auth: 'checking' })
    try {
      const fb = await firebaseModule()
      fb.firebase()
      // リダイレクトでログインして戻ってきた時は、その結果を受け取る
      await fb.completeRedirect().catch((e) => {
        const text = fb.describeAuthError(e)
        if (text) useSync.setState({ error: text })
      })
      fb.watchUser((user) => {
        if (faked) return
        if (user) {
          const u: SyncUser = { uid: user.uid, name: user.displayName ?? '', email: user.email ?? '' }
          const token = ++ownerToken
          void (async () => {
            // この端末で持ち主だと確かめたアカウントかを先に読む（起動のたびにログインの画面が一瞬出ないように、ログインした状態と
            // 一緒に入れる）
            const seen = fb.usingEmulator || (await getPersistence()?.getMeta<string>('ownerSeen')) === u.uid
            // 前に別のアカウントで使っていた端末なら、その確かめ（2.5 の 4）も一緒に入れる（データの画面が一瞬出ないように）
            const mismatch = seen ? await previousAccount(u.uid) : null
            if (token !== ownerToken || faked) return
            useSync.setState({
              auth: 'signedIn',
              user: u,
              error: null,
              owner: seen ? 'ok' : 'checking',
              ownerSeen: seen,
              accountMismatch: mismatch,
            })
            await verifyOwner(u)
          })().catch(reportError)
        } else {
          ownerToken += 1
          stopEngine()
          useSync.setState({
            auth: 'signedOut',
            user: null,
            owner: 'unknown',
            ownerSeen: false,
            accountMismatch: null,
            connector: null,
          })
        }
      })
    } catch (e) {
      // Firebase を読み込めない（初めて開いた時に電波が無い など）: ログインの画面を出す
      console.warn('ログインの状態を確かめられませんでした', e)
      if (!faked) useSync.setState({ auth: 'signedOut', user: null, error: message(e) })
    }
  })()
  return booted
}

/** 起動時に呼ぶ（端末の中のデータを読み込んでから。src/main.tsx）。ログインの状態を確かめ始める */
export function initSync(): Promise<void> {
  return boot()
}

/** ログインの状態が分かった（ログインの画面かトップ画面のどちらを出すか決まった）時に終わる */
export function whenAuthKnown(): Promise<void> {
  const known = (s: SyncState) => s.auth === 'signedIn' || s.auth === 'signedOut'
  if (known(useSync.getState())) return Promise.resolve()
  return new Promise((resolve) => {
    const off = useSync.subscribe((s) => {
      if (!known(s)) return
      off()
      resolve()
    })
  })
}

/** この端末を、いまログインしているアカウントと同期するようにする（以前は別のアカウントと同期していた時。2.5 の 4） */
export async function confirmAccountSwitch(): Promise<void> {
  const user = useSync.getState().user
  const p = getPersistence()
  if (!user || !p) return
  await p.setMeta('email', user.email)
  useSync.setState({ accountMismatch: null })
  startEngine(user.uid)
}

/** ［Google でログイン］ */
export async function signIn(): Promise<void> {
  useSync.setState({ busy: true, error: null })
  try {
    await boot()
    const fb = await firebaseModule()
    if (fb.firebase().auth.currentUser) return
    await fb.signInWithGoogle()
  } catch (e) {
    const fb = await firebaseModule().catch(() => null)
    const text = fb ? fb.describeAuthError(e) : message(e)
    if (text) useSync.setState({ error: text })
  } finally {
    useSync.setState({ busy: false })
  }
}

/** ［ログアウト］（ログインの画面に戻る。端末の中のデータは消さない） */
export async function signOut(): Promise<void> {
  useSync.setState({ busy: true, error: null })
  try {
    if (faked) {
      faked = false
      useSync.setState({ auth: 'signedOut', user: null, owner: 'unknown', ownerSeen: false })
      return
    }
    // 送れるものは送ってからログアウトする（送れなくても端末内には残り、次にログインした時に送る）
    await engine?.flush().catch(() => undefined)
    const fb = await firebaseModule()
    await fb.signOutUser()
  } catch (e) {
    useSync.setState({ error: message(e) })
  } finally {
    useSync.setState({ busy: false })
  }
}

/** いますぐ送る（［今すぐ同期］） */
export function syncNow(): Promise<void> {
  return engine ? engine.flush() : Promise.resolve()
}

/**
 * 受け取り箱の依頼を当てる時の文脈（段階5で自動で当てる所が使う。段階1はテストと開発用の口）: 許可は、当てる直前にサーバーから読み直した
 * config/connector、previously_deleted は端末の _gone の控え（19.5・6.14）。許可を読めない時（オフラインなど）は null を返すので、
 * 受け取り箱を当てない（連携していないと決めつけて、待っている依頼と答え待ちの提案を not_allowed で断らないように。断った結果は 6.10 の
 * 強さで後から戻せない）
 */
export async function inboxContext(now = Date.now()): Promise<InboxContext | null> {
  const user = useSync.getState().user
  if (!user || faked) return null
  const [{ readConnectorPerms }, store] = await Promise.all([import('./engine'), firestoreModule()])
  const perms = await readConnectorPerms(store.firestore(), user.uid)
  if (!perms) return null
  useSync.setState({ connector: perms })
  const p = getPersistence()
  const gone = (await p?.goneKeys()) ?? new Set<string>()
  return { now, perms, isGone: (table: DerivedTableName, id: ID) => gone.has(`${table}/${id}`) }
}

/** テスト用: エミュレーターの仮のアカウントでログインする（開発サーバーだけ。公開するビルドでは中身がビルドで消える） */
export async function signInForTest(sub: string): Promise<void> {
  if (!import.meta.env.DEV) throw new Error('開発サーバーだけで使えます')
  await boot()
  const fb = await firebaseModule()
  await fb.signInForTest(sub)
}

/**
 * 画面のテスト用（開発サーバーだけ。src/main.tsx の window.__ds）: Firebase を使わずに、ログインした状態にする
 * （エミュレーターの無い E2E で、トップ画面・設定の画面を開くため。持ち主も確かめた扱い。同期は始めない）
 */
export function fakeSignInForTest(user: SyncUser = { uid: 'test-user', name: 'テスト', email: 'test@example.com' }): void {
  if (!import.meta.env.DEV) throw new Error('開発サーバーだけで使えます')
  faked = true
  ownerToken += 1
  useSync.setState({ auth: 'signedIn', user, owner: 'ok', ownerSeen: true, accountMismatch: null, error: null })
}

/** テスト用 */
export function resetSyncForTests(): void {
  stopEngine()
  booted = null
  faked = false
  yieldedToNewer = false
  hiddenAt = 0
  ownerToken += 1
  if (ownerRetry) clearTimeout(ownerRetry)
  ownerRetry = null
  rechecking = false
  useSync.setState({ ...initial })
}
