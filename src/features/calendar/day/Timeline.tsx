// デイリーのタイムスケジュール（docs/SPEC.md の 11.3・4.4-6・7.3・D28・D39）。0:00〜24:00、1時間の高さは L・M 48px、S 44px。
// - 左に幅 48px の時刻の欄（等幅 11px・--text-faint。「0:00」〜「23:00」を各時間の上の端に）
// - 時間の縞: 偶数の時は --surface、奇数の時は --stripe。各時間の上に 1px の --rule、12:00 は 1px の点線（--rule-strong）、
//   0:00 は 2px（--rule-strong）
// - 予定の枠（TimedEvent・MultiDayPiece）を重なりの列に並べ、列に入らない分は最後の列の右端に「+n」の札（MoreChip。押すと隠れた予定の
//   一覧。onMore。つなぐのは段階2の後半 WP8B）
// - 今の時刻の線（今日だけ。2px の --accent と、時刻の欄の端に直径 8px の丸。60秒ごとに動かす。useNow）
// - 開いた時の位置: 今日は今の時刻の 60分前、ほかの日は 7:00 を上の端に。画面を開いた時と見ている日が替わった時だけ当てる
//   （詳細などの小さな画面を閉じた時・予定が変わった時は今の位置のまま。AMB-ITEMS-31）
// - 空いた所を押す（onSlot に押した所の 0:00 からの分を渡す。登録の画面を開くのは段階2の後半 WP8B）
// タイムスケジュールはその中だけでスクロールする（11.1）。予定はドラッグできない（ITEMS-150）
import { useLayoutEffect, useRef, type CSSProperties, type MouseEvent } from 'react'
import type { ID } from '../../../domain/types'
import { useNow } from '../../../ui/hooks'
import { cls } from '../common/parts'
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
  /** 「+n」の札を押した（隠れた予定の id と札の要素。渡さない間は何もしない） */
  onMore?: (ids: ID[], anchor: HTMLElement) => void
}

export function Timeline({ date, today, timeline, onSlot, onMore }: TimelineProps) {
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
              <MoreChip key={m.at} chip={m} onMore={onMore} />
            ))}
            {isToday ? <NowLine hourPx={hourPx} /> : null}
          </div>
        </div>
      </div>
    </section>
  )
}

/** 列に入らなかった予定の「+n」の札（等幅 11px。最後の列の右端に、予定の上に重ねて小さく。AMB-ITEMS-13） */
function MoreChip({ chip, onMore }: { chip: MoreChipVM; onMore?: TimelineProps['onMore'] }) {
  const n = chip.ids.length
  return (
    <button
      type="button"
      className="mono dy-more"
      style={{ top: `${chip.top}px` }}
      onClick={onMore ? (e) => onMore(chip.ids, e.currentTarget) : undefined}
      aria-label={`ほかに ${n}件の予定`}
      aria-haspopup="menu"
      data-at={chip.at}
      data-testid={testIds.dayMore}
    >
      +{n}
    </button>
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
