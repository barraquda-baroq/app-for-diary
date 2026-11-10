// 項目（予定・タスク）の計算（docs/SPEC.md の 6.2〜6.4・7.6・6.11・12.4・13.1）: カレンダーに出る期間・Task List に出るか・
// マンスリーの数え方・決まりに合わない所・月の束に入れる月。画面・受け取り箱（19.5）・修復（6.12）・月の束（src/sync/packs.ts）が使う。
import { addDaysYmd, daysInMonth, hmToMinutes, isHm, isYmd, monthOf, pad2, ymdOfMs } from './dates'
import { isLabelKey } from './labels'
import { ITEM_KINDS, ITEM_ORIGINS, LIMITS, type Item, type ItemKind } from './types'
import { DAY_MS, charCount } from './util'

/** カレンダーに出る範囲（from〜to。どちらも含む 'YYYY-MM-DD'） */
export interface Period {
  from: string
  to: string
}

type Dated = Pick<Item, 'origin' | 'start' | 'due'>

/**
 * カレンダーに出る期間（6.3）。カレンダーに出ない物（list 生まれで締め切り日の無い物）は null。形の正しくない日付は無いものとみなす。
 * - calendar 生まれ: from = start、to = due ?? start（締め切り日が空ならその日1日）。start が無ければ due から（6.12 の修復と同じ）。
 *   start > due の時は start の1日（6.12 の修復の due = start と同じ）
 * - list 生まれ（due がある時だけ）: from = (start があり start ≤ due) ? start : due、to = due
 */
export function periodOf(item: Dated): Period | null {
  const start = isYmd(item.start) ? item.start : null
  const due = isYmd(item.due) ? item.due : null
  if (item.origin === 'list') {
    if (!due) return null
    return { from: start && start <= due ? start : due, to: due }
  }
  const from = start ?? due
  if (!from) return null
  const to = due && due >= from ? due : from
  return { from, to }
}

/** カレンダーに出るか（calendar 生まれか、締め切り日がある時。ゴミ箱の物は data.items に無いので出ない。6.3） */
export function isOnCalendar(item: Dated): boolean {
  return periodOf(item) !== null
}

/** 複数日の予定か（from < to） */
export function isMultiDay(item: Dated): boolean {
  const p = periodOf(item)
  return p !== null && p.from < p.to
}

/** 「〆」の印を付けるか（list 生まれでカレンダーに出ている物。6.3） */
export function hasDueMark(item: Dated): boolean {
  return item.origin === 'list' && isOnCalendar(item)
}

/** 済んでから Task List に出なくなるまで（7日 = 168時間。13.4） */
export const TASK_DONE_VISIBLE_MS = 7 * DAY_MS

/**
 * Task List に出るか（6.3・13.1）: listed が true で、「済んでから 7日を過ぎた物」（done で doneAt が今から 7日（168時間）より前）でない物。
 * ちょうど 168時間の時はまだ出る。ゴミ箱の物は data.items に無いので出ない
 */
export function isInTaskList(item: Pick<Item, 'listed' | 'done' | 'doneAt'>, nowMs: number): boolean {
  if (!item.listed) return false
  if (item.done && typeof item.doneAt === 'number' && nowMs - item.doneAt > TASK_DONE_VISIBLE_MS) return false
  return true
}

// ---------- 数え方（7.6） ----------

type Countable = Dated & Pick<Item, 'kind' | 'done'>

/** その日 d・区分 k の数（カレンダーに出ていて、完了していない、区分が k の、期間 from ≤ d ≤ to の項目。休みの日も数える） */
export function countOn(items: Iterable<Countable>, date: string, kind: ItemKind): number {
  let n = 0
  for (const it of items) {
    if (it.done || it.kind !== kind) continue
    const p = periodOf(it)
    if (p && p.from <= date && date <= p.to) n++
  }
  return n
}

export type DayCounts = Record<ItemKind, number>

/** その月の日ごと・区分ごとの数（'YYYY-MM-DD' → { work, private }。複数日の予定は期間中の毎日に数える。7.6） */
export function monthCounts(items: Iterable<Countable>, y: number, m: number): Record<string, DayCounts> {
  const out: Record<string, DayCounts> = {}
  const first = `${String(y).padStart(4, '0')}-${pad2(m)}-01`
  const last = `${String(y).padStart(4, '0')}-${pad2(m)}-${pad2(daysInMonth(y, m))}`
  for (let d = first; d <= last; d = addDaysYmd(d, 1)) out[d] = { work: 0, private: 0 }
  for (const it of items) {
    if (it.done || !ITEM_KINDS.includes(it.kind)) continue
    const p = periodOf(it)
    if (!p || p.to < first || p.from > last) continue
    const from = p.from < first ? first : p.from
    const to = p.to > last ? last : p.to
    for (let d = from; d <= to; d = addDaysYmd(d, 1)) out[d][it.kind]++
  }
  return out
}

/** マスの数字の出し方（100 以上は「99+」。7.6） */
export function formatCount(n: number): string {
  return n >= 100 ? '99+' : String(n)
}

