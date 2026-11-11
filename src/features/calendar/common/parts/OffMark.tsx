// 休みの「休」の字（docs/SPEC.md の 7.4・4.7・4.12）。日付の横に、ui 10px・400・--off-text で出す。休みは色ではなく、地の色
// （.cp-offday の --off-fill）とこの字で示す（ディープダークでも分かる）。読み上げは「休み」。
// 休みの日の地は、この部品ではなく、マス・列・行・見出しに付ける .cp-offday（parts.css）で塗る
import { cls } from './itemLook'
import './parts.css'

export function OffMark({ className }: { className?: string }) {
  return (
    <span className={cls('cp-off', className)}>
      <span aria-hidden="true">休</span>
      <span className="visually-hidden">休み</span>
    </span>
  )
}
