// iPhone・iPad で打っている間の端からのフリック（docs/SPEC.md の 3.1・12.1・22. の ■36 の作者の答え）: 入力をやめるだけ。
// トップの画面（カレンダーの行き先と MIM。幅は S・M・L のどれでも。iPad の横向きの右の列も。登録・詳細の小さな画面を開いている時は
// 違う）で、すばやく足すが開いている時か、3つのリストの中の文字を打つ欄にフォーカスがある時の端からのフリック（前の版が残した履歴への
// iPhone の身振りの popstate も同じ）は、打っていた物をやめて欄（とキーボード）を閉じるだけにし、そのフリックは使い切る: モードは
// 替えず（MIM からカレンダーへも戻らず）、リストも畳まず、ページも動かさない（作者「入力中の払いは、入力画面のキャンセルのみで、
// モード移行はなしでいいです」「画面の上下移動もなし、入力のキャンセルと入力ボックスを閉じるだけでいいです」）。
// src/features/top/closeApp.ts の consumeBackPress が、確かめのダイアログ・ドラッグの途中・リストのメニュー・小窓の後に呼ぶ
// （Android・PC の OS の戻るでは呼ばない）。
// - すばやく足す: 字を足さずに閉じ、その日・その区分の書きかけも消す（QuickAdd の cancelQuickAddByFlick）
// - リストの入力欄（Task List の入力欄の下のチップ・［依頼者］の欄、Routine List の［指定］も）: ■34 で畳む時と同じく打ちかけを
//   捨て（欄を空に・チップを外す・端末の書きかけを消す・変換の途中なら決めずに捨てる。common/listDraft の discardListDraft）、欄から
//   フォーカスを外す（変換の途中だった時は、■34 と同じくそのリストの畳む・開くボタンへ。ページは動かさない）
// - 行の中で直している欄（件名・本文・L の行の依頼者）: Esc と同じく保存せずにやめ（common/fieldCancel）、欄から外す（Favorite の
//   0.6秒の自動保存で保存した分は、Esc と同じく残る）
// - ほかのリストの中の文字を打つ欄: 欄から外すだけ
// やめて縮む欄（すばやく足すも）が見える所の上の端より上にはみ出していた時（開いた長い物を下まで読み進めた・書きかけで伸びた欄を
// 上へ送った・すばやく足すを開いたまま週の中を送った）は、縮んだ分で見えている物が上へ動かないよう、描く前に隠れていた分までだけ
// 送って戻し、S・M のページの終わりでブラウザが位置を上へ止め直した時は、いちばん下の空きを足して戻す（keepOnScreen.ts。
// iPhone・iPad の WebKit には、Chromium のスクロールの錨が無い。ブラウザが保った時は送らない）
// 端に指を置いた時に打っていて、払い終える前にその入力が閉じた時も、そのフリックは使い切る（モードを回さない。common/listPopups の
// 「押した時に開いていた」と同じ形）。リストの入力欄から外れていた時（変換の途中に端の幅の中の［足す］から払うと、［足す］が押した時に
// 変換を決めるために欄から外す。■15）は、その打ちかけも上と同じく捨てる。すばやく足すをキーボードの✓で外していて、端の指をブラウザが
// 取った後に足して閉じた時など、もう閉じた物（足した物・保存した物）はそのまま。押した時に打っていたかは、touch と pointer のどちらが
// 先に来ても、その押しで初めに見た物で決める（間に押した［足す］が欄から外しても、押した時は打っていた）。
// 打っていない時（キーボードの✓で外した後）は今までどおり（■34 で見ている開いたリストを畳む・モードを回す）。
// 記録（設定で取る時だけ。src/history/swipeLog.ts）: type-cancel（kind: quick-add・list-input・inline-edit・other、list。打った字は
// 控えない。押した時に打っていて閉じていた時は gone）と、見えている物を戻した時の type-cancel-keep（kind・list と、本当に送った px の
// moved（上へ送った時は負。週の中などのいちばん上・いちばん下より先の分は入れない）。ページの終わりでいちばん下の空きを足した時は、
// その px の space も）
import { useEffect } from 'react'
import { edgeOfScreen } from '../../history/edgeFlick'
import { swipeLog } from '../../history/swipeLog'
import { isMimPath } from '../../routes'
import type { ListKey } from '../../store/uiStore'
import { currentPopSource } from '../../ui/device'
import { isTextEntry } from '../../ui/textEntry'
import { screenOf } from '../calendar/common/calendarHistory'
import { cancelQuickAddByFlick, quickAddField, quickAddOpen } from '../calendar/common/parts/QuickAdd'
import { useCurrentLocation } from '../calendar/common/sheets'
import { fieldCancelOf } from '../lists/common/fieldCancel'
import { discardListDraft } from '../lists/common/listDraft'
import { type Kept, measureKeep } from './keepOnScreen'

/** 端に指を置いた時に打っていた物を、指を離した後もその押しの物とみなす長さ（ms。common/listPopups の PRESS_GRACE_MS と同じ） */
export const TYPING_GRACE_MS = 300

/** 打っている物の種類（記録の kind） */
export type TypingKind = 'quick-add' | 'list-input' | 'inline-edit' | 'other'

interface Typing {
  kind: TypingKind
  list: ListKey | null
  /** フォーカスのある欄（すばやく足すは、開いている入力欄） */
  field: HTMLElement | null
}

