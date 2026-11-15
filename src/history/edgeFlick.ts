// iPhone・iPad の画面の端からのフリックを受け取る所（docs/SPEC.md の 3.1・3.7。22. の ■31〜■33）。iPhone・iPad ではブラウザの履歴を
// いつも1つにしている（src/history/singleEntryHistory.ts）ので、ブラウザの「戻る」「進む」の身振り（ページがめくれる動き）は始まらず、
// 画面の端から払った指はそのままページに来る。それを window の捕まえる段の touch の出来事で、どの画面の上でも（カレンダー・登録・
// 詳細の画面・その上の確かめ・設定・MIM・すばやく足すを開いている時）この1か所で受け取り、内へ払って離した指を履歴の flick に渡す
// （何をするかは src/history/popRules.ts の decidePop: カレンダーではモードを回し、ほかの画面では1つ戻る）。動く絵は無く、指を離した
// 時に替わる（作者「iphone版に合わせてもらっていいです」■33）。
// - 受け取る指: 1本の指で、見えている所（visualViewport。拡大していても、見えている所の端）の左右の端から端の幅（初めは
//   EDGE_ZONE_PX の 44px。設定の「開発」の「端の幅」で 20・28・36・44px から選ぶ。src/history/edgeZone.ts。押すたびに読む）の中で押し、
//   内へ払って離した指。端の幅は画面の上の長さ（拡大する前の px）で、拡大していても指で同じ幅（2倍なら、見えている所の端から
//   22px。開発。拡大すると端の幅も広がって、拡大した画面を動かす指を受け取らないように）。払いの決まり（60px・30°・払い始めが横なら
//   45°・押してから 400ms 止まってから動かした指は数えない）は swipe.ts と同じ。フォーカスの無い入力欄（登録・詳細の画面の件名・メモの
//   欄など）の上から押した指も受け取る（開発。22. の「端からのフリックの3回目の直した版（788e842）を試した答え」の「端を甘く」）
// - 受け取らない指: フォーカスのある入力欄（カーソル・字を選ぶつまみがある）・横にスクロールできる所・範囲（スライダー）の上から
//   押した指と、拡大している時（ZOOMED_SCALE より大きい倍率）のフォーカスの無い入力欄の上から押した指（拡大した画面を動かす指。
//   788e842 と同じ。src/ui/textEntry.ts の edgeFlickBlocked）・ドラッグの途中・外へ払った指・押した後に前の版が残した履歴への身振り
//   （popstate）が来た指（userPopSince。その時は履歴の方で1回だけ受け取る）・2本目の指が触れた指・端末が取った指（touchcancel）。
//   ほかの所の入力欄にフォーカスがあっても（キーボードが出ていても）受け取る
// - pointer の出来事でなく touch の出来事で追う（iPhone は、ページが縦に少しでも動くと pointer を取り消すが、touch の出来事は離す
//   まで来る）。どれも passive で、縦のスクロール・キーボード・字の選び方を邪魔しない。押した要素でも聞く（払っている間に画面が
//   替わって押した要素が外れると、touch の出来事は外れた要素へ送られ、window まで伝わらない。useSwipe.ts と同じ）
// - 渡した後 SWIPE_CLICK_GUARD_MS の間に、離した所（SWIPE_SLOP_PX の内）に来た click は1つだけ打ち消す（払った指で、離した所の
//   ボタンを押さない）。離れた所の click（すぐ次に押した別の所・キーボード）は打ち消さない
// - 端の指は、なぞって前後の期間へ移る所（src/features/calendar/common/useSwipe.ts）では数えない（同じ edgeOfScreen・同じ端の幅で
//   決める。1回の払いでモードと期間の両方が替わらない）
// - 設定で記録を取る時は、端で押した指（edge-down: 位置・端・見えている所の幅・端の幅。拡大している時は倍率も）・数えなかった訳
//   （edge-skip: focused・sideways・zoomed・drag）・離した指（edge-up: 動き・長さ・向き・どうしたか）を控える（src/history/swipeLog.ts。
//   何をしたかは履歴の側の flick）
// src/App.tsx が、iPhone・iPad の1つの履歴の形の時だけ付ける（attachEdgeFlick。Android・PC には付けない）
import {
  edgeSide,
  endSwipe,
  moveSwipe,
  startSwipe,
  SWIPE_CLICK_GUARD_MS,
  SWIPE_SLOP_PX,
  type SwipeTrack,
} from '../features/calendar/common/swipe'
import { edgeFlickBlocked } from '../ui/textEntry'
import type { DsHistory } from './appHistory'
import { edgeZonePx } from './edgeZone'
import { swipeLog } from './swipeLog'

