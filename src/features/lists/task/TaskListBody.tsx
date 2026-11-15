// Task List の中身（docs/SPEC.md の 13.）: 入力欄（自動で伸びる1行の欄と［足す］・下に［開始日］［締め切り日］［依頼者］）、行（L は6つの列・
// M と S は2行。task/TaskRow）、「済み n件」。見出しと畳む・開くの枠は common の ListSection（トップの画面が置く）。
// - 足す（13.2）: Enter（変換中は足さない。PC の Shift+Enter は改行）・［足す］で、1行目を件名・2行目からをメモにして、Task List 生まれ・
//   仕事・Task List に出す・ラベルなしで足す（domain の taskInputOf）。入力欄とチップは空に戻り、フォーカスは入力欄に残る。足した行を
//   1.2秒目立たせ、L は右の列の中だけで見える所まで送る（S・M はページを動かさない。見えていれば目立つ。開発）。お知らせは出さない。
//   書きかけ（字とチップ）は diary-studio:draft:task に控える（common/useListInput）
// - 並び（13.4）: カレンダーに出ている物を期間の終わり to の近い順（同じ日は入れた順）、その下にカレンダーに出ていない物（①④）を新しい順。
//   済んだ物は「済み n件」（初めは畳む。端末ごとに覚える）へ沈み、済んでから 168時間を過ぎると出さない（domain の taskListView）
// - 今日は1つの useToday()（0時のタイマー・裏から戻った時・フォーカスが戻った時に替わる。期限切れの色・今日の太字・今週金曜）、
//   168時間で隠すのは useNow(60秒)（済んでから 168時間たった物は1分の内に消える）
// 行は記録の id を key にした1つの平らな並び（common/ListRows。チェックで行が「済み」へ移っても作り直さない）
import { toYmd } from '../../../domain/dates'
import { useNow, useToday } from '../../../ui/hooks'
import { useDoneCollapsed } from '../common/DoneSection'
import { listFlashKey } from '../common/listFlash'
import { ListInput } from '../common/ListInput'
import { ListRows } from '../common/ListRows'
import { listTestIds } from '../common/testIds'
import { useListInput } from '../common/useListInput'
import type { ListBodyProps } from '../types'
import { TaskChips } from './TaskChips'
import { TaskRow } from './TaskRow'
import { addTask } from './taskOps'
import { useTaskList } from './useTaskList'
import './task.css'

/** 1分ごとに今を読み直す（済んでから 168時間で隠す） */
const NOW_TICK_MS = 60_000

export function TaskListBody({ width }: ListBodyProps) {
  const today = toYmd(useToday())
  const nowMs = useNow(NOW_TICK_MS)
  const view = useTaskList(today, nowMs)
  const input = useListInput({ list: 'task', onAdd: addTask })
  const [doneCollapsed, setDoneCollapsed] = useDoneCollapsed({ list: 'task' })
  const wide = width === 'L'
  return (
    <>
      <ListInput input={input} below={<TaskChips input={input} today={today} />} />
      <ListRows
        open={view.open}
        done={view.done}
        doneSection={{
          collapsed: doneCollapsed,
          onToggle: () => setDoneCollapsed(!doneCollapsed),
          testId: listTestIds.done('task'),
          flash: listFlashKey.done('task'),
        }}
        renderRow={(r) => <TaskRow view={r} wide={wide} today={today} />}
      />
    </>
  )
}
