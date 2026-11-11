// タイムスケジュールの予定の枠（docs/SPEC.md の 11.3・4.3・7.7〜7.9・D39・AMB-ITEMS-11〜14）。どれも記録ごとの React.memo で、
// 受け取るのは予定（CalItem）と、位置・出し方の数と真偽だけ（FRAME-284）。
// - TimedEvent: 1日の予定。開始〜終了の高さの枠（最小 24px）。地は区分で変えずに --surface、1px の --border の枠、ラベルの左の一辺 4px、
//   角丸 6px。左上に点線の丸（16px。押すと完了）、件名（12px・500。後ろに区分の色のハイライト。入るだけ）、時刻（等幅 11px）、
//   右上に区分のアイコン（12px）と印（〆・ロック・AI）。完了は地 --done-bg・ハイライトを消して斜線・字 --done-text・丸に✓
// - MultiDayPiece: 日をまたぐ予定のその日の部分。部分の始まりに開始のカード（高さ max(24, min(40, 部分の高さ))。見た目は1日の予定と
//   同じ。件名＋期間。初日だけ点線の丸、2日目からは件名の頭に「‹ 」）を出し、部分が見えている間は見えている範囲のいちばん上に貼り付ける
//   （position: sticky）。カードの下から部分の終わりまで 2px の線（ラベルの色、無ければ土台の色。完了は --done-text）、最終日は終わりの
//   時刻の所に●、ほかの日は 24:00 の所に下向きの矢印。部分がカードより短い時（カードの下に印を出す所が無い時も）は線を引かず、●・矢印はカードの右端の中に置く
// 枠の形（D19）: 入れ物（div）の中に、「押すと詳細」のボタン（件名と時刻を包み、::after で枠全体に広げる）と、その上に重ねた点線の丸・
// AI の札（別のボタン）を並べる。部分の入れ物は押せない（線の横の空いた所を押すと、下の時間の所を押したことになる）。
// 横の位置は dayModel.ts の x・w（予定を置ける幅の割合と、「+n」の札の所の数）を style の変数で渡し、day.css が left・width にする。
// 目立たせる（4.9）: マンスリーの数字から来た時はその区分の予定の枠（day-events:{区分}）、登録した予定（item:{id}。見える所まで動かす）。
// 日をまたぐ予定は開始のカードを目立たせる
import { memo, useCallback, type CSSProperties } from 'react'
import type { CalItem } from '../../../domain/calendar'
import type { Piece } from '../../../domain/dayLayout'
import type { Item } from '../../../domain/types'
import {
  cls,
  DoneToggle,
  flashKey,
  ItemMarks,
  ItemTime,
  ItemTitle,
  itemAttrs,
  kindOf,
  LabelDot,
  useFlashTarget,
} from '../common/parts'
import { useItemSheets } from '../common/sheets'
import { testIds } from '../common/testIds'
import './day.css'

/**
 * 点線の丸の押せる所（高さ 24px の予定に収まる大きさ。4.11・D08）。指の端末では day.css が枠の中で 34px 四方まで広げる
 * （枠の外は枠の overflow で切れるので、隣の予定には掛からない）
 */
export const RING_HIT = 24

export interface TimedEventProps {
  c: CalItem
  part: Piece['part']
  col: number
  cols: number
  x: number
  xRoom: number
  w: number
  wRoom: number
  top: number
  height: number
  card: number
  line: boolean
  endMark: 'dot' | 'arrow' | null
  ring: boolean
  received: boolean
  compact: boolean
  lines: number
}

/** 横の位置と幅（予定を置ける幅の割合と、引く札の所の数。style の変数で渡し、day.css が left・width にする）と、上の端と高さ */
function boxStyle(p: Pick<TimedEventProps, 'x' | 'xRoom' | 'w' | 'wRoom' | 'top'>, height: number): CSSProperties {
  return {
    '--x': p.x,
    '--x-room': p.xRoom,
    '--w': p.w,
    '--w-room': p.wRoom,
    top: `${p.top}px`,
    height: `${height}px`,
  } as CSSProperties
}

