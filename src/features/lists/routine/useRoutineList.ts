// Routine List の中身（docs/SPEC.md の 14.）を記録から作るフック: 表示用に直したルーチンとチェックの記録（useApp の data.routines・
// data.routineChecks。useData() と同じ記録。6.12）・今日から src/domain/routineList.ts の routineListView を作る。2つの表・today が
// 同じ間は作り直さない（ほかの表が替わっても）。作り直しても、行に出す物が前と同じ行は前と同じ物を返し、行が1つも替わらない種類の
// かたまりも前と同じ物を返す（common/stableRows。行とかたまりは React.memo）。
// today は Routine List の中身の部品（routine/RoutineListBody）が1つの useToday() から渡す（0時を過ぎると変わり、チェックの記録を
// 書き換えずに行が戻る。14.3）
import { useMemo } from 'react'
import { routineListView, type RoutineGroupView, type RoutineListView, type RoutineRowView } from '../../../domain/routineList'
import type { Routine, RoutineCycle } from '../../../domain/types'
import { useApp } from '../../../store/appStore'
import { keep } from '../common/stableRows'

/** 記録ごとの前の行（チェックを付けた・外した・日が替わった時は、記録が同じでも済み・戻る日が替われば新しい行） */
const rowOf = new WeakMap<Routine, RoutineRowView>()
/** 種類ごとの前のかたまり */
const groupOf = new Map<RoutineCycle, RoutineGroupView>()

const keepRow = (row: RoutineRowView): RoutineRowView => keep(rowOf, row.routine, row)

export function useRoutineList(today: string): RoutineListView {
  const routines = useApp((s) => s.data.routines)
  const routineChecks = useApp((s) => s.data.routineChecks)
  return useMemo(() => {
    const view = routineListView({ routines, routineChecks }, today)
    const groups = view.groups.map((g) => keep(groupOf, g.cycle, { ...g, open: g.open.map(keepRow), done: g.done.map(keepRow) }))
    return { groups, undone: view.undone }
  }, [routines, routineChecks, today])
}
