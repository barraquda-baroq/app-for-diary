// すばやく足す（docs/SPEC.md の 12.1・6.13・D31・D42・AMB-ITEMS-21・D44）。ウィークリーの各日・各段の「＋」、デイリーの各区切りの
// 「＋ 予定を足す」の行が、その場でこの1行の入力欄に替わる（画面が出す・閉じる）。
// - 件名だけを打って Enter で足す。開始日と区分は押した場所（date・kind）、締め切り日・時刻は無し、origin: 'calendar'・
//   listed: false、order は今（足した予定はその日・その段の時刻の無い1日の予定のいちばん後に出る。7.5）。細かい項目は後で詳細で
// - 足した後も開いたまま（空に戻り、フォーカスも残る）。足した予定は入力欄のすぐ上に出るので目立たせない
// - 日本語の変換中の Enter（isComposing・Safari の keyCode 229）と、空白だけの件名では足さない
// - Esc か入力欄の外を押すと閉じる（onClose）。Esc は下の小さな画面などへ渡さない。キーボード（Tab）でフォーカスを外の物へ
//   移した時も閉じる（Esc の効かない入力欄を開いたまま残さない）。窓・アプリの切り替えで外れただけ（行き先の無い blur）では閉じない
// - 書きかけは diary-studio:draft:quick:{日付}:{区分} に控え（閉じても残し、同じ日・同じ区分で開き直すと戻る）、足したら消す
import { useEffect, useLayoutEffect, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react'
import { shortDateLabel } from '../../../../domain/dates'
import { ITEM_KIND_LABELS } from '../../../../domain/trash'
import type { ItemKind } from '../../../../domain/types'
import { actions } from '../../../../store/actions'
import { quickDraftKey, readLocal, writeLocal } from '../../../../store/localDrafts'
import { attempt } from '../../../../store/uiStore'
import { scrollBehavior } from '../../../../ui/motion'
import { testIds } from '../testIds'
import { cls } from './itemLook'
import './parts.css'

export interface QuickAddProps {
  /** 足す日（開始日。'YYYY-MM-DD'） */
  date: string
  /** 足す区分 */
  kind: ItemKind
  /** Esc・入力欄の外を押した時 */
  onClose: () => void
  className?: string
}

/** 変換を決める Enter か（React の出来事は変換中かを持たないので元の出来事を見る。Safari は keyCode 229） */
function composing(e: KeyboardEvent): boolean {
  return e.nativeEvent.isComposing || e.keyCode === 229
}

export function QuickAdd({ date, kind, onClose, className }: QuickAddProps) {
  const key = quickDraftKey(date, kind)
  // 書きかけ（日付か区分が替わったら、その日・その区分の書きかけを読み直す）
  const [draft, setDraft] = useState(() => ({ key, text: readLocal(key) ?? '' }))
  if (draft.key !== key) setDraft({ key, text: readLocal(key) ?? '' })
  const text = draft.key === key ? draft.text : ''
  /** 足した数（足した予定が描かれた後に、入力欄を見える所に残すため） */
  const [added, setAdded] = useState(0)
  const box = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  /** もう閉じると伝えた（外を押した時は pointerdown と、続くフォーカスの移りの両方が来るので、1回だけ伝える） */
  const closing = useRef(false)
  const close = () => {
    if (closing.current) return
    closing.current = true
    closeRef.current()
  }

  // 開いたらすぐ打てるように（押した出来事の中で描くので、iPhone でもキーボードが開く）。見える所まで出す
  useLayoutEffect(() => {
    input.current?.focus({ preventScroll: true })
    input.current?.scrollIntoView({ block: 'nearest', behavior: scrollBehavior() })
  }, [])

  // 入力欄の外を押したら閉じる（押した所の操作はそのまま。ほかの日の「＋」なら、そこの入力欄が開く）
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (box.current && e.target instanceof Node && !box.current.contains(e.target)) close()
    }
    document.addEventListener('pointerdown', onDown, true)
    return () => document.removeEventListener('pointerdown', onDown, true)
  }, [])

  // 足した予定の分だけ入力欄が下へ動くので、描いた後に見える所に残す
  useLayoutEffect(() => {
    if (added) input.current?.scrollIntoView({ block: 'nearest', behavior: scrollBehavior() })
  }, [added])

  const change = (next: string) => {
    setDraft({ key, text: next })
    // 空白だけの書きかけは控えない
    writeLocal(key, next.trim() ? next : null)
  }

  const add = () => {
    if (!text.trim()) return
    const id = attempt(() => actions.addItem({ origin: 'calendar', title: text, kind, start: date }))
    if (!id) return
    setDraft({ key, text: '' })
    setAdded((n) => n + 1)
    writeLocal(key, null)
    input.current?.focus({ preventScroll: true })
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (composing(e)) return
    if (e.key === 'Enter') {
      e.preventDefault()
      add()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      close()
    }
  }

  // フォーカスが入力欄の外の物へ移った（Tab など）
  const onBlur = (e: FocusEvent<HTMLInputElement>) => {
    const next = e.relatedTarget
    if (next instanceof Node && !box.current?.contains(next)) close()
  }

  return (
    <div ref={box} className={cls('cp-quick', className)} data-kind={kind}>
      <input
        ref={input}
        className="input cp-quick-input"
        type="text"
        value={text}
        onChange={(e) => change(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => {
          closing.current = false
        }}
        onBlur={onBlur}
        placeholder="件名"
        aria-label={`${shortDateLabel(date)}の${ITEM_KIND_LABELS[kind]}の予定を足す`}
        enterKeyHint="enter"
        autoComplete="off"
        data-testid={testIds.quickAddInput}
      />
    </div>
  )
}
