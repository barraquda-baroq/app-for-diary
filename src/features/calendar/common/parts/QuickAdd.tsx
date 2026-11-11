// すばやく足す（docs/SPEC.md の 12.1・6.13・D31・D42・AMB-ITEMS-21・D44）。ウィークリーの各日・各段の「＋」、デイリーの各区切りの
// 「＋ 予定を足す」の行が、その場でこの1行の入力欄に替わる（画面が出す・閉じる）。
// - 件名だけを打って Enter で足す。開始日と区分は押した場所（date・kind）、締め切り日・時刻は無し、origin: 'calendar'・
//   listed: false、order は今（足した予定はその日・その段の時刻の無い1日の予定のいちばん後に出る。7.5）。細かい項目は後で詳細で
// - 足した後も開いたまま（空に戻り、フォーカスも残る）。足した予定は入力欄のすぐ上に出るので目立たせない
// - 日本語の変換中の Enter（isComposing・Safari の keyCode 229）と、空白だけの件名では足さない
// - Esc か入力欄の外を押すと閉じる（onClose。閉じたきっかけを渡すので、Esc の時は画面が「＋」の行へフォーカスを戻す）。Esc は
//   下の小さな画面などへ渡さない。キーボード（Tab）でフォーカスを外の物へ移した時も閉じる（Esc の効かない入力欄を開いたまま残さない）。
//   窓・アプリの切り替えで外れただけ（行き先の無い blur）では閉じない
// - 外を押して閉じる時は、押し終わってから閉じる（開発）: 押した時（pointerdown）にすぐ閉じると、入力欄が元の行に戻って下の物が
//   上へずれ（ウィークリーの S は入力欄 40px が「＋」の行 28px に戻る）、指を離した時（click）に指の下にあるのが押した物と違う物に
//   なる（違う予定の詳細が開く・違う予定が完了になる）。押した所からドラッグを始めた時（ウィークリー）も、並びが掴んだカードの下で
//   動かないようにする。そこで click・pointercancel の時（離してから CLICK_WAIT_MS たっても click が来ない時も）に閉じる。
//   押した物の操作（click）は、閉じる前の並びのままで決まる。押していない時（Esc・Tab）はすぐ閉じる
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

/** 離してから click を待つ長さ（ms。軽く押した時の click はすぐ来る。来ない時（長押し・なぞった・ドラッグした）はこれで閉じる） */
export const CLICK_WAIT_MS = 300

/** 閉じたきっかけ: Esc・入力欄の外を押し終えた・フォーカスを外の物へ移した（Tab など） */
export type QuickAddCloseReason = 'escape' | 'press' | 'focus'

export interface QuickAddProps {
  /** 足す日（開始日。'YYYY-MM-DD'） */
  date: string
  /** 足す区分 */
  kind: ItemKind
  /** 閉じる時（Esc・入力欄の外を押し終えた時・フォーカスを外へ移した時。1回だけ呼ぶ） */
  onClose: (reason: QuickAddCloseReason) => void
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
  /**
   * もう閉じると決めた（外を押した時は pointerdown と、続くフォーカスの移りの両方が来るので、1回だけ伝える。押し終わりを待って
   * いる間も true）
   */
  const closing = useRef(false)
  /** 指・マウスを押している（どこでも） */
  const pressed = useRef(false)
  /** 押し終わりを待っている時の、待つのをやめる関数 */
  const waiting = useRef<(() => void) | null>(null)

  /** 閉じる（1回だけ）。押している間は、押し終わる（click・pointercancel・離して CLICK_WAIT_MS）まで待つ。Esc は待たない */
  const close = (reason: QuickAddCloseReason) => {
    if (closing.current) return
    closing.current = true
    if (!pressed.current || reason === 'escape') {
      closeRef.current(reason)
      return
    }
    let timer: number | undefined
    const stop = () => {
      window.clearTimeout(timer)
      window.removeEventListener('click', finish, true)
      window.removeEventListener('pointercancel', finish, true)
      window.removeEventListener('pointerup', released, true)
      waiting.current = null
    }
    const finish = () => {
      stop()
      closeRef.current(reason)
    }
    const released = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(finish, CLICK_WAIT_MS)
    }
    window.addEventListener('click', finish, true)
    window.addEventListener('pointercancel', finish, true)
    window.addEventListener('pointerup', released, true)
    waiting.current = stop
  }
  /** Esc で閉じる時は、押し終わりを待っている閉じ方をやめてすぐ閉じる */
  const closeNow = (reason: QuickAddCloseReason) => {
    if (waiting.current) {
      waiting.current()
      closeRef.current(reason)
      return
    }
    close(reason)
  }

  // 開いたらすぐ打てるように（押した出来事の中で描くので、iPhone でもキーボードが開く）。見える所まで出す
  useLayoutEffect(() => {
    input.current?.focus({ preventScroll: true })
    input.current?.scrollIntoView({ block: 'nearest', behavior: scrollBehavior() })
  }, [])

  // 入力欄の外を押したら、押し終わってから閉じる（押した所の操作はそのまま。ほかの日の「＋」なら、そこの入力欄が開く）。
  // window の捕まえる段階で見る（押した物の pointerdown・mousedown（フォーカスの移り）より先に、押していると分かる）
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      pressed.current = true
      if (box.current && e.target instanceof Node && !box.current.contains(e.target)) close('press')
    }
    const onUp = () => {
      pressed.current = false
    }
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('pointerup', onUp, true)
    window.addEventListener('pointercancel', onUp, true)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('pointerup', onUp, true)
      window.removeEventListener('pointercancel', onUp, true)
      // 閉じた（画面が外した）・日が替わった時は、待つのをやめるだけ
      waiting.current?.()
    }
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
      closeNow('escape')
    }
  }

  // フォーカスが入力欄の外の物へ移った（Tab など。押している間の移りは、押し終わってから閉じる）
  const onBlur = (e: FocusEvent<HTMLInputElement>) => {
    const next = e.relatedTarget
    if (next instanceof Node && !box.current?.contains(next)) close('focus')
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
          // 入力欄へ戻った（押し終わりを待っている間は、そのまま閉じる）
          if (!waiting.current) closing.current = false
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
