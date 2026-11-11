// 予定・タスクを消す（docs/SPEC.md の 12.8・6.15・3.9。D13・D46・AMB-ITEMS-23・24）。詳細の「…」→［削除］から呼ぶ。
// - カレンダーに出ている項目は確かめてから消す: 題「『件名』を削除しますか？」、文「ゴミ箱に移します。30日後に完全に削除されます
//   （それまではゴミ箱から元に戻せます）。Task List からも消えます。」（Task List に出ていない時（isInTaskList。済んで 7日を過ぎた物も
//   出ていない）は最後の1文を出さない）。確かめて消した物はお知らせを出さない（ゴミ箱の画面は段階5）
// - カレンダーに出ていないタスク（Task List だけ）は確かめずに消し、「『件名』を削除しました［元に戻す］」（6秒）。［元に戻す］でゴミ箱から戻す
// どちらもゴミ箱へ移す（カレンダーと Task List の両方から消え、戻すと両方に戻る。同じ1件）。消せた時 true（確かめで［やめる］・失敗は false）
import { isInTaskList, isOnCalendar } from '../../domain/items'
import { toastText } from '../../domain/itemText'
import { trashNotice } from '../../domain/trash'
import type { Item } from '../../domain/types'
import { actions } from '../../store/actions'
import { attemptAsync, notify } from '../../store/uiStore'
import { confirmDialog } from '../../ui/dialogs'
import { UNDO_LABEL } from '../calendar/common/parts/DoneToggle'
import { displayTitle } from '../calendar/common/parts/itemLook'

/** Task List にも出ている時に、確かめの文の終わりに足す1文（12.8・ITEMS-263・264） */
export const IN_TASK_LIST_NOTE = 'Task List からも消えます。'

/** 確かめの題と文（カレンダーに出ている項目） */
export function deleteConfirmText(item: Pick<Item, 'title' | 'listed' | 'done' | 'doneAt'>, nowMs: number) {
  return {
    title: `『${displayTitle(item)}』を削除しますか？`,
    message: trashNotice() + (isInTaskList(item, nowMs) ? IN_TASK_LIST_NOTE : ''),
  }
}

export async function deleteItem(item: Item, nowMs: number = Date.now()): Promise<boolean> {
  if (isOnCalendar(item)) {
    const ok = await confirmDialog({
      ...deleteConfirmText(item, nowMs),
      confirmLabel: '削除',
      cancelLabel: 'やめる',
      danger: true,
    })
    if (!ok) return false
    return (await attemptAsync(() => actions.trashItem(item.id))) !== undefined
  }
  const entry = await attemptAsync(() => actions.trashItem(item.id))
  if (entry === undefined) return false
  notify(toastText.deleted(displayTitle(item)), {
    label: UNDO_LABEL,
    run: () => {
      void attemptAsync(() => actions.restoreTrashEntry(entry))
    },
  })
  return true
}
