// ウィークリーの予定の部品（docs/SPEC.md の 7.7〜7.11・10.2・10.4・12.3・12.5・4.3・4.9・4.11）。どれも記録ごとの React.memo で、
// 受け取るのは予定（CalItem）と、その時の数や真偽だけ（見た目の計算の入れ物は渡さない。FRAME-284）。
// - WeekCard: 1日の予定のカード（点線の丸・件名 2行まで・時刻・右上の印）
// - StartCard: 複数日の始点のカード（36px・件名 1行・期間。土曜に始まって次の週へ続く時は 14px 縮める）
// - ReceivedCard: 前の週から続く物の受けた表示（地は透き通り・点線の枠・「‹ 件名」。日曜に終わる時は右の端の中に●）
// - EndDot: 終点の●（10px・押せる所 28px）。OverflowRow: S の4本目のレーンからの「● 件名」の行（●と同じ働き）
// - EdgeArrow: 次の週へ続く「>」（等幅 12px。S は下向き）。AddRow: いちばん下の「＋」の行
// カードの形（D19・WP11s）: 入れ物（div）に掴む所（useItemDrag の ref・grabProps）と目立たせる所（useFlashTarget）を付け、中に
// 「押すと詳細」のボタン（字を包み、::after でカード全体に広げる）と、その上に重ねた点線の丸・AI の札（別のボタン）を並べる
// （ボタンの中にボタンを入れない）。入れ物とその上の要素には transform・filter・contain を付けない（掴んだカードがずれる。G9）。
// 受けた表示と＞は掴めない（押すと詳細だけ。CALENDAR-176）
import { memo, useCallback, type CSSProperties } from 'react'
import type { CalItem } from '../../../domain/calendar'
import { jaDateLabel, mdLabel } from '../../../domain/dates'
import { ITEM_KIND_LABELS } from '../../../domain/trash'
import type { Item, ItemKind } from '../../../domain/types'
import { PlusIcon } from '../../../ui/icons'
import {
  cls,
  displayTitle,
  DoneToggle,
  flashKey,
  ItemMarks,
  ItemTime,
  ItemTitle,
  itemAttrs,
  LabelDot,
  useFlashTarget,
} from '../common/parts'
import { useItemSheets } from '../common/sheets'
import { testIds } from '../common/testIds'
import { useItemDrag, type DragHandle, type WeekCtx } from './dnd'
import { cardLayout, laneMarksBelow, marksPx, periodDatesOnly } from './weekModel'
import './week.css'

/** 掴む所と目立たせる所を1つの要素に付ける ref（目立たせるのは登録・ドラッグで移った予定。4.9） */
function useItemRef(item: Item, handle: DragHandle, week: WeekCtx, flash: boolean) {
  const drag = useItemDrag({ item, handle, week })
  const flashRef = useFlashTarget<HTMLElement>(flash ? flashKey.item(item.id) : null)
  const dragRef = drag.ref
  const ref = useCallback(
    (el: HTMLElement | null) => {
      dragRef(el)
      flashRef(el)
    },
    [dragRef, flashRef],
  )
  return { ref, drag }
}

/** 押すと詳細（12.3）。カード・始点のカード・受けた表示・●・＞・「● 件名」の行が使う */
function useOpenDetail(id: string): () => void {
  const { openDetail } = useItemSheets()
  return useCallback(() => openDetail(id), [openDetail, id])
}

export interface WeekCardProps {
  c: CalItem
  week: WeekCtx
  /** 点線の丸の横の字の幅（px。丸の行と件名の行に分けるかを決める。測れていない時は 0） */
  textPx?: number
}

