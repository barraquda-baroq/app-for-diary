// 元に戻す・やり直すのボタン（docs/SPEC.md の 7.13・3.7・3.10。22. の段階2の終わりの確かめ）。カレンダーの操作の列の右の端
// （S・M は［年｜月｜週｜日］と［＋］の列の右の端、L は［＋ 登録］の後）に、線のアイコンだけの小さなボタンを2つ並べる。出すのは
// ウィークリー・デイリーだけ（年・月では visibility: hidden で消し、ほかのボタンの位置を動かさない。D23）。
// - 読み上げとヒント（PC で載せた時）は「元に戻す（『会議』を移した）」「やり直す（『会議』を移した）」。戻す物・やり直す物が無い時は
//   薄くして押せない（aria-disabled。フォーカスは残す）
// - 押してもフォーカスを動かさない（開いているすばやく足すの入力欄は閉じず、打っている字も足さない。KEEP_QUICK_ADD）
// - キー（PC。3.10）: Ctrl+Z・⌘+Z で元に戻す、Ctrl+Shift+Z・⌘+Shift+Z・Ctrl+Y でやり直す。文字を打っている間（入力欄・メモの中。
//   そこではブラウザの字の元に戻す）・小さな画面やメニューを開いている間・ドラッグ中は効かない
// - 戻した・やり直した時は、何を当てたかのお知らせを［OK］を押すまで出し（src/store/undoStore.ts）、当てた予定・休みの日を
//   目立たせる。今の週・日に無ければ、今のモードのままその日へ移ってから（■26 の作者の答え。undoFeedback.ts）
import { useEffect } from 'react'
import { nextRedo, nextUndo } from '../../../domain/undo'
import { undoButtonLabel } from '../../../domain/itemText'
import { useCalendarUi } from '../../../store/uiStore'
import { redo, undo, useUndo } from '../../../store/undoStore'
import { RedoIcon, UndoIcon } from '../../../ui/icons'
import { IS_MAC } from '../../../ui/keys'
import { KEEP_QUICK_ADD } from './parts/QuickAdd'
import { testIds } from './testIds'
import type { CalendarMode } from './types'
import { useUndoFeedback } from './undoFeedback'

/** 文字を打つ所か（そこでは Ctrl/⌘+Z をブラウザの字の元に戻すに任せる） */
function isTextTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false
  if (t.isContentEditable) return true
  if (t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return true
  if (t instanceof HTMLInputElement) return !['button', 'checkbox', 'radio', 'submit', 'reset', 'range', 'color'].includes(t.type)
  return false
}

/** 押したキーが元に戻す・やり直すか（どちらでもなければ null） */
export function undoShortcut(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>, mac = IS_MAC) {
  const mod = mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey
  if (!mod || e.altKey) return null
  const key = e.key.toLowerCase()
  if (key === 'z') return e.shiftKey ? 'redo' : 'undo'
  if (key === 'y' && !mac && !e.shiftKey) return 'redo'
  return null
}

/** キーで元に戻す・やり直す（出している間だけ） */
function useUndoShortcuts(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent) => {
      const which = undoShortcut(e)
      if (!which || e.isComposing || e.defaultPrevented) return
      if (isTextTarget(e.target)) return
      // 小さな画面・確かめ・メニューを開いている間、掴んでいる間は効かせない
      if (document.querySelector('[aria-modal="true"], [role="menu"]')) return
      if (useCalendarUi.getState().dragging) return
      e.preventDefault()
      void (which === 'undo' ? undo() : redo())
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enabled])
}

export interface UndoButtonsProps {
  /** 今のモードと見ている日（戻した予定が今の期間に出ているか・無ければ今のモードのまま移る） */
  mode: CalendarMode
  viewed: string
  /** そのモードでは出さない（年・月。場所は残す） */
  hidden: boolean
  className?: string
}

export function UndoButtons({ mode, viewed, hidden, className }: UndoButtonsProps) {
  const past = useUndo((s) => nextUndo(s.stack))
  const future = useUndo((s) => nextRedo(s.stack))
  useUndoShortcuts(!hidden)
  useUndoFeedback(mode, viewed, !hidden)
  const undoLabel = undoButtonLabel('undo', past?.label)
  const redoLabel = undoButtonLabel('redo', future?.label)
  const keepAttr = { [KEEP_QUICK_ADD]: '' }
  return (
    <div
      className={['cal-undo', hidden && 'cal-tool-hidden', className].filter(Boolean).join(' ')}
      role="group"
      aria-label="元に戻す・やり直す"
      {...keepAttr}
    >
      <button
        type="button"
        className="icon-btn"
        aria-label={undoLabel}
        title={undoLabel}
        aria-disabled={past ? undefined : true}
        // 押してもフォーカスを動かさない（すばやく足すの入力欄を開いたまま）
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          if (past) void undo()
        }}
        data-testid={testIds.calUndo}
      >
        <UndoIcon />
      </button>
      <button
        type="button"
        className="icon-btn"
        aria-label={redoLabel}
        title={redoLabel}
        aria-disabled={future ? undefined : true}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          if (future) void redo()
        }}
        data-testid={testIds.calRedo}
      >
        <RedoIcon />
      </button>
    </div>
  )
}
