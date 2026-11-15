// ルーチンの［詳しく］のパネル（docs/SPEC.md の 3.6・3.8・14.2）: 件名・種類・指定・戻る日の行・［削除］と、下の端に段階5の提案の置き場。
// 外枠は common/ListSheet（L は右の列の上のパネル、S・M は下からのシート。地は --surface、題の左に RepeatIcon。Esc・［×］・外を押すと
// 閉じる）。履歴の state.sheet の routine（src/features/calendar/common/types.ts の SheetState）を ListSheetHost が読んで出す。
// 保存のボタンは無く、直したそばから保存する（3.6）:
// - 件名: 止まってから 0.6秒・欄から出た時・Enter で保存（1〜200字。空にした・長すぎた時は保存せず、保存してある件名に戻す）
// - 種類: 押したらすぐ。新しい種類に合わない指定は外し、新しい種類のいちばん下へ並べる。チェックの記録はそのままで、済みかどうかは
//   新しい決まりで計算し直す（14.2）
// - 指定（routine/SpecPicker。毎週・毎月・毎年）: 選んだらすぐ。毎年は月と日の両方を選んだ時（片方だけの間は保存しない）
// - 戻る日の行: 済んでいる間は「11/16（月）に戻ります」（年が違えば年も）。指の端末は行に乗せられないので、ここで見る（開発）
// - ［削除］: 行の「…」の［削除］と同じ（確かめずにゴミ箱へ・［元に戻す］付きのお知らせ）で、パネルを閉じる
// 開いた時は件名の欄でなく上の所にフォーカスする（スマホでキーボードを開かない。Tab で件名の欄へ）。data-testid は routine-panel
import { useId, useState } from 'react'
import { toYmd } from '../../../domain/dates'
import { returnText, type SpecDraft } from '../../../domain/routineList'
import { checkDatesOf, effectiveSpec, isRoutineDone, nextResetDay, ROUTINE_CYCLE_LABELS } from '../../../domain/routines'
import { ROUTINE_CYCLES, type RoutineCycle } from '../../../domain/types'
import { useApp } from '../../../store/appStore'
import { DraftInput } from '../../../ui/DraftField'
import { useToday } from '../../../ui/hooks'
import { RepeatIcon, TrashIcon } from '../../../ui/icons'
import { ListSheet } from '../common/ListSheet'
import { listTestIds } from '../common/testIds'
import type { ListPanelProps } from '../types'
import { routinePanelTestIds } from './routineTestIds'
import { completeSpec, deleteRoutine, renameRoutine, updateRoutineWith } from './routineActions'
import { hasSpec, SpecPicker } from './SpecPicker'
import './routine.css'

/** 件名の欄の保存を待つ長さ（止まってから。3.6） */
const TITLE_SAVE_MS = 600

/** 指定を比べる（同じなら書かない） */
const sameSpec = (a: SpecDraft, b: SpecDraft) =>
  a.weekdays.join(',') === b.weekdays.join(',') &&
  a.monthDay === b.monthDay &&
  a.yearMonth === b.yearMonth &&
  a.yearDay === b.yearDay

export function RoutinePanel({ id, onClose }: ListPanelProps) {
  const baseId = useId()
  const routine = useApp((s) => s.data.routines[id])
  const checks = useApp((s) => s.data.routineChecks)
  const today = toYmd(useToday())
  /** 件名の欄を、保存してある件名から作り直す回数（空・長すぎて保存しなかった時に戻す） */
  const [titleKey, setTitleKey] = useState(0)
  /** 毎年の月と日の片方だけを選んだ途中（両方そろうまで保存しない） */
  const [partial, setPartial] = useState<SpecDraft | null>(null)
  if (!routine) return null

  const spec = effectiveSpec(routine)
  const cycle = spec.cycle
  const stored: SpecDraft = {
    weekdays: spec.weekdays,
    monthDay: spec.monthDay,
    yearMonth: spec.yearMonth,
    yearDay: spec.yearDay,
  }
  const done = isRoutineDone(spec, checkDatesOf({ routineChecks: checks }, id), today)

  const saveTitle = (v: string) => {
    if (v.trim() === '' || !renameRoutine(routine, v)) setTitleKey((k) => k + 1)
  }
  const changeCycle = (c: RoutineCycle) => {
    if (c === cycle) return
    setPartial(null)
    updateRoutineWith(id, { cycle: c })
  }
  const changeSpec = (next: SpecDraft) => {
    const fitted = completeSpec(cycle, next)
    if (cycle === 'yearly' && (next.yearMonth === null) !== (next.yearDay === null)) {
      setPartial(next)
      return
    }
    setPartial(null)
    if (!sameSpec(fitted, stored)) updateRoutineWith(id, fitted)
  }
  const remove = async () => {
    if (await deleteRoutine(routine)) onClose()
  }

  return (
    <ListSheet
      title="ルーチン"
      icon={<RepeatIcon />}
      onClose={onClose}
      testId={listTestIds.routinePanel}
      initialFocus=".rt-panel-top"
    >
      <div className="rt-panel">
        <div className="rt-panel-top" tabIndex={-1} />
        <label className="field">
          <span>件名</span>
          <DraftInput
            key={`${routine.id}:${titleKey}`}
            className="input"
            value={routine.title}
            onCommit={saveTitle}
            delay={TITLE_SAVE_MS}
            autoComplete="off"
            enterKeyHint="done"
            data-testid={routinePanelTestIds.title}
          />
        </label>
        <div className="field">
          <span id={`${baseId}-cycle`}>種類</span>
          <div className="segmented rt-panel-cycle" role="group" aria-labelledby={`${baseId}-cycle`}>
            {ROUTINE_CYCLES.map((c) => (
              <button
                key={c}
                type="button"
                aria-pressed={c === cycle}
                onClick={() => changeCycle(c)}
                data-testid={routinePanelTestIds.cycle(c)}
              >
                {ROUTINE_CYCLE_LABELS[c]}
              </button>
            ))}
          </div>
        </div>
        {hasSpec(cycle) ? (
          <div className="field">
            <span>指定</span>
            <SpecPicker cycle={cycle} value={partial ?? stored} onChange={changeSpec} />
          </div>
        ) : null}
        {done ? (
          <p className="rt-panel-return" data-testid={routinePanelTestIds.returnLine}>
            {returnText(nextResetDay(spec, today), today)}
          </p>
        ) : null}
        <div className="rt-panel-foot">
          <button
            type="button"
            className="btn btn-danger btn-sm"
            onClick={() => void remove()}
            data-testid={routinePanelTestIds.remove}
          >
            <TrashIcon />
            削除
          </button>
        </div>
        {/* 段階5の Claude の提案の置き場（18.6） */}
        <div className="rt-panel-proposal" />
      </div>
    </ListSheet>
  )
}
