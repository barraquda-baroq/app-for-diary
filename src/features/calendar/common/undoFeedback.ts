// 操作の列の元に戻す・やり直す（ボタン・キー）で当てた時のお知らせと、当てた予定・休みの日を見せること（docs/SPEC.md の 7.13・3.9・
// 4.9。■26 の今の決め方。作者「切り替え先のモードで、元に戻すとやり直すボタンはエフェクトとしては反応しているようだが、画面が何も
// 変わらないので何が起きているかわからない」）。UndoButtons が使う（ウィークリー・デイリーを出している間だけ）。
// - 文はボタンの名前と同じ言葉（「元に戻しました：『打ち合わせ』を移した（11/14（土）→ 11/12（木））」。src/domain/itemText.ts の
//   undoDoneText）。新しく当てると、前に当てた時のお知らせを置き換える（重ねない）。［元に戻す］は付けない（操作の列のボタンがある）。
//   長さは 3.9 のとおり（［見る］の無い物は 4秒、［見る］付きは 6秒）。断った時（「ほかの所で直されたので戻せません」）は今までどおりで、
//   前に出したこのお知らせは消す（「元に戻しました」と「戻せません」を並べない）
// - 当てた予定（休みはその日の見出し）が今の画面で見えていれば、すぐ 1.2秒目立たせる（4.9。画面の下のお知らせと重なる時は、その上まで
//   送る。useFlashTarget）。複数日の予定は、動いた端の日が今の期間の外でも、予定の期間が今の期間に掛かって出ている物が見えていれば
//   見えているとする。見えていない（今の期間の外・スクロールの外）時は［見る］を付け、押すと今のモードのままその日の期間へ移り
//   （［‹］［›］と同じく置き換え、ページをめくる）、見える所まで出して目立たせる。今の期間の中に出ていれば移らずに出して目立たせる。
//   押した時に予定を読み直し、ほかの所で日が替わっていれば今の日へ、無くなっていれば移らない
// - 当てた後に予定が無い（足したのを戻した・削除をやり直した。ゴミ箱へ）・カレンダーに出ない時は文だけ。今の期間の中なのに目立たせる
//   所が出ていない時も文だけ（デイリーの「+n」の中に隠れた予定は「+n」の札を目立たせる。Timeline.tsx）
// - すばやく足すを開いている時は［見る］を付けない（押すと、開いているすばやく足すは押し終わったとして閉じ、打っている字を足すので
//   （3.9・12.1）、戻した操作のやり直しが消える）。入力欄がお知らせと重なる時は、その上まで送る（開いた時と同じく、ページも動かして
//   よい。4.9）
// - 小さな画面（登録・詳細）を開いた時は、［見る］を外したお知らせに替える（開いている間は移れない。開いている画面の履歴を置き換え
//   ない）。年・月へ替えた時・カレンダーを離れた時は、お知らせを消す（［見る］の行き先は週・日の物）
// - 読み上げは、ほかのお知らせと同じ（画面の下の aria-live="assertive" の所に role="status" で出る。src/ui/Layout.tsx）
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { undoDoneText } from '../../../domain/itemText'
import { periodOf } from '../../../domain/items'
import { undoFocus, type UndoDirection, type UndoFocus, type UndoStep } from '../../../domain/undo'
import { getData } from '../../../store/appStore'
import { notify, useCalendarUi, useToasts } from '../../../store/uiStore'
import { useUndo } from '../../../store/undoStore'
import { scrollBehavior } from '../../../ui/motion'
import { isShownWithin, toastInset } from '../../../ui/scrollWithin'
import { periodRange, type Period } from './calendarRoute'
import { flashKey, flashTargetsOf } from './parts'
import { sheetOf } from './sheets'
import type { CalendarMode } from './types'
import { useCalendarNav } from './useCalendarRoute'

/** お知らせのボタン（3.9） */
export const LOOK_LABEL = '見る'

/** 戻した・やり直した時にすること */
export interface UndoFeedbackPlan {
  /** お知らせの文 */
  text: string
  /** 目立たせる所のキー（無ければ目立たせない） */
  key: string | null
  /** 見せる所（［見る］で移る日） */
  focus: UndoFocus | null
  /** ［見る］を付けるか */
  look: boolean
  /** すぐ目立たせるか（見えている時） */
  flashNow: boolean
}

