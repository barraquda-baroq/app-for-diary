// 手の操作（足す・直す・完了・日を動かす・複製・休み・呼び名・チェック）の純粋な関数（docs/SPEC.md の 6.2〜6.9・7.11・12.・13.〜16.）。
// 画面は store/actions から attempt(() => actions.xxx(...)) で呼ぶ。作る時は by: 'user'・ai: null・via: null・v: 1、直す時は updatedAt。
// 作った時の by・ai・via は直しても変えない（Claude が足した記録を作者が直しても 'connector' のまま。6.1）。消す操作は src/domain/trash.ts。
// NS の src/domain/entityOps.ts の書き方（transact・DomainError・updatedAt の付け方）だけを借りた。
import { hmToMinutes, isYmd, monthOf, ymdOfMs } from './dates'
import { routineCheckId } from './derivedId'
import type { DatePatch } from './drag'
import { DATE_REFUSED } from './itemInput'
import { itemProblems, periodOf } from './items'
import { isLabelKey } from './labels'
import { checkToday, latestResetDay, routineProblems, uncheck } from './routines'
import { transact } from './tx'
import {
  DomainError,
  LIMITS,
  RECORD_VERSION,
  type AppData,
  type Favorite,
  type ID,
  type Item,
  type ItemKind,
  type ItemOrigin,
  type LabelName,
  type MimNote,
  type OffDay,
  type Provenance,
  type Routine,
  type RoutineCheck,
} from './types'
import { charCount, newId, nextOrder, now, topOrder } from './util'

/** 手で作った記録の出どころ */
export const USER_PROVENANCE: Provenance = { by: 'user', ai: null, via: null }

const fail = (problems: { message: string }[]) => {
  if (problems.length > 0) throw new DomainError(problems[0].message)
}

// ---------- 項目（6.2・6.3・12.・13.） ----------

export interface ItemInput {
  origin: ItemOrigin
  title: string
  kind?: ItemKind
  start?: string | null
  due?: string | null
  startTime?: string | null
  endTime?: string | null
  listed?: boolean
  locked?: boolean
  label?: string | null
  requester?: string
  memo?: string
}

/**
 * 項目を足す（12.1・12.2・13.2）。list 生まれは listed: true、calendar 生まれは初め false（D38）。区分は無ければ仕事（Q7）。
 * 決まり（6.2〜6.4・12.4）に合わなければ DomainError。戻り値は新しい id
 */
export function addItem(data: AppData, input: ItemInput, at: number = now()): { data: AppData; result: ID } {
  const item: Item = {
    id: newId(),
    v: RECORD_VERSION,
    kind: input.kind ?? 'work',
    title: input.title.trim(),
    origin: input.origin,
    start: input.start ?? null,
    due: input.due ?? null,
    startTime: input.startTime ?? null,
    endTime: input.endTime ?? null,
    listed: input.origin === 'list' ? true : (input.listed ?? false),
    done: false,
    doneAt: null,
    doneOn: null,
    locked: input.locked ?? false,
    label: input.label ?? null,
    requester: (input.requester ?? '').trim(),
    memo: input.memo ?? '',
    order: at,
    ...USER_PROVENANCE,
    createdAt: at,
    updatedAt: at,
  }
  fail(itemProblems(item))
  return transact(data, (tx) => {
    tx.put('items', item)
    return item.id
  })
}

/** 直せる項目（生まれ・id・作った日時・出どころ・並び・完了の3つは直さない。完了は setItemDone） */
export type ItemPatch = Partial<
  Pick<Item, 'kind' | 'title' | 'start' | 'due' | 'startTime' | 'endTime' | 'listed' | 'locked' | 'label' | 'requester' | 'memo'>
>

const PATCH_KEYS: readonly (keyof ItemPatch)[] = [
  'kind',
  'title',
  'start',
  'due',
  'startTime',
  'endTime',
  'listed',
  'locked',
  'label',
  'requester',
  'memo',
]

/** カレンダーに出る期間が1日か（list 生まれで締め切り日の無い物は期間が無いので、1日ではない） */
function isOneDay(item: Item): boolean {
  const p = periodOf(item)
  return p !== null && p.from === p.to
}

export interface UpdateItemResult {
  /** list 生まれの締め切り日を消して listed を true に戻した（「カレンダーから外れたので Task List に戻しました」。6.3） */
  relisted: boolean
}

