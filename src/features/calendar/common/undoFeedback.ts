// 操作の列の元に戻す・やり直す（ボタン・キー）で当てた予定・休みの日を見せること（docs/SPEC.md の 7.13・3.9・4.9。■26 の作者の
// 答え「アンドゥ、リドゥ元のページに強制移行させ、画面下に説明のお知らせをユーザーが確認ボタンを押すまで表示し続ける」と、その前の
// 「ページを切り替えてのアンドゥ、リドゥはできるなら、下に何をしたかの説明を残しながら、そのページに強制的に移動させる仕様にして
// 欲しいです」）。UndoButtons が使う（ウィークリー・デイリーを出している間だけ）。
// - お知らせ（「元に戻しました：『打ち合わせ』を移した（11/14（土）→ 11/12（木））」［OK］）は src/store/undoStore.ts が出す（［OK］を
//   押すまで出し、次に押した時の物で置き換える）。ここは、当てた所を見せるだけ
// - 当てた予定（休みはその日の見出し）が今の週・日に出ていれば、移らずに 1.2秒目立たせる（4.9。週・区切り・タイムスケジュールの
//   中のスクロールの外なら、見える所まで送って。画面の下のお知らせと重なる時は、その上まで。useFlashTarget）。複数日の予定は、
//   動いた端の日が今の期間の外でも、予定の期間が今の期間に掛かって出ている物があれば、そこを目立たせる
// - 今の週・日に無ければ、今のモードのまま（週は週、日は日）その日を含む期間へ移り（［‹］［›］と同じく置き換え、ページをめくる。
//   履歴は増えない）、移った先で目立たせる。行き先は前の［見る］と同じ（日付が動いた操作は動いた端の日、日付の変わらない操作は
//   期間の初めの日。src/domain/undo.ts の undoFocus）
// - 続けて押して、前の分で移る途中（移る先をまだ描いていない）に次の分が当たった時は、移る先を描き終えてから、そこで最後に当てた
//   分を決め直す（キーを押したままにした時など。終わりは、いつも最後に押した分の所）
// - 当てた後に予定が無い（足したのを戻した・削除をやり直した。ゴミ箱へ）・カレンダーに出ない時は、移らず文だけ。今の期間の中なのに
//   目立たせる所が出ていない時も文だけ（デイリーの「+n」の中に隠れた予定は「+n」の札を目立たせる。Timeline.tsx）
// - 移る時に、開いているすばやく足すは閉じる（週・日が替わると画面が閉じる。打っている字は足さず、書きかけに残る。12.1。■26 の
//   答えの読み）。移らない時は開いたまま（フォーカスもそのまま）。当てた所が見えている時（と目立たせる所の無い時）は、入力欄が
//   お知らせと重なれば、その上まで送る（開いた時と同じく、ページも動かしてよい。4.9）。その時、当てた所は送らずに目立たせる（入力欄と
//   一緒に動く。打っている欄を先にするので、当てた所がお知らせに重なったまま・上の端の外へ出ることがある）。当てた所が週・区切りの
//   中のスクロールの外の時は、そこを見える所まで送るのを先にし、入力欄は送らない（入力欄は見えなくなることがある。続けて打つと、
//   ブラウザが入力欄を出す。Chromium で確かめた）。お知らせの［OK］を押しても、すばやく足すは閉じない（字も足さない。
//   src/ui/keepQuickAdd.ts）
// - 小さな画面（登録・詳細・確かめ）を開いている間・掴んでいる間に当てるのが終わった時は移らない（開いている画面の履歴を置き換え
//   ない。開いている間はボタン・キーは効かないので、押した分が後から終わった時だけ）
import { useEffect, useRef } from 'react'
import { todayStr } from '../../../domain/dates'
import { undoFocus, type UndoDirection, type UndoFocus, type UndoStep } from '../../../domain/undo'
import { useCalendarUi, usePrefs } from '../../../store/uiStore'
import { useUndo, type UndoApplied } from '../../../store/undoStore'
import { isShownWithin, toastInset } from '../../../ui/scrollWithin'
import { parseCalendarPath, periodRange, type Period } from './calendarRoute'
import { flashKey, flashTargetsOf, revealQuickAddInput } from './parts'
import { useCurrentLocation } from './sheets'
import type { CalendarMode } from './types'
import { useCalendarNav } from './useCalendarRoute'

