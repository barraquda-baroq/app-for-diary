// 件名の欄（docs/SPEC.md の 12.2 の 1・12.3・6.2・12.4）。1行の入力欄（改行は入れない）で、200字まで（コードポイントで数える。
// 上限を超えて打てない・貼れない）。長い件名は欄の幅で折り返して全部見せる（高さを伸ばす。S の幅でも切らない）ため textarea で作る
// （rows 1・Enter で改行しない・貼った改行は空白に）。登録の画面では開くとここにフォーカスする（Modal の initialFocus）。
// - 登録の画面（autosave なし）: 打つたびに onChange（包む画面が今の値を持つ）
// - 詳細の画面（autosave）: 0.6秒止まった時・離れた時・Enter で onChange（保存。fields/useAutosave.ts）。件名は空にできないので、
//   空（空白だけ）のまま止まっても保存せず、離れた時に元の件名に戻す（12.3・ITEMS-004・D48。件名が空の記録は空のまま）
import { useRef, type KeyboardEvent } from 'react'
import { limitChars } from '../../../domain/itemInput'
import { LIMITS } from '../../../domain/types'
import { testIds } from '../../calendar/common/testIds'
import { oneLine } from '../itemForm'
import { sameTrimmed, useAutosave } from './useAutosave'
import { useAutoGrow } from './useAutoGrow'

export interface TitleFieldProps {
  id: string
  /** 今の件名（詳細の画面では保存した件名） */
  value: string
  /** 打った（登録の画面）・保存する（詳細の画面。空の件名では呼ばない） */
  onChange: (title: string) => void
  /** 空の時に出す字（件名が空の記録の詳細では「（件名なし）」。D48） */
  placeholder?: string
  /** 詳細の画面: 直したそばから自動で保存する */
  autosave?: boolean
}

/** 日本語の変換中の Enter（変換を決めるだけ。Safari は isComposing を付けず keyCode 229） */
const composing = (e: KeyboardEvent) => e.nativeEvent.isComposing || e.keyCode === 229

export function TitleField({ id, value, onChange, placeholder, autosave = false }: TitleFieldProps) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const auto = useAutosave(value, onChange, { same: sameTrimmed, revertBlank: true })
  const text = autosave ? auto.draft : value
  useAutoGrow(ref, text)
  return (
    <textarea
      ref={ref}
      id={id}
      className="input it-title"
      rows={1}
      value={text}
      placeholder={placeholder}
      enterKeyHint="done"
      autoComplete="off"
      onChange={(e) => {
        const v = limitChars(oneLine(e.target.value), LIMITS.title)
        if (autosave) auto.change(v)
        else onChange(v)
      }}
      onKeyDown={(e) => {
        // Enter で改行しない（1行の欄）。Ctrl・⌘+Enter（登録）は包む所が受けるので、出来事は止めない
        if (e.key !== 'Enter' || composing(e)) return
        e.preventDefault()
        if (autosave && !e.ctrlKey && !e.metaKey) ref.current?.blur()
      }}
      onBlur={autosave ? auto.commit : undefined}
      {...(autosave ? auto.composition : {})}
      data-testid={testIds.itemTitle}
    />
  )
}
