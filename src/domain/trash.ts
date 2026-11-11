// ゴミ箱（docs/SPEC.md の 6.15・18.2）: 消した物を30日とっておき、元の場所へ戻せるようにする。
// 消す操作は putInTrash で記録を丸ごとここへ移し、削除した時点の場所（TrashOrigin）を控える。戻す時はその場所へ並べ直す。
// NS の src/domain/trash.ts の putInTrash・一覧・期限・完全に削除をそのまま写し、種類・名前・場所の表記と戻し方を DS の6種類の
// 単純な形で書き直した（稿・幕・タイトルの付け直しは無い）。すべて純粋関数で、新しい AppData を返す。戻せない時は DomainError を投げる。
import { shortDateLabel } from './dates'
import { isDerivedId, routineCheckId } from './derivedId'
import { periodOf } from './items'
import { ROUTINE_CYCLE_LABELS, normalizeDatesKeeping } from './routines'
import { Tx, transact } from './tx'
import {
  DomainError,
  isTrashTable,
  type AppData,
  type By,
  type ContentTableName,
  type Favorite,
  type ID,
  type InboxRecord,
  type Item,
  type ItemKind,
  type MimNote,
  type Routine,
  type RoutineCheck,
  type TrashEntry,
  type TrashKind,
  type TrashOrigin,
  type TrashRecord,
  type TrashTableName,
  type TrashableRecord,
} from './types'
import { DAY_MS, byOrder, compareStr, newId, now } from './util'

// ---------- 定数・表記 ----------

/** ゴミ箱に残す日数。これを過ぎたものは中身ごと完全に削除する */
export const TRASH_RETENTION_DAYS = 30
export const TRASH_RETENTION_MS = TRASH_RETENTION_DAYS * DAY_MS

/** 削除の確認文の結び（「ゴミ箱に移します。30日後に完全に削除されます（それまではゴミ箱から元に戻せます）。」） */
export function trashNotice(subject = ''): string {
  return `${subject}ゴミ箱に移します。${TRASH_RETENTION_DAYS}日後に完全に削除されます（それまではゴミ箱から元に戻せます）。`
}

export const TRASH_KINDS: readonly TrashKind[] = ['event', 'task', 'favorite', 'favoritesDone', 'routine', 'mimNote']

export function isTrashKind(v: unknown): v is TrashKind {
  return typeof v === 'string' && (TRASH_KINDS as readonly string[]).includes(v)
}

/** 種類ごとの本体の表 */
export const TRASH_KIND_TABLE: Record<TrashKind, ContentTableName> = {
  event: 'items',
  task: 'items',
  favorite: 'favorites',
  favoritesDone: 'favorites',
  routine: 'routines',
  mimNote: 'mimNotes',
}

/** 種類の表示（6.15） */
export const TRASH_KIND_LABELS: Record<TrashKind, string> = {
  event: '予定',
  task: 'タスク',
  favorite: 'やりたいこと',
  favoritesDone: '済みのやりたいこと',
  routine: 'ルーチン',
  mimNote: 'MIM のメモ',
}

/** 同期の競合で控えた件の種類の表示（6.15。場所は元の場所） */
export const CONFLICT_TRASH_LABEL = '同期の競合で残した内容'

export const ITEM_KIND_LABELS: Record<ItemKind, string> = { work: '仕事', private: 'プライベート' }

/** 長い文章の最初の行（見出しが無い時の名前。長ければ切る） */
function firstLine(text: string, max = 24): string {
  const line =
    String(text ?? '')
      .split(/\r\n?|\n/)
      .map((l) => l.trim())
      .find((l) => l.length > 0) ?? ''
  const chars = Array.from(line)
  return chars.length > max ? `${chars.slice(0, max).join('')}…` : line
}

/** 一覧に出す名前（画面の表記と同じ。空なら「（件名なし）」など） */
export const trashLabel = {
  item: (i: Pick<Item, 'title'>) => String(i.title ?? '').trim() || '（件名なし）',
  favorite: (f: Pick<Favorite, 'text'>) => firstLine(f.text) || '（空のやりたいこと）',
  favoritesDone: (n: number) => `済みのやりたいこと（${n}件）`,
  routine: (r: Pick<Routine, 'title'>) => String(r.title ?? '').trim() || '（件名なし）',
  mimNote: (m: Pick<MimNote, 'title'>) => String(m.title ?? '').trim() || '無題',
}

