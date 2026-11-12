// ウィークリーの予定の部品（docs/SPEC.md の 7.7〜7.11・10.2・10.4・12.3・12.5・4.3・4.9・4.11）。どれも記録ごとの React.memo で、
// 受け取るのは予定（CalItem）と、その時の数や真偽だけ（見た目の計算の入れ物は渡さない。FRAME-284）。
// - WeekCard: 1日の予定のカード（点線の丸・件名 2行まで・時刻・右上の印）
// - StartCard: 複数日の始点のカード（36px・件名 1行・期間。土曜に始まって次の週へ続く時は 14px 縮める。列が狭い時は期間を出さずに
//   件名を2行。weekModel.ts の startCardLook）
// - ReceivedCard: 前の週から続く物の受けた表示（地は透き通り・点線の枠・「‹ 件名」。日曜に終わる時は右の端の中に●。列が狭い時は
//   件名を2行。receivedTwoLines）
// - EndDot: 終点の●（10px・押せる所 28px）。OverflowRow: S の4本目のレーンからの「● 件名」の行（●と同じ働き）
// - EdgeArrow: 次の週へ続く「>」（等幅 12px。S は下向き）。AddRow: いちばん下の「＋」の行（押すとその場ですばやく足すに替わる）
// カードの形（D19・WP11s）: 入れ物（div）に掴む所（useItemDrag の ref・grabProps）と目立たせる所（useFlashTarget）を付け、中に
// 「押すと詳細」のボタン（字を包み、::after でカード全体に広げる）と、その上に重ねた点線の丸・AI の札（別のボタン）を並べる
// （ボタンの中にボタンを入れない）。入れ物とその上の要素には transform・filter・contain を付けない（掴んだカードがずれる。G9）。
// 受けた表示と＞は掴めない（押すと詳細だけ。CALENDAR-176）
import { memo, useCallback, useLayoutEffect, useRef, type CSSProperties } from 'react'
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
  QuickAdd,
  useFlashTarget,
} from '../common/parts'
import type { QuickAddCloseReason } from '../common/parts/QuickAdd'
import { useItemSheets } from '../common/sheets'
import { testIds } from '../common/testIds'
import { useItemDrag, type DragHandle, type WeekCtx } from './dnd'
import { cardLayout, laneMarksBelow, marksPx, receivedTwoLines, startCardLook } from './weekModel'
import './week.css'

/**
 * 目立たせる時に見える所まで出す（useFlashTarget の scroll。block・inline: nearest と同じで、ページは動かさずに週・段の中だけ。
 * src/ui/scrollWithin.ts）。ドラッグで落とした時は目立たせるだけ（uiStore の flashInPlace。出すのは WeekDnd が、動かした物を）
 */
const FLASH_SCROLL = { scroll: true } as const

/**
 * 掴む所と目立たせる所を1つの要素に付ける ref（目立たせるのは登録・ドラッグで移った予定。4.9）。登録した時は、段・日のかたまりの
 * スクロールの中で見える所まで出す（もう見えている時は動かさない。視差効果を減らす設定ではすぐに。ページは動かさない。デイリーと
 * 同じ。開発）。落とした時に出すのは WeekDnd（●を動かした時は●を出し、ここは目立たせるだけ）
 */
function useItemRef(item: Item, handle: DragHandle, week: WeekCtx, flash: boolean) {
  const drag = useItemDrag({ item, handle, week })
  const flashRef = useFlashTarget<HTMLElement>(flash ? flashKey.item(item.id) : null, FLASH_SCROLL)
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
   * 期間の行の右に置くか、列が狭くて件名を2行にするかを決める（weekModel.ts の startCardLook）。測れていない時は 0
   */
  textPx?: number
}

/**
 * 複数日の始点のカード（7.8・10.2。36px・件名 1行・下の行に期間。左の点線の丸で予定全体を完了）。列が狭くて丸の横に4字も入らない時は
 * 件名を2行（1行目は丸の右から、2行目は丸の下へ回り込む。印は2行目の右の端）。期間は、件名が1行目に入って期間が2行目に入る時だけ
 * 2行目に出し、ほかは読み上げにだけ残す（weekModel.ts の startCardLook。開発）
 */
