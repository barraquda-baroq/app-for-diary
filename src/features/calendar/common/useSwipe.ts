// 指で左右になぞった時に前後の期間へ移る（docs/SPEC.md の 3.7・9.4・10.。FRAME-073〜075）。S・M のカレンダーの中だけ（どのモードでも）で、
// 指の操作（pointerType が touch）だけを拾う（マウス・ペンではしない）。
// 縦のスクロールは邪魔しない: 付けている間は CSS の touch-action: pan-y（frame.css の .cal-body.is-swipe）で、縦はブラウザに
// スクロールさせ、横の動きだけを受け取る（縦にスクロールし始めるとブラウザが pointercancel を送るので、その指は数えない）。
// 長押ししてから動かした指（ドラッグの掴み方）はなぞったとみなさない。決まり（60px・30°・400ms・8px）は swipe.ts。
// なぞったとみなさない時（ウィークリーでなぞれるようにした時に足した。22. の段階2の終わりの確かめ。どのモードでも同じ）:
// - ドラッグ中・ドラッグした指（掴んだ物に dnd-kit が付ける data-dnd-dragging。指を離した後の動きも数えない）
// - 文字を打っている間（すばやく足すの入力欄などにフォーカスがある。押した所が入力欄の時も）
// - 横に動かす物の上から押した時（入力欄・横にスクロールできる所。狭い L のウィークリーなど）
import { useEffect, useRef, type RefObject } from 'react'
import { dragActive } from './pageTurnDom'
import { isHold, swipeDirection, SWIPE_SLOP_PX } from './swipe'

/** 文字・値を打つ・選ぶ欄でない input の種類（押すだけの物。この上から押してもなぞれる） */
const PRESS_ONLY_INPUTS = new Set(['button', 'checkbox', 'radio', 'submit', 'reset', 'image', 'color', 'file', 'hidden'])

/** 文字・値を打つ・選ぶ欄か（入力欄・複数行・選ぶ欄・範囲・書ける要素） */
export function isTextEntry(el: Element | null): boolean {
  if (!(el instanceof HTMLElement)) return false
  if (el.isContentEditable) return true
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true
  return el instanceof HTMLInputElement && !PRESS_ONLY_INPUTS.has(el.type)
}

/** 押した所から root まで（root は含めない）に、横に動かす物（文字を打つ欄・横にスクロールできる所）があるか */
export function needsSideways(target: EventTarget | null, root: HTMLElement): boolean {
  for (let el = target instanceof Element ? target : null; el && el !== root; el = el.parentElement) {
    if (isTextEntry(el)) return true
    if (el.scrollWidth > el.clientWidth + 1) {
      const x = getComputedStyle(el).overflowX
      if (x === 'auto' || x === 'scroll') return true
    }
  }
  return false
}

/** 要素の中で指を左右になぞったら onSwipe（左へなぞる＝1（次）、右へなぞる＝-1（前））。enabled が false の間は何もしない */
export function useSwipe(ref: RefObject<HTMLElement | null>, enabled: boolean, onSwipe: (dir: 1 | -1) => void): void {
  const handler = useRef(onSwipe)
  handler.current = onSwipe
  useEffect(() => {
    const el = ref.current
    if (!el || !enabled) return
    let start: { id: number; x: number; y: number; at: number; moved: boolean } | null = null
    const down = (e: PointerEvent) => {
      start = null
      // 2本目の指（拡大・縮小）が触れたらやめる
      if (e.pointerType !== 'touch' || !e.isPrimary) return
      // 文字を打っている間・横に動かす物の上・ドラッグ中は数えない
      if (isTextEntry(document.activeElement) || needsSideways(e.target, el) || dragActive()) return
      start = { id: e.pointerId, x: e.clientX, y: e.clientY, at: e.timeStamp, moved: false }
    }
    const move = (e: PointerEvent) => {
      if (!start || start.moved || e.pointerId !== start.id) return
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) <= SWIPE_SLOP_PX) return
      start.moved = true
      // 止まっていた時間が長ければ長押し（なぞったとみなさない。掴んでから動かした指もここで外れる）。動き始めた時にもう掴んで
      // いれば（ほかの指で掴んだ物があるなど）数えない
      if (isHold(e.timeStamp - start.at) || dragActive()) start = null
    }
    const up = (e: PointerEvent) => {
      if (!start || e.pointerId !== start.id) return
      const dir = swipeDirection(e.clientX - start.x, e.clientY - start.y)
      start = null
      if (dir && !dragActive()) handler.current(dir)
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
