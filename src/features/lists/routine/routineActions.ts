// Routine List の操作（docs/SPEC.md の 14.・6.7・6.15・7.13）: 足す・チェックする・外す・件名と種類と指定を直す・削除（［元に戻す］付き）。
// どれも store の actions を attempt で包んで呼ぶ（決まりに合わない時はお知らせ。2.9）。元に戻す・やり直すの並びには積まない（7.13。
// 削除のお知らせの［元に戻す］だけがゴミ箱から戻す。common/listToasts）。チェック・外すではお知らせを出さない（3.9）。
// チェックの日は押した時の端末の暦の今日（todayStr。0時を過ぎた直後で画面の今日がまだ前の日でも、記録するのは今の日。14.3・6.4）
import type { RoutineRowView, SpecDraft } from '../../../domain/routineList'
import { specForCycle } from '../../../domain/routineList'
import { name20 } from '../../../domain/listText'
import { todayStr } from '../../../domain/dates'
import { toastText } from '../../../domain/itemText'
import type { ID, Routine, RoutineCycle } from '../../../domain/types'
import { actions } from '../../../store/actions'
import { attempt, attemptAsync } from '../../../store/uiStore'
import { notifyTrashUndo } from '../common/listToasts'

/** ［指定］で何も選んでいない時 */
export const EMPTY_SPEC: SpecDraft = { weekdays: [], monthDay: null, yearMonth: null, yearDay: null }

/**
 * 足す・保存する指定（種類に合う物だけ。毎年の月と日の片方だけを選んだ途中の物は、指定なしにする。［指定］のボタンも、両方を選ぶ
 * までは「指定」と出しているので、見えている物と同じ）
 */
export function completeSpec(cycle: RoutineCycle, draft: SpecDraft): SpecDraft {
  const s = specForCycle(cycle, draft)
  if (cycle === 'yearly' && (s.yearMonth === null || s.yearDay === null)) return { ...s, yearMonth: null, yearDay: null }
  return s
}

/** ルーチンを足す（その種類のいちばん下へ。件名は前後の空白を落とす。1〜200字でない時はお知らせして足さない）。足せたら id */
export function addRoutineFrom(text: string, cycle: RoutineCycle, spec: SpecDraft): ID | undefined {
  return attempt(() => actions.addRoutine({ title: text.trim(), cycle, ...completeSpec(cycle, spec) }))
}

/**
 * 行の点線の丸を押した: 済んだ行は外し、まだの行はチェックする。済んでいるかは画面の行（row.done）で分ける: 今日より前のチェックで
 * 済んでいる行（毎週の月曜のチェックで、水曜にも済み）を押した時にチェックし直さず（今日を書き足さない。S3-ROUTINE-043）、外す
 */
export function toggleRoutineCheck(row: Pick<RoutineRowView, 'id' | 'done'>): void {
  const today = todayStr()
  if (row.done) attempt(() => actions.uncheckRoutine(row.id, today))
  else attempt(() => actions.checkRoutine(row.id, today))
}

/** 件名を直す（前後の空白を落とす。今と同じなら書かない）。直せたら true（1〜200字でない時はお知らせして false） */
export function renameRoutine(routine: Pick<Routine, 'id' | 'title'>, title: string): boolean {
  const t = title.trim()
  if (t === routine.title) return true
  return updateRoutineWith(routine.id, { title: t })
}

/** 件名・種類・指定を直す（種類を替えると、合わない指定を外して新しい種類のいちばん下へ。チェックの記録はそのまま。14.2）。直せたら true */
export function updateRoutineWith(id: ID, patch: Parameters<typeof actions.updateRoutine>[1]): boolean {
  return (
    attempt(() => {
      actions.updateRoutine(id, patch)
      return true
    }) === true
  )
}

/**
 * 削除（確かめずにゴミ箱へ。チェックの記録もいっしょに。14.2・6.15）。「『件名』を削除しました［元に戻す］」（6秒。件名は20字まで）。
 * 消せたら true
 */
export async function deleteRoutine(routine: Pick<Routine, 'id' | 'title'>): Promise<boolean> {
  const entryId = await attemptAsync(() => actions.trashRoutine(routine.id))
  if (entryId === undefined) return false
  notifyTrashUndo(toastText.deleted(name20(routine.title)), entryId)
  return true
}