export const StartCard = memo(function StartCard({ c, week, date, shrink = false, textPx = 0 }: StartCardProps) {
  const item = c.item
  const open = useOpenDetail(item.id)
  const { ref, drag } = useItemRef(item, 'start', week, true)
  const look = startCardLook(c, date, textPx)
  const two = look.layout === 'wrap'
  return (
    <div
      {...drag.grabProps}
      ref={ref}
      className={cls(
        'wk-card',
        'is-start',
        shrink && 'is-shrink',
        two && 'is-two-lines',
        two && look.period !== 'hidden' && 'has-period',
        two && marksPx(item) > 0 && 'has-marks',
        look.marksLow && 'is-marks-low',
        !two && look.period === 'hidden' && 'is-period-hidden',
        item.done && 'is-done',
        drag.isDragging && 'is-dragging',
      )}
      style={look.marksLow ? marksGap(item) : undefined}
      {...itemAttrs(item)}
      data-testid={testIds.weekStart(item.id)}
    >
      <DoneToggle item={item} className="wk-done" />
      <button type="button" className="wk-open" onClick={open}>
        <ItemTitle item={item} lines={look.titleLines} />
        <ItemTime
          c={c}
          on={date}
          datesOnly={look.period === 'dates'}
          className={look.period === 'hidden' ? 'visually-hidden' : 'wk-period'}
        />
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

/**
 * 前の週から続いている物の受けた表示（7.8。地は透き通り・1px の点線の枠・「‹ 件名」12px・完了の丸なし。掴めない）。列が狭くて
 * 「‹ 」の後に4字も入らない時は件名を2行（印は2行目の右の端。開発）
 */
export const ReceivedCard = memo(function ReceivedCard({ c, week, dotIn = false, textPx = 0 }: ReceivedCardProps) {
  const item = c.item
  const open = useOpenDetail(item.id)
  const flashRef = useFlashTarget<HTMLDivElement>(flashKey.item(item.id), FLASH_SCROLL)
  const two = receivedTwoLines(textPx, item)
  const marks = marksPx(item) > 0
  return (
    <div
      ref={flashRef}
      className={cls(
        'wk-recv',
        dotIn && 'has-dot',
        two && 'is-two-lines',
        two && marks && 'has-marks',
        !two && laneMarksBelow(textPx, item) && 'is-marks-low',
        item.done && 'is-done',
      )}
      style={two && marks ? marksGap(item) : undefined}
      {...itemAttrs(item)}
      data-testid={testIds.weekReceived(item.id)}
    >
      <button type="button" className="wk-open" onClick={open} aria-label={`${displayTitle(item)}（前の週から続く予定）`}>
        <ItemTitle item={item} received muted lines={two ? 2 : 1} />
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
  /** この「＋」の行の所に、すばやく足すの入力欄を開いている（12.1・D44） */
  open?: boolean
  /** 「＋」を押した（すばやく足すを開く） */
  onAdd?: (date: string, kind: ItemKind) => void
  /** すばやく足すを閉じた（Esc・入力欄の外を押し終えた・フォーカスを外へ移した・キーボードを閉じた） */
  onClose?: () => void
}

/**
 * いちばん下の「＋」の行（28px。7日を横の PC では列に乗せた時だけ出す。10.2・D43）。押すと、その場でその日・その段のすばやく足す
 * （1行の入力欄。12.1）に替わる（D44）。Esc で閉じた時は「＋」にフォーカスを戻す（キーボードで続けて操作できるように）。
 * 外を押して閉じた時は戻さない（押した所の操作のまま）。外を押した時に押し終わってから閉じるのは QuickAdd（S で下のかたまりが
 * ずれて、指の下の別の予定が押されないように。掴んだカードの下で並びが動かないように）。外を押した・キーボードを閉じた時に、
 * 字があれば足してから閉じるのも QuickAdd（12.1）
 */
export function AddRow({ date, kind, open = false, onAdd, onClose }: AddRowProps) {
  const button = useRef<HTMLButtonElement>(null)
  /** Esc で閉じた（「＋」へフォーカスを戻す） */
  const byEsc = useRef(false)
  const wasOpen = useRef(open)
  useLayoutEffect(() => {
    if (wasOpen.current && !open && byEsc.current) button.current?.focus({ preventScroll: true })
    wasOpen.current = open
    byEsc.current = false
  }, [open])
  const close = useCallback(
    (reason: QuickAddCloseReason) => {
      byEsc.current = reason === 'escape'
      onClose?.()
    },
    [onClose],
  )

  if (open) {
    return (
      <div className="wk-quick">
        <QuickAdd date={date} kind={kind} onClose={close} />
      </div>
    )
  }
  return (
    <button
      ref={button}
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