/** トップの画面か（カレンダーの画面か MIM で、小さな画面を開いていない。トップの画面が置く。無ければ違う） */
let onTop: (() => boolean) | null = null
/** 今の指を画面の端に置いた時に打っていた物 */
let atPress: Typing | null = null
/** 指を置いている間（離すまで） */
let pressing = false
/** 今の押しで来た出来事（touch・pointer。同じ種類がまた来たら次の押し） */
const seen = { touch: false, pointer: false }
/** 最後に離した時（performance.now） */
let releasedAt = Number.NEGATIVE_INFINITY

const now = () => performance.now()

/** 3つのリストの枠（common/ListSection の data-list） */
const LIST_SELECTOR = '[data-list]'

/** 今打っている物（トップの画面でなければ・打っていなければ null） */
function typingNow(): Typing | null {
  if (!onTop?.()) return null
  if (quickAddOpen()) return { kind: 'quick-add', list: null, field: quickAddField() }
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
    if (!pressed || (!pressing && now() - releasedAt >= TYPING_GRACE_MS)) return false
    swipeLog('type-cancel', { kind: pressed.kind, list: pressed.list, gone: true })
    // リストの入力欄から外れていた（［足す］が変換を決めるために外した）: その打ちかけも捨てる。もう閉じた物はそのまま
    if (pressed.kind === 'list-input' && pressed.list && onTop?.()) discardListDraft(pressed.list)
    return true
  }
  swipeLog('type-cancel', { kind: typing.kind, list: typing.list })
  // 欄が見える所の上の端より上にはみ出していれば・ページの終わりなら、やめて縮む前に控える（keepOnScreen.ts）
  const keep = typing.field ? measureKeep(typing.field) : null
  if (typing.kind === 'quick-add') {
    cancelQuickAddByFlick()
    if (keep) keepAfterCancel(keep, typing)
    return true
  }
  if (typing.kind === 'list-input' && typing.list) discardListDraft(typing.list)
  else if (typing.kind === 'inline-edit' && typing.field) fieldCancelOf(typing.field)?.()
  // キーボードを閉じる（やめた後なので、離れた時に保存する欄も保存しない。フォーカスを移す所が無ければ body。ページは動かさない）
  const active = document.activeElement
  if (active instanceof HTMLElement && isTextEntry(active)) active.blur()
  if (keep) keepAfterCancel(keep, typing)
  return true
}

/**
 * やめて欄が縮んだ後、描く前に、見えている物を元の所へ戻す（keepOnScreen.ts。送った時は type-cancel-keep に、送った px と、ページの
 * 終わりでいちばん下の空きを足した時はその px を控える）。やめた描き直しは、払った指の出来事（touchend・popstate）の後のマイクロタスクで
 * React が済ませる（すぐ済ませる種類の出来事の更新）ので、次の描画の前（requestAnimationFrame）に測れば、描き直した後・描く前になる
 */
function keepAfterCancel(keep: () => Kept | null, typing: Typing): void {
  requestAnimationFrame(() => {
    const kept = keep()
    if (!kept) return
    const moved = Math.round(kept.moved * 10) / 10
    swipeLog('type-cancel-keep', { kind: typing.kind, list: typing.list, moved, ...(kept.space ? { space: kept.space } : {}) })
  })
}

/**
 * 画面の端に指を置いた時に、打っていたかを控える（捕まえる段の window。押した物の出来事より先）。1回の押しには touch の出来事と
 * pointer の出来事が1つずつ来る（どちらが先かはブラウザによる）。その押しで初めに見た時に打っていればそれを控え、後の出来事では
 * 打っていなくても控え直さない（間に［足す］が変換を決めるために欄から外すため）。同じ種類の出来事がまた来たら次の押し。離した時は
 * touch の出来事で見る（iPhone はページが少しでも動くと pointer を取り消すが、touch の出来事は離すまで来る）
 */
function watchPresses(): () => void {
  const down = (kind: 'touch' | 'pointer', x: number) => {
    const typing = edgeOfScreen(x) !== null ? typingNow() : null
    if (!pressing || seen[kind]) {
      // 次の押し
      seen.touch = false
      seen.pointer = false
      atPress = typing
    } else if (!atPress) atPress = typing
    seen[kind] = true
    pressing = true
  }
  const onPointer = (e: PointerEvent) => {
    if (e.pointerType === 'touch') down('pointer', e.clientX)
  }
  const onTouch = (e: TouchEvent) => {
    const t = e.touches?.[0]
    if (e.touches?.length === 1 && t) down('touch', t.clientX)
  }
  const release = (e: TouchEvent) => {
    if ((e.touches?.length ?? 0) !== 0) return
    pressing = false
    seen.touch = false
    seen.pointer = false
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
 * トップの画面（TopPage）が使う: トップの画面か（今いる所がカレンダーの画面か MIM で、小さな画面を開いていない）を届け、iPhone・
 * iPad では画面の端に指を置いた時に打っていたかを控える（Android・PC では何もしない）
 */
export function useTypingFlick(): void {
  const current = useCurrentLocation()
  useEffect(() => {
    const check = () => {
      const location = current()
      const screen = screenOf(location)
      return screen === 'calendar' || (screen === 'other' && isMimPath(location.pathname))
    }
    onTop = check
    const unwatch = currentPopSource() === 'edge-flick' ? watchPresses() : null
    return () => {
      unwatch?.()
      if (onTop === check) onTop = null
      forgetPresses()
    }
  }, [current])
}

/** 控えた押しを忘れる */
function forgetPresses(): void {
  atPress = null
  pressing = false
  seen.touch = false
  seen.pointer = false
  releasedAt = Number.NEGATIVE_INFINITY
}

/** テスト用: 控えた物を忘れる */
export const resetTypingFlickForTests = forgetPresses
