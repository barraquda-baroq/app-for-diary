// 落とした時にすること（docs/SPEC.md の 7.11・3.9・4.9・13.6）: 決まり（src/domain/drag.ts の dropPatch）で日付を決めて動かし、
// 「11/12（木）へ移しました［元に戻す］」などを 6秒出し（［元に戻す］は動かす前の開始日・締め切り日・終了時刻に戻す。戻せない時は
// その旨のエラーのお知らせ。D25）、移った先のカードを 1.2秒目立たせる（FRAME-231）。元の日（'same'）・落とせない日・取り消し
// （Esc）では何もしない（並べ替えもしない。CALENDAR-094・173）。
// 落とした後は 160ms の ease-out で収まる（FRAME-230・CALENDAR-182）:
// - 動かした時: カードは React が元の列から外して移った先の列に描き直すので、dnd-kit の落とす時の動き（浮いた物が元の場所へ戻る）は
//   見えない（WP11s の G5）。それは使わず（WeekDnd が dropAnimation を null に）、移った先の新しいカードを浮いた見た目から収める（settle）
// - 動かさなかった時（元の日・落とせない所・取り消し）: dnd-kit の落とす時の動きで、浮いた物が元の場所へ戻る（SETTLE_BACK）
// 視差効果を減らす設定ではどちらも動かさない（dnd-kit も自分で止める。目立たせる枠は motion.ts のとおり出る。CALENDAR-265・FRAME-238）
// 移った先のカードは、並びの決まり（7.5）で指を離した所より下（段・日のかたまりの見えていない所）に入ることがあるので、目立たせる
// 間に見える所まで出す（reveal。CALENDAR-181）
import { dropPatch, dropToast } from '../../../../domain/drag'
import { actions } from '../../../../store/actions'
import { attempt, notify, useCalendarUi } from '../../../../store/uiStore'
import { prefersReducedMotion, scrollBehavior } from '../../../../ui/motion'
import { flashKey, UNDO_LABEL } from '../../common/parts'
import type { DragData, DropData, WeekCtx } from './types'

/** 落とした後に収まる時間（ms。src/styles.css の --dur-settle と同じ） */
export const SETTLE_MS = 160

/** 動かさなかった時（元の日・落とせない所・取り消し）に、浮いたカードが元の場所へ戻る動き（dnd-kit の Feedback の dropAnimation） */
export const SETTLE_BACK = { duration: SETTLE_MS, easing: 'ease-out' } as const

/**
 * 掴んだ物（data）を落とす所（target）に落とす。動かした時は true（お知らせを出し、目立たせるキーを置いた）。
 * 元の日・落とせない日・決まりで断られた時は false（断られた時のエラーのお知らせは attempt が出す）
 */
export function applyDrop(data: DragData, target: DropData, week: WeekCtx): boolean {
  const { item, handle } = data
  const patch = dropPatch(item, handle, target, week)
  if (patch === null || patch === 'same') return false
  const prev = attempt(() => actions.moveItemDates(item.id, patch))
  if (prev === undefined) return false
  useCalendarUi.getState().flashTarget(flashKey.item(item.id))
  notify(dropToast(item, handle, patch), {
    label: UNDO_LABEL,
    run: () => {
      attempt(() => actions.restoreItemDates(item.id, prev))
    },
  })
  return true
}

/** 移った先の新しいカードを、浮いた見た目（1.03倍・不透明度 0.95）から収める（Web Animations。CSS の目立たせる枠とぶつけない） */
export function settle(el: Element | null | undefined): void {
  if (!el || prefersReducedMotion() || typeof (el as HTMLElement).animate !== 'function') return
  try {
    el.animate(
      [
        { scale: '1.03', opacity: 0.95 },
        { scale: '1', opacity: 1 },
      ],
      { duration: SETTLE_MS, easing: 'ease-out' },
    )
  } catch {
    /* scale を動かせないブラウザでは収める動きなし（位置はもう正しい） */
  }
}

/**
 * 移った先のカードを、段・日のかたまりのスクロールの中で見える所まで出す（もう見えている時は動かさない。視差効果を減らす設定ではすぐに。
 * src/ui/motion.ts の scrollBehavior）
 */
export function reveal(el: Element | null | undefined): void {
  el?.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: scrollBehavior() })
}
