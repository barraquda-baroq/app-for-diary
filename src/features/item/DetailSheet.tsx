// 予定の詳細の画面（docs/SPEC.md の 12.3。カレンダーから開いた時の題は「予定」。L は真ん中の小さな画面、M・S は下からのシート。3.8）。
// カード・行を押すと開く（common/sheets.ts の openDetail）。画面の地はその予定の区分の色、上の辺はラベルの色の帯（ItemSheet。X2・4.3）。
// - 上の列: 点線の丸と「完了にする」（完了なら「完了」。押すと切り替え、お知らせは出さない。12.5）、右に［複製］・「…」（［削除］）
//   （［×］は小さな画面の題の列）
// - 欄: 登録の画面と同じ並び（DetailForm）。区分・ラベルを選び替えると、その場で地と帯の色も替わる
// - 「詳しく」: ラベル・依頼者・ロック・メモ（と生まれの初めと違う Task List にも出す）のどれかが入っていれば開いて出し、どれも
//   無ければ端末ごとに覚えた detailsOpen に従う。ここで開け閉めしても detailsOpen に書く（D11）
// - 下の行: 作った・完了・Claude が追加（DetailFooter。D47）
// 予定が無い時（ほかの端末で消した・ゴミ箱へ移した・消した後に「進む」で戻った）は閉じる（onClose。履歴を1つ戻す）。
// 直したそばから自動で保存する所（文字の欄は 0.6秒止まった時・離れた時、ほかはすぐ。12.3）・日付と時刻の決まり（12.4）・複製（12.7）・
// 削除（12.8）は WP9 の後半。今は欄を直してもこの画面の中の値だけが変わる
import { useEffect, useRef, useState } from 'react'
import type { Item } from '../../domain/types'
import { getRaw, useApp, useRecord } from '../../store/appStore'
import { usePrefs } from '../../store/uiStore'
import { CopyIcon, DotCheckIcon, MoreIcon } from '../../ui/icons'
import { toggleDone } from '../calendar/common/parts'
import { UNTITLED } from '../../domain/repair'
import { testIds } from '../calendar/common/testIds'
import type { DetailSheetProps } from '../calendar/common/types'
import { DetailFooter } from './DetailFooter'
import { DetailForm } from './DetailForm'
import { detailForm, hasDetails, type ItemForm } from './itemForm'
import { ItemSheet } from './ItemSheet'

/** 詳細の画面の題（カレンダーから開いた時。Task List から開いた時の「タスク」は段階3。D46・D48） */
const TITLE = '予定'

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
  const labelNames = useApp((s) => s.data.labelNames)
  const detailsPref = usePrefs((s) => s.detailsOpen)
  const setPrefs = usePrefs((s) => s.setPrefs)
  const [form, setForm] = useState<ItemForm>(() => detailForm(item, getRaw().items[item.id]?.title))
  const [open, setOpen] = useState(() => hasDetails(form) || detailsPref)
  const change = (patch: Partial<ItemForm>) => setForm((f) => ({ ...f, ...patch }))
  const toggleDetails = () => {
    setOpen(!open)
    setPrefs({ detailsOpen: !open })
  }

  /** ［複製］（複製する日を選ぶ小さな画面。12.7）は WP9 の後半 */
  const duplicate = () => {}
  /** 「…」（［削除］のメニュー。12.8）は WP9 の後半 */
  const more = () => {}

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
        <button type="button" className="btn btn-sm" onClick={duplicate} data-testid={testIds.itemDuplicate}>
          <CopyIcon />
          複製
        </button>
        <button
          type="button"
          className="icon-btn"
          aria-label="ほかの操作"
          title="ほかの操作"
          onClick={more}
          data-testid={testIds.itemMore}
        >
          <MoreIcon />
        </button>
      </div>
      <DetailForm
        mode="detail"
        value={form}
        labelNames={labelNames}
        detailsOpen={open}
        onToggleDetails={toggleDetails}
        onChange={change}
        onDates={change}
        onTimes={change}
        titlePlaceholder={UNTITLED}
      />
      <DetailFooter item={item} />
    </ItemSheet>
  )
}
