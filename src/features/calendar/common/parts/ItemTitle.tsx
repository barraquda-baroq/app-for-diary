// 予定の件名（docs/SPEC.md の 4.3・4.7・6.12・7.8・7.9・11.2・11.3）。カード・行・予定の枠・開始のカードが使う。
// - highlight: 件名の字の後ろだけに区分の色のハイライト（タイムスケジュール・Task List。4.3）。件名の字を包む inline の要素
//   （.kind-marker）に付けるので、時刻・依頼者・印の下には入らない。完了した物には付けない（Q14）。ディープダークは帯なし
// - received: 受けた表示（前の週・前の日から続いている物）の頭の「‹ 」（--text-muted。帯の上でも置ける字。4.3）
// - 字は --text（帯の上でも 4.5:1 以上）。完了は --done-text、strike で斜線（デイリーのリスト・タイムスケジュールだけ。7.9）
// - 空の件名は「（件名なし）」（6.12）
import type { Item } from '../../../../domain/types'
import { cls, displayTitle, kindOf } from './itemLook'
import './parts.css'

export interface ItemTitleProps {
  item: Pick<Item, 'title' | 'kind' | 'done'>
  /** 件名のハイライト（タイムスケジュール・Task List。完了した物には付かない） */
  highlight?: boolean
  /** 受けた表示（頭に「‹ 」） */
  received?: boolean
  /** 字を --text-muted に（ウィークリーの受けた表示。7.8） */
  muted?: boolean
  /** 完了した時に斜線を引く（デイリーのリスト・タイムスケジュール。7.9） */
  strike?: boolean
  /** 行の数の上限（入らない分は「…」） */
  lines?: 1 | 2
  className?: string
}

export function ItemTitle({
  item,
  highlight = false,
  received = false,
  muted = false,
  strike = false,
  lines,
  className,
}: ItemTitleProps) {
  const marker = highlight && !item.done
  return (
    <span
      className={cls(
        'cp-title',
        muted && 'is-muted',
        item.done && 'is-done',
        item.done && strike && 'is-strike',
        lines && `cp-lines-${lines}`,
        className,
      )}
    >
      <span className={marker ? 'kind-marker' : 'cp-title-text'} data-kind={marker ? kindOf(item) : undefined}>
        {received ? <span className="cp-title-received">‹ </span> : null}
        {displayTitle(item)}
      </span>
    </span>
  )
}