/**
 * 項目を直す（12.3・13.5）。6.3 の入力の決まり: 開始日を締め切り日より後にしたら締め切り日を開始日にそろえ、締め切り日を開始日より
 * 前にしたら開始日をそろえる（1日の予定になる）。1日の予定で終了時刻が開始時刻と同じなら終了時刻を空に（複数日の予定ではそのまま。
 * 11/9 10:00〜11/11 10:00 の終わりを 24:00 に変えない。D36）、開始時刻を空にしたら終了時刻も消す。
 * list 生まれの締め切り日を消して listed が false なら true に戻す（どこにも出ない項目を作らない）。
 * そろえた結果が決まり（1日の予定で終了 < 開始など）に合わなければ DomainError（その日付にはできない。6.4）。
 * 時刻を入れた時の「翌日までにする」・終了の 00:00 の読み替えは、画面の入力（src/domain/itemInput.ts）で決めてから渡す。
 * patch のうち直せる項目だけを重ねる（生まれ・作った日時・出どころは変えない。ITEMS-005・016）
 */
export function updateItem(
  data: AppData,
  id: ID,
  patch: ItemPatch,
  at: number = now(),
): { data: AppData; result: UpdateItemResult } {
  const cur = data.items[id]
  if (!cur) throw new DomainError('予定が見つかりません。')
  const has = (k: keyof ItemPatch) => patch[k] !== undefined
  const next: Item = { ...cur, updatedAt: at }
  for (const k of PATCH_KEYS) if (has(k)) Object.assign(next, { [k]: patch[k] })
  if (patch.title !== undefined) next.title = patch.title.trim()
  if (patch.requester !== undefined) next.requester = patch.requester.trim()
  if (next.start && next.due && next.start > next.due) {
    if (has('start') && !has('due')) next.due = next.start
    else if (has('due') && !has('start')) next.start = next.due
  }
  if (next.startTime === null) next.endTime = null
  if (next.startTime !== null && next.endTime !== null && next.startTime === next.endTime && isOneDay(next)) {
    next.endTime = null
  }
  let relisted = false
  if (next.origin === 'list' && next.due === null && !next.listed) {
    // 「Task List から外す」は、カレンダーに出ている時だけ選べる（6.3）
    if (!has('due')) throw new DomainError('カレンダーに出ていないタスクは、Task List から外せません。')
    next.listed = true
    relisted = true
  }
  fail(itemProblems(next))
  return transact(data, (tx) => {
    tx.put('items', next)
    return { relisted }
  })
}

/** 日付を動かす前の値（［元に戻す］で戻す物。7.11） */
export interface ItemDates {
  start: string | null
  due: string | null
  endTime: string | null
}

/** ［元に戻す］で戻せない時の文（D25） */
export const UNDO_REFUSED = '元に戻せませんでした（予定が見つからないか、今の内容に合いません）'

/**
 * ウィークリーのドラッグで日を動かす（7.11・13.6）。開始日・締め切り日は渡した値をそのまま書き（updateItem の片側だけのそろえ方は
 * 当てない）、clearEnd の時だけ終了時刻を空にする。ほかの時刻・完了は変えない（完了した予定も動かせる）。
 * 渡す値は src/domain/drag.ts の dropPatch で決める。ロック中・決まりに合わない時は DomainError。戻り値は動かす前の値（［元に戻す］用）
 */
export function moveItemDates(data: AppData, id: ID, p: DatePatch, at: number = now()): { data: AppData; result: ItemDates } {
  const cur = data.items[id]
  if (!cur) throw new DomainError('予定が見つかりません。')
  if (cur.locked) throw new DomainError('ロック中の予定は動かせません。')
  const next: Item = { ...cur, start: p.start, due: p.due, endTime: p.clearEnd ? null : cur.endTime, updatedAt: at }
  // 1日の予定で終了 = 開始になった時は終了時刻を空にする（dropPatch の clearEnd と同じ。D25）
  if (next.startTime !== null && next.startTime === next.endTime && isOneDay(next)) next.endTime = null
  fail(itemProblems(next))
  const prev: ItemDates = { start: cur.start, due: cur.due, endTime: cur.endTime }
  return transact(data, (tx) => {
    tx.put('items', next)
    return prev
  })
}

/**
 * ドラッグの［元に戻す］（7.11・D25）: 開始日・締め切り日・終了時刻だけを動かす前の値に戻す（ほかの項目は今のまま）。予定が無い
 * （ゴミ箱へ移した・消えた）時や、戻すと決まりに合わない時（後から時刻を直して、1日の予定で終了 < 開始になるなど）は UNDO_REFUSED
 */
