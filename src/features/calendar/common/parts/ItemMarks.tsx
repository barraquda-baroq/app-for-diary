// 予定の右上の印（docs/SPEC.md の 7.7・6.3・7.10・4.10・11.3・D39）。左から 区分のアイコン（タイムスケジュールだけ。kindIcon）→
// 「〆」（list 生まれでカレンダーに出ている物。11px）→ LockIcon（ロック中。12px・線 2.4）→ AI の札（Claude が足した物）の順。
// 提案の印（ProposalIcon）は段階5でここの AI の札の後ろに足す。字と線の色は --text-muted。
// 印が1つも無ければ何も出さない。ロックの印には data-lock を付ける（掴めない時の揺れの代わりに印を --accent にする所。
// src/ui/motion.ts の shake(el, lockIcon)。LOCK_SELECTOR で探す）
import { hasDueMark } from '../../../../domain/items'
import { ITEM_KIND_LABELS } from '../../../../domain/trash'
import type { Item } from '../../../../domain/types'
import { KindIcon, LockIcon } from '../../../../ui/icons'
import { AiTag } from './AiTag'
import { cls, hasAiTag, kindOf } from './itemLook'
import './parts.css'

/** ロックの印を探すセレクタ（カード・行の中で） */
export const LOCK_SELECTOR = '[data-lock]'

export interface ItemMarksProps {
  item: Pick<Item, 'id' | 'kind' | 'origin' | 'start' | 'due' | 'locked' | 'by' | 'ai' | 'via'>
  /** 区分のアイコン（かばん／家・12px）を先頭に出す（タイムスケジュールの予定。ディープダークではこれと位置だけで見分ける） */
  kindIcon?: boolean
  className?: string
}

export function ItemMarks({ item, kindIcon = false, className }: ItemMarksProps) {
  const due = hasDueMark(item)
  const ai = hasAiTag(item)
  if (!kindIcon && !due && !item.locked && !ai) return null
  const kind = kindOf(item)
  return (
    <span className={cls('cp-marks', className)}>
      {kindIcon ? <KindIcon kind={kind} small title={ITEM_KIND_LABELS[kind]} data-mark="kind" /> : null}
      {due ? (
        <span className="cp-due" role="img" aria-label="締め切りのあるタスク" data-mark="due">
          〆
        </span>
      ) : null}
      {item.locked ? <LockIcon small title="ロック中" data-lock="" data-mark="lock" /> : null}
      {ai ? <AiTag item={item} /> : null}
    </span>
  )
}
