// ウィークリーの7日を横（L・M。docs/SPEC.md の 10.1〜10.3・7.8）。
// いちばん上に日の見出しの行（52px。列が 120px より狭いと 64px の2行）、その下を上下に分けて上が仕事・下がプライベートの段
// （高さは半分ずつ・間は 8px あけて 1px の --rule）。段のいちばん上に名札（24px）、中は段ごとに縦にスクロールする。
// 列（日）の地と縦の線は、見出しから下の端まで続く帯（week-col-{日付}）で敷く（休みの日は --off-fill・上に 2px の --rule-strong）。
// 見出し・段の中の列はその帯と同じ幅の7列に並べる（どちらもスクロールバーの分を取っておき、ずれないように）。
// 各列の中は上から、複数日の予定のレーン（その段のレーンの数 × 40px。どの列も同じ高さなので、1日のカードの上の端がそろう）→
// 1日のカード（7.5 の順・間 4px）→「＋」の行。領域が 504px（72px × 7）より狭い時は、見出しと段がいっしょに横にスクロールする
import type { RefObject } from 'react'
import { ITEM_KIND_LABELS } from '../../../domain/trash'
import { cls, itemAttrs } from '../common/parts'
import { testIds } from '../common/testIds'
import { useDayDrop, type WeekCtx } from './dnd'
import { AddRow, EdgeArrow, EndDot, ReceivedCard, StartCard, WeekCard } from './WeekCard'
import { DayHead, KindTag } from './WeekHead'
import { isQuickOpen, type WeekActions } from './weekActions'
import {
  horizontalCardTextPx,
  horizontalLine,
  laneTop,
  receivedTextPx,
  weekHeadRows,
  type LaneSlot,
  type WeekDay,
  type WeekKind,
  type WeekModel,
} from './weekModel'
import './week.css'

export interface WeekHorizontalProps {
  model: WeekModel
  today: string
  week: WeekCtx
  /** 1列の幅（px。見出しの行の数と、始点のカードの期間が入るかを決める。測れていない時は 0） */
  columnPx: number
  actions: WeekActions
  scroller: RefObject<HTMLDivElement | null>
}

export function WeekHorizontal({ model, today, week, columnPx, actions, scroller }: WeekHorizontalProps) {
  const rows = weekHeadRows(columnPx)
  return (
    <div ref={scroller} className="wk wk-h" data-head-rows={rows} data-testid={testIds.view('week')} data-week-scroller="">
      <div className="wk-h-inner">
        <div className="wk-strips" aria-hidden="true">
          {model.days.map((d) => (
            <div key={d.date} className={cls('wk-strip', d.off && 'cp-offday')} data-testid={testIds.weekCol(d.date)} />
          ))}
        </div>
        <div className={cls('wk-heads', `is-rows-${rows}`)}>
          {model.days.map((d) => (
            <DayHead key={d.date} day={d} today={today} layout={rows} actions={actions} />
          ))}
        </div>
        <KindTier kind={model.kinds.work} days={model.days} week={week} columnPx={columnPx} actions={actions} />
        <div className="wk-divider" aria-hidden="true" />
        <KindTier kind={model.kinds.private} days={model.days} week={week} columnPx={columnPx} actions={actions} />
      </div>
    </div>
  )
}

interface KindTierProps {
  kind: WeekKind
  days: WeekDay[]
  week: WeekCtx
  columnPx: number
  actions: WeekActions
}

/** 1つの段（仕事・プライベート）: 名札と、縦にスクロールする7列 */
function KindTier({ kind, days, week, columnPx, actions }: KindTierProps) {
  return (
    <section className="wk-tier" data-tier={kind.kind} aria-label={ITEM_KIND_LABELS[kind.kind]}>
      <KindTag kind={kind.kind} />
      <div className="wk-tier-body">
        <div className="wk-cells">
          {days.map((d) => (
            <DayCell key={d.date} day={d} kind={kind} week={week} columnPx={columnPx} actions={actions} />
          ))}
        </div>
      </div>
    </section>
  )
}

interface DayCellProps {
  day: WeekDay
  kind: WeekKind
  week: WeekCtx
  columnPx: number
  actions: WeekActions
}

/** その段のその日の列（落とせる所。レーン → 1日のカード → 「＋」） */
function DayCell({ day, kind, week, columnPx, actions }: DayCellProps) {
  const drop = useDayDrop({ date: day.date, kind: kind.kind })
  const slots = kind.slots[day.date] ?? []
  const singles = kind.singles[day.date] ?? []
  return (
    <div ref={drop.ref} className={cls('wk-cell', day.off && 'is-off')} data-date={day.date} data-drop={drop.state}>
      {kind.laneCount > 0 ? (
        <div className="wk-lanes" style={{ height: laneTop(kind.laneCount) }}>
          {slots.map((slot, i) => (
            <LaneRow key={i} slot={slot} date={day.date} week={week} columnPx={columnPx} />
          ))}
        </div>
      ) : null}
      {singles.length > 0 ? (
        <div className="wk-singles">
          {singles.map((c) => (
            <WeekCard key={c.item.id} c={c} week={week} textPx={horizontalCardTextPx(columnPx)} />
          ))}
        </div>
      ) : null}
      <AddRow
        date={day.date}
        kind={kind.kind}
        open={isQuickOpen(actions.quick, day.date, kind.kind)}
        onAdd={actions.quickAdd}
        onClose={actions.closeQuick}
      />
    </div>
  )
}

interface LaneRowProps {
  slot: LaneSlot | null
  date: string
  week: WeekCtx
  columnPx: number
}

/** レーンの行の1日分（40px）: 始点のカード・受けた表示、線（2px・18px の高さ）、終点の●、土曜の端の＞ */
function LaneRow({ slot, date, week, columnPx }: LaneRowProps) {
  if (!slot) return <div className="wk-lane" />
  const { lane, part } = slot
  const c = lane.c
  const line = horizontalLine(part)
  const shrink = Boolean(part.shrink)
  return (
    <div className={cls('wk-lane', c.item.done && 'is-done')} {...itemAttrs(c.item)} data-lane={lane.lane}>
      {line ? <span className={`wk-line is-${line}`} aria-hidden="true" /> : null}
      {part.card === 'start' ? (
        <StartCard c={c} week={week} date={date} shrink={shrink} textPx={horizontalCardTextPx(columnPx, shrink)} />
      ) : null}
      {part.card === 'received' ? (
        <ReceivedCard
          c={c}
          week={week}
          dotIn={part.dot === 'inCard'}
          textPx={receivedTextPx(horizontalCardTextPx(columnPx), part.dot === 'inCard')}
        />
      ) : null}
      {part.dot === 'center' ? <EndDot c={c} week={week} /> : null}
      {part.arrow ? <EdgeArrow item={c.item} /> : null}
    </div>
  )
}
