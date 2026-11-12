// 指で押して離した時に効く押す所（お知らせの［元に戻す］・［×］。docs/SPEC.md の 3.9。22. の段階2の終わりの確かめ）。
// ふだんのボタンは、ブラウザが指の押し方を click に作り直してから効く。作者の iPhone のホーム画面のアプリで、ウィークリーでカードを
// 長押しで動かした後、画面の下の「〜へ移しました［元に戻す］」を押しても何も起きなかった。原因は確かめられていない（Chromium では
// 起きず、iPhone の WebKit はここで動かせない）。iPhone が、押した指の touch・pointer の出来事はページに届けたが、click を作らな
// かった見込み（click を作るかはブラウザが決める所で、ページからは見えない）。そこで指の時は、ブラウザが click を作るのを待たずに、
// 指を離した時（touchend）に、その押す所へ自分で click を送る。指の出来事そのものがページに届かなかった時は、これでも効かない。
// - click を送るので、押した時に click を見ているほかの所は、ブラウザの click の時と同じに動く（開いているすばやく足すは押し終わった
//   として閉じてから、押した物が効く。外を押して閉じたメニューは、続く click を捨てて閉じるだけにする）
// - 押してから離すまでに TAP_SLOP_PX より動いた（なぞった）・2本目の指が触れた・ブラウザが指を受け取った（touchcancel・
//   離した出来事を止められない＝スクロールになった）時は送らない
// - 送った時は、その touchend を止めて（preventDefault）ブラウザに click を作らせない（お知らせは押すと消えるので、後から来た
//   click が、お知らせの下にあった物（ウィークリーのカードなど）を押さないように）。止めてもブラウザの click が来た時は、
//   TAP_CLICK_GUARD_MS の間は同じ押し方の物として効かせない
// - マウス・キーボード（Enter・Space）・読み上げの操作は、これまでどおりブラウザの click で効く
import { useMemo, useRef, type MouseEvent, type TouchEvent } from 'react'

/** 押してから離すまでに、これより動いたら押したとみなさない（なぞった。px） */
export const TAP_SLOP_PX = 10

/** 指を離して click を送った後、これより前に来たブラウザの click は、同じ押し方の物として効かせない（ms） */
export const TAP_CLICK_GUARD_MS = 800

export interface FingerTapHandlers {
  onTouchStart: (e: TouchEvent<HTMLElement>) => void
  onTouchMove: (e: TouchEvent<HTMLElement>) => void
  onTouchEnd: (e: TouchEvent<HTMLElement>) => void
  onTouchCancel: () => void
  onClick: (e: MouseEvent<HTMLElement>) => void
}

interface Point {
  clientX: number
  clientY: number
}

/** 指の一覧から、その番号の指 */
function touchOf(list: TouchEvent['changedTouches'], id: number): Point | null {
  for (let i = 0; i < list.length; i++) {
    const t = list[i]
    if (t?.identifier === id) return t
  }
  return null
}

/**
 * 押す所に広げて渡す物（onTouchStart・onTouchMove・onTouchEnd・onTouchCancel・onClick）。click（マウス・キーボード・読み上げ、
 * 指を離した時に自分で送った物）の時に onTap を1回呼ぶ
 */
export function useFingerTap(onTap: () => void): FingerTapHandlers {
  const latest = useRef(onTap)
  latest.current = onTap
  return useMemo(() => {
    /** 押している指（押した所） */
    let press: { id: number; x: number; y: number } | null = null
    /** 指を離して click を送った時刻（performance.now） */
    let tappedAt = Number.NEGATIVE_INFINITY
    /** 自分で送っている click の途中 */
    let sending = false
    const moved = (p: { x: number; y: number }, t: Point) => Math.hypot(t.clientX - p.x, t.clientY - p.y) > TAP_SLOP_PX
    return {
      onTouchStart(e) {
        const t = e.changedTouches[0]
        // 2本目の指（拡大・縮小）が触れたらやめる
        press = e.touches.length === 1 && t ? { id: t.identifier, x: t.clientX, y: t.clientY } : null
      },
      onTouchMove(e) {
        if (!press) return
        const t = touchOf(e.changedTouches, press.id)
        if (t && moved(press, t)) press = null
      },
      onTouchEnd(e) {
        const p = press
        press = null
        // ほかの指が残っている・ブラウザがもう指を受け取った（止められない touchend）時は押したとみなさない
        if (!p || e.touches.length > 0 || !e.cancelable) return
        const t = touchOf(e.changedTouches, p.id)
        if (!t || moved(p, t)) return
        e.preventDefault()
        tappedAt = performance.now()
        sending = true
        try {
          e.currentTarget.click()
        } finally {
          sending = false
        }
      },
      onTouchCancel() {
        press = null
      },
      onClick() {
        // 指を離して送った後に、止めてもブラウザが作った click は数えない
        if (!sending && performance.now() - tappedAt < TAP_CLICK_GUARD_MS) return
        latest.current()
      },
    }
  }, [])
}