/** 1日の予定のカード（10.2） */
export const WeekCard = memo(function WeekCard({ c, week, textPx = 0 }: WeekCardProps) {
  const item = c.item
  const open = useOpenDetail(item.id)
  const { ref, drag } = useItemRef(item, 'card', week, true)
  const layout = cardLayout(textPx, item)
  return (
    <div
      {...drag.grabProps}
      ref={ref}
      className={cls(
        'wk-card',
        layout !== 'side' && 'is-stacked',
        layout === 'marks-below' && 'is-marks-below',
        item.done && 'is-done',
        drag.isDragging && 'is-dragging',
      )}
      {...itemAttrs(item)}
      data-testid={testIds.weekCard(item.id)}
    >
      <DoneToggle item={item} className="wk-done" />
      <button type="button" className="wk-open" onClick={open}>
        <ItemTitle item={item} lines={2} />
        <ItemTime c={c} className="wk-time" />
      </button>
      <ItemMarks item={item} className="wk-marks" />
    </div>
  )
})

/** 印を下の行の右に置く時の、期間の行の右のあき（印の幅。week.css の --wk-marks-w） */
const marksGap = (item: Item): CSSProperties => ({ '--wk-marks-w': `${marksPx(item)}px` }) as CSSProperties

export interface StartCardProps {
  c: CalItem
  week: WeekCtx
  /** カードを出す日（開始日） */
  date: string
  /** 土曜に始まって次の週へ続く（7日を横は 14px 縮めて、あいた所に＞） */
  shrink?: boolean
  /**
   * 点線の丸の横の字の幅（px。縮める時はその分も引いた幅）。期間を日付だけにするか（入らない時。10.2）と、印を件名の横に置くか
   * 期間の行の右に置くかを決める（weekModel.ts の periodDatesOnly・laneMarksBelow）。測れていない時は 0
   */
  textPx?: number
}

/** 複数日の始点のカード（7.8・10.2。36px・件名 1行・下の行に期間。左の点線の丸で予定全体を完了） */
export const StartCard = memo(function StartCard({ c, week, date, shrink = false, textPx = 0 }: StartCardProps) {
  const item = c.item
  const open = useOpenDetail(item.id)
  const { ref, drag } = useItemRef(item, 'start', week, true)
  const low = laneMarksBelow(textPx, item)
  return (
    <div
      {...drag.grabProps}
      ref={ref}
      className={cls(
        'wk-card',
        'is-start',
        shrink && 'is-shrink',
        low && 'is-marks-low',
        item.done && 'is-done',
        drag.isDragging && 'is-dragging',
      )}
      style={low ? marksGap(item) : undefined}
      {...itemAttrs(item)}
      data-testid={testIds.weekStart(item.id)}
    >
      <DoneToggle item={item} className="wk-done" />
      <button type="button" className="wk-open" onClick={open}>
        <ItemTitle item={item} lines={1} />
        <ItemTime c={c} on={date} datesOnly={periodDatesOnly(c, date, textPx)} className="wk-period" />
      </button>
      <ItemMarks item={item} className="wk-marks" />
    </div>
  )
})

export interface ReceivedCardProps {
  c: CalItem
  week: WeekCtx
  /** 前の週から続いて日曜に終わる: 右の端の中に●（線は引かない。7.8） */
  dotIn?: boolean
  /** 「‹ 件名」の字の幅（px。weekModel.ts の receivedTextPx。印を件名の横に置くか下の行に置くかを決める。測れていない時は 0） */
  textPx?: number
}

/** 前の週から続いている物の受けた表示（7.8。地は透き通り・1px の点線の枠・「‹ 件名」12px・完了の丸なし。掴めない） */
export const ReceivedCard = memo(function ReceivedCard({ c, week, dotIn = false, textPx = 0 }: ReceivedCardProps) {
  const item = c.item
  const open = useOpenDetail(item.id)
  const flashRef = useFlashTarget<HTMLDivElement>(flashKey.item(item.id))
  return (
    <div
      ref={flashRef}
      className={cls('wk-recv', dotIn && 'has-dot', laneMarksBelow(textPx, item) && 'is-marks-low', item.done && 'is-done')}
      {...itemAttrs(item)}
      data-testid={testIds.weekReceived(item.id)}
    >
      <button type="button" className="wk-open" onClick={open} aria-label={`${displayTitle(item)}（前の週から続く予定）`}>
        <ItemTitle item={item} received muted lines={1} />
      </button>
      <ItemMarks item={item} className="wk-marks" />
      {dotIn ? <EndDot c={c} week={week} /> : null}
    </div>
  )
})

