// デイリーの時間指定なしのリスト（docs/SPEC.md の 11.2・7.5・7.7〜7.9・4.3・X2）。上＝仕事・下＝プライベートの区切り（領域）。
// - 区切りの地そのものに区分の色を淡く敷く（--work-area／--private-area。見出しから区切りの下の端まで、行のすき間と「＋ 予定を足す」の
//   行も含めて。行ごとの帯・ハイライトは付けない）。ディープダークは地が --surface で、2つの区切りの間に 1px の --rule-strong（day.css）
// - 見出し（28px）: 区分のアイコン＋等幅の「WORK」／「PRIVATE」＋「仕事」／「プライベート」＋まだ完了していない数
// - 行（40px 以上・下に 1px の --rule）: 行頭の●（押すと完了。押せる所 40px）→ 件名（14px・2行まで）→ 右に印 → 複数日の右の端の表記
//   （「━＞ 〜11/11」「━●」。━＞・━● は線の色、〜11/11 は --text-muted）。件名を押すと詳細
// - いちばん下に「＋ 予定を足す」の行（押すとその日・その区分のすばやく足す。onAdd。つなぐのは段階2の後半 WP8B）
// 行の形（D19）: 入れ物（div）の中に、「押すと詳細」のボタン（件名を包み、::after で行全体に広げる）と、その上に重ねた●・AI の札
// （別のボタン）を並べる（ボタンの中にボタンを入れない）
import { memo, useCallback } from 'react'
import type { CalItem, DayRow as DayRowRole } from '../../../domain/calendar'
import { listTail } from '../../../domain/itemText'
import { ITEM_KIND_LABELS } from '../../../domain/trash'
import type { ItemKind } from '../../../domain/types'
import { KindIcon, PlusIcon } from '../../../ui/icons'
import { cls, DoneToggle, ItemMarks, ItemTitle, itemAttrs } from '../common/parts'
import { useItemSheets } from '../common/sheets'
import { testIds } from '../common/testIds'
import type { DaySectionVM } from './dayModel'
import './day.css'

/** 見出しの英語（等幅） */
const KIND_EN: Record<ItemKind, string> = { work: 'WORK', private: 'PRIVATE' }

export interface UntimedAreaProps {
  date: string
  section: DaySectionVM
  /** 「＋ 予定を足す」の行を押した（その日・その区分のすばやく足す。12.1。渡さない間は押しても何も変わらない） */
  onAdd?: (kind: ItemKind) => void
}

export function UntimedArea({ date, section, onAdd }: UntimedAreaProps) {
  const { kind, rows, undone } = section
  const headId = `dy-area-head-${kind}`
  return (
    <section className="dy-area" data-kind={kind} aria-labelledby={headId} data-testid={testIds.dayArea(kind)}>
      <div className="dy-area-head" id={headId}>
        <KindIcon kind={kind} className="icon dy-area-icon" />
        <span className="head-en dy-area-en" aria-hidden="true">
          {KIND_EN[kind]}
        </span>
        <span className="dy-area-ja">{ITEM_KIND_LABELS[kind]}</span>
        <span className="mono dy-count" aria-hidden="true">
          {undone}
        </span>
        <span className="visually-hidden">まだ完了していない予定 {undone}件</span>
      </div>
      <div className="dy-area-body">
        {rows.length ? (
          <ul className="dy-rows">
            {rows.map((r) => (
              <DayRow key={r.c.item.id} c={r.c} role={r.role} date={date} />
            ))}
          </ul>
        ) : null}
        <button
          type="button"
          className="dy-add"
          onClick={onAdd ? () => onAdd(kind) : undefined}
          data-testid={testIds.dayAdd(kind)}
        >
          <PlusIcon className="icon dy-add-icon" />
          <span>予定を足す</span>
        </button>
      </div>
    </section>
  )
}

export interface DayRowProps {
  c: CalItem
  role: DayRowRole['role']
  /** 見ている日（複数日の右の端の表記を決める） */
  date: string
}

/** リストの1行（記録ごとの React.memo。受け取るのは予定と、その日の役目だけ。FRAME-284） */
export const DayRow = memo(function DayRow({ c, role, date }: DayRowProps) {
  const item = c.item
  const { openDetail } = useItemSheets()
  const open = useCallback(() => openDetail(item.id), [openDetail, item.id])
  const tail = listTail(c, date)
  return (
    <li
      className={cls('dy-row', item.done && 'is-done')}
      {...itemAttrs(item)}
      data-role={role}
      data-testid={testIds.dayRow(item.id)}
    >
      <DoneToggle item={item} look="dot" hit={40} className="dy-row-dot" />
      <button type="button" className="dy-open dy-row-open" onClick={open}>
        <ItemTitle item={item} received={tail?.received} strike lines={2} className="dy-row-title" />
      </button>
      <ItemMarks item={item} className="dy-row-marks" />
      {tail ? (
        <span className="mono-time dy-tail" data-tail={tail.mark === '━●' ? 'end' : 'next'}>
          <span className="dy-tail-mark" aria-hidden="true">
            {tail.mark}
          </span>
          {tail.range ? <span className="dy-tail-range">{tail.range}</span> : null}
          {tail.mark === '━●' ? <span className="visually-hidden">この日まで</span> : null}
        </span>
      ) : null}
    </li>
  )
})
