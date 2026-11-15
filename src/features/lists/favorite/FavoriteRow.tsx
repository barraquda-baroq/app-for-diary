// Favorite List の1行（docs/SPEC.md の 15.2〜15.4・3.6・4.11・4.12）: 左に点線の丸のチェック、中身（favorite/FavoriteText。14px・
// 2行以上なら1行目を 600・リンク・3行を超えたら「続き」）、右上に足した日（等幅 10px・--text-faint。「11/10」。年が今日と違えば
// 年も）、「…」（［詳しく］［予定にする］［Task List へ移す］［削除］）。枠は common/ListRow（箱で囲まない・下に 1px の --rule・
// 最小 40px）。分類・仕事／プライベートの区別は付けない。
// - チェック: 済みにすると斜線と灰色で「済み n件」へ沈み、外すと元の所へ戻る。お知らせは出さず、移った先を 1.2秒目立たせる（「済み
//   n件」を畳んでいれば、その区切りを）。フォーカスがあった行が畳んだ「済み n件」へ隠れる時は、区切りへ移す（onHidden）
// - 中身を押すと（リンクを除く）その場で直す（common/useInlineEdit の複数行の欄。自動で高さが伸び、6行ほどで中でスクロール。
//   common/useGrowField）: PC は Enter で保存・Shift+Enter で改行、指の端末の Enter は改行。止まってから 0.6秒と、欄から出た時に
//   保存する（外を押すと保存）。空にすると保存せずに元に戻す。Esc は保存せずにやめる。前後の空白は落とす
// - ［予定にする］: 登録の画面（12.2）を、件名に最初の空でない行（200字まで）、メモに残りを入れ、開始日は今日・区分は仕事で開く
//   （元の項目は残す）。［Task List へ移す］・［削除］は favorite/favoriteActions.ts
// - 並べ替え（まだの行の中だけ。済んだ行は動かさない）は features/dnd の useReorder の物を行と掴む所（PC の GripIcon）に付ける
// 行は React.memo（行の物 row は useFavoriteList が、出す物が同じ間は同じ物を渡す）
import { memo, useCallback, useRef } from 'react'
import type { FavoriteRowView } from '../../../domain/favoriteList'
import type { ID } from '../../../domain/types'
import { GripIcon } from '../../../ui/icons'
import { useReorder } from '../../dnd'
import { DotCheck } from '../common/DotCheck'
import { flashList, listFlashKey } from '../common/listFlash'
import { ListRow } from '../common/ListRow'
import { RowMenu } from '../common/RowMenu'
import { listTestIds } from '../common/testIds'
import { useGrowField } from '../common/useGrowField'
import { useInlineEdit } from '../common/useInlineEdit'
import { deleteFavorite, FAVORITE_AUTOSAVE_MS, moveFavoriteToTask, saveFavoriteText, setFavoriteDone } from './favoriteActions'
import { FavoriteText } from './FavoriteText'

export interface FavoriteRowProps {
  row: FavoriteRowView
  /** まだの行の中の位置（並べ替え。済んだ行は -1） */
  index: number
  /** 「済み n件」を畳んでいる（チェックした行はそこへ隠れる） */
  doneCollapsed: boolean
  /** ［詳しく］のパネルを開く */
  onDetail: (id: ID) => void
  /** ［予定にする］: その中身で登録の画面を開く */
  onRegister: (text: string) => void
  /** フォーカスのあった行が、畳んだ「済み n件」へ隠れた（区切りへフォーカスを移す） */
  onHidden: () => void
}

export const FavoriteRow = memo(function FavoriteRow({
  row,
  index,
  doneCollapsed,
  onDetail,
  onRegister,
  onHidden,
}: FavoriteRowProps) {
  const { favorite } = row
  const done = favorite.done === true
  const rowEl = useRef<HTMLElement | null>(null)
  const reorder = useReorder({ table: 'favorites', group: 'open', id: row.id, index, disabled: done })
  const edit = useInlineEdit({
    value: favorite.text,
    onSave: (t) => void saveFavoriteText(favorite, t),
    multiline: true,
    autosaveMs: FAVORITE_AUTOSAVE_MS,
  })
  const grow = useGrowField(edit.inputProps.value)
  // 欄の ref は描くたびに新しい物が来るので、いちばん新しい物を呼ぶ（欄に付ける ref は同じ物のまま。付け直さない）
  const editRef = useRef(edit.inputProps.ref)
  editRef.current = edit.inputProps.ref
  const areaRef = useCallback(
    (el: HTMLTextAreaElement | null) => {
      editRef.current(el)
      grow(el)
    },
    [grow],
  )
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
    if (!setFavoriteDone(row.id, !done)) return
    const hides = !done && doneCollapsed
    flashList(hides ? listFlashKey.done('favorite') : listFlashKey.row('favorite', row.id))
    if (hides && hadFocus) onHidden()
  }

  return (
    <ListRow
      {...reorder.rowProps}
      list="favorite"
      id={row.id}
      done={done}
      editing={edit.editing}
      className="fv-row"
      flash={listFlashKey.row('favorite', row.id)}
      dragRef={dragRef}
      menu={
        <RowMenu
          list="favorite"
          id={row.id}
          name={row.name}
          items={() => [
            { label: '詳しく', onSelect: () => onDetail(row.id) },
            { label: '予定にする', onSelect: () => onRegister(favorite.text) },
            { label: 'Task List へ移す', onSelect: () => void moveFavoriteToTask(favorite) },
            { label: '削除', danger: true, onSelect: () => void deleteFavorite(favorite) },
          ]}
        />
      }
    >
      <DotCheck done={done} name={row.name} onToggle={toggle} data-testid={listTestIds.rowCheck('favorite', row.id)} />
      <div className="fv-main">
        {edit.editing ? (
          <textarea
            {...edit.inputProps}
            ref={areaRef}
            rows={1}
            className="input list-grow fv-edit"
            aria-label="やりたいことの中身"
            autoComplete="off"
            data-testid={listTestIds.rowEdit('favorite', row.id)}
          />
        ) : (
          <FavoriteText row={row} onEdit={edit.start} />
        )}
        {edit.editing ? null : (
          <span className="mono fv-added" data-testid={listTestIds.favoriteAdded(row.id)}>
            <span className="visually-hidden">足した日 </span>
            {row.added}
          </span>
        )}
      </div>
      {reorder.disabled ? null : (
        <span
          ref={reorder.handleRef}
          className="fv-grip"
          data-reorder-grip=""
          aria-hidden="true"
          data-testid={listTestIds.rowGrip('favorite', row.id)}
        >
          <GripIcon />
        </span>
      )}
    </ListRow>
  )
})