/** 見えている所の大きさと倍率（visualViewport の物） */
interface ViewportLike {
  readonly offsetLeft: number
  readonly width: number
  readonly scale?: number
}

/** 画面の端を決めるのに使う window の物 */
export interface ScreenLike {
  readonly innerWidth: number
  readonly visualViewport?: ViewportLike | null
}

/** 拡大しているとみなす倍率（visualViewport.scale がこれより大きい時。2本の指で広げた・ダブルタップで拡大した） */
export const ZOOMED_SCALE = 1.05

/** 見えている所の左の端・幅と倍率（visualViewport が無ければ窓の幅で 1倍。倍率が無い・1 より小さい・おかしい時も 1倍） */
function viewportOf(win: ScreenLike): { left: number; width: number; scale: number } {
  const vv = win.visualViewport
  if (vv && Number.isFinite(vv.width) && vv.width > 0) {
    const s = vv.scale
    return {
      left: Number.isFinite(vv.offsetLeft) ? vv.offsetLeft : 0,
      width: vv.width,
      scale: typeof s === 'number' && Number.isFinite(s) && s > 1 ? s : 1,
    }
  }
  return { left: 0, width: win.innerWidth, scale: 1 }
}

/**
 * 押した所（clientX）が画面の端か: 見えている所（visualViewport）の左の端から端の幅（今の物。src/history/edgeZone.ts）の中は -1、
 * 右の端の中は 1、ほかは null（拡大している時も、見えている所の端で決める。端の幅は画面の上の長さなので、2倍に拡大していれば
 * ページの px で半分）。端を決める所はどれもこれを使う（端からのフリック・なぞり・すばやく足す。1つの幅で決める）
 */
export function edgeOfScreen(x: number, win: ScreenLike = window): -1 | 1 | null {
  const { left, width, scale } = viewportOf(win)
  return edgeSide((x - left) * scale, width * scale, edgeZonePx())
}

export interface EdgeFlickOptions {
  /** 内へ払って離した（-1 = 左の端から右へ、1 = 右の端から左へ） */
  flick: (side: -1 | 1) => void
  /** 利用者の「戻る」「進む」（popstate）が、その時刻（now と同じ時計）より後に来たか */
  userPopSince?: (t: number) => boolean
  /** ドラッグの途中か */
  dragging?: () => boolean
  /** 時刻（初めは performance.now。テストでは差し替える） */
  now?: () => number
}

/** touch の出来事の指の座標（jsdom・合成した出来事でも読めるように、座標だけを読む） */
interface TouchPoint {
  readonly clientX: number
  readonly clientY: number
}

type TouchesEvent = Event & { readonly touches?: ArrayLike<TouchPoint>; readonly changedTouches?: ArrayLike<TouchPoint> }

const CAPTURE = { capture: true, passive: true } as const

