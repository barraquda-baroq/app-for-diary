// イヤーの1日のマス（docs/SPEC.md の 8.2・8.3・8.4・7.1〜7.4・7.9・4.12。D07・D28）。
// マスいっぱいのボタン（押すとその日の月のマンスリーへ。読み上げは日付・予定・休み・祝日名をまとめた1つ）。中は日付（等幅）と、
// 「月を行・日を列」では英字3文字の曜日、●の決まった2つの場所（左＝仕事・右＝プライベート。予定の無い区分も場所は空けたまま）。
// キーボード: Tab で止まるのはイヤーの中の1つのマス（tabbable）だけ。マスの間は矢印キーで動く（決めるのは YearView と
// yearModel.ts の yearMove）。フォーカスが来たら、そのマスを Tab で止まるマスにする（onFocusCell）。
// マスごとに React.memo（中身の印が同じなら描き直さない）
import { memo } from 'react'
import { ITEM_KINDS } from '../../../domain/types'
import { cls } from '../common/parts'
import { testIds } from '../common/testIds'
import type { DotsRow, YearDayVM } from './yearModel'
import './year.css'

export interface YearCellProps {
  day: YearDayVM
  /** 小さな月のマス（日付だけを真ん中に。8.3） */
  mini: boolean
  /** 「月を行・日を列」の●の段（右上か、曜日の下の段か。D28）。小さな月はいつも右上 */
  dots: DotsRow
  /** Tab で止まるマス（イヤーの中で1つだけ。ほかのマスは tabIndex -1。矢印キーで動かす） */
  tabbable: boolean
  /** 押した（その日の月のマンスリーへ。決めるのは YearView） */
  onCell: (date: string) => void
  /** このマスにフォーカスが来た（そのマスを Tab で止まるマスにする） */
  onFocusCell: (date: string) => void
}

function YearCellImpl({ day, mini, dots, tabbable, onCell, onFocusCell }: YearCellProps) {
  const { date, tone, isToday, off } = day
  return (
    <button
      type="button"
      className={cls('yr-cell', mini && 'is-mini', !mini && `is-dots-${dots}`, off && 'cp-offday', isToday && 'is-today')}
      data-testid={testIds.yearCell(date)}
      data-date={date}
      data-tone={tone ?? undefined}
      data-off={off || undefined}
      data-today={isToday || undefined}
      aria-label={day.label}
      aria-current={isToday ? 'date' : undefined}
      tabIndex={tabbable ? 0 : -1}
      onClick={() => onCell(date)}
      onFocus={() => onFocusCell(date)}
    >
      <span className="mono yr-date" aria-hidden="true">
        {day.day}
      </span>
      {!mini && (
        <span className="mono yr-wd" aria-hidden="true">
          {day.weekday}
        </span>
      )}
      <span className="yr-dots" aria-hidden="true">
        {ITEM_KINDS.map((kind) => (
          <span key={kind} className={`yr-dot is-${kind}`} data-state={day.dots[kind]} />
        ))}
      </span>
    </button>
  )
}

/** 中身の印（マスの VM の値）と押した時の動きが同じなら描き直さない（VM は作り直されるたびに新しい物になるので、値で比べる） */
function sameCell(a: YearCellProps, b: YearCellProps): boolean {
  if (
    a.mini !== b.mini ||
    a.dots !== b.dots ||
    a.tabbable !== b.tabbable ||
    a.onCell !== b.onCell ||
    a.onFocusCell !== b.onFocusCell
  )
    return false
  const x = a.day
  const y = b.day
  return (
    x.date === y.date &&
    x.tone === y.tone &&
    x.isToday === y.isToday &&
    x.off === y.off &&
    x.label === y.label &&
    ITEM_KINDS.every((k) => x.dots[k] === y.dots[k])
  )
}

export const YearCell = memo(YearCellImpl, sameCell)
