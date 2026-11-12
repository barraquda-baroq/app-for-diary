// スワイプ（左右になぞる）で前後の期間へ移るかの決まり（docs/SPEC.md の 3.7・8.5・9.4・10.5・11.4。FRAME-073）。
// S・M の指の操作で、イヤー・マンスリー・ウィークリー・デイリーのどれでも、左右に 60px 以上、水平から 30° 以内でなぞると前後の期間へ
// （左へなぞる＝次、右へなぞる＝前）。ウィークリーも作者の答えでなぞると前後の週へ移る（22. の段階2の終わりの確かめ。カードは
// 長押ししてから動かすと掴み、すぐ横へ払うとなぞる）。L・マウスではしない。
// 大きく払った時（22. の段階2の終わりの確かめ。iPhone のホーム画面のアプリで「画面の外から外へ大きく払うと替わらない」への直し）:
// - 親指で大きく払うと弧を描き、終わりが上（下）へ逸れる。初めの動き（押した所から 24px まで）が水平から 30° 以内なら横に払い
//   始めたと決め、全体が 45° 以内なら移る（初めから斜め・縦の動きは今までどおり全体で 30° 以内）
// - 初めに少し縦へ動いたために、ブラウザが縦のスクロールとして指を取った（pointercancel）時も、横に払い始めた指（初めの動きが
//   縦と決まっていない指）は離すまで追い（touch の出来事）、全体で 60px 以上・30° 以内なら移る（縦のスクロールは取らない）
// React・ストアを読まない（純粋な関数。src/features/calendar/purity.test.ts）。指の出来事を拾うのは useSwipe.ts
import type { CalendarMode, WidthClass } from './types'

/** なぞる長さの下限（横の長さ。px） */
export const SWIPE_MIN_PX = 60
/** 水平からの角度の上限（度。これ以内なら横になぞったとみなす） */
export const SWIPE_MAX_DEG = 30
/**
 * 長押し: 押してから 8px を超えて動き始めるまでに 400ms 以上止まっていた指は、なぞったとみなさない（長押ししてから動かすのは
 * ドラッグの掴み方。docs/SPEC.md の 7.11 の 400ms・8px と同じ。段階3で Task List の行をカレンダーへ落とす時もぶつからない）
 */
export const SWIPE_HOLD_MS = 400
export const SWIPE_SLOP_PX = 8
/** 払い始めの向きを決める長さ（押した所からの指の動き。px）。ここまでの向きが水平から 30° 以内なら「横に払い始めた」 */
export const SWIPE_LEAD_PX = 24
/** 横に払い始めた指の、全体の角度の上限（度。親指の弧で終わりが逸れても移る） */
export const SWIPE_ARC_MAX_DEG = 45
/**
 * なぞって移った後、この間（ms）にカレンダーの中へ来た click は打ち消す（払った指で、離した所のボタン（［年｜月｜週｜日］など）を
 * 押さない。ブラウザは動いた指で click を作らないが、念のため。時間で切るので、後の本当の click は食べない）
 */
export const SWIPE_CLICK_GUARD_MS = 300

/** 水平からの角度（度。0〜90。上下・左右は問わない） */
function angleOf(dx: number, dy: number): number {
  return (Math.atan2(Math.abs(dy), Math.abs(dx)) * 180) / Math.PI
}

/**
 * 押した所から離した所までの動き（dx・dy。px。右・下が正）から、移る向きを決める。左へなぞる（dx < 0）と次（1）、
 * 右へなぞる（dx > 0）と前（-1）。横に 60px 未満・水平から maxDeg（初めは 30°）を超える（縦のスクロールの）時は null
 */
export function swipeDirection(dx: number, dy: number, maxDeg: number = SWIPE_MAX_DEG): 1 | -1 | null {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null
  if (Math.abs(dx) < SWIPE_MIN_PX) return null
  if (angleOf(dx, dy) > maxDeg) return null
  return dx < 0 ? 1 : -1
}

/**
 * 指が動き始めた（押した所から 8px を超えた）時に、それまで止まっていた時間（ms）から、長押しか（なぞったとみなさない）を決める
 */
export function isHold(heldMs: number): boolean {
  return heldMs >= SWIPE_HOLD_MS
}

/** 押してから離すまでの1本の指の控え（useSwipe が持つ。座標は画面の px、時刻は ms） */
export interface SwipeTrack {
  /** 押した所と時刻 */
  x0: number
  y0: number
  t0: number
  /** 8px を超えて動き始めたか（長押しかはその時に決める） */
  moved: boolean
  /** 払い始めの向き（押した所から 24px まで動いた時）: side = 水平から 30° 以内、other = それより縦、null = まだ決まらない */
  lead: 'side' | 'other' | null
  /** ブラウザが指を取った（pointercancel。縦のスクロールを始めた）後か。その後は touch の出来事で追う */
  taken: boolean
}

/** 押した */
export function startSwipe(x: number, y: number, t: number): SwipeTrack {
  return { x0: x, y0: y, t0: t, moved: false, lead: null, taken: false }
}

/**
 * 指が動いた。数えなくなった指は null: 長押ししてから動かした（ドラッグの掴み方）、ブラウザに取られた後に払い始めが縦と決まった
 */
export function moveSwipe(s: SwipeTrack, x: number, y: number, t: number): SwipeTrack | null {
  const dx = x - s.x0
  const dy = y - s.y0
  const dist = Math.hypot(dx, dy)
  let next = s
  if (!s.moved && dist > SWIPE_SLOP_PX) {
    if (isHold(t - s.t0)) return null
    next = { ...next, moved: true }
  }
  if (next.lead === null && dist >= SWIPE_LEAD_PX) {
    next = { ...next, lead: angleOf(dx, dy) <= SWIPE_MAX_DEG ? 'side' : 'other' }
    if (next.taken && next.lead === 'other') return null
  }
  return next
}

/**
 * ブラウザが指を取った（pointercancel）。払い始めが縦と決まっていた指は数えない（null。縦のスクロール）。ほかは、離すまで
 * touch の出来事で追う（初めに少し縦へ動いてブラウザが取った、横に払う指）
 */
export function takeSwipe(s: SwipeTrack): SwipeTrack | null {
  return s.lead === 'other' ? null : { ...s, taken: true }
}

/**
 * 離した所から、移る向き（null = 移らない）。横に 60px 以上で、全体が水平から 30° 以内か、横に払い始めた指は 45° 以内。
 * ブラウザに取られた後の指は、全体が 30° 以内の時だけ（ページが縦に送られた分は戻さないので、はっきり横の時だけにする）
 */
export function endSwipe(s: SwipeTrack, x: number, y: number): 1 | -1 | null {
  const dx = x - s.x0
  const dy = y - s.y0
  if (s.taken) return s.lead === 'other' ? null : swipeDirection(dx, dy)
  return swipeDirection(dx, dy, s.lead === 'side' ? SWIPE_ARC_MAX_DEG : SWIPE_MAX_DEG)
}

/**
 * そのモード・幅の区分でスワイプするか（S・M のどのモードでも。FRAME-073・075。ウィークリーも、22. の段階2の終わりの確かめの答えで
 * なぞると前後の週へ）。L はしない（マウスの端末。右の列があり、狭い窓ではウィークリーが横にスクロールする）
 */
export function swipeEnabled(_mode: CalendarMode, width: WidthClass): boolean {
  return width !== 'L'
}
