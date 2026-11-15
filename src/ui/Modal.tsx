// 小さな画面（L は真ん中・S/M は下からのシート）。NS の src/ui/Modal.tsx から。段階2で、予定の登録・詳細の画面の見た目
// （区分の地・ラベルの色の帯・ディープダークの題の左の区分のアイコン。docs/SPEC.md の 4.3・12.2・12.3）のための印を足した（動きは同じ）。
// Esc・Tab を聞き始めるのと、開いた時に中へフォーカスを移すのは、描いたすぐ後（useLayoutEffect。ブラウザが画面を描く前）にする
// （NS は useEffect。開いた直後に押した Esc を、聞き始める前で落とさないように。開発）。ただし、開いた物（メニューの項目など）が同じ
// 描画で外れてフォーカスが body に落ちている時は、中へ移すのは NS と同じ時（useEffect）にする: ほかの部品がフォーカスを戻し終えて
// から（メニューは開いたボタンへ戻す）そこを閉じた後に戻る先にする（削除の確かめを閉じると「…」へ戻る）。
// 段階3で、出し方 placement の side（docs/SPEC.md の 3.6・3.8）を足した: L では右の列（[data-testid=side-column]）の上に重ねるパネル
// （右の列と同じ所・幅 300px・高さ。右から 180ms で出る。視差効果を減らす設定では動かさない）、S・M はほかと同じ下からのシート。
// どちらにするかは描くたびに幅の区分で決めるので、開いたまま幅を替えても閉じずに出し方だけが替わる（中の物は作り直さない）。
// パネルの後ろの背景は透明で、画面いっぱいに敷く（外を押すと閉じ、押した出来事は背景が受ける: 下の物は押されない）。Esc・Tab・
// 中へのフォーカス・閉じた後に戻す先はほかの出し方と同じ（いちばん上の物だけが Esc を聞く・Tab は中を回る）
import { useEffect, useId, useLayoutEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { ItemKind } from '../domain/types'
import { useWidthClass } from './hooks'
import { XIcon } from './icons'
import './panel.css'

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
  /** 題の列の［×］の読み上げ（既定「閉じる」。アプリを閉じるかの確かめでは、［閉じる］のボタンと分けて「キャンセル」） */
  closeLabel?: string
  /**
   * 出し方（docs/SPEC.md の 3.6・3.8）。auto（既定）は L で真ん中・S/M で下からのシート。side は L で右の列の上に重ねるパネル
   * （Task List の「タスク」・ルーチン・やりたいことの［詳しく］。S/M は下からのシート）
   */
  placement?: 'auto' | 'side'
}

/** 開いているモーダルの重なり（いちばん上だけが Esc と Tab を扱う） */
const stack: symbol[] = []

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** 開いた時にフォーカスする要素（initialFocus、無ければ最初の入力欄、それも無ければ最初のボタン） */
function focusInside(el: HTMLElement | null, initialFocus: string | undefined): void {
  const target =
    (initialFocus && el?.querySelector<HTMLElement>(initialFocus)) ||
    el?.querySelector<HTMLElement>('input:not([type=hidden]), textarea, select') ||
    el?.querySelector<HTMLElement>('button')
  target?.focus()
}

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

/** パネルを重ねる右の列（L の TopPage の aside） */
const SIDE_COLUMN = '[data-testid="side-column"]'
/** 右の列が無い時のパネルの幅と、画面の端からの間（px） */
const SIDE_FALLBACK = { width: 300, gap: 16 }

/**
 * パネル（.modal.is-side）を右の列の箱に合わせる（--panel-top・left・width・height。右の列が無ければ画面の右の端から SIDE_FALLBACK）。
 * 右の列とそれを包む物の大きさ・ウインドウの大きさが替わるたびと、合わせた次の描画で合わせ直す。返す関数で見張るのをやめ、合わせた物を外す
 */
