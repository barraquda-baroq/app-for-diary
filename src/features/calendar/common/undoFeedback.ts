// 操作の列の元に戻す・やり直す（ボタン・キー）で当てた時のお知らせと、当てた予定・休みの日を見せること（docs/SPEC.md の 7.13・3.9・
// 4.9。■26 の今の決め方。作者「切り替え先のモードで、元に戻すとやり直すボタンはエフェクトとしては反応しているようだが、画面が何も
// 変わらないので何が起きているかわからない」）。UndoButtons が使う（ウィークリー・デイリーを出している間だけ）。
// - 文はボタンの名前と同じ言葉（「元に戻しました：『打ち合わせ』を移した（11/14（土）→ 11/12（木））」。src/domain/itemText.ts の
//   undoDoneText）。新しく当てると、前に当てた時のお知らせを置き換える（重ねない）。［元に戻す］は付けない（操作の列のボタンがある）。
//   長さは 3.9 のとおり（［見る］の無い物は 4秒、［見る］付きは 6秒）。断った時（「ほかの所で直されたので戻せません」）は今までどおり
// - 当てた予定（休みはその日の見出し）が今の画面で見えていれば、すぐ 1.2秒目立たせる（4.9。画面の下のお知らせと重なる時は、その上まで
//   送る。useFlashTarget）。見えていない（今の期間の外・スクロールの外）時は［見る］を付け、押すと今のモードのままその日の期間へ移り
//   （［‹］［›］と同じく置き換え、ページをめくる）、見える所まで出して目立たせる。今の期間の中なら移らずに出して目立たせる
// - 当てた後に予定が無い（足したのを戻した・削除をやり直した。ゴミ箱へ）・カレンダーに出ない時は文だけ。今の期間の中なのに目立たせる
//   所が出ていない時（デイリーの「+n」の中）も文だけ
// - 年・月へ替えた時・カレンダーを離れた時は、お知らせを消す（［見る］の行き先は週・日の物）。小さな画面（詳細など）を開いている間に
//   ［見る］を押しても移らない（開いている画面の履歴を置き換えない）
// - 読み上げは、ほかのお知らせと同じ（画面の下の aria-live="assertive" の所に role="status" で出る。src/ui/Layout.tsx）
import { useCallback, useEffect, useRef } from 'react'
import { undoDoneText } from '../../../domain/itemText'
import { undoFocus, type UndoDirection, type UndoFocus, type UndoStep } from '../../../domain/undo'
import { notify, useCalendarUi, useToasts } from '../../../store/uiStore'
import { useUndo } from '../../../store/undoStore'
import { isShownWithin } from '../../../ui/scrollWithin'
import { periodRange, type Period } from './calendarRoute'
import { flashKey, flashTargetsOf } from './parts'
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

/** 見せる所が今の期間に掛かるか */
const overlaps = (f: Pick<UndoFocus, 'from' | 'to'>, p: Period): boolean => f.from <= p.to && f.to >= p.from

/**
 * 戻した・やり直した時にすることを決める（period は今の画面の期間、find は今出ている目立たせる所、shown は見えているか）。
 * 今の期間の外なら［見る］、中で目立たせる所のどれかが見えていればすぐ目立たせ、どれも見えていなければ［見る］、出ていなければ文だけ
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
  if (!overlaps(focus, period)) return { text, key, focus, look: true, flashNow: false }
  const els = find(key)
  if (els.length === 0) return { text, key, focus, look: false, flashNow: false }
  const visible = els.some((el) => shown(el))
  return { text, key, focus, look: !visible, flashNow: visible }
}

/**
 * ボタン・キーで戻した・やり直した時のお知らせと目立たせ（UndoButtons が呼ぶ。mode・viewed は今の画面、active はウィークリー・
 * デイリーを出しているか）
 */
export function useUndoFeedback(mode: CalendarMode, viewed: string, active: boolean): void {
  const applied = useUndo((s) => s.applied)
  const nav = useCalendarNav()
  const { from, to } = periodRange(mode, viewed)
  const now = useRef({ period: { from, to }, nav })
  now.current = { period: { from, to }, nav }
  /** 出しているお知らせの番号（置き換える・消す） */
  const toast = useRef<number | null>(null)
  /** 出し終えた applied（描き直した時・出し直した部品で、前に当てた物を出さない） */
  const handled = useRef(applied?.seq ?? 0)
  /** ［見る］で移った先で目立たせる物（移り終えてから） */
  const pending = useRef<{ key: string; date: string } | null>(null)

  const dismiss = useCallback(() => {
    if (toast.current !== null) useToasts.getState().dismiss(toast.current)
    toast.current = null
  }, [])

  const reveal = useCallback((f: UndoFocus) => {
    // 小さな画面（詳細など）を開いている間は移らない（その画面の履歴を置き換えない）
    if (document.querySelector('[aria-modal="true"]')) return
    const { period, nav } = now.current
    const key = focusKey(f)
    if (overlaps(f, period)) {
      useCalendarUi.getState().flashTarget(key)
      return
    }
    // 移り終えてから目立たせる（先に置くと、移る前の画面の同じ予定（前の週から続く物）が目立ってしまう）
    pending.current = { key, date: f.date }
    nav.goTo(f.date)
  }, [])

  // 当てた時（当てた記録を描き終えてから。見えているかは描いた後の画面で見る）
  useEffect(() => {
    if (!applied || applied.seq === handled.current) return
    handled.current = applied.seq
    if (!active) return
    const plan = planUndoFeedback(applied, now.current.period)
    dismiss()
    const focus = plan.look ? plan.focus : null
    toast.current = notify(plan.text, focus ? { label: LOOK_LABEL, run: () => reveal(focus) } : undefined)
    if (plan.flashNow && plan.key) useCalendarUi.getState().flashTarget(plan.key)
    // 当てた時だけ（active・関数は描き直しで替わらない物と、今の値を読むだけ）
  }, [applied])

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
