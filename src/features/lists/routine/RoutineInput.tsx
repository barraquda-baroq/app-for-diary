// Routine List の入力欄（docs/SPEC.md の 14.2・3.6・12.1。■35 の答え「それでいいです」のとおり2段。スマホでも同じ）:
// - 上の段: 種類の切り替え［日｜週｜月｜四半期｜年］（segmented の小さい物。選んだ種類は端末ごとに覚える。diary-studio:prefs の
//   routineAddCycle。初めは毎日）と、毎週・毎月・毎年の時だけ［指定］。［指定］を押すとボタンの下に小さな窓（routine/SpecPicker:
//   毎週は7つの曜日、毎月は日、毎年は月と日。毎週・毎年は［指定なし］でまとめて外す）。窓は［閉じる］・外を押す・Esc で閉じる。
//   選んだ指定はボタンの字になる（「月・木」「25日」「3/15」。選んでいなければ「指定」。長い時は「…」で縮める）。窓は L・M・S の
//   どれでも同じ小さな窓（360px の幅にも入る。開発）。指定は足すたびに「指定なし」へ戻り、端末の書きかけには入れない（字だけ。開発）
// - 下の段: 1行の欄（プレースホルダ「ルーチンを足す…」）と、右の端の中に［足す］（✓）。Enter・［足す］でその種類のいちばん下に足す
//   （common/ListInput・useListInput。変換中の Enter は足さない。外を押す・キーボードを閉じるでは足さない）
// - ■34: S・M で開いている Routine List を端からのフリック・OS の［戻る］で畳む時（common/listDraft の discardListDraft）は、字と
//   いっしょに［指定］も空にし、窓も閉じる
// data-testid は routine-cycle-{種類}・routine-spec-button・routine-spec-picker（common/testIds.ts）
import { useEffect, useRef, useState } from 'react'
import { specButtonLabel, type SpecDraft } from '../../../domain/routineList'
import { ROUTINE_CYCLE_LABELS } from '../../../domain/routines'
import { ROUTINE_CYCLES, usePrefs, type RoutineCycle } from '../../../store/uiStore'
import { Popover } from '../../item/fields/Popover'
import { registerDraftClear } from '../common/listDraft'
import { ListInput } from '../common/ListInput'
import { listTestIds } from '../common/testIds'
import type { ListInputApi } from '../common/useListInput'
import { EMPTY_SPEC } from './routineActions'
import { hasSpec, SpecPicker } from './SpecPicker'
import './routine.css'

/** 上の段の種類の切り替えの字（14.2） */
const CYCLE_SHORT: Record<RoutineCycle, string> = {
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
    <div className="segmented list-cycle rt-cycle" role="group" aria-label="足すルーチンの種類">
      {ROUTINE_CYCLES.map((c) => (
        <button
          key={c}
          type="button"
          aria-pressed={cycle === c}
          aria-label={ROUTINE_CYCLE_LABELS[c]}
          onClick={() => setPrefs({ routineAddCycle: c })}
          data-testid={listTestIds.routineCycle(c)}
        >
          {CYCLE_SHORT[c]}
        </button>
      ))}
    </div>
  )
}

interface SpecButtonProps {
  cycle: RoutineCycle
  spec: SpecDraft
  onChange: (spec: SpecDraft) => void
}

/** ［指定］と、押すと開く小さな窓 */
function SpecButton({ cycle, spec, onChange }: SpecButtonProps) {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null)
  const button = useRef<HTMLButtonElement | null>(null)
  const pop = useRef<HTMLDivElement | null>(null)
  /** キーボード（Enter・Space）で開いた（窓の中の最初の物へフォーカスを移す） */
  const byKey = useRef(false)

  // ■34 で打ちかけを捨てる時は窓も閉じる（指定は使う側が空にする）
  useEffect(() => registerDraftClear('routine', () => setAnchor(null)), [])

  useEffect(() => {
    if (!anchor || !byKey.current) return
    pop.current?.querySelector<HTMLElement>('button, select')?.focus()
  }, [anchor])

  /** 閉じる（フォーカスが窓の中にあれば［指定］へ戻す） */
  const close = () => {
    const inside = pop.current?.contains(document.activeElement)
    setAnchor(null)
    if (inside) button.current?.focus({ preventScroll: true })
  }

  const label = specButtonLabel(cycle, spec)
  return (
    <>
      <button
        ref={button}
        type="button"
        className={`btn btn-sm rt-spec-button${label === '指定' ? '' : ' is-set'}`}
        aria-haspopup="dialog"
        aria-expanded={anchor !== null}
        aria-label={label === '指定' ? '指定' : `指定 ${label}`}
        onClick={(e) => {
          byKey.current = e.detail === 0
          const el = e.currentTarget
          setAnchor((a) => (a ? null : el))
        }}
        data-testid={listTestIds.routineSpecButton}
      >
        <span className="rt-spec-button-text">{label}</span>
      </button>
      {anchor ? (
        <Popover
          anchor={anchor}
          onClose={close}
          role="dialog"
          label={`${ROUTINE_CYCLE_LABELS[cycle]}の指定`}
          className="rt-spec-pop"
          testId={listTestIds.routineSpecPicker}
        >
          <div ref={pop} className="rt-spec-pop-body">
            <SpecPicker cycle={cycle} value={spec} onChange={onChange} />
            <div className="rt-spec-foot">
              {/* 毎月は日の選択の中に「指定なし」がある */}
              {cycle === 'monthly' ? null : (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange(EMPTY_SPEC)}>
                  指定なし
                </button>
              )}
              <button type="button" className="btn btn-sm" onClick={close}>
                閉じる
              </button>
            </div>
          </div>
        </Popover>
      ) : null}
    </>
  )
}

export interface RoutineInputProps {
  input: ListInputApi
  /** ［指定］で選んでいる物（足すたびに空へ戻すのは使う側） */
  spec: SpecDraft
  onSpecChange: (spec: SpecDraft) => void
}

export function RoutineInput({ input, spec, onSpecChange }: RoutineInputProps) {
  const cycle = usePrefs((s) => s.routineAddCycle)
  return (
    <ListInput
      input={input}
      above={
        <>
          <RoutineCycleSwitch />
          {hasSpec(cycle) ? <SpecButton cycle={cycle} spec={spec} onChange={onSpecChange} /> : null}
        </>
      }
    />
  )
}
