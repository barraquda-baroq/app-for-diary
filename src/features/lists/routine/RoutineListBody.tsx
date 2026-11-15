// Routine List の中身（docs/SPEC.md の 14.）: 2段の入力欄（上の段に［日｜週｜月｜四半期｜年］と［指定］、下の段に字の欄と［足す］。D3・■35）、
// 種類ごとの5つのかたまり（見出し・'済み数/全部'・畳む・開く・空のかたまりの＋）、行、かたまりごとの「済み n件」。
// 見出しと畳む・開くの枠は common の ListSection（トップの画面が置く）。
// 契約の形と土台の入力欄だけ（S3-STUB）: 今は2段の入力欄の上の段の種類の切り替え（選んだ種類は端末が覚える。diary-studio:prefs の
// routineAddCycle）と、下の段の1行の欄と［足す］（書きかけは diary-studio:draft:routine に控える）だけを出し、Enter・［足す］では何も
// 足さない（字は欄に残る）。［指定］・かたまり・行・足す処理は段階3の WP3 が入れる
import { ROUTINE_CYCLES, usePrefs, type RoutineCycle } from '../../../store/uiStore'
import { ListInput } from '../common/ListInput'
import { listTestIds } from '../common/testIds'
import { useListInput } from '../common/useListInput'
import type { ListBodyProps } from '../types'

/** 入力欄の上の段の種類の切り替え［日｜週｜月｜四半期｜年］（14.2） */
const CYCLE_LABELS: Record<RoutineCycle, string> = {
  daily: '日',
  weekly: '週',
  monthly: '月',
  quarterly: '四半期',
  yearly: '年',
}

function RoutineCycleSwitch() {
  const cycle = usePrefs((s) => s.routineAddCycle)
  const setPrefs = usePrefs((s) => s.setPrefs)
  return (
    <div className="segmented list-cycle" role="group" aria-label="足すルーチンの種類">
      {ROUTINE_CYCLES.map((c) => (
        <button
          key={c}
          type="button"
          aria-pressed={cycle === c}
          onClick={() => setPrefs({ routineAddCycle: c })}
          data-testid={listTestIds.routineCycle(c)}
        >
          {CYCLE_LABELS[c]}
        </button>
      ))}
    </div>
  )
}

export function RoutineListBody(props: ListBodyProps) {
  void props
  const input = useListInput({ list: 'routine', onAdd: () => false })
  return <ListInput input={input} above={<RoutineCycleSwitch />} />
}
