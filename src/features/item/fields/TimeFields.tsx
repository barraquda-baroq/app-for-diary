// 時刻の欄「開始」〜「終了」（docs/SPEC.md の 12.2 の 4・6.4・12.4）。打てば `9:07` のように1分単位も入り（`907`・`0907`・全角も読む。
// src/domain/itemInput.ts の parseTime）、読めない字は元の値に戻す。画面の表記は時の頭の 0 を落とす（9:00。D24）。
// 開始時刻が空の間は終了の欄を押せない（ITEMS-229）。押すと 5分刻みの一覧を開く所（TimeList。9:00 の所を見せる）、翌日にした時の
// 「翌日 02:00 まで」、list 生まれでカレンダーに出ていない時に押せなくする所は WP9 の後半（onOpenList・hint・disabled）
import { useEffect, useId, useState } from 'react'
import { displayHm } from '../../../domain/dates'
import { parseTime } from '../../../domain/itemInput'
import { ClockIcon } from '../../../ui/icons'
import { cls } from '../../calendar/common/parts/itemLook'
import { testIds } from '../../calendar/common/testIds'
import type { TimePatch } from '../itemForm'

export type TimeWhich = 'start' | 'end'

export interface TimeFieldsProps {
  startTime: string | null
  endTime: string | null
  /** 欄を決めた（打って離れた・Enter。読めた値だけ） */
  onTimes: (patch: TimePatch) => void
  /** 欄を押した（5分刻みの一覧を開く。WP9 の後半） */
  onOpenList?: (which: TimeWhich, anchor: HTMLElement) => void
  /** 翌日までにした時の「翌日 02:00 まで」（無ければ null） */
  hint?: string | null
  /** 時刻を入れられない時の理由（list 生まれでカレンダーに出ていない時の「締め切り日を入れると時刻を入れられます」。無ければ null） */
  disabledNote?: string | null
}

const CAPTION: Record<TimeWhich, string> = { start: '開始', end: '終了' }
const FIELD: Record<TimeWhich, 'startTime' | 'endTime'> = { start: 'startTime', end: 'endTime' }
const TEST_ID: Record<TimeWhich, string> = { start: testIds.itemStartTime, end: testIds.itemEndTime }

const shown = (hm: string | null) => (hm === null ? '' : displayHm(hm))

interface TimeInputProps {
  which: TimeWhich
  value: string | null
  disabled: boolean
  labelledBy: string
  onCommit: (value: string | null) => void
  onOpenList?: (which: TimeWhich, anchor: HTMLElement) => void
}

function TimeInput({ which, value, disabled, labelledBy, onCommit, onOpenList }: TimeInputProps) {
  const [text, setText] = useState(shown(value))
  // 欄の外で値が変わった（開始を空にして終了も消えた・一覧で選んだ）時は、その値を出す
  useEffect(() => setText(shown(value)), [value])
  const commit = () => {
    const parsed = parseTime(text, which)
    if (parsed === undefined || parsed === value) {
      setText(shown(value))
      return
    }
    setText(shown(parsed))
    onCommit(parsed)
  }
  return (
    <div className={cls('it-time', which === 'start' ? 'it-a' : 'it-b')}>
      <ClockIcon />
      <input
        className="input"
        value={text}
        disabled={disabled}
        aria-labelledby={labelledBy}
        autoComplete="off"
        enterKeyHint="done"
        onChange={(e) => setText(e.target.value)}
        onClick={(e) => onOpenList?.(which, e.currentTarget)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229 && !e.ctrlKey && !e.metaKey) {
            e.preventDefault()
            commit()
          }
        }}
        data-testid={TEST_ID[which]}
      />
    </div>
  )
}

export function TimeFields({ startTime, endTime, onTimes, onOpenList, hint, disabledNote }: TimeFieldsProps) {
  const id = useId()
  const disabled = Boolean(disabledNote)
  const input = (which: TimeWhich, value: string | null, off: boolean) => (
    <TimeInput
      which={which}
      value={value}
      disabled={off}
      labelledBy={`${id}-${which}`}
      onCommit={(v) => onTimes({ [FIELD[which]]: v })}
      onOpenList={onOpenList}
    />
  )
  return (
    <div className="it-pair" role="group" aria-label="時刻">
      <span className="it-cap it-a" id={`${id}-start`}>
        {CAPTION.start}
      </span>
      <span className="it-cap it-b" id={`${id}-end`}>
        {CAPTION.end}
      </span>
      {input('start', startTime, disabled)}
      <span className="it-sep" aria-hidden="true">
        〜
      </span>
      {input('end', endTime, disabled || startTime === null)}
      {hint ? (
        <span className="it-note it-b" role="status" data-testid={testIds.itemTimeHint}>
          {hint}
        </span>
      ) : null}
      {disabledNote ? <p className="it-note it-wide">{disabledNote}</p> : null}
    </div>
  )
}
