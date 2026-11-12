// 日付の欄「開始日」〜「締め切り日」（docs/SPEC.md の 12.2 の 4・12.3・12.4・12.7・4.4）。日付は日本語の「11月10日（火）」（ui の書体のまま、
// 数字の桁だけそろえる）。押すと小さな月のカレンダー（L・M は下に開く小窓、S はシート。D38。fields/MiniMonth.tsx の DatePicker）を開き、
// 選んだ日を onChange で渡す（そろえ方・断り方は包む画面の editDates・duplicateDates。6.3・6.4）。
// 締め切り日の欄の下に「空なら1日だけ」（calendar 生まれだけ）、入れた時は［×］で消せる。開始日は、登録の画面と calendar 生まれは
// 消せず（［×］を出さない）、list 生まれの詳細と複製は消せる（ITEMS-171・173・210・256）。
// 欄の下に、日付にできなかった理由（6.4。--text-muted）と、list 生まれのタスクが今どう出るかの1行（12.3）を出す所も持つ
import { useId, useState } from 'react'
import { jaDateLabel } from '../../../domain/dates'
import { CalendarIcon, XIcon } from '../../../ui/icons'
import { cls } from '../../calendar/common/parts/itemLook'
import { testIds } from '../../calendar/common/testIds'
import { DatePicker } from './MiniMonth'

export type DateWhich = 'start' | 'due'

export interface DateFieldsProps {
  start: string | null
  due: string | null
  /** 開始日を［×］で消せる（list 生まれの詳細・複製） */
  startClearable: boolean
  /** 締め切り日の欄の下の字（calendar 生まれは「空なら1日だけ」。無ければ null） */
  dueNote: string | null
  /** 小さな月のカレンダーで選んだ日（date）・［×］で消した（null） */
  onChange: (which: DateWhich, date: string | null) => void
  /** 日付にできなかった理由（6.4。無ければ null） */
  error?: string | null
  /** list 生まれのタスクが今カレンダーにどう出るかの1行（12.3。無ければ null） */
  statusLine?: string | null
  /** 欄の data-testid（複製する日を選ぶ小さな画面は dup-start・dup-due。既定は登録・詳細の物） */
  ids?: { start: string; due: string; dueClear?: string; error?: string; status?: string }
}

const CAPTION: Record<DateWhich, string> = { start: '開始日', due: '締め切り日' }
const DEFAULT_IDS = {
  start: testIds.itemStart,
  due: testIds.itemDue,
  dueClear: testIds.itemDueClear,
  error: testIds.itemDateError,
  status: testIds.itemStatusLine,
}

export function DateFields({
  start,
  due,
  startClearable,
  dueNote,
  onChange,
  error,
  statusLine,
  ids = DEFAULT_IDS,
}: DateFieldsProps) {
  const id = useId()
  /** 開いている小さな月のカレンダー（どちらの欄の・その欄の要素） */
  const [picking, setPicking] = useState<{ which: DateWhich; anchor: HTMLElement } | null>(null)
  const value = (which: DateWhich) => (which === 'start' ? start : due)
  const field = (which: DateWhich, clearable: boolean) => {
    const v = value(which)
    return (
      <div className={cls('it-date-wrap', which === 'start' ? 'it-a' : 'it-b', clearable && 'is-clearable')}>
        <button
          type="button"
          className={cls('it-date', v === null && 'is-empty')}
          aria-labelledby={`${id}-${which} ${id}-${which}-value`}
          aria-haspopup="dialog"
          aria-expanded={picking?.which === which}
          onClick={(e) => {
            const anchor = e.currentTarget
            setPicking((p) => (p?.which === which ? null : { which, anchor }))
          }}
          data-testid={which === 'start' ? ids.start : ids.due}
        >
          <CalendarIcon />
          <span id={`${id}-${which}-value`}>{v === null ? 'なし' : jaDateLabel(v)}</span>
        </button>
        {clearable ? (
          <button
            type="button"
            className="icon-btn it-clear"
            aria-label={`${CAPTION[which]}を消す`}
            title={`${CAPTION[which]}を消す`}
            onClick={() => onChange(which, null)}
            data-testid={which === 'due' ? ids.dueClear : undefined}
          >
            <XIcon />
          </button>
        ) : null}
      </div>
    )
  }
  return (
    <div className="it-pair" role="group" aria-label="日付">
      <span className="it-cap it-a" id={`${id}-start`}>
        {CAPTION.start}
      </span>
      <span className="it-cap it-b" id={`${id}-due`}>
        {CAPTION.due}
      </span>
      {field('start', startClearable && start !== null)}
      <span className="it-sep" aria-hidden="true">
        〜
      </span>
      {field('due', due !== null)}
      {dueNote ? <span className="it-note it-b">{dueNote}</span> : null}
      {error ? (
        <p className="it-note it-wide" role="alert" data-testid={ids.error}>
          {error}
        </p>
      ) : null}
      {statusLine ? (
        <p className="it-note it-wide" role="status" data-testid={ids.status}>
          {statusLine}
        </p>
      ) : null}
      {picking ? (
        <DatePicker
          caption={CAPTION[picking.which]}
          anchor={picking.anchor}
          value={value(picking.which)}
          other={value(picking.which === 'start' ? 'due' : 'start')}
          onPick={(date) => onChange(picking.which, date)}
          onClose={() => setPicking(null)}
        />
      ) : null}
    </div>
  )
}
