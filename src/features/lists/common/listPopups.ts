// 3つのリストのメニュー・小窓が開いている間、それを閉じる関数を届ける所（docs/SPEC.md の 3.1・■34。開発）。届けるのは、行の「…」の
// メニュー（common/RowMenu）・Task List の行の日付のメニューと小さな月のカレンダー（task/TaskRow）・チップのメニューと小さな月の
// カレンダー（task/TaskChips）・Routine List の［指定］の小窓（routine/RoutineInput）。
// - これが開いている時の「戻る」（Android・PC の OS の戻る・進む、iPhone・iPad の端からのフリック）は、それだけを閉じて使い切る
//   （確かめのダイアログと同じ。src/features/top/closeApp.ts の consumeBackPress が、カレンダーの決まりより先に呼ぶ）。リストは畳まず、
//   入力欄の打ちかけも残す（■34 でそのリストを畳んで打ちかけを捨てるのは、何も開いていない時の「戻る」だけ）。次の「戻る」で畳む
// - iPhone・iPad の端からのフリックは、画面の端に指を置いた時にメニュー・小窓の外を押したことになり、払い終える前に閉じる（PopupMenu・
//   Popover は外を押すと閉じる）。それでも使い切るよう、画面の端（src/history/edgeFlick.ts の edgeOfScreen。端の幅は今の物）で
//   メニュー・小窓の外に指を置いた時に開いていたかを控え、その指を離すまでと、離してから PRESS_GRACE_MS までに来た「戻る」も、閉じた
//   物として使い切る（1回だけ）。次に押した時に控え直す。端でない所・メニューや小窓の中を押した指（項目を選んだ）・マウスは控えない
import { useEffect, useLayoutEffect, useRef } from 'react'
import { edgeOfScreen } from '../../../history/edgeFlick'

/** 押し始めた時に開いていたメニュー・小窓を、指を離した後もその押しの物とみなす長さ（ms。払いは離した時に決まる） */
export const PRESS_GRACE_MS = 300

interface Entry {
  close: () => void
}

/** 開いているメニュー・小窓 */
const open = new Set<Entry>()
/** 今の指を画面の端（メニュー・小窓の外）に置いた時に、メニュー・小窓が開いていたか */
let openAtPress = false
/** 指を置いている間（離すまで） */
let pressing = false
/** 最後に離した時（performance.now） */
let releasedAt = Number.NEGATIVE_INFINITY
let watching = false

const now = () => performance.now()

/** メニュー・小窓（とダイアログ）の中か */
const POPUP_SELECTOR = '[role="menu"], [role="dialog"], .it-pop'

/** 押し始め・離した時を見張る（初めて開いた時に1回だけ付ける。捕まえる段の window なので、外を押して閉じるより先に来る） */
function watchPresses(): void {
  if (watching || typeof window === 'undefined') return
  watching = true
  window.addEventListener(
    'pointerdown',
    (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return
      const inside = e.target instanceof Element && e.target.closest(POPUP_SELECTOR) !== null
      openAtPress = open.size > 0 && !inside && edgeOfScreen(e.clientX) !== null
      pressing = true
    },
    true,
  )
  // 離した時は touch の出来事で見る（iPhone は、ページが少しでも動くと pointer を取り消すが、touch の出来事は離すまで来る）
  const release = () => {
    pressing = false
    releasedAt = now()
  }
  window.addEventListener('touchend', release, true)
  window.addEventListener('touchcancel', release, true)
}

/** 開いている間（isOpen）、閉じる関数を届ける。メニュー・小窓を出す部品が呼ぶ */
export function useListPopup(isOpen: boolean, close: () => void): void {
  const latest = useRef(close)
  useEffect(() => {
    latest.current = close
  })
  useLayoutEffect(() => {
    if (!isOpen) return
    watchPresses()
    const entry: Entry = { close: () => latest.current() }
    open.add(entry)
    return () => {
      open.delete(entry)
    }
  }, [isOpen])
}

/** リストのメニュー・小窓が開いているか */
export function listPopupOpen(): boolean {
  return open.size > 0
}

/**
 * 「戻る」が来た時: 開いているリストのメニュー・小窓をすべて閉じる。開いていた時（今の押しの始めに開いていて、その押しで閉じた時も）
 * true（その「戻る」は使い切る）
 */
export function closeListPopups(): boolean {
  const any = open.size > 0
  for (const entry of [...open]) {
    open.delete(entry)
    entry.close()
  }
  const byPress = openAtPress && (pressing || now() - releasedAt < PRESS_GRACE_MS)
  openAtPress = false
  return any || byPress
}

/** テスト用: 届いた物と押しの控えを忘れる */
export function resetListPopupsForTests(): void {
  open.clear()
  openAtPress = false
  pressing = false
  releasedAt = Number.NEGATIVE_INFINITY
}
