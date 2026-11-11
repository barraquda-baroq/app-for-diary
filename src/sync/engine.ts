// クラウド（Firestore）との送受信（docs/SPEC.md の 2.4・6.10・6.11）。
// - 受信: users/{uid}/records を「前回受け取った時刻より後に書かれたもの」でリアルタイム購読し、届いた変更を反映する
// - 送信: 端末内の送信待ちを、クラウド側が前回揃えた時から変わっていないことを確かめながら（トランザクション）書く。
//   変わっていたら書かずに、受信で base が新しくなる（3者マージされる）のを待ってから送り直す。
// 送受信は exclusive で1つずつ行い、送った結果を記録する前に自分の書いた変更を受け取ることがないようにする。
// この端末が書いた古い版（続けて送った時、先に送った版の通知が後から届く）は反映しない。
//
// NS の src/sync/engine.ts をほぼそのまま写し、次を足した・変えた:
// - 持ち主（2.5・形1）: config/owner はアプリから作らない。無い・別のアカウントの時は同期しない（SyncError）
// - 分けた文書に親の表の名前 parentTable（2.4）
// - 月の束（6.11）: 束の文書（itemPack:{月}）を受け取ったら中の項目の変化に広げる。束の中の項目を送る時は、束から抜いて個別の文書を
//   書く。直接読んで項目の文書が無い時は、束を全部読んでから「消された」とみなす。復元では束を開いて消す。1日1回 maintain で
//   古い月の項目を束にまとめ、90日より前の削除の印を片付ける。85日より前に受け取ったきりの端末は全部を受け取り直す
// - 無料枠を使い切った（resource-exhausted）時の状態（2.8・18.4）
// - 受け取り箱の依頼の削除の印も、ほかの記録と同じに扱う
import {
  Timestamp,
  collection,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  getDocsFromServer,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  where,
  writeBatch,
  type DocumentData,
  type DocumentSnapshot,
  type Firestore,
  type QueryDocumentSnapshot,
  type Transaction,
  type Unsubscribe,
} from 'firebase/firestore'
import {
  outboxKey,
  tableSendRank,
  type AnyRecord,
  type AuthoritativeKeep,
  type Change,
  type OutboxItem,
  type SentRow,
} from '../db/persistence'
import { todayStr } from '../domain/dates'
import type { InboxPerms } from '../domain/inbox'
import { isTableName, type Item, type TableName } from '../domain/types'
import { newId } from '../domain/util'
import { appModelRef, asModel, watchAppModel, type AppModel } from './appModel'
import { OWNER_MISMATCH_MESSAGE, OWNER_MISSING_MESSAGE } from './syncView'
import { decideBatch, nothingToSend, sameAsBase, selectBatch, type BatchEntry, type CloudState } from './batch'
import {
  CHUNK_CHARS,
  PACK_TABLE,
  RECORDS,
  chunkIdOf,
  decodeJson,
  decodeRecord,
  docIdOf,
  encodeJson,
  hashRecord,
  splitDocId,
  type ChunkDoc,
  type CloudTable,
  type Encoded,
  type RecordDoc,
} from './codec'
import {
  decodePack,
  encodePack,
  itemsPerTransaction,
  keepsTombstone,
  needsFullResync,
  packCandidates,
  tombstoneCutoff,
  withItems,
  withoutItems,
  type PackBody,
} from './packs'

/** エンジンが端末内のデータを読み書きする口（アプリではストア、テストでは保存先を直接使う） */
export interface SyncTarget {
  readOutbox(limit: number): Promise<OutboxItem[]>
  completeUpload(sent: Change[]): Promise<void>
  /**
   * 送るトランザクションで書く送信待ちに、書き込みを送る前に「返事を受け取るまで、クラウドが base のままか分からない」と印を付ける
   * （書き込みが届いたのに返事を受け取れないことがある。OutboxRow.unconfirmed）。tx = そのトランザクションの id、record = 送る内容
   */
  markUnconfirmed(rows: readonly SentRow[], tx: string): Promise<void>
  /** 印の付いた送信待ちのうち、keys の物のトランザクションの id */
  unconfirmedTx(keys: readonly string[]): Promise<Set<string>>
  /** トランザクション tx の書き込みは届いていた: その印の付いた送信待ちを、送った返事を受け取った時と同じにする */
  confirmLanded(tx: string): Promise<void>
  /**
   * クラウドの変更を反映する。cursor は同じトランザクションで記録する。
   * バックアップからの復元・すべて削除をクラウドに当てる前は反映せずに null を返す（後で受け取り直す）。
   * direct = 購読ではなく、書けなかったものだけをクラウドから直接読んだ（1回の書き込みの一部だけのことがある）。
   */
  applyRemote(changes: Change[], cursor?: unknown, opts?: { direct?: boolean }): Promise<Change[] | null>
  outboxCount(): Promise<number>
  outboxKeys(): Promise<Set<string>>
  markAllDirty(): Promise<void>
  /** 端末内のレコードと送信待ちのキー（`${表名}/${id}`） */
  localKeys(): Promise<Set<string>>
  getMeta<T>(key: string): Promise<T | undefined>
  setMeta(key: string, value: unknown): Promise<void>
  /** 月の束に入っている項目（id → 月）と、その書き直し・消去（6.11） */
  packsOf(): Promise<Map<string, string>>
  setPacks(entries: Iterable<readonly [string, string | null]>): Promise<void>
  clearPacks(): Promise<void>
  /** 端末の中の項目（月の束にまとめる候補を選ぶため。raw の記録） */
  items(): Promise<Item[]>
  /** 全部を受け取り直した後に、クラウドにも送信待ちにも無い端末の中の記録を消す（6.11） */
  dropMissing(keys: ReadonlySet<string>): Promise<Change[]>
  /** 端末内にまだ保存していない変更を保存する（送る前に呼ぶ） */
  flush?(): Promise<unknown>
}

export type SyncPhase = 'starting' | 'downloading' | 'uploading' | 'synced' | 'offline' | 'error'

export interface SyncStatus {
  phase: SyncPhase
  /** 送信待ちの件数 */
  pending: number
  /** 最後にクラウドと揃った時刻 */
  lastSyncedAt: number | null
  error: string | null
  /** 止まっている理由の種類（SyncError の code・Firestore の code。quota = 無料枠を使い切った） */
  errorCode?: string | null
  /**
   * クラウドのデータが、このアプリより新しい版のアプリで書かれている（データの形の版。src/sync/appModel.ts）。
   * 受け取りは続け、送るのは止めている（この端末の変更は送信待ちに残る）
   */
  outdated?: AppModel | null
  /** 最初の受け取りが終わった（クラウドと揃ったと言える） */
  downloaded?: boolean
}

export interface EngineOptions {
  firestore: Firestore
  uid: string
  deviceId: string
  target: SyncTarget
  onStatus?: (s: SyncStatus) => void
  /** 画面に出すお知らせ（全部を受け取り直した時など） */
  onNotice?: (message: string) => void
  /** 変更があってから送るまでの待ち時間（ms）。続けて変更しても uploadMaxWait 以内には送る */
  uploadDelay?: number
  uploadMaxWait?: number
  /** テスト用: 分割する大きさ */
  chunkSize?: number
  /** テスト用: 1回のトランザクションで書く量の上限（文字数） */
  batchChars?: number
  /**
   * クラウドの持ち主（config/owner）がこのアカウントであることを確かめ、無い・違う時は同期しない（既定 true）。
   * アプリは持ち主の記録を作らない（作者が Firebase の画面で作る。形1）。アクセスルールも持ち主だけに読み書きを許す（firestore.rules）。
   */
  ownerLock?: boolean
  /**
   * このアプリのデータの形の版。クラウドに記録し（無い・低ければ上げる）、クラウドの版の方が高ければ送らない。
   * 渡さなければ確かめない（テスト用）
   */
  appModel?: AppModel
  /** テスト用: データの形の版を確かめるまで、送るのを待つ長さの上限（ms） */
  modelWait?: number
  /** テスト用: 時計（月の束・受け取り直しの日数） */
  now?: () => number
}

export interface SyncEngine {
  start(): Promise<void>
  stop(): void
  /** 送信待ちを送る（immediate なら待たずに） */
  requestUpload(immediate?: boolean): void
  /** いますぐ送る（送り終わるか失敗するまで待つ） */
  flush(): Promise<void>
  /** 画面がしばらく裏にあった後などに、記録した位置から購読し直す（読み取りの量を抑える） */
  reanchor(): void
  /** 受信と送信がひと段落するまで待つ（テスト用） */
  idle(): Promise<void>
  /**
   * 1日1回の手入れ（6.11）: 古い月の項目を月の束にまとめ、90日より前の削除の印を片付ける。クラウドと揃っている時だけ動く。
   * now はテスト用（時計を進める）
   */
  maintain(now?: number): Promise<MaintainResult>
  /**
   * サーバーの時刻の見積もり（ms。端末の時計から、届いた文書の更新時刻との差のいちばん小さい値を引いた時刻。本当のサーバーの時刻より
   * 後にならない）。まだ文書が届いていなければ null。ゴミ箱の期限切れを決める時に使う（6.15）
   */
  serverNow(): number | null
  readonly status: SyncStatus
}

