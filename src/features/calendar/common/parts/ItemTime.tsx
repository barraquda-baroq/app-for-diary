// 予定の時刻・期間の表記（docs/SPEC.md の 7.7・4.5・4.7）。等幅 11px（.mono-time）・--text-muted。表記は src/domain/itemText.ts の
// timeLabel（1日・時刻なしは出さない／10:00／10:00–11:30／〜11/11（最終日は 11/9〜）／11/9 10:00〜11/11 15:00）。
// on はその日（複数日の最終日の表記に使う）、datesOnly は始点のカードに期間が入らない時（時刻を省く。10.2）
import type { CalItem } from '../../../../domain/calendar'
import { timeLabel } from '../../../../domain/itemText'
import { cls } from './itemLook'
import './parts.css'

export interface ItemTimeProps {
  c: CalItem
  on?: string
  datesOnly?: boolean
  className?: string
}

export function ItemTime({ c, on, datesOnly, className }: ItemTimeProps) {
  const label = timeLabel(c, { on, datesOnly })
  if (!label) return null
  return <span className={cls('mono-time', 'cp-time', className)}>{label}</span>
}