export function restoreItemDates(data: AppData, id: ID, prev: ItemDates, at: number = now()): AppData {
  const cur = data.items[id]
  if (!cur) throw new DomainError(UNDO_REFUSED)
  if (cur.start === prev.start && cur.due === prev.due && cur.endTime === prev.endTime) return data
  const next: Item = { ...cur, start: prev.start, due: prev.due, endTime: prev.endTime, updatedAt: at }
  if (itemProblems(next).length > 0) throw new DomainError(UNDO_REFUSED)
  return transact(data, (tx) => tx.put('items', next)).data
}

/**
 * 複製する（12.7）。新しい項目に、件名・区分・ラベル・依頼者・開始時刻・終了時刻・ロック・メモと、生まれ（origin）・Task List に出すか
 * （listed）を写す。写さない物: 日付（dates にする）・完了（未完了）・作った日時（今）・by／ai／via（手で作った物）・知らない項目。
 * id は新しく、order は今（ITEMS-014・257・258）。締め切り日の無い list 生まれは listed: true にする（どこにも出ない項目を作らない。
 * AMB-ITEMS-22）。写す時刻で1日の予定の終了 = 開始になる時は終了時刻を空に、終了 < 開始になる日付にはできない（DATE_REFUSED。ITEMS-259）。
 * 件名は data（表示用の記録）の件名を写す。端末の記録の件名が空の予定の複製を端末に空のまま書くのは src/store/actions.ts（D48）。
 * 戻り値は新しい id
 */
export function duplicateItem(
  data: AppData,
  id: ID,
  dates: { start: string | null; due: string | null },
  at: number = now(),
): { data: AppData; result: ID } {
  const src = data.items[id]
  if (!src) throw new DomainError('予定が見つかりません。')
  const item: Item = {
    id: newId(),
    v: RECORD_VERSION,
    kind: src.kind,
    title: src.title.trim(),
    origin: src.origin,
    start: dates.start,
    due: dates.due,
    startTime: src.startTime,
    endTime: src.startTime === null ? null : src.endTime,
    listed: src.origin === 'list' && dates.due === null ? true : src.listed,
    done: false,
    doneAt: null,
    doneOn: null,
    locked: src.locked,
    label: src.label,
    requester: src.requester.trim(),
    memo: src.memo,
    order: at,
    ...USER_PROVENANCE,
    createdAt: at,
    updatedAt: at,
  }
  if (item.startTime !== null && item.endTime !== null && isOneDay(item)) {
    const st = hmToMinutes(item.startTime)
    const et = hmToMinutes(item.endTime)
    if (et < st) throw new DomainError(DATE_REFUSED)
    if (et === st) item.endTime = null
  }
  fail(itemProblems(item))
  return transact(data, (tx) => {
    tx.put('items', item)
    return item.id
  })
}

/** 完了にする・戻す（12.5）。完了は done・doneAt（今）・doneOn（今日）を組で、戻すと3つとも消す */
export function setItemDone(data: AppData, id: ID, done: boolean, at: number = now()): AppData {
  const cur = data.items[id]
  if (!cur) throw new DomainError('予定が見つかりません。')
  if (cur.done === done) return data
  const next: Item = done
    ? { ...cur, done: true, doneAt: at, doneOn: ymdOfMs(at), updatedAt: at }
    : { ...cur, done: false, doneAt: null, doneOn: null, updatedAt: at }
  return transact(data, (tx) => tx.put('items', next)).data
}

// ---------- 休み・ラベルの呼び名（6.5・6.6） ----------

/** 休みを付ける・外す（off を切り替える。記録は消さない。記録が無ければ手で作った物として作る） */
export function setOffDay(data: AppData, date: string, off: boolean, at: number = now()): AppData {
  if (!isYmd(date)) throw new DomainError('日付の形が正しくありません。')
  const cur = data.offDays[date]
  if (cur && cur.off === off) return data
  if (!cur && !off) return data
  const next: OffDay = cur ? { ...cur, off, updatedAt: at } : { id: date, date, off, updatedAt: at, ...USER_PROVENANCE }
  return transact(data, (tx) => tx.put('offDays', next)).data
}

