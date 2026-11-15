// Task List の操作（docs/SPEC.md の 13.2〜13.5・12.5・12.8・6.3・7.13・3.9）。行・入力欄の部品はここを呼ぶ（記録ごとの React.memo の行に
// 関数を渡さずに済むよう、どれもこのファイルの関数）。どれも今ある操作（src/store/actions.ts）を attempt で呼ぶ。
// - Task List の操作は、元に戻す・やり直すの並びに積まない（ウィークリー・デイリーを横に出している L でも。7.13・TASK-210）:
//   足す・チェック・区分の切り替え・その場の直し・日付のメニュー・［日付を決める］・［Task List から外す］は記録しない。
//   ［削除］は積まないステップ（stack: false）にして、お知らせの［元に戻す］だけで戻す（12.8・TASK-125）
// - お知らせ: 足す・チェック・外すでは出さない（3.9・13.4・TASK-221）。カレンダーに出ていないタスクを消した時の
//   「『件名』を削除しました［元に戻す］」（6秒）と、締め切り日を消して Task List に戻した時の「カレンダーから外れたので Task List に
//   戻しました」（4秒。6.3）、日付にできない時の理由（4秒。6.4）、件名が長すぎる時の理由だけ
// - 目立たせる（4.9・13.2・13.4）: 足した行、チェックで移った行（「済み」を畳んでいる時は「済み n件」の区切り）を 1.2秒
import { toastText } from '../../../domain/itemText'
import { taskDateEdit, taskInputOf, type TaskEntry } from '../../../domain/taskList'
import { LIMITS, type Item } from '../../../domain/types'
import { limitChars } from '../../../domain/itemInput'
import { actions } from '../../../store/actions'
import { getData } from '../../../store/appStore'
import { attempt, notify, notifyError, usePrefs } from '../../../store/uiStore'
import { toggleDone } from '../../calendar/common/parts/DoneToggle'
import { kindOf } from '../../calendar/common/parts/itemLook'
import { deleteItem } from '../../item/deleteItem'
import { flashList, listFlashKey } from '../common/listFlash'

/**
 * 入力欄から足す（13.2）。件名が空・200字を超える・依頼者が 60字を超える時は足さずに理由を知らせて false（字は欄に残る。開発）。
 * 足せたら足した行を目立たせて true（入力欄とチップは呼んだ側が空にする）
 */
export function addTask(entry: TaskEntry): boolean {
  const r = taskInputOf(entry)
  if (!r.ok) {
    notifyError(r.message)
    return false
  }
  const id = attempt(() => actions.addItem(r.input))
  if (id === undefined) return false
  flashList(listFlashKey.row('task', id))
  return true
}

/**
 * チェック（済みにする・外す。12.5・13.4）: 完了にする（doneAt・doneOn）・外す。お知らせは出さず、元に戻すの並びにも積まない。
 * 済みにした時、「済み n件」を畳んでいればその区切りを、開いていれば移った行を目立たせる。外した時は戻った行を目立たせる
 */
export function toggleTaskDone(item: Pick<Item, 'id' | 'title' | 'done'>): void {
  const next = !item.done
  toggleDone(item, false, false)
  if (getData().items[item.id]?.done !== next) return
  const doneCollapsed = usePrefs.getState().collapsed.taskDone
  flashList(next && doneCollapsed ? listFlashKey.done('task') : listFlashKey.row('task', item.id))
}

/** 区分の印を押した: 仕事とプライベートを入れ替えてすぐ保存する（13.3・Q7。カレンダーに出ている物は区分の段も替わる） */
export function toggleTaskKind(item: Pick<Item, 'id' | 'kind'>): void {
  attempt(() => actions.updateItem(item.id, { kind: kindOf(item) === 'work' ? 'private' : 'work' }))
}

/** その場で直した件名を保存する（空は呼ぶ側が戻す。200字まで。13.3・6.2） */
export function saveTaskTitle(id: string, title: string): void {
  attempt(() => actions.updateItem(id, { title: limitChars(title, LIMITS.title) }))
}

/** その場で直した依頼者を保存する（空にすると依頼者を消し、その列を詰める。60字まで。13.3） */
export function saveTaskRequester(id: string, requester: string): void {
  attempt(() => actions.updateItem(id, { requester: limitChars(requester.trim(), LIMITS.requester) }))
}

/**
 * 日付の列のメニュー・［日付を決める］で日付を直す（13.5・6.3・6.4）。そろえ方と断り方は domain の taskDateEdit。
 * 6.4 で断られた時は理由を 4秒知らせて値はそのまま（開発）。Task List 生まれの締め切り日を消して Task List に戻した時は
 * 「カレンダーから外れたので Task List に戻しました」（6.3）。直せた時 true
 */
export function editTaskDates(item: Item, edit: { start?: string | null; due?: string | null }): boolean {
  const r = taskDateEdit(item, edit)
  if (!r.ok) {
    notify(r.message)
    return false
  }
  const done = attempt(() => actions.updateItem(item.id, r.patch))
  if (done === undefined) return false
  if (r.relisted) notify(toastText.relisted)
  return true
}

/** ［Task List から外す］（カレンダーに出ている時だけ出す。外すとカレンダーにだけ残る。6.3・13.5） */
export function unlistTask(item: Pick<Item, 'id'>): void {
  attempt(() => actions.updateItem(item.id, { listed: false }))
}

/**
 * ［削除］（12.8）: カレンダーに出ている物は確かめてから消し（お知らせは出さない）、出ていない物は確かめずに消して
 * 「『件名』を削除しました［元に戻す］」（6秒）。どちらも元に戻すの並びに積まない（stack: false。7.13）
 */
export function removeTask(item: Item, nowMs: number = Date.now()): Promise<boolean> {
  return deleteItem(item, nowMs, { stack: false })
}
