// ウィークリーのドラッグで日を動かす決まり（docs/SPEC.md の 7.10・7.11・13.6 のうちウィークリーの所）: 掴めるか、どの日に落とせるか、
// 落とすと何が変わるか、動かした後のお知らせの文。ドラッグの部品（src/features/calendar/week/dnd）はここだけを見て決める
// （落とせる日の印・落とした時の actions.moveItemDates・お知らせ）。画面は表示用に直した記録（useData()。6.12）を渡す。
// 日付は 'YYYY-MM-DD' の文字のまま比べる。時刻は変えない（日だけ。D27）。完了した予定も動かせる（開発）。
import { eachDate, hmToMinutes, isYmd } from './dates'
import { toastText } from './itemText'
import { itemProblems, periodOf } from './items'
import type { Item, ItemKind } from './types'

/** 掴む所: 1日の予定のカード・複数日の予定の始点のカード・終点の●（S の4本目からの「● 件名」の行も終点と同じ。D41） */
export type Handle = 'card' | 'start' | 'end'

/** 見ている週（日曜〜土曜。両端を含む） */
export interface WeekCtx {
  from: string
  to: string
}

/** 落とした時に書く日付（開始日・締め切り日は両方とも、変えない側も今の値で入れる）。clearEnd は終了時刻を空にする（1日の予定で終了 = 開始） */
export interface DatePatch {
  start: string | null
  due: string | null
  clearEnd: boolean
}

export type GrabCheck = { ok: true } | { ok: false; reason: 'locked' | 'hiddenEndpoint' }

const inWeek = (date: string, week: WeekCtx) => week.from <= date && date <= week.to

/**
 * 掴めるか（7.10・7.11）。掴む所がその週に見えていない時（始点がその週に無い予定の始点・終点が無い予定の終点、受けた表示・端の矢印、
 * 1日の予定でない物のカードなど）は hiddenEndpoint（掴めない。揺らさない。CALENDAR-176・177）。見えていてロック中なら locked
 * （持ち上がらずに揺れる。CALENDAR-150）
 */
export function canGrab(item: Item, handle: Handle, week: WeekCtx): GrabCheck {
  const p = periodOf(item)
  const multi = p !== null && p.from < p.to
  const shown =
    p !== null && (handle === 'card' ? !multi && inWeek(p.from, week) : multi && inWeek(handle === 'start' ? p.from : p.to, week))
  if (!shown) return { ok: false, reason: 'hiddenEndpoint' }
  if (item.locked) return { ok: false, reason: 'locked' }
  return { ok: true }
}

/** 落とした後の時刻の決まり（6.4）: 1日の予定で終了 < 開始になる日には落とせない（null）。終了 = 開始になる時は終了時刻を空にする */
function fitTimes(item: Item, start: string | null, due: string | null): DatePatch | null {
  const next: Item = { ...item, start, due }
  const p = periodOf(next)
  let clearEnd = false
  if (p && p.from === p.to && item.startTime !== null && item.endTime !== null) {
    const st = hmToMinutes(item.startTime)
    const et = hmToMinutes(item.endTime)
    if (et < st) return null
    if (et === st) clearEnd = true
  }
  if (clearEnd) next.endTime = null
  const bad = itemProblems(next).some((x) => x.code === 'startAfterDue' || x.code === 'endBeforeStart')
  return bad ? null : { start, due, clearEnd }
}

/**
 * 日 D（target.date）・区分の段（target.kind）に落とした時（7.11 の表・13.6）:
 * - 1日の予定（calendar 生まれ）のカード: start = D（due があれば due = D も。null なら null のまま）（CALENDAR-168）
 * - 1日の予定（list 生まれ・〆）のカード: due = D（start があれば start = D も）（CALENDAR-169・ITEMS-270）
 * - 複数日の始点のカード: D ≤ 締め切り日 なら start = D だけ（D = 締め切り日なら1日の予定になる。CALENDAR-170）
 * - 複数日の終点の●: D ≥ 開始日 なら due = D だけ（CALENDAR-171）
 * 元の日（カード・始点は開始日、終点は締め切り日）に落とした時は 'same'（何もしない。並べ替えもしない。D25）。
 * 落とせない時は null: 掴めない（canGrab）・違う区分の段・週の外・開始日 > 締め切り日・1日の予定で終了 < 開始（例 11/10 23:00〜
 * 11/11 01:00 の始点を 11/11 へ）（CALENDAR-165・175・177）。1日の予定で終了 = 開始になる時は clearEnd（D25）
 */
export function dropPatch(
  item: Item,
  handle: Handle,
  target: { date: string; kind: ItemKind },
  week: WeekCtx,
): DatePatch | 'same' | null {
  if (!canGrab(item, handle, week).ok) return null
  const D = target.date
  if (target.kind !== item.kind || !isYmd(D) || !inWeek(D, week)) return null
  const p = periodOf(item)!
  if (handle === 'card') {
    if (D === p.from) return 'same'
    return item.origin === 'list'
      ? fitTimes(item, item.start !== null ? D : null, D)
      : fitTimes(item, D, item.due !== null ? D : null)
  }
  if (handle === 'start') {
    if (D === p.from) return 'same'
    if (D > p.to) return null
    return fitTimes(item, D, item.due)
  }
  if (D === p.to) return 'same'
  if (D < p.from) return null
  return fitTimes(item, item.start, D)
}

/**
 * 掴んだ時に、その週の落とせる日をすべて（日付の順。元の日は 'same'。D25: 落とせる日すべてに印を付ける）。区分は掴んだ物と同じ段だけ
 * （CALENDAR-184 の「ドラッグで動かせる日」）
 */
export function dropDays(item: Item, handle: Handle, week: WeekCtx): Map<string, DatePatch | 'same'> {
  const out = new Map<string, DatePatch | 'same'>()
  if (!isYmd(week.from) || !isYmd(week.to)) return out
  for (const date of eachDate(week.from, week.to)) {
    const r = dropPatch(item, handle, { date, kind: item.kind }, week)
    if (r !== null) out.set(date, r)
  }
  return out
}

/**
 * 動かした後のお知らせの文（6秒・［元に戻す］は画面が付ける。7.11・CALENDAR-179・ITEMS-270）: 1日の予定は「11/12（木）へ移しました」、
 * 始点は「開始日を 11/10（火）にしました」、終点と list 生まれの〆のカードは「締め切り日を 11/14（土）にしました」
 */
export function dropToast(item: Item, handle: Handle, p: DatePatch): string {
  if (handle === 'start') return toastText.startSet(p.start ?? '')
  if (handle === 'end' || item.origin === 'list') return toastText.dueSet(p.due ?? '')
  return toastText.moved(p.start ?? '')
}
