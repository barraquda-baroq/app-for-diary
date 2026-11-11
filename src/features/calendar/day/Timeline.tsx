// デイリーのタイムスケジュール（docs/SPEC.md の 11.3・4.4-6・7.3・D28・D39）。0:00〜24:00、1時間の高さは L・M 48px、S 44px。
// - 左に幅 48px の時刻の欄（等幅 11px・--text-faint。「0:00」〜「23:00」を各時間の上の端に）
// - 時間の縞: 偶数の時は --surface、奇数の時は --stripe。各時間の上に 1px の --rule、12:00 は 1px の点線（--rule-strong）、
//   0:00 は 2px（--rule-strong）
// - 予定の枠（TimedEvent・MultiDayPiece）を重なりの列に並べ（日をまたぐ予定の部分は左の列、1日の予定はその右に）、列に入らない分は
//   まとまりの右の端に空けた札の所に「+n」の札（MoreChip。予定の上に重ねない）。押すと隠れた予定の一覧（PopupMenu）を開き、一覧の
//   予定を押すと詳細（ITEMS-148）
// - 今の時刻の線（今日だけ。2px の --accent と、時刻の欄の端に直径 8px の丸。60秒ごとに動かす。useNow）
// - 開いた時の位置: 今日は今の時刻の 60分前、ほかの日は 7:00 を上の端に。画面を開いた時と見ている日が替わった時だけ当てる
//   （詳細などの小さな画面を閉じた時・予定が変わった時は今の位置のまま。AMB-ITEMS-31）
// - 空いた所を押すと onSlot に押した所の 0:00 からの分を渡す（DayView が登録の画面を開く。ITEMS-149）
// タイムスケジュールはその中だけでスクロールする（11.1）。予定はドラッグできない（ITEMS-150）
import { useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent } from 'react'
import type { CalItem } from '../../../domain/calendar'
import { timeLabel } from '../../../domain/itemText'
import { ITEM_KIND_LABELS } from '../../../domain/trash'
import { useNow } from '../../../ui/hooks'
import { KindIcon } from '../../../ui/icons'
import { PopupMenu, type PopupMenuItem } from '../../../ui/PopupMenu'
import { cls, displayTitle, kindOf } from '../common/parts'
import { useItemSheets } from '../common/sheets'
import { testIds } from '../common/testIds'
import { initialScrollPx, minuteOfDay, minuteToPx, pxToMinute, type MoreChipVM, type TimelineVM } from './dayModel'
import { MultiDayPiece, TimedEvent } from './TimedEvent'
import './day.css'

/** 0〜23 時 */
const HOURS = Array.from({ length: 24 }, (_, h) => h)

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

  // 開いた時の位置（画面を開いた時と、見ている日・1時間の高さが替わった時だけ。今日かどうかは、その時に見る。
  // 開いたまま 0時を過ぎて今日が替わっても、位置は動かさない）
  const todayRef = useRef(today)
  todayRef.current = today
  useLayoutEffect(() => {
    const el = scroller.current
    if (el) el.scrollTop = initialScrollPx(date === todayRef.current, minuteOfDay(Date.now()), hourPx)
  }, [date, hourPx])

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
          <div className="dy-events">
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
            {boxes.map((b) =>
              b.part === 'single' ? <TimedEvent key={b.c.item.id} {...b} /> : <MultiDayPiece key={b.c.item.id} {...b} />,
            )}
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

/** 一覧の名前（同じ件名が並ぶ時は、押した所を見分けられるよう後ろに番号を付ける。項目の名前は一覧の中で1つずつ） */
function uniqueLabels(items: readonly CalItem[]): string[] {
  const used = new Map<string, number>()
  return items.map((c) => {
    const title = displayTitle(c.item)
    const n = (used.get(title) ?? 0) + 1
    used.set(title, n)
    return n === 1 ? title : `${title}（${n}）`
  })
}

/**
 * 列に入らなかった予定の「+n」の札（等幅 11px。まとまりの右の端に空けた札の所に、隠れた予定のいちばん早い時刻の高さで。
 * AMB-ITEMS-13）。押すと札の下に隠れた予定の一覧（区分のアイコン・件名・時刻）を小さく開き、一覧の予定を押すと詳細（ITEMS-148）。
 * 一覧は外を押す・Esc・スクロールで閉じ、閉じたら札へフォーカスを戻す（PopupMenu）
 */
function MoreChip({ chip, date }: { chip: MoreChipVM; date: string }) {
  const n = chip.ids.length
  const { openDetail } = useItemSheets()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const labels = uniqueLabels(chip.items)
  const items: PopupMenuItem[] = chip.items.map((c, i) => {
    const time = timeLabel(c, { on: date })
    return {
      label: labels[i],
      ariaLabel: `${labels[i]}、${time}`,
      hint: time,
      icon: <KindIcon kind={kindOf(c.item)} title={ITEM_KIND_LABELS[kindOf(c.item)]} className="icon" />,
      onSelect: () => openDetail(c.item.id),
    }
  })
  return (
    <>
      <button
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
          testId={`${testIds.dayMore}-list`}
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