export interface MaintainResult {
  /** 束にまとめた項目の数（月 → 数） */
  packed: Record<string, number>
  /** 片付けた削除の印の数 */
  purged: number
}

/**
 * 同期の形の版。文書の形や表を変えたら上げる（次の起動で全件を受け取り直す）。
 */
export const SYNC_SCHEMA = 1

/** クラウドの持ち主を記録する文書（作者が Firebase の画面で作る。アプリは読むだけ。形1） */
export const OWNER_DOC = ['config', 'owner'] as const
/** Claude との連携と許可（段階6で作る。段階1〜5は読むだけ。6.14） */
export const CONNECTOR_DOC = ['config', 'connector'] as const
/**
 * 送る書き込みの印（users/{uid}/sync/{端末の ID}。`{ tx }`）: その端末の送るトランザクションが毎回読み、記録を書く時は、そのトランザクションの
 * id を書く。返事を受け取れなかった時に、書き込みが届いたかをこれで確かめる（2.4）
 */
export const SENT_MARKS = 'sync'

export { OWNER_MISMATCH_MESSAGE, OWNER_MISSING_MESSAGE }

interface StoredCursor {
  s: number
  n: number
}

const BATCH_RECORDS = 100
/** 1回のトランザクションで書く量の上限（文字数。UTF-8 で 10MiB の上限に十分収まるように） */
const BATCH_CHARS = 1_500_000
const BATCH_DOCS = 400
const RETRY_DELAYS_MS = [5_000, 15_000, 60_000, 300_000]
/** データの形の版を確かめるまで、送るのを待つ長さの上限（いますぐ同期・ログアウトの前の送信） */
const MODEL_WAIT_MS = 10_000
const OFFLINE_MESSAGE = 'オフラインです。つながると自動で同期します。'
/** 送る途中で、データの形の版を確かめられなくなった・新しい版で書かれていると分かった（何も書かない） */
const MODEL_PAUSED = new Error('データの形の版を確かめるまで送りません')
/** この端末が送った版の指紋を、文書ごとにいくつまで覚えておくか */
const SENT_MEMORY = 20
/** 全部を受け取り直した時のお知らせ（6.11） */
export const FULL_RESYNC_NOTICE = 'しばらく同期していなかったので、全部を受け取り直しました'

const noop = () => undefined

const later = (a: StoredCursor, b: StoredCursor | null) => !b || a.s > b.s || (a.s === b.s && a.n > b.n)

/** 文書の更新時刻（サーバーの時刻。まだ付いていなければ null） */
const timeOf = (data: { updated?: unknown }): StoredCursor | null =>
  data.updated instanceof Timestamp ? { s: data.updated.seconds, n: data.updated.nanoseconds } : null

export class SyncError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'SyncError'
  }
}

function errorCode(e: unknown): string {
  return typeof e === 'object' && e && 'code' in e ? String((e as { code: unknown }).code) : ''
}

function describeError(e: unknown): { offline: boolean; message: string; code: string } {
  const code = errorCode(e)
  if (e instanceof SyncError) return { offline: false, message: e.message, code: e.code }
  if (code === 'unavailable' || code === 'deadline-exceeded' || (typeof navigator !== 'undefined' && navigator.onLine === false))
    return { offline: true, message: OFFLINE_MESSAGE, code: 'offline' }
  if (code === 'permission-denied')
    return {
      offline: false,
      code,
      message:
        'クラウドへのアクセスが拒否されました。アクセスルールを公開したか（docs/DEPLOY.md）、持ち主のアカウントでログインしているかを確かめてください。',
    }
  if (code === 'resource-exhausted')
    return { offline: false, code: 'quota', message: 'クラウドの今日の無料枠を使い切りました。無料枠が戻ると同期を再開します。' }
  if (code === 'unauthenticated')
    return { offline: false, code, message: 'ログインの期限が切れました。ログインし直してください。' }
  return { offline: false, code, message: e instanceof Error ? e.message : String(e) }
}

/** 持ち主の記録（config/owner）の uid（無ければ null）。サーバーから読む（通信できなければ投げる） */
export async function readOwner(fs: Firestore): Promise<string | null> {
  const snap = await getDocFromServer(doc(fs, ...OWNER_DOC))
  if (!snap.exists()) return null
  const uid = (snap.data() as { uid?: unknown }).uid
  return typeof uid === 'string' ? uid : null
}

/** 持ち主を確かめる: ok・missing（記録が無い）・mismatch（ほかのアカウント） */
export async function checkOwner(fs: Firestore, uid: string): Promise<'ok' | 'missing' | 'mismatch'> {
  const owner = await readOwner(fs)
  if (owner === null) return 'missing'
  return owner === uid ? 'ok' : 'mismatch'
}

/** 連携していない時の許可（6.14。すべて断る） */
export const NO_CONNECTOR: InboxPerms = { linked: false, adds: false, edits: false, proposals: false }

/**
 * config/connector の中身を許可にする（19.6 の形 `{ uid, pairing, pairedAt, approvedOn, adds, edits, proposals, v }`。段階6で作る）。
 * 連携が済んでいる（コネクタのアカウントの uid があり、持ち主のアカウントではなく、pairedAt・approvedOn がある）時だけ linked。
 * 許可は true の物だけ
 */
export function parseConnectorDoc(data: unknown, ownerUid: string): InboxPerms {
  if (!data || typeof data !== 'object') return NO_CONNECTOR
  const d = data as Record<string, unknown>
  const paired =
    typeof d.uid === 'string' && d.uid !== '' && d.uid !== ownerUid && d.pairedAt != null && typeof d.approvedOn === 'string'
  if (!paired) return NO_CONNECTOR
  return { linked: true, adds: d.adds === true, edits: d.edits === true, proposals: d.proposals === true }
}

/**
 * Claude との連携と許可を、サーバーから読む（config/connector。6.14・19.6）。無ければ連携していない。読めない時（オフライン・
 * 権限の誤り）は null（連携していないとは決めない。待っている依頼を not_allowed で断らないように、受け取り箱を当てない）
 */
export async function readConnectorPerms(fs: Firestore, ownerUid: string): Promise<InboxPerms | null> {
  try {
    const snap = await getDocFromServer(doc(fs, ...CONNECTOR_DOC))
    return snap.exists() ? parseConnectorDoc(snap.data(), ownerUid) : NO_CONNECTOR
  } catch (e) {
    console.warn('Claude との連携の記録を読めませんでした', e)
    return null
  }
}

/** 束の文書を読み、中身を取り出す（分けた文書は getChunk で探す）。消した束は null、読めない（揃わない・形が違う）束は undefined */
function readPackDoc(data: RecordDoc, getChunk: (i: number) => ChunkDoc | undefined): PackBody | null | undefined {
  const json = decodeJson(data, getChunk)
  if (json === undefined) return undefined
  if (json === null) return null
  return decodePack(json)
}

