// Routine List の中身（docs/SPEC.md の 14.・3.6）: 2段の入力欄（routine/RoutineInput。上の段に［日｜週｜月｜四半期｜年］と［指定］、
// 下の段に字の欄と［足す］。■35）と、その下に種類ごとの5つのかたまり（routine/RoutineGroup。毎日 → 毎週 → 毎月 → 四半期 → 毎年）。
// 見出しと畳む・開くの枠は common/ListSection（トップの画面が置く）、見出しの右の［すべて開く／畳む］は routine/RoutineAllToggle。
// - 今日は、この部品の1つの useToday() から決める（0時のタイマー・画面が見えるようになった時・フォーカスが戻った時に計算し直す。
//   日が替わると、チェックの記録を書き換えずに、戻った行が「済み」から元の位置へ上がる。数も替わる。14.3・6.4）
// - 足す: その種類のいちばん下へ（件名は1〜200字。合わない時はお知らせして足さず、字は欄に残す）。足したら欄を空にしてフォーカスを
//   残し、［指定］も「指定なし」へ戻す（種類はそのまま）。足した種類のかたまりを畳んでいれば開き、足した行を 1.2秒目立たせる（L は
//   右の列の中だけで見える所まで送る。S・M はページを動かさない。開発）
// - 空のかたまりの＋: その種類を選んで、入力欄へフォーカスする（押した出来事の中で。iPhone でもキーボードが出る）。欄が見えない所に
//   あれば見える所まで送る
import { useCallback, useEffect, useRef, useState } from 'react'
import { toYmd } from '../../../domain/dates'
import type { SpecDraft } from '../../../domain/routineList'
import type { RoutineCycle } from '../../../domain/types'
import { usePrefs } from '../../../store/uiStore'
import { useToday } from '../../../ui/hooks'
import { scrollBehavior } from '../../../ui/motion'
import { useItemSheets } from '../../calendar/common/sheets'
import { registerDraftClear } from '../common/listDraft'
import { flashList, listFlashKey } from '../common/listFlash'
import type { ListDraft } from '../common/listInputModel'
import { useListInput } from '../common/useListInput'
import type { ListBodyProps } from '../types'
import { addRoutineFrom, EMPTY_SPEC } from './routineActions'
import { RoutineGroup } from './RoutineGroup'
import { RoutineInput } from './RoutineInput'
import { useRoutineList } from './useRoutineList'
import './routine.css'

export function RoutineListBody(props: ListBodyProps) {
  void props
  const today = toYmd(useToday())
  const view = useRoutineList(today)
  const { openRoutineDetail } = useItemSheets()
  const [spec, setSpec] = useState<SpecDraft>(EMPTY_SPEC)
  const specRef = useRef(spec)
  specRef.current = spec

  const onAdd = useCallback((d: ListDraft): boolean => {
    const cycle = usePrefs.getState().routineAddCycle
    const id = addRoutineFrom(d.text, cycle, specRef.current)
    if (id === undefined) return false
    setSpec(EMPTY_SPEC)
    const prefs = usePrefs.getState()
    if (prefs.collapsed.routineGroups[cycle]) {
      prefs.setCollapsed({ routineGroups: { ...prefs.collapsed.routineGroups, [cycle]: false } })
    }
    flashList(listFlashKey.row('routine', id))
    return true
  }, [])
  const input = useListInput({ list: 'routine', onAdd })

  // ■34: 打ちかけを捨てる時は［指定］も空にする（字は useListInput が空にする）
  useEffect(() => registerDraftClear('routine', () => setSpec(EMPTY_SPEC)), [])

  const focusInput = input.focus
  const onAddTo = useCallback(
    (cycle: RoutineCycle) => {
      usePrefs.getState().setPrefs({ routineAddCycle: cycle })
      focusInput()
      // 欄がスクロールで見えない所にあれば、近い方の端まで出す（L は右の列の中だけ。ページは動かない）
      const el = document.activeElement
      if (el instanceof HTMLInputElement) el.scrollIntoView({ block: 'nearest', behavior: scrollBehavior() })
    },
    [focusInput],
  )

  return (
    <>
      <RoutineInput input={input} spec={spec} onSpecChange={setSpec} />
      <div className="rt-groups">
        {view.groups.map((g) => (
          <RoutineGroup key={g.cycle} group={g} onAddTo={onAddTo} onDetail={openRoutineDetail} />
        ))}
      </div>
    </>
  )
}
