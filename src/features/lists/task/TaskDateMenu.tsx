// Task List の日付のメニュー（docs/SPEC.md の 13.5・6.3・6.4・3.1）。L は行の日付の列を押すと、M・S は「…」の［日付…］から開く
// （小さな上の行は指で押すには小さいので。開発）。中身は domain の taskDateMenu:
// - 締め切り日を 今日・明日・今週金曜（土曜は来週金曜）・日付を選ぶ・なし（calendar 生まれは「1日の予定にする（締め切り日を消す）」）
// - 開始日を 日付を選ぶ・なし（calendar 生まれは「なし」を出さない）
// - ［カレンダーで見る］（カレンダーに出ている時。期間の終わり to の日のデイリーへ、履歴を置き換えて移る。履歴は増えない。3.1）
// 直すのは task/taskOps の editTaskDates（6.4 で断られた時は理由を 4秒出して値はそのまま。開発）。［日付を選ぶ］は小さな月のカレンダー
// （TaskDatePicker。L・M は押した所の下の小窓、S は下からのシート）。メニューは NS の PopupMenu（ページのどこかがスクロールすると閉じる）。
// data-testid は task-date-menu（common/testIds.ts の listTestIds.taskDateMenu）
import { taskDateMenu, type TaskDateField, type TaskDateOption } from '../../../domain/taskList'
import type { Item } from '../../../domain/types'
import { getData } from '../../../store/appStore'
import { PopupMenu, type PopupMenuItem } from '../../../ui/PopupMenu'
import { useCalendarNav } from '../../calendar/common/useCalendarRoute'
import { DatePicker } from '../../item/fields/MiniMonth'
import { listTestIds } from '../common/testIds'
import { TASK_DATE_CAPTION } from './TaskChips'
import { editTaskDates } from './taskOps'

/** 今の記録（メニュー・小窓を開いている間に、ほかの所で直っていても今の物で直す） */
const current = (item: Item): Item => getData().items[item.id] ?? item

/** メニューの1つの字（締め切り日・開始日のどちらの物か分かるように、欄の名前を前に付ける。「1日の予定にする…」はそのまま） */
function optionLabel(field: TaskDateField | null, o: TaskDateOption): string {
  if (!field || o.label.includes(TASK_DATE_CAPTION[field])) return o.label
  return `${TASK_DATE_CAPTION[field]} ${o.label}`
}

/** 読み上げの名前（「締め切り日を今日にする」など） */
function optionAria(o: TaskDateOption): string | undefined {
  const a = o.action
  switch (a.type) {
    case 'set':
      return `${TASK_DATE_CAPTION[a.field]}を${o.label}にする`
    case 'pick':
      return `${TASK_DATE_CAPTION[a.field]}を選ぶ`
    case 'clear':
      return o.label.includes(TASK_DATE_CAPTION[a.field]) ? undefined : `${TASK_DATE_CAPTION[a.field]}を消す`
    default:
      return undefined
  }
}

export interface TaskDateMenuProps {
  item: Item
  today: string
  /** 開いた所（L は日付の列、M・S は「…」） */
  anchor: HTMLElement
  /** 読み上げ・題に入れる名前（件名を 20字まで） */
  name: string
  onClose: () => void
  /** ［日付を選ぶ］を押した（小さな月のカレンダーを開く） */
  onPick: (field: TaskDateField) => void
}

export function TaskDateMenu({ item, today, anchor, name, onClose, onPick }: TaskDateMenuProps) {
  const nav = useCalendarNav()
  const model = taskDateMenu(item, today)
  const run = (o: TaskDateOption) => {
    const a = o.action
    switch (a.type) {
      case 'set':
        editTaskDates(current(item), { [a.field]: a.date })
        break
      case 'clear':
        editTaskDates(current(item), { [a.field]: null })
        break
      case 'pick':
        onPick(a.field)
        break
      case 'show':
        nav.openDay(a.date)
        break
    }
  }
  const entry = (field: TaskDateField | null, o: TaskDateOption): PopupMenuItem => ({
    label: optionLabel(field, o),
    ariaLabel: optionAria(o),
    onSelect: () => run(o),
  })
  const items: PopupMenuItem[] = [
    ...model.due.map((o) => entry('due', o)),
    ...model.start.map((o) => entry('start', o)),
    ...(model.show ? [entry(null, model.show)] : []),
  ]
  return (
    <PopupMenu
      label={`『${name}』の日付`}
      items={items}
      placement={{ anchor }}
      returnFocus={anchor}
      onClose={onClose}
      testId={listTestIds.taskDateMenu}
    />
  )
}

export interface TaskDatePickerProps {
  item: Item
  field: TaskDateField
  anchor: HTMLElement
  onClose: () => void
}

/**
 * 日付の列のメニューの［日付を選ぶ］と、「…」の［日付を決める］（list 生まれの①④。選んだ日が締め切り日になる。13.5）の小さな月の
 * カレンダー。選んだ日で editTaskDates（6.3 のそろえ方・6.4 で断る時は理由を出して値はそのまま）
 */
export function TaskDatePicker({ item, field, anchor, onClose }: TaskDatePickerProps) {
  return (
    <DatePicker
      caption={TASK_DATE_CAPTION[field]}
      anchor={anchor}
      value={item[field]}
      other={item[field === 'start' ? 'due' : 'start']}
      onPick={(date) => void editTaskDates(current(item), { [field]: date })}
      onClose={onClose}
    />
  )
}
