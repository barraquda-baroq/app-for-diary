// 修復（表示用。docs/SPEC.md の 6.12）。起動時・バックアップの読み込み時・同期で記録を受け取った時（3者マージの後を含む）に、
// 表示用の内容だけを直す（端末の raw の記録とクラウドは書き換えない）。知らない項目は消さずに残す（新しい版のアプリが足した項目を壊さない）。
// 直した値のうち、保存の時に書き戻してよいのは、意味の分かる日付と時刻の並びの直し（itemDateFixes）だけ。知らない値（知らない kind・
// label・cycle など）と知らない項目は、保存の時もそのまま残す（形3。storedRecord）。
// NS の src/domain/repair.ts の作り（小さな関数・知らない項目を残す・ゴミ箱の直し）を写し、表の直しは 6.12 で書き直した。
import { isHm, isMonth, isYmd, hmToMinutes, ymdOfMs } from './dates'
import { deepEqual } from './equal'
import { periodOf } from './items'
import { isLabelKey } from './labels'
import { effectiveSpec, isRoutineCycle, normalizeDates } from './routines'
import { TRASH_KIND_LABELS, isTrashKind } from './trash'
import {
  ITEM_KINDS,
  TABLE_NAMES,
  isTrashTable,
  type AppData,
  type By,
  type Favorite,
  type ID,
  type Item,
  type LabelName,
  type MimNote,
  type MimQr,
  type MimSecret,
  type OffDay,
  type Routine,
  type RoutineCheck,
  type TableName,
  type TrashEntry,
  type TrashOrigin,
  type TrashRecord,
} from './types'

export interface RepairResult {
  data: AppData
  /** 直した箇所の説明（空なら変更なし） */
  fixes: string[]
}

type Obj = Record<string, unknown>

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback)
const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const strOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null)
const isObj = (v: unknown): v is Obj => Boolean(v) && typeof v === 'object' && !Array.isArray(v)
const by = (v: unknown): By => (v === 'connector' ? 'connector' : 'user')

/** 共通の項目（6.1）の形を整える */
function provenance(r: Obj) {
  return { by: by(r.by), ai: strOrNull(r.ai), via: strOrNull(r.via) }
}

function contentBase(r: Obj) {
  const createdAt = num(r.createdAt)
  return { v: num(r.v, 1), createdAt, updatedAt: num(r.updatedAt, createdAt), ...provenance(r) }
}

/** 件名が空の時の表示（6.12） */
export const UNTITLED = '（件名なし）'

/**
 * 表示用の記録の件名「（件名なし）」が、端末の記録（stored。raw）の空の件名（文字でない・項目が無い物も）を直した物か（6.12・D48）。
 * 本当に「（件名なし）」という件名の記録とは、端末の記録を見て見分ける。端末の記録が無い（このタブで作ってまだ保存していない）時は
 * false（表示用の記録がそのまま端末に書く形）
 */
export function untitledByRepair(shown: { title: unknown }, stored: unknown): boolean {
  if (shown.title !== UNTITLED || !isObj(stored)) return false
  return typeof stored.title !== 'string' || stored.title.trim() === ''
}

// ---------- 項目（日付と時刻の並びの直し） ----------

type DateFields = Pick<Item, 'origin' | 'start' | 'due' | 'startTime' | 'endTime'>

/**
 * 日付と時刻の並びの直し（6.12 の「（書き戻す）」の3つ。保存の時に書き戻してよい直し。形3）。形の正しい値か null だけを見て直し、
 * 形の分からない値（新しい版の形かもしれない値）には触らない。生まれ（origin）が 'calendar' か 'list' の記録だけを直す（知らない生まれは、
 * 新しい版の決まりかもしれないので触らない）。直す項目と新しい値を返す（直す所が無ければ空）。
 * - start > due → calendar 生まれは due = start、list 生まれは start を無いものとする（締め切り日は動かさない）
 * - startTime が無いのに endTime がある → endTime を消す
 * - 1日の予定で endTime ≤ startTime → endTime を消す
 * 「calendar 生まれで start が無い → due か createdAt の日付」は表示の時だけの直し（repairItem）で、書き戻さない
 */
