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
// 狭い枠（dayModel.ts の fitBox。Timeline が測った幅で決める）: 印を件名の横に置くと件名が5字ほども入らない2行の枠は、印を時刻の行の
// 右へ下ろして件名に幅いっぱいを使う（is-narrow）。時刻・期間は入るいちばん長い表記にし（「10:00–11:30」→「10:00」、
// 「11/9 10:00〜11/12 18:00」→「11/9〜11/12」→「〜11/12」）、どれも入らない時は出さない（途中で切らない）。読み上げはいつも
// 長い表記（「押すと詳細」のボタンの中に隠して置く）。とても狭い枠は、印を区分のアイコンだけにする（is-marks-thin）
// 目立たせる（4.9）: マンスリーの数字から来た時はその区分の予定の枠（day-events:{区分}）、登録した予定（item:{id}。見える所まで動かす）。
// 日をまたぐ予定は開始のカードを目立たせる
import { memo, useCallback, type CSSProperties } from 'react'
import type { CalItem } from '../../../domain/calendar'
import type { Piece } from '../../../domain/dayLayout'
import type { Item } from '../../../domain/types'
import { cls, DoneToggle, flashKey, ItemMarks, ItemTitle, itemAttrs, kindOf, LabelDot, useFlashTarget } from '../common/parts'
import { useItemSheets } from '../common/sheets'
import { testIds } from '../common/testIds'
import './day.css'

/**
 * 点線の丸の押せる所（高さ 24px の予定に収まる大きさ。4.11・D08）。指の端末では day.css が枠の中で高さ 34px・幅 30px（件名の
 * 始まりまで）に広げる（枠の外は枠の overflow で切れるので、隣の予定には掛からない。件名の「押すと詳細」にも掛からない）
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
  /** 印を時刻の行の右へ下ろし、件名に幅いっぱいを使う（狭い2行の枠。dayModel.ts の fitBox） */
  narrow: boolean
  /** 印を区分のアイコン（と●・矢印）だけにする（とても狭い枠） */
  thinMarks: boolean
  /** 出す時刻・期間（枠に入る表記。入らない時は ''） */
  time: string
  /** 読み上げる時刻・期間（いつも長い表記） */
  timeFull: string
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

/** 枠の形のクラス（1行にまとめる・狭い枠・印を減らす・点線の丸の無い枠・完了） */
function boxClass(p: TimedEventProps, done: boolean): string {
  return cls(
    'dy-box',
    'label-edge',
    p.compact && 'is-compact',
    p.narrow && 'is-narrow',
    p.thinMarks && 'is-marks-thin',
    !p.ring && 'no-ring',
    done && 'is-done',
  )
}

/**
 * 枠の中身（点線の丸・件名・右上の印・時刻）。1日の予定の枠と開始のカードが使う。時刻は「押すと詳細」のボタンの外に置き
 * （狭い枠では印と同じ行に並べるため。押すと詳細なのはボタンの ::after が枠全体に広がっているので変わらない）、読み上げ用の
 * 長い表記をボタンの中に隠して置く
 */
function BoxBody({
  c,
  ring,
  received,
  compact,
  lines,
  time,
  timeFull,
  inlineEnd,
}: Pick<TimedEventProps, 'c' | 'ring' | 'received' | 'compact' | 'lines' | 'time' | 'timeFull'> & {
  inlineEnd: 'dot' | 'arrow' | null
}) {
  const item = c.item
  const open = useOpenDetail(item.id)
  const style = compact ? undefined : ({ '--lines': lines } as CSSProperties)
  return (
    <>
      {ring ? <DoneToggle item={item} hit={RING_HIT} className="dy-ring" /> : null}
      <button type="button" className="dy-open dy-ev-open" onClick={open} style={style}>
        <ItemTitle item={item} highlight received={received} strike className="dy-ev-title" />
        {timeFull ? <span className="visually-hidden">{timeFull}</span> : null}
      </button>
      <span className="dy-ev-marks">
        <ItemMarks item={item} kindIcon />
        {inlineEnd ? <EndMark item={item} mark={inlineEnd} /> : null}
      </span>
      {time ? (
        <span className="mono-time cp-time dy-ev-time" aria-hidden="true">
          {time}
        </span>
      ) : null}
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
      className={cls('dy-event', boxClass(p, item.done))}
      style={boxStyle(p, p.height)}
      {...itemAttrs(item)}
      data-part={p.part}
      data-testid={testIds.dayEvent(item.id)}
    >
      <BoxBody
        c={p.c}
        ring={p.ring}
        received={p.received}
        compact={p.compact}
        lines={p.lines}
        time={p.time}
        timeFull={p.timeFull}
        inlineEnd={null}
      />
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
        className={cls('dy-start', boxClass(p, item.done))}
        style={{ height: `${p.card}px` }}
        {...itemAttrs(item)}
        data-testid={testIds.dayEvent(item.id)}
      >
        <BoxBody
          c={p.c}
          ring={p.ring}
          received={p.received}
          compact={p.compact}
          lines={1}
          time={p.time}
          timeFull={p.timeFull}
          inlineEnd={p.line ? null : mark}
        />
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