/** 場所の表記（6.15）: 予定は「カレンダー 11/10（火） 仕事」、カレンダーに出ていないタスクは「Task List」 */
export function itemPlace(item: Pick<Item, 'origin' | 'start' | 'due' | 'kind'>): string {
  const p = periodOf(item)
  if (!p) return 'Task List'
  return `カレンダー ${shortDateLabel(p.from)} ${ITEM_KIND_LABELS[item.kind] ?? ITEM_KIND_LABELS.work}`
}

export const FAVORITE_PLACE = 'Favorite List'
export const MIM_PLACE = 'MIM'

/** 「Routine List › 毎週」 */
export function routinePlace(r: Pick<Routine, 'cycle'>): string {
  return `Routine List › ${ROUTINE_CYCLE_LABELS[r.cycle] ?? ROUTINE_CYCLE_LABELS.daily}`
}

// ---------- ゴミ箱へ入れる ----------

export interface TrashSpec {
  kind: TrashKind
  label: string
  place: string
  origin: TrashOrigin
  /** 中身。先頭が削除したもの本体 */
  records: { table: TrashTableName; record: TrashableRecord }[]
  reason?: TrashEntry['reason']
  at?: number
  /** ゴミ箱の1件の id（無い = 新しい id）。依頼・提案で移す時は受け取り箱の id から決める（inboxTrashIds） */
  entryId?: ID
  /** 中身の i 番目の id（無い = 新しい id。entryId と同じ理由） */
  recordId?: (i: number) => ID
  by?: By
  ai?: string | null
  inboxId?: ID | null
}

/** レコードをゴミ箱の1件にまとめて入れ、元の表から消す */
export function putInTrash(tx: Tx, spec: TrashSpec): ID {
  const ts = spec.at ?? now()
  const entryId = spec.entryId ?? newId()
  const recordIds: ID[] = []
  const seen = new Set<string>()
  for (const { table, record } of spec.records) {
    const key = `${table}:${record.id}`
    if (seen.has(key)) continue
    seen.add(key)
    const id = spec.recordId ? spec.recordId(recordIds.length) : newId()
    const trashRecord: TrashRecord = { id, entryId, table, record, createdAt: ts, updatedAt: ts }
    tx.put('trashRecords', trashRecord)
    recordIds.push(trashRecord.id)
    tx.delete(table, record.id)
  }
  const entry: TrashEntry = {
    id: entryId,
    kind: spec.kind,
    label: spec.label,
    place: spec.place,
    origin: spec.origin,
    recordIds,
    reason: spec.reason ?? 'deleted',
    by: spec.by ?? 'user',
    ai: spec.ai ?? null,
    inboxId: spec.inboxId ?? null,
    deletedAt: ts,
    createdAt: ts,
    updatedAt: ts,
  }
  tx.put('trashEntries', entry)
  return entryId
}

/** 受け取り箱の依頼・提案で移す時のゴミ箱の id（te-{id}・tr-{id}・tr-{id}-{i}。2台が同じ依頼を当てても1件。19.5） */
export function inboxTrashIds(inboxId: ID): { entry: ID; record: (i: number) => ID } {
  return { entry: `te-${inboxId}`, record: (i) => (i === 0 ? `tr-${inboxId}` : `tr-${inboxId}-${i}`) }
}

/** order で並ぶ一覧（peers）の中での場所。index には order の値を控える（戻す時に、間の要素が欠けていても順番を保てる） */
export function orderOrigin(peers: { id: ID; order: number }[], id: ID, order?: number): TrashOrigin {
  const sorted = [...peers].sort(byOrder)
  const i = sorted.findIndex((r) => r.id === id)
  if (i < 0) return { index: typeof order === 'number' ? order : -1 }
  return { index: sorted[i].order, prevId: i > 0 ? sorted[i - 1].id : null }
}

