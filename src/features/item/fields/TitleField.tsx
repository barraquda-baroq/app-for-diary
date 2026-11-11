// 件名の欄（docs/SPEC.md の 12.2 の 1・12.3・6.2・12.4）。1行の入力欄（改行は入れない）で、200字まで（コードポイントで数える。
// 上限を超えて打てない・貼れない）。長い件名は欄の幅で折り返して全部見せる（高さを伸ばす。S の幅でも切らない）ため textarea で作る
// （rows 1・Enter で改行しない・貼った改行は空白に）。登録の画面では開くとここにフォーカスする（Modal の initialFocus）
import { useRef, type KeyboardEvent } from 'react'
import { limitChars } from '../../../domain/itemInput'
import { LIMITS } from '../../../domain/types'
import { testIds } from '../../calendar/common/testIds'
import { oneLine } from '../itemForm'
import { useAutoGrow } from './useAutoGrow'

export interface TitleFieldProps {
  id: string
  value: string
  onChange: (title: string) => void
  /** 空の時に出す字（件名が空の記録の詳細では「（件名なし）」。D48） */
  placeholder?: string
  /** 欄を離れた・Enter を押した（詳細の画面で保存する所。WP9 の後半で使う） */
  onCommit?: () => void
}

/** 日本語の変換中の Enter（変換を決めるだけ。Safari は isComposing を付けず keyCode 229） */
const composing = (e: KeyboardEvent) => e.nativeEvent.isComposing || e.keyCode === 229

export function TitleField({ id, value, onChange, placeholder, onCommit }: TitleFieldProps) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useAutoGrow(ref, value)
  return (
    <textarea
      ref={ref}
      id={id}
      className="input it-title"
      rows={1}
      value={value}
      placeholder={placeholder}
      enterKeyHint="done"
      autoComplete="off"
      onChange={(e) => onChange(limitChars(oneLine(e.target.value), LIMITS.title))}
      onKeyDown={(e) => {
        // Enter で改行しない（1行の欄）。Ctrl・⌘+Enter（登録）は包む所が受けるので、出来事は止めない
        if (e.key !== 'Enter' || composing(e)) return
        e.preventDefault()
        if (onCommit && !e.ctrlKey && !e.metaKey) ref.current?.blur()
      }}
      onBlur={onCommit}
      data-testid={testIds.itemTitle}
    />
  )
}
