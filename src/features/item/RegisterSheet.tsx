// 予定の登録の画面（docs/SPEC.md の 12.2。題は「予定を登録」。L は真ん中の小さな画面、M・S は下からのシート。3.8）。
// 開く所は操作の列の［＋ 登録］とデイリーのタイムスケジュールの空いた所（common/sheets.ts の openRegister。段階3は Favorite の
// 「予定にする」から件名・メモも）。欄は 件名 → 区分 → 日付 → 時刻 → 詳しく（DetailForm）。開くと件名にフォーカスする。
// 画面の地は選んでいる区分の色、上の辺は選んでいるラベルの色の帯で、選び替えるとその場で替わる（ItemSheet。X2・4.3）。
// 「詳しく」の開閉は端末ごとに覚える（diary-studio:prefs の detailsOpen。6.13）。
// ボタンは［やめる］［登録］（件名が空・空白だけの間は［登録］を押せない）。Ctrl+Enter・⌘+Enter でも登録（3.10）。
// 登録（入力の決まり 12.4 を当ててから足す・閉じて新しいカードを 1.2秒目立たせる）と、書きかけのまま閉じる時の確かめ（［やめる］・
// ［×］・Esc・背景・「戻る」）は WP9 の後半（submit・onClose を包む所）
import { useState } from 'react'
import { useApp } from '../../store/appStore'
import { usePrefs } from '../../store/uiStore'
import { isSubmitShortcut, submitShortcutLabel } from '../../ui/keys'
import { testIds } from '../calendar/common/testIds'
import type { RegisterSheetProps } from '../calendar/common/types'
import { DetailForm } from './DetailForm'
import { registerForm, type ItemForm } from './itemForm'
import { ItemSheet } from './ItemSheet'

export function RegisterSheet({ init, onClose }: RegisterSheetProps) {
  const [form, setForm] = useState<ItemForm>(() => registerForm(init))
  const detailsOpen = usePrefs((s) => s.detailsOpen)
  const setPrefs = usePrefs((s) => s.setPrefs)
  const labelNames = useApp((s) => s.data.labelNames)
  const canRegister = form.title.trim() !== ''
  const change = (patch: Partial<ItemForm>) => setForm((f) => ({ ...f, ...patch }))

  /** ［登録］・Ctrl/⌘+Enter。件名が空の間は何もしない（足して閉じるのは WP9 の後半） */
  const submit = () => {
    if (!canRegister) return
  }

  return (
    <ItemSheet
      title="予定を登録"
      kind={form.kind}
      label={form.label}
      onClose={onClose}
      initialFocus={`[data-testid="${testIds.itemTitle}"]`}
      footer={
        <>
          <span className="it-hint hide-mobile hint-keyboard">{submitShortcutLabel()} でも登録</span>
          <button type="button" className="btn" onClick={onClose} data-testid={testIds.itemCancel}>
            やめる
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!canRegister}
            onClick={submit}
            data-testid={testIds.itemRegister}
          >
            登録
          </button>
        </>
      }
    >
      {/* Ctrl+Enter・⌘+Enter はどの欄の中でも効く（日本語の変換中の Enter は除く。ITEMS-185） */}
      <div
        onKeyDown={(e) => {
          if (!isSubmitShortcut(e)) return
          e.preventDefault()
          submit()
        }}
      >
        <DetailForm
          mode="register"
          value={form}
          labelNames={labelNames}
          detailsOpen={detailsOpen}
          onToggleDetails={() => setPrefs({ detailsOpen: !detailsOpen })}
          onChange={change}
          onDates={change}
          onTimes={change}
        />
      </div>
    </ItemSheet>
  )
}
