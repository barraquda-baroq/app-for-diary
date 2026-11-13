// 複製する日を選ぶ小さな画面（docs/SPEC.md の 12.7・3.8・3.9。D45・AMB-ITEMS-22・32）。詳細の［複製］で開き、詳細の上に重ねる
// （L は真ん中、M・S は下からのシート。履歴には積まない。Esc・背景・［×］はこの画面だけを閉じ、詳細はそのまま）。
// - 中は元の予定と同じ日付の欄（開始日〜締め切り日）で、最初は空。calendar 生まれは開始日が必須（選ぶまで［複製する］を押せない）、
//   list 生まれは開始日・締め切り日とも任意（6.3 の4通りのとおりに出る。今どう出るかの1行も出す）
// - 開始日を選ぶと、元が複数日の予定なら締め切り日を元と同じ日数になるよう入れる（直せる。duplicateDates）。締め切り日を開始日より前に
//   すると開始日もそろえる（6.3）
// - 写す時刻で 1日の予定の終了 < 開始になる日付は［複製する］を押せなくし、6.4 の理由（DATE_REFUSED）を出す（ITEMS-259）
// - ［複製する］で新しい項目を作り（src/domain/ops.ts の duplicateItem。完了は写さない）、閉じて「11/17（火）に複製しました［開く］」
//   （6秒。期間の初めの日。カレンダーに出ない list 生まれは「Task List に複製しました［開く］」）。［開く］で新しい予定の詳細へ。
//   複製したことは元に戻す・やり直すの並びに積む（詳細の中で直していた所は、その前に1つにまとめて積む。7.13）
import { useState } from 'react'
import { duplicateDates, editDates } from '../../domain/itemInput'
import { periodOf } from '../../domain/items'
import { listStatusLine, toastText, undoText } from '../../domain/itemText'
import type { Item } from '../../domain/types'
import { actions } from '../../store/actions'
import { getData } from '../../store/appStore'
import { attempt, notify } from '../../store/uiStore'
import { itemChange, recordStep } from '../../store/undoStore'
import { displayTitle } from '../calendar/common/parts/itemLook'
import { Modal } from '../../ui/Modal'
import { useItemSheets } from '../calendar/common/sheets'
import { testIds } from '../calendar/common/testIds'
import { DateFields, type DateWhich } from './fields/DateFields'
import { whenOf } from './itemForm'
import './item.css'

/** 複製の後のお知らせのボタン（3.9） */
export const OPEN_LABEL = '開く'
/** 複製する日を選ぶ小さな画面の data-testid */
export const DUP_TEST_IDS = { dialog: 'dup-dialog', error: 'dup-date-error', status: 'dup-status-line' } as const

/** 開始日を選ぶまで［複製する］を押せない時に添える字（calendar 生まれ） */
export const DUP_NEED_START = '開始日を選ぶと複製できます'

export interface DuplicateDialogProps {
  item: Item
  onClose: () => void
}

type Dates = { start: string | null; due: string | null }

export function DuplicateDialog({ item, onClose }: DuplicateDialogProps) {
  const { openDetail } = useItemSheets()
  const [dates, setDates] = useState<Dates>({ start: null, due: null })
  const src = whenOf(item)
  // 写す時刻とこの日付で、決まりに合うか（1日の予定で終了 < 開始なら DATE_REFUSED）
  const check = editDates({ ...src, ...dates }, {})
  const refused = check.ok ? null : check.message
  const needStart = item.origin === 'calendar' && dates.start === null
  const canSubmit = !needStart && refused === null

  const onChange = (which: DateWhich, date: string | null) => {
    if (which === 'start') {
      setDates((d) => (date === null ? { ...d, start: null } : duplicateDates(src, date, d.due)))
      return
    }
    if (date === null) {
      setDates((d) => ({ ...d, due: null }))
      return
    }
    // 締め切り日を開始日より前にした時は開始日もそろえる（時刻は見ない: 断るのは［複製する］の所で）
    setDates((d) => {
      const r = editDates({ origin: item.origin, start: d.start, due: d.due, startTime: null, endTime: null }, { due: date })
      return r.ok ? { start: r.when.start, due: r.when.due } : d
    })
  }

  const submit = () => {
    if (!canSubmit) return
    const newId = attempt(() => actions.duplicateItem(item.id, dates))
    if (newId === undefined) return
    recordStep(undoText.duplicated(displayTitle(item)), [itemChange(newId, null, getData().items[newId])])
    onClose()
    const first = periodOf({ origin: item.origin, ...dates })?.from ?? null
    notify(toastText.duplicated(first), { label: OPEN_LABEL, run: () => openDetail(newId) })
  }

  return (
    <Modal
      title="複製する日を選ぶ"
      onClose={onClose}
      className="it-dup"
      testId={DUP_TEST_IDS.dialog}
      initialFocus={`[data-testid="${testIds.dupStart}"]`}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            やめる
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!canSubmit}
            onClick={submit}
            data-testid={testIds.dupSubmit}
          >
            複製する
          </button>
        </>
      }
    >
      <div className="it-form">
        <DateFields
          start={dates.start}
          due={dates.due}
          startClearable={item.origin === 'list'}
          dueNote={item.origin === 'calendar' ? '空なら1日だけ' : null}
          onChange={onChange}
          error={refused}
          statusLine={item.origin === 'list' ? listStatusLine(dates) : null}
          ids={{ start: testIds.dupStart, due: testIds.dupDue, error: DUP_TEST_IDS.error, status: DUP_TEST_IDS.status }}
        />
        {needStart && refused === null ? <p className="it-note">{DUP_NEED_START}</p> : null}
      </div>
    </Modal>
  )
}
