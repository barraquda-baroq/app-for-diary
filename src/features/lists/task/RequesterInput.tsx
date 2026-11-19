// Task List の依頼者の小さな入力欄（docs/SPEC.md の 13.2・13.3・12.2・6.2）: 入力欄の下の［依頼者］を押した時と、L の行の依頼者を
// その場で直す時に出す。0〜60字（コードポイントで数える。上限を超えて打てない・貼れない）。
// - 候補: 直近 365日に作った項目の依頼者を、使った回数の多い順（同じなら新しく使った順）に8つまで、打った字で始まる物に絞って
//   欄の下に出す（src/domain/requesters.ts。登録・詳細の依頼者の欄と同じ計算）。↑↓で移り、Enter・押すと選ぶ。フォーカスは欄に残す
// - 決めるのは Enter（変換中の Enter は除く。P16）・候補を選ぶ・欄から離れる（blur）。空にして決めると依頼者を消す。Esc は、候補を
//   出している間は候補だけを閉じ（OptionList）、もう一度押すと決めずにやめる（変換を取り消す Esc ではやめない）
// - 出した時に、その場でフォーカスする（描いた直後の useLayoutEffect。押した出来事の中で flushSync で出すと、iPhone でもキーボードが出る。P3）
// - 出している間は、Esc と同じやめ方を欄に届ける（common/fieldCancel。L の行の依頼者を直している間の、iPhone・iPad の端からの
//   フリックは、決めずにやめる。■36。入力欄の下のチップの欄は、入力欄の打ちかけと一緒に捨てる: src/features/top/typingCancel.ts）
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { limitChars } from '../../../domain/itemInput'
import { requesterCandidates } from '../../../domain/requesters'
import { LIMITS } from '../../../domain/types'
import { useData } from '../../../store/appStore'
import { optionId, OptionList } from '../../item/fields/OptionList'
import { registerFieldCancel } from '../common/fieldCancel'

export interface RequesterInputProps {
  /** 開いた時の字 */
  initial: string
  /** 決めた（前後の空白を落とした字。空なら依頼者を消す）。how は決め方（Enter・候補を選んだ・欄から離れた） */
  onCommit: (requester: string, how: CommitHow) => void
  /** 決めずにやめた（Esc） */
  onCancel: () => void
  /** 読み上げの名前 */
  label: string
  className?: string
  testId: string
}

/** 決め方 */
export type CommitHow = 'enter' | 'pick' | 'blur'

/** 候補の一覧の data-testid */
export const TASK_REQUESTER_LIST_TEST_ID = 'task-requester-list'

const composing = (e: KeyboardEvent) => e.nativeEvent.isComposing || e.keyCode === 229

export function RequesterInput({ initial, onCommit, onCancel, label, className, testId }: RequesterInputProps) {
  const [text, setText] = useState(initial)
  const [open, setOpen] = useState(true)
  const [active, setActive] = useState(-1)
  const ref = useRef<HTMLInputElement>(null)
  /** 決めた・やめた後（続く blur で2回決めない） */
  const finished = useRef(false)
  const listId = useId()
  const items = useData().items
  const candidates = useMemo(() => {
    if (!open) return []
    const typed = text.trim()
    return requesterCandidates(items, Date.now(), typed)
      .filter((name) => name !== typed)
      .map((name) => ({ value: name, label: name }))
  }, [open, items, text])
  const shown = open && candidates.length > 0

  // 出したらすぐフォーカスする（カーソルは字の終わり）
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus({ preventScroll: true })
    const end = el.value.length
    el.setSelectionRange(end, end)
  }, [])

  const commit = (value: string, how: CommitHow) => {
    if (finished.current) return
    finished.current = true
    onCommit(limitChars(value.trim(), LIMITS.requester), how)
  }
  const cancel = () => {
    if (finished.current) return
    finished.current = true
    onCancel()
  }
  const latestCancel = useRef(cancel)
  latestCancel.current = cancel
  useEffect(() => {
    const el = ref.current
    return el ? registerFieldCancel(el, () => latestCancel.current()) : undefined
  }, [])

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!shown) {
        setOpen(true)
        return
      }
      e.preventDefault()
      const step = e.key === 'ArrowDown' ? 1 : -1
      setActive((i) => (i < 0 ? (step > 0 ? 0 : candidates.length - 1) : (i + step + candidates.length) % candidates.length))
      return
    }
    if (e.key === 'Escape') {
      if (composing(e)) return
      e.preventDefault()
      e.stopPropagation()
      cancel()
      return
    }
    if (e.key !== 'Enter' || composing(e) || e.ctrlKey || e.metaKey) return
    e.preventDefault()
    commit(shown && active >= 0 ? candidates[active].value : text, 'enter')
  }

  return (
    <>
      <input
        ref={ref}
        className={`input task-requester-input${className ? ` ${className}` : ''}`}
        value={text}
        role="combobox"
        aria-label={label}
        aria-autocomplete="list"
        aria-expanded={shown}
        aria-controls={shown ? listId : undefined}
        aria-activedescendant={shown && active >= 0 ? optionId(listId, active) : undefined}
        autoComplete="off"
        enterKeyHint="done"
        placeholder="依頼者"
        onChange={(e) => {
          setText(limitChars(e.target.value, LIMITS.requester))
          setOpen(true)
          setActive(-1)
        }}
        onClick={() => setOpen(true)}
        onBlur={() => commit(ref.current?.value ?? text, 'blur')}
        onKeyDown={onKeyDown}
        data-testid={testId}
      />
      {shown ? (
        <OptionList
          id={listId}
          anchor={ref.current}
          label="依頼者の候補"
          options={candidates}
          selected={null}
          active={active}
          onPick={(name) => commit(name, 'pick')}
          onClose={() => {
            setOpen(false)
            setActive(-1)
          }}
          testId={TASK_REQUESTER_LIST_TEST_ID}
        />
      ) : null}
    </>
  )
}
