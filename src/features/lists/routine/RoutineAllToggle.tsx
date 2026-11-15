// Routine List の見出しの右の［すべて開く］／［すべて畳む］（docs/SPEC.md の 14.2）: 種類ごとのかたまり（毎日・毎週…）を1つのボタンで
// 切り替える（どれか1つでも畳んでいれば「すべて開く」）。ルーチンの無いかたまり（項目の無い種類。名前と＋だけで畳む・開くの山形が
// 無い）は数えず、書き換えもしない（開発）。見出しそのものは畳まない。押しても画面が何も変わらない間は出さない: ルーチンのある
// かたまりが1つも無い間（どの種類も空）。畳んだ・開いたは端末ごとに覚える（diary-studio:prefs の collapsed.routineGroups。どの幅でも
// 同じ。6.13）。トップの画面が見出しの headerExtra に置く（リストを開いている間だけ出る）
import { useMemo } from 'react'
import { toYmd } from '../../../domain/dates'
import { ROUTINE_CYCLES, usePrefs, type RoutineCycle, type RoutineFlags } from '../../../store/uiStore'
import { useToday } from '../../../ui/hooks'
import { listTestIds } from '../common/testIds'
import { useRoutineList } from './useRoutineList'

const allFlags = (value: boolean) => Object.fromEntries(ROUTINE_CYCLES.map((c) => [c, value])) as RoutineFlags

/** ［すべて開く／畳む］のボタン（cycles は数えるかたまり。省くと5つとも） */
export function RoutineAllButton({ cycles = ROUTINE_CYCLES }: { cycles?: readonly RoutineCycle[] }) {
  const groups = usePrefs((s) => s.collapsed.routineGroups)
  const setCollapsed = usePrefs((s) => s.setCollapsed)
  const anyClosed = cycles.some((c) => groups[c])
  const toggle = () => {
    const next = { ...usePrefs.getState().collapsed.routineGroups }
    for (const c of cycles) next[c] = !anyClosed
    setCollapsed({ routineGroups: cycles.length === ROUTINE_CYCLES.length ? allFlags(!anyClosed) : next })
  }
  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm list-head-all"
      onClick={toggle}
      data-testid={listTestIds.routineToggleAll}
    >
      {anyClosed ? 'すべて開く' : 'すべて畳む'}
    </button>
  )
}

/** 見出しに置く物（ルーチンのあるかたまりが無ければ出さない） */
export function RoutineAllToggle() {
  const today = toYmd(useToday())
  const view = useRoutineList(today)
  const cycles = useMemo(() => view.groups.filter((g) => !g.empty).map((g) => g.cycle), [view])
  if (cycles.length === 0) return null
  return <RoutineAllButton cycles={cycles} />
}