export function itemDateFixes(rec: DateFields): Partial<Pick<Item, 'start' | 'due' | 'endTime'>> {
  const out: Partial<Pick<Item, 'start' | 'due' | 'endTime'>> = {}
  if (rec.origin !== 'calendar' && rec.origin !== 'list') return out
  let start = isYmd(rec.start) ? rec.start : null
  let due = isYmd(rec.due) ? rec.due : null
  const startTime = isHm(rec.startTime) ? rec.startTime : null
  const endTime = isHm(rec.endTime, true) ? rec.endTime : null
  if (start && due && start > due) {
    if (rec.origin === 'calendar') {
      due = start
      out.due = due
    } else {
      start = null
      out.start = null
    }
  }
  if (rec.startTime === null && endTime !== null) out.endTime = null
  else if (startTime !== null && endTime !== null) {
    const p = periodOf({ origin: rec.origin, start, due })
    if (p && p.from === p.to && hmToMinutes(endTime) <= hmToMinutes(startTime)) out.endTime = null
  }
  return out
}

/** 項目の表示用の形（知らない項目は残す） */
function repairItem(r: Obj): Item {
  const origin = r.origin === 'list' ? 'list' : 'calendar'
  const base: Item = {
    ...(r as unknown as Item),
    id: r.id as ID,
    ...contentBase(r),
    kind: ITEM_KINDS.includes(r.kind as Item['kind']) ? (r.kind as Item['kind']) : 'work',
    title: str(r.title).trim() ? str(r.title) : UNTITLED,
    origin,
    start: isYmd(r.start) ? r.start : null,
    due: isYmd(r.due) ? r.due : null,
    startTime: isHm(r.startTime) ? r.startTime : null,
    endTime: isHm(r.endTime, true) ? r.endTime : null,
    listed: typeof r.listed === 'boolean' ? r.listed : origin === 'list',
    done: r.done === true,
    doneAt: numOrNull(r.doneAt),
    doneOn: isYmd(r.doneOn) ? r.doneOn : null,
    locked: r.locked === true,
    label: isLabelKey(r.label) ? r.label : null,
    requester: str(r.requester),
    memo: str(r.memo),
    order: num(r.order, num(r.createdAt)),
  }
  // calendar 生まれで start が無い → due、それも無ければ createdAt の暦の日付（表示の時だけ。書き戻さない。6.12）
  if (base.origin === 'calendar' && base.start === null) base.start = base.due ?? ymdOfMs(base.createdAt)
  const next: Item = { ...base, ...itemDateFixes(base) }
  // どこにも出ない項目を作らない（list 生まれで締め切り日が無く listed が false → Task List に出す。お知らせは出さない。6.3）
  if (next.origin === 'list' && next.due === null && !next.listed) next.listed = true
  return next
}

// ---------- ほかの表 ----------

function repairRoutine(r: Obj): Routine {
  const cycle = isRoutineCycle(r.cycle) ? r.cycle : 'daily'
  const spec = effectiveSpec({
    cycle,
    weekdays: Array.isArray(r.weekdays) ? (r.weekdays as number[]) : [],
    monthDay: r.monthDay as number | null,
    yearMonth: r.yearMonth as number | null,
    yearDay: r.yearDay as number | null,
  })
  return {
    ...(r as unknown as Routine),
    id: r.id as ID,
    ...contentBase(r),
    title: str(r.title).trim() ? str(r.title) : UNTITLED,
    ...spec,
    order: num(r.order),
  }
}

function repairCheck(r: Obj): RoutineCheck {
  return {
    ...(r as unknown as RoutineCheck),
    id: r.id as ID,
    routineId: str(r.routineId),
    month: isMonth(r.month) ? r.month : str(r.month),
    dates: normalizeDates(Array.isArray(r.dates) ? r.dates : []),
    updatedAt: num(r.updatedAt),
    ...provenance(r),
  }
}

