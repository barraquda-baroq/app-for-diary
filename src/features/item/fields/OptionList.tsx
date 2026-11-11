// 入力欄の下に開く選び肢の一覧（docs/SPEC.md の 12.2 の 4・5）: 時刻の欄の 5分刻みの一覧（TimeList。0:00〜23:55、終了は 0:05〜24:00）と、
// 依頼者の欄の候補（直近 365日に使った名前を8つまで。13.2）。フォーカスは入力欄に置いたまま（打ち続けられる。スマホのキーボードも
// 閉じない）、↑↓で選び肢を移り（入力欄の aria-activedescendant）、Enter・押すと選ぶ。一覧を押してもフォーカスを動かさない。
// 開いた時は anchorValue の所（時刻は値の所・開始の1時間後・9:00 の所。AMB-ITEMS-07）を一覧の上の端に見せる
import { useLayoutEffect, useRef } from 'react'
import { keepFocus } from '../../../ui/keys'
import { cls } from '../../calendar/common/parts/itemLook'
import { Popover } from './Popover'

export interface Option {
  value: string
  label: string
}

export interface OptionListProps {
  /** 一覧の id（入力欄の aria-controls） */
  id: string
  /** 開いた入力欄 */
  anchor: HTMLElement | null
  /** 一覧の読み上げの名前（「開始の時刻」など） */
  label: string
  options: readonly Option[]
  /** 今の値（選んだ印） */
  selected?: string | null
  /** ↑↓で移った選び肢（無ければ -1） */
  active: number
  /** 開いた時に上の端に見せる選び肢の値 */
  anchorValue?: string | null
  onPick: (value: string) => void
  onClose: () => void
  testId?: string
}

/** 選び肢の要素の id（入力欄の aria-activedescendant） */
export const optionId = (listId: string, i: number) => `${listId}-o${i}`

export function OptionList({
  id,
  anchor,
  label,
  options,
  selected,
  active,
  anchorValue,
  onPick,
  onClose,
  testId,
}: OptionListProps) {
  const ref = useRef<HTMLDivElement>(null)
  const scrolled = useRef(false)

  // 開いた時だけ、anchorValue の所を上の端に見せる（後で打っても一覧を動かさない）
  useLayoutEffect(() => {
    const list = ref.current
    if (!list || scrolled.current) return
    scrolled.current = true
    const i = anchorValue == null ? -1 : options.findIndex((o) => o.value === anchorValue)
    const el = i >= 0 ? (list.children[i] as HTMLElement | undefined) : undefined
    if (el) list.scrollTop = el.offsetTop
  })

  // ↑↓で移った選び肢を見える所へ
  useLayoutEffect(() => {
    const el = active >= 0 ? (ref.current?.children[active] as HTMLElement | undefined) : undefined
    el?.scrollIntoView?.({ block: 'nearest' })
  }, [active])

  return (
    <Popover anchor={anchor} onClose={onClose} matchWidth className="it-options-pop" testId={testId}>
      <div
        ref={ref}
        id={id}
        className="it-options"
        role="listbox"
        aria-label={label}
        // 押してもフォーカスを入力欄に残す（一覧はスクロールできる）
        onMouseDown={keepFocus}
      >
        {options.map((o, i) => (
          <div
            key={o.value}
            id={optionId(id, i)}
            role="option"
            aria-selected={i === active}
            className={cls('it-option', i === active && 'is-active', o.value === selected && 'is-current')}
            onClick={() => onPick(o.value)}
          >
            {o.label}
          </div>
        ))}
      </div>
    </Popover>
  )
}