function fitSidePanel(el: HTMLElement): () => void {
  const fit = () => {
    const column = document.querySelector<HTMLElement>(SIDE_COLUMN)
    const r = column?.getBoundingClientRect()
    const box =
      r && r.width > 0
        ? { top: r.top, left: r.left, width: r.width, height: r.height }
        : {
            top: SIDE_FALLBACK.gap,
            left: window.innerWidth - SIDE_FALLBACK.width - SIDE_FALLBACK.gap,
            width: SIDE_FALLBACK.width,
            height: window.innerHeight - SIDE_FALLBACK.gap * 2,
          }
    for (const [name, px] of Object.entries(box)) el.style.setProperty(`--panel-${name}`, `${Math.round(px)}px`)
  }
  fit()
  const column = document.querySelector(SIDE_COLUMN)
  const observer = typeof ResizeObserver === 'undefined' || !column ? null : new ResizeObserver(fit)
  if (column) observer?.observe(column)
  // 右の列の大きさは同じまま位置だけが動く時（幅の区分が替わった直後に、外の左右の余白が後から替わる）も合わせ直す: 右の列を包む物の
  // 大きさも見て、次に描く時にももう一度合わせる
  if (column?.parentElement) observer?.observe(column.parentElement)
  const frame = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(fit) : 0
  window.addEventListener('resize', fit)
  return () => {
    if (frame) cancelAnimationFrame(frame)
    observer?.disconnect()
    window.removeEventListener('resize', fit)
    for (const name of ['top', 'left', 'width', 'height']) el.style.removeProperty(`--panel-${name}`)
  }
}

/** 汎用モーダル。Esc・背景クリックで閉じる。スマホでは下からのシートになる（side は L で右の列の上のパネル） */
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
  closeLabel = '閉じる',
  placement = 'auto',
}: ModalProps) {
  const ref = useRef<HTMLDivElement>(null)
  // L の時だけ右の列の上のパネル（描くたびに決める: 幅を替えても閉じずに出し方だけが替わる）
  const side = useWidthClass() === 'L' && placement === 'side'
  const titleId = useId()
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  /** 閉じた時にフォーカスを戻す先（開いた時にフォーカスのあった所） */
  const prevRef = useRef<HTMLElement | null>(null)
  /** 中へフォーカスを移すのを useEffect まで待っている（開いた物が外れて、フォーカスが body に落ちていた） */
  const deferFocus = useRef(false)

  useLayoutEffect(() => {
    const id = Symbol('modal')
    stack.push(id)
    if (stack.length === 1) setBackgroundLocked(true)
    const isTop = () => stack[stack.length - 1] === id

    const el = ref.current
    const opener = document.activeElement as HTMLElement | null
    deferFocus.current = !opener || opener === document.body
    prevRef.current = opener
    if (!deferFocus.current) focusInside(el, initialFocus)
    const onKey = (e: KeyboardEvent) => {
      if (!isTop()) return
      // 日本語の変換を取り消す Esc（isComposing・Safari は変換の終わりの後に keyCode 229 で来る）では閉じない（src/ui/keys.ts と同じ）
      if (e.key === 'Escape' && !(e.isComposing || e.keyCode === 229)) {
        e.stopPropagation()
        onCloseRef.current()
        return
      }
      // Tab でダイアログの外へ出ないようにする（最後の次は最初へ、最初の前は最後へ）。見えている物だけを数える（visibility: hidden の
      // 畳んだ中身も見えない物にする。checkVisibility の無いブラウザは offsetParent で見る）
      if (e.key === 'Tab' && el) {
        const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
          (x) => (x.checkVisibility?.({ visibilityProperty: true }) ?? x.offsetParent !== null) || x === document.activeElement,
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
      prevRef.current?.focus?.()
    }
  }, [initialFocus])

  // パネルの間は右の列の箱に合わせる（ブラウザが描く前に。シートに替わったら外す）
  useLayoutEffect(() => {
    const el = ref.current
    if (!side || !el) return
    return fitSidePanel(el)
  }, [side])

  // 開いた物が外れてフォーカスが body に落ちていた時: ほかの部品の後片付け（メニューが開いたボタンへ戻す）の後に、戻る先を決めて中へ移す
  useEffect(() => {
    if (!deferFocus.current) return
    deferFocus.current = false
    prevRef.current = document.activeElement as HTMLElement | null
    focusInside(ref.current, initialFocus)
  }, [initialFocus])

  return createPortal(
    <div
      className={side ? 'modal-backdrop is-side' : 'modal-backdrop'}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={ref}
        className={['modal', wide && 'wide', dataLabel && 'label-band', side && 'is-side panel-in', className]
          .filter(Boolean)
          .join(' ')}
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
            aria-label={closeLabel}
            title={closeLabel === '閉じる' ? undefined : closeLabel}
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
