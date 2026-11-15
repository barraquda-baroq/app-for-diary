// Task List の1行（docs/SPEC.md の 13.3〜13.5・3.6・4.3・4.4・4.11・12.5・12.8）。行の外枠は common/ListRow（箱で囲まず下に 1px の
// --rule、最小 40px、目立たせる所）、「…」は common/RowMenu、チェックは common/DotCheck。行は記録ごとの React.memo（中身のフックが、
// 出す物が同じ行は前と同じ物を渡すので、ほかの行を直しても描き直さない）。操作は task/taskOps。
// - L（右の列。wide）: 左から 区分の印（16px。押すと仕事とプライベートを入れ替える）→ チェック（24px。押せる所は 40px 四方で、重なる所は
//   チェックが勝つ）→ 締め切り日（40px。等幅 12px。1日は「11/20」、複数日は「11/10〜」（10px・淡い字）の下に「11/20」、④は「11/10〜」、
//   ①は淡い「—」。押すと日付のメニュー）→ 依頼者（48px。名前がある行だけ。12px・1行で「…」。押すとその場で直す。候補付き）→
//   件名（残りの幅。14px・2行まで。押すとその場で直す）。「…」は欄を取らず件名の右上に重ねる。欄の間は 4px（268px に収める）
// - M・S（積んだリスト）: 左に区分の印とチェック、2行の真ん中（上に小さく「〆11/20・営業部」。等幅の日付＋依頼者・11px・--text-muted。
//   下に件名 15px）、右に「…」。日付のメニューは「…」の［日付…］から（上の行は指で押すには小さいので。開発）
// - 期限切れ・今日（6.4・13.3）: 期間の終わり to が今日より前で済んでいない物は日付の字を --overdue、今日の物は太字（600）。
//   M・S の上の行は日付の所だけに付ける。知らせは出さない（TASK-223）
// - 件名のハイライト（4.3・13.3）: 件名の字だけを包む inline の要素（.kind-marker）に区分の色の帯。日付・依頼者・「…」・区分の印・
//   チェックには入れない。済んだ行（斜線と --done-text）・その場で直している間・ディープダーク（帯の色が transparent）には出ない。
//   行の地は区分で変えず、ラベルの色も出さない（ラベルは詳細で選ぶ。4.3）
// - 「…」メニュー（13.5）: ［詳しく］（「タスク」の詳細。L は右の列の上のパネル、S・M はシート）・M・S の［日付…］・
//   ［日付を決める］（list 生まれの①④）・［Task List から外す］（カレンダーに出ている時）・［削除］（12.8）
// - 日付のメニュー・小さな月のカレンダーが開いている時の「戻る」（端からのフリックも）は、それだけを閉じる（common/listPopups。リストは
//   畳まない。3.1・開発）
// - 掴む所（features/dnd の useTaskRowDrag）の ref と行の属性を広げる（掴めるのは L・マウス・カレンダーを出している時。13.6）
import { memo, useCallback, useRef, useState, type ChangeEvent } from 'react'
import { flushSync } from 'react-dom'
import { limitChars } from '../../../domain/itemInput'
import { name20 } from '../../../domain/listText'
import { taskStackedParts, type TaskDateField, type TaskRowView } from '../../../domain/taskList'
import { LIMITS } from '../../../domain/types'
import { KindIcon } from '../../../ui/icons'
import type { PopupMenuItem } from '../../../ui/PopupMenu'
import { useItemSheets } from '../../calendar/common/sheets'
import { cls, displayTitle, kindOf } from '../../calendar/common/parts/itemLook'
import { useTaskRowDrag } from '../../dnd'
import { DotCheck } from '../common/DotCheck'
import { listFlashKey } from '../common/listFlash'
import { useListPopup } from '../common/listPopups'
import { ListRow } from '../common/ListRow'
import { RowMenu } from '../common/RowMenu'
import { listTestIds } from '../common/testIds'
import { useInlineEdit } from '../common/useInlineEdit'
import { RequesterInput } from './RequesterInput'
import { TaskDateMenu, TaskDatePicker } from './TaskDateMenu'
import { removeTask, saveTaskRequester, saveTaskTitle, toggleTaskDone, toggleTaskKind, unlistTask } from './taskOps'
import { taskTestIds } from './taskTestIds'
import './task.css'