/** window で画面の端からのフリックを受け取り始める（返す関数で外す） */
export function installEdgeFlick(win: Window, opts: EdgeFlickOptions): () => void {
  const now = opts.now ?? (() => performance.now())
  /** 追っている指（無ければ null）と、押した端・押した時刻 */
  let track: SwipeTrack | null = null
  let side: -1 | 1 = -1
  let at = 0
  /** この時刻までに、離した所（liftX・liftY）の近くに来た click は1つ打ち消す（渡した直後） */
  let guardUntil = -Infinity
  let liftX = 0
  let liftY = 0
  /**
   * 押した要素（window と両方で聞く）と、最後に扱った出来事（window と押した要素の両方に来たふつうの時は、2回目を扱わない）
   */
  let pressed: EventTarget | null = null
  let handled: Event | null = null
  const once = (e: Event) => {
    if (handled === e) return false
    handled = e
    return true
  }
  const listenPressed = (target: EventTarget | null) => {
    if (pressed === target) return
    pressed?.removeEventListener('touchmove', move, CAPTURE)
    pressed?.removeEventListener('touchend', end, CAPTURE)
    pressed?.removeEventListener('touchcancel', cancel, CAPTURE)
    pressed = target
    pressed?.addEventListener('touchmove', move, CAPTURE)
    pressed?.addEventListener('touchend', end, CAPTURE)
    pressed?.addEventListener('touchcancel', cancel, CAPTURE)
  }

  const start = (e: Event) => {
    track = null
    const touches = (e as TouchesEvent).touches
    // 2本目の指が触れた時（拡大・縮小）もやめる
    if (!touches || touches.length !== 1) return
    const t = touches[0]
    const edge = edgeOfScreen(t.clientX, win)
    if (edge === null) return
    const view = viewportOf(win)
    swipeLog('edge-down', {
      x: Math.round(t.clientX),
      y: Math.round(t.clientY),
      side: edge,
      w: Math.round(view.width),
      zone: edgeZonePx(),
      ...(view.scale !== 1 ? { scale: Math.round(view.scale * 100) / 100 } : {}),
    })
    // フォーカスのある入力欄・横にスクロールできる所の上は数えない（フォーカスの無い入力欄の上は数える。拡大している時は数えない）
    const blocked = edgeFlickBlocked(e.target, win.document.body, win.document.activeElement, view.scale > ZOOMED_SCALE)
    if (blocked) {
      swipeLog('edge-skip', { why: blocked })
      return
    }
    if (opts.dragging?.()) {
      swipeLog('edge-skip', { why: 'drag' })
      return
    }
    side = edge
    at = now()
    track = startSwipe(t.clientX, t.clientY, at)
    listenPressed(e.target)
  }

  function move(e: Event) {
    if (!track || !once(e)) return
    const touches = (e as TouchesEvent).touches
    if (!touches || touches.length !== 1) {
      track = null
      return
    }
    const t = touches[0]
    // 止まっていた時間が長ければ長押し（moveSwipe が外す。掴んでから動かす指）
    track = moveSwipe(track, t.clientX, t.clientY, now())
  }

  function end(e: Event) {
    const s = track
    if (!s || !once(e)) return
    const ev = e as TouchesEvent
    if ((ev.touches?.length ?? 0) !== 0) return
    track = null
    const t = ev.changedTouches?.[0]
    if (!t) return
    const dir = endSwipe(s, t.clientX, t.clientY)
    const result = !dir
      ? 'none'
      : dir !== side
        ? 'outward'
        : opts.userPopSince?.(at)
          ? 'native'
          : opts.dragging?.()
            ? 'drag'
            : 'flick'
    swipeLog('edge-up', {
      x0: Math.round(s.x0),
      dx: Math.round(t.clientX - s.x0),
      dy: Math.round(t.clientY - s.y0),
      ms: Math.round(now() - s.t0),
      dir,
      result,
    })
    if (result !== 'flick') return
    guardUntil = now() + SWIPE_CLICK_GUARD_MS
    liftX = t.clientX
    liftY = t.clientY
    opts.flick(side)
  }

  // 端末が指を取った（アプリの切り替え・通知を引き出す時など）
  function cancel() {
    track = null
  }

  // React の onClick より先に打ち消す（window の捕まえる段）。離した所から離れた click は、払った指の物ではない
  const click = (e: Event) => {
    if (now() > guardUntil) return
    const { clientX, clientY } = e as MouseEvent
    if (Math.abs(clientX - liftX) > SWIPE_SLOP_PX || Math.abs(clientY - liftY) > SWIPE_SLOP_PX) return
    guardUntil = -Infinity
    e.preventDefault()
    e.stopPropagation()
  }

  win.addEventListener('touchstart', start, CAPTURE)
  win.addEventListener('touchmove', move, CAPTURE)
  win.addEventListener('touchend', end, CAPTURE)
  win.addEventListener('touchcancel', cancel, CAPTURE)
  win.addEventListener('click', click, true)
  return () => {
    listenPressed(null)
    win.removeEventListener('touchstart', start, CAPTURE)
    win.removeEventListener('touchmove', move, CAPTURE)
    win.removeEventListener('touchend', end, CAPTURE)
    win.removeEventListener('touchcancel', cancel, CAPTURE)
    win.removeEventListener('click', click, true)
  }
}

/**
 * アプリの履歴が iPhone・iPad の1つの履歴の形（flick を持つ: SingleEntryHistory）の時だけ、画面の端からのフリックを受け取り始める
 * （src/App.tsx が1回だけ呼ぶ。返す関数で外す）。Android・PC（AppHistory）には付けず null
 */
export function attachEdgeFlick(
  history: DsHistory,
  { win = window, dragging, now }: { win?: Window; dragging?: () => boolean; now?: () => number } = {},
): (() => void) | null {
  if (!history.flick) return null
  return installEdgeFlick(win, {
    flick: (side) => history.flick?.(side),
    userPopSince: (t) => history.userPopSince?.(t) ?? false,
    dragging,
    now,
  })
}
