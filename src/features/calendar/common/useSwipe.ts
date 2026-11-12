// 指で左右になぞった時に前後の期間へ移る（docs/SPEC.md の 3.7・8.5・9.4・10.5・11.4。FRAME-073〜075）。S・M のカレンダーの区切り（どのモードでも）で、
// 指の操作（pointerType が touch）だけを拾う（マウス・ペンではしない）。
// なぞりを聞く所は、カレンダーの区切りの全部（操作の列とモードの画面。CalendarView の .cal）と、その左右の画面の端までの余白
// （frame.css の .top-stack .cal.is-swipe::before・::after）。画面の端から払い始めた指も受け取る（22. の段階2の終わりの確かめ。前の作りは
// モードの画面（.cal-body）の中だけで聞いていたので、左右 17px ほどの余白・操作の列から払うと、指を受け取っていなかった）。
// ヘッダー・切り替えの列・下のリスト・シート・メニューは入らない。
// 縦のスクロールは邪魔しない: 付けている間は CSS の touch-action: pan-y（frame.css の .cal.is-swipe）で、縦はブラウザに
// スクロールさせ、横の動きだけを受け取る。初めの動きが縦の指はブラウザが縦のスクロールとして取り（pointercancel）、数えない。
// 横に払い始めた（初めの動きが縦と決まっていない）指をブラウザが取った時は、離すまで touch の出来事で追う（swipe.ts）。
// 長押ししてから動かした指（ドラッグの掴み方）はなぞったとみなさない。決まり（60px・30°・弧は 45°・400ms・8px・24px）は swipe.ts。
// なぞって移った後 300ms の間にカレンダーの中へ来た click は打ち消す（払った指で、離した所のボタンを押さない）。
// なぞったとみなさない時（ウィークリーでなぞれるようにした時に足した。22. の段階2の終わりの確かめ。どのモードでも同じ）:
// - ドラッグ中・ドラッグした指（掴んだ物に dnd-kit が付ける data-dnd-dragging。指を離した後の動きも数えない）
// - 文字を打っている間（すばやく足すの入力欄などにフォーカスがある。押した所が入力欄の時も）
// - 横に動かす物の上から押した時（入力欄・横にスクロールできる所。今の S・M の並べ方には、カレンダーの中に横にスクロールする所は
//   無いが、並べ方を替えた時のために入れておく）
// - ほかの指が触れた時（拡大・縮小）・端末が指を取った時（touchcancel。iPhone の画面の端からの「戻る」の身振りなど）
import { useEffect, useRef, type RefObject } from 'react'
import { dragActive } from './pageTurnDom'
import { endSwipe, moveSwipe, startSwipe, SWIPE_CLICK_GUARD_MS, takeSwipe, type SwipeTrack } from './swipe'

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
    /** 追っている指（無ければ null）と、その pointerId */
    let track: SwipeTrack | null = null
    let id = -1
    /** この時刻（performance.now()）までにカレンダーの中へ来た click は打ち消す（なぞって移った直後） */
    let guardUntil = 0

    /** 離した所で決める（移るなら移って、続く click を打ち消す） */
    const finish = (x: number, y: number) => {
      const s = track
      track = null
      if (!s) return
      const dir = endSwipe(s, x, y)
      if (!dir || dragActive()) return
      guardUntil = performance.now() + SWIPE_CLICK_GUARD_MS
      handler.current(dir)
    }
    const down = (e: PointerEvent) => {
      track = null
      // 2本目の指（拡大・縮小）が触れたらやめる
      if (e.pointerType !== 'touch' || !e.isPrimary) return
      // 文字を打っている間・横に動かす物の上・ドラッグ中は数えない
      if (isTextEntry(document.activeElement) || needsSideways(e.target, el) || dragActive()) return
      id = e.pointerId
      track = startSwipe(e.clientX, e.clientY, e.timeStamp)
    }
    // 聞く所の外に触れたほかの指も、拡大・縮小なのでやめる
    const otherDown = (e: PointerEvent) => {
      if (track && e.pointerId !== id) track = null
    }
    const move = (e: PointerEvent) => {
      if (!track || track.taken || e.pointerId !== id) return
      const moved = track.moved
      track = moveSwipe(track, e.clientX, e.clientY, e.timeStamp)
      // 止まっていた時間が長ければ長押し（moveSwipe が外す。掴んでから動かした指もここで外れる）。動き始めた時にもう掴んで
      // いれば（ほかの指で掴んだ物があるなど）数えない
      if (track && !moved && track.moved && dragActive()) track = null
    }
    const up = (e: PointerEvent) => {
      if (!track || track.taken || e.pointerId !== id) return
      finish(e.clientX, e.clientY)
    }
    // ブラウザが指を取った（縦のスクロールを始めた）: 初めの動きが縦の指はやめ、横に払い始めた指は touch の出来事で追う
    const cancel = (e: PointerEvent) => {
      if (!track || track.taken || e.pointerId !== id) return
      track = takeSwipe(track)
    }
    const touchMove = (e: TouchEvent) => {
      if (!track?.taken) return
      const t = e.touches.length === 1 ? e.touches[0] : null
      track = t ? moveSwipe(track, t.clientX, t.clientY, e.timeStamp) : null
    }
    const touchEnd = (e: TouchEvent) => {
      if (!track?.taken) return
      const t = e.touches.length === 0 ? e.changedTouches[0] : null
      if (t) finish(t.clientX, t.clientY)
      else track = null
    }
    // 端末が指を取った（iPhone の画面の端からの「戻る」の身振り・アプリの切り替えなど）時は数えない
    const touchCancel = () => {
      if (track?.taken) track = null
    }
    const click = (e: MouseEvent) => {
      if (performance.now() > guardUntil) return
      if (!(e.target instanceof Node) || !el.contains(e.target)) return
      guardUntil = 0
      e.preventDefault()
      e.stopPropagation()
    }
    el.addEventListener('pointerdown', down)
    document.addEventListener('pointerdown', otherDown, true)
    // 動かす・離すのは、押した要素が描き直しで外れた後のこともあるので document で聞く
    document.addEventListener('pointermove', move, { passive: true })
    document.addEventListener('pointerup', up)
    document.addEventListener('pointercancel', cancel)
    document.addEventListener('touchmove', touchMove, { passive: true })
    document.addEventListener('touchend', touchEnd)
    document.addEventListener('touchcancel', touchCancel)
    // React の onClick より先に打ち消す（window の捕まえる段）
    window.addEventListener('click', click, true)
    return () => {
      el.removeEventListener('pointerdown', down)
      document.removeEventListener('pointerdown', otherDown, true)
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerup', up)
      document.removeEventListener('pointercancel', cancel)
      document.removeEventListener('touchmove', touchMove)
      document.removeEventListener('touchend', touchEnd)
      document.removeEventListener('touchcancel', touchCancel)
      window.removeEventListener('click', click, true)
    }
  }, [ref, enabled])
}
