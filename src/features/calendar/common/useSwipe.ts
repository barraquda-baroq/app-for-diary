// 指で左右になぞった時に前後の期間へ移る（docs/SPEC.md の 3.7・9.4。FRAME-073〜075）。S・M のイヤー・マンスリー・デイリーの
// カレンダーの中だけで、指の操作（pointerType が touch）だけを拾う（マウス・ペンではしない）。ウィークリーでは付けない。
// 縦のスクロールは邪魔しない: 付けている間は CSS の touch-action: pan-y（frame.css の .cal-body.is-swipe）で、縦はブラウザに
// スクロールさせ、横の動きだけを受け取る（縦にスクロールし始めるとブラウザが pointercancel を送るので、その指は数えない）。
// 長押ししてから動かした指（ドラッグの掴み方）はなぞったとみなさない。決まり（60px・30°・400ms・8px）は swipe.ts
import { useEffect, useRef, type RefObject } from 'react'
import { isHold, swipeDirection, SWIPE_SLOP_PX } from './swipe'

/** 要素の中で指を左右になぞったら onSwipe（左へなぞる＝1（次）、右へなぞる＝-1（前））。enabled が false の間は何もしない */
export function useSwipe(ref: RefObject<HTMLElement | null>, enabled: boolean, onSwipe: (dir: 1 | -1) => void): void {
  const handler = useRef(onSwipe)
  handler.current = onSwipe
  useEffect(() => {
    const el = ref.current
    if (!el || !enabled) return
    let start: { id: number; x: number; y: number; at: number; moved: boolean } | null = null
    const down = (e: PointerEvent) => {
      // 2本目の指（拡大・縮小）が触れたらやめる
      if (e.pointerType !== 'touch' || !e.isPrimary) {
        start = null
        return
      }
      start = { id: e.pointerId, x: e.clientX, y: e.clientY, at: e.timeStamp, moved: false }
    }
    const move = (e: PointerEvent) => {
      if (!start || start.moved || e.pointerId !== start.id) return
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) <= SWIPE_SLOP_PX) return
      start.moved = true
      // 止まっていた時間が長ければ長押し（なぞったとみなさない）
      if (isHold(e.timeStamp - start.at)) start = null
    }
    const up = (e: PointerEvent) => {
      if (!start || e.pointerId !== start.id) return
      const dir = swipeDirection(e.clientX - start.x, e.clientY - start.y)
      start = null
      if (dir) handler.current(dir)
    }
    const cancel = (e: PointerEvent) => {
      if (start && e.pointerId === start.id) start = null
    }
    el.addEventListener('pointerdown', down)
    // 動かす・離すのは、押した要素が描き直しで外れた後のこともあるので document で聞く
    document.addEventListener('pointermove', move, { passive: true })
    document.addEventListener('pointerup', up)
    document.addEventListener('pointercancel', cancel)
    return () => {
      el.removeEventListener('pointerdown', down)
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerup', up)
      document.removeEventListener('pointercancel', cancel)
    }
  }, [ref, enabled])
}