/** ゴミ箱の件の種類・名前・場所・戻し先（手で消す時・同期の競合で控える時。src/sync/conflicts.ts も使う） */
export interface TrashDescriptor {
  kind: TrashKind
  label: string
  place: string
  origin: TrashOrigin
}

export function describeForTrash(data: AppData, table: ContentTableName, record: TrashableRecord): TrashDescriptor {
  switch (table) {
    case 'items': {
      const it = record as Item
      return {
        kind: periodOf(it) ? 'event' : 'task',
        label: trashLabel.item(it),
        place: itemPlace(it),
        origin: { index: typeof it.order === 'number' ? it.order : -1 },
      }
    }
    case 'favorites': {
      const f = record as Favorite
      return {
        kind: 'favorite',
        label: trashLabel.favorite(f),
        place: FAVORITE_PLACE,
        origin: orderOrigin(Object.values(data.favorites), f.id, f.order),
      }
    }
    case 'routines': {
      const r = record as Routine
      const peers = Object.values(data.routines).filter((x) => x.cycle === r.cycle)
      return { kind: 'routine', label: trashLabel.routine(r), place: routinePlace(r), origin: orderOrigin(peers, r.id, r.order) }
    }
    case 'mimNotes': {
      const m = record as MimNote
      return {
        kind: 'mimNote',
        label: trashLabel.mimNote(m),
        place: MIM_PLACE,
        origin: orderOrigin(Object.values(data.mimNotes), m.id, m.order),
      }
    }
  }
}

/** 消す操作の付け足し（Claude の依頼・提案で移す時の id と出どころ。手で消す時は無し） */
export interface TrashOptions {
  at?: number
  by?: By
  ai?: string | null
  inboxId?: ID | null
  ids?: { entry: ID; record: (i: number) => ID }
}

const fromOptions = (o: TrashOptions | undefined) => ({
  at: o?.at,
  by: o?.by,
  ai: o?.ai,
  inboxId: o?.inboxId,
  entryId: o?.ids?.entry,
  recordId: o?.ids?.record,
})

/** そのルーチンのチェックの記録（月の順） */
function checksOfRoutine(data: AppData, routineId: ID): RoutineCheck[] {
  return Object.values(data.routineChecks)
    .filter((c) => c.routineId === routineId)
    .sort((a, b) => compareStr(a.id, b.id))
}

/**
 * 中身の表の1件をゴミ箱へ移す（予定・タスク・やりたいこと・ルーチン（チェックの記録ごと）・MIM のメモ）。
 * 戻り値はゴミ箱の件の id。無ければ DomainError
 */
export function trashRecord(data: AppData, table: ContentTableName, id: ID, opts?: TrashOptions): { data: AppData; result: ID } {
  const record = data[table][id] as TrashableRecord | undefined
  if (!record) throw new DomainError('見つかりません。すでに削除されています。')
  const d = describeForTrash(data, table, record)
  const records: TrashSpec['records'] = [{ table, record }]
  if (table === 'routines') for (const c of checksOfRoutine(data, id)) records.push({ table: 'routineChecks', record: c })
  return transact(data, (tx) => putInTrash(tx, { ...d, records, ...fromOptions(opts) }))
}

export const trashItem = (data: AppData, id: ID, opts?: TrashOptions) => trashRecord(data, 'items', id, opts)
export const trashFavorite = (data: AppData, id: ID, opts?: TrashOptions) => trashRecord(data, 'favorites', id, opts)
export const trashRoutine = (data: AppData, id: ID, opts?: TrashOptions) => trashRecord(data, 'routines', id, opts)
export const trashMimNote = (data: AppData, id: ID, opts?: TrashOptions) => trashRecord(data, 'mimNotes', id, opts)

