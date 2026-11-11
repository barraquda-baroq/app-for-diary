// 小さな画面（L は真ん中・S/M は下からのシート）。NS の src/ui/Modal.tsx から。段階2で、予定の登録・詳細の画面の見た目
// （区分の地・ラベルの色の帯・ディープダークの題の左の区分のアイコン。docs/SPEC.md の 4.3・12.2・12.3）のための印を足した（動きは同じ）
import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { ItemKind } from '../domain/types'
import { XIcon } from './icons'

export interface ModalProps {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
  /** 開いた時にフォーカスする要素のセレクタ（省略時は最初の入力欄） */
  initialFocus?: string
  /** 今は閉じられない（処理中など）。× ボタンを押せない見た目にする（onClose 側で何もしないようにしておくこと） */
  closeDisabled?: boolean
  /** .modal に足すクラス（画面ごとの CSS で地の色などを決める） */
  className?: string
  /** .modal の data-testid */
  testId?: string
  /** 予定の区分（data-kind。中では --kind-sheet などが区分の色になる。src/styles.css の [data-kind]） */
  dataKind?: ItemKind
  /**
   * ラベルの色のキー（src/domain/labels.ts の LabelKey。data-label と .label-band で上の辺に 6px の帯を付ける。null・省くと帯なし。
   * 予定の label は知らない値も残す文字なので string で受ける）
   */
  dataLabel?: string | null
  /** 題の左に添える物（ディープダークの区分のアイコンなど。読み上げない） */
  titleIcon?: ReactNode
}

/** 開いているモーダルの重なり（いちばん上だけが Esc と Tab を扱う） */
const stack: symbol[] = []

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** モーダルが開いている間は、後ろの画面を操作・読み上げ・スクロールできないようにする */
function setBackgroundLocked(locked: boolean): void {
  const root = document.getElementById('root')
  if (root) {
    root.inert = locked
    if (locked) root.setAttribute('aria-hidden', 'true')
    else root.removeAttribute('aria-hidden')
  }
  document.body.style.overflow = locked ? 'hidden' : ''
}

/** 汎用モーダル。Esc・背景クリックで閉じる。スマホでは下からのシートになる */
export function Modal({
  title,
  onClose,
  children,
  footer,
  wide,
  initialFocus,
  closeDisabled,
  className,
  testId,
  dataKind,
  dataLabel,
  titleIcon,
}: ModalProps) {
  const ref = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    const id = Symbol('modal')
    stack.push(id)
    if (stack.length === 1) setBackgroundLocked(true)
    const isTop = () => stack[stack.length - 1] === id

    const prev = document.activeElement as HTMLElement | null
    const el = ref.current
    const target =
      (initialFocus && el?.querySelector<HTMLElement>(initialFocus)) ||
      el?.querySelector<HTMLElement>('input:not([type=hidden]), textarea, select') ||
      el?.querySelector<HTMLElement>('button')
    target?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (!isTop()) return
      // 日本語の変換を取り消す Esc（isComposing・Safari は変換の終わりの後に keyCode 229 で来る）では閉じない（src/ui/keys.ts と同じ）
      if (e.key === 'Escape' && !(e.isComposing || e.keyCode === 229)) {
        e.stopPropagation()
        onCloseRef.current()
        return
      }
      // Tab でダイアログの外へ出ないようにする（最後の次は最初へ、最初の前は最後へ）
      if (e.key === 'Tab' && el) {
        const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
          (x) => x.offsetParent !== null || x === document.activeElement,
        )
        if (items.length === 0) return
        const first = items[0]
        const last = items[items.length - 1]
        const active = document.activeElement as HTMLElement | null
        if (e.shiftKey && (active === first || !el.contains(active))) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && (active === last || !el.contains(active))) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      const i = stack.indexOf(id)
      if (i >= 0) stack.splice(i, 1)
      if (stack.length === 0) setBackgroundLocked(false)
      prev?.focus?.()
    }
  }, [initialFocus])

  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={ref}
        className={['modal', wide && 'wide', dataLabel && 'label-band', className].filter(Boolean).join(' ')}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid={testId}
        data-kind={dataKind}
        data-label={dataLabel ?? undefined}
      >
        <div className="modal-head">
          <h2 id={titleId}>
            {titleIcon ? (
              <span className="modal-title-icon" aria-hidden="true">
                {titleIcon}
              </span>
            ) : null}
            {title}
          </h2>
          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
            aria-label="閉じる"
            // disabled にするとフォーカスが外れるので、押せないことは aria-disabled で伝える
            aria-disabled={closeDisabled || undefined}
            data-testid="modal-close"
          >
            <XIcon />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-foot">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  )
}