export function createSyncEngine(opts: EngineOptions): SyncEngine {
  const { firestore: fs, uid, deviceId, target } = opts
  const chunkSize = opts.chunkSize ?? CHUNK_CHARS
  const batchChars = opts.batchChars ?? BATCH_CHARS
  const uploadDelay = opts.uploadDelay ?? 2000
  const uploadMaxWait = opts.uploadMaxWait ?? 10_000
  const modelWait = opts.modelWait ?? MODEL_WAIT_MS
  const clock = opts.now ?? (() => Date.now())
  const col = collection(fs, 'users', uid, RECORDS)
  const markRef = doc(fs, 'users', uid, SENT_MARKS, deviceId)

  let stopped = false
  let unsub: Unsubscribe | null = null
  let cursor: StoredCursor | null = null
  /** いまの購読を始めた位置（購読し直すと、それまでに届いた分を読み直さずに済む） */
  let subscribedFrom: StoredCursor | null = null
  let downloaded = false
  /** 全部を受け取り直している（85日より前に受け取ったきりの端末。最初のサーバーの通知の後に dropMissing。6.11） */
  let resyncing = false
  /** バックアップからの復元・すべて削除をクラウドに当てるまで、受信を止めている */
  let deferred = false
  /**
   * この端末の復元・すべて削除を始めた時の、クラウドの最後の書き込みの時刻（サーバーの時刻。_meta の authoritativeFrom）。
   * 復元はそれまでに書かれたものにだけ当てる。その後にほかの端末が書いたものは消さず・上書きせず、受信で 3者マージする
   */
  let restoreBound: StoredCursor | null = null
  let status: SyncStatus = { phase: 'starting', pending: 0, lastSyncedAt: null, error: null }
  /**
   * この端末の時計（clock）と、サーバーの時刻の差の見積もり（ms。端末の時計 − 届いた文書の更新時刻 の最小。まだ届いていなければ null）。
   * 削除の印を片付ける境に使う（purgeTombstones）
   */
  let clockSkew: number | null = null
  function noteServerTime(at: StoredCursor): void {
    const skew = clock() - (at.s * 1000 + Math.floor(at.n / 1_000_000))
    if (clockSkew === null || skew < clockSkew) clockSkew = skew
  }
  /** この端末が送った版の指紋（文書ごと、古い順） */
  const sent = new Map<string, string[]>()
  /**
   * 送る書き込みの印（markRef）で最後に確かめた値（その id の書き込みの送信待ちは、もう送り終わりにした）。違う値を読んだら、
   * 返事を受け取れなかった書き込みが届いていた（confirmLanded）
   */
  let lastLanded: string | null = null
  /** 持ち主の確認が済んだ（ownerLock の時） */
  let ownerOk = opts.ownerLock === false
  /**
   * データの形の版: unknown = まだサーバーから確かめていない（オフラインになって、確かめ直すまでも）、
   * newer = 新しい版のアプリで書かれている（どちらも送らない）
   */
  let modelState: 'unknown' | 'ok' | 'newer' = opts.appModel ? 'unknown' : 'ok'
  /**
   * 一度サーバーで確かめた後にオフラインになり、記録の見張りがまだサーバーと揃い直していない（unknown の間）。
   * その間は待たずに、送るトランザクションの中で記録を読んで確かめる
   */
  let modelRecheck = false
  /** 同期をやめた・新しい版のアプリで書かれたデータに気付いた（送るのをやめる） */
  const sendPaused = () => stopped || modelState === 'newer'
  let modelUnsub: Unsubscribe | null = null
  /** データの形の版を確かめた（または同期をやめた）。オフラインになると、確かめ直すまでの新しい約束にする */
  let modelKnown: () => void = () => undefined
  let modelReady = new Promise<void>((resolve) => (modelKnown = resolve))

  // 送受信を1つずつ行うための鎖
  let lock: Promise<unknown> = Promise.resolve()
  function exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = lock.then(fn)
    lock = run.catch(() => undefined)
    return run
  }

  function setStatus(patch: Partial<SyncStatus>): void {
    status = { ...status, ...patch }
    opts.onStatus?.(status)
  }

  async function refreshPending(): Promise<number> {
    const pending = await target.outboxCount()
    setStatus({ pending })
    return pending
  }

  function fail(e: unknown): void {
    if (stopped) return
    const d = describeError(e)
    if (!d.offline) console.warn('同期できませんでした', e)
    setStatus({ phase: d.offline ? 'offline' : 'error', error: d.message, errorCode: d.code })
  }

  function rememberSent(id: string, hash: string): void {
    const list = sent.get(id) ?? []
    list.push(hash)
    if (list.length > SENT_MEMORY) list.splice(0, list.length - SENT_MEMORY)
    sent.set(id, list)
  }

  /**
   * この端末が書いて置き換えたクラウドの版（文書ごと、その版の更新時刻）。購読の通知は、書く前のクラウドの内容のまま、書いた後に
   * 届くことがある。その古い版で、送ったばかりの内容を戻さないように（時刻で見分ける）
   */
  const replaced = new Map<string, StoredCursor>()

  /** 送る前のクラウドの版の通知か（この端末が書いて置き換えた版か、それより前の版） */
  function isSuperseded(id: string, data: RecordDoc): boolean {
    const old = replaced.get(id)
    if (!old) return false
    const at = timeOf(data)
    if (at && !later(at, old)) return true
    replaced.delete(id)
    return false
  }

  /** 復元・すべて削除の文書を、その内容を正とする変更として当てるか。記録した位置より後に書かれたものだけ */
  function freshReset(data: RecordDoc, at: StoredCursor | null): boolean {
    return Boolean(data.reset) && (!at || later(at, cursor))
  }

  /** この端末の復元・すべて削除を始めた後に（bound より後に）、ほかの端末が書いた文書か */
  function writtenAfter(data: RecordDoc, bound: StoredCursor | null): boolean {
    if (!bound || data.device === deviceId) return false
    const at = timeOf(data)
    return Boolean(at && later(at, bound))
  }

  /** この端末が先に送った古い版の通知か（その後にもっと新しい版を送っている） */
  function isStaleEcho(id: string, data: RecordDoc): boolean {
    if (data.device !== deviceId) return false
    const list = sent.get(id)
    if (!list || !list.includes(data.hash)) return false
    if (list[list.length - 1] === data.hash) {
      sent.set(id, [data.hash])
      return false
    }
    // 届いた版より前に送った指紋は、もう届かない
    sent.set(id, list.slice(list.lastIndexOf(data.hash) + 1))
    return true
  }

  /** 文書の変化の印（own・reset・afterRestore） */
  function marks(data: RecordDoc, at: StoredCursor | null): Pick<Change, 'own' | 'reset' | 'afterRestore'> {
    return {
      ...(data.device === deviceId ? { own: true } : {}),
      ...packItemMarks(data, at),
    }
  }

  /**
   * 月の束の中の項目の変化の印（reset・afterRestore）。own は付けない: 束の文書の device は束を書き直した端末で、中の項目を書いた
   * 端末ではない（この端末が書き直した束にも、ほかの端末が直した後で束に戻した項目が入っていることがある。own にすると 3者マージを
   * 飛ばして、その直した内容を、この端末の古い base からの変更で上書きしてしまう。6.11）
   */
  function packItemMarks(data: RecordDoc, at: StoredCursor | null): Pick<Change, 'reset' | 'afterRestore'> {
    return {
      ...(freshReset(data, at) ? { reset: true } : {}),
      ...(writtenAfter(data, restoreBound) ? { afterRestore: true } : {}),
    }
  }

  // ---------- 受信 ----------

  let remoteWaiters: (() => void)[] = []
  function waitForRemote(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const t = setTimeout(done, ms)
      function done() {
        clearTimeout(t)
        remoteWaiters = remoteWaiters.filter((f) => f !== done)
        resolve()
      }
      remoteWaiters.push(done)
    })
  }

  let resubscribeTimer: ReturnType<typeof setTimeout> | null = null
  let resubscribeCount = 0
  /** 購読の世代（購読し直したら、前の購読の通知は使わない） */
  let listenerGen = 0

  /** 購読をやめ、少し待ってから記録した位置から購読し直す */
  function resubscribeLater(): void {
    listenerGen += 1
    unsub?.()
    unsub = null
    if (stopped || resubscribeTimer) return
    const delay = RETRY_DELAYS_MS[Math.min(resubscribeCount, RETRY_DELAYS_MS.length - 1)]
    resubscribeCount += 1
    resubscribeTimer = setTimeout(() => {
      resubscribeTimer = null
      resubscribe()
    }, delay)
  }

  function subscribe(): void {
    if (stopped) return
    unsub?.()
    const gen = ++listenerGen
    subscribedFrom = cursor
    // 「以上」で購読する: 別々の書き込みが同じ時刻になることがあり、「より後」だと、記録した位置と同じ時刻の
    // まだ受け取っていない変更を取りこぼすため
    const q = cursor
      ? query(col, where('updated', '>=', new Timestamp(cursor.s, cursor.n)), orderBy('updated'))
      : query(col, orderBy('updated'))
    /** この購読で、まだサーバーと揃っていない（最初のサーバーからの通知を受け取っていない） */
    let first = true
    unsub = onSnapshot(
      q,
      { includeMetadataChanges: true },
      (snap) => {
        const fromCache = snap.metadata.fromCache
        if (first && fromCache) return
        const full = first
        const changed = first
          ? snap.docs
          : snap
              .docChanges()
              .filter((c) => c.type !== 'removed')
              .map((c) => c.doc)
        first = false
        const all = snap.docs
        void exclusive(async () => {
          if (gen !== listenerGen) return
          await handleSnapshot(changed, all, fromCache, full)
          resubscribeCount = 0
        }).catch((e) => {
          fail(e)
          if (gen === listenerGen) resubscribeLater()
        })
      },
      (err) => {
        fail(err)
        if (gen === listenerGen) resubscribeLater()
      },
    )
  }

  /**
   * 記録した位置が 85日より前なら、全部を受け取り直す（6.11）。受け取り直すことを _meta の resyncPending に覚えてから位置を消す
   * （最初の通知を受け取って端末の中の記録を片付ける前に、アプリを閉じても・画面が受け持ちを譲っても、次に始めた時に受け取り直す）。
   * 受け取り直すなら true（呼んだ側が、位置を消した購読を始める）
   */
  async function startResyncIfDue(): Promise<boolean> {
    if (!cursor || !needsFullResync(cursor.s, clock())) return false
    await target.setMeta('resyncPending', true)
    cursor = null
    await target.setMeta('cursor', null)
    resyncing = true
    return true
  }

  /** 記録した位置から購読し直す（長く眠っていた画面は、位置が 85日より前なら全部を受け取り直す） */
  function resubscribe(): void {
    void exclusive(async () => {
      if (stopped) return
      await startResyncIfDue()
      subscribe()
    }).catch(fail)
  }

  /** 記録した位置が購読を始めた位置より進んでいれば、そこから購読し直す（位置が 85日より前なら、全部を受け取り直す） */
  function reanchor(): void {
    if (stopped || !unsub || resubscribeTimer || deferred) return
    void exclusive(async () => {
      if (stopped || !unsub || deferred) return
      if (await startResyncIfDue()) subscribe()
      else if (cursor && (!subscribedFrom || later(cursor, subscribedFrom))) subscribe()
    }).catch(fail)
  }

  /** 分割文書が手元に揃っていない時に読み直す */
  async function fetchChunks(parentId: string): Promise<Map<string, ChunkDoc>> {
    const snap = await getDocs(query(col, where('parent', '==', parentId)))
    const map = new Map<string, ChunkDoc>()
    snap.forEach((d) => map.set(d.id, d.data() as ChunkDoc))
    return map
  }

  /** 束の文書を中の項目の変化に広げる（同じ通知に同じ項目の個別の文書があれば、そちらを採る。6.11） */
  async function expandPack(
    docId: string,
    data: RecordDoc,
    at: StoredCursor | null,
    chunks: Map<string, ChunkDoc>,
    skip: ReadonlySet<string>,
  ): Promise<Change[] | null> {
    let body = readPackDoc(data, (i) => chunks.get(chunkIdOf(docId, i)))
    if (body === undefined && data.chunks > 0) {
      const fetched = await fetchChunks(docId)
      body = readPackDoc(data, (i) => fetched.get(chunkIdOf(docId, i)))
    }
    if (body === undefined) return null
    if (!body) return []
    const month = data.id
    const m = packItemMarks(data, at)
    return Object.values(body.items)
      .filter((it) => !skip.has(it.id))
      .map((it) => ({ table: 'items' as const, id: it.id, record: it as Change['record'], pack: month, ...m }))
  }

  /** 最初のサーバーの通知の、クラウドにある記録のキー（束を広げた後の項目も含む。束が読めなければ null） */
  function cloudKeysOf(all: QueryDocumentSnapshot<DocumentData>[], chunks: Map<string, ChunkDoc>): Set<string> | null {
    const keys = new Set<string>()
    for (const d of all) {
      const data = d.data() as RecordDoc | ChunkDoc
      if (data.table === '_chunk' || (data as RecordDoc).deleted) continue
      if (data.table === PACK_TABLE) {
        const body = readPackDoc(data as RecordDoc, (i) => chunks.get(chunkIdOf(d.id, i)))
        if (body === undefined) return null
        for (const id of Object.keys(body?.items ?? {})) keys.add(outboxKey('items', id))
        continue
      }
      keys.add(outboxKey(data.table, (data as RecordDoc).id))
    }
    return keys
  }

  async function handleSnapshot(
    changed: QueryDocumentSnapshot<DocumentData>[],
    all: QueryDocumentSnapshot<DocumentData>[],
    fromCache: boolean,
    full: boolean,
  ): Promise<void> {
    if (stopped || deferred) return
    if (!changed.length && fromCache) return
    const chunks = new Map<string, ChunkDoc>()
    for (const d of all) {
      const data = d.data() as Partial<ChunkDoc>
      if (data.table === '_chunk') chunks.set(d.id, data as ChunkDoc)
    }
    // 同じ通知に個別の文書で届いた項目（束の中の同じ項目より、こちらを採る）
    const individual = new Set<string>()
    for (const d of changed) {
      const t = (d.data() as { table?: unknown }).table
      if (t === 'items') individual.add(splitDocId(d.id).id)
    }
    const changes: Change[] = []
    let newest: StoredCursor | null = null
    for (const d of changed) {
      const data = d.data({ serverTimestamps: 'none' }) as RecordDoc | ChunkDoc
      const at = timeOf(data)
      if (at) noteServerTime(at)
      if (at && later(at, newest)) newest = at
      if (data.table === '_chunk') continue
      const recDoc = data as RecordDoc
      if (isStaleEcho(d.id, recDoc) || isSuperseded(d.id, recDoc)) continue
      if (recDoc.table === PACK_TABLE) {
        const expanded = await expandPack(d.id, recDoc, at, chunks, individual)
        if (expanded === null) console.warn('クラウドの月の束を読み取れませんでした', d.id)
        else changes.push(...expanded)
        continue
      }
      let rec = decodeRecord(recDoc, (i) => chunks.get(chunkIdOf(d.id, i)))
      if (rec === undefined && recDoc.chunks > 0) {
        const fetched = await fetchChunks(d.id)
        rec = decodeRecord(recDoc, (i) => fetched.get(chunkIdOf(d.id, i)))
      }
      if (rec === undefined) {
        console.warn('クラウドのレコードを読み取れませんでした', d.id)
        continue
      }
      changes.push({ table: recDoc.table as TableName, id: recDoc.id, record: rec as Change['record'], ...marks(recDoc, at) })
    }
    const advance = !fromCache && newest && later(newest, cursor) ? newest : undefined
    if (changes.length || advance) {
      if (!fromCache) await confirmLandedFor(changes)
      const applied = await target.applyRemote(changes, advance)
      if (applied === null) {
        // 復元・すべて削除をクラウドに当てるまで受け取らない（当てた後で、記録した位置から受け取り直す）
        deferred = true
        requestUpload(true)
        return
      }
    }
    if (advance) cursor = advance
    // 全部を受け取り直した: クラウドにも送信待ちにも無い端末の中の記録を消す（束を広げた後の項目も「クラウドにある」に数える。6.11）
    if (resyncing && full && !fromCache && !subscribedFrom) {
      resyncing = false
      const keys = cloudKeysOf(all, chunks)
      // 束が読めない時は消さない（読めた所までで決めると、束の中の項目を消してしまう。resyncPending は残し、次に始めた時に受け取り直す）
      if (keys) {
        await target.dropMissing(keys)
        await target.setMeta('resyncPending', null)
        opts.onNotice?.(FULL_RESYNC_NOTICE)
      }
    }
    if (!fromCache) {
      downloaded = true
      if (!status.downloaded) setStatus({ downloaded: true })
    }
    for (const f of [...remoteWaiters]) f()
    if (!fromCache) {
      const pending = await refreshPending()
      if (!uploading) {
        setStatus(
          pending === 0
            ? { phase: 'synced', lastSyncedAt: Date.now(), error: null, errorCode: null }
            : { phase: status.phase === 'error' || status.phase === 'offline' ? status.phase : 'uploading' },
        )
        if (pending > 0) requestUpload()
      }
    }
    // 全件を購読している（初めての受け取り）なら、届いた分を抱えたままにしないよう、記録した位置から購読し直す
    if (!fromCache && !subscribedFrom && cursor) reanchor()
  }

  // ---------- 送信 ----------

  let uploadTimer: ReturnType<typeof setTimeout> | null = null
  let uploadSince: number | null = null
  let uploading: Promise<void> | null = null
  let uploadAgain = false
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let retryCount = 0

  function requestUpload(immediate = false): void {
    if (stopped) return
    if (uploading) {
      uploadAgain = true
      return
    }
    const now = Date.now()
    if (uploadSince === null) uploadSince = now
    if (uploadTimer) clearTimeout(uploadTimer)
    const delay = immediate ? 0 : Math.max(0, Math.min(uploadDelay, uploadSince + uploadMaxWait - now))
    uploadTimer = setTimeout(() => {
      uploadTimer = null
      uploadSince = null
      void uploadAll()
    }, delay)
  }

  function scheduleRetry(): void {
    if (retryTimer || stopped) return
    const delay = RETRY_DELAYS_MS[Math.min(retryCount, RETRY_DELAYS_MS.length - 1)]
    retryCount += 1
    retryTimer = setTimeout(() => {
      retryTimer = null
      void uploadAll()
    }, delay)
  }

  interface BatchResult {
    done: boolean
    progressed: number
    conflicts: OutboxItem[]
  }

  /** 束の文書をトランザクションの中で読む（分けた文書も） */
  async function txReadPack(tx: Transaction, month: string): Promise<{ doc: RecordDoc | null; body: PackBody | null }> {
    const id = docIdOf(PACK_TABLE, month)
    const snap = await tx.get(doc(col, id))
    if (!snap.exists()) return { doc: null, body: null }
    const data = snap.data() as RecordDoc
    if (data.deleted) return { doc: data, body: null }
    const parts = new Map<string, ChunkDoc>()
    for (let i = 0; i < (data.chunks ?? 0); i++) {
      const c = await tx.get(doc(col, chunkIdOf(id, i)))
      if (c.exists()) parts.set(c.id, c.data() as ChunkDoc)
    }
    const body = readPackDoc(data, (i) => parts.get(chunkIdOf(id, i)))
    // 読めない束は、空の束として扱わない（中の項目を「無い」と決めて書き直したり、束を開いて消したりしない）
    if (body === undefined) throw new Error(`クラウドの月の束を読み取れませんでした（${id}）`)
    return { doc: data, body }
  }

  /** 文書（と分けた文書）を書く。前の版の余った分けた文書は消す */
  function txWrite(
    tx: Transaction,
    table: CloudTable,
    recId: string,
    enc: Encoded,
    deleted: boolean,
    prevChunks: number,
    reset: boolean,
  ): void {
    const id = docIdOf(table, recId)
    const payload: RecordDoc = {
      table,
      id: recId,
      json: enc.json,
      chunks: enc.parts.length,
      deleted,
      hash: enc.hash,
      updated: serverTimestamp(),
      device: deviceId,
      ...(reset ? { reset: true } : {}),
    }
    tx.set(doc(col, id), payload)
    enc.parts.forEach((part, j) => {
      const chunk: ChunkDoc = {
        table: '_chunk',
        parent: id,
        parentTable: table,
        index: j,
        json: part,
        hash: enc.hash,
        updated: serverTimestamp(),
        device: deviceId,
        deleted: false,
      }
      tx.set(doc(col, chunkIdOf(id, j)), chunk)
    })
    for (let j = enc.parts.length; j < prevChunks; j++) tx.delete(doc(col, chunkIdOf(id, j)))
  }

  /**
   * 最初の受け取りが終わるまで送らない送信待ち（共通の履歴が無い項目。クラウドの月の束に入っているかを、受け取って _pack に
   * 覚えてから送る。束の中の項目を個別の文書として二重に書かないように。6.11）
   */
  const heldUntilDownloaded = (it: OutboxItem) => !downloaded && it.noHistory && it.table === 'items'

  /**
   * 1回の送信で書き直してよい月の束の数（束の中の項目を直すと、その月の束を丸ごと書き直す。束の大きさは送信待ちの数え方に入らないので、
   * 大きな束をいくつも書き直して 1回の書き込みの上限（10MiB）を超えそうな時は、送る件を減らして次の回に回す。送れたら元に戻す）
   */
  let packMonthCap = Infinity
  /** 書き直す束が大きすぎる（packMonthCap を小さくして、送り直す） */
  class PackOverflow extends Error {
    constructor(readonly fit: number) {
      super('書き直す月の束が大きすぎます')
    }
  }

  /** 束を書き直す月が cap を超えないところまでに減らす（まとまりは分けない） */
  function capPackMonths(batch: BatchEntry[], packs: ReadonlyMap<string, string>, cap: number): BatchEntry[] {
    if (!Number.isFinite(cap)) return batch
    const months = new Set<string>()
    const out: BatchEntry[] = []
    let i = 0
    while (i < batch.length) {
      let j = i + 1
      const g = batch[i].it.group
      while (g && j < batch.length && batch[j].it.group === g) j++
      const block = batch.slice(i, j)
      const next = new Set(months)
      for (const b of block) {
        const m = b.it.table === 'items' ? packs.get(b.it.id) : undefined
        if (m) next.add(m)
      }
      if (next.size > cap && out.length) break
      out.push(...block)
      for (const m of next) months.add(m)
      i = j
    }
    return out
  }

  /** 送る書き込みの印の値（無い・形が違えば null） */
  function landedOf(snap: DocumentSnapshot<DocumentData>): string | null {
    const v = snap.exists() ? (snap.data() as { tx?: unknown }).tx : null
    return typeof v === 'string' && v ? v : null
  }

  /** 書き込みが届いていた送信待ち: その時に送った内容（sent）を base にした物（送った返事を受け取った時と同じ） */
  function landedEntry(b: BatchEntry, sent: AnyRecord | null): BatchEntry {
    const base = sent
    const it: OutboxItem = { ...b.it, base, noHistory: false, force: false }
    delete it.unconfirmed
    delete it.tx
    delete it.sent
    return { ...b, it, baseHash: hashRecord(base) }
  }

  /**
   * 届いた変化が、返事を受け取れなかった書き込みの送信待ちに当たる時: 送る書き込みの印をサーバーから読み、その書き込みが届いていたら、
   * 送った内容を base にしてから反映する（ほかの端末がその書き込みの後に書いた版を、古い base で 3者マージして、ほかの端末の変更を
   * 戻したり文章を二重につないだりしないように）
   */
  async function confirmLandedFor(changes: readonly Change[]): Promise<void> {
    if (!changes.length) return
    const txs = await target.unconfirmedTx(changes.map((c) => outboxKey(c.table, c.id)))
    if (!txs.size) return
    const landed = landedOf(await getDocFromServer(markRef))
    if (landed && txs.has(landed)) {
      await target.confirmLanded(landed)
      lastLanded = landed
    }
  }

  async function uploadBatch(): Promise<BatchResult> {
    const items = (await target.readOutbox(BATCH_RECORDS)).filter((it) => !heldUntilDownloaded(it))
    if (!items.length) return { done: true, progressed: 0, conflicts: [] }
    const idle = items.filter(nothingToSend)
    if (idle.length) await target.completeUpload(idle.map((it) => ({ table: it.table, id: it.id, record: it.local })))
    const selected = selectBatch(items, { chunkSize, maxChars: batchChars, maxDocs: BATCH_DOCS })
    // 月の束に入っている項目（_pack）。項目の文書が無い時は、束の中の項目と比べる（6.11）
    const packs = selected.some((b) => b.it.table === 'items') ? await target.packsOf() : new Map<string, string>()
    const given = capPackMonths(selected, packs, packMonthCap)
    if (!given.length) return { done: false, progressed: idle.length, conflicts: [] }
    if (sendPaused()) return { done: false, progressed: idle.length, conflicts: [] }
    const bound = given.some((b) => b.it.force)
      ? ((await target.getMeta<StoredCursor | null>('authoritativeFrom')) ?? null)
      : null

    let attempt = ''
    /** この送信の前の試みで付けた印（SDK がトランザクションをやり直した時。送信待ち → その試みの id と送った内容） */
    const tried = new Map<string, { tx: string; sent: AnyRecord | null }>()
    /** この送信の中で、届いていたと分かった書き込みの送った内容（送信待ち → 新しい base。やり直した試みでも使う） */
    const resolved = new Map<string, AnyRecord | null>()
    const result = await runTransaction(fs, async (tx) => {
      // このトランザクション（の1回の試み）の id。送る書き込みの印に書く
      attempt = newId()
      const recheck = modelState !== 'ok' && Boolean(opts.appModel)
      const [snaps, marker, markSnap] = await Promise.all([
        Promise.all(given.map((b) => tx.get(doc(col, docIdOf(b.it.table, b.it.id))))),
        recheck ? tx.get(appModelRef(fs, uid)) : Promise.resolve(null),
        tx.get(markRef),
      ])
      if (recheck) {
        if (marker && newerModel(marker.exists() ? asModel(marker.data()) : null)) throw MODEL_PAUSED
        if (modelState === 'newer') throw MODEL_PAUSED
      } else if (modelState !== 'ok') throw MODEL_PAUSED
      // 前に返事を受け取れなかった書き込みが届いていた（印がその書き込みの id）: その時に送った内容を base にしてから決める。
      // この端末の送るトランザクションはどれも印を読む（読んだ後に印が変われば届かない）ので、印は、この端末の最後に届いた書き込みを指す
      const landed = landedOf(markSnap)
      if (landed && landed !== lastLanded) {
        await target.confirmLanded(landed)
        lastLanded = landed
      }
      const batch = given.map((b) => {
        const m = tried.get(b.it.k) ?? (b.it.tx ? { tx: b.it.tx, sent: b.it.sent ?? null } : null)
        if (landed && m?.tx === landed) resolved.set(b.it.k, m.sent)
        const base = resolved.get(b.it.k)
        return base !== undefined ? landedEntry(b, base) : b
      })
      const clouds = snaps.map((snap) => (snap.exists() ? (snap.data() as RecordDoc) : null))
      // 項目の文書が無く、_pack が束を指している項目: 束を読む（月ごとに1回）
      const packBodies = new Map<string, { doc: RecordDoc | null; body: PackBody | null }>()
      for (let i = 0; i < batch.length; i++) {
        const b = batch[i]
        const month = b.it.table === 'items' && !clouds[i] ? packs.get(b.it.id) : undefined
        if (month && !packBodies.has(month)) packBodies.set(month, await txReadPack(tx, month))
      }
      const packedIn = batch.map((b, i) => {
        if (b.it.table !== 'items' || clouds[i]) return null
        const month = packs.get(b.it.id)
        return month && packBodies.get(month)?.body?.items[b.it.id] ? month : null
      })
      // 書き直す束と送る記録の大きさが 1回の書き込みの上限に近ければ、書き直す束の数を減らして送り直す
      const rewrite = [...new Set(packedIn.filter((m): m is string => Boolean(m)))]
      if (rewrite.length > 1) {
        const sizes = rewrite.map((m) => encodePack(packBodies.get(m)!.body!).length)
        let total = batch.reduce((n, b) => n + b.enc.size, 0)
        let fit = 0
        for (const size of sizes) {
          if (total + size > batchChars) break
          total += size
          fit += 1
        }
        if (fit < rewrite.length) throw new PackOverflow(Math.max(1, fit))
      }
      const states: CloudState[] = batch.map((b, i) => {
        const c = clouds[i]
        const month = packedIn[i]
        if (month) return { exists: true, hash: hashRecord(packBodies.get(month)!.body!.items[b.it.id]) }
        return { exists: c !== null, hash: c && !c.deleted ? c.hash : '', fresh: c !== null && writtenAfter(c, bound) }
      })
      const decision = decideBatch(batch, states)
      // 書く送信待ちに、書き込みを送る前に「返事を受け取るまで分からない」とこの試みの id・送る内容を覚える（届いたのに返事が無かった時に、
      // 次の送信や受信で、印を読んで確かめる）
      const marks: SentRow[] = batch
        .filter((b, i) => decision.write[i] && !sameAsBase(b.it))
        .map((b) => ({ key: b.it.k, record: b.it.local }))
      if (marks.length) await target.markUnconfirmed(marks, attempt)
      for (const m of marks) tried.set(m.key, { tx: attempt, sent: m.record })
      const written: { change: Change; docId: string; hash: string; replaced: StoredCursor | null }[] = []
      const settled: Change[] = []
      /** 束から抜く項目（月 → id） */
      const unpack = new Map<string, string[]>()
      batch.forEach((b, i) => {
        if (!decision.write[i]) return
        if (sameAsBase(b.it)) {
          settled.push({ table: b.it.table, id: b.it.id, record: b.it.local })
          return
        }
        const cloud = clouds[i]
        txWrite(tx, b.it.table, b.it.id, b.enc, !b.it.local, cloud?.chunks ?? 0, b.it.force)
        const month = packedIn[i]
        if (month) unpack.set(month, [...(unpack.get(month) ?? []), b.it.id])
        written.push({
          change: { table: b.it.table, id: b.it.id, record: b.it.local },
          docId: docIdOf(b.it.table, b.it.id),
          hash: b.enc.hash,
          replaced: cloud ? timeOf(cloud) : null,
        })
      })
      // 束の中の項目を直した・消した: 同じトランザクションで束から抜いて書き直す（空になっても items: {} のまま残す。6.11）
      const packWrites: { docId: string; hash: string; replaced: StoredCursor | null }[] = []
      for (const [month, ids] of unpack) {
        const cur = packBodies.get(month)!
        const enc = encodeJson(encodePack(withoutItems(cur.body!, ids)), chunkSize)
        txWrite(tx, PACK_TABLE, month, enc, false, cur.doc?.chunks ?? 0, false)
        packWrites.push({ docId: docIdOf(PACK_TABLE, month), hash: enc.hash, replaced: cur.doc ? timeOf(cur.doc) : null })
      }
      // 印は、記録を書く試みだけが書く（書かない試みも印を読んでいるので、その間に印が変われば、この試みは届かない）
      if (marks.length) tx.set(markRef, { tx: attempt })
      return {
        written,
        settled,
        conflicts: decision.conflicts,
        packWrites,
        unpacked: [...unpack.values()].flat(),
        marked: marks.length > 0,
      }
    }).catch((e: unknown) => {
      if (e === MODEL_PAUSED) return null
      if (e instanceof PackOverflow) {
        packMonthCap = e.fit
        return null
      }
      throw e
    })
    if (!result) return { done: false, progressed: idle.length, conflicts: [] }
    if (result.marked) lastLanded = attempt
    packMonthCap = Infinity
    for (const w of [...result.written, ...result.packWrites]) {
      rememberSent(w.docId, w.hash)
      if (w.replaced) replaced.set(w.docId, w.replaced)
      else replaced.delete(w.docId)
    }
    if (result.unpacked.length) await target.setPacks(result.unpacked.map((id) => [id, null] as const))
    await target.completeUpload([...result.written.map((w) => w.change), ...result.settled])
    return {
      done: false,
      progressed: idle.length + result.written.length + result.settled.length,
      conflicts: result.conflicts,
    }
  }

  /** クラウドの月の束を全部読む（項目 id → 中身と月。項目の文書が無い時に「消された」か確かめる。6.11） */
  async function readAllPacks(): Promise<Map<string, { item: Item; month: string; data: RecordDoc }>> {
    const snap = await getDocs(query(col, where('table', '==', PACK_TABLE)))
    const out = new Map<string, { item: Item; month: string; data: RecordDoc }>()
    for (const d of snap.docs) {
      const data = d.data() as RecordDoc
      if (data.deleted) continue
      let body = readPackDoc(data, () => undefined)
      if (body === undefined && data.chunks > 0) {
        const fetched = await fetchChunks(d.id)
        body = readPackDoc(data, (i) => fetched.get(chunkIdOf(d.id, i)))
      }
      if (body === undefined) throw new Error(`クラウドの月の束を読み取れませんでした（${d.id}）`)
      for (const item of Object.values(body?.items ?? {})) out.set(item.id, { item, month: data.id, data })
    }
    return out
  }

  /** 受信を待っても base が新しくならない時は、クラウドの内容を直接読んで反映する */
  async function pullDirectly(items: OutboxItem[]): Promise<void> {
    const changes: Change[] = []
    let packed: Awaited<ReturnType<typeof readAllPacks>> | null = null
    for (const it of items) {
      const id = docIdOf(it.table, it.id)
      const snap = await getDoc(doc(col, id))
      if (!snap.exists()) {
        // 項目の文書が無いことは、消されたことを意味しない（束に入る時に文書を消すため）。束を全部読み、どの束にも無い時だけ消す（6.11）
        if (it.table === 'items') {
          packed ??= await readAllPacks()
          const p = packed.get(it.id)
          if (p) {
            changes.push({
              table: 'items',
              id: it.id,
              record: p.item as Change['record'],
              pack: p.month,
              ...packItemMarks(p.data, null),
            })
            continue
          }
        }
        changes.push({ table: it.table, id: it.id, record: null })
        continue
      }
      const data = snap.data() as RecordDoc
      if (isStaleEcho(id, data)) continue
      let rec = decodeRecord(data, () => undefined)
      if (rec === undefined && data.chunks > 0) {
        const fetched = await fetchChunks(id)
        rec = decodeRecord(data, (i) => fetched.get(chunkIdOf(id, i)))
      }
      if (rec !== undefined)
        changes.push({ table: it.table, id: it.id, record: rec as Change['record'], ...marks(data, timeOf(data)) })
    }
    if (changes.length) {
      await confirmLandedFor(changes)
      await target.applyRemote(changes, undefined, { direct: true })
    }
  }

  /** クラウドの記録がこのアプリより新しい版なら、送るのを止める（要更新の表示）。止めたら true */
  function newerModel(cur: AppModel | null): boolean {
    if (!opts.appModel || !cur || cur.model <= opts.appModel.model) return false
    modelState = 'newer'
    setStatus({ outdated: cur })
    return true
  }

  /** トランザクションでない書き込み（復元でまとめて消す）の前に、データの形の版を確かめる */
  async function ensureModel(): Promise<void> {
    if (modelState === 'newer') throw MODEL_PAUSED
    if (modelState === 'ok' || !opts.appModel) return
    const snap = await getDocFromServer(appModelRef(fs, uid))
    if (newerModel(snap.exists() ? asModel(snap.data()) : null)) throw MODEL_PAUSED
  }

  /**
   * バックアップからの復元・すべて削除の後: この端末に無いクラウドのレコードを消す（この端末の内容は、
   * 「必ず上書き」の送信待ちとして続けて送る）。月の束は開き、この端末に無い項目には復元の印付きの削除の印を書いて、束の文書を消す
   * （6.11）。受け取り箱と、MIM を含まないファイルの時の MIM・ゴミ箱の中の MIM は消さない（6.16・形4）。
   * 終わったら、記録した位置から受け取り直す。
   */
  async function pushAuthoritative(): Promise<void> {
    if (!(await target.getMeta('authoritative'))) return
    deferred = true
    await ensureModel()
    const local = await target.localKeys()
    const keep = (await target.getMeta<AuthoritativeKeep | null>('authoritativeKeep')) ?? {
      tables: ['inbox'],
      keys: [],
      mimTrash: false,
    }
    const keepTables = new Set<string>(keep.tables)
    const keepKeys = new Set(keep.keys)
    let bound = (await target.getMeta<StoredCursor | null>('authoritativeFrom')) ?? null
    let newest: StoredCursor | null = null
    if (!bound) {
      const last = await getDocsFromServer(query(col, orderBy('updated', 'desc'), limit(1)))
      for (const d of last.docs) {
        const at = timeOf(d.data())
        if (at && later(at, newest)) newest = at
      }
    }
    const snap = await getDocsFromServer(query(col, where('deleted', '==', false)))
    if (!bound) {
      for (const d of snap.docs) {
        const at = timeOf(d.data())
        if (at && later(at, newest)) newest = at
      }
      bound = newest ?? { s: 0, n: 0 }
      await target.setMeta('authoritativeFrom', bound)
    }
    const until: StoredCursor = bound
    restoreBound = until
    const chunkDocs = new Map<string, ChunkDoc[]>()
    const docs: { id: string; data: RecordDoc }[] = []
    snap.forEach((d) => {
      const data = d.data() as RecordDoc | ChunkDoc
      if (data.table === '_chunk') {
        const list = chunkDocs.get(data.parent) ?? []
        list.push(data)
        chunkDocs.set(data.parent, list)
        return
      }
      docs.push({ id: d.id, data: data as RecordDoc })
    })
    const chunkOf = (parent: string) => (i: number) => chunkDocs.get(parent)?.find((c) => c.index === i)
    // MIM を含まないファイルの時: クラウドのゴミ箱の中の MIM（MIM のメモの件・中身が mimNotes の件）も消さない
    const mimTrash = new Set<string>()
    if (keep.mimTrash) {
      const entries = new Set<string>()
      const unreadable: string[] = []
      for (const { id, data } of docs) {
        if (data.table !== 'trashRecords' && data.table !== 'trashEntries') continue
        const rec = decodeRecord(data, chunkOf(id)) as Record<string, unknown> | null | undefined
        if (rec === undefined) unreadable.push(id)
        else if (data.table === 'trashRecords' && rec?.table === 'mimNotes') entries.add(String(rec.entryId))
        else if (data.table === 'trashEntries' && rec?.kind === 'mimNote') entries.add(String(rec.id))
      }
      for (const { id, data } of docs) {
        if (data.table === 'trashEntries' && entries.has(data.id)) mimTrash.add(id)
        if (data.table === 'trashRecords') {
          const rec = decodeRecord(data, chunkOf(id)) as Record<string, unknown> | null | undefined
          if (rec && entries.has(String(rec.entryId))) mimTrash.add(id)
        }
      }
      // 読めない件は、MIM かどうか分からないので消さない
      for (const id of unreadable) mimTrash.add(id)
    }
    const doomed: string[] = []
    const packDocs: string[] = []
    for (const { id, data } of docs) {
      // 月の束は、復元を始めた後にほかの端末が書き直した物も開いて消す（書き直しは、項目を抜く・変えていない項目を足すだけなので、
      // 守る物が無い。残すと、復元で消した項目や復元の前の版が、次に束を書き直した時にどの端末にも戻ってしまう。6.11）
      if (data.table === PACK_TABLE) {
        const body = readPackDoc(data, chunkOf(id))
        if (body === undefined) throw new Error(`クラウドの月の束を読み取れませんでした（${id}）`)
        for (const itemId of Object.keys(body?.items ?? {})) {
          if (!local.has(outboxKey('items', itemId))) doomed.push(docIdOf('items', itemId))
        }
        packDocs.push(id)
        continue
      }
      // 復元を始めた後にほかの端末が書いた記録は、消さずに受信で 3者マージする
      if (writtenAfter(data, until)) continue
      // この版の知らない表（後の版が足した表）の文書は消さない（読めない物は消さない。後の版の表のことは、その版が決める。6.16）
      if (!isTableName(data.table)) continue
      const key = outboxKey(data.table, data.id)
      if (keepTables.has(data.table) || keepKeys.has(key) || mimTrash.has(id)) continue
      if (!local.has(key)) doomed.push(id)
    }
    if (modelState === 'newer') throw MODEL_PAUSED
    // 子（チェックの記録など）を親より先に消す（送信待ちを送る順と同じ）
    const rank = (id: string) => tableSendRank(splitDocId(id).table)
    doomed.sort((a, b) => rank(a) - rank(b))
    // 復元の削除の印は、トランザクションで文書を読み直し、上で読んだ時から変わっていない物にだけ書く（読んだ後にほかの端末が書いた物は
    // 消さずに、受信で 3者マージする。束の中の項目は、個別の文書がまだ無いことを確かめる）
    const seenAt = new Map(docs.map(({ id, data }) => [id, timeOf(data)]))
    const unchanged = (id: string, cur: RecordDoc | null): boolean => {
      if (!cur) return true
      const was = seenAt.get(id) ?? null
      const now = timeOf(cur)
      return !writtenAfter(cur, until) && was !== null && now !== null && was.s === now.s && was.n === now.n
    }
    for (let i = 0; i < doomed.length; ) {
      // 1つのトランザクションの書き込みが 400 を超えないように分ける（削除の印と、その文書の分けた文書）
      const part: string[] = []
      let writes = 0
      while (i < doomed.length && (part.length === 0 || writes + 1 + (chunkDocs.get(doomed[i])?.length ?? 0) <= 400)) {
        writes += 1 + (chunkDocs.get(doomed[i])?.length ?? 0)
        part.push(doomed[i])
        i += 1
      }
      await runTransaction(fs, async (tx) => {
        if (modelState === 'newer') throw MODEL_PAUSED
        const snaps = await Promise.all(part.map((id) => tx.get(doc(col, id))))
        part.forEach((id, j) => {
          const cur = snaps[j].exists() ? (snaps[j].data() as RecordDoc) : null
          if (!unchanged(id, cur)) return
          const { table, id: recId } = splitDocId(id)
          const tombstone: RecordDoc = {
            table: table as CloudTable,
            id: recId,
            json: null,
            chunks: 0,
            deleted: true,
            hash: '',
            updated: serverTimestamp(),
            device: deviceId,
            reset: true,
          }
          tx.set(doc(col, id), tombstone)
          for (const c of chunkDocs.get(id) ?? []) tx.delete(doc(col, chunkIdOf(id, c.index)))
        })
      })
    }
    // 月の束の文書（と分けた文書）は本当に消す（中の項目は、上の削除の印と、この端末の「必ず上書き」の送信待ちで書き直す）
    const packOps = packDocs.flatMap((id) => [id, ...(chunkDocs.get(id) ?? []).map((c) => chunkIdOf(id, c.index))])
    for (let i = 0; i < packOps.length; i += 400) {
      const batch = writeBatch(fs)
      for (const id of packOps.slice(i, i + 400)) batch.delete(doc(col, id))
      await batch.commit()
    }
    await target.clearPacks()
    await target.setMeta('authoritative', null)
    await target.setMeta('authoritativeKeep', null)
  }

  function uploadAll(): Promise<void> {
    if (uploading) {
      uploadAgain = true
      return uploading
    }
    if (stopped) return Promise.resolve()
    if (uploadTimer) {
      clearTimeout(uploadTimer)
      uploadTimer = null
      uploadSince = null
    }
    const recount = () => (stopped ? Promise.resolve() : refreshPending().then(noop, noop))
    if (modelState === 'unknown' && !modelRecheck) {
      void recount()
      return new Promise<void>((resolve) => {
        const giveUp = () => void recount().then(resolve)
        const t = setTimeout(giveUp, modelWait)
        void modelReady.then(async () => {
          clearTimeout(t)
          if (modelState === 'ok' && !stopped) {
            await uploadAll()
            resolve()
          } else giveUp()
        })
      })
    }
    if (modelState === 'newer') return recount()
    uploading = (async () => {
      try {
        await target.flush?.()
        await refreshPending()
        if (!ownerOk) {
          await claimOwner()
          ownerOk = true
        }
        await exclusive(pushAuthoritative)
        let stuck = 0
        for (;;) {
          if (sendPaused()) return
          const r = await exclusive(uploadBatch)
          if (r.done) break
          if (sendPaused()) return
          if (status.phase !== 'uploading') setStatus({ phase: 'uploading', error: null, errorCode: null })
          await refreshPending()
          if (r.conflicts.length && r.progressed === 0) {
            stuck += 1
            if (stuck >= 3) await exclusive(() => pullDirectly(r.conflicts))
            else await waitForRemote(3000)
            if (stuck > 6) throw new Error('クラウドとの差を解消できませんでした。しばらくしてからもう一度お試しください。')
          } else stuck = 0
        }
        if (deferred) {
          deferred = false
          await exclusive(async () => {
            if (!stopped) subscribe()
          })
        }
        retryCount = 0
        const pending = await refreshPending()
        if (pending === 0)
          setStatus(
            downloaded
              ? { phase: 'synced', lastSyncedAt: Date.now(), error: null, errorCode: null }
              : { phase: 'downloading', error: null, errorCode: null },
          )
        else if (!downloaded) setStatus({ phase: 'downloading', error: null, errorCode: null })
      } catch (e) {
        if (e === MODEL_PAUSED) {
          await recount()
          return
        }
        fail(e)
        if (e instanceof SyncError) return
        scheduleRetry()
      }
    })().finally(() => {
      uploading = null
      if (uploadAgain && !stopped) {
        uploadAgain = false
        requestUpload()
      }
    })
    return uploading
  }

  /** 持ち主を確かめる（記録は作らない。形1）。記録が無い・別のアカウントなら SyncError */
  async function claimOwner(): Promise<void> {
    const state = await checkOwner(fs, uid)
    if (state === 'missing') throw new SyncError('owner-missing', OWNER_MISSING_MESSAGE)
    if (state === 'mismatch') {
      if ((await target.getMeta<string>('ownerSeen')) === uid) await target.setMeta('ownerSeen', null)
      throw new SyncError('owner-mismatch', OWNER_MISMATCH_MESSAGE)
    }
    await target.setMeta('ownerSeen', uid)
  }

  let begun = false
  let beginRetry: ReturnType<typeof setTimeout> | null = null

  /**
   * 同期を始める。持ち主を確かめてから（ownerLock の時）、初めてのアカウントなら端末内を「共通の履歴が無い」状態にし、
   * 購読と送信を始める。通信できずに持ち主を確かめられない時は、つながってからやり直す。
   */
  async function begin(): Promise<void> {
    if (stopped || begun) return
    if (!ownerOk) {
      try {
        await claimOwner()
        ownerOk = true
      } catch (e) {
        fail(e)
        if (e instanceof SyncError) {
          // 持ち主の記録が無い・別のアカウントのクラウド: 何も送らず、受け取らない
          stopped = true
          return
        }
        if (!beginRetry && !stopped)
          beginRetry = setTimeout(() => {
            beginRetry = null
            void begin()
          }, RETRY_DELAYS_MS[1])
        return
      }
    }
    if (stopped || begun) return
    begun = true
    const storedUid = await target.getMeta<string>('uid')
    if (storedUid !== uid) {
      // このアカウントと同期するのは初めて: 端末内のものはクラウドとの共通の履歴が無い前提で突き合わせ、全件を受け取る
      await target.markAllDirty()
      await target.setMeta('cursor', null)
      await target.setMeta('uid', uid)
    }
    if ((await target.getMeta<number>('syncSchema')) !== SYNC_SCHEMA) {
      await target.setMeta('cursor', null)
      await target.setMeta('syncSchema', SYNC_SCHEMA)
    }
    if (stopped) return
    cursor = (await target.getMeta<StoredCursor | null>('cursor')) ?? null
    // 85日より前に受け取ったきり（その間にほかの端末で消され、削除の印も片付いた物があるかもしれない）: 全部を受け取り直す（6.11）。
    // 前に始めた受け取り直しが、端末の中の記録を片付ける前に止まっていた（アプリを閉じた・画面が受け持ちを譲った）時も、初めから
    // 受け取り直す（片付けは、位置を消して全部を購読した最初の通知でだけ行う）
    if (!(await startResyncIfDue()) && (await target.getMeta('resyncPending'))) {
      cursor = null
      await target.setMeta('cursor', null)
      resyncing = true
    }
    deferred = Boolean(await target.getMeta('authoritative'))
    restoreBound = (await target.getMeta<StoredCursor | null>('authoritativeFrom')) ?? null
    setStatus({ phase: 'downloading', error: null, errorCode: null })
    await refreshPending()
    watchModel()
    if (!deferred) subscribe()
    requestUpload(true)
  }

  let modelRetry: ReturnType<typeof setTimeout> | null = null
  let modelRetryCount = 0
  /** データの形の版の見張りの世代（見張り直したら、前の見張りの知らせは使わない） */
  let modelGen = 0

  /**
   * データの形の版（meta/app）を見張る。見張りが誤りで止まった時（Firestore は誤りの後に見張りを閉じる。持ち主の記録を移す途中・
   * 無料枠を使い切った時など）は、確かめていない扱いにして（送る時はトランザクションの中で meta/app を読む）、少し後で見張り直す
   */
  function watchModel(): void {
    if (!opts.appModel || stopped || modelUnsub) return
    const gen = ++modelGen
    modelUnsub = watchAppModel(fs, uid, opts.appModel, (s) => {
      if (stopped || gen !== modelGen) return
      if (s.state === 'error') {
        modelGen += 1
        modelUnsub?.()
        modelUnsub = null
        modelState = 'unknown'
        modelRecheck = true
        // 待っている送信は、トランザクションの中で確かめて送る（オフラインの表示にはしない）
        modelKnown()
        requestUpload(true)
        if (!modelRetry) {
          const delay = RETRY_DELAYS_MS[Math.min(modelRetryCount, RETRY_DELAYS_MS.length - 1)]
          modelRetryCount += 1
          modelRetry = setTimeout(() => {
            modelRetry = null
            watchModel()
          }, delay)
        }
        return
      }
      if (s.state === 'unknown') {
        if (modelState === 'ok') {
          modelState = 'unknown'
          modelRecheck = true
          modelReady = new Promise<void>((resolve) => (modelKnown = resolve))
          setStatus({ phase: 'offline', error: OFFLINE_MESSAGE, errorCode: 'offline' })
        }
        return
      }
      modelRetryCount = 0
      const was = modelState
      modelState = s.state
      modelRecheck = false
      modelKnown()
      if (s.state === 'newer') setStatus({ outdated: s.cloud })
      else if (status.outdated) setStatus({ outdated: null })
      if (s.state === 'ok' && was !== 'ok') requestUpload(true)
    })
  }

  const onOnline = () => {
    if (stopped) return
    if (!begun) {
      void begin()
      return
    }
    if (!unsub && !resubscribeTimer) resubscribe()
    else reanchor()
    requestUpload(true)
  }

  // ---------- 手入れ（月の束・削除の印の片付け。6.11） ----------

  /** 1つの月の束に項目をまとめる（1つのトランザクション）。まとめた項目の id を返す */
  async function packMonth(month: string, items: Item[]): Promise<string[]> {
    const packId = docIdOf(PACK_TABLE, month)
    const res = await runTransaction(fs, async (tx) => {
      if (modelState !== 'ok') throw MODEL_PAUSED
      const cur = await txReadPack(tx, month)
      if (cur.doc && !cur.doc.deleted && !cur.body) throw new Error(`クラウドの月の束を読み取れませんでした（${packId}）`)
      const snaps: DocumentSnapshot<DocumentData>[] = []
      for (const it of items) snaps.push(await tx.get(doc(col, docIdOf('items', it.id))))
      // 項目の文書がこの端末の内容と同じ物だけをまとめる（ほかの端末で直されていれば、まとめない）
      const ok = items.filter((it, i) => {
        const s = snaps[i]
        if (!s.exists()) return false
        const d = s.data() as RecordDoc
        return !d.deleted && (d.chunks ?? 0) === 0 && d.hash === hashRecord(it)
      })
      if (!ok.length) return null
      const base: PackBody = cur.body ?? { month, items: {} }
      let take = ok
      let enc = encodeJson(encodePack(withItems(base, take)), chunkSize)
      while (take.length && take.length > itemsPerTransaction(enc.size, chunkSize)) {
        take = take.slice(0, itemsPerTransaction(enc.size, chunkSize))
        enc = encodeJson(encodePack(withItems(base, take)), chunkSize)
      }
      if (!take.length) return null
      txWrite(tx, PACK_TABLE, month, enc, false, cur.doc?.chunks ?? 0, false)
      // 項目の文書を本当に消す（削除の印は書かない。ほかの端末には束の文書が届く）
      for (const it of take) tx.delete(doc(col, docIdOf('items', it.id)))
      return { ids: take.map((it) => it.id), hash: enc.hash, replaced: cur.doc ? timeOf(cur.doc) : null }
    })
    if (!res) return []
    rememberSent(packId, res.hash)
    if (res.replaced) replaced.set(packId, res.replaced)
    await target.setPacks(res.ids.map((id) => [id, month] as const))
    return res.ids
  }

  /**
   * 90日より前の削除の印の文書を本当に消す（内容から作った id の物は残す）。境はサーバーの時刻で決める: この端末の時計から、届いた文書の
   * 更新時刻（サーバーの時刻）との差の最小（clockSkew）を引く。届いた文書はどれも今より前に書かれたので、この見積もりは本当のサーバーの
   * 時刻より後にならない（時計が進んでいる端末が、まだ受け取っていない端末のある新しい削除の印まで消さないように）。まだ文書が届いて
   * いなければ片付けない
   */
  async function purgeTombstones(now: number): Promise<number> {
    if (clockSkew === null) return 0
    const cutoff = Timestamp.fromMillis(tombstoneCutoff(now - clockSkew))
    const snap = await getDocs(query(col, where('deleted', '==', true), where('updated', '<', cutoff)))
    const doomed = snap.docs.map((d) => d.id).filter((id) => !keepsTombstone(id))
    for (let i = 0; i < doomed.length; i += 200) {
      const batch = writeBatch(fs)
      for (const id of doomed.slice(i, i + 200)) batch.delete(doc(col, id))
      await batch.commit()
    }
    return doomed.length
  }

  async function maintain(now = clock()): Promise<MaintainResult> {
    const result: MaintainResult = { packed: {}, purged: 0 }
    if (stopped || !begun || !downloaded || deferred || modelState !== 'ok') return result
    await exclusive(async () => {
      if (stopped) return
      const queued = new Set<string>()
      for (const k of await target.outboxKeys()) if (k.startsWith('items/')) queued.add(k.slice('items/'.length))
      const packed = new Set((await target.packsOf()).keys())
      const candidates = packCandidates(await target.items(), { now, queued, packed, chunkSize })
      for (const [month, list] of candidates) {
        if (stopped) return
        const ids = await packMonth(month, list).catch((e: unknown) => {
          if (e === MODEL_PAUSED) return []
          throw e
        })
        if (ids.length) result.packed[month] = ids.length
      }
      result.purged = await purgeTombstones(now)
      await target.setMeta('lastMaintainDay', todayStr(now))
    })
    return result
  }

  return {
    get status() {
      return status
    },

    async start() {
      if (typeof window !== 'undefined') window.addEventListener('online', onOnline)
      await begin()
    },

    stop() {
      stopped = true
      listenerGen += 1
      unsub?.()
      unsub = null
      modelUnsub?.()
      modelUnsub = null
      modelKnown()
      for (const t of [uploadTimer, retryTimer, resubscribeTimer, beginRetry, modelRetry]) if (t) clearTimeout(t)
      if (typeof window !== 'undefined') window.removeEventListener('online', onOnline)
    },

    requestUpload: (immediate?: boolean) => {
      if (begun) requestUpload(immediate)
    },

    flush: () => (begun ? uploadAll() : Promise.resolve()),

    reanchor,

    maintain,

    serverNow: () => (clockSkew === null ? null : clock() - clockSkew),

    async idle() {
      for (;;) {
        const u = uploading
        if (u) await u
        await lock
        if (!uploading && !uploadTimer) return
        if (uploadTimer) {
          clearTimeout(uploadTimer)
          uploadTimer = null
          uploadSince = null
          void uploadAll()
        }
      }
    },
  }
}
