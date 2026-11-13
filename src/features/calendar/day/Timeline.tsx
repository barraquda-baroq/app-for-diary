// デイリーのタイムスケジュール（docs/SPEC.md の 11.3・4.4-6・7.3・D28・D39）。0:00〜24:00、1時間の高さは L・M 48px、S 44px。
// - 左に幅 48px の時刻の欄（等幅 11px・--text-faint。「0:00」〜「23:00」を各時間の上の端に）
// - 時間の縞: 偶数の時は --surface、奇数の時は --stripe。各時間の上に 1px の --rule、12:00 は 1px の点線（--rule-strong）、
//   0:00 は 2px（--rule-strong）
// - 予定の枠（TimedEvent・MultiDayPiece）を重なりの列に並べ（日をまたぐ予定の部分は左の列、1日の予定はその右に）、列に入らない分は
//   まとまりの右の端に空けた札の所に「+n」の札（MoreChip。予定の上に重ねない）。押すと隠れた予定の一覧（PopupMenu）を開き、一覧の
//   予定を押すと詳細（ITEMS-148）
// - 今の時刻の線（今日だけ。2px の --accent と、時刻の欄の端に直径 8px の丸。60秒ごとに動かす。useNow）
// - 開いた時の位置: 今日は今の時刻の 60分前、ほかの日は 7:00 を上の端に。画面を開いた時と見ている日が替わった時だけ当てる
//   （詳細などの小さな画面を閉じた時・予定が変わった時は今の位置のまま。AMB-ITEMS-31）。マンスリーの数字から来た時（その区分の
//   予定を目立たせる時）は、目立たせる予定が見えるように動かす（今の位置でみな見えていれば動かさない。dayModel.ts の arrivalScrollPx）
// - 予定を置ける所の幅を測り、枠ごとに中の出し方を決める（狭い枠は印を時刻の行へ下ろす・入らない時刻は短くする。fitBox）
// - 空いた所を押すと onSlot に押した所の 0:00 からの分を渡す（DayView が登録の画面を開く。ITEMS-149）
// タイムスケジュールはその中だけでスクロールする（11.1）。予定はドラッグできない（ITEMS-150）
import { useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent } from 'react'
import { timeLabel } from '../../../domain/itemText'
import { ITEM_KIND_LABELS } from '../../../domain/trash'
import { ITEM_KINDS, type ItemKind } from '../../../domain/types'
import { flashMatches, useCalendarUi, type FlashTarget } from '../../../store/uiStore'
import { useElementWidth, useNow } from '../../../ui/hooks'
import { KindIcon } from '../../../ui/icons'
import { PopupMenu, type PopupMenuItem } from '../../../ui/PopupMenu'
import { cls, displayTitle, flashKey, kindOf, useFlashTarget } from '../common/parts'
import { useItemSheets } from '../common/sheets'
import { testIds } from '../common/testIds'
import {
  arrivalScrollPx,
  fitBox,
  initialScrollPx,
  minuteOfDay,
  minuteToPx,
  pxToMinute,
  type MoreChipVM,
  type TimelineVM,
} from './dayModel'
import { MultiDayPiece, TimedEvent } from './TimedEvent'
import './day.css'

/** 0〜23 時 */
const HOURS = Array.from({ length: 24 }, (_, h) => h)

/** タイムスケジュールのその区分の予定を目立たせている時（マンスリーの数字から来た時）の「区分:seq」（無ければ ''） */
function arrivalOf(f: FlashTarget | null): string {
  const kind = ITEM_KINDS.find((k) => flashMatches(f, flashKey.dayEvents(k)))
  return kind && f ? `${kind}:${f.seq}` : ''
}

export interface TimelineProps {
  date: string
  today: string
  timeline: TimelineVM
  /** 空いた所を押した（押した所の 0:00 からの分。11.3。渡さない間は何もしない） */
  onSlot?: (minute: number) => void
}