/** ラベルの呼び名を付ける・変える・消す（空にする。記録は消さない。12字まで） */
export function setLabelName(data: AppData, key: string, name: string, at: number = now()): AppData {
  if (!isLabelKey(key)) throw new DomainError('ラベルが見つかりません。')
  const trimmed = name.trim()
  if (charCount(trimmed) > LIMITS.labelName) throw new DomainError(`呼び名は${LIMITS.labelName}字までです。`)
  const cur = data.labelNames[key]
  if ((cur?.name ?? '') === trimmed) return data
  const next: LabelName = cur
    ? { ...cur, name: trimmed, updatedAt: at }
    : { id: key, name: trimmed, updatedAt: at, ...USER_PROVENANCE }
  return transact(data, (tx) => tx.put('labelNames', next)).data
}

// ---------- ルーチン（6.7・14.） ----------

export type RoutineInput = Pick<Routine, 'title' | 'cycle'> &
  Partial<Pick<Routine, 'weekdays' | 'monthDay' | 'yearMonth' | 'yearDay'>>

/** ルーチンを足す（その種類のいちばん下へ。14.2） */
export function addRoutine(data: AppData, input: RoutineInput, at: number = now()): { data: AppData; result: ID } {
  const peers = Object.values(data.routines).filter((r) => r.cycle === input.cycle)
  const routine: Routine = {
    id: newId(),
    v: RECORD_VERSION,
    title: input.title.trim(),
    cycle: input.cycle,
    weekdays: input.weekdays ?? [],
    monthDay: input.monthDay ?? null,
    yearMonth: input.yearMonth ?? null,
    yearDay: input.yearDay ?? null,
    order: nextOrder(peers),
    ...USER_PROVENANCE,
    createdAt: at,
    updatedAt: at,
  }
  fail(routineProblems(routine))
  return transact(data, (tx) => {
    tx.put('routines', routine)
    return routine.id
  })
}

/**
 * ルーチンを直す（件名・種類・指定）。種類を変えた時は、新しい種類に合わない指定を外し、種類が変わったらその種類のいちばん下へ。
 * チェックの記録はそのまま（済みかどうかは新しい決まりで計算し直す。14.2）
 */
export function updateRoutine(
  data: AppData,
  id: ID,
  patch: Partial<Pick<Routine, 'title' | 'cycle' | 'weekdays' | 'monthDay' | 'yearMonth' | 'yearDay'>>,
  at: number = now(),
): AppData {
  const cur = data.routines[id]
  if (!cur) throw new DomainError('ルーチンが見つかりません。')
  const next: Routine = { ...cur, ...patch, updatedAt: at }
  if (patch.title !== undefined) next.title = patch.title.trim()
  if (next.cycle !== 'weekly') next.weekdays = []
  if (next.cycle !== 'monthly') next.monthDay = null
  if (next.cycle !== 'yearly') {
    next.yearMonth = null
    next.yearDay = null
  }
  if (next.cycle !== cur.cycle)
    next.order = nextOrder(Object.values(data.routines).filter((r) => r.id !== id && r.cycle === next.cycle))
  fail(routineProblems(next))
  return transact(data, (tx) => tx.put('routines', next)).data
}

/** ルーチンをチェックする（今日を、その月の記録に足す。記録が無ければ作る。14.3） */
export function checkRoutine(data: AppData, routineId: ID, today: string, at: number = now()): AppData {
  if (!data.routines[routineId]) throw new DomainError('ルーチンが見つかりません。')
  const month = monthOf(today)
  const id = routineCheckId(routineId, month)
  const cur = data.routineChecks[id]
  const dates = checkToday(cur?.dates ?? [], today)
  if (cur && dates.length === cur.dates.length) return data
  const next: RoutineCheck = cur
    ? { ...cur, dates, updatedAt: at }
    : { id, routineId, month, dates, updatedAt: at, ...USER_PROVENANCE }
  return transact(data, (tx) => tx.put('routineChecks', next)).data
}

/** チェックを外す（いちばん新しい戻る日以後の記録を消す。戻る日が前の月なら、その月の記録からも。14.3） */
export function uncheckRoutine(data: AppData, routineId: ID, today: string, at: number = now()): AppData {
  const routine = data.routines[routineId]
  if (!routine) throw new DomainError('ルーチンが見つかりません。')
  const fromMonth = monthOf(latestResetDay(routine, today))
  return transact(data, (tx) => {
    for (const c of tx.all('routineChecks')) {
      if (c.routineId !== routineId || c.month < fromMonth) continue
      const dates = uncheck(c.dates, routine, today)
      if (dates.length !== c.dates.length) tx.put('routineChecks', { ...c, dates, updatedAt: at })
    }
  }).data
}

// ---------- やりたいこと（6.8・15.） ----------

