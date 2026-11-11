// IndexedDB（Dexie）への保存（docs/SPEC.md の 2.4・6.1・6.10）。ストアの AppData を参照比較して、変わったレコードだけを書き込む。
// 書き込んだレコードは同じトランザクションで「送信待ち（_outbox）」に積み、同期の時にクラウドへ送る。
// 送信待ちには、そのレコードを最後にクラウドと揃えた時の内容（base）を控える（3者マージに使う）。
//
// 守ること: 送信待ちに無いレコードは「端末内 = 最後に知ったクラウドの内容」、送信待ちにあれば
// 「base = 最後に知ったクラウドの内容」。どちらの内容も黙って消さない（競合はゴミ箱・文章をつないで残す）。
//
// NS の src/db/persistence.ts を DS の表で写した物。幕・稿の処理（applyRemoteTx の幕のまとまり・稿の控え・応募時の原稿の本文など）は
// 外し、反映は「1件ずつの3者マージ」と「消えた親の子の片付け」だけにした。足した物:
// - 送信待ちの行に、受け取り箱の依頼ごとのまとまり g（19.5）。行を書き直す所は rewriteRow の1か所にまとめ、g を落とさない
// - 端末だけの表 _gone（内容から作った id の削除の印の控え。19.5 の previously_deleted）と _pack（月の束に入っている項目。6.11）
// - 復元（replaceAll）で、MIM を含まないファイルの時の MIM とゴミ箱の MIM には触れず、受け取り箱は強さの決まりで合わせる。どれも
//   トランザクションの中で読んだ端末の今の記録に当てる（6.16・形4）
import Dexie, { type Table } from 'dexie'
import { mimTrashIds, restoredInboxRecord } from '../domain/backup'
import { isDerivedId } from '../domain/derivedId'
import { revOf } from '../domain/hash'
import { TABLE_NAMES, emptyData, type AppData, type InboxRecord, type TableName } from '../domain/types'
import { contentEqual, deepEqual, mergeRecordLegacy, mergeRemote, TEXT_TABLES, type MergeResult } from '../sync/merge'

/** 競合した時に、消える側の内容をゴミ箱に控える表（6.10 の TEXT_TABLES） */
const COPY_TABLES: ReadonlySet<TableName> = TEXT_TABLES

export type AnyRecord = { id: string; updatedAt?: number }

/** 送信待ちの1件。k = `${表名}/${id}` */
export interface OutboxRow {
  k: string
  t: TableName
  id: string
  /** 最後にクラウドと揃えた時の内容（null = その時クラウドに無かった・削除されていた） */
  base: AnyRecord | null
  /** クラウドとの共通の履歴が無い（初めてのログイン・アカウントの切り替え）。クラウドに何かあれば突き合わせてから送る */
  noHistory?: boolean
  /** この端末の内容で必ず上書きする（バックアップからの復元・すべて削除） */
  force?: boolean
  /**
   * この行を送るトランザクションを始めたが、返事を受け取っていない（書き込みがクラウドに届いたかもしれないので、
   * base がまだクラウドの内容か分からない）。端末内が base と同じになっても、クラウドを確かめるまで送り終わりにしない。
   * クラウドの内容から base を書き直す時（送った返事・受け取った反映）は、この印の無い行に置き換わる
   */
  unconfirmed?: boolean
  /**
   * 返事を受け取れなかった送るトランザクションの id と、そのトランザクションで送った内容（unconfirmed の時だけ）。クラウドの「送る
   * 書き込みの印」（users/{uid}/sync/{端末の ID}。src/sync/engine.ts）がこの id なら、その書き込みは届いていて、送った内容が新しい
   * base になる（confirmLanded）。ほかの端末がその書き込みの後に書いた版を、古い base で 3者マージしないように（2.4）
   */
  tx?: string
  sent?: AnyRecord | null
  at: number
  /**
   * 受け取り箱の依頼ごとのまとまり（依頼・提案の id。19.5）。同じまとまりは1つのトランザクションで、全部を書けるか、1つも書かない
   * （src/sync/batch.ts）。送り終わるまで、行を書き直しても残す
   */
  g?: string
}

/** 受け取り箱の依頼ごとのまとまりの手がかり（まとまりの id → この端末の受け取り箱の記録・クラウドの受け取り箱の記録） */
interface GroupContext {
  own: Map<string, InboxRecord>
  cloud: Map<string, InboxRecord | null>
}

/** 1レコードの変化（record = null は削除） */
export interface Change {
  table: TableName
  id: string
  record: AnyRecord | null
  /** クラウドから: ほかの端末がバックアップからの復元・すべて削除で書いた（その内容を正とする） */
  reset?: boolean
  /** クラウドから: この端末が書いたもの（返事を受け取れなかった書き込みなど） */
  own?: boolean
  /**
   * クラウドから: この端末のバックアップからの復元・すべて削除を始めた後に、ほかの端末が書いたもの（サーバーの時刻で
   * 比べる。src/sync/engine.ts の pushAuthoritative）。「必ず上書き」の送信待ちがあっても上書きせず、3者マージする
   */
  afterRestore?: boolean
  /** クラウドから: 月の束（itemPack:{月}）の中の項目として届いた（6.11。_pack を書き直す） */
  pack?: string
}

export interface OutboxItem {
  k: string
  table: TableName
  id: string
  base: AnyRecord | null
  noHistory: boolean
  force: boolean
  /** 送ったトランザクションの返事を受け取っていない（OutboxRow.unconfirmed） */
  unconfirmed?: boolean
  /** 返事を受け取れなかったトランザクションの id と、その時に送った内容（OutboxRow.tx・sent） */
  tx?: string
  sent?: AnyRecord | null
  /** いまの端末内の内容（null = 削除した） */
  local: AnyRecord | null
  /** 受け取り箱の依頼ごとのまとまり（OutboxRow.g） */
  group?: string
}

/** 競合をどう残したか（画面で知らせる） */
export interface ConflictNote {
  kind: 'trash' | 'joined'
  table: TableName
  id: string
}

/** 競合の控えの作り方（ストアが用意する。src/sync/conflicts.ts の createConflictHooks） */
export interface ConflictHooks {
  /** この端末の呼び名（文章をつないだ時の印に使う） */
  device: string
  /** 片方で削除・片方で編集された内容などの控え（ゴミ箱のエントリと中身）を作る。控えない時は空 */
  trashCopy: (table: TableName, record: AnyRecord) => Change[]
  /** 競合を控えた時に呼ぶ（トランザクションの中なので、知らせるのは後で） */
  report?: (note: ConflictNote) => void
}

interface MetaRow {
  key: string
  value: unknown
}

