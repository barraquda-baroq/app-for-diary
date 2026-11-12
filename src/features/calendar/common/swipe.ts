// スワイプ（左右になぞる）で前後の期間へ移るかの決まり（docs/SPEC.md の 3.7・8.5・9.4・10.5・11.4。FRAME-073）。
// S・M の指の操作で、イヤー・マンスリー・ウィークリー・デイリーのどれでも、左右に 60px 以上、水平から 30° 以内でなぞると前後の期間へ
// （左へなぞる＝次、右へなぞる＝前）。ウィークリーも作者の答えでなぞると前後の週へ移る（22. の段階2の終わりの確かめ。カードは
// 長押ししてから動かすと掴み、すぐ横へ払うとなぞる）。L・マウスではしない。
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

/**
 * 押した所から離した所までの動き（dx・dy。px。右・下が正）から、移る向きを決める。左へなぞる（dx < 0）と次（1）、
 * 右へなぞる（dx > 0）と前（-1）。横に 60px 未満・水平から 30° を超える（縦のスクロールの）時は null
 */
export function swipeDirection(dx: number, dy: number): 1 | -1 | null {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null
  if (Math.abs(dx) < SWIPE_MIN_PX) return null
  const deg = (Math.atan2(Math.abs(dy), Math.abs(dx)) * 180) / Math.PI
  if (deg > SWIPE_MAX_DEG) return null
  return dx < 0 ? 1 : -1
}

/**
 * 指が動き始めた（押した所から 8px を超えた）時に、それまで止まっていた時間（ms）から、長押しか（なぞったとみなさない）を決める
 */
export function isHold(heldMs: number): boolean {
  return heldMs >= SWIPE_HOLD_MS
}

/**
 * そのモード・幅の区分でスワイプするか（S・M のどのモードでも。FRAME-073・075。ウィークリーも、22. の段階2の終わりの確かめの答えで
 * なぞると前後の週へ）。L はしない（マウスの端末。右の列があり、狭い窓ではウィークリーが横にスクロールする）
 */
export function swipeEnabled(_mode: CalendarMode, width: WidthClass): boolean {
  return width !== 'L'
}
