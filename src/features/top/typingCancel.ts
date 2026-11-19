// iPhone・iPad で打っている間の端からのフリック（docs/SPEC.md の 3.1・12.1・22. の ■36 の作者の答え）: 入力をやめるだけ。
// カレンダーの画面（トップの画面のカレンダーの行き先。幅は S・M・L のどれでも。iPad の横向きの右の列も）で、すばやく足すが開いている
// 時か、3つのリストの中の文字を打つ欄にフォーカスがある時の端からのフリック（前の版が残した履歴への iPhone の身振りの popstate も
// 同じ）は、打っていた物をやめて欄（とキーボード）を閉じるだけにし、そのフリックは使い切る: モードは替えず、リストも畳まず、ページも
// 動かさない（作者「入力中の払いは、入力画面のキャンセルのみで、モード移行はなしでいいです」「画面の上下移動もなし、入力のキャンセルと
// 入力ボックスを閉じるだけでいいです」）。src/features/top/closeApp.ts の consumeBackPress が、確かめのダイアログ・ドラッグの途中・
// リストのメニュー・小窓の後に呼ぶ（Android・PC の OS の戻るでは呼ばない）。
// - すばやく足す: 字を足さずに閉じ、その日・その区分の書きかけも消す（QuickAdd の cancelQuickAddByFlick）
// - リストの入力欄（Task List の入力欄の下のチップ・［依頼者］の欄、Routine List の［指定］も）: ■34 で畳む時と同じく打ちかけを
//   捨て（欄を空に・チップを外す・端末の書きかけを消す・変換の途中なら決めずに捨てる。common/listDraft の discardListDraft）、欄から
//   フォーカスを外す（変換の途中だった時は、■34 と同じくそのリストの畳む・開くボタンへ。ページは動かさない）
// - 行の中で直している欄（件名・本文・L の行の依頼者）: Esc と同じく保存せずにやめ（common/fieldCancel）、欄から外す（Favorite の
//   0.6秒の自動保存で保存した分は、Esc と同じく残る）
// - ほかのリストの中の文字を打つ欄: 欄から外すだけ
// 端に指を置いた時に打っていて、払い終える前にその入力が閉じた（すばやく足すをキーボードの✓で外していて、端の指をブラウザが取った
// 後に足して閉じた時など）時も、そのフリックは使い切る（モードを回さない。common/listPopups の「押した時に開いていた」と同じ形）。
// 打っていない時（キーボードの✓で外した後）は今までどおり（■34 で見ている開いたリストを畳む・モードを回す）。
// 記録（設定で取る時だけ。src/history/swipeLog.ts）: type-cancel（kind: quick-add・list-input・inline-edit・other、list。打った字は
// 控えない。押した時に打っていて閉じていた時は gone）
import { useEffect } from 'react'
import { edgeOfScreen } from '../../history/edgeFlick'
import { swipeLog } from '../../history/swipeLog'
import type { ListKey } from '../../store/uiStore'
import { currentPopSource } from '../../ui/device'
import { isTextEntry } from '../../ui/textEntry'
import { screenOf } from '../calendar/common/calendarHistory'
import { cancelQuickAddByFlick, quickAddOpen } from '../calendar/common/parts/QuickAdd'
import { useCurrentLocation } from '../calendar/common/sheets'
import { fieldCancelOf } from '../lists/common/fieldCancel'
import { discardListDraft } from '../lists/common/listDraft'

/** 端に指を置いた時に打っていた物を、指を離した後もその押しの物とみなす長さ（ms。common/listPopups の PRESS_GRACE_MS と同じ） */
export const TYPING_GRACE_MS = 300

/** 打っている物の種類（記録の kind） */
export type TypingKind = 'quick-add' | 'list-input' | 'inline-edit' | 'other'

interface Typing {
  kind: TypingKind
  list: ListKey | null
  /** フォーカスのある欄（すばやく足すは null） */
  field: HTMLElement | null
}

/** カレンダーの画面か（トップの画面が置く。無ければカレンダーの画面ではない） */
let onCalendar: (() => boolean) | null = null
/** 今の指を画面の端に置いた時に打っていた物 */
let atPress: Typing | null = null
/** 指を置いている間（離すまで） */
let pressing = false
/** 最後に離した時（performance.now） */
let releasedAt = Number.NEGATIVE_INFINITY

const now = () => performance.now()

