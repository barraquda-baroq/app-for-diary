// Routine List の1行（docs/SPEC.md の 14.1・14.2・3.6・4.11・4.12）: 左に点線の丸のチェック、件名、右に小さく指定（11px・--text-faint。
// 「月・木」「25日」「3/15」。毎日・四半期・指定なしは出さない）、「…」（［詳しく］［削除］）。枠は common/ListRow（箱で囲まない・下に
// 1px の --rule・最小 40px）。
// - チェック: 押すとその日をチェックの記録に入れ、済んだ行はそのかたまりの「済み n件」へ沈む。済んだ行を押すと外す（済んでいるかは
//   画面の行で分ける。今日より前のチェックで済んでいる行もチェックし直さない。S3-ROUTINE-043）。お知らせは出さず、移った先を 1.2秒
//   目立たせる（「済み n件」を畳んでいれば、その区切りを。開発）。フォーカスがあった行が畳んだ「済み n件」へ隠れる時は、区切りへ移す
// - 済んだ行: 斜線と灰色（--done-text）。PC で乗せると（キーボードで行の中に来た時も）行の右に「11/16（月）に戻ります」（次の戻る日。
//   年が違えば年も。開発）を重ねる（行の高さは変えない）。点線の丸の読み上げの説明にもする。指の端末は［詳しく］のパネルに出す
// - 件名を押すとその場で1行の欄で直す（common/useInlineEdit。Enter・外へ出ると保存、空にすると元に戻す、Esc でやめる。1〜200字）
// - 並べ替え（同じ種類のかたまりの中だけ。済んだ行は動かさない）は features/dnd の useReorder の物を行と掴む所（PC の GripIcon。並べ替え
//   られる行だけに出す）に付ける
// 行は React.memo（行の物 row は useRoutineList が、出す物が同じ間は同じ物を渡す）
import { memo, useCallback, useRef } from 'react'
import { name20 } from '../../../domain/listText'
import type { RoutineRowView } from '../../../domain/routineList'
import type { ID } from '../../../domain/types'
import { GripIcon } from '../../../ui/icons'
import { useReorder } from '../../dnd'
import { DotCheck } from '../common/DotCheck'
import { flashList, listFlashKey } from '../common/listFlash'
import { ListRow } from '../common/ListRow'
import { RowMenu } from '../common/RowMenu'
import { listTestIds } from '../common/testIds'
import { useInlineEdit } from '../common/useInlineEdit'
import { deleteRoutine, renameRoutine, toggleRoutineCheck } from './routineActions'

export interface RoutineRowProps {
  row: RoutineRowView
  /** まだの行の中の位置（並べ替え。済んだ行は -1） */
  index: number
  /** そのかたまりの「済み n件」を畳んでいる（チェックした行はそこへ隠れる） */
  doneCollapsed: boolean
  /** ［詳しく］のパネルを開く */
  onDetail: (id: ID) => void
  /** フォーカスのあった行が、畳んだ「済み n件」へ隠れた（区切りへフォーカスを移す） */
  onHidden: () => void
}

export const RoutineRow = memo(function RoutineRow({ row, index, doneCollapsed, onDetail, onHidden }: RoutineRowProps) {
  const { routine } = row
  const rowEl = useRef<HTMLElement | null>(null)
  const name = name20(routine.title)
  const reorder = useReorder({ table: 'routines', group: row.cycle, id: row.id, index, disabled: row.done })
  const edit = useInlineEdit({ value: routine.title, onSave: (t) => void renameRoutine(routine, t) })
  const returnId = `rt-return-${row.id}`
  const reorderRef = reorder.ref
  const dragRef = useCallback(
    (el: Element | null) => {
      rowEl.current = el instanceof HTMLElement ? el : null
      reorderRef(el)
    },
    [reorderRef],
  )

  const toggle = () => {
    const hadFocus = rowEl.current?.contains(document.activeElement) ?? false
    toggleRoutineCheck(row)
    const hides = !row.done && doneCollapsed
    flashList(hides ? listFlashKey.routineDone(row.cycle) : listFlashKey.row('routine', row.id))
    if (hides && hadFocus) onHidden()
  }

  return (
    <ListRow
      {...reorder.rowProps}
      list="routine"
      id={row.id}
      done={row.done}
      editing={edit.editing}
      className="rt-row"
      flash={listFlashKey.row('routine', row.id)}
      dragRef={dragRef}
      menu={
        <RowMenu
          list="routine"
          id={row.id}
          name={name}
          items={() => [
            { label: '詳しく', onSelect: () => onDetail(row.id) },
            { label: '削除', danger: true, onSelect: () => void deleteRoutine(routine) },
          ]}
        />
      }
    >
      <DotCheck
        done={row.done}
        name={name}
        onToggle={toggle}
        aria-describedby={row.done ? returnId : undefined}
        data-testid={listTestIds.rowCheck('routine', row.id)}
      />
      <div className="rt-main">
        {edit.editing ? (
          <input
            {...edit.inputProps}
            type="text"
            className="input rt-title-input"
            aria-label="件名"
            autoComplete="off"
            enterKeyHint="done"
            data-testid={listTestIds.rowEdit('routine', row.id)}
          />
        ) : (
          <button type="button" className="rt-title" onClick={edit.start} data-testid={listTestIds.rowTitle('routine', row.id)}>
            {routine.title}
          </button>
        )}
      </div>
      {row.specLabel ? (
        <span className="rt-spec" data-testid={listTestIds.routineSpecLabel(row.id)}>
          {row.specLabel}
        </span>
      ) : null}
      {row.done ? (
        <span id={returnId} className="rt-return" data-testid={listTestIds.routineReturn(row.id)}>
          {row.returnText}
        </span>
      ) : null}
      {reorder.disabled ? null : (
        <span
          ref={reorder.handleRef}
          className="rt-grip"
          data-reorder-grip=""
          aria-hidden="true"
          data-testid={listTestIds.rowGrip('routine', row.id)}
        >
          <GripIcon />
        </span>
      )}
    </ListRow>
  )
})