export interface EndDotProps {
  c: CalItem
  week: WeekCtx
  className?: string
  /** 置く所（7日を縦のレールの中。半分の左の端・上の端からの px。記録ごとの memo が効くよう数で渡す） */
  left?: number
  top?: number
}

/** 終点の●（7.8。直径 10px・押せる所 28px。押すと詳細、長押し・ドラッグで締め切り日を動かす） */
export const EndDot = memo(function EndDot({ c, week, className, left, top }: EndDotProps) {
  const item = c.item
  const open = useOpenDetail(item.id)
  const drag = useItemDrag({ item, handle: 'end', week })
  return (
    <button
      {...drag.grabProps}
      ref={drag.ref}
      type="button"
      className={cls('wk-end', item.done && 'is-done', drag.isDragging && 'is-dragging', className)}
      style={left === undefined ? undefined : { left, top }}
      onClick={open}
      aria-label={`${displayTitle(item)}の締め切り日（${mdLabel(c.to)}）`}
      {...itemAttrs(item)}
      data-testid={testIds.weekEnd(item.id)}
    >
      <LabelDot item={item} doneLook="fade" />
    </button>
  )
})

export interface OverflowRowProps {
  c: CalItem
  week: WeekCtx
  /** 締め切り日 */
  date: string
}

/** S の4本目のレーンからの予定の、締め切り日の「● 件名」の行（12px・--text-muted・20px。終点の●と同じ働き。10.4・D41） */
export const OverflowRow = memo(function OverflowRow({ c, week, date }: OverflowRowProps) {
  const item = c.item
  const open = useOpenDetail(item.id)
  const drag = useItemDrag({ item, handle: 'end', week })
  return (
    <button
      {...drag.grabProps}
      ref={drag.ref}
      type="button"
      className={cls('wk-over', item.done && 'is-done', drag.isDragging && 'is-dragging')}
      onClick={open}
      aria-label={`${displayTitle(item)}の締め切り日（${mdLabel(c.to)}）`}
      {...itemAttrs(item)}
      data-testid={testIds.weekOverflow(date, item.id)}
    >
      <LabelDot item={item} doneLook="fade" />
      <span className="wk-over-title">{displayTitle(item)}</span>
    </button>
  )
})

export interface EdgeArrowProps {
  item: Item
  /** 7日を縦の下向き（「>」を 90度回した物） */
  down?: boolean
  className?: string
  /** 置く所（7日を縦のレールの中。半分の左の端からの px） */
  left?: number
}

/** 次の週へ続く印「>」（等幅 12px・線と同じ色。押すと詳細。掴めない。7.8・10.4） */
export const EdgeArrow = memo(function EdgeArrow({ item, down = false, className, left }: EdgeArrowProps) {
  const open = useOpenDetail(item.id)
  return (
    <button
      type="button"
      className={cls('wk-edge', down && 'is-down', item.done && 'is-done', className)}
      style={left === undefined ? undefined : { left }}
      onClick={open}
      aria-label={`${displayTitle(item)}（次の週へ続く予定）`}
      {...itemAttrs(item)}
      data-testid={testIds.weekEdge(item.id)}
    >
      <span className="wk-edge-glyph" aria-hidden="true">
        {'>'}
      </span>
    </button>
  )
})

export interface AddRowProps {
  date: string
  kind: ItemKind
  onAdd?: (date: string, kind: ItemKind) => void
}

/** いちばん下の「＋」の行（28px。押すとその日・その段のすばやく足す。7日を横の PC では列に乗せた時だけ出す。10.2・D43） */
export function AddRow({ date, kind, onAdd }: AddRowProps) {
  return (
    <button
      type="button"
      className="wk-add"
      onClick={() => onAdd?.(date, kind)}
      aria-label={`${jaDateLabel(date)}の${ITEM_KIND_LABELS[kind]}に予定を足す`}
      data-testid={testIds.weekAdd(date, kind)}
    >
      <PlusIcon className="icon wk-add-icon" />
    </button>
  )
}
