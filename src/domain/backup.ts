// JSON バックアップの書き出し・読み込み（docs/SPEC.md の 6.16・18.3）。データは端末の中にあるので、機種変更や保全のために用意する。
// NS の src/domain/backup.ts（JSON の確かめ・表ごとの確かめ）を写し、ファイルの形を 6.16 にした。受け取り箱も入れる。
// 「MIM を含めない」時は、mimNotes に加えて、ゴミ箱の中の MIM のメモと、MIM の同期の競合で残した内容（中身の表が mimNotes の件）も
// 外す。そのファイルを読み込んだ時は、今の MIM とゴミ箱の中の MIM に一切触れない（形4）。
import { todayYmd, toYmd } from './dates'
import { strongerInboxOutcome } from './inbox'
import { repairData } from './repair'
import { DomainError, TABLE_NAMES, emptyData, type AppData, type ID, type InboxRecord, type TableName } from './types'

export const BACKUP_FORMAT = 'diary-studio-backup'
/** バックアップの形の版。これ以下の版は読み込める（無い表は空として読む）。これより新しい版は読み込まない */
export const BACKUP_VERSION = 1

export interface BackupFile {
  format: typeof BACKUP_FORMAT
  version: number
  /** 書き出した日時（ISO 8601） */
  exportedAt: string
  /** 書き出したアプリの版（'0.1'） */
  appVersion: string
  /** MIM を含めたか（false の時は tables に mimNotes が無く、ゴミ箱の MIM も無い） */
  includesMim: boolean
  tables: Partial<AppData>
}

export interface BackupOptions {
  includesMim: boolean
  appVersion: string
  exportedAt?: Date
}

/** ファイル名（diary-studio-backup-2026-11-10.json。端末の暦の日付。D15） */
export function backupFileName(at: Date = new Date()): string {
  return `diary-studio-backup-${toYmd(todayYmd(at))}.json`
}

/**
 * ゴミ箱の中の MIM（MIM のメモの件と、中身に mimNotes の記録がある件（同期の競合で残した内容）と、件の無い MIM の中身）の id
 */
export function mimTrashIds(data: Pick<AppData, 'trashEntries' | 'trashRecords'>): { entries: Set<ID>; records: Set<ID> } {
  const entries = new Set<ID>()
  for (const e of Object.values(data.trashEntries)) if (e.kind === 'mimNote') entries.add(e.id)
  for (const r of Object.values(data.trashRecords)) if (r.table === 'mimNotes') entries.add(r.entryId)
  const records = new Set<ID>()
  for (const r of Object.values(data.trashRecords)) if (r.table === 'mimNotes' || entries.has(r.entryId)) records.add(r.id)
  for (const id of entries) if (!data.trashEntries[id]) entries.delete(id)
  return { entries, records }
}

/** MIM を外したゴミ箱（mimTrashIds の件と中身を除く） */
function withoutMimTrash(data: AppData): Pick<AppData, 'trashEntries' | 'trashRecords'> {
  const mim = mimTrashIds(data)
  const trashEntries: AppData['trashEntries'] = {}
  for (const [id, e] of Object.entries(data.trashEntries)) if (!mim.entries.has(id)) trashEntries[id] = e
  const trashRecords: AppData['trashRecords'] = {}
  for (const [id, r] of Object.entries(data.trashRecords)) if (!mim.records.has(id)) trashRecords[id] = r
  return { trashEntries, trashRecords }
}

/** 書き出すファイルの中身（data は端末の raw のデータ。渡した data は書き換えない） */
export function toBackup(data: AppData, opts: BackupOptions): BackupFile {
  const tables: Partial<AppData> = {}
  const trash = opts.includesMim ? data : withoutMimTrash(data)
  for (const table of TABLE_NAMES) {
    if (table === 'mimNotes' && !opts.includesMim) continue
    ;(tables as Record<string, unknown>)[table] =
      table === 'trashEntries' ? trash.trashEntries : table === 'trashRecords' ? trash.trashRecords : data[table]
  }
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: (opts.exportedAt ?? new Date()).toISOString(),
    appVersion: opts.appVersion,
    includesMim: opts.includesMim,
    tables,
  }
}

/** 書き出す JSON の文字列 */
export function backupJson(data: AppData, opts: BackupOptions): string {
  return JSON.stringify(toBackup(data, opts))
}

export interface ParsedBackup {
  /** ファイルの記録（raw のまま。表示する時は repairData を通す。MIM を含まないファイルでは mimNotes とゴミ箱の MIM は空） */
  data: AppData
  includesMim: boolean
  exportedAt: string
  appVersion: string
}