/** 戻した・やり直した時の見せ方 */
export interface UndoReveal {
  /** 目立たせる所のキー（無ければ目立たせない） */
  key: string | null
  /** 移る日（今のモードのまま、その日を含む期間へ。今の期間に出ていれば null） */
  goTo: string | null
  /** 開いているすばやく足すの入力欄を、お知らせの上まで送るか（移らず、当てた所が見えている・目立たせる所が無い時） */
  lift: boolean
}

/** 見せる所の目立たせるキー（予定はカード・行・枠、休みは日の見出し） */
export const focusKey = (f: UndoFocus): string => (f.table === 'items' ? flashKey.item(f.id) : flashKey.dayHead(f.date))

/** その日の範囲が今の期間に掛かるか */
const overlaps = (f: { from: string; to: string }, p: Period): boolean => f.from <= p.to && f.to >= p.from

/**
 * 戻した・やり直した時の見せ方を決める（period は今の画面の期間、find は今出ている目立たせる所、shown は見えているか）:
 * - 予定の期間（span）が今の期間に掛かり、そこに目立たせる所が出ていれば、移らずに目立たせる（見えていなければ目立たせる側が
 *   見える所まで送る。複数日の予定で、動いた端の日が今の期間の外でも）。すばやく足すの入力欄は、どれかが見えている時だけ送る
 * - 出ていなくて、動いた端の日が今の期間の外なら、その日へ移って目立たせる。今の期間の中なら（行っても出ない）文だけ
 */
export function planUndoReveal(
  applied: { dir: UndoDirection; step: UndoStep },
  period: Period,
  find: (key: string) => Element[] = flashTargetsOf,
  shown: (el: Element) => boolean = isShownWithin,
): UndoReveal {
  const focus = undoFocus(applied.step, applied.dir)
  if (!focus) return { key: null, goTo: null, lift: true }
  const key = focusKey(focus)
  const els = overlaps(focus.span, period) ? find(key) : []
  if (els.length > 0) return { key, goTo: null, lift: els.some((el) => shown(el)) }
  if (overlaps(focus, period)) return { key: null, goTo: null, lift: true }
  return { key, goTo: focus.date, lift: false }
}

/** 開いているすばやく足すの入力欄（12.1。開いているのは1つだけ） */
const openQuickAddInput = (): HTMLElement | null => document.querySelector<HTMLElement>('.cp-quick-input')

/**
 * 開いているすばやく足すの入力欄が画面の下のお知らせと重なる時は、入力欄をその上の端から 8px 上まで送る（お知らせを描いた後に。
 * 打っている欄は全部見えていることが大事なので、開いた時と同じくページも動かしてよい（scrollIntoView。週・段の中だけでは、S の土曜の
 * 欄など週の終わりの近くの欄を出せない。4.9）。送り方は開いた時と同じ（revealQuickAddInput）。送った時 true
 */
function liftQuickAdd(): boolean {
  const input = openQuickAddInput()
  if (!input || toastInset(input) <= 0) return false
  revealQuickAddInput(input)
  return true
}

/** 同じ期間か */
const samePeriod = (a: Period, b: Period): boolean => a.from === b.from && a.to === b.to

/** 今は移れない（小さな画面・確かめを開いている・掴んでいる） */
const cannotMove = (): boolean => document.querySelector('[aria-modal="true"]') !== null || useCalendarUi.getState().dragging

/**
 * ボタン・キーで戻した・やり直した時に、当てた所を見せる（UndoButtons が呼ぶ。mode・viewed は今の画面、active はウィークリー・
 * デイリーを出しているか）。
 * 移る途中に次の分が当たった時（続けて押した: 前の分で移る先の期間をまだ描いていない）は、描いている期間では決めず、移る先を
 * 描き終えてから、そこで最後に当てた分を決め直す（そこに出ていれば目立たせ、無ければまたその日へ移る）。描いている期間で決めると、
 * 見えている前の週で目立たせた後に、前の分の移る先の週へ着いてしまう（最後に押した分の所が出ない）
 */