function repairOffDay(r: Obj): OffDay {
  return {
    ...(r as unknown as OffDay),
    id: r.id as ID,
    date: isYmd(r.date) ? r.date : (r.id as string),
    off: r.off === true,
    updatedAt: num(r.updatedAt),
    ...provenance(r),
  }
}

function repairLabelName(r: Obj): LabelName {
  return { ...(r as unknown as LabelName), id: r.id as ID, name: str(r.name), updatedAt: num(r.updatedAt), ...provenance(r) }
}

function repairFavorite(r: Obj): Favorite {
  return {
    ...(r as unknown as Favorite),
    id: r.id as ID,
    ...contentBase(r),
    text: str(r.text),
    done: r.done === true,
    doneAt: numOrNull(r.doneAt),
    order: num(r.order),
  }
}

function repairMim(r: Obj): MimNote {
  const secrets: MimSecret[] = (Array.isArray(r.secrets) ? r.secrets : [])
    .filter((s): s is Obj => isObj(s) && typeof s.id === 'string')
    .map((s) => ({ ...(s as unknown as MimSecret), name: str(s.name), value: str(s.value) }))
  const qrs: MimQr[] = (Array.isArray(r.qrs) ? r.qrs : [])
    .filter((q): q is Obj => isObj(q) && typeof q.id === 'string')
    .map((q) => ({ ...(q as unknown as MimQr), caption: str(q.caption), text: str(q.text) }))
  return {
    ...(r as unknown as MimNote),
    id: r.id as ID,
    ...contentBase(r),
    title: str(r.title),
    body: str(r.body),
    secrets,
    qrs,
    order: num(r.order),
  }
}

/** 削除した時点の場所の形を整える（知らない項目は残す） */
function normalizeOrigin(raw: unknown): TrashOrigin {
  const o = isObj(raw) ? raw : {}
  const out: Obj = { ...o, index: num(o.index, -1) }
  if ('prevId' in o) {
    if (o.prevId === null || typeof o.prevId === 'string') out.prevId = o.prevId
    else delete out.prevId
  }
  return out as unknown as TrashOrigin
}

/** ゴミ箱: 種類の分からない件・形の壊れた中身・件のない中身・中身のない件を取り除き（表示だけ）、項目を補う */
function repairTrash(d: AppData, fix: (m: string) => void): void {
  for (const e of Object.values(d.trashEntries) as unknown as Obj[]) {
    const id = e.id as ID
    if (!isTrashKind(e.kind)) {
      delete d.trashEntries[id]
      fix('種類の分からないゴミ箱の項目を見えなくしました')
      continue
    }
    const createdAt = num(e.createdAt)
    const next: TrashEntry = {
      ...(e as unknown as TrashEntry),
      kind: e.kind,
      label: str(e.label, TRASH_KIND_LABELS[e.kind]),
      place: str(e.place),
      origin: normalizeOrigin(e.origin),
      recordIds: Array.isArray(e.recordIds) ? e.recordIds.filter((x): x is string => typeof x === 'string') : [],
      reason: e.reason === 'conflict' ? 'conflict' : 'deleted',
      by: by(e.by),
      ai: strOrNull(e.ai),
      inboxId: strOrNull(e.inboxId),
      deletedAt: num(e.deletedAt, createdAt),
      createdAt,
      updatedAt: num(e.updatedAt, createdAt),
    }
    if (!deepEqual(next, e)) {
      d.trashEntries[id] = next
      fix('ゴミ箱の項目を補いました')
    }
  }

  const byEntry = new Map<ID, ID[]>()
  for (const r of Object.values(d.trashRecords) as unknown as Obj[]) {
    const id = r.id as ID
    const rec = r.record
    if (!isTrashTable(r.table) || !isObj(rec) || typeof rec.id !== 'string') {
      delete d.trashRecords[id]
      fix('形の壊れたゴミ箱の中身を見えなくしました')
      continue
    }
    if (typeof r.entryId !== 'string' || !d.trashEntries[r.entryId]) {
      delete d.trashRecords[id]
      fix('ゴミ箱の項目のない中身を見えなくしました')
      continue
    }
    const next = { ...(r as unknown as TrashRecord), createdAt: num(r.createdAt), updatedAt: num(r.updatedAt) }
    if (!deepEqual(next, r)) {
      d.trashRecords[id] = next
      fix('ゴミ箱の中身の項目を補いました')
    }
    const list = byEntry.get(r.entryId) ?? []
    list.push(id)
    byEntry.set(r.entryId, list)
  }

  for (const e of Object.values(d.trashEntries)) {
    const owned = byEntry.get(e.id) ?? []
    if (owned.length === 0) {
      delete d.trashEntries[e.id]
      fix('中身のないゴミ箱の項目を見えなくしました')
      continue
    }
    // 載っている順（先頭が本体）を保ち、載っていない中身は後ろに足す
    const ownedSet = new Set(owned)
    const listed = [...new Set(e.recordIds.filter((id) => ownedSet.has(id)))]
    const listedSet = new Set(listed)
    const recordIds = [...listed, ...owned.filter((id) => !listedSet.has(id))]
    if (!deepEqual(recordIds, e.recordIds)) {
      d.trashEntries[e.id] = { ...e, recordIds }
      fix('ゴミ箱の項目の中身の一覧を直しました')
    }
  }
}