/** ファイルを確かめて読む（ほかのアプリ・新しい版・壊れた記録・id の合わない記録は断る） */
export function parseBackup(json: string): ParsedBackup {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new DomainError('JSON として読み込めませんでした')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new DomainError('バックアップファイルの形式が正しくありません')
  const file = parsed as Partial<BackupFile>
  if (file.format !== BACKUP_FORMAT) throw new DomainError('Diary Studio のバックアップファイルではありません')
  if (typeof file.version !== 'number' || !Number.isInteger(file.version) || file.version < 1 || file.version > BACKUP_VERSION) {
    throw new DomainError('このバージョンのアプリでは読み込めないバックアップです')
  }
  if (typeof file.includesMim !== 'boolean' || !file.tables || typeof file.tables !== 'object' || Array.isArray(file.tables)) {
    throw new DomainError('バックアップファイルの形式が正しくありません')
  }
  const src = file.tables as Partial<Record<TableName, unknown>>
  const data = emptyData()
  for (const table of TABLE_NAMES) {
    if (table === 'mimNotes' && !file.includesMim) continue
    const records = src[table]
    if (records === undefined) continue
    if (!records || typeof records !== 'object' || Array.isArray(records))
      throw new DomainError(`バックアップの ${table} が壊れています`)
    for (const [id, rec] of Object.entries(records as Record<string, unknown>)) {
      if (!rec || typeof rec !== 'object' || (rec as { id?: unknown }).id !== id) {
        throw new DomainError(`バックアップの ${table} に壊れた記録があります`)
      }
    }
    ;(data as unknown as Record<string, unknown>)[table] = records
  }
  const out = file.includesMim ? data : { ...data, ...withoutMimTrash(data) }
  // 表示用に直せることを確かめる（直した内容は使わない。端末には raw のまま入れ、表示の時に直す。形3）
  repairData(out)
  return {
    data: out,
    includesMim: file.includesMim,
    exportedAt: typeof file.exportedAt === 'string' ? file.exportedAt : '',
    appVersion: typeof file.appVersion === 'string' ? file.appVersion : '',
  }
}

/** 復元で、今の端末とクラウドの記録のまま残し、「必ず上書き」で送らない物 */
export interface RestoreKeep {
  /** MIM のメモ（MIM を含まないファイルの時） */
  mimNotes: boolean
  /** ゴミ箱の中の MIM（MIM を含まないファイルの時） */
  trashEntryIds: ID[]
  trashRecordIds: ID[]
}

/**
 * 復元した後の端末のデータ（6.16）。ふつうはファイルの中身で置き換える。
 * - MIM を含まないファイル: 今の MIM のメモとゴミ箱の中の MIM はそのまま残す（形4。keep に返すので、送る時も「必ず上書き」にせず、
 *   クラウドの「この端末に無い記録を消す」からも外す）
 * - 受け取り箱: ファイルと今の両方にある依頼・提案は、結果の強い方（6.10。今の方を優先）を残し、今にだけある物も残す（古いバックアップで、
 *   当てた依頼が「待っています」に戻り、消した Claude の予定がまた足されないように）
 */
export function restoreData(current: AppData, parsed: ParsedBackup): { data: AppData; keep: RestoreKeep } {
  const data: AppData = { ...parsed.data }
  let keep: RestoreKeep = { mimNotes: false, trashEntryIds: [], trashRecordIds: [] }
  if (!parsed.includesMim) {
    const mim = mimTrashIds(current)
    data.mimNotes = { ...current.mimNotes }
    data.trashEntries = { ...data.trashEntries }
    data.trashRecords = { ...data.trashRecords }
    for (const id of mim.entries) data.trashEntries[id] = current.trashEntries[id]
    for (const id of mim.records) data.trashRecords[id] = current.trashRecords[id]
    keep = { mimNotes: true, trashEntryIds: [...mim.entries], trashRecordIds: [...mim.records] }
  }
  const inbox: Record<ID, InboxRecord> = { ...current.inbox }
  for (const [id, rec] of Object.entries(parsed.data.inbox)) inbox[id] = restoredInboxRecord(current.inbox[id], rec)
  data.inbox = inbox
  return { data, keep }
}

/**
 * 復元で、受け取り箱の1件を合わせる（6.16）: 今の端末にあれば、結果の強い方（6.10。同じ強さなら今の方）を採り、元に戻した日時は
 * 入っている方。今に無ければファイルの物（src/db/persistence.ts の replaceAll も、トランザクションの中で読んだ端末の記録と合わせ直す）
 */
export function restoredInboxRecord(cur: InboxRecord | undefined, file: InboxRecord): InboxRecord {
  if (!cur) return file
  const win = strongerInboxOutcome(cur, file)
  const other = win === cur ? file : cur
  return win.undoneAt == null && other.undoneAt != null ? { ...win, undoneAt: other.undoneAt } : win
}