export function useUndoFeedback(mode: CalendarMode, viewed: string, active: boolean): void {
  const applied = useUndo((s) => s.applied)
  const refused = useUndo((s) => s.refused)
  const nav = useCalendarNav()
  const here = useCurrentLocation()
  const { from, to } = periodRange(mode, viewed)
  const now = useRef({ mode, period: { from, to }, nav, here, active })
  now.current = { mode, period: { from, to }, nav, here, active }
  /** 見せ終えた applied・refused（描き直した時・出し直した部品で、前に当てた物をもう一度見せない） */
  const handled = useRef({ applied: applied?.seq ?? 0, refused })
  /** 移る途中の物: 最後に当てた分と、移る先の期間（描き終えたら、そこで決め直す） */
  const pending = useRef<{ applied: UndoApplied; dest: Period } | null>(null)

  /** ルーターが今いる所（移る途中なら移る先）の期間（カレンダーの行き先でない時は null） */
  const routed = (): Period | null => {
    const p = parseCalendarPath(now.current.here().pathname, todayStr(), usePrefs.getState().lastMode)
    return p && { from: p.from, to: p.to }
  }

  /**
   * 描いている期間（period）で、当てた所を見せる: 出ていれば移らずに目立たせ、無ければ今のモードのままその日へ移る（移り終えて
   * から、移った先で決め直して目立たせる。先に置くと、移る前の画面の同じ予定（前の週から続く物）が目立ってしまう）。開いている
   * すばやく足すは、週・日が替わって閉じる（字は足さずに書きかけに残る）
   */
  const reveal = (a: UndoApplied, period: Period): void => {
    const plan = planUndoReveal(a, period)
    if (plan.goTo && plan.key) {
      if (cannotMove()) return
      pending.current = { applied: a, dest: periodRange(now.current.mode, plan.goTo) }
      now.current.nav.goTo(plan.goTo)
      return
    }
    // 開いているすばやく足すの入力欄をお知らせの上へ送った時は、当てた所は送らずに目立たせる（当てた所は見えていて、入力欄と一緒に
    // 上へ動く。同じ箱（週の中）を二つの送りで動かすと、後の送りが先の送りを止めて、入力欄がお知らせの下に残る。打っている欄を先にする）
    const lifted = plan.lift && liftQuickAdd()
    if (!plan.key) return
    if (lifted) useCalendarUi.getState().flashInPlace(plan.key)
    else useCalendarUi.getState().flashTarget(plan.key)
  }

  // 当てた時（当てた記録とお知らせを描き終えてから）
  useEffect(() => {
    if (!applied || applied.seq === handled.current.applied) return
    handled.current.applied = applied.seq
    const { period, active } = now.current
    if (!active) return
    const r = routed()
    const moving = pending.current
    if (r && !samePeriod(r, period)) {
      // 移る途中（前に押した分・［‹］［›］など。ルーターはもう移る先にいて、まだ描いていない）: 移る先で決める
      pending.current = { applied, dest: r }
      return
    }
    if (moving && !samePeriod(moving.dest, period)) {
      // 前に押した分で移る途中（ルーターがまだ移っていない）: その移る先で決める
      pending.current = { applied, dest: moving.dest }
      return
    }
    pending.current = null
    reveal(applied, period)
    // 当てた時だけ（関数は描き直しで替わらない物と、今の値を読むだけ）
  }, [applied])

  // ボタン・キーで断った時（「ほかの所で直されたので戻せません」も［OK］まで出すので、すばやく足すの入力欄はその上へ）
  useEffect(() => {
    if (refused === handled.current.refused) return
    handled.current.refused = refused
    if (now.current.active) liftQuickAdd()
  }, [refused])

  // 移る先を描き終えたら、最後に当てた分をそこで決め直す（目立たせる・まだ無ければまた移る。見える所まで出すのは目立たせる側。
  // useFlashTarget）。まだ移る途中（ルーターは先にいる）なら待つ。ほかの所へ移った（［‹］［›］などで、移る先と違う所を描いた）時は、
  // 見せるのをやめる
  useEffect(() => {
    const p = pending.current
    if (!p) return
    const period = { from, to }
    const r = routed()
    if (r && !samePeriod(r, period)) return
    pending.current = null
    if (samePeriod(p.dest, period) && now.current.active) reveal(p.applied, period)
    // 描いた期間が替わった時だけ（関数は今の値を読むだけ）
  }, [mode, from, to])

  // 年・月へ替えた・カレンダーを離れた時は、移った先で目立たせるのをやめる（お知らせは［OK］まで残す）
  useEffect(() => {
    if (!active) pending.current = null
  }, [active])
}