/** 内容から作った id の削除の印の控え（19.5）。k = `${表名}/${id}` */
interface GoneRow {
  k: string
  at: number
}

/** 月の束に入っている項目（6.11） */
interface PackRow {
  id: string
  month: string
}

export const outboxKey = (table: string, id: string) => `${table}/${id}`
const KNOWN_TABLES = new Set<string>(TABLE_NAMES)
/** 内容から作る id を使う表（_gone に控える。19.4・19.5） */
const DERIVED_TABLES: ReadonlySet<string> = new Set(['items', 'favorites', 'routines'])
const isGoneKind = (table: string, id: string) => DERIVED_TABLES.has(table) && isDerivedId(id)

/**
 * 送る順番（6.10 の SEND_ORDER）。ゴミ箱の中身を先に、子（routineChecks）を親（routines）より先に送る。大きな削除が何回かに分かれて
 * 届いても、受け取った端末が「親が消えたのに子が残っている」と判断して控えを作らないように。受け取り箱はいちばん後（依頼のまとまりの
 * 中でも最後になる）
 */
export const SEND_ORDER: TableName[] = [
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
]

/** 送る順番の中の表の位置（子の表ほど前。知らない表は items の後＝月の束など） */
export function tableSendRank(table: string): number {
  const i = SEND_ORDER.indexOf(table as TableName)
  return i < 0 ? SEND_ORDER.indexOf('items') + 0.5 : i
}
const sendRank = (k: string) => tableSendRank(k.slice(0, k.indexOf('/')))

/** 親の表と、その親を指す項目（親が無ければ見えない子になる。6.10 の PARENT_OF） */
export const PARENT_OF: Partial<Record<TableName, { table: TableName; field: string }[]>> = {
  routineChecks: [{ table: 'routines', field: 'routineId' }],
}

/** 親が消えたら、子も消す（子にしか無い文章はゴミ箱に控える。routineChecks は控えない） */
const CHILDREN: Partial<Record<TableName, { table: TableName; field: string }[]>> = {
  routines: [{ table: 'routineChecks', field: 'routineId' }],
}

/**
 * Dexie v1 の表の一覧（固定する。TABLE_NAMES から作ると、表を足した時に v1 の形が変わってしまう。後から表を足す時は v2 を作る）。
 * 端末だけの表 _outbox・_meta・_gone・_pack も v1 から置く（6.1）
 */
const V1_TABLES = [
  'items',
  'offDays',
  'labelNames',
  'routines',
  'routineChecks',
  'favorites',
  'mimNotes',
  'inbox',
  'trashEntries',
  'trashRecords',
] as const

export const V1_SCHEMA: Record<string, string> = {
  ...Object.fromEntries(V1_TABLES.map((t) => [t, 'id'])),
  _outbox: 'k, g',
  _meta: 'key',
  _gone: 'k',
  _pack: 'id, month',
}

class DiaryDB extends Dexie {
  constructor(name: string) {
    super(name)
    this.version(1).stores(V1_SCHEMA)
  }

  tableOf(name: TableName): Table<AnyRecord, string> {
    return this.table(name)
  }

  get outbox(): Table<OutboxRow, string> {
    return this.table('_outbox')
  }

  get meta(): Table<MetaRow, string> {
    return this.table('_meta')
  }

  get gone(): Table<GoneRow, string> {
    return this.table('_gone')
  }

  get packs(): Table<PackRow, string> {
    return this.table('_pack')
  }
}

export const DEFAULT_DB_NAME = 'diary-studio'

/** base から mine で変えた項目だけを theirs に重ねる（3者マージ。同じ項目を両方が変えたらこのタブを優先） */
export const mergeRecord = mergeRecordLegacy

/** 保存時に、別のタブ（または同期を受け持つ画面が反映した別の端末の変更）が先に書き換えていたレコードをどう扱ったか */
export interface SaveOutcome {
  /** 別タブの変更とこのタブの変更を項目ごとに合わせて書いたレコード */
  merged: Partial<Record<TableName, AnyRecord[]>>
  /** 別タブで削除されていたので書かなかったレコード */
  dropped: Partial<Record<TableName, string[]>>
  /** 実際に書いた内容（競合の控えなど、このタブが変えていないレコードを含む） */
  written: Change[]
  /** 競合の控えなど、このタブの変更以外に書いたもの（メモリ上のデータにも足す） */
  extra: Change[]
}

export interface SaveOptions {
  /**
   * 受け取り箱の依頼ごとのまとまり（依頼・提案の id → その依頼で書いた記録のキー `${表名}/${id}`。src/domain/inbox.ts の touched）。
   * 送信待ちの行に g を付ける。同じ記録に別のまとまりが触れたら、2つのまとまりを1つにつなぐ
   */
  groups?: ReadonlyMap<string, readonly string[]>
}

/** 復元で、今の端末とクラウドの記録のまま残し、「必ず上書き」で送らない物（6.16。src/domain/backup.ts の RestoreKeep） */
export interface ReplaceOptions {
  /** 表ごと残す（受け取り箱はいつも。MIM を含まないファイルの時は mimNotes も） */
  tables?: readonly TableName[]
  /** 記録ごと残す（`${表名}/${id}`。MIM を含まないファイルの時の、ゴミ箱の中の MIM） */
  keys?: readonly string[]
  /** MIM を含まないファイルの読み込み（クラウドのゴミ箱の中の MIM も消さない。engine の pushAuthoritative） */
  keepMimTrash?: boolean
}

/** 置き換える内容（関数なら、トランザクションの中で読んだ端末の今の記録から作る） */
export type ReplaceInput = AppData | ((disk: AppData) => { data: AppData; opts?: ReplaceOptions })

/** 復元の時に「この端末に無いクラウドの記録を消す」から外す物（_meta の authoritativeKeep） */
export interface AuthoritativeKeep {
  tables: TableName[]
  keys: string[]
  mimTrash: boolean
}

export interface RemoteApplyOptions extends ConflictHooks {
  /** 受け取った位置（差分の取得の続きに使う）。undefined なら変えない */
  cursor?: unknown
  /** 購読で届いたのではなく、書けなかったものだけをクラウドから直接読んだ（pullDirectly） */
  direct?: boolean
}