export interface TaskRowProps {
  view: TaskRowView
  /** L の右の列の行（6つの列）か、M・S の2行の行か */
  wide: boolean
  /** 今日（日付のメニューの今日・明日・今週金曜） */
  today: string
}

const KIND_NAME = { work: '仕事', private: 'プライベート' } as const

export const TaskRow = memo(function TaskRow({ view, wide, today }: TaskRowProps) {
  const { item } = view
  const kind = kindOf(item)
  const title = displayTitle(item)
  const name = name20(title)
  const requester = typeof item.requester === 'string' ? item.requester.trim() : ''
  const drag = useTaskRowDrag(item)
  const sheets = useItemSheets()
  const row = useRef<HTMLElement | null>(null)
  const dragRef = drag.ref
  const rowRef = useCallback(
    (el: Element | null) => {
      row.current = el instanceof HTMLElement ? el : null
      dragRef(el)
    },
    [dragRef],
  )
  /** 開いている日付のメニュー（開いた所） */
  const [dateMenu, setDateMenu] = useState<HTMLElement | null>(null)
  /** 開いている小さな月のカレンダー（直す欄と開いた所） */
  const [picking, setPicking] = useState<{ field: TaskDateField; anchor: HTMLElement } | null>(null)
  const [requesterEditing, setRequesterEditing] = useState(false)
  useListPopup(dateMenu !== null || picking !== null, () => {
    setDateMenu(null)
    setPicking(null)
  })
  const titleEdit = useInlineEdit({ value: item.title, onSave: (t) => saveTaskTitle(item.id, t) })
  const editing = titleEdit.editing || requesterEditing

  /** 「…」（M・S の［日付…］・［日付を決める］の小窓は、ここに付けて開く） */
  const moreButton = (): HTMLElement | null => row.current?.querySelector<HTMLElement>('.list-row-more') ?? null

  const menuItems = (): PopupMenuItem[] => {
    const items: PopupMenuItem[] = [{ label: '詳しく', onSelect: () => sheets.openTaskDetail(item.id) }]
    if (!wide) {
      items.push({
        label: '日付…',
        ariaLabel: '日付を直す',
        onSelect: () => setDateMenu(moreButton()),
      })
    }
    if (view.canDecideDate) {
      items.push({
        label: '日付を決める',
        onSelect: () => {
          const anchor = moreButton()
          if (anchor) setPicking({ field: 'due', anchor })
        },
      })
    }
    if (view.canUnlist) items.push({ label: 'Task List から外す', onSelect: () => unlistTask(item) })
    items.push({ label: '削除', danger: true, onSelect: () => void removeTask(item) })
    return items
  }

  const startRequester = () => {
    // 押した出来事の中で欄を出してフォーカスする（iPhone でもキーボードが出る。P3）
    flushSync(() => setRequesterEditing(true))
  }

  const onTitleChange = (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    // 件名は 200字まで（コードポイントで数える。上限を超えて打てない・貼れない）
    const limited = limitChars(e.target.value, LIMITS.title)
    if (limited !== e.target.value) e.target.value = limited
    titleEdit.inputProps.onChange(e)
  }

  const titleNode = titleEdit.editing ? (
    <input
      {...titleEdit.inputProps}
      onChange={onTitleChange}
      type="text"
      className="input task-title-input"
      aria-label="件名"
      autoComplete="off"
      enterKeyHint="done"
      data-testid={listTestIds.rowEdit('task', item.id)}
    />
  ) : (
    <button
      type="button"
      className={cls('task-title', view.done && 'is-done')}
      data-kind={kind}
      onClick={titleEdit.start}
      data-testid={listTestIds.rowTitle('task', item.id)}
    >
      <span className="task-title-clamp">
        <span className={cls('task-title-text', !view.done && 'kind-marker')}>{title}</span>
      </span>
    </button>
  )

  const kindButton = (
    <button
      type="button"
      className="task-kind"
      aria-label={`区分: ${KIND_NAME[kind]}（押すと${KIND_NAME[kind === 'work' ? 'private' : 'work']}にする）`}
      title={`区分: ${KIND_NAME[kind]}`}
      onClick={() => toggleTaskKind(item)}
      data-testid={listTestIds.taskKind(item.id)}
    >
      <KindIcon kind={kind} />
    </button>
  )

  const check = (
    <DotCheck
      done={view.done}
      name={name}
      className="task-check"
      onToggle={() => toggleTaskDone(item)}
      data-testid={listTestIds.rowCheck('task', item.id)}
    />
  )

  let body
  if (wide) {
    const d = view.date
    body = (
      <>
        <button
          type="button"
          className="task-date mono"
          aria-label={`日付（${d.aria}）`}
          aria-haspopup="menu"
          aria-expanded={dateMenu !== null}
          data-overdue={view.overdue || undefined}
          data-today={view.today || undefined}
          data-faint={d.faint || undefined}
          data-case={view.case}
          onClick={(e) => {
            const anchor = e.currentTarget
            setDateMenu((a) => (a ? null : anchor))
          }}
          data-testid={listTestIds.taskDate(item.id)}
        >
          {d.sub ? <span className="task-date-sub">{d.sub}</span> : null}
          <span className="task-date-main">{d.main}</span>
        </button>
        {requesterEditing ? (
          <span className="task-requester-edit">
            <RequesterInput
              initial={requester}
              label="依頼者"
              testId={taskTestIds.requesterEdit(item.id)}
              onCommit={(next) => {
                setRequesterEditing(false)
                if (next !== requester) saveTaskRequester(item.id, next)
              }}
              onCancel={() => setRequesterEditing(false)}
            />
          </span>
        ) : (
          <>
            {requester ? (
              <button
                type="button"
                className="task-requester ellipsis"
                aria-label={`依頼者: ${requester}（押すと直す）`}
                title={requester}
                onClick={startRequester}
                data-testid={listTestIds.taskRequester(item.id)}
              >
                {requester}
              </button>
            ) : null}
            <span className="task-title-cell">{titleNode}</span>
          </>
        )}
      </>
    )
  } else {
    const parts = taskStackedParts(item)
    body = (
      <span className="task-main">
        {parts.date || parts.requester ? (
          <span className="task-line" data-testid={listTestIds.taskLine(item.id)}>
            {parts.date ? (
              <span className="task-line-date mono" data-overdue={view.overdue || undefined} data-today={view.today || undefined}>
                {parts.date}
              </span>
            ) : null}
            {parts.date && parts.requester ? '・' : null}
            {parts.requester ? <span className="task-line-requester">{parts.requester}</span> : null}
          </span>
        ) : null}
        {titleNode}
      </span>
    )
  }

  // メニュー・小窓は行の外に置く（body へ出す物なので画面の上の位置は同じ。行に付ける出来事（掴む所）へ、メニューの中を押した
  // 出来事が届かないように）
  return (
    <>
      <ListRow
        {...drag.rowProps}
        list="task"
        id={item.id}
        done={view.done}
        editing={editing}
        flash={listFlashKey.row('task', item.id)}
        dragRef={rowRef}
        className={cls(
          'task-row',
          wide ? 'is-wide' : 'is-stacked',
          wide && requester && !requesterEditing && 'has-requester',
          requesterEditing && 'is-editing-requester',
          drag.isDragging && 'is-dragging',
        )}
        menu={<RowMenu list="task" id={item.id} name={name} items={menuItems} />}
      >
        {kindButton}
        {check}
        {body}
      </ListRow>
      {dateMenu ? (
        <TaskDateMenu
          item={item}
          today={today}
          anchor={dateMenu}
          name={name}
          onClose={() => setDateMenu(null)}
          onPick={(field) => setPicking({ field, anchor: dateMenu })}
        />
      ) : null}
      {picking ? (
        <TaskDatePicker item={item} field={picking.field} anchor={picking.anchor} onClose={() => setPicking(null)} />
      ) : null}
    </>
  )
})