/** 「済みを片付ける」: 済みのやりたいことをまとめてゴミ箱の1件に入れる（戻すとまとめて戻る。15.3）。戻り値は件の id と件数 */
export function trashDoneFavorites(
  data: AppData,
  opts?: TrashOptions,
): { data: AppData; result: { entryId: ID; count: number } } {
  const done = Object.values(data.favorites)
    .filter((f) => f.done)
    .sort(byOrder)
  if (done.length === 0) throw new DomainError('済みのやりたいことがありません。')
  return transact(data, (tx) => {
    const entryId = putInTrash(tx, {
      kind: 'favoritesDone',
      label: trashLabel.favoritesDone(done.length),
      place: FAVORITE_PLACE,
      origin: { index: done[0].order },
      records: done.map((record) => ({ table: 'favorites' as const, record })),
      ...fromOptions(opts),
    })
    return { entryId, count: done.length }
  })
}

// ---------- 一覧 ----------

/** 新しく削除したものから順に */
export function listTrash(entries: AppData['trashEntries']): TrashEntry[] {
  return Object.values(entries).sort((a, b) => b.deletedAt - a.deletedAt || b.createdAt - a.createdAt || compareStr(a.id, b.id))
}

/** 完全に削除される日時 */
export function trashExpiresAt(entry: Pick<TrashEntry, 'deletedAt'>): number {
  return entry.deletedAt + TRASH_RETENTION_MS
}

/** 削除してから30日たった（この時点で完全に削除する） */
export function isTrashExpired(entry: Pick<TrashEntry, 'deletedAt'>, nowTs: number): boolean {
  return nowTs >= trashExpiresAt(entry)
}

/** 完全に削除されるまでの残り日数（切り上げ。1日未満でも「あと1日」。端末の時計が戻っていても30日を超えない） */
export function trashDaysLeft(entry: Pick<TrashEntry, 'deletedAt'>, nowTs: number): number {
  const left = trashExpiresAt(entry) - nowTs
  if (left <= 0) return 0
  return Math.min(TRASH_RETENTION_DAYS, Math.ceil(left / DAY_MS))
}

/** 1件の中身（recordIds の順。載っていないが同じ件に属するものは後ろに付ける） */
export function trashContents(data: AppData, entry: TrashEntry): TrashRecord[] {
  const out: TrashRecord[] = []
  const seen = new Set<ID>()
  for (const id of entry.recordIds) {
    const r = data.trashRecords[id]
    if (!r || r.entryId !== entry.id || seen.has(id)) continue
    seen.add(id)
    out.push(r)
  }
  for (const r of Object.values(data.trashRecords)) {
    if (r.entryId === entry.id && !seen.has(r.id)) {
      seen.add(r.id)
      out.push(r)
    }
  }
  return out
}

/** 本体のレコード */
export function trashMainRecord(data: AppData, entry: TrashEntry): TrashRecord | undefined {
  const r = data.trashRecords[entry.recordIds[0]]
  return r && r.entryId === entry.id ? r : undefined
}

/** その表のその id の記録がゴミ箱にあるか（中身のどれかとして） */
export function isInTrash(data: Pick<AppData, 'trashRecords'>, table: TrashTableName, id: ID): boolean {
  for (const r of Object.values(data.trashRecords)) {
    if (r.table === table && (r.record as { id?: unknown } | null)?.id === id) return true
  }
  return false
}

/** ゴミ箱の札（Claude の依頼・提案で移した物だけ。提案に答えて移した物（アプリの［承認］・会話の依頼）は「Claude の提案」。6.15） */
export function trashBadge(entry: TrashEntry, inbox: AppData['inbox']): 'Claude の依頼' | 'Claude の提案' | null {
  if (entry.by !== 'connector') return null
  const rec: InboxRecord | undefined = entry.inboxId ? inbox[entry.inboxId] : undefined
  if (rec && (rec.op === 'propose' || rec.proposalId)) return 'Claude の提案'
  return 'Claude の依頼'
}

// ---------- 完全に削除 ----------

function removeEntries(tx: Tx, ids: Set<ID>): void {
  if (ids.size === 0) return
  for (const id of ids) {
    const entry = tx.get('trashEntries', id)
    for (const rid of entry?.recordIds ?? []) {
      if (tx.get('trashRecords', rid)?.entryId === id) tx.delete('trashRecords', rid)
    }
    tx.delete('trashEntries', id)
  }
  for (const r of tx.all('trashRecords')) if (ids.has(r.entryId)) tx.delete('trashRecords', r.id)
}