export function Timeline({ date, today, timeline, onSlot }: TimelineProps) {
  const { boxes, more, hourPx, dayPx, tailPx } = timeline
  const isToday = date === today
  const scroller = useRef<HTMLDivElement>(null)
  /** 予定を置ける所（幅を測って、枠ごとの中の出し方を決める。測れていない間は 0） */
  const events = useRef<HTMLDivElement>(null)
  const eventsPx = useElementWidth(events)

  // 開いた時の位置（画面を開いた時と、見ている日・1時間の高さが替わった時だけ。今日かどうかは、その時に見る。
  // 開いたまま 0時を過ぎて今日が替わっても、位置は動かさない）
  const todayRef = useRef(today)
  todayRef.current = today
  useLayoutEffect(() => {
    const el = scroller.current
    if (el) el.scrollTop = initialScrollPx(date === todayRef.current, minuteOfDay(Date.now()), hourPx)
  }, [date, hourPx])

  // マンスリーの数字から来た時は、目立たせる予定が見える所まで動かす（キーが置かれた時だけ。開いた時の位置を当てた後に見る）
  const arrival = useCalendarUi((s) => arrivalOf(s.flash))
  const boxesRef = useRef(boxes)
  boxesRef.current = boxes
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el || !arrival) return
    const kind = arrival.slice(0, arrival.indexOf(':')) as ItemKind
    const view = { top: el.scrollTop, height: el.clientHeight, max: el.scrollHeight - el.clientHeight }
    const top = arrivalScrollPx(boxesRef.current, kind, view, hourPx)
    if (top !== null) el.scrollTop = top
  }, [arrival, hourPx])

  const onGridClick = onSlot
    ? (e: MouseEvent<HTMLDivElement>) => {
        const rect = e.currentTarget.getBoundingClientRect()
        onSlot(pxToMinute(e.clientY - rect.top, hourPx))
      }
    : undefined

  const style = { '--hour-px': `${hourPx}px`, '--day-px': `${dayPx}px`, '--tail-px': `${tailPx}px` } as CSSProperties
  return (
    <section className="dy-timeline" aria-label="タイムスケジュール" data-testid={testIds.dayTimeline}>
      <div ref={scroller} className="dy-tl-scroll" style={style}>
        <div className="dy-tl-inner">
          <div className="dy-axis" aria-hidden="true">
            {HOURS.map((h) => (
              <span key={h} className="mono dy-axis-label" style={{ top: `${h * hourPx}px` }}>
                {h}:00
              </span>
            ))}
          </div>
          <div ref={events} className="dy-events">
            <div className="dy-grid" onClick={onGridClick} aria-hidden="true">
              {HOURS.map((h) => (
                <div
                  key={h}
                  className={cls('dy-hour', h % 2 === 1 && 'is-odd', h === 0 && 'is-day-start', h === 12 && 'is-noon')}
                  style={{ top: `${h * hourPx}px` }}
                  data-hour={h}
                />
              ))}
            </div>
            {boxes.map((b) => {
              const fit = fitBox(b, eventsPx, date)
              return b.part === 'single' ? (
                <TimedEvent key={b.c.item.id} {...b} {...fit} />
              ) : (
                <MultiDayPiece key={b.c.item.id} {...b} {...fit} />
              )
            })}
            {more.map((m) => (
              <MoreChip key={m.at} chip={m} date={date} />
            ))}
            {isToday ? <NowLine hourPx={hourPx} /> : null}
          </div>
        </div>
      </div>
    </section>
  )
}

/**
 * 列に入らなかった予定の「+n」の札（等幅 11px。まとまりの右の端に空けた札の所に、隠れた予定のいちばん早い時刻の高さで。
 * AMB-ITEMS-13）。押すと札の下に隠れた予定の一覧（区分のアイコン・件名・等幅の時刻）を小さく開き、一覧の予定を押すと詳細
 * （ITEMS-148）。同じ件名が並んでもそのまま出す（読み上げは件名と時刻）。一覧は外を押す・Esc・スクロールで閉じ、閉じたら札へ
 * フォーカスを戻す（PopupMenu）。隠れた予定を目立たせる時（登録した・元に戻す・やり直すで当てた。4.9・7.13）は、札を目立たせる
 */
function MoreChip({ chip, date }: { chip: MoreChipVM; date: string }) {
  const n = chip.ids.length
  const flashRef = useFlashTarget<HTMLButtonElement>(chip.ids.map(flashKey.item), { scroll: true })
  const { openDetail } = useItemSheets()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const items: PopupMenuItem[] = chip.items.map((c) => {
    const title = displayTitle(c.item)
    const time = timeLabel(c, { on: date })
    return {
      label: title,
      ariaLabel: `${title}、${time}`,
      hint: time,
      monoHint: true,
      icon: <KindIcon kind={kindOf(c.item)} title={ITEM_KIND_LABELS[kindOf(c.item)]} className="icon" />,
      onSelect: () => openDetail(c.item.id),
    }
  })
  return (
    <>
      <button
        ref={flashRef}
        type="button"
        className="mono dy-more"
        style={{ top: `${chip.top}px` }}
        onClick={(e) => {
          const el = e.currentTarget
          setAnchor((cur) => (cur ? null : el))
        }}
        aria-label={`ほかに ${n}件の予定`}
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        data-at={chip.at}
        data-testid={testIds.dayMore}
      >
        +{n}
      </button>
      {anchor ? (
        <PopupMenu
          label={`ほかに ${n}件の予定`}
          items={items}
          placement={{ anchor }}
          onClose={() => setAnchor(null)}
          returnFocus={anchor}
          testId={testIds.dayMoreList}
        />
      ) : null}
    </>
  )
}

/** 今の時刻の線（今日だけ。2px の --accent の横線と、時刻の欄の端に直径 8px の丸。60秒ごと。7.3・11.3） */
function NowLine({ hourPx }: { hourPx: number }) {
  const now = useNow()
  const minute = minuteOfDay(now)
  return (
    <div
      className="dy-now"
      style={{ top: `${minuteToPx(minute, hourPx)}px` }}
      aria-hidden="true"
      data-minute={minute}
      data-testid={testIds.dayNow}
    />
  )
}
