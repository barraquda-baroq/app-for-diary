// 3つのリストの1行の枠（docs/SPEC.md の 3.6・4.4・4.7・4.9・4.11）: 箱で囲まず、行の下に 1px の --rule。高さは最小 40px、字は 14px・400・
// 行の高さ 1.45（Task List の M・S の件名など、節の値が勝つ）。中身（チェック・件名・日付など）は各リストの行が children に置き、
// 「…」（common/RowMenu）は menu に渡す（行の右に置く）。corner は件名の右上の置き場（段階5の提案の印 ProposalIcon。3.6・18.6）。
// - 目立たせる（足した行・済みへ移った行。1.2秒の 2px の --accent の枠。4.9）: flash に common/listFlash.ts のキーを渡す。L は右の列の
//   中だけでスクロールして見える所まで出し、S・M はページを動かさない（見えていれば目立つ。D9・P12）
// - 字を選ぶ・iOS の長押しの吹き出しは、その場で直している間（editing）のほかは出さない（0.4秒の並べ替えとぶつけない。D48・P7）
// - dragRef は掴む物の ref（features/dnd の useTaskRowDrag・useReorder の ref）。rowProps などほかの属性は ...rest で行に付く
// 行は1つの平らな並びに id を key にして置く（チェックで並びが替わっても作り直さない。§3.7）。各リストの行は React.memo で包む
import { useCallback, type HTMLAttributes, type ReactNode } from 'react'
import type { ID } from '../../../domain/types'
import type { ListKey } from '../../../store/uiStore'
import { useFlashTarget } from '../../calendar/common/parts/useFlashTarget'
import { listTestIds } from './testIds'
import './lists.css'

export interface ListRowProps extends HTMLAttributes<HTMLDivElement> {
  list: ListKey
  id: ID
  /** 済み（済んだ行の見た目。data-done） */
  done?: boolean
  /** その場で直している（字を選べる） */
  editing?: boolean
  /** 目立たせるキー（common/listFlash.ts の listFlashKey.row） */
  flash?: string
  /** 「…」（common/RowMenu） */
  menu?: ReactNode
  /** 件名の右上の置き場（段階5の提案の印） */
  corner?: ReactNode
  /** 掴む物の ref（ドラッグ・並べ替え） */
  dragRef?: (el: Element | null) => void
  children?: ReactNode
}

export function ListRow({ list, id, done, editing, flash, menu, corner, dragRef, className, children, ...rest }: ListRowProps) {
  const flashRef = useFlashTarget<HTMLDivElement>(flash, { scroll: true })
  const ref = useCallback(
    (el: HTMLDivElement | null) => {
      flashRef(el)
      dragRef?.(el)
    },
    [flashRef, dragRef],
  )
  return (
    <div
      {...rest}
      ref={ref}
      className={`list-row${editing ? ' is-editing' : ''}${className ? ` ${className}` : ''}`}
      data-done={done ? 'true' : undefined}
      data-testid={listTestIds.row(list, id)}
    >
      {children}
      {corner ? <span className="list-row-corner">{corner}</span> : null}
      {menu}
    </div>
  )
}
