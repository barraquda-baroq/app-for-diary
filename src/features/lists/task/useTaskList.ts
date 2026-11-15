// Task List の中身（docs/SPEC.md の 13.）を記録から作るフック: 表示用に直した予定（useApp の data.items。useData() と同じ記録。6.12）・
// 今日・今から src/domain/taskList.ts の taskListView を作る。予定の表・today・nowMs が同じ間は作り直さない（ほかの表が替わっても）。
// 作り直しても、行に出す物が前と同じ行は前と同じ物を返し（common/stableRows。行は記録ごとの React.memo）、行が1つも替わらなければ
// 中身も前と同じ物を返す（1分ごとの今の時刻で作り直しても、済んで 168時間たった行が無ければ描き直さない）。
// today は Task List の中身の部品が1つの useToday() から渡す（掴んでいる間はその日のまま。開発）。nowMs は useNow(60秒)（168時間で隠す）
import { useMemo } from 'react'
import { taskListView, type TaskListView, type TaskRowView } from '../../../domain/taskList'
import type { AppData, Item } from '../../../domain/types'
import { useApp } from '../../../store/appStore'
import { keep } from '../common/stableRows'

/** 記録ごとの前の行（記録が替われば新しい行になり、古い物はこの表からも消える） */
const rowOf = new WeakMap<Item, TaskRowView>()
/** 予定の表ごとの前の中身（同じ表で今の時刻だけ進んだ時に、前と同じ物を返す） */
const viewOf = new WeakMap<AppData['items'], TaskListView>()

const keepRow = (row: TaskRowView): TaskRowView => keep(rowOf, row.item, row)

export function useTaskList(today: string, nowMs: number): TaskListView {
  const items = useApp((s) => s.data.items)
  return useMemo(() => {
    const view = taskListView(Object.values(items), today, nowMs)
    return keep(viewOf, items, { open: view.open.map(keepRow), done: view.done.map(keepRow), undone: view.undone })
  }, [items, today, nowMs])
}
