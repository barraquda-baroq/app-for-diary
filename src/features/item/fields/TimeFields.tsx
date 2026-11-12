// 時刻の欄「開始」〜「終了」（docs/SPEC.md の 12.2 の 5・6.4・12.4）。押すと 5分刻みの一覧（TimeList。開始は 0:00〜23:55、終了は 0:05〜23:55 と
// 24:00。0:00 は 24:00 と同じなので終了の一覧に置かない。AMB-ITEMS-06）を、値の所（値が無ければ終了は開始の1時間後・ほかは 9:00 の所）を
// 見せて開く（AMB-ITEMS-07）。打てば `9:07` のように1分単位も入り（`907`・`0907`・`9`・全角も読む。src/domain/itemInput.ts の parseTime）、
// 読めない字は元の値に戻して理由を出す。画面の表記は時の頭の 0 を落とす（9:00。D24）。
// 開始時刻が空の間は終了の欄を押せない（ITEMS-229）。翌日にした時の「翌日 02:00 まで」（hint）、list 生まれでカレンダーに出ていない時に
// 押せなくする所（disabledNote）は包む画面が決める。
// 打った字は、欄を離れた時・Enter で決める。Ctrl+Enter・⌘+Enter（登録）の時も先に決めてから包む所へ渡す（登録の前に打った時刻を入れる）。
// Tab で離れる時は、フォーカスが移る前に決める（開始を打って Tab を押すと、押せるようになった終了へ移る。12.2 の Tab の順）。
// 欄を離れずに閉じた時（Esc・「戻る」）と、画面を閉じる・裏に回る時も、読める字なら決める（詳細の画面で打ちかけの時刻を失わない）
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { flushSync } from 'react-dom'
import { displayHm } from '../../../domain/dates'
import { parseTime, timeListAnchor, timeOptions } from '../../../domain/itemInput'
import { markDraftClean, markDraftDirty } from '../../../store/draftRegistry'
import { ClockIcon } from '../../../ui/icons'
import { cls } from '../../calendar/common/parts/itemLook'
import { testIds } from '../../calendar/common/testIds'
import type { TimePatch } from '../itemForm'
import { optionId, OptionList, type Option } from './OptionList'

export type TimeWhich = 'start' | 'end'

export interface TimeFieldsProps {
  startTime: string | null
  endTime: string | null
  /** 欄を決めた（打って離れた・Enter・一覧で選んだ。読めた値だけ） */
  onTimes: (patch: TimePatch) => void
  /** 翌日までにした時の「翌日 02:00 まで」（無ければ null） */
  hint?: string | null
  /** 時刻を入れられない時の理由（list 生まれでカレンダーに出ていない時の「締め切り日を入れると時刻を入れられます」。無ければ null） */
  disabledNote?: string | null
}

/** 読めない時刻を打った時の文（元の値に戻す。AMB-ITEMS-07） */
export const TIME_UNREADABLE = '読めない時刻なので元に戻しました（9:30・930・9 のように打てます）'
/** 読めない時刻の文の data-testid */
export const TIME_ERROR_TEST_ID = 'item-time-error'
/** 時刻の一覧の data-testid（開始・終了） */
export const timeListTestId = (which: TimeWhich) => `item-time-list-${which}`

const CAPTION: Record<TimeWhich, string> = { start: '開始', end: '終了' }
const FIELD: Record<TimeWhich, 'startTime' | 'endTime'> = { start: 'startTime', end: 'endTime' }
const TEST_ID: Record<TimeWhich, string> = { start: testIds.itemStartTime, end: testIds.itemEndTime }

const shown = (hm: string | null) => (hm === null ? '' : displayHm(hm))

/** 一覧の選び肢（値は保存の形、字は時の頭の 0 を落とす） */
const OPTIONS: Record<TimeWhich, Option[]> = {
  start: timeOptions('start').map((v) => ({ value: v, label: displayHm(v) })),
  end: timeOptions('end').map((v) => ({ value: v, label: displayHm(v) })),
}

/** 日本語の変換中の Enter（変換を決めるだけ。Safari は isComposing を付けず keyCode 229） */
const composing = (e: KeyboardEvent) => e.nativeEvent.isComposing || e.keyCode === 229

interface TimeInputProps {
  which: TimeWhich
  value: string | null
  /** 開始の時刻（終了の一覧を開く所を決める） */
  startTime: string | null
  disabled: boolean
  labelledBy: string
  onCommit: (value: string | null) => void
  /** 読めない字を打った（true）・読めた（false） */
  onUnreadable: (bad: boolean) => void
}