/** 3つのリストの枠（common/ListSection の data-list） */
const LIST_SELECTOR = '[data-list]'

/** 今打っている物（カレンダーの画面でなければ・打っていなければ null） */
function typingNow(): Typing | null {
  if (!onCalendar?.()) return null
  if (quickAddOpen()) return { kind: 'quick-add', list: null, field: null }
  const active = document.activeElement
  if (!(active instanceof HTMLElement) || !isTextEntry(active)) return null
  const section = active.closest<HTMLElement>(LIST_SELECTOR)
  const list = (section?.dataset.list ?? null) as ListKey | null
  if (!list) return null
  const kind: TypingKind = active.closest('.list-input-box') ? 'list-input' : fieldCancelOf(active) ? 'inline-edit' : 'other'
  return { kind, list, field: active }
}

/**
 * 端からのフリックが来た時（consumeBackPress が、iPhone・iPad の時だけ呼ぶ）: 打っている物があれば、それをやめて欄から外し true
 * （そのフリックは使い切る）。端に指を置いた時に打っていて、もう閉じていた時も true。どちらでもなければ false（今までどおり）
 */
export function cancelTypingOnFlick(): boolean {
  const typing = typingNow()
  const pressed = atPress
  atPress = null
  if (!typing) {
    if (pressed && (pressing || now() - releasedAt < TYPING_GRACE_MS)) {
      swipeLog('type-cancel', { kind: pressed.kind, list: pressed.list, gone: true })
      return true
    }
    return false
  }
  swipeLog('type-cancel', { kind: typing.kind, list: typing.list })
  if (typing.kind === 'quick-add') {
    cancelQuickAddByFlick()
    return true
  }
  if (typing.kind === 'list-input' && typing.list) discardListDraft(typing.list)
  else if (typing.kind === 'inline-edit' && typing.field) fieldCancelOf(typing.field)?.()
  // キーボードを閉じる（やめた後なので、離れた時に保存する欄も保存しない。フォーカスを移す所が無ければ body。ページは動かさない）
  const active = document.activeElement
  if (active instanceof HTMLElement && isTextEntry(active)) active.blur()
  return true
}

/**
 * 画面の端に指を置いた時に、打っていたかを控える（捕まえる段の window。touch の出来事と pointer の出来事のどちらが先でも、置いた時に
 * 控え直す）。離した時は touch の出来事で見る（iPhone はページが少しでも動くと pointer を取り消すが、touch の出来事は離すまで来る）
 */
function watchPresses(): () => void {
  const down = (x: number) => {
    pressing = true
    atPress = edgeOfScreen(x) !== null ? typingNow() : null
  }
  const onPointer = (e: PointerEvent) => {
    if (e.pointerType === 'touch') down(e.clientX)
  }
  const onTouch = (e: TouchEvent) => {
    const t = e.touches?.[0]
    if (e.touches?.length === 1 && t) down(t.clientX)
  }
  const release = (e: TouchEvent) => {
    if ((e.touches?.length ?? 0) !== 0) return
    pressing = false
    releasedAt = now()
  }
  const opts = { capture: true, passive: true } as const
  window.addEventListener('pointerdown', onPointer, opts)
  window.addEventListener('touchstart', onTouch, opts)
  window.addEventListener('touchend', release, opts)
  window.addEventListener('touchcancel', release, opts)
  return () => {
    window.removeEventListener('pointerdown', onPointer, opts)
    window.removeEventListener('touchstart', onTouch, opts)
    window.removeEventListener('touchend', release, opts)
    window.removeEventListener('touchcancel', release, opts)
  }
}

/**
 * トップの画面（TopPage）が使う: カレンダーの画面か（今いる所。小さな画面を開いている・MIM は違う）を届け、iPhone・iPad では画面の
 * 端に指を置いた時に打っていたかを控える（Android・PC では何もしない）
 */
export function useTypingFlick(): void {
  const current = useCurrentLocation()
  useEffect(() => {
    const check = () => screenOf(current()) === 'calendar'
    onCalendar = check
    const unwatch = currentPopSource() === 'edge-flick' ? watchPresses() : null
    return () => {
      unwatch?.()
      if (onCalendar === check) onCalendar = null
      atPress = null
      pressing = false
    }
  }, [current])
}

/** テスト用: 控えた物を忘れる */
export function resetTypingFlickForTests(): void {
  atPress = null
  pressing = false
  releasedAt = Number.NEGATIVE_INFINITY
}