/** 表ごとの記録の直し（ゴミ箱と受け取り箱は別） */
const RECORD_REPAIRS: Partial<Record<TableName, (r: Obj) => object>> = {
  items: repairItem,
  routines: repairRoutine,
  routineChecks: repairCheck,
  offDays: repairOffDay,
  labelNames: repairLabelName,
  favorites: repairFavorite,
  mimNotes: repairMim,
}

const TABLE_LABELS: Record<TableName, string> = {
  items: '予定・タスク',
  offDays: '休み',
  labelNames: 'ラベルの呼び名',
  routines: 'ルーチン',
  routineChecks: 'ルーチンのチェックの記録',
  favorites: 'やりたいこと',
  mimNotes: 'MIM のメモ',
  inbox: '受け取り箱',
  trashEntries: 'ゴミ箱の項目',
  trashRecords: 'ゴミ箱の中身',
}

/**
 * 表示用に直したデータ（6.12）。渡した data は書き換えない。直さなかった記録は同じオブジェクトのまま（参照で比べられる）。
 * 受け取り箱は形を確かめずにそのまま（当てる時に src/domain/inbox.ts が確かめる。新しい版の依頼は触らない）
 */
export function repairData(input: AppData): RepairResult {
  const fixes: string[] = []
  const fix = (msg: string) => fixes.push(msg)
  const d = {} as AppData
  for (const table of TABLE_NAMES) {
    const src = (input as Partial<AppData>)[table]
    ;(d as unknown as Record<string, unknown>)[table] = isObj(src) ? { ...src } : {}
  }

  // id が一致しない・オブジェクトでないレコードを見えなくする
  for (const table of TABLE_NAMES) {
    const rows = d[table] as Record<ID, unknown>
    for (const [id, rec] of Object.entries(rows)) {
      if (!isObj(rec) || rec.id !== id) {
        delete rows[id]
        fix(`形の壊れた${TABLE_LABELS[table]}の記録を見えなくしました`)
      }
    }
  }

  for (const [table, repair] of Object.entries(RECORD_REPAIRS) as [TableName, (r: Obj) => object][]) {
    const rows = d[table] as unknown as Record<ID, Obj>
    for (const [id, rec] of Object.entries(rows)) {
      const next = repair(rec)
      if (!deepEqual(next, rec)) {
        ;(rows as Record<ID, unknown>)[id] = next
        fix(`${TABLE_LABELS[table]}の記録を表示用に直しました`)
      }
    }
  }

  // 親（ルーチン）の無いチェックの記録は見えなくする（6.12）
  for (const c of Object.values(d.routineChecks)) {
    if (!d.routines[c.routineId]) {
      delete d.routineChecks[c.id]
      fix('ルーチンの無いチェックの記録を見えなくしました')
    }
  }

  repairTrash(d, fix)
  return { data: d, fixes }
}

