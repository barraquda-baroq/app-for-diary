// Task List の行をカレンダーへ落とす決まり（docs/SPEC.md の 13.6。ウィークリーのドラッグの 7.11・drag.ts と合わせる。D28）: 掴めるか、
// どの日のどの区分に落とせるか、落とすと何が変わるか、落とした後のお知らせの字。ドラッグの部品（src/features/dnd）はここだけを見て決める。
// 契約の形だけ（S3-STUB）: 名前と形はこれで決まり、中身は段階3の WP1 が入れる。今の関数は「落とせない」を返すだけで、決まりはまだ
// 無い（どの画面もまだ呼ばない）。使わない引数は void で読む（名前を契約のまま残すため）。
// - 区分の違う所へは落とせない（null）。カレンダーに出ていない物: ①は締め切り日を D に、④は締め切り日を D に（開始日が D より後なら
//   開始日も D に）
// - カレンダーに出ている1日の物は 7.11 と同じく丸ごと動かす。今の日（D === from）は 'same'（何もしない）
// - 複数日の物は締め切り日だけ: D が開始日より前は null、D === to は 'same'、D === from は1日の物になる
// - 6.4（drag.ts の fitTimes）: 1日の物で終わりの時刻が始まりより前になる時は null、同じ時刻なら終わりの時刻を消す
import type { DatePatch } from './drag'
import type { Item, ItemKind } from './types'

/** 掴めるか（ロック中は掴めずに揺れる。13.6・7.10） */
export function canGrabTaskRow(item: Item): { ok: true } | { ok: false; reason: 'locked' } {
  void item
  return { ok: true }
}

/** その日・その区分に落とした時に書く日付。null は落とせない、'same' は今の日（何もしない） */
export function listDropPatch(item: Item, target: { date: string; kind: ItemKind }): DatePatch | 'same' | null {
  void item
  void target
  return null
}

/** 見えている日（dates）のうち落とせる日と、そこに落とした時に書く日付（落とせる所の印に使う。区分はその予定の区分） */
export function listDropDays(item: Item, dates: readonly string[]): Map<string, DatePatch | 'same'> {
  void item
  void dates
  return new Map()
}

/**
 * 落とした後のお知らせの字: カレンダー生まれの1日の物を丸ごと動かした時は toastText.moved（「11/12（木）へ移しました」）、
 * ほかは toastText.dueSet（「締め切り日を 11/12（木）にしました」）
 */
export function listDropToast(item: Item, p: DatePatch): string {
  void item
  void p
  return ''
}