/** 目立たせる所（その区分の予定の枠と、登録した予定。登録した予定は見える所まで動かす） */
function useEventFlash(item: Item): (el: HTMLDivElement | null) => void {
  const byKind = useFlashTarget<HTMLDivElement>(flashKey.dayEvents(kindOf(item)))
  const byItem = useFlashTarget<HTMLDivElement>(flashKey.item(item.id), { scroll: true })
  return useCallback(
    (el: HTMLDivElement | null) => {
      byKind(el)
      byItem(el)
    },
    [byKind, byItem],
  )
}

/** 押すと詳細（12.3） */
function useOpenDetail(id: string): () => void {
  const { openDetail } = useItemSheets()
  return useCallback(() => openDetail(id), [openDetail, id])
}

/** 部分の終わりの印（●は 10px、矢印は「＞」を 90度回した物。どちらも線の色） */
function EndMark({ item, mark }: { item: Item; mark: 'dot' | 'arrow' }) {
  return mark === 'dot' ? (
    <LabelDot item={item} doneLook="fade" className="dy-end-dot" />
  ) : (
    <span className="mono dy-end-arrow" aria-hidden="true">
      ＞
    </span>
  )
}

/** 枠の中身（点線の丸・件名・時刻・右上の印）。1日の予定の枠と開始のカードが使う */
function BoxBody({
  c,
  ring,
  received,
  compact,
  lines,
  inlineEnd,
}: Pick<TimedEventProps, 'c' | 'ring' | 'received' | 'compact' | 'lines'> & { inlineEnd: 'dot' | 'arrow' | null }) {
  const item = c.item
  const open = useOpenDetail(item.id)
  const style = compact ? undefined : ({ '--lines': lines } as CSSProperties)
  return (
    <>
      {ring ? <DoneToggle item={item} hit={RING_HIT} className="dy-ring" /> : null}
      <button type="button" className="dy-open dy-ev-open" onClick={open} style={style}>
        <ItemTitle item={item} highlight received={received} strike className="dy-ev-title" />
        <ItemTime c={c} className="dy-ev-time" />
      </button>
      <span className="dy-ev-marks">
        <ItemMarks item={item} kindIcon />
        {inlineEnd ? <EndMark item={item} mark={inlineEnd} /> : null}
      </span>
    </>
  )
}

/** 1日の予定の枠 */
export const TimedEvent = memo(function TimedEvent(p: TimedEventProps) {
  const item = p.c.item
  const flashRef = useEventFlash(item)
  return (
    <div
      ref={flashRef}
      className={cls('dy-event', 'dy-box', 'label-edge', p.compact && 'is-compact', !p.ring && 'no-ring', item.done && 'is-done')}
      style={boxStyle(p, p.height)}
      {...itemAttrs(item)}
      data-part={p.part}
      data-testid={testIds.dayEvent(item.id)}
    >
      <BoxBody c={p.c} ring={p.ring} received={p.received} compact={p.compact} lines={p.lines} inlineEnd={null} />
    </div>
  )
})

/** 日をまたぐ予定のその日の部分（貼り付く開始のカード・線・●／矢印） */
export const MultiDayPiece = memo(function MultiDayPiece(p: TimedEventProps) {
  const item = p.c.item
  const mark = p.endMark ?? 'arrow'
  const flashRef = useEventFlash(item)
  return (
    <div
      className={cls('dy-piece', item.done && 'is-done')}
      style={boxStyle(p, p.height)}
      {...itemAttrs(item)}
      data-part={p.part}
    >
      <div
        ref={flashRef}
        className={cls(
          'dy-start',
          'dy-box',
          'label-edge',
          p.compact && 'is-compact',
          !p.ring && 'no-ring',
          item.done && 'is-done',
        )}
        style={{ height: `${p.card}px` }}
        {...itemAttrs(item)}
        data-testid={testIds.dayEvent(item.id)}
      >
        <BoxBody c={p.c} ring={p.ring} received={p.received} compact={p.compact} lines={1} inlineEnd={p.line ? null : mark} />
      </div>
      {p.line ? (
        <>
          <span className={cls('dy-span-line', mark === 'dot' ? 'to-dot' : 'to-arrow')} style={{ top: `${p.card}px` }} />
          <span className={cls('dy-span-end', `is-${mark}`)}>
            <EndMark item={item} mark={mark} />
          </span>
        </>
      ) : null}
    </div>
  )
})
