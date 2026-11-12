// 依頼者の欄（docs/SPEC.md の 12.2 の 3・13.2・12.4）。0〜60字（コードポイントで数える。上限を超えて打てない・貼れない）。
// フォーカスすると、直近 365日に作った予定・タスクの依頼者を、使った回数の多い順（同じなら最後に使った順）に8つまで候補として欄の下に
// 出し、打った字で前方一致に絞る（D49・AMB-ITEMS-28。src/domain/requesters.ts）。↑↓・押す・Enter で選ぶ。Esc は候補だけを閉じる。
// - 登録の画面（autosave なし）: 打つたびに onChange
// - 詳細の画面（autosave）: 0.6秒止まった時・離れた時・候補を選んだ時に onChange（保存。fields/useAutosave.ts）
import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { limitChars } from '../../../domain/itemInput'
import { requesterCandidates } from '../../../domain/requesters'
import { LIMITS } from '../../../domain/types'
import { useData } from '../../../store/appStore'
import { testIds } from '../../calendar/common/testIds'
import { optionId, OptionList } from './OptionList'
import { sameTrimmed, useAutosave } from './useAutosave'

export interface RequesterFieldProps {
  id: string
  value: string
  onChange: (requester: string) => void
  /** 詳細の画面: 直したそばから自動で保存する */
  autosave?: boolean
}

/** 候補の一覧の data-testid */
export const REQUESTER_LIST_TEST_ID = 'item-requester-list'

const composing = (e: KeyboardEvent) => e.nativeEvent.isComposing || e.keyCode === 229

export function RequesterField({ id, value, onChange, autosave = false }: RequesterFieldProps) {
  const auto = useAutosave(value, onChange, { same: sameTrimmed })
  const text = autosave ? auto.draft : value
  const set = (v: string) => (autosave ? auto.change(v) : onChange(v))
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const ref = useRef<HTMLInputElement>(null)
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

  const close = () => {
    setOpen(false)
    setActive(-1)
  }
  const pick = (name: string) => {
    set(name)
    if (autosave) auto.flush()
    close()
  }

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
    if (e.key !== 'Enter' || composing(e) || e.ctrlKey || e.metaKey) return
    e.preventDefault()
    if (shown && active >= 0) pick(candidates[active].value)
    else {
      close()
      if (autosave) auto.commit()
    }
  }

  return (
    <div className="it-field">
      <label className="it-field-label" htmlFor={id}>
        依頼者
      </label>
      <input
        ref={ref}
        id={id}
        className="input"
        value={text}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={shown}
        aria-controls={shown ? listId : undefined}
        aria-activedescendant={shown && active >= 0 ? optionId(listId, active) : undefined}
        autoComplete="off"
        enterKeyHint="done"
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onChange={(e) => {
          set(limitChars(e.target.value, LIMITS.requester))
          setOpen(true)
          setActive(-1)
        }}
        onBlur={() => {
          close()
          if (autosave) auto.commit()
        }}
        onKeyDown={onKeyDown}
        {...(autosave ? auto.composition : {})}
        data-testid={testIds.itemRequester}
      />
      {shown ? (
        <OptionList
          id={listId}
          anchor={ref.current}
          label="依頼者の候補"
          options={candidates}
          selected={null}
          active={active}
          onPick={pick}
          onClose={close}
          testId={REQUESTER_LIST_TEST_ID}
        />
      ) : null}
    </div>
  )
}