/** 見せる所の目立たせるキー（予定はカード・行・枠、休みは日の見出し） */
export const focusKey = (f: UndoFocus): string => (f.table === 'items' ? flashKey.item(f.id) : flashKey.dayHead(f.date))

/** その日の範囲が今の期間に掛かるか */
const overlaps = (f: { from: string; to: string }, p: Period): boolean => f.from <= p.to && f.to >= p.from

/**
 * 戻した・やり直した時にすることを決める（period は今の画面の期間、find は今出ている目立たせる所、shown は見えているか）:
 * - 予定の期間（span）が今の期間に掛かり、そこに出ている目立たせる所のどれかが見えていれば、すぐ目立たせる（［見る］無し。複数日の
 *   予定で、動いた端の日が今の期間の外でも）
 * - 見えていない時は［見る］。ただし今の期間の中に何も出ておらず、動いた端も今の期間の中なら（行っても出ない）文だけ
 */
export function planUndoFeedback(
  applied: { dir: UndoDirection; step: UndoStep },
  period: Period,
  find: (key: string) => Element[] = flashTargetsOf,
  shown: (el: Element) => boolean = isShownWithin,
): UndoFeedbackPlan {
  const text = undoDoneText(applied.dir, applied.step)
  const focus = undoFocus(applied.step, applied.dir)
  if (!focus) return { text, key: null, focus: null, look: false, flashNow: false }
  const key = focusKey(focus)
  const els = overlaps(focus.span, period) ? find(key) : []
  if (els.some((el) => shown(el))) return { text, key, focus, look: false, flashNow: true }
  return { text, key, focus, look: els.length > 0 || !overlaps(focus, period), flashNow: false }
}

/** ［見る］を押した時の見せる所（予定は今の記録で読み直す。ほかの所で日が替わっていれば今の期間へ。無くなっていれば null） */
function currentFocus(f: UndoFocus): UndoFocus | null {
  if (f.table !== 'items') return f
  const item = getData().items[f.id]
  const p = item ? periodOf(item) : null
  if (!p) return null
  if (p.from === f.span.from && p.to === f.span.to) return f
  return { ...f, date: p.from, from: p.from, to: p.to, span: { from: p.from, to: p.to } }
}

/** 開いているすばやく足すの入力欄（12.1。開いているのは1つだけ） */
const openQuickAddInput = (): HTMLElement | null => document.querySelector<HTMLElement>('.cp-quick-input')

/**
 * ボタン・キーで戻した・やり直した時のお知らせと目立たせ（UndoButtons が呼ぶ。mode・viewed は今の画面、active はウィークリー・
 * デイリーを出しているか）
 */
