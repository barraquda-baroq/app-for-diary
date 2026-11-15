// 3つのリストのまだ済んでいない数（docs/SPEC.md の 3.5・3.6）。トップの画面が1回だけ呼び、見出しと切り替えの列に渡す（畳んでいる
// リストも数える）。Task List は出している行のうち済んでいない物、Routine List は今日まだ済んでいないルーチン、Favorite List は済んで
// いない物。数えるのは各リストの中身と同じ決まり（src/domain の taskListView・routineListView・favoriteListView の undone）。
// - 表示用に直した記録（useApp の data。6.12）を読み、記録の表が替わった時と日が替わった時（useToday。0時を過ぎるとルーチンが戻る）だけ
//   数え直す。数が変わらなければトップの画面を描き直さない（数ごとに選んで比べる）
// - Task List の済んでいない数は、済んで 168時間たった物を隠す決まり（今の時刻）には関わらない（隠すのは済んだ物だけ）。数える時の
//   今の時刻はその時の物
import { useMemo } from 'react'
import { toYmd } from '../../domain/dates'
import { favoriteListView } from '../../domain/favoriteList'
import { routineListView } from '../../domain/routineList'
import { taskListView } from '../../domain/taskList'
import type { AppData } from '../../domain/types'
import { useApp } from '../../store/appStore'
import { useToday } from '../../ui/hooks'
import type { ListCounts } from './types'

/** 最後に数えた物を覚える（同じ表・同じ日なら数え直さない） */
function remember<A extends readonly unknown[]>(count: (...args: A) => number): (...args: A) => number {
  let last: { args: A; value: number } | null = null
  return (...args) => {
    if (last && last.args.length === args.length && last.args.every((a, i) => a === args[i])) return last.value
    const value = count(...args)
    last = { args, value }
    return value
  }
}

const taskUndone = remember(
  (items: AppData['items'], today: string) => taskListView(Object.values(items), today, Date.now()).undone,
)
const routineUndone = remember(
  (routines: AppData['routines'], routineChecks: AppData['routineChecks'], today: string) =>
    routineListView({ routines, routineChecks }, today).undone,
)
const favoriteUndone = remember(
  (favorites: AppData['favorites'], today: string) => favoriteListView(Object.values(favorites), today).undone,
)

export function useListCounts(): ListCounts {
  const today = toYmd(useToday())
  const routine = useApp((s) => routineUndone(s.data.routines, s.data.routineChecks, today))
  const task = useApp((s) => taskUndone(s.data.items, today))
  const favorite = useApp((s) => favoriteUndone(s.data.favorites, today))
  return useMemo(() => ({ routine, task, favorite }), [routine, task, favorite])
}
