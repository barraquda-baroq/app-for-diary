// 3つのリストの操作の［元に戻す］付きのお知らせ（docs/SPEC.md の 3.9・6.15・7.13・18.2。開発）。リストの操作は元に戻す・やり直すの
// 並びに積まない（ウィークリー・デイリーを出していても。お知らせの［元に戻す］だけで戻す）。
// - notifyTrashUndo: ルーチン・やりたいことを消した・［済みを片付ける］（ゴミ箱の1件）。［元に戻す］でゴミ箱から元の所へ戻す
//   （ルーチンはチェックの記録ごと、済みのやりたいことはまとめて。並びはほかを書き換えない。6.15）。その1件がもうゴミ箱に無い
//   （ほかの端末で戻した・完全に消した）時は戻さず「ほかの所で直されたので戻せません」（7.13）。予定・タスクの表の変わり方を持たない
//   表なので、元に戻すの並び（src/store/undoStore.ts。予定と休みの日だけ）は使わない
// - notifyItemUndo: 予定・タスクの操作（Task List の［削除］など。recordStep(..., { stack: false }) で作ったステップ）。［元に戻す］は
//   年・月の操作のお知らせと同じ確かめで戻す（後で同じ記録に触れた操作が並びにあれば断る。7.13・TASK-212）
// どちらも 6秒（ボタン付き。3.9）。指の端末のお知らせのボタンは指を離した時に効く（src/ui/fingerTap.ts。P9）
import type { UndoStep } from '../../../domain/undo'
import type { ID } from '../../../domain/types'
import { actions } from '../../../store/actions'
import { getData } from '../../../store/appStore'
import { attemptAsync, notify, notifyError } from '../../../store/uiStore'
import { notifyUndoable, UNDO_CONFLICT, UNDO_LABEL } from '../../../store/undoStore'

/** ゴミ箱の1件を［元に戻す］付きで知らせる（押すと restoreFromToast） */
export function notifyTrashUndo(message: string, entryId: ID): void {
  notify(message, { label: UNDO_LABEL, run: () => void restoreFromToast(entryId) })
}

/** お知らせの［元に戻す］: ゴミ箱にまだあれば戻す（戻せた時 true） */
export async function restoreFromToast(entryId: ID): Promise<boolean> {
  if (!getData().trashEntries[entryId]) {
    notifyError(UNDO_CONFLICT)
    return false
  }
  return (await attemptAsync(() => actions.restoreTrashEntry(entryId))) !== undefined
}

/** 予定・タスクの操作を［元に戻す］付きで知らせる（積まなかったステップ。無ければお知らせだけ） */
export function notifyItemUndo(message: string, step: UndoStep | null): void {
  notifyUndoable(message, step)
}