export function useUndoFeedback(mode: CalendarMode, viewed: string, active: boolean): void {
  const applied = useUndo((s) => s.applied)
  const refused = useUndo((s) => s.refused)
  const toasts = useToasts((s) => s.toasts)
  const sheetOpen = sheetOf(useLocation().state) !== null
  const nav = useCalendarNav()
  const { from, to } = periodRange(mode, viewed)
  const now = useRef({ period: { from, to }, nav })
  now.current = { period: { from, to }, nav }
  /** 出しているお知らせ（番号・文・［見る］の行き先。置き換える・消す） */
  const toast = useRef<{ id: number; text: string; focus: UndoFocus | null } | null>(null)
  /** 入力欄をお知らせの上まで送ったお知らせの番号（1つのお知らせで1回） */
  const lifted = useRef<number | null>(null)
  /** 出し終えた applied（描き直した時・出し直した部品で、前に当てた物を出さない） */
  const handled = useRef(applied?.seq ?? 0)
  /** ［見る］で移った先で目立たせる物（移り終えてから） */
  const pending = useRef<{ key: string; date: string } | null>(null)

  const dismiss = useCallback(() => {
    if (toast.current !== null) useToasts.getState().dismiss(toast.current.id)
    toast.current = null
  }, [])

  const reveal = useCallback((at: UndoFocus) => {
    // 小さな画面（詳細など）を開いている間は移らない（その画面の履歴を置き換えない。開いた時に［見る］は外している）
    if (document.querySelector('[aria-modal="true"]')) return
    const f = currentFocus(at)
    if (!f) return
    const { period, nav } = now.current
    const key = focusKey(f)
    // 今の期間の中に出ていれば（スクロールの外でも）移らずに出して目立たせる
    if ((overlaps(f.span, period) && flashTargetsOf(key).length > 0) || overlaps(f, period)) {
      useCalendarUi.getState().flashTarget(key)
      return
    }
    // 移り終えてから目立たせる（先に置くと、移る前の画面の同じ予定（前の週から続く物）が目立ってしまう）
    pending.current = { key, date: f.date }
    nav.goTo(f.date)
  }, [])

  /** お知らせを出す（前の物は置き換える。focus があれば［見る］付き） */
  const show = useCallback(
    (text: string, focus: UndoFocus | null) => {
      dismiss()
      const id = notify(text, focus ? { label: LOOK_LABEL, run: () => reveal(focus) } : undefined)
      toast.current = { id, text, focus }
    },
    [dismiss, reveal],
  )

  // 当てた時（当てた記録を描き終えてから。見えているかは描いた後の画面で見る）
  useEffect(() => {
    if (!applied || applied.seq === handled.current) return
    handled.current = applied.seq
    if (!active) return
    const plan = planUndoFeedback(applied, now.current.period)
    // すばやく足すを開いている間は［見る］を付けない（押すと打っている字を足して閉じる。3.9・12.1）
    show(plan.text, plan.look && !openQuickAddInput() ? plan.focus : null)
    if (plan.flashNow && plan.key) useCalendarUi.getState().flashTarget(plan.key)
    // 当てた時だけ（active・関数は描き直しで替わらない物と、今の値を読むだけ）
  }, [applied])

  // ボタン・キーで断った時は、前に出したお知らせを消す（「ほかの所で直されたので戻せません」だけにする）
  useEffect(() => {
    if (refused) dismiss()
  }, [refused, dismiss])

  // 出したお知らせが、開いているすばやく足すの入力欄と重なる時は、入力欄をその上の端から 8px 上まで送る（お知らせを描いた後に。
  // 打っている欄は全部見えていることが大事なので、開いた時と同じくページも動かしてよい（scrollIntoView。週・段の中だけでは、S の土曜の
  // 欄など週の終わりの近くの欄を出せない。4.9）。お知らせの分は、送る間だけ欄の下の scroll-margin に足して見込ませる
  useLayoutEffect(() => {
    const t = toast.current
    if (!t || lifted.current === t.id || !toasts.some((x) => x.id === t.id)) return
    lifted.current = t.id
    const input = openQuickAddInput()
    if (!input) return
    const inset = toastInset(input)
    if (inset <= 0) return
    const margin = input.style.scrollMarginBottom
    input.style.scrollMarginBottom = `${inset}px`
    input.scrollIntoView({ block: 'nearest', behavior: scrollBehavior() })
    input.style.scrollMarginBottom = margin
  }, [toasts])

  // 小さな画面（登録・詳細）を開いたら、［見る］を外したお知らせに替える（開いている間は移れない）
  useEffect(() => {
    const t = toast.current
    if (!sheetOpen || !t?.focus) return
    if (!useToasts.getState().toasts.some((x) => x.id === t.id)) return
    show(t.text, null)
  }, [sheetOpen, show])

  // ［見る］で移った先を描き終えたら目立たせる（見える所まで出すのは目立たせる側。useFlashTarget）
  useEffect(() => {
    const p = pending.current
    if (!p) return
    pending.current = null
    if (from <= p.date && p.date <= to) useCalendarUi.getState().flashTarget(p.key)
  }, [mode, from, to])

  // 年・月へ替えた・カレンダーを離れた時は消す
  useEffect(() => {
    if (active) return
    dismiss()
    pending.current = null
  }, [active, dismiss])
  useEffect(() => dismiss, [dismiss])
}
