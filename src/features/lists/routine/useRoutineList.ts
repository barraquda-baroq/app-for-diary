// Routine List の中身（docs/SPEC.md の 14.）を記録から作るフック: 表示用に直したルーチンとチェックの記録（useData()。6.12）・今日から
// src/domain/routineList.ts の routineListView を作り、同じ物を渡されている間は同じ物を返す（行は React.memo で浅く比べる）。
// today は Routine List の中身の部品が1つの useToday() から渡す（0時を過ぎると変わり、チェックの記録を書き換えずに行が戻る。14.3。
// 掴んでいる間はその日のまま。D37）。
// 契約の形だけ（S3-STUB）: 今は記録を読まず、ルーチンの無い時の中身（5つの空のかたまり）を返すだけ（中身は段階3の WP3 が入れる）
import { useMemo } from 'react'
import { routineListView, type RoutineListView } from '../../../domain/routineList'
import type { AppData } from '../../../domain/types'

const NO_ROUTINES: Pick<AppData, 'routines' | 'routineChecks'> = { routines: {}, routineChecks: {} }

export function useRoutineList(today: string): RoutineListView {
  return useMemo(() => routineListView(NO_ROUTINES, today), [today])
}