/** ゴミ箱の1件を中身ごと完全に削除する（もう無ければ何もしない） */
export function deleteTrashEntry(data: AppData, entryId: ID): AppData {
  if (!data.trashEntries[entryId]) return data
  return transact(data, (tx) => removeEntries(tx, new Set([entryId]))).data
}

/** ゴミ箱を空にする */
export function emptyTrash(data: AppData): AppData {
  if (Object.keys(data.trashEntries).length === 0 && Object.keys(data.trashRecords).length === 0) return data
  return transact(data, (tx) => {
    for (const e of tx.all('trashEntries')) tx.delete('trashEntries', e.id)
    for (const r of tx.all('trashRecords')) tx.delete('trashRecords', r.id)
  }).data
}

/**
 * 削除してから30日たったものを中身ごと完全に削除する（1時間ごと。6.15）。消すものがなければ data をそのまま返す。
 * 同期中は件（entry）より中身が先に届くことがあるので、件のない中身はここでは消さない（NS と同じ）
 */
export function purgeExpiredTrash(data: AppData, nowTs: number): AppData {
  const expired = new Set(
    Object.values(data.trashEntries)
      .filter((e) => isTrashExpired(e, nowTs))
      .map((e) => e.id),
  )
  if (expired.size === 0) return data
  return transact(data, (tx) => removeEntries(tx, expired)).data
}

// ---------- 元に戻す ----------

export interface RestoreResult {
  entryId: ID
  kind: TrashKind
  label: string
  /** 戻したもの本体の id（複製として戻した時は新しい id） */
  id: ID
  /** 同じ id のものが残っていたので、新しい id の複製として戻した */
  copied: boolean
  /** 内容から作った id で、同じ id の記録がもうあったので戻さなかった中身（6.15） */
  skipped: ID[]
}

type Ordered = { id: ID; order: number }

/** 並びの項目（端末に保存した記録なので、並びでなければ空とみなす） */
const listOf = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

/**
 * order で並ぶ一覧へ戻す。先頭にあった（prevId = null）なら先頭、直前にあった要素がまだあればその直後、
 * なければ削除した時の order の値の位置。今の order の値でその位置に並ぶならそのまま、並ばなければ前後の間の値にする
 * （ほかの記録の order は書き換えない。前後が同じ値で間が無い時だけ、全部を 0..n-1 に詰め直す）
 */
function placeInOrder<T extends 'favorites' | 'routines' | 'mimNotes'>(
  tx: Tx,
  table: T,
  id: ID,
  isPeer: (r: AppData[T][string]) => boolean,
  origin: TrashOrigin,
): void {
  const self = tx.get(table, id) as (AppData[T][string] & Ordered) | undefined
  if (!self) return
  const list = (tx.all(table) as (AppData[T][string] & Ordered)[]).filter((r) => r.id !== id && isPeer(r)).sort(byOrder)
  let at: number
  if (origin.prevId === null) at = 0
  else {
    const prev = origin.prevId ? list.findIndex((r) => r.id === origin.prevId) : -1
    if (prev >= 0) at = prev + 1
    else {
      const key = Number.isFinite(origin.index) && origin.index >= 0 ? origin.index : self.order
      at = list.findIndex((r) => r.order > key)
      if (at < 0) at = list.length
    }
  }
  const before = list[at - 1]
  const after = list[at]
  const at0: Ordered = { id, order: 0 }
  const fits = (o: number) =>
    (!before || byOrder<Ordered>(before, { ...at0, order: o }) < 0) &&
    (!after || byOrder<Ordered>({ ...at0, order: o }, after) < 0)
  let order = self.order
  if (!fits(order)) {
    if (!before) order = after.order - 1
    else if (!after) order = before.order + 1
    else if (before.order < after.order) order = (before.order + after.order) / 2
    else {
      const all = [...list.slice(0, at), self, ...list.slice(at)]
      all.forEach((r, i) => {
        if (r.order !== i) tx.put(table, { ...r, order: i } as AppData[T][string])
      })
      return
    }
  }
  if (order !== self.order) tx.put(table, { ...self, order } as AppData[T][string])
}