function TimeInput({ which, value, startTime, disabled, labelledBy, onCommit, onUnreadable }: TimeInputProps) {
  const [text, setText] = useState(shown(value))
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const ref = useRef<HTMLInputElement>(null)
  const listId = useId()
  const options = OPTIONS[which]
  // 欄の外で値が変わった（開始を空にして終了も消えた・翌日にした・一覧で選んだ）時は、その値を出す
  useEffect(() => setText(shown(value)), [value])

  // 打ちかけの字（まだ欄を離れていない・Enter を押していない）は、欄を離れずに閉じた時（Esc・「戻る」で部品が消える）と、画面を
  // 閉じる・裏に回る時（src/store/lifecycle.ts の flushAllDrafts）にも決める（詳細の画面は直したそばから保存する。ITEMS-208）。
  // 読めない字はそのまま残す（決める時に元へ戻すのは、欄を離れた・Enter の時だけ）
  const pending = useRef({ text, value, onCommit })
  pending.current = { text, value, onCommit }
  const draftKey = useRef(Symbol('time'))
  const flushTyped = useRef(() => {
    const p = pending.current
    markDraftClean(draftKey.current)
    if (p.text === shown(p.value)) return
    const parsed = parseTime(p.text, which)
    if (parsed === undefined || parsed === p.value) return
    p.value = parsed
    p.onCommit(parsed)
  }).current
  useEffect(() => {
    if (text !== shown(value) && parseTime(text, which) !== undefined) markDraftDirty(draftKey.current, flushTyped)
    else markDraftClean(draftKey.current)
  }, [text, value, which, flushTyped])
  useEffect(() => flushTyped, [flushTyped])
  useEffect(() => {
    if (disabled) setOpen(false)
  }, [disabled])
  const anchorValue = useMemo(() => timeListAnchor(which, value, startTime), [which, value, startTime])

  const commitText = () => {
    const parsed = parseTime(text, which)
    if (parsed === undefined) {
      setText(shown(value))
      onUnreadable(true)
      return
    }
    onUnreadable(false)
    if (parsed === value) {
      setText(shown(value))
      return
    }
    setText(shown(parsed))
    onCommit(parsed)
  }
  const pick = (v: string) => {
    setOpen(false)
    setActive(-1)
    onUnreadable(false)
    setText(shown(v))
    if (v !== value) onCommit(v)
  }
  const openList = () => {
    if (disabled) return
    setOpen(true)
  }
  /** Tab を押した時に決めた（続く onBlur で決め直さない。また打つと外す） */
  const committedOnTab = useRef(false)

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // Tab: ブラウザが次の行き先を選ぶ前に、打った字を決めて描き終える。欄を離れた時（onBlur）に決めると、開始時刻が空の間は
    // 押せない終了の欄がまだ押せないので、開始を打って Tab を押すと終了を飛ばしてメモへ移っていた（12.2 の Tab の順）。
    // 続く onBlur では決め直さない（決め直すと、戻した空の字を読めたと見て、読めない字の理由を消してしまう）
    if (e.key === 'Tab' && !composing(e)) {
      flushSync(() => {
        setOpen(false)
        setActive(-1)
        commitText()
      })
      committedOnTab.current = true
      return
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!open) {
        openList()
        setActive(options.findIndex((o) => o.value === anchorValue))
        return
      }
      const step = e.key === 'ArrowDown' ? 1 : -1
      setActive((i) => {
        const from = i >= 0 ? i : options.findIndex((o) => o.value === anchorValue)
        return Math.max(0, Math.min(options.length - 1, from + step))
      })
      return
    }
    if (e.key !== 'Enter' || composing(e)) return
    // Ctrl・⌘+Enter（登録）は、打った時刻を決めてから包む所（登録の画面）へそのまま渡す
    if (e.ctrlKey || e.metaKey) {
      setOpen(false)
      commitText()
      return
    }
    e.preventDefault()
    if (open && active >= 0) pick(options[active].value)
    else {
      setOpen(false)
      commitText()
    }
  }

  return (
    <div className={cls('it-time', which === 'start' ? 'it-a' : 'it-b')}>
      <ClockIcon />
      <input
        ref={ref}
        className="input"
        value={text}
        disabled={disabled}
        role="combobox"
        aria-labelledby={labelledBy}
        aria-autocomplete="none"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && active >= 0 ? optionId(listId, active) : undefined}
        autoComplete="off"
        enterKeyHint="done"
        onChange={(e) => {
          committedOnTab.current = false
          setText(e.target.value)
          setActive(-1)
        }}
        onClick={openList}
        onBlur={() => {
          setOpen(false)
          setActive(-1)
          if (committedOnTab.current) committedOnTab.current = false
          else commitText()
        }}
        onKeyDown={onKeyDown}
        data-testid={TEST_ID[which]}
      />
      {open ? (
        <OptionList
          id={listId}
          anchor={ref.current}
          label={`${CAPTION[which]}の時刻`}
          options={options}
          selected={value}
          active={active}
          anchorValue={anchorValue}
          onPick={pick}
          onClose={() => {
            setOpen(false)
            setActive(-1)
          }}
          testId={timeListTestId(which)}
        />
      ) : null}
    </div>
  )
}

export function TimeFields({ startTime, endTime, onTimes, hint, disabledNote }: TimeFieldsProps) {
  const id = useId()
  const [unreadable, setUnreadable] = useState(false)
  const disabled = Boolean(disabledNote)
  const input = (which: TimeWhich, value: string | null, off: boolean) => (
    <TimeInput
      which={which}
      value={value}
      startTime={startTime}
      disabled={off}
      labelledBy={`${id}-${which}`}
      onCommit={(v) => onTimes({ [FIELD[which]]: v })}
      onUnreadable={setUnreadable}
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
      {unreadable ? (
        <p className="it-note it-wide" role="alert" data-testid={TIME_ERROR_TEST_ID}>
          {TIME_UNREADABLE}
        </p>
      ) : null}
      {disabledNote ? <p className="it-note it-wide">{disabledNote}</p> : null}
    </div>
  )
}
