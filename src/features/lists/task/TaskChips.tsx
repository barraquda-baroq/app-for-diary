// Task List の入力欄の下の小さなボタン［開始日］［締め切り日］［依頼者］（docs/SPEC.md の 13.2・12.2・6.3・4.11）。
// - ［開始日］: 今日・明日・日付を選ぶ。［締め切り日］: 今日・明日・今週金曜（土曜は「来週金曜」で次の金曜。listText.fridayOf）・日付を選ぶ。
//   メニューは NS の PopupMenu、［日付を選ぶ］は小さな月のカレンダー（L・M はボタンの下の小窓、S は下からのシート。fields/MiniMonth の
//   DatePicker）。開始日を締め切り日より後にすると締め切り日も、締め切り日を開始日より前にすると開始日もそろえる（6.3。taskEntryWithDates）。
//   締め切りは日付だけ（時刻は詳細で入れる）
// - ［依頼者］: 押すとその場に小さな入力欄（候補付き。task/RequesterInput）が開く。Enter・候補・離れると決まる
// - 決めた値はボタンの字がチップ「開始 11/10」「〆 11/20」「営業部」になり、右の［×］で外せる（押すとまた選び直せる）。
//   どれも書きかけ（diary-studio:draft:task）に入り、読み込み直しても戻る。足すと空に戻る（common/useListInput）
// - ■34 で打ちかけを捨てる時（common/listDraft の discardListDraft）は、開いているメニュー・小窓・依頼者の欄も閉じ、依頼者の欄の字は
//   決めずに捨てる。メニュー・小窓が開いている時の「戻る」（端からのフリックも）は、それだけを閉じる（打ちかけは残す。common/listPopups。
//   3.1・開発）
// 指の端末・S・M では、ボタン・［×］・候補を 34px 以上にする（4.11。task.css）
import { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { chipLabel } from '../../../domain/listText'
import { taskChipOptions, taskEntryWithDates, type TaskDateField } from '../../../domain/taskList'
import { XIcon } from '../../../ui/icons'
import { PopupMenu } from '../../../ui/PopupMenu'
import { DatePicker } from '../../item/fields/MiniMonth'
import { registerDraftClear } from '../common/listDraft'
import { useListPopup } from '../common/listPopups'
import { listTestIds } from '../common/testIds'
import type { ListInputApi } from '../common/useListInput'
import { RequesterInput } from './RequesterInput'
import { taskTestIds } from './taskTestIds'
import './task.css'

export interface TaskChipsProps {
  input: ListInputApi
  /** 今日（Task List の中身の useToday。今週金曜・今日・明日に使う） */
  today: string
}

/** 欄の名前（メニュー・小さな月のカレンダーの題） */
export const TASK_DATE_CAPTION: Record<TaskDateField, string> = { start: '開始日', due: '締め切り日' }

interface Open {
  field: TaskDateField
  anchor: HTMLElement
}

export function TaskChips({ input, today }: TaskChipsProps) {
  const { draft } = input
  const [menu, setMenu] = useState<Open | null>(null)
  const [picking, setPicking] = useState<Open | null>(null)
  const [requesterOpen, setRequesterOpen] = useState(false)
  /** ■34 で捨てた後（開いていた依頼者の欄が離れる時に、捨てた字を書きかけへ戻さない） */
  const dropped = useRef(false)
  const latest = useRef(input)
  latest.current = input
  useListPopup(menu !== null || picking !== null, () => {
    setMenu(null)
    setPicking(null)
  })

  useEffect(
    () =>
      registerDraftClear('task', () => {
        dropped.current = true
        setRequesterOpen(false)
        setMenu(null)
        setPicking(null)
      }),
    [],
  )

  /** 日付を選んだ・外した（6.3 のそろえ方を当てて、開始日と締め切り日だけを替える） */
  const setDates = (edit: { start?: string | null; due?: string | null }) => {
    const cur = latest.current
    const next = taskEntryWithDates(cur.draft, edit)
    cur.setDraft({ start: next.start, due: next.due })
  }

  const dateChip = (field: TaskDateField) => {
    const value = draft[field]
    const caption = TASK_DATE_CAPTION[field]
    return (
      <span className={`task-chip${value ? ' is-set' : ''}`}>
        <button
          type="button"
          className="btn btn-sm btn-ghost task-chip-btn"
          aria-haspopup="menu"
          aria-expanded={menu?.field === field}
          aria-label={value ? `${caption}（${chipLabel(field, value)}）を選び直す` : `${caption}を選ぶ`}
          onClick={(e) => {
            const anchor = e.currentTarget
            setMenu((m) => (m?.field === field ? null : { field, anchor }))
          }}
          data-testid={listTestIds.taskChip(field)}
        >
          {value ? <span className="mono">{chipLabel(field, value)}</span> : caption}
        </button>
        {value ? (
          <button
            type="button"
            className="icon-btn task-chip-clear"
            aria-label={`${caption}を外す`}
            title={`${caption}を外す`}
            onClick={() => setDates({ [field]: null })}
            data-testid={taskTestIds.chipClear(field)}
          >
            <XIcon />
          </button>
        ) : null}
      </span>
    )
  }

  const openRequester = () => {
    dropped.current = false
    // 押した出来事の中で欄を出してフォーカスする（iPhone でもキーボードが出る。P3）
    flushSync(() => setRequesterOpen(true))
  }

  const requesterChip = () => {
    if (requesterOpen) {
      return (
        <span className="task-chip is-editing">
          <RequesterInput
            initial={draft.requester}
            label="依頼者"
            className="task-chip-requester"
            testId={taskTestIds.chipRequesterInput}
            onCommit={(requester, how) => {
              if (dropped.current) return
              setRequesterOpen(false)
              latest.current.setDraft({ requester })
              // Enter・候補で決めた時は、続けて打てるよう件名の欄へ戻す（離れて決めた時は動かさない）
              if (how !== 'blur') latest.current.focus()
            }}
            onCancel={() => {
              setRequesterOpen(false)
              latest.current.focus()
            }}
          />
        </span>
      )
    }
    const value = draft.requester
    return (
      <span className={`task-chip${value ? ' is-set' : ''}`}>
        <button
          type="button"
          className="btn btn-sm btn-ghost task-chip-btn"
          aria-label={value ? `依頼者（${value}）を直す` : '依頼者を入れる'}
          onClick={openRequester}
          data-testid={listTestIds.taskChip('requester')}
        >
          {value ? <span className="task-chip-name">{value}</span> : '依頼者'}
        </button>
        {value ? (
          <button
            type="button"
            className="icon-btn task-chip-clear"
            aria-label="依頼者を外す"
            title="依頼者を外す"
            onClick={() => latest.current.setDraft({ requester: '' })}
            data-testid={taskTestIds.chipClear('requester')}
          >
            <XIcon />
          </button>
        ) : null}
      </span>
    )
  }

  return (
    <>
      {dateChip('start')}
      {dateChip('due')}
      {requesterChip()}
      {menu ? (
        <PopupMenu
          label={TASK_DATE_CAPTION[menu.field]}
          items={taskChipOptions(menu.field, today).map((o) => ({
            label: o.label,
            ariaLabel: o.action.type === 'pick' ? `${TASK_DATE_CAPTION[menu.field]}を選ぶ` : undefined,
            onSelect: () => {
              const a = o.action
              if (a.type === 'set') setDates({ [a.field]: a.date })
              else if (a.type === 'pick') setPicking({ field: a.field, anchor: menu.anchor })
            },
          }))}
          placement={{ anchor: menu.anchor }}
          returnFocus={menu.anchor}
          onClose={() => setMenu(null)}
          testId={`task-chip-${menu.field}-menu`}
        />
      ) : null}
      {picking ? (
        <DatePicker
          caption={TASK_DATE_CAPTION[picking.field]}
          anchor={picking.anchor}
          value={draft[picking.field]}
          other={draft[picking.field === 'start' ? 'due' : 'start']}
          onPick={(date) => setDates({ [picking.field]: date })}
          onClose={() => setPicking(null)}
        />
      ) : null}
    </>
  )
}
