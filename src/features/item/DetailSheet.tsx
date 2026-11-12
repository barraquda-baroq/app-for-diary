// 予定の詳細の画面（docs/SPEC.md の 12.3。カレンダーから開いた時の題は「予定」。L は真ん中の小さな画面、M・S は下からのシート。3.8）。
// カード・行を押すと開く（common/sheets.ts の openDetail）。画面の地はその予定の区分の色、上の辺はラベルの色の帯（ItemSheet。X2・4.3）。
// - 上の列: 点線の丸と「完了にする」（完了なら「完了」。押すと切り替え、お知らせは出さない。12.5）、右に［複製］・「…」（［削除］）
//   （［×］は小さな画面の題の列）
// - 欄: 登録の画面と同じ並び（DetailForm）で、どの欄もいつも出す（畳む所は無い。22. の段階2の見本の確かめの 8.・10.）。
//   区分・ラベルを選び替えると、その場で地と帯の色も替わる
// - 下の行: 作った・完了・Claude が追加（DetailFooter。D47）
// - 直したそばから自動で保存する（保存のボタンは無い。12.3・FRAME-054）: 文字の欄（件名・依頼者・メモ）は 0.6秒止まった時・離れた時
//   （閉じる前にも。fields/useAutosave.ts）、日付・時刻・区分・ラベル・切り替えはすぐ。件名は空にできない（空のまま離れると元に戻し、
//   書かない。D48）。知らない区分・ラベルの記録は、選んだ時だけ書く（ITEMS-039）。ロック中でもどの欄も直せる（ITEMS-224）
// - 日付の欄は editDates（そろえる。1日の予定で終了 < 開始になる日付にはできず、日付の欄の下に理由を出して元の値のまま。6.4・ITEMS-222）、
//   時刻の欄は editTimes（翌日までにして保存し、「翌日 02:00 まで」を閉じるか日付・時刻を直すまで出す。D37・AMB-ITEMS-05）。
//   決まりを当てた後に変わった物だけを保存する
// - list 生まれ: 日付の欄の下に今どう出るかの1行（listStatusLine）。カレンダーに出ていない時（①④）は時刻の欄と「Task List にも出す」を
//   押せない。締め切り日を消して Task List に戻した時は「カレンダーから外れたので Task List に戻しました」（4秒。6.3）
// - ［複製］で「複製する日を選ぶ」（DuplicateDialog）、「…」→［削除］（deleteItem.ts）。消したら閉じる。重なった小さな画面は、Esc で
//   上の物だけが閉じる（AMB-ITEMS-32）
// 予定が無い時（ほかの端末で消した・ゴミ箱へ移した・消した後に「進む」で戻った）は閉じる（onClose。履歴を1つ戻す）。
import { useEffect, useMemo, useRef, useState } from 'react'
import { editDates, editTimes } from '../../domain/itemInput'
import { listStatusLine, toastText } from '../../domain/itemText'
import type { ItemPatch } from '../../domain/ops'
import { UNTITLED } from '../../domain/repair'
import type { Item } from '../../domain/types'
import { actions } from '../../store/actions'
import { getData, getStoredRecord, useApp, useRecord } from '../../store/appStore'
import { attempt, notify, notifyError } from '../../store/uiStore'
import { CopyIcon, DotCheckIcon, MoreIcon, TrashIcon } from '../../ui/icons'
import { PopupMenu } from '../../ui/PopupMenu'
import { toggleDone } from '../calendar/common/parts'
import { testIds } from '../calendar/common/testIds'
import type { DetailSheetProps } from '../calendar/common/types'
import { deleteItem } from './deleteItem'
import { DetailFooter } from './DetailFooter'
import { DetailForm } from './DetailForm'
import { DuplicateDialog } from './DuplicateDialog'
import {
  detailForm,
  offCalendarTask,
  rawTitleOf,
  TIMES_NEED_DUE,
  whenChanges,
  whenOf,
  type DatePatch,
  type FieldPatch,
  type TimePatch,
} from './itemForm'
import { ItemSheet } from './ItemSheet'

/** 詳細の画面の題（カレンダーから開いた時。Task List から開いた時の「タスク」は段階3。D46・D48） */
const TITLE = '予定'
/** 「…」のメニューの data-testid */
export const MORE_MENU_TEST_ID = 'item-more-menu'

export function DetailSheet({ id, onClose }: DetailSheetProps) {
  const item = useRecord('items', id)
  /** この画面で出していた予定の id（開いている間に予定が無くなった時は、何も出さずに閉じる） */
  const shown = useRef<string | null>(null)
  useEffect(() => {
    if (item) shown.current = id
    else onClose()
  }, [item, id, onClose])
  if (!item) {
    // 開いている間に無くなった（削除した・ほかの端末で消した）時は、閉じるまでの間も何も出さない
    if (shown.current === id) return null
    // 初めから無い（消した後に「進む」で戻った）時は、閉じるまでの間だけそう出す
    return (
      <ItemSheet title={TITLE} kind="work" label={null} onClose={onClose}>
        <p className="it-missing" data-testid={testIds.itemTitle}>
          この予定は見つかりません
        </p>
      </ItemSheet>
    )
  }
  return <DetailBody key={item.id} item={item} onClose={onClose} />
}

