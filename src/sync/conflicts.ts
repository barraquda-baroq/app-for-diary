// 同期の競合で、どちらの内容も消さないための控えを作る（docs/SPEC.md の 2.4・6.10・6.15）。
// - 片方で削除・片方で編集されていた → 削除を優先し、編集された内容をゴミ箱に残す（reason: 'conflict'。種類・場所は元の物。
//   戻し方は src/domain/trash.ts。同じ id が残っていれば新しい id の複製として戻る）
// - MIM の欄の中身が両方で変わっていた → この端末の中身を採り、相手（クラウド）のメモの記録をまるごとゴミ箱に残す
// NS の src/sync/conflicts.ts の deviceLabel・conflictTrash・trashChanges・createConflictHooks を写し、稿・幕の部分を外した。
import type { AnyRecord, Change, ConflictHooks, ConflictNote } from '../db/persistence'
import { describeForTrash } from '../domain/trash'
import { CONTENT_TABLES, type AppData, type ContentTableName, type ID, type TrashEntry, type TrashRecord } from '../domain/types'
import type { Rec } from './merge'

/** 端末の呼び名（競合の控えの名前・つないだ文章の印に使う） */
export function deviceLabel(ua = typeof navigator === 'undefined' ? '' : navigator.userAgent): string {
  if (/iPhone/.test(ua)) return 'iPhone'
  if (/iPad/.test(ua)) return 'iPad'
  if (/Android/.test(ua)) return 'Android'
  if (/Windows/.test(ua)) return 'Windows'
  if (/Macintosh/.test(ua)) return 'Mac'
  // 名前は同期されてほかの端末でも見えるので、「この端末」とは書かない
  return 'ブラウザ'
}

const isContentTable = (t: string): t is ContentTableName => (CONTENT_TABLES as readonly string[]).includes(t)

/**
 * 片方の端末で削除され、もう片方で編集されていたレコード（と、MIM の欄の競合で採らなかった相手の記録）の控えをゴミ箱の1件にする。
 * 中身の表（items・routines・favorites・mimNotes）でなければ控えない（null）。
 */
export function conflictTrash(
  data: AppData,
  table: string,
  record: Rec,
  opts: { now: number; newId: () => ID },
): { entry: TrashEntry; records: TrashRecord[] } | null {
  if (!isContentTable(table)) return null
  const d = describeForTrash(data, table, record as never)
  const entryId = opts.newId()
  const records: TrashRecord[] = [
    {
      id: opts.newId(),
      entryId,
      table,
      record: record as unknown as TrashRecord['record'],
      createdAt: opts.now,
      updatedAt: opts.now,
    },
  ]
  const entry: TrashEntry = {
    id: entryId,
    kind: d.kind,
    label: d.label,
    place: d.place,
    origin: d.origin,
    recordIds: records.map((r) => r.id),
    reason: 'conflict',
    by: 'user',
    ai: null,
    inboxId: null,
    deletedAt: opts.now,
    createdAt: opts.now,
    updatedAt: opts.now,
  }
  return { entry, records }
}

/** ゴミ箱の1件（件と中身）を、端末内に書く変化にする */
export function trashChanges(r: { entry: TrashEntry; records: TrashRecord[] }): Change[] {
  return [
    { table: 'trashEntries', id: r.entry.id, record: r.entry as unknown as AnyRecord },
    ...r.records.map((tr) => ({ table: 'trashRecords' as const, id: tr.id, record: tr as unknown as AnyRecord })),
  ]
}

/**
 * 同期の競合の控え方（ストア・テストで使う）。data は控えの表記（場所・名前）に使う、反映する前の表示用の内容。
 * report で集めた知らせは、保存・反映が終わってからまとめて出す。
 */
export function createConflictHooks(opts: {
  device: string
  data: () => AppData
  report?: (note: ConflictNote) => void
  now?: () => number
  newId: () => ID
}): ConflictHooks {
  const now = opts.now ?? (() => Date.now())
  return {
    device: opts.device,
    trashCopy: (table, record) => {
      const r = conflictTrash(opts.data(), table, record, { now: now(), newId: opts.newId })
      return r ? trashChanges(r) : []
    },
    report: opts.report,
  }
}
