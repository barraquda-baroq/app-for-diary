// 日付の欄「開始日」〜「締め切り日」（docs/SPEC.md の 12.2 の 3・12.3・12.4・4.4）。日付は日本語の「11月10日（火）」（ui の書体のまま、
// 数字の桁だけそろえる）。押すと小さな月のカレンダー（L・M は下に開く小窓、S はシート。D38）を開く所は WP9 の後半（onPick）。
// 締め切り日の欄の下に「空なら1日だけ」（calendar 生まれだけ）、入れた時は［×］で消せる。開始日は、登録の画面と calendar 生まれは
// 消せず（［×］を出さない）、list 生まれの詳細だけ消せる（ITEMS-171・173・210）。
// 欄の下に、日付にできなかった理由（6.4。--text-muted）と、list 生まれのタスクが今どう出るかの1行（12.3）を出す所も持つ
import { useId } from 'react'
import { jaDateLabel } from '../../../domain/dates'
import { CalendarIcon, XIcon } from '../../../ui/icons'
import { cls } from '../../calendar/common/parts/itemLook'
import { testIds } from '../../calendar/common/testIds'

export type DateWhich = 'start' | 'due'

export interface DateFieldsProps {
  start: string | null
  due: string | null
  /** 開始日を［×］で消せる（list 生まれの詳細だけ） */
  startClearable: boolean
  /** 締め切り日の欄の下の字（calendar 生まれは「空なら1日だけ」。無ければ null） */
  dueNote: string | null
  /** ［×］で消した */
  onClear: (which: DateWhich) => void
  /** 欄を押した（小さな月のカレンダーを開く。WP9 の後半） */
  onPick?: (which: DateWhich, anchor: HTMLElement) => void
  /** 日付にできなかった理由（6.4。無ければ null） */
  error?: string | null
  /** list 生まれのタスクが今カレンダーにどう出るかの1行（12.3。無ければ null） */
  statusLine?: string | null
}

const CAPTION: Record<DateWhich, string> = { start: '開始日', due: '締め切り日' }
const TEST_ID: Record<DateWhich, string> = { start: testIds.itemStart, due: testIds.itemDue }

export function DateFields({ start, due, startClearable, dueNote, onClear, onPick, error, statusLine }: DateFieldsProps) {
  const id = useId()
  const field = (which: DateWhich, value: string | null, clearable: boolean) => (
    <div className={cls('it-date-wrap', which === 'start' ? 'it-a' : 'it-b', clearable && 'is-clearable')}>
      <button
        type="button"
        className={cls('it-date', value === null && 'is-empty')}
        aria-labelledby={`${id}-${which} ${id}-${which}-value`}
        onClick={(e) => onPick?.(which, e.currentTarget)}
        data-testid={TEST_ID[which]}
      >
        <CalendarIcon />
        <span id={`${id}-${which}-value`}>{value === null ? 'なし' : jaDateLabel(value)}</span>
      </button>
      {clearable ? (
        <button
          type="button"
          className="icon-btn it-clear"
          aria-label={`${CAPTION[which]}を消す`}
          title={`${CAPTION[which]}を消す`}
          onClick={() => onClear(which)}
          data-testid={which === 'due' ? testIds.itemDueClear : undefined}
        >
          <XIcon />
        </button>
      ) : null}
    </div>
  )
  return (
    <div className="it-pair" role="group" aria-label="日付">
      <span className="it-cap it-a" id={`${id}-start`}>
        {CAPTION.start}
      </span>
      <span className="it-cap it-b" id={`${id}-due`}>
        {CAPTION.due}
      </span>
      {field('start', start, startClearable && start !== null)}
      <span className="it-sep" aria-hidden="true">
        〜
      </span>
      {field('due', due, due !== null)}
      {dueNote ? <span className="it-note it-b">{dueNote}</span> : null}
      {error ? (
        <p className="it-note it-wide" role="alert" data-testid={testIds.itemDateError}>
          {error}
        </p>
      ) : null}
      {statusLine ? (
        <p className="it-note it-wide" data-testid={testIds.itemStatusLine}>
          {statusLine}
        </p>
      ) : null}
    </div>
  )
}