/** やりたいことを足す（いちばん上へ。D40） */
export function addFavorite(data: AppData, text: string, at: number = now()): { data: AppData; result: ID } {
  if (!text.trim()) throw new DomainError('中身を入れてください。')
  const fav: Favorite = {
    id: newId(),
    v: RECORD_VERSION,
    text,
    done: false,
    doneAt: null,
    order: topOrder(Object.values(data.favorites)),
    ...USER_PROVENANCE,
    createdAt: at,
    updatedAt: at,
  }
  return transact(data, (tx) => {
    tx.put('favorites', fav)
    return fav.id
  })
}

/** やりたいことを直す（中身・済み。済みにすると doneAt を今に、外すと null） */
export function updateFavorite(
  data: AppData,
  id: ID,
  patch: Partial<Pick<Favorite, 'text' | 'done'>>,
  at: number = now(),
): AppData {
  const cur = data.favorites[id]
  if (!cur) throw new DomainError('やりたいことが見つかりません。')
  if (patch.text !== undefined && !patch.text.trim()) throw new DomainError('中身を入れてください。')
  const next: Favorite = { ...cur, ...patch, updatedAt: at }
  if (patch.done !== undefined && patch.done !== cur.done) next.doneAt = patch.done ? at : null
  return transact(data, (tx) => tx.put('favorites', next)).data
}

// ---------- MIM（6.9・16.） ----------

/** MIM のメモを足す（いちばん下へ） */
export function addMimNote(
  data: AppData,
  input: Partial<Pick<MimNote, 'title' | 'body'>> = {},
  at: number = now(),
): { data: AppData; result: ID } {
  const title = (input.title ?? '').trim()
  if (charCount(title) > LIMITS.mimTitle) throw new DomainError(`題名は${LIMITS.mimTitle}字までです。`)
  const note: MimNote = {
    id: newId(),
    v: RECORD_VERSION,
    title,
    body: input.body ?? '',
    secrets: [],
    qrs: [],
    order: nextOrder(Object.values(data.mimNotes)),
    ...USER_PROVENANCE,
    createdAt: at,
    updatedAt: at,
  }
  return transact(data, (tx) => {
    tx.put('mimNotes', note)
    return note.id
  })
}

/** MIM のメモを直す（題名・本文・伏せる欄・QR の欄。欄の容量の確かめは画面の入力（段階4の qr.ts）で） */
export function updateMimNote(
  data: AppData,
  id: ID,
  patch: Partial<Pick<MimNote, 'title' | 'body' | 'secrets' | 'qrs'>>,
  at: number = now(),
): AppData {
  const cur = data.mimNotes[id]
  if (!cur) throw new DomainError('メモが見つかりません。')
  const next: MimNote = { ...cur, ...patch, updatedAt: at }
  if (patch.title !== undefined) next.title = patch.title.trim()
  if (charCount(next.title) > LIMITS.mimTitle) throw new DomainError(`題名は${LIMITS.mimTitle}字までです。`)
  for (const s of next.secrets) {
    if (charCount(s.name) > LIMITS.fieldName) throw new DomainError(`欄の名前は${LIMITS.fieldName}字までです。`)
    if (charCount(s.value) > LIMITS.secretValue) throw new DomainError(`欄の値は${LIMITS.secretValue}字までです。`)
  }
  for (const q of next.qrs)
    if (charCount(q.caption) > LIMITS.fieldName) throw new DomainError(`説明は${LIMITS.fieldName}字までです。`)
  return transact(data, (tx) => tx.put('mimNotes', next)).data
}

/** 並べ替え（やりたいこと・ルーチン・MIM）: 並べ直した後の id の順を受け、変わった物だけ order を書き直す */
export function reorder(
  data: AppData,
  table: 'favorites' | 'routines' | 'mimNotes',
  ids: readonly ID[],
  at: number = now(),
): AppData {
  const rows = ids.map((id) => data[table][id]).filter(Boolean)
  const sorted = rows.map((r) => r.order).sort((a, b) => a - b)
  // 今の order の値を並べ直して使う（同じ値が重なっている時は、いちばん小さい値から1ずつ）
  const distinct = new Set(sorted).size === sorted.length
  const orders = distinct ? sorted : sorted.map((_, i) => (sorted[0] ?? 0) + i)
  return transact(data, (tx) => {
    rows.forEach((r, i) => {
      if (r.order !== orders[i]) tx.put(table, { ...r, order: orders[i], updatedAt: at } as AppData[typeof table][string])
    })
  }).data
}