// ---------- 保存の時（形3） ----------

/**
 * 保存する時の記録（形3）: 端末の raw の記録に、表示用の記録で変えた項目だけを重ね、日付と時刻の並びの直し（itemDateFixes）だけを
 * 書き戻す。知らない値（知らない kind・label・cycle など）と知らない項目は、変えていなければ raw のまま残す（古い版のアプリが、
 * 新しい版で足した値を既定値で上書きしないように）。
 * - shownAfter が無い → 消した（undefined）
 * - raw か shownBefore が無い → 新しく作った記録（shownAfter をそのまま）
 * - 変えていない（shownAfter === shownBefore）→ raw のまま
 */
export function storedRecord<T extends TableName>(
  table: T,
  raw: AppData[T][string] | undefined,
  shownBefore: AppData[T][string] | undefined,
  shownAfter: AppData[T][string] | undefined,
): AppData[T][string] | undefined {
  if (shownAfter === undefined) return undefined
  if (raw === undefined || !isObj(raw) || shownBefore === undefined) return shownAfter
  if (shownAfter === shownBefore) return raw
  const before = shownBefore as unknown as Obj
  const after = shownAfter as unknown as Obj
  const out: Obj = { ...(raw as unknown as Obj) }
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (deepEqual(before[k], after[k])) continue
    if (after[k] === undefined) delete out[k]
    else out[k] = after[k]
  }
  if (table === 'items') Object.assign(out, itemDateFixes(out as unknown as Item))
  keepUnknownElements(table, raw as unknown as Obj, after, out)
  return out as unknown as AppData[T][string]
}

/**
 * 並びの項目で、表示用に直す時に除いた知らない要素（新しい版が足した曜日の値・形の違う日付など）を、保存の時も残す（形3）。
 * チェックした日（routineChecks.dates）と、種類を変えていない毎週の曜日（routines.weekdays）
 */
function keepUnknownElements(table: TableName, raw: Obj, after: Obj, out: Obj): void {
  const field = table === 'routineChecks' ? 'dates' : table === 'routines' && raw.cycle === after.cycle ? 'weekdays' : null
  if (!field || !Array.isArray(raw[field]) || !Array.isArray(out[field]) || out[field] === raw[field]) return
  const known = field === 'dates' ? isYmd : (x: unknown) => typeof x === 'number' && Number.isInteger(x) && x >= 0 && x <= 6
  const have = new Set((out[field] as unknown[]).map((x) => JSON.stringify(x)))
  const unknown = (raw[field] as unknown[]).filter((x) => !known(x) && !have.has(JSON.stringify(x)))
  if (unknown.length) out[field] = [...(out[field] as unknown[]), ...unknown]
}

/**
 * 保存するデータ（形3）: 表示用のデータの変更（shownBefore → shownAfter）を、端末の raw のデータに重ねる（storedRecord を記録ごとに）。
 * 変えていない表は raw の表のまま
 */
export function storedData(raw: AppData, shownBefore: AppData, shownAfter: AppData): AppData {
  const out = { ...raw }
  for (const table of TABLE_NAMES) {
    const b = shownBefore[table] as Record<ID, unknown>
    const a = shownAfter[table] as Record<ID, unknown>
    if (a === b) continue
    const r = raw[table] as Record<ID, unknown>
    const rows: Record<ID, unknown> = { ...r }
    for (const id of new Set([...Object.keys(b), ...Object.keys(a)])) {
      if (a[id] === b[id]) continue
      const next = storedRecord(table, r[id] as never, b[id] as never, a[id] as never)
      if (next === undefined) delete rows[id]
      else rows[id] = next
    }
    ;(out as unknown as Record<string, unknown>)[table] = rows
  }
  return out
}
