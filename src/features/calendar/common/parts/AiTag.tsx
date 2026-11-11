// AI の札（docs/SPEC.md の 7.7・6.1・I6・D48・D26・AMB-CAL-15）。Claude が足した物（by が 'connector'）にだけ、枠だけの小さな札
// 「Claude」（ai が知らない値なら「AI」）を付ける。作者が手で作った物を Claude が直しても付けない（by は作った時のまま）。
// 札はカードの中の別のボタンで、押してもカードの詳細は開かない。押すと札の下に出どころのメモ（via）の小窓を出す
// （見た目と出方は操作メニュー PopupMenu と同じ。外を押す・Esc・Tab・スクロール・画面の幅の変更で閉じる）
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Item } from '../../../../domain/types'
import '../../../../ui/menu.css'
import { testIds } from '../testIds'
import { stopActivationKeys, stopPropagation as stop } from './events'
import { aiTagText, cls, hasAiTag } from './itemLook'
import './parts.css'

/** 画面の端からの余白・札との間（PopupMenu と同じ） */
const EDGE = 8
const GAP = 4

export interface AiTagProps {
  item: Pick<Item, 'id' | 'by' | 'ai' | 'via'>
  className?: string
}

export function AiTag({ item, className }: AiTagProps) {
  // 開いている間は札の要素（小窓を置く所）を持つ
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const popupId = useId()
  if (!hasAiTag(item)) return null
  const text = aiTagText(item)
  const open = anchor !== null
  return (
    <>
      <button
        type="button"
        className={cls('cp-ai', className)}
        aria-label={`${text} が足した予定（出どころのメモを見る）`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popupId : undefined}
        onClick={(e) => {
          e.stopPropagation()
          const el = e.currentTarget
          setAnchor((cur) => (cur ? null : el))
        }}
        onKeyDown={stopActivationKeys}
        data-testid={testIds.aiTag(item.id)}
      >
        {text}
      </button>
      {anchor ? (
        <ViaPopover
          id={popupId}
          anchor={anchor}
          heading={`${text} が足した予定`}
          via={item.via}
          onClose={() => setAnchor(null)}
          testId={`${testIds.aiTag(item.id)}-via`}
        />
      ) : null}
    </>
  )
}

interface ViaPopoverProps {
  id: string
  anchor: HTMLElement
  heading: string
  via: string | null
  onClose: () => void
  testId: string
}

/** 出どころのメモの小窓（札の下に右端を揃えて出す。下に入らなければ上） */
function ViaPopover({ id, anchor, heading, via, onClose, testId }: ViaPopoverProps) {
  const ref = useRef<HTMLDivElement>(null)
  const headId = useId()
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = anchor.getBoundingClientRect()
    const w = el.offsetWidth
    const h = el.offsetHeight
    const vw = window.innerWidth
    const vh = window.innerHeight
    let y = r.bottom + GAP
    if (y + h > vh - EDGE) y = r.top - h - GAP
    const x = r.right - w
    el.style.left = `${Math.max(EDGE, Math.min(x, vw - w - EDGE))}px`
    el.style.top = `${Math.max(EDGE, Math.min(y, vh - h - EDGE))}px`
    el.style.visibility = 'visible'
    el.focus({ preventScroll: true })
  }, [anchor])

  useEffect(() => {
    // Esc・Tab で閉じた時は札へフォーカスを戻す（外を押して閉じた時は、押した所のフォーカスのまま）
    const closeToAnchor = () => {
      closeRef.current()
      anchor.focus({ preventScroll: true })
    }
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node
      // 札を押した時は札の操作（開く・閉じる）に任せる
      if (anchor.contains(target) || ref.current?.contains(target)) return
      closeRef.current()
    }
    // Esc は捕捉の段階で受けて止める（同じ1回の Esc で、下の小さな画面や休みを付ける状態まで閉じない。いちばん上だけが閉じる）
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.isComposing) return
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        closeToAnchor()
      } else if (e.key === 'Tab' && ref.current?.contains(document.activeElement)) {
        e.preventDefault()
        closeToAnchor()
      }
    }
    const onScroll = (e: Event) => {
      if (e.target instanceof Node && ref.current?.contains(e.target)) return
      closeRef.current()
    }
    const openWidth = window.innerWidth
    const onResize = () => {
      if (window.innerWidth !== openWidth) closeRef.current()
    }
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('keydown', onKey, true)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('keydown', onKey, true)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
    }
  }, [anchor])

  // 小窓は body の下に出すが、React の出来事は札の親（カード・行）へ伝わるので、ここで止める（詳細を開く・掴むに渡さない）
  return createPortal(
    <div
      ref={ref}
      id={id}
      className="pm-menu cp-via"
      role="dialog"
      aria-labelledby={headId}
      tabIndex={-1}
      style={{ left: 0, top: 0, visibility: 'hidden' }}
      onClick={stop}
      onPointerDown={stop}
      onMouseDown={stop}
      onTouchStart={stop}
      onKeyDown={stop}
      onContextMenu={stop}
      data-testid={testId}
    >
      <p id={headId} className="cp-via-head">
        {heading}
      </p>
      <p className="cp-via-text">{via?.trim() ? via : '出どころのメモはありません'}</p>
    </div>,
    document.body,
  )
}
