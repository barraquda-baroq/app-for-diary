// 欄の下に開く小窓（docs/SPEC.md の 12.2 の 3・4。D38）: 日付の欄の小さな月のカレンダー（L・M）、時刻の欄の 5分刻みの一覧、
// 依頼者の欄の候補。押した欄（anchor）の下に、左の端をそろえて開く（下に入らなければ上に）。登録・詳細の小さな画面（src/ui/Modal）の
// 上に出すので、body の直下に置き（Modal の外）、重なりの順は小さな画面より前（item.css の .it-pop）。
// - Esc は document の捕捉の段階で受けて止め、この小窓だけを閉じる（下の小さな画面は閉じない。AMB-ITEMS-32）。日本語の変換を取り消す
//   Esc では閉じない
// - 小窓と欄の外を押すと閉じる（欄を押した時は、欄の側に任せる）
// - 小さな画面の中をスクロールした・画面の大きさが変わった（キーボードの開閉を含む）時は、欄に付いたまま置き直す
// 出る時は pop-in 120ms（メニューと同じ。4.9）
import { useEffect, useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cls } from '../../calendar/common/parts/itemLook'

export interface PopoverProps {
  /** 開いた欄（この下に置く） */
  anchor: HTMLElement | null
  onClose: () => void
  children: ReactNode
  /** 読み上げの名前（role が dialog の時） */
  label?: string
  /** 小窓の役目（日付は dialog。一覧は中の listbox が役目を持つので省く） */
  role?: 'dialog'
  /** 欄と同じ幅にする（時刻・依頼者の一覧） */
  matchWidth?: boolean
  className?: string
  id?: string
  testId?: string
  /** 小窓の中のキー（Tab で閉じるなど） */
  onKeyDown?: (e: KeyboardEvent<HTMLDivElement>) => void
}

/** 画面の端からの余白 */
const EDGE = 8
/** 欄との間 */
const GAP = 4

/** 置く位置を測るまでは見せない（位置は描いた後に直接置く） */
const HIDDEN = { left: 0, top: 0, visibility: 'hidden' } as const

/** 欄の下（入らなければ上）に置く。見えている範囲（iPhone のキーボードの上）に収める */
function place(el: HTMLElement, anchor: HTMLElement, matchWidth: boolean): void {
  const r = anchor.getBoundingClientRect()
  if (matchWidth) el.style.minWidth = `${Math.round(r.width)}px`
  const w = el.offsetWidth
  const h = el.offsetHeight
  const vv = window.visualViewport
  const top = vv ? vv.offsetTop : 0
  const bottom = vv ? vv.offsetTop + vv.height : window.innerHeight
  const vw = window.innerWidth
  let y = r.bottom + GAP
  if (y + h > bottom - EDGE && r.top - GAP - h >= top + EDGE) y = r.top - GAP - h
  const x = Math.max(EDGE, Math.min(r.left, vw - w - EDGE))
  el.style.left = `${x}px`
  el.style.top = `${Math.max(top + EDGE, y)}px`
  el.style.visibility = 'visible'
}

export function Popover({
  anchor,
  onClose,
  children,
  label,
  role,
  matchWidth = false,
  className,
  id,
  testId,
  onKeyDown,
}: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useLayoutEffect(() => {
    if (ref.current && anchor) place(ref.current, anchor, matchWidth)
  })

  useEffect(() => {
    let frame = 0
    const follow = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        if (ref.current && anchor?.isConnected) place(ref.current, anchor, matchWidth)
      })
    }
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node
      if (ref.current?.contains(target) || anchor?.contains(target)) return
      closeRef.current()
    }
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape' || e.isComposing || e.keyCode === 229) return
      e.preventDefault()
      e.stopPropagation()
      closeRef.current()
    }
    const vv = window.visualViewport
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('keydown', onKey, true)
    window.addEventListener('scroll', follow, true)
    window.addEventListener('resize', follow)
    vv?.addEventListener('resize', follow)
    vv?.addEventListener('scroll', follow)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('keydown', onKey, true)
      window.removeEventListener('scroll', follow, true)
      window.removeEventListener('resize', follow)
      vv?.removeEventListener('resize', follow)
      vv?.removeEventListener('scroll', follow)
    }
  }, [anchor, matchWidth])

  return createPortal(
    <div
      ref={ref}
      id={id}
      className={cls('it-pop', className)}
      role={role}
      aria-label={role ? label : undefined}
      style={HIDDEN}
      onKeyDown={onKeyDown}
      data-testid={testId}
    >
      {children}
    </div>,
    document.body,
  )
}