export interface Persistence {
  load(): Promise<AppData>
  /**
   * prev（このタブが最後に保存した内容）から next への差分を書き込む。
   * 保存先のレコードが prev と違っていたら（別タブ・別の端末が書き換えた）、同期と同じ規則で合わせる（hooks が無ければ、
   * このタブが変えた項目を重ねるだけ）。書いたレコードは送信待ちに積む。
   */
  save(prev: AppData, next: AppData, hooks?: ConflictHooks, opts?: SaveOptions): Promise<SaveOutcome>
  /**
   * 全データを置き換える（バックアップの読み込み・すべて削除）。変わったものは「必ず上書き」で送信待ちに積み、
   * 同期の時にクラウドもこの内容に揃える（この端末に無いクラウドのレコードも消す）。opts の物は残す（6.16）。
   * next に関数を渡すと、トランザクションの中で読んだ端末の今の記録から、置き換える内容と残す物を作る（復元。タブのメモリの内容が
   * 古くても、ほかの端末で直したばかりの MIM・受け取り箱を古い内容で上書きしないように）。置き換えた後の端末の記録を返す
   */
  replaceAll(next: ReplaceInput, opts?: ReplaceOptions): Promise<AppData>
  /**
   * クラウドの変更を反映する（送信待ちのレコードは3者マージ）。実際に書いた内容を返す。
   * バックアップからの復元・すべて削除をまだクラウドに当てていない間は何もせずに null を返す。
   */
  applyRemote(changes: Change[], opts: RemoteApplyOptions): Promise<Change[] | null>
  /** 送信待ち（最大 limit 件。まとまりは途中で切らない）と、いまの端末内の内容 */
  readOutbox(limit: number): Promise<OutboxItem[]>
  /** 送った内容を記録する。送った後に端末内で変わっていなければ送信待ちから外す */
  completeUpload(sent: Change[]): Promise<void>
  /**
   * 送るトランザクションで書く送信待ちに、書き込みを送る前に「返事を受け取るまで、クラウドが base のままか分からない」と印を付ける。
   * tx = そのトランザクションの id（クラウドの「送る書き込みの印」に書く値）、record = 送る内容
   */
  markUnconfirmed(rows: readonly SentRow[], tx: string): Promise<void>
  /** 印の付いた送信待ちのうち、keys の物のトランザクションの id */
  unconfirmedTx(keys: readonly string[]): Promise<Set<string>>
  /**
   * トランザクション tx の書き込みはクラウドに届いていた（クラウドの「送る書き込みの印」が tx だった）: tx の印の付いた送信待ちを、
   * 送った返事を受け取った時（completeUpload）と同じにする（送った内容が新しい base。その後に端末で変わっていなければ送り終わり）
   */
  confirmLanded(tx: string): Promise<void>
  outboxCount(): Promise<number>
  /** 送信待ちのある記録のキー（`${表名}/${id}`） */
  outboxKeys(): Promise<Set<string>>
  /** 端末内のすべてのレコードを「クラウドとの共通の履歴が無い」前提で送信待ちにする（初めてのログイン・アカウントの切り替え） */
  markAllDirty(): Promise<void>
  /** 端末内のレコードと送信待ちのキー（`${表名}/${id}`） */
  localKeys(): Promise<Set<string>>
  getMeta<T>(key: string): Promise<T | undefined>
  setMeta(key: string, value: unknown): Promise<void>
  /** 内容から作った id の削除の印を受け取った・書いた記録のキー（19.5 の previously_deleted） */
  goneKeys(): Promise<Set<string>>
  /** 月の束に入っている項目（id → 月。6.11） */
  packsOf(): Promise<Map<string, string>>
  /** 月の束に入っている項目を書き直す（month = null は束から出た） */
  setPacks(entries: Iterable<readonly [string, string | null]>): Promise<void>
  clearPacks(): Promise<void>
  /**
   * 全部を受け取り直した後に、クラウド（keys。束を広げた後の項目も含む）にも送信待ちにも無い端末の中の記録を消す（6.11 の 90日を超えた
   * 端末）。端末の中だけで消し、送信待ちに積まず、ゴミ箱にも入れない。消した変化を返す
   */
  dropMissing(keys: ReadonlySet<string>): Promise<Change[]>
  close(): void
}

/** 送るトランザクションで書く送信待ち（markUnconfirmed）。key = `${表名}/${id}`、record = 送る内容 */
export interface SentRow {
  key: string
  record: AnyRecord | null
}

/** 送信待ちの行を書き直す（g は残す。base を書き直す時は返事待ちの印（とその書き込みの id・送った内容）を外す。6.10・19.5） */
function rewriteRow(row: OutboxRow, patch: Partial<OutboxRow>): OutboxRow {
  const next: OutboxRow = { ...row, ...patch }
  if ('base' in patch && !('unconfirmed' in patch)) {
    delete next.unconfirmed
    delete next.tx
    delete next.sent
  }
  for (const f of ['noHistory', 'force', 'unconfirmed', 'tx', 'g'] as const) if (!next[f]) delete next[f]
  if (!next.tx) delete next.sent
  return next
}

