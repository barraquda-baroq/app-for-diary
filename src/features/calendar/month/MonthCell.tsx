// マンスリーの1つのマス（docs/SPEC.md の 9.1〜9.3・9.5・4.12。D19・D29）。
// 押す所: マスいっぱいのボタン（読み上げは日付・件数・休み・祝日名をまとめた1つ）と、L・M ではその上に重ねた仕事・プライベートの
// 数字のボタン（押せる所は 34px 四方を目安に。押すとその区分を目立たせてデイリーへ）。S と休みを付ける状態の間は、数字はボタンにせず、
// マスのどこを押してもマスのボタン（S はデイリーへ、休みを付ける状態はその日の休みを付ける・外す）。
// 中身（日付・「休」・祝日名・件数）はマスのボタンの上に重ね、押すのはその下のボタンが受ける（数字のボタンだけが自分で受ける）。
// キーボード: Tab で止まるのはマス目の中の1つのマス（tabbable）のボタンだけ。マスの間は矢印キーで動く（決めるのは MonthView と
// monthModel.ts の rovingIndex）。どのボタンにフォーカスが来ても、そのマスを Tab で止まるマスにする（onFocusCell）。
// マスごとに React.memo（中身の印が同じなら描き直さない）
import { memo } from 'react'
import type { ItemKind } from '../../../domain/types'
import { cls, HolidayName, OffMark } from '../common/parts'
import { testIds } from '../common/testIds'
import type { MonthCellVM, MonthCountVM } from './monthModel'
import './month.css'

export interface MonthCellProps {
  cell: MonthCellVM
  /** S の詰めた形（数字はボタンにしない。9.3） */
  compact: boolean
  /** 休みを付ける状態（数字もボタンにせず、マスの枠を点線に。9.5） */
  offMode: boolean
  /** マスを押した（デイリーへ・前後の月へ・休みを付ける・外す。決めるのは MonthView） */
  onCell: (cell: MonthCellVM) => void
  /** L・M で数字を押した（その区分を目立たせてデイリーへ） */
  onCount: (date: string, kind: ItemKind) => void
  /** Tab で止まるマス（マス目の中で1つだけ。ほかのマスのボタンは tabIndex -1。矢印キーで動かす） */
  tabbable: boolean
  /** このマスのボタンにフォーカスが来た（そのマスを Tab で止まるマスにする） */
  onFocusCell: (date: string) => void
}

function MonthCellImpl({ cell, compact, offMode, onCell, onCount, tabbable, onFocusCell }: MonthCellProps) {
  const { date, day, outside, tone, isToday, off, holiday, counts, wide, label } = cell
  // 数字を別のボタンにするのは L・M の、休みを付ける状態でない時だけ（D19・9.5）
  const countButtons = !compact && !offMode
  const tabIndex = tabbable ? 0 : -1
  return (
    <div
      className={cls('cal-cell', 'mo-cell', off && 'cp-offday')}
      data-testid={testIds.monthCell(date)}
      data-date={date}
      data-outside={outside || undefined}
      data-tone={tone ?? undefined}
      data-off={off || undefined}
      data-today={isToday || undefined}
      onFocus={() => onFocusCell(date)}
    >
      <button
        type="button"
        className="mo-hit"
        aria-label={label}
        // 休みを付ける状態の間は、押すと休みが付いたり外れたりするボタン（今付いているかを伝える）
        aria-pressed={offMode ? off : undefined}
        aria-current={isToday ? 'date' : undefined}
        tabIndex={tabIndex}
        onClick={() => onCell(cell)}
      />
      <div className="mo-top" aria-hidden="true">
        <span className={cls('mono', 'mo-date', isToday && 'today-mark is-today')}>{day}</span>
        {off && <OffMark className="mo-off" />}
        {holiday && <HolidayName date={date} className="mo-holiday" />}
      </div>
      {counts && (
        <div
          className={cls('mono', 'mo-counts', countButtons && 'is-buttons', wide && 'is-wide')}
          aria-hidden={countButtons ? undefined : true}
        >
          <Count date={date} kind="work" count={counts.work} button={countButtons} tabIndex={tabIndex} onCount={onCount} />
          <span className="mo-sep" aria-hidden="true">
            /
          </span>
          <Count date={date} kind="private" count={counts.private} button={countButtons} tabIndex={tabIndex} onCount={onCount} />
        </div>
      )}
    </div>
  )
}

/** 1つの区分の数字（L・M はボタン。S・休みを付ける状態の間は字だけ） */
function Count({
  date,
  kind,
  count,
  button,
  tabIndex,
  onCount,
}: {
  date: string
  kind: ItemKind
  count: MonthCountVM
  button: boolean
  /** マスのボタンと同じ（Tab で止まるマスの数字だけが 0） */
  tabIndex: number
  onCount: (date: string, kind: ItemKind) => void
}) {
  const className = cls('mo-count', `is-${kind}`, count.zero && 'is-zero')
  const testId = testIds.monthCount(date, kind)
  if (!button) {
    return (
      <span className={className} data-testid={testId}>
        {count.text}
      </span>
    )
  }
  return (
    <button
      type="button"
      className={className}
      aria-label={count.label}
      tabIndex={tabIndex}
      onClick={() => onCount(date, kind)}
      data-testid={testId}
    >
      {count.text}
    </button>
  )
}

/** 中身の印（マスの VM の値）と押した時の動きが同じなら描き直さない（VM は描き直すたびに作り直されるので、値で比べる） */
function sameCell(a: MonthCellProps, b: MonthCellProps): boolean {
  if (
    a.compact !== b.compact ||
    a.offMode !== b.offMode ||
    a.tabbable !== b.tabbable ||
    a.onCell !== b.onCell ||
    a.onCount !== b.onCount ||
    a.onFocusCell !== b.onFocusCell
  )
    return false
  const x = a.cell
  const y = b.cell
  return (
    x.date === y.date &&
    x.outside === y.outside &&
    x.tone === y.tone &&
    x.isToday === y.isToday &&
    x.off === y.off &&
    x.holiday === y.holiday &&
    x.wide === y.wide &&
    x.label === y.label &&
    sameCounts(x.counts, y.counts)
  )
}

function sameCounts(a: MonthCellVM['counts'], b: MonthCellVM['counts']): boolean {
  if (a === null || b === null) return a === b
  return a.work.text === b.work.text && a.private.text === b.private.text
}

export const MonthCell = memo(MonthCellImpl, sameCell)
