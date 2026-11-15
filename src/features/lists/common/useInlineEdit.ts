// 3つのリストの行の、その場で直す欄（docs/SPEC.md の 3.6・13.3・14.2・15.2。開発・P3・P16）: Task List の件名・依頼者、Routine List の
// 件名、Favorite List の本文。各リストの行が使う:
//   const edit = useInlineEdit({ value: item.title, onSave: (t) => attempt(() => actions.updateItem(id, { title: t })) })
//   <button onClick={edit.start}>{title}</button>   →   edit.editing なら <textarea {...edit.inputProps} />
// - start は押した出来事の中で呼ぶ: 欄を出す描き直しをその場で済ませ（flushSync）、同じ出来事の中でフォーカスする（iPhone はそうで
//   ないとキーボードが出ない。P3）。カーソルは字の終わり
// - 保存するのは Enter（変換中の Enter は除く。P16）と、欄から離れた時（blur）。保存のボタンは無い（3.6）。複数行の欄（Favorite）は
//   PC の Enter が保存・Shift+Enter が改行、指の端末の Enter は改行（開発。multiline）。autosaveMs を渡すと、止まってからその長さで
//   打っている間も保存する（Favorite は 0.6秒。開発）
// - 空・空白だけにして離れた・Enter を押した時は保存せずに元に戻す（開発）。Esc は保存せずに元に戻して閉じる。前後の空白は落として
//   保存する（trim。Favorite の本文も。開発）。保存した値が今と同じ時は書かない
// - 打っている間の字（まだ保存していない物）は src/store/draftRegistry に届け、画面を閉じる・裏に回る時にも保存する（保存する物は
//   保存する。■34 の打ちかけを捨てる時も、その場の直しは捨てない）
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChangeEvent, KeyboardEvent } from 'react'
import { flushSync } from 'react-dom'
import { markDraftClean, markDraftDirty } from '../../../store/draftRegistry'
import { useMediaQuery } from '../../../ui/hooks'

export interface InlineEditOptions {
  /** 保存してある値（直している間に替わっても、打っている字はそのまま） */
  value: string
  /** 保存する（前後の空白を落とした、空でない値。今の値と同じ時は呼ばない） */
  onSave: (text: string) => void
  /** 複数行の欄（PC の Enter が保存・Shift+Enter が改行、指の端末の Enter は改行。Favorite の本文） */
  multiline?: boolean
  /** 打っている間も、止まってからこの長さ（ms）で保存する（Favorite の本文は 600。開発） */
  autosaveMs?: number
}

type Field = HTMLInputElement | HTMLTextAreaElement

export interface InlineEdit {
  editing: boolean
  /** 直し始める（押した出来事の中で呼ぶ） */
  start: () => void
  /** 保存せずにやめる（元に戻す） */
  cancel: () => void
  /** 欄に付ける */
  inputProps: {
    ref: (el: Field | null) => void
    value: string
    onChange: (e: ChangeEvent<Field>) => void
    onKeyDown: (e: KeyboardEvent<Field>) => void
    onBlur: () => void
  }
}

export function useInlineEdit({ value, onSave, multiline = false, autosaveMs }: InlineEditOptions): InlineEdit {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(value)
  const coarse = useMediaQuery('(pointer: coarse)')
  const field = useRef<Field | null>(null)
  const latest = useRef({ value, onSave, text, editing })
  latest.current = { value, onSave, text, editing }
  const registryKey = useRef(Symbol('inline-edit'))
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  /** 打っている字を保存する（空・空白だけ・同じ値は書かない）。保存した・書かなくてよかった時 true、空で戻した時 false */
  const save = useCallback((): boolean => {
    clearTimeout(timer.current)
    markDraftClean(registryKey.current)
    const t = latest.current.text.trim()
    if (t === '') return false
    if (t !== latest.current.value) latest.current.onSave(t)
    return true
  }, [])

  const stop = useCallback(() => {
    clearTimeout(timer.current)
    markDraftClean(registryKey.current)
    latest.current = { ...latest.current, editing: false }
    setEditing(false)
  }, [])

  const start = useCallback(() => {
    if (latest.current.editing) {
      field.current?.focus()
      return
    }
    latest.current = { ...latest.current, editing: true, text: latest.current.value }
    flushSync(() => {
      setText(latest.current.value)
      setEditing(true)
    })
    const el = field.current
    if (!el) return
    el.focus()
    const end = el.value.length
    el.setSelectionRange(end, end)
  }, [])

  const cancel = useCallback(() => {
    latest.current = { ...latest.current, text: latest.current.value }
    setText(latest.current.value)
    stop()
  }, [stop])

  /** 終える（保存して閉じる。空なら元に戻して閉じる） */
  const finish = useCallback(() => {
    if (!latest.current.editing) return
    if (!save()) {
      latest.current = { ...latest.current, text: latest.current.value }
      setText(latest.current.value)
    }
    stop()
  }, [save, stop])

  // 外れる時（行が消えた・幅が替わった）も、打っていた字は保存する
  useEffect(
    () => () => {
      if (latest.current.editing) save()
      clearTimeout(timer.current)
      markDraftClean(registryKey.current)
    },
    [save],
  )

  const inputProps: InlineEdit['inputProps'] = {
    ref: (el) => {
      field.current = el
    },
    value: text,
    onChange: (e) => {
      const next = e.target.value
      latest.current = { ...latest.current, text: next }
      setText(next)
      markDraftDirty(registryKey.current, () => {
        save()
      })
      if (autosaveMs !== undefined) {
        clearTimeout(timer.current)
        timer.current = setTimeout(() => {
          if (latest.current.text.trim() !== '') save()
        }, autosaveMs)
      }
    },
    onKeyDown: (e) => {
      if (e.key === 'Escape') {
        if (e.nativeEvent.isComposing || e.keyCode === 229) return
        e.preventDefault()
        e.stopPropagation()
        cancel()
        return
      }
      if (e.key !== 'Enter' || e.nativeEvent.isComposing || e.keyCode === 229) return
      // 複数行の欄: 指の端末の Enter と PC の Shift+Enter は改行
      if (multiline && (coarse || e.shiftKey)) return
      e.preventDefault()
      finish()
    },
    onBlur: finish,
  }

  return { editing, start, cancel, inputProps }
}