export function createPersistence(dbName = DEFAULT_DB_NAME): Persistence {
  const db = new DiaryDB(dbName)
  const allTables = () => TABLE_NAMES.map((t) => db.tableOf(t))
  const sideTables = () => [db.outbox, db.meta, db.gone, db.packs]

  /** トランザクションの中で使う書き込みの道具 */
  function writer(at: number, written: Map<string, Change>) {
    const put = async (table: TableName, record: AnyRecord) => {
      await db.tableOf(table).put(record)
      written.set(outboxKey(table, record.id), { table, id: record.id, record })
    }
    const del = async (table: TableName, id: string) => {
      await db.tableOf(table).delete(id)
      written.set(outboxKey(table, id), { table, id, record: null })
    }
    /** この端末で作った・変えたレコードを送信待ちに積む（積まれていなければ、書く前の内容を base にする） */
    const enqueueLocal = async (table: TableName, id: string, before: AnyRecord | null) => {
      const k = outboxKey(table, id)
      if (!(await db.outbox.get(k))) await db.outbox.put({ k, t: table, id, base: before, at })
    }
    const putLocal = async (table: TableName, record: AnyRecord) => {
      const before = (await db.tableOf(table).get(record.id)) ?? null
      await put(table, record)
      await enqueueLocal(table, record.id, before)
    }
    const delLocal = async (table: TableName, id: string) => {
      const before = (await db.tableOf(table).get(id)) ?? null
      if (!before) return
      await del(table, id)
      await enqueueLocal(table, id, before)
      if (isGoneKind(table, id)) await db.gone.put({ k: outboxKey(table, id), at })
    }
    const keepInTrash = async (table: TableName, record: AnyRecord, hooks: ConflictHooks, id: string) => {
      const extras = hooks.trashCopy(table, record)
      for (const extra of extras) if (extra.record) await putLocal(extra.table, extra.record)
      if (extras.length) hooks.report?.({ kind: 'trash', table, id })
    }
    /** 競合の控え（ゴミ箱・つないだ文章の知らせ）を書く */
    const keepConflict = async (table: TableName, r: MergeResult, hooks: ConflictHooks, id: string) => {
      for (const kept of [r.deletedEdit, r.keptCopy, r.overwritten]) {
        if (!kept || !COPY_TABLES.has(table)) continue
        await keepInTrash(table, kept, hooks, id)
      }
      if (r.joined?.length) hooks.report?.({ kind: 'joined', table, id })
    }
    /**
     * 消えた親（ルーチン）の子（チェックの記録）を片付ける。別の端末で親が消された時に、この端末で作った・変えた子が
     * 誰にも見えないまま残らないように消す（チェックの記録は控えない。6.10）。
     */
    const sweepOrphans = async (parents: Map<TableName, Set<string>>, hooks: ConflictHooks) => {
      const pending = new Map(parents)
      let trash: AnyRecord[] | null = null
      const inTrash = async (table: TableName, rec: AnyRecord) => {
        trash ??= await db.tableOf('trashRecords').toArray()
        return trash.some((t) => {
          const tr = t as unknown as { table?: string; record?: AnyRecord }
          return tr.table === table && tr.record?.id === rec.id && contentEqual(tr.record, rec)
        })
      }
      while (pending.size) {
        const [parentTable, ids] = pending.entries().next().value as [TableName, Set<string>]
        pending.delete(parentTable)
        for (const { table, field } of CHILDREN[parentTable] ?? []) {
          const children = await db
            .tableOf(table)
            .filter((r) => ids.has((r as unknown as Record<string, string>)[field]))
            .toArray()
          for (const child of children) {
            if (COPY_TABLES.has(table) && !(await inTrash(table, child))) await keepInTrash(table, child, hooks, child.id)
            await delLocal(table, child.id)
            if (CHILDREN[table]) {
              const set = pending.get(table) ?? new Set<string>()
              set.add(child.id)
              pending.set(table, set)
            }
          }
        }
      }
    }
    return { put, del, enqueueLocal, putLocal, delLocal, keepConflict, keepInTrash, sweepOrphans }
  }

  /** すべての表の記録（トランザクションの中で呼ぶ） */
  async function readAll(): Promise<AppData> {
    const data = emptyData()
    for (const t of TABLE_NAMES) {
      const rows = await db.tableOf(t).toArray()
      const map: Record<string, AnyRecord> = {}
      for (const r of rows) map[r.id] = r
      ;(data as unknown as Record<TableName, Record<string, AnyRecord>>)[t] = map
    }
    return data
  }

  const noteDeleted = (parents: Map<TableName, Set<string>>, table: TableName, id: string) => {
    if (!CHILDREN[table]) return
    const set = parents.get(table) ?? new Set<string>()
    set.add(id)
    parents.set(table, set)
  }

  /** 送信待ちの行と、いまの端末内の内容（keys の順） */
  async function itemsOf(keys: readonly string[]): Promise<OutboxItem[]> {
    if (!keys.length) return []
    const rows = (await db.outbox.bulkGet([...keys])).filter((r): r is OutboxRow => Boolean(r) && KNOWN_TABLES.has(r!.t))
    const byTable = new Map<TableName, OutboxRow[]>()
    for (const r of rows) {
      const list = byTable.get(r.t) ?? []
      list.push(r)
      byTable.set(r.t, list)
    }
    const items = new Map<string, OutboxItem>()
    for (const [t, list] of byTable) {
      const locals = await db.tableOf(t).bulkGet(list.map((r) => r.id))
      list.forEach((r, i) =>
        items.set(r.k, {
          k: r.k,
          table: t,
          id: r.id,
          base: r.base,
          noHistory: Boolean(r.noHistory),
          force: Boolean(r.force),
          ...(r.unconfirmed ? { unconfirmed: true } : {}),
          ...(r.tx ? { tx: r.tx, sent: r.sent ?? null } : {}),
          local: locals[i] ?? null,
          ...(r.g ? { group: r.g } : {}),
        }),
      )
    }
    return keys.map((k) => items.get(k)).filter((x): x is OutboxItem => Boolean(x))
  }

  /**
   * 送信待ちの行に、受け取り箱の依頼ごとのまとまりを付ける（save のトランザクションの中）。同じ記録にもう別のまとまりが付いていたら、
   * そのまとまりの行をすべて新しいまとまりにつなぐ（2つの依頼が同じ記録を書いた時、片方だけが先に届かないように）
   */
  async function tagGroups(groups: ReadonlyMap<string, readonly string[]>): Promise<void> {
    for (const [g, keys] of groups) {
      const rows = (await db.outbox.bulkGet([...keys])).filter((r): r is OutboxRow => Boolean(r))
      const joined = new Set(rows.map((r) => r.g).filter((x): x is string => Boolean(x) && x !== g))
      const tagged = rows.map((r) => rewriteRow(r, { g }))
      if (tagged.length) await db.outbox.bulkPut(tagged)
      for (const other of joined) {
        const members = await db.outbox.where('g').equals(other).toArray()
        if (members.length) await db.outbox.bulkPut(members.map((r) => rewriteRow(r, { g })))
      }
    }
  }

  /**
   * 受け取り箱の依頼ごとのまとまり（19.5）の手がかり（applyRemote のトランザクションの中、反映する前に読む）。
   * 届いた変化の送信待ちに付いたまとまりごとに、この端末の受け取り箱の記録（この端末が当てた結果）と、クラウドの受け取り箱の記録
   */
  async function groupContext(changes: Change[]): Promise<GroupContext> {
    const known = changes.filter((ch) => KNOWN_TABLES.has(ch.table))
    const rows = await db.outbox.bulkGet(known.map((ch) => outboxKey(ch.table, ch.id)))
    const ids = [...new Set(rows.map((r) => r?.g).filter((g): g is string => Boolean(g)))]
    const own = new Map<string, InboxRecord>()
    const cloud = new Map<string, InboxRecord | null>()
    if (!ids.length) return { own, cloud }
    const disks = (await db.tableOf('inbox').bulkGet(ids)) as (InboxRecord | undefined)[]
    const queued = await db.outbox.bulkGet(ids.map((id) => outboxKey('inbox', id)))
    ids.forEach((id, i) => {
      if (disks[i]) own.set(id, disks[i]!)
      // 送信待ちがあれば base（最後に知ったクラウドの内容）、無ければ端末の中（= クラウドの内容）
      cloud.set(id, ((queued[i] ? queued[i]!.base : disks[i]) ?? null) as InboxRecord | null)
    })
    for (const ch of known) if (ch.table === 'inbox' && cloud.has(ch.id)) cloud.set(ch.id, ch.record as InboxRecord | null)
    return { own, cloud }
  }

  /**
   * この端末が依頼を当てて書いたまま、まだ送っていない記録か（当てる前が base、当てた後が disk のまま。当てた後に手で直していない）。
   * 依頼の undo の指紋（形2）で確かめる
   */
  function onlyRequestEffect(rec: InboxRecord | undefined, ch: Change, base: AnyRecord | null, disk: AnyRecord | null): boolean {
    if (!rec || rec.table !== ch.table || rec.targetId !== ch.id || !disk) return false
    const u = rec.undo as { created?: unknown; beforeHash?: unknown; afterHash?: unknown } | null
    if (!u || typeof u.afterHash !== 'string' || revOf(disk) !== u.afterHash) return false
    if (u.created === true) return base === null
    return typeof u.beforeHash === 'string' && revOf(base) === u.beforeHash
  }

  /**
   * クラウドでは、その依頼がもう当たっている（この端末のまとまりはまだ送っていないので、ほかの端末が当てた・承認した）。
   * 断った・競合にした結果は、当てた結果より弱い（6.10）ので、この端末の当てた結果をふつうに合わせて送る
   */
  const appliedInCloud = (ctx: GroupContext, g: string) => {
    const s = ctx.cloud.get(g)?.status
    return s === 'applied' || s === 'accepted'
  }

  /** クラウドの変更を反映する（applyRemote のトランザクションの中）: 1件ずつ3者マージし、消えた親の子を片付ける */
  async function applyRemoteTx(changes: Change[], opts: RemoteApplyOptions, at: number, written: Map<string, Change>) {
    const w = writer(at, written)
    const parents = new Map<TableName, Set<string>>()
    const gone: GoneRow[] = []
    const packs: PackRow[] = []
    const unpacked: string[] = []
    const groups = await groupContext(changes)
    for (const ch of changes) {
      if (!KNOWN_TABLES.has(ch.table)) continue
      const k = outboxKey(ch.table, ch.id)
      // 内容から作った id の削除の印を控える（19.5）。月の束の項目か、個別の文書で届いたか（6.11）
      if (!ch.record && isGoneKind(ch.table, ch.id)) gone.push({ k, at })
      if (ch.table === 'items') {
        if (ch.pack) packs.push({ id: ch.id, month: ch.pack })
        else unpacked.push(ch.id)
      }
      const disk = (await db.tableOf(ch.table).get(ch.id)) ?? null
      const queued = await db.outbox.get(k)
      // バックアップからの復元・すべて削除の後: この端末の内容で上書きするまで、クラウド側は採らない。
      // ただし復元を始めた後にほかの端末が書いたもの（afterRestore）は、ふつうに 3者マージする
      if (queued?.force && !ch.afterRestore) {
        await db.outbox.put(rewriteRow(queued, { base: ch.record, unconfirmed: queued.unconfirmed }))
        continue
      }
      // この端末が書いたもの（返事を受け取れなかった書き込み）: 端末内の内容はそれより新しいので、base だけ進める
      if (ch.own && queued) {
        if (deepEqual(disk, ch.record)) await db.outbox.delete(k)
        else await db.outbox.put(rewriteRow(queued, { base: ch.record, noHistory: undefined, force: undefined }))
        continue
      }
      // ほかの端末の復元・すべて削除: その内容を正とする。この端末で書いたまま送っていない内容だけ控える
      if (ch.reset) {
        if (queued && disk && !deepEqual(disk, queued.base) && COPY_TABLES.has(ch.table) && !contentEqual(disk, ch.record))
          await w.keepInTrash(ch.table, disk, opts, ch.id)
        if (queued) await db.outbox.delete(k)
        if (ch.record) {
          if (!deepEqual(disk, ch.record)) await w.put(ch.table, ch.record)
        } else if (disk) {
          await w.del(ch.table, ch.id)
          noteDeleted(parents, ch.table, ch.id)
        }
        continue
      }
      if (!queued) {
        if (deepEqual(disk, ch.record)) continue
        if (ch.record) await w.put(ch.table, ch.record)
        else if (disk) {
          await w.del(ch.table, ch.id)
          noteDeleted(parents, ch.table, ch.id)
        }
        continue
      }
      // 受け取り箱の依頼で書いて、まだ送っていない記録（2台で当てても1回分・19.5 の previously_deleted）
      if (queued.g && ch.table !== 'inbox' && !queued.noHistory) {
        const g = queued.g
        const ownRec = groups.own.get(g)
        // ほかの端末が同じ依頼をもう当てていた: この端末の当てた結果は捨て、クラウドの内容を採る。
        // その後にほかの端末で手で直した内容・消した内容が、遅れて当てたこの端末の内容に負けないように
        if (appliedInCloud(groups, g) && onlyRequestEffect(ownRec, ch, queued.base, disk)) {
          if (ch.record) {
            if (!deepEqual(disk, ch.record)) await w.put(ch.table, ch.record)
          } else if (disk) {
            await w.del(ch.table, ch.id)
            noteDeleted(parents, ch.table, ch.id)
          }
          await db.outbox.delete(k)
          continue
        }
        if (queued.base === null && isGoneKind(ch.table, ch.id)) {
          // 内容から作った id の記録を、依頼で作ってまだ送っていない間に、ほかの端末が消していた: 削除を採る（生き返らせない。
          // 削除の印と base の '' が同じ指紋なので、そのままだと送り直した時に書き戻してしまう）。当てた後にこの端末で直した内容は
          // ゴミ箱に控える。ただし、この端末が前に削除の印を知った後で戻した記録（ゴミ箱から戻す・元に戻す）は、ふつうに合わせる
          if (!ch.record && disk && !(await db.gone.get(k))) {
            await w.del(ch.table, ch.id)
            noteDeleted(parents, ch.table, ch.id)
            await db.outbox.delete(k)
            if (!onlyRequestEffect(ownRec, ch, queued.base, disk))
              await w.keepConflict(ch.table, { record: null, deletedEdit: disk }, opts, ch.id)
            continue
          }
          // この端末で、依頼で作った記録を送る前に消していた（ゴミ箱へ・元に戻す）: ほかの端末が同じ依頼で作った記録も、削除の印で
          // 消す（base をクラウドの内容にして、削除を送る）。ほかの端末で当てた後に直していた内容はゴミ箱に控える
          if (ch.record && !disk) {
            await db.outbox.put(rewriteRow(queued, { base: ch.record, noHistory: undefined, force: undefined }))
            const cloudRec = groups.cloud.get(g)
            const fresh = [ownRec, cloudRec ?? undefined].some((r) => {
              const u = r && r.table === ch.table && r.targetId === ch.id ? (r.undo as { afterHash?: unknown } | null) : null
              return typeof u?.afterHash === 'string' && u.afterHash === revOf(ch.record)
            })
            if (!fresh) await w.keepConflict(ch.table, { record: null, deletedEdit: ch.record }, opts, ch.id)
            continue
          }
        }
      }
      const result = mergeRemote(ch.table, queued.base, disk, ch.record, { device: opts.device, noHistory: queued.noHistory })
      // クラウドと同じ内容になったら、クラウドの内容そのものを使う（更新日時まで揃える）
      if (contentEqual(result.record, ch.record)) result.record = ch.record
      if (!deepEqual(result.record, disk)) {
        if (result.record) await w.put(ch.table, result.record)
        else if (disk) {
          await w.del(ch.table, ch.id)
          noteDeleted(parents, ch.table, ch.id)
        }
      }
      // クラウドの内容が新しい base。合わせた結果がクラウドと同じなら送るものは無い
      if (deepEqual(result.record, ch.record)) await db.outbox.delete(k)
      else await db.outbox.put(rewriteRow(queued, { base: ch.record, noHistory: undefined, force: undefined }))
      await w.keepConflict(ch.table, result, opts, ch.id)
    }
    // 消えた親の子を片付ける
    if (parents.size) await w.sweepOrphans(parents, opts)
    if (gone.length) await db.gone.bulkPut(gone)
    if (unpacked.length) await db.packs.bulkDelete(unpacked)
    if (packs.length) await db.packs.bulkPut(packs)
  }

  /**
   * 送った内容を記録する（completeUpload・confirmLanded）。送った後にこの端末で変わっていなければ送り終わり。変わっていれば、送った内容を
   * 新しい base にして残す。onlyTx = その id のトランザクションの印の付いた行だけ（トランザクションの中で読み直して確かめる）
   */
  async function completeSent(sent: readonly Change[], onlyTx?: string): Promise<void> {
    if (!sent.length) return
    const tables = [...new Set(sent.map((s) => s.table))].filter((t) => KNOWN_TABLES.has(t))
    await db.transaction('rw', [...tables.map((t) => db.tableOf(t)), db.outbox, db.gone], async () => {
      for (const s of sent) {
        if (!KNOWN_TABLES.has(s.table)) continue
        const k = outboxKey(s.table, s.id)
        const row = await db.outbox.get(k)
        if (onlyTx !== undefined && row?.tx !== onlyTx) continue
        if (!s.record && isGoneKind(s.table, s.id)) await db.gone.put({ k, at: Date.now() })
        if (!row) continue
        const disk = (await db.tableOf(s.table).get(s.id)) ?? null
        if (deepEqual(disk, s.record)) await db.outbox.delete(k)
        else await db.outbox.put(rewriteRow(row, { base: s.record, noHistory: undefined, force: undefined }))
      }
    })
  }

  return {
    load() {
      return db.transaction('r', allTables(), readAll)
    },

    async save(prev, next, hooks, opts) {
      const work: { table: TableName; puts: AnyRecord[]; dels: string[] }[] = []
      for (const t of TABLE_NAMES) {
        const a = prev[t] as Record<string, AnyRecord>
        const b = next[t] as Record<string, AnyRecord>
        if (a === b) continue
        const puts: AnyRecord[] = []
        const dels: string[] = []
        for (const id in b) if (a[id] !== b[id]) puts.push(b[id])
        for (const id in a) if (!(id in b)) dels.push(id)
        if (puts.length || dels.length) work.push({ table: t, puts, dels })
      }
      const outcome: SaveOutcome = { merged: {}, dropped: {}, written: [], extra: [] }
      if (work.length === 0) return outcome
      const at = Date.now()
      const extraWritten = new Map<string, Change>()
      const w = writer(at, extraWritten)
      const parents = new Map<TableName, Set<string>>()
      // 競合の控えは別の表（ゴミ箱）にも書くので、控えを作れる時はすべての表を開く
      const scope = hooks ? [...allTables(), db.outbox, db.gone] : [...work.map((x) => db.tableOf(x.table)), db.outbox, db.gone]
      await db.transaction('rw', scope, async () => {
        for (const job of work) {
          const table = db.tableOf(job.table)
          const base = prev[job.table] as Record<string, AnyRecord>
          const ids = [...job.puts.map((r) => r.id), ...job.dels]
          const onDisk = await table.bulkGet(ids)
          const queued = await db.outbox.bulkGet(ids.map((id) => outboxKey(job.table, id)))
          const toWrite: AnyRecord[] = []
          const toDelete: string[] = []
          const enqueue: OutboxRow[] = []
          const goneRows: GoneRow[] = []
          const track = (i: number, id: string, disk: AnyRecord | undefined) => {
            if (!queued[i]) enqueue.push({ k: outboxKey(job.table, id), t: job.table, id, base: disk ?? null, at })
          }
          const afterWrite: (() => Promise<void>)[] = []
          for (let i = 0; i < job.puts.length; i++) {
            const mine = job.puts[i]
            const before = base[mine.id]
            const disk = onDisk[i]
            if (before && !disk) {
              // 別タブ・別の端末で削除されていた: 復活させない。このタブで書き換えた内容はゴミ箱に控える
              ;(outcome.dropped[job.table] ??= []).push(mine.id)
              if (hooks && COPY_TABLES.has(job.table) && !contentEqual(mine, before)) {
                const h = hooks
                afterWrite.push(() => w.keepInTrash(job.table, mine, h, mine.id))
              }
              noteDeleted(parents, job.table, mine.id)
              continue
            }
            let record = mine
            if (!before && disk && !deepEqual(disk, mine)) {
              // このタブが新しく作ったつもりの記録が、保存先にもうあった（id の決まった表で、ほかのタブ・ほかの端末が先に作った。
              // 例: 同じルーチンのその月のチェックの記録）。丸ごと置き換えずに、共通の元が無い3者マージで合わせる（並びは和にする）
              const r = mergeRemote(job.table, null, mine, disk, { device: hooks?.device ?? 'この端末' })
              record = r.record ?? mine
              if (hooks) {
                const h = hooks
                afterWrite.push(() => w.keepConflict(job.table, r, h, mine.id))
              }
              ;(outcome.merged[job.table] ??= []).push(record)
            } else if (before && disk && !deepEqual(disk, before)) {
              // 保存先が prev と違う: 同期と同じ規則で、このタブが変えた項目を重ねる
              if (hooks) {
                const r = mergeRemote(job.table, before, mine, disk, { device: hooks.device })
                record = r.record ?? mine
                const h = hooks
                afterWrite.push(() => w.keepConflict(job.table, r, h, mine.id))
              } else {
                record = mergeRecordLegacy(before, mine, disk, job.table)
              }
              ;(outcome.merged[job.table] ??= []).push(record)
            }
            toWrite.push(record)
            outcome.written.push({ table: job.table, id: record.id, record })
            track(i, mine.id, disk)
          }
          job.dels.forEach((id, j) => {
            const i = job.puts.length + j
            const disk = onDisk[i]
            if (!disk) return
            const before = base[id]
            // 削除する前に別タブ・別の端末で書き換えられていた内容はゴミ箱に控える
            if (hooks && before && COPY_TABLES.has(job.table) && !contentEqual(disk, before)) {
              const h = hooks
              afterWrite.push(() => w.keepInTrash(job.table, disk, h, id))
            }
            toDelete.push(id)
            outcome.written.push({ table: job.table, id, record: null })
            track(i, id, disk)
            // 内容から作った id の記録を消した: クラウドにまだ無くても削除の印を送り、控える（19.5）
            if (isGoneKind(job.table, id)) goneRows.push({ k: outboxKey(job.table, id), at })
          })
          if (toWrite.length) await table.bulkPut(toWrite)
          if (toDelete.length) await table.bulkDelete(toDelete)
          if (enqueue.length) await db.outbox.bulkPut(enqueue)
          if (goneRows.length) await db.gone.bulkPut(goneRows)
          for (const fn of afterWrite) await fn()
        }
        if (hooks) {
          // 別の端末で消された親の下に、このタブが新しく作ったもの（古い表示のまま作った）は片付ける
          for (const job of work) {
            for (const parent of PARENT_OF[job.table] ?? []) {
              for (const rec of job.puts) {
                if (prev[job.table][rec.id as never]) continue
                const parentId = (rec as unknown as Record<string, string>)[parent.field]
                if (!parentId || (await db.tableOf(parent.table).get(parentId))) continue
                const set = parents.get(parent.table) ?? new Set<string>()
                set.add(parentId)
                parents.set(parent.table, set)
              }
            }
          }
          if (parents.size) await w.sweepOrphans(parents, hooks)
        }
        if (opts?.groups?.size) await tagGroups(opts.groups)
      })
      if (extraWritten.size) {
        outcome.extra = [...extraWritten.values()]
        outcome.written.push(...outcome.extra)
      }
      return outcome
    },

    async replaceAll(input, given = {}) {
      const at = Date.now()
      let result = emptyData()
      await db.transaction('rw', [...allTables(), db.outbox, db.meta], async () => {
        // 同期したことのある端末だけ、クラウドもこの内容に揃える（まだ同期したことの無い端末で復元してから
        // 初めてログインした時は、ほかの端末の内容と突き合わせるだけにする）
        const synced = Boolean((await db.meta.get('uid'))?.value)
        // 端末の今の記録（このトランザクションの中で読む。タブのメモリの内容は、ほかのタブ・同期が書いた後の物より古いことがある）
        const disk = await readAll()
        const made = typeof input === 'function' ? input(disk) : { data: input }
        const next: AppData = { ...emptyData(), ...made.data }
        const opts: ReplaceOptions = { ...given, ...(made.opts ?? {}) }
        const keepTables = new Set<TableName>(['inbox', ...(opts.tables ?? [])])
        const keepKeys = new Set(opts.keys ?? [])
        // MIM を含まないファイル: ゴミ箱の中の MIM は、端末の今の物（と、渡された内容の中の物）をどれも残す（形4）
        if (opts.keepMimTrash) {
          for (const d of [disk, next]) {
            const mim = mimTrashIds(d)
            for (const id of mim.entries) keepKeys.add(outboxKey('trashEntries', id))
            for (const id of mim.records) keepKeys.add(outboxKey('trashRecords', id))
          }
        }
        for (const t of TABLE_NAMES) {
          const table = db.tableOf(t)
          const old = disk[t] as Record<string, AnyRecord>
          const target = next[t] as Record<string, AnyRecord>
          const enqueue: OutboxRow[] = []
          const puts: AnyRecord[] = []
          const dels: string[] = []
          if (keepTables.has(t)) {
            // 残す表（受け取り箱・MIM を含まないファイルの時の MIM）: 端末の記録には触れない（消さない・送信待ちにも積まない）。
            // 受け取り箱だけは、ファイルの記録を強さの決まりで合わせ（今の方を優先）、ファイルにしか無い物を足す。変わった物は
            // ふつうの送信待ちにする（6.16・形4）
            if (t === 'inbox') {
              const ids = Object.keys(target)
              const queued = await db.outbox.bulkGet(ids.map((id) => outboxKey(t, id)))
              ids.forEach((id, i) => {
                const cur = old[id] as unknown as InboxRecord | undefined
                const merged = restoredInboxRecord(cur, target[id] as unknown as InboxRecord) as unknown as AnyRecord
                if (deepEqual(cur ?? null, merged)) return
                puts.push(merged)
                if (!queued[i]) enqueue.push({ k: outboxKey(t, id), t, id, base: (cur as AnyRecord | undefined) ?? null, at })
              })
            }
          } else {
            const ids = [...new Set([...Object.keys(old), ...Object.keys(target)])].filter(
              (id) => !keepKeys.has(outboxKey(t, id)),
            )
            const queued = await db.outbox.bulkGet(ids.map((id) => outboxKey(t, id)))
            ids.forEach((id, i) => {
              const k = outboxKey(t, id)
              const q = queued[i]
              if (target[id]) {
                if (!deepEqual(old[id] ?? null, target[id])) puts.push(target[id])
              } else if (old[id]) dels.push(id)
              const row: OutboxRow = { k, t, id, base: q?.base ?? old[id] ?? null, at }
              if (synced) row.force = true
              else if (q?.noHistory) row.noHistory = true
              enqueue.push(row)
            })
          }
          if (dels.length) await table.bulkDelete(dels)
          if (puts.length) await table.bulkPut(puts)
          if (enqueue.length) await db.outbox.bulkPut(enqueue)
        }
        // 同期の時に、この端末に無いクラウドのレコードも消す（残す物は authoritativeKeep に覚える）
        if (synced) {
          await db.meta.put({ key: 'authoritative', value: at })
          const keep: AuthoritativeKeep = {
            tables: [...keepTables],
            keys: [...keepKeys],
            mimTrash: Boolean(opts.keepMimTrash),
          }
          await db.meta.put({ key: 'authoritativeKeep', value: keep })
        }
        // 復元ごとに、どこまでのクラウドの内容に当てるか（始めた時のサーバーの時刻）を決め直す
        await db.meta.delete('authoritativeFrom')
        result = await readAll()
      })
      return result
    },

    async applyRemote(changes, opts) {
      const written = new Map<string, Change>()
      const at = Date.now()
      let deferred = false
      await db.transaction('rw', [...allTables(), ...sideTables()], async () => {
        if ((await db.meta.get('authoritative'))?.value) {
          deferred = true
          return
        }
        await applyRemoteTx(changes, opts, at, written)
        if (opts.cursor !== undefined) await db.meta.put({ key: 'cursor', value: opts.cursor })
      })
      return deferred ? null : [...written.values()]
    },

    readOutbox(limit) {
      // 送信待ちの一覧・行・端末内の内容を1つの読み取りトランザクションで読む（読んでいる途中に保存が入って、まとまりが
      // 当てる前と後の混ざった内容にならないように）
      return db.transaction('r', [db.outbox, ...allTables()], async () => {
        const keys = (await db.outbox.toCollection().primaryKeys()).map(String)
        keys.sort((a, b) => sendRank(a) - sendRank(b) || (a < b ? -1 : a > b ? 1 : 0))
        // 受け取り箱の依頼ごとのまとまり（g の付いた行だけ。索引で読む）
        const grouped = await db.outbox.orderBy('g').toArray()
        if (!grouped.length) return itemsOf(keys.slice(0, limit))
        const groupOf = new Map<string, string>()
        for (const r of grouped) if (r.g) groupOf.set(r.k, r.g)
        const members = new Map<string, string[]>()
        for (const k of keys) {
          const g = groupOf.get(k)
          if (!g) continue
          const list = members.get(g) ?? []
          list.push(k)
          members.set(g, list)
        }
        // まとまりは続けて並べる（中の順は送る順。受け取り箱がいちばん後）。上限に達しても、並べ始めたまとまりは最後まで入れる
        const order: string[] = []
        const done = new Set<string>()
        for (const k of keys) {
          if (order.length >= limit) break
          if (done.has(k)) continue
          const g = groupOf.get(k)
          for (const m of g ? members.get(g)! : [k]) {
            order.push(m)
            done.add(m)
          }
        }
        return itemsOf(order)
      })
    },

    completeUpload(sent) {
      return completeSent(sent)
    },

    async markUnconfirmed(sent, tx) {
      if (!sent.length) return
      await db.transaction('rw', db.outbox, async () => {
        const rows = await db.outbox.bulkGet(sent.map((s) => s.key))
        const marked: OutboxRow[] = []
        rows.forEach((r, i) => {
          if (r) marked.push(rewriteRow(r, { unconfirmed: true, tx, sent: sent[i].record }))
        })
        if (marked.length) await db.outbox.bulkPut(marked)
      })
    },

    async unconfirmedTx(keys) {
      const out = new Set<string>()
      if (!keys.length) return out
      for (const r of await db.outbox.bulkGet([...keys])) if (r?.unconfirmed && r.tx) out.add(r.tx)
      return out
    },

    async confirmLanded(tx) {
      const rows = await db.outbox.filter((r) => r.tx === tx).toArray()
      const sent = rows
        .filter((r) => KNOWN_TABLES.has(r.t))
        .map((r): Change => ({ table: r.t, id: r.id, record: r.sent ?? null }))
      if (sent.length) await completeSent(sent, tx)
    },

    outboxCount() {
      return db.outbox.count()
    },

    async outboxKeys() {
      return new Set((await db.outbox.toCollection().primaryKeys()).map(String))
    },

    async markAllDirty() {
      const at = Date.now()
      await db.transaction('rw', [...allTables(), db.outbox, db.meta, db.packs], async () => {
        // 共通の履歴が無いので、以前の「クラウドもこの内容に揃える」はやめて、突き合わせるだけにする
        await db.meta.delete('authoritative')
        await db.meta.delete('authoritativeFrom')
        await db.meta.delete('authoritativeKeep')
        // 前のアカウントのクラウドの月の束は、このアカウントのものではない
        await db.packs.clear()
        // （別のアカウントのクラウドに送った、返事の無い書き込みの印も外す。まとまりは残す）
        await db.outbox.toCollection().modify((r) => {
          r.base = null
          r.noHistory = true
          r.force = false
          delete r.unconfirmed
          delete r.tx
          delete r.sent
        })
        for (const t of TABLE_NAMES) {
          const ids = await db.tableOf(t).toCollection().primaryKeys()
          const keys = ids.map((key) => outboxKey(t, String(key)))
          const existing = await db.outbox.bulkGet(keys)
          const rows: OutboxRow[] = ids.map((key, i) => ({
            ...(existing[i] ?? {}),
            k: keys[i],
            t,
            id: String(key),
            base: null,
            noHistory: true,
            at: existing[i]?.at ?? at,
          }))
          if (rows.length) await db.outbox.bulkPut(rows.map((r) => rewriteRow(r, { force: undefined })))
        }
      })
    },

    async localKeys() {
      const keys = new Set<string>()
      await db.transaction('r', [...allTables(), db.outbox], async () => {
        for (const t of TABLE_NAMES) {
          for (const id of await db.tableOf(t).toCollection().primaryKeys()) keys.add(outboxKey(t, String(id)))
        }
        for (const k of await db.outbox.toCollection().primaryKeys()) keys.add(String(k))
      })
      return keys
    },

    async getMeta<T>(key: string) {
      return (await db.meta.get(key))?.value as T | undefined
    },

    async setMeta(key, value) {
      await db.meta.put({ key, value })
    },

    async goneKeys() {
      return new Set((await db.gone.toCollection().primaryKeys()).map(String))
    },

    async packsOf() {
      return new Map((await db.packs.toArray()).map((r) => [r.id, r.month]))
    },

    async setPacks(entries) {
      const puts: PackRow[] = []
      const dels: string[] = []
      for (const [id, month] of entries) {
        if (month) puts.push({ id, month })
        else dels.push(id)
      }
      await db.transaction('rw', db.packs, async () => {
        if (dels.length) await db.packs.bulkDelete(dels)
        if (puts.length) await db.packs.bulkPut(puts)
      })
    },

    async clearPacks() {
      await db.packs.clear()
    },

    async dropMissing(keys) {
      const dropped: Change[] = []
      await db.transaction('rw', [...allTables(), db.outbox, db.packs], async () => {
        const queued = new Set((await db.outbox.toCollection().primaryKeys()).map(String))
        for (const t of TABLE_NAMES) {
          const ids = (await db.tableOf(t).toCollection().primaryKeys()).map(String)
          const doomed = ids.filter((id) => {
            const k = outboxKey(t, id)
            return !keys.has(k) && !queued.has(k)
          })
          if (!doomed.length) continue
          await db.tableOf(t).bulkDelete(doomed)
          if (t === 'items') await db.packs.bulkDelete(doomed)
          for (const id of doomed) dropped.push({ table: t, id, record: null })
        }
      })
      return dropped
    },

    close() {
      db.close()
    },
  }
}
