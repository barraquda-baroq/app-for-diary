// Favorite List の操作（docs/SPEC.md の 15.・6.8・6.15・7.13・3.9）: 足す・済みにする／外す・中身を直す・削除・［済みを片付ける］・
// ［Task List へ移す］。どれも store の actions を attempt・attemptAsync で包んで呼ぶ（決まりに合わない時はお知らせ。2.9）。
// 元に戻す・やり直すの並び（src/store/undoStore.ts）には積まない（3つのリストの操作は、お知らせの［元に戻す］だけで戻す。7.13）。
// - 中身は前後の空白（空の行も）を落として保存する。中の改行はそのまま。空・空白だけは足さない・保存しない（開発）
// - 済みにする・外すはお知らせを出さない（3.9）。削除と［済みを片付ける］は確かめずにゴミ箱へ移し、［元に戻す］付きのお知らせ（6秒。
//   common/listToasts の notifyTrashUndo。もうゴミ箱に無ければ「ほかの所で直されたので戻せません」）
// - ［Task List へ移す］（moveFavoriteToTask）: 先にタスクを足し（最初の空でない行を 200字までの件名に、あふれた分と2行目からを
//   メモに。list 生まれ・仕事・Task List に出す。済みにはしない。src/domain/favoriteList.ts の favoriteToTask）、足せてから
//   やりたいことをゴミ箱へ移す（先に足すので、途中で失敗しても中身は消えない。ゴミ箱へ移せなかった時は、足したタスクを残して
//   失敗を知らせる）。「Task List へ移しました［元に戻す］」（6秒）。［元に戻す］（undoMoveToTask）は、足したタスクがそのままで、
//   やりたいことがまだゴミ箱にある時だけ、タスクをゴミ箱へ移して、やりたいことを元の所へ戻す。タスクがほかの所で直されていた・
//   やりたいことがもうゴミ箱に無い時は、どちらも戻さずに「ほかの所で直されたので戻せません」（7.13）
import { favoriteToTask } from '../../../domain/favoriteList'
import { toastText } from '../../../domain/itemText'
import { name20 } from '../../../domain/listText'
import { taskInputOf } from '../../../domain/taskList'
import type { Favorite, ID, Item } from '../../../domain/types'
import { itemPrint } from '../../../domain/undo'
import { actions } from '../../../store/actions'
import { getData } from '../../../store/appStore'
import { attempt, attemptAsync, notify, notifyError } from '../../../store/uiStore'
import { UNDO_CONFLICT, UNDO_LABEL } from '../../../store/undoStore'
import { flashList, listFlashKey } from '../common/listFlash'
import { notifyTrashUndo } from '../common/listToasts'

/** 中身を直す欄（行のその場の直し・［詳しく］のパネル）の保存を待つ長さ（止まってから 0.6秒。15.2） */
export const FAVORITE_AUTOSAVE_MS = 600

/** やりたいことを足す（いちばん上へ。前後の空白を落とす）。足せたら id（空・空白だけは足さずに undefined） */
export function addFavoriteFrom(text: string): ID | undefined {
  const t = text.trim()
  if (!t) return undefined
  return attempt(() => actions.addFavorite(t))
}

/** 済みにする・外す（お知らせは出さない。済みにした時は doneAt を今に。6.8） */
export function setFavoriteDone(id: ID, done: boolean): boolean {
  return (
    attempt(() => {
      actions.updateFavorite(id, { done })
      return true
    }) === true
  )
}

/**
 * 中身を直す（前後の空白を落とす。今と同じなら書かない）。直せた・書かなくてよかった時 true。空・空白だけは保存せずに false
 * （呼んだ側が保存してある中身に戻す）
 */
export function saveFavoriteText(favorite: Pick<Favorite, 'id' | 'text'>, text: string): boolean {
  const t = text.trim()
  if (!t) return false
  if (t === favorite.text) return true
  return (
    attempt(() => {
      actions.updateFavorite(favorite.id, { text: t })
      return true
    }) === true
  )
}

/** 削除（確かめずにゴミ箱へ）。「『1行目』を削除しました［元に戻す］」（名前は20字まで）。消せたら true */
export async function deleteFavorite(favorite: Pick<Favorite, 'id' | 'text'>): Promise<boolean> {
  const entryId = await attemptAsync(() => actions.trashFavorite(favorite.id))
  if (entryId === undefined) return false
  notifyTrashUndo(toastText.deleted(name20(favorite.text)), entryId)
  return true
}

/** ［済みを片付ける］: 済みの物をまとめてゴミ箱の1件へ。「済みの n件をゴミ箱へ移しました［元に戻す］」。移せたら true */
export async function clearDoneFavorites(): Promise<boolean> {
  const r = await attemptAsync(() => actions.trashDoneFavorites())
  if (r === undefined) return false
  notifyTrashUndo(toastText.clearedDone(r.count), r.entryId)
  return true
}

/** ［Task List へ移す］で覚えておく物（［元に戻す］で使う） */
export interface MovedToTask {
  /** 足したタスク（足した時の記録。［元に戻す］の時にこのままか比べる） */
  task: Item
  /** やりたいことを入れたゴミ箱の1件 */
  entryId: ID
  /** 元のやりたいことの id（戻した時に目立たせる） */
  favoriteId: ID
}

/** ［Task List へ移す］（上の決まり）。移せたら覚えておく物（足せなかった・ゴミ箱へ移せなかった時は null） */
export async function moveFavoriteToTask(favorite: Pick<Favorite, 'id' | 'text'>): Promise<MovedToTask | null> {
  const r = taskInputOf(favoriteToTask(favorite.text))
  if (!r.ok) {
    notifyError(r.message)
    return null
  }
  const taskId = attempt(() => actions.addItem(r.input))
  if (taskId === undefined) return null
  const task = getData().items[taskId]
  const entryId = await attemptAsync(() => actions.trashFavorite(favorite.id))
  if (entryId === undefined || !task) return null
  const moved: MovedToTask = { task, entryId, favoriteId: favorite.id }
  notify(toastText.movedToTask, { label: UNDO_LABEL, run: () => void undoMoveToTask(moved) })
  flashList(listFlashKey.row('task', taskId))
  return moved
}

/** ［Task List へ移す］の［元に戻す］（上の決まり）。戻せたら true */
export async function undoMoveToTask(moved: MovedToTask): Promise<boolean> {
  const data = getData()
  const cur = data.items[moved.task.id]
  if (!cur || itemPrint(cur) !== itemPrint(moved.task) || !data.trashEntries[moved.entryId]) {
    notifyError(UNDO_CONFLICT)
    return false
  }
  const taskEntry = await attemptAsync(() => actions.trashItem(moved.task.id))
  if (taskEntry === undefined) return false
  const back = await attemptAsync(async () => {
    await actions.restoreTrashEntry(moved.entryId)
    return true
  })
  if (back !== true) {
    // やりたいことを戻せなかった時は、タスクも元に戻す（どちらも消えたままにしない）
    await attemptAsync(() => actions.restoreTrashEntry(taskEntry))
    return false
  }
  flashList(listFlashKey.row('favorite', moved.favoriteId))
  return true
}