function DetailBody({ item, onClose }: { item: Item; onClose: () => void }) {
  const id = item.id
  const labelNames = useApp((s) => s.data.labelNames)
  // 欄の値は保存した記録から（直すとすぐ保存し、保存した値がここに戻る。文字の欄は打っている間の下書きを欄の中に持つ）。件名が空かは
  // 端末に書く（書いた）形の記録で見る（件名が空の予定の複製は、保存し終える前も空。D48）
  const form = useMemo(() => detailForm(item, rawTitleOf(getStoredRecord('items', item.id))), [item])
  /** 日付にできなかった理由（6.4。次に日付・時刻を決めるまで） */
  const [dateError, setDateError] = useState<string | null>(null)
  /** 翌日までにした時の「翌日 02:00 まで」（閉じるか、日付・時刻を直すまで。AMB-ITEMS-05） */
  const [timeHint, setTimeHint] = useState<string | null>(null)
  const [duplicating, setDuplicating] = useState(false)
  /** 「…」のメニューを開いたボタン（閉じていれば null） */
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null)
  const offCalendar = offCalendarTask(form)

  /** 直した物を保存する（予定が無くなった後は書かない）。list 生まれの締め切り日を消して Task List に戻した時は知らせる（6.3） */
  const save = (patch: ItemPatch) => {
    if (!getData().items[id]) return
    const r = attempt(() => actions.updateItem(id, patch))
    if (r?.relisted) notify(toastText.relisted)
  }

  const onChange = (patch: FieldPatch) => {
    // 件名は空にできない（空のまま離れると欄が元に戻る。D48・ITEMS-004）
    if (patch.title !== undefined && patch.title.trim() === '') return
    save(patch)
  }

  /** 今の記録の日付と時刻（保存した直後でも最新の値で決まりを当てる） */
  const currentWhen = () => whenOf(getData().items[id] ?? item)

  const onDates = (patch: DatePatch) => {
    const cur = currentWhen()
    const r = editDates(cur, patch)
    if (!r.ok) {
      setDateError(r.message)
      return
    }
    setDateError(null)
    setTimeHint(null)
    const changes = whenChanges(cur, r.when)
    if (Object.keys(changes).length > 0) save(changes)
  }

  const onTimes = (patch: TimePatch) => {
    const cur = currentWhen()
    const r = editTimes(cur, patch)
    if (!r.ok) {
      notifyError(r.message)
      return
    }
    setDateError(null)
    setTimeHint(r.hint)
    const changes = whenChanges(cur, r.when)
    if (Object.keys(changes).length > 0) save(changes)
  }

  const remove = async () => {
    const latest = getData().items[id]
    if (latest && (await deleteItem(latest))) onClose()
  }

  return (
    <ItemSheet
      title={TITLE}
      kind={form.kind}
      label={form.label}
      onClose={onClose}
      // 件名の欄にはフォーカスしない（スマホでキーボードが開かないように。登録の画面だけ件名へ）。上の列に置き、Tab で次の物へ
      initialFocus=".it-toprow"
    >
      <div className="it-toprow" tabIndex={-1}>
        <button
          type="button"
          className="it-done"
          aria-pressed={item.done}
          onClick={() => toggleDone(item, false)}
          data-testid={testIds.itemDone}
        >
          <DotCheckIcon done={item.done} size={18} />
          {item.done ? '完了' : '完了にする'}
        </button>
        <span className="it-spacer" />
        <button
          type="button"
          className="btn btn-sm"
          aria-haspopup="dialog"
          onClick={() => setDuplicating(true)}
          data-testid={testIds.itemDuplicate}
        >
          <CopyIcon />
          複製
        </button>
        <button
          type="button"
          className="icon-btn"
          aria-label="ほかの操作"
          title="ほかの操作"
          aria-haspopup="menu"
          aria-expanded={menuAnchor !== null}
          onClick={(e) => {
            const anchor = e.currentTarget
            setMenuAnchor((a) => (a ? null : anchor))
          }}
          data-testid={testIds.itemMore}
        >
          <MoreIcon />
        </button>
      </div>
      <DetailForm
        mode="detail"
        value={form}
        labelNames={labelNames}
        onChange={onChange}
        onDates={onDates}
        onTimes={onTimes}
        titlePlaceholder={UNTITLED}
        dateError={dateError}
        statusLine={form.origin === 'list' ? listStatusLine(form) : null}
        timeHint={timeHint}
        timesDisabledNote={offCalendar ? TIMES_NEED_DUE : null}
        listedDisabled={offCalendar}
      />
      <DetailFooter item={item} />
      {menuAnchor ? (
        <PopupMenu
          label="ほかの操作"
          items={[
            {
              label: '削除',
              icon: <TrashIcon />,
              danger: true,
              onSelect: () => void remove(),
              testId: testIds.itemDelete,
            },
          ]}
          placement={{ anchor: menuAnchor }}
          onClose={() => setMenuAnchor(null)}
          testId={MORE_MENU_TEST_ID}
        />
      ) : null}
      {duplicating ? <DuplicateDialog item={item} onClose={() => setDuplicating(false)} /> : null}
    </ItemSheet>
  )
}
