// 登録・詳細の画面の欄（docs/SPEC.md の 12.2・12.3）。並びはどちらも 件名 → 区分 → 日付 → 時刻 → 詳しく（ラベルの色・依頼者・ロック・
// Task List にも出す・メモ）。真ん中の小さな画面・下からのシート・段階3の右の列のパネルのどれにも入れられるよう、この部品は
// 小さな画面（Modal）を知らず、欄の値（value）と、欄を直した時に呼ぶ物だけを受け取る（FRAME-052）。
// 欄を直した時の決まりは包む画面が当てる: 日付は onDates（editDates）、時刻は onTimes（editTimes）、ほかは onChange
// （欄ごとに1回。最後に直した欄の決まりで決める。AMB-ITEMS-29）。詳細の画面の自動の保存も包む画面（WP9 の後半）
import { useId } from 'react'
import type { AppData } from '../../domain/types'
import { DateFields, type DateWhich } from './fields/DateFields'
import { DetailsFold } from './fields/DetailsFold'
import { KindSwitch } from './fields/KindSwitch'
import { LabelPicker } from './fields/LabelPicker'
import { MemoField } from './fields/MemoField'
import { RequesterField } from './fields/RequesterField'
import { SwitchRow } from './fields/SwitchRow'
import { TimeFields, type TimeWhich } from './fields/TimeFields'
import { TitleField } from './fields/TitleField'
import { testIds } from '../calendar/common/testIds'
import type { DatePatch, FieldPatch, ItemForm, TimePatch } from './itemForm'
import './item.css'

export interface DetailFormProps {
  /** register = 登録の画面、detail = 詳細の画面（開始日の［×］など、違う所だけに使う） */
  mode: 'register' | 'detail'
  value: ItemForm
  /** ラベルの呼び名（6.6。付けた呼び名を色を選ぶ所に出す） */
  labelNames: AppData['labelNames']
  /** 「詳しく」を開いているか */
  detailsOpen: boolean
  onToggleDetails: () => void
  /** 件名・区分・ラベル・依頼者・ロック・Task List にも出す・メモを直した */
  onChange: (patch: FieldPatch) => void
  /** 日付の欄を決めた（［×］で消した・小さな月のカレンダーで選んだ） */
  onDates: (patch: DatePatch) => void
  /** 時刻の欄を決めた */
  onTimes: (patch: TimePatch) => void

  // ----- WP9 の後半で使う所（今は渡さなくてよい） -----
  /** 文字の欄（件名・依頼者・メモ）を離れた（詳細の画面で保存する） */
  onTextCommit?: () => void
  /** 日付の欄を押した（小さな月のカレンダーを開く。D38） */
  onPickDate?: (which: DateWhich, anchor: HTMLElement) => void
  /** 時刻の欄を押した（5分刻みの一覧を開く） */
  onOpenTimeList?: (which: TimeWhich, anchor: HTMLElement) => void
  /** 日付にできなかった理由（DATE_REFUSED など） */
  dateError?: string | null
  /** list 生まれのタスクが今カレンダーにどう出るかの1行（listStatusLine） */
  statusLine?: string | null
  /** 翌日までにした時の「翌日 02:00 まで」 */
  timeHint?: string | null
  /** 時刻を入れられない理由（list 生まれでカレンダーに出ていない時） */
  timesDisabledNote?: string | null
  /** 「Task List にも出す」を押せない（list 生まれでカレンダーに出ていない時。6.3） */
  listedDisabled?: boolean
  /** 件名が空の時に出す字（件名が空の記録の詳細では「（件名なし）」。D48） */
  titlePlaceholder?: string
}

export function DetailForm(p: DetailFormProps) {
  const { value: v, onChange } = p
  const id = useId()
  return (
    <div className="it-form">
      <div className="it-field">
        <label className="it-field-label" htmlFor={`${id}-title`}>
          件名
        </label>
        <TitleField
          id={`${id}-title`}
          value={v.title}
          onChange={(title) => onChange({ title })}
          placeholder={p.titlePlaceholder}
          onCommit={p.onTextCommit}
        />
      </div>
      <div className="it-field">
        <span className="it-field-label" id={`${id}-kind`}>
          区分
        </span>
        <KindSwitch value={v.kind} onChange={(kind) => onChange({ kind })} labelledBy={`${id}-kind`} />
      </div>
      <DateFields
        start={v.start}
        due={v.due}
        startClearable={p.mode === 'detail' && v.origin === 'list'}
        dueNote={v.origin === 'calendar' ? '空なら1日だけ' : null}
        onClear={(which) => p.onDates({ [which]: null })}
        onPick={p.onPickDate}
        error={p.dateError}
        statusLine={p.statusLine}
      />
      <TimeFields
        startTime={v.startTime}
        endTime={v.endTime}
        onTimes={p.onTimes}
        onOpenList={p.onOpenTimeList}
        hint={p.timeHint}
        disabledNote={p.timesDisabledNote}
      />
      <DetailsFold open={p.detailsOpen} onToggle={p.onToggleDetails}>
        <LabelPicker
          value={v.label}
          labelNames={p.labelNames}
          onChange={(label) => onChange({ label })}
          labelId={`${id}-label`}
        />
        <RequesterField
          id={`${id}-requester`}
          value={v.requester}
          onChange={(requester) => onChange({ requester })}
          onCommit={p.onTextCommit}
        />
        <div className="it-switches">
          <SwitchRow label="ロック" checked={v.locked} onChange={(locked) => onChange({ locked })} testId={testIds.itemLock} />
          <SwitchRow
            label="Task List にも出す"
            checked={v.listed}
            disabled={p.listedDisabled}
            onChange={(listed) => onChange({ listed })}
            testId={testIds.itemListed}
          />
        </div>
        <MemoField id={`${id}-memo`} value={v.memo} onChange={(memo) => onChange({ memo })} onCommit={p.onTextCommit} />
      </DetailsFold>
    </div>
  )
}