/**
 * ゴミ箱の1件を元の場所へ戻す。
 * - 同じ id の記録が今あれば: 内容から作った id（Claude が足した物）は戻さない（本体がそうなら戻せない）。ほかは新しい id の複製で戻す
 *   （同期の競合で控えた件も同じ）。ルーチンを複製で戻す時は、チェックの記録も新しいルーチンの id で戻す
 * - 戻すと、予定・タスクは Task List とカレンダーの両方に戻る（同じ1件。6.15）。ルーチンはチェックの記録ごと戻る
 */
export function restoreTrashEntry(data: AppData, entryId: ID): { data: AppData; result: RestoreResult } {
  const entry = data.trashEntries[entryId]
  if (!entry) throw new DomainError('ゴミ箱に見つかりません。すでに元に戻したか、完全に削除されています。')
  const contents = trashContents(data, entry)
  const main = contents[0]
  if (!main || main.table !== TRASH_KIND_TABLE[entry.kind] || !main.record || typeof main.record.id !== 'string') {
    throw new DomainError('ゴミ箱の中身が見つからないため戻せません。')
  }
  const mainTable = main.table as ContentTableName
  if (data[mainTable][main.record.id] && isDerivedId(main.record.id) && entry.reason !== 'conflict') {
    throw new DomainError('同じ内容の記録がもうあるため、戻せません（ゴミ箱から完全に削除できます）。')
  }
  return transact(data, (tx) => {
    const ids = new Map<ID, ID>()
    const skipped: ID[] = []
    const seen = new Set<string>()
    const items: TrashRecord[] = []
    for (const r of contents) {
      if (!isTrashTable(r.table) || !r.record || typeof r.record.id !== 'string') continue
      const key = `${r.table}:${r.record.id}`
      if (seen.has(key)) continue
      seen.add(key)
      if (r.table !== 'routineChecks' && tx.get(r.table, r.record.id)) {
        if (isDerivedId(r.record.id) && entry.reason !== 'conflict') {
          skipped.push(r.record.id)
          continue
        }
        ids.set(r.record.id, newId())
      }
      items.push(r)
    }
    for (const r of items) {
      if (r.table === 'routineChecks') {
        const c = r.record as RoutineCheck
        const routineId = ids.get(c.routineId) ?? c.routineId
        const id = routineCheckId(routineId, c.month)
        const existing = tx.get('routineChecks', id)
        // 同じ月の記録が今あれば（ゴミ箱に入れている間に別の端末から届いた時など）、チェックした日を合わせる。正しい日付は小さい順・
        // 重なりなしにし、YYYY-MM-DD でない値（新しい版が足した形かもしれない値）は捨てずに後ろに残す（形3。同期の NORMALIZE と同じ）
        const dates = existing ? (normalizeDatesKeeping([...listOf(existing.dates), ...listOf(c.dates)]) as string[]) : c.dates
        tx.put('routineChecks', { ...(existing ?? c), id, routineId, dates })
        continue
      }
      const id = ids.get(r.record.id) ?? r.record.id
      tx.put(r.table, { ...r.record, id } as AppData[typeof r.table][string])
    }
    const mainId = ids.get(main.record.id) ?? main.record.id
    const origin = entry.origin ?? { index: -1 }
    switch (entry.kind) {
      case 'favorite':
        placeInOrder(tx, 'favorites', mainId, () => true, origin)
        break
      case 'routine': {
        const r = tx.get('routines', mainId)
        if (r) placeInOrder(tx, 'routines', mainId, (x) => x.cycle === r.cycle, origin)
        break
      }
      case 'mimNote':
        placeInOrder(tx, 'mimNotes', mainId, () => true, origin)
        break
      // 予定・タスクの order は作った時刻で、手での並びに使わない。済みのやりたいことは「済み」の中なので、元の order のまま
      case 'event':
      case 'task':
      case 'favoritesDone':
        break
    }
    removeEntries(tx, new Set([entry.id]))
    return {
      entryId: entry.id,
      kind: entry.kind,
      label: entry.label,
      id: mainId,
      copied: ids.has(main.record.id),
      skipped,
    }
  })
}
