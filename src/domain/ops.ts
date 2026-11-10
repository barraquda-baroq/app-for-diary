// 手の操作（足す・直す・完了・休み・呼び名・チェック）の純粋な関数（docs/SPEC.md の 6.2〜6.9・12.・13.〜16.）。
// 画面は store/actions から attempt(() => actions.xxx(...)) で呼ぶ。作る時は by: 'user'・ai: null・via: null・v: 1、直す時は updatedAt。
// 作った時の by・ai・via は直しても変えない（Claude が足した記録を作者が直しても 'connector' のまま。6.1）。消す操作は src/domain/trash.ts。
// NS の src/domain/entityOps.ts の書き方（transact・DomainError・updatedAt の付け方）だけを借りた。
import { isYmd, monthOf, ymdOfMs } from './dates'
import { routineCheckId } from './derivedId'
import { itemProblems } from './items'
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

export interface UpdateItemResult {
  /** list 生まれの締め切り日を消して listed を true に戻した（「カレンダーから外れたので Task List に戻しました」。6.3） */
  relisted: boolean
}

/**
 * 項目を直す（12.3・13.5）。6.3 の入力の決まり: 開始日を締め切り日より後にしたら締め切り日を開始日にそろえ、締め切り日を開始日より
 * 前にしたら開始日をそろえる（1日の予定になる）。終了時刻が開始時刻と同じなら終了時刻を空に、開始時刻を空にしたら終了時刻も消す。
 * list 生まれの締め切り日を消して listed が false なら true に戻す（どこにも出ない項目を作らない）。
 * そろえた結果が決まり（1日の予定で終了 < 開始など）に合わなければ DomainError（その日付にはできない。6.4）。
 * 時刻を入れた時の「翌日までにする」は画面の入力（段階2）で決めてから渡す
 */
export function updateItem(
  data: AppData,
  id: ID,
  patch: ItemPatch,
  at: number = now(),
): { data: AppData; result: UpdateItemResult } {
  const cur = data.items[id]
  if (!cur) throw new DomainError('予定が見つかりません。')
  const next: Item = { ...cur, ...patch, updatedAt: at }
  if (patch.title !== undefined) next.title = patch.title.trim()
  if (patch.requester !== undefined) next.requester = patch.requester.trim()
  if (next.start && next.due && next.start > next.due) {
    if ('start' in patch && !('due' in patch)) next.due = next.start
    else if ('due' in patch && !('start' in patch)) next.start = next.due
  }
  if (next.startTime === null) next.endTime = null
  if (next.startTime !== null && next.endTime !== null && next.startTime === next.endTime) next.endTime = null
  let relisted = false
  if (next.origin === 'list' && next.due === null && !next.listed) {
    // 「Task List から外す」は、カレンダーに出ている時だけ選べる（6.3）
    if (!('due' in patch)) throw new DomainError('カレンダーに出ていないタスクは、Task List から外せません。')
    next.listed = true
    relisted = true
  }
  fail(itemProblems(next))
  return transact(data, (tx) => {
    tx.put('items', next)
    return { relisted }
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
