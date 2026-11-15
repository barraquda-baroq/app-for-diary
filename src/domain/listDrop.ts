// Task List の行をカレンダーへ落とす決まり（docs/SPEC.md の 13.6。ウィークリーのドラッグの 7.11・drag.ts と合わせる。開発）: 掴めるか、
// どの日のどの区分に落とせるか、落とすと何が変わるか、落とした後のお知らせの字。ドラッグの部品（src/features/dnd）はここだけを見て決める。
// - 区分の違う所へは落とせない（null）。カレンダーに出ていない物: ①は締め切り日を D に、④は締め切り日を D に（開始日が D より後なら
//   開始日も D に）
// - カレンダーに出ている1日の物は 7.11 と同じく丸ごと動かす。今の日（D === from）は 'same'（何もしない）
// - 複数日の物は締め切り日だけ: D が開始日より前は null、D === to は 'same'、D === from は1日の物になる
// - 6.4（drag.ts の fitTimes）: 1日の物で終わりの時刻が始まりより前になる時は null、同じ時刻なら終わりの時刻を消す
// - ロック中は掴めず（canGrabTaskRow）、落としても null。時刻は変えない（日だけ。開発）。完了した物も動かせる（7.11 と同じ）
// 画面は表示用に直した記録（useData()。6.12）を渡す。日付は 'YYYY-MM-DD' の文字のまま比べる
import { isYmd } from './dates'
import { fitTimes, type DatePatch } from './drag'
import { toastText } from './itemText'
import { periodOf } from './items'
import type { Item, ItemKind } from './types'

/** 掴めるか（ロック中は掴めずに揺れる。13.6・7.10） */
export function canGrabTaskRow(item: Item): { ok: true } | { ok: false; reason: 'locked' } {
  return item.locked ? { ok: false, reason: 'locked' } : { ok: true }
}

/** その日・その区分に落とした時に書く日付。null は落とせない、'same' は今の日（何もしない） */
export function listDropPatch(item: Item, target: { date: string; kind: ItemKind }): DatePatch | 'same' | null {
  const D = target.date
  if (item.locked || target.kind !== item.kind || !isYmd(D)) return null
  const p = periodOf(item)
  // カレンダーに出ていない物（①④）: 締め切り日を D に（④で開始日が D より後なら開始日も D に）
  if (!p) return fitTimes(item, isYmd(item.start) && item.start > D ? D : item.start, D)
  // カレンダーに出ている1日の物: 7.11 の1日の予定のカードと同じく丸ごと動かす（開発）
  if (p.from === p.to) {
    if (D === p.from) return 'same'
    return item.origin === 'list'
      ? fitTimes(item, item.start !== null ? D : null, D)
      : fitTimes(item, D, item.due !== null ? D : null)
  }
  // 複数日の物: 締め切り日だけ（開始日より前の日には落とせない。開始日に落とすと1日の物になる）
  if (D === p.to) return 'same'
  if (D < p.from) return null
  return fitTimes(item, item.start, D)
}

/** 見えている日（dates）のうち落とせる日と、そこに落とした時に書く日付（落とせる所の印に使う。区分はその予定の区分） */
export function listDropDays(item: Item, dates: readonly string[]): Map<string, DatePatch | 'same'> {
  const out = new Map<string, DatePatch | 'same'>()
  for (const date of dates) {
    const r = listDropPatch(item, { date, kind: item.kind })
    if (r !== null) out.set(date, r)
  }
  return out
}

/**
 * 落とした後のお知らせの字: カレンダー生まれの1日の物を丸ごと動かした時は toastText.moved（「11/12（木）へ移しました」）、
 * ほかは toastText.dueSet（「締め切り日を 11/12（木）にしました」）
 */
export function listDropToast(item: Item, p: DatePatch): string {
  const before = periodOf(item)
  if (item.origin !== 'list' && before !== null && before.from === before.to) return toastText.moved(p.start ?? '')
  return toastText.dueSet(p.due ?? '')
}