// ---------- 決まり（6.2〜6.4・12.4） ----------

export type ItemProblemCode =
  | 'kind'
  | 'origin'
  | 'title'
  | 'requester'
  | 'memo'
  | 'label'
  | 'flags'
  | 'start'
  | 'due'
  | 'startRequired'
  | 'startTime'
  | 'endTime'
  | 'endWithoutStart'
  | 'endMidnight'
  | 'startAfterDue'
  | 'endBeforeStart'
  | 'nowhere'

/** 決まりに合わない所（fields はその決まりに関わる項目。受け取り箱は、直す項目に関わる物だけで断る。src/domain/inbox.ts） */
export interface ItemProblem {
  code: ItemProblemCode
  fields: readonly string[]
  message: string
}

const P = (code: ItemProblemCode, fields: readonly string[], message: string): ItemProblem => ({ code, fields, message })

/**
 * 項目が 6.2〜6.4・12.4 の決まりに合わない所（無ければ空）。受け取り箱の「当てた後が決まりに合わない」（19.5）と、
 * 手の操作の確かめ（src/domain/ops.ts）に使う。画面の入力のような自動の直し（そろえる・翌日にする）はしない
 */
export function itemProblems(item: Item): ItemProblem[] {
  const out: ItemProblem[] = []
  if (!ITEM_KINDS.includes(item.kind)) out.push(P('kind', ['kind'], '区分は仕事かプライベートにしてください'))
  if (!ITEM_ORIGINS.includes(item.origin)) out.push(P('origin', ['origin'], '生まれが正しくありません'))
  if (typeof item.title !== 'string' || charCount(item.title) < 1 || charCount(item.title) > LIMITS.title) {
    out.push(P('title', ['title'], `件名は1〜${LIMITS.title}字で入れてください`))
  }
  if (typeof item.requester !== 'string' || charCount(item.requester) > LIMITS.requester) {
    out.push(P('requester', ['requester'], `依頼者は${LIMITS.requester}字までです`))
  }
  if (typeof item.memo !== 'string') out.push(P('memo', ['memo'], 'メモの形が正しくありません'))
  if (item.label !== null && !isLabelKey(item.label)) out.push(P('label', ['label'], 'ラベルが見つかりません'))
  for (const f of ['listed', 'done', 'locked'] as const) {
    if (typeof item[f] !== 'boolean') out.push(P('flags', [f], `${f} の形が正しくありません`))
  }
  const startOk = item.start === null || isYmd(item.start)
  const dueOk = item.due === null || isYmd(item.due)
  if (!startOk) out.push(P('start', ['start'], '開始日の形が正しくありません'))
  if (!dueOk) out.push(P('due', ['due'], '締め切り日の形が正しくありません'))
  if (item.origin === 'calendar' && item.start === null)
    out.push(P('startRequired', ['start'], 'カレンダーの予定には開始日が要ります'))
  const stOk = item.startTime === null || isHm(item.startTime)
  const etOk = item.endTime === null || isHm(item.endTime, true)
  if (!stOk) out.push(P('startTime', ['startTime'], '開始時刻の形が正しくありません（00:00〜23:59）'))
  if (!etOk) out.push(P('endTime', ['endTime'], '終了時刻の形が正しくありません（00:01〜24:00）'))
  if (item.endTime !== null && item.startTime === null) {
    out.push(P('endWithoutStart', ['startTime', 'endTime'], '開始時刻の無い終了時刻は入れられません'))
  }
  if (item.endTime === '00:00') out.push(P('endMidnight', ['endTime'], '終わりの 0時は 24:00 で入れてください'))
  if (startOk && dueOk && item.start !== null && item.due !== null && item.start > item.due) {
    out.push(P('startAfterDue', ['start', 'due'], '開始日が締め切り日より後になります'))
  }
  if (startOk && dueOk && stOk && etOk && item.startTime !== null && item.endTime !== null && item.endTime !== '00:00') {
    const p = periodOf(item)
    if (p && p.from === p.to && hmToMinutes(item.endTime) <= hmToMinutes(item.startTime)) {
      out.push(
        P('endBeforeStart', ['start', 'due', 'startTime', 'endTime'], '1日の予定で、終わりの時刻が始まりより早いか同じです'),
      )
    }
  }
  if (item.origin === 'list' && item.due === null && item.listed === false) {
    out.push(P('nowhere', ['listed', 'due'], 'カレンダーにも Task List にも出なくなります'))
  }
  return out
}

// ---------- 月の束（6.11） ----------

/**
 * 項目の月（月の束に入れる月。'YYYY-MM'）: カレンダーに出ている物は to の月、出ていない物は doneOn（無ければ createdAt の暦の日付）の月
 */
export function itemPackMonth(item: Pick<Item, 'origin' | 'start' | 'due' | 'doneOn' | 'createdAt'>): string {
  const p = periodOf(item)
  if (p) return monthOf(p.to)
  if (isYmd(item.doneOn)) return monthOf(item.doneOn)
  return monthOf(ymdOfMs(typeof item.createdAt === 'number' && Number.isFinite(item.createdAt) ? item.createdAt : 0))
}
