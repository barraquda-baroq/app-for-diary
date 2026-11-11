// ウィークリーの7日を縦（S。docs/SPEC.md の 10.4・7.8）。
// いちばん上に段の名札の行（24px・上に固定。左半分「WORK 仕事」・右半分「PRIVATE プライベート」）、その下に日曜から土曜まで
// 日のかたまり（見出し 32px・上に 2px の --rule-strong・休みの日はかたまりの地を --off-fill）。かたまりの中は左が仕事・右が
// プライベート（各 50%・間に 1px の --rule）で、それぞれ上から「● 件名」の行・始点のカード・受けた表示 → 1日のカード（7.5 の順）
// → 「＋」の行（28px・いつも出す）。
// 複数日の予定は各半分の左のレール（10px × その週のその区分のレーンの数。最大3本）に、レーンの位置（4・14・24px）の縦の線（2px）を
// カードの高さの真ん中から締め切り日のかたまりの●まで引く（見出しの所では切れる）。次の週へ続く物は土曜の下の端に下向きの矢印。
// 4本目のレーンからの予定はレールを使わず、始点のカードの期間と、締め切り日の「● 件名」の行で示す（D41）。
// 落とせる所は、かたまりのその半分の全体（余白も。すき間で落とせなくならないように。WP11s の G8）
import type { RefObject } from 'react'
import { jaDateLabel } from '../../../domain/dates'
import { cls, itemAttrs } from '../common/parts'
import { testIds } from '../common/testIds'
import { useDayDrop, type WeekCtx } from './dnd'
import { AddRow, EdgeArrow, EndDot, OverflowRow, ReceivedCard, StartCard, WeekCard } from './WeekCard'
import { DayHead, KindTag } from './WeekHead'
import { isQuickOpen, type WeekActions } from './weekActions'
import {
  railsPx,
  receivedTextPx,
  verticalCardTextPx,
  WEEK_PX,
  type RailSegment,
  type WeekDay,
  type WeekKind,
  type WeekModel,
} from './weekModel'
import './week.css'

/** レールの中の●・矢印の押せる所（幅は隣の半分・カードに掛からない大きさ、●の高さは 28px。D08。week.css と同じ値） */
const RAIL_HIT = { width: 18, dotHeight: 28 } as const

export interface WeekVerticalProps {
  model: WeekModel
  today: string
  week: WeekCtx
  /** かたまりの半分の幅（px。始点のカードの期間が入るかを決める。測れていない時は 0） */
  halfPx: number
  actions: WeekActions
  scroller: RefObject<HTMLDivElement | null>
}

export function WeekVertical({ model, today, week, halfPx, actions, scroller }: WeekVerticalProps) {
  return (
    <div ref={scroller} className="wk wk-v" data-testid={testIds.view('week')} data-week-scroller="">
      <div className="wk-vtags">
        <KindTag kind="work" />
        <KindTag kind="private" />
      </div>
      {model.days.map((d) => (
        <section
          key={d.date}
          className={cls('wk-block', d.off && 'cp-offday')}
          aria-label={jaDateLabel(d.date)}
          data-testid={testIds.weekCol(d.date)}
        >
          <DayHead day={d} today={today} layout="block" actions={actions} />
          <div className="wk-block-body">
            <Half day={d} kind={model.kinds.work} week={week} halfPx={halfPx} actions={actions} />
            <Half day={d} kind={model.kinds.private} week={week} halfPx={halfPx} actions={actions} />
          </div>
        </section>
      ))}
    </div>
  )
}

interface HalfProps {
  day: WeekDay
  kind: WeekKind
  week: WeekCtx
  halfPx: number
  actions: WeekActions
}

/** 日のかたまりの半分（その日・その区分。落とせる所） */
function Half({ day, kind, week, halfPx, actions }: HalfProps) {
  const drop = useDayDrop({ date: day.date, kind: kind.kind, week })
  const half = kind.vertical[day.date]
  const singles = kind.singles[day.date] ?? []
  const textPx = verticalCardTextPx(halfPx, kind.rails)
  return (
    <div
      ref={drop.ref}
      className={cls('wk-half', kind.rails > 0 && 'has-rails')}
      style={kind.rails > 0 ? { paddingLeft: railsPx(kind.rails) + WEEK_PX.inset } : undefined}
      data-tier={kind.kind}
      data-date={day.date}
      data-drop={drop.state}
    >
      {half?.rails.map((seg) => (
        <Rail key={seg.lane.id} seg={seg} week={week} />
      ))}
      {half?.overflowRows.map((lane) => (
        <OverflowRow key={lane.id} c={lane.c} week={week} date={day.date} />
      ))}
      {half?.cards.map(({ lane, part }) =>
        part.card === 'received' ? (
          <ReceivedCard
            key={lane.id}
            c={lane.c}
            week={week}
            dotIn={part.dot === 'inCard'}
            textPx={receivedTextPx(textPx, part.dot === 'inCard')}
          />
        ) : (
          <StartCard key={lane.id} c={lane.c} week={week} date={day.date} textPx={textPx} />
        ),
      )}
      {singles.map((c) => (
        <WeekCard key={c.item.id} c={c} week={week} textPx={textPx} />
      ))}
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

/** 1日分のレールの縦の線（と、締め切り日の●・土曜の下向きの矢印） */
function Rail({ seg, week }: { seg: RailSegment; week: WeekCtx }) {
  const c = seg.lane.c
  const item = c.item
  const bottom = seg.bottom === 'end' ? (seg.arrow ? WEEK_PX.railArrow : 0) : undefined
  const height = seg.bottom === 'end' ? undefined : Math.max(0, seg.bottom - seg.top)
  // 線の中心（2px の線の左 + 1px）に●と矢印の真ん中を合わせる
  const center = seg.x + 1
  return (
    <>
      <span
        className={cls('wk-rail', item.done && 'is-done')}
        {...itemAttrs(item)}
        style={{ left: seg.x, top: seg.top, bottom, height }}
        aria-hidden="true"
        data-lane={seg.lane.lane}
      />
      {seg.dotY !== undefined ? (
        <EndDot
          c={c}
          week={week}
          className="is-rail"
          left={center - RAIL_HIT.width / 2}
          top={seg.dotY - RAIL_HIT.dotHeight / 2}
        />
      ) : null}
      {seg.arrow ? <EdgeArrow item={item} down className="is-rail" left={center - RAIL_HIT.width / 2} /> : null}
    </>
  )
}
