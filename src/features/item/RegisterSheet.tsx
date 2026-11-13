// 予定の登録の画面（docs/SPEC.md の 12.2。題は「予定を登録」。L は真ん中の小さな画面、M・S は下からのシート。3.8）。
// 開く所は操作の列の［＋ 登録］とデイリーのタイムスケジュールの空いた所（common/sheets.ts の openRegister。段階3は Favorite の
// 「予定にする」から件名・メモも）。欄は 件名 → 区分 → 依頼者 → 日付 → 時刻 → メモ → ロック・Task List にも出す → ラベルの色で、
// どれもいつも出す（DetailForm。畳む所は無い）。開くと件名にフォーカスする。S・M のシートで入り切らない下の欄は、シートの中のスクロールで届く。
// 画面の地は選んでいる区分の色、上の辺は選んでいるラベルの色の帯で、選び替えるとその場で替わる（ItemSheet。X2・4.3）。
// - 日付の欄は決めた時に editDates でそろえる（そろえると 1日の予定で終了 < 開始になる日付にはできない。6.3・6.4）
// - 時刻の欄は決めた時に editTimes を当てる。ただし翌日までにする時刻（22:00〜02:00）は［登録］まで2日の予定にせず、時刻の欄の下に
//   「翌日 02:00 まで」を出しておき、［登録］で2日の予定にして足す（D37・AMB-ITEMS-05）。その後に日付を動かして 1日の予定で
//   終了 < 開始になる時は、その日付にはできない（最後に直した欄の決まり。AMB-ITEMS-29）
// - ボタンは［やめる］［登録］（件名が空・空白だけの間は［登録］を押せない）。Ctrl+Enter・⌘+Enter でも登録（3.10。どの欄の中でも。
//   打ちかけの時刻は先に決める）。登録すると 12.4 の決まりを当ててから足し（ITEMS-194）、閉じて、新しいカード（見えていれば）を
//   1.2秒目立たせる（4.9。お知らせは出さない）。登録したことは元に戻す・やり直すの並びに積む（ウィークリー・デイリーから開いた時。
//   戻すとゴミ箱へ、やり直すとゴミ箱から戻る。7.13）
// - 書きかけ（件名・依頼者・メモのどれかに字がある）のまま閉じようとした時（［やめる］・［×］・Esc・背景・「戻る」）は「書きかけを捨てますか？
//   ［捨てる］［戻る］」と確かめる。「戻る」（Android・PC の OS の戻る）は履歴を戻すのを止めて（useBlocker）確かめ、［戻る］なら画面を
//   開いたままにする（D03・AMB-ITEMS-10）。iPhone・iPad の端からのフリック（左右どちら）は、詳細の画面と同じく、書きかけでも確かめずに
//   捨てて閉じる（■27。3.1）: アプリの履歴（src/history/appHistory.ts）が、ルーターに渡す前に flickDiscard を呼ぶので、止めない。
//   閉じる（onClose = common/sheets.ts の closeSheet）のは確かめが終わってから。書きかけの間に、この画面を別の小さな
//   画面に替える時（複製のお知らせの［開く］で詳細を開く）も、同じく止めて確かめる（［戻る］なら登録の画面と書きかけはそのまま。開発）
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useBlocker, type BlockerFunction } from 'react-router-dom'
import { editDates, editTimes } from '../../domain/itemInput'
import { undoText } from '../../domain/itemText'
import { setHistoryHandler } from '../../history/appHistory'
import { actions } from '../../store/actions'
import { getData, useApp } from '../../store/appStore'
import { attempt, notifyError, useCalendarUi } from '../../store/uiStore'
import { itemChange, recordStep } from '../../store/undoStore'
import { choiceDialog } from '../../ui/dialogs'
import { isSubmitShortcut, submitShortcutLabel } from '../../ui/keys'
import { flashKey } from '../calendar/common/parts/useFlashTarget'
import { sheetOf } from '../calendar/common/sheets'
import { testIds } from '../calendar/common/testIds'
import type { RegisterSheetProps } from '../calendar/common/types'
import { DetailForm } from './DetailForm'
import { hasDraftText, registerForm, type DatePatch, type ItemForm, type TimePatch } from './itemForm'
import { ItemSheet } from './ItemSheet'

/** 書きかけを捨てるかの確かめのボタンの data-testid */
export const DISCARD_TEST_IDS = { discard: 'item-discard', keep: 'item-discard-keep' } as const

/** 書きかけを捨てるかの確かめの文（NS の書きかけの確かめと同じく、捨てると何が起きるかを1文で添える） */
export const DISCARD_MESSAGE = '入力した予定は登録されません。'

/** 「書きかけを捨てますか？［捨てる］［戻る］」（［戻る］が主な選択肢。開いた時はここにフォーカス）。捨てる時 true */
async function confirmDiscard(): Promise<boolean> {
  const choice = await choiceDialog({
    title: '書きかけを捨てますか？',
    message: DISCARD_MESSAGE,
    choices: [
      { value: 'discard', label: '捨てる', danger: true, testId: DISCARD_TEST_IDS.discard },
      { value: 'keep', label: '戻る', primary: true, testId: DISCARD_TEST_IDS.keep },
    ],
  })
  return choice === 'discard'
}

export function RegisterSheet({ init, onClose }: RegisterSheetProps) {
  const [form, setForm] = useState<ItemForm>(() => registerForm(init))
  /**
   * 今の欄の値。描き直しを待たずに持つ（Ctrl/⌘+Enter で、打ちかけの時刻を決めた直後に、その値で登録する。閉じる時の書きかけの確かめも
   * これを見る）
   */
  const current = useRef(form)
  const update = (patch: Partial<ItemForm>) => {
    current.current = { ...current.current, ...patch }
    setForm(current.current)
  }
  const [dateError, setDateError] = useState<string | null>(null)
  const labelNames = useApp((s) => s.data.labelNames)
  const canRegister = form.title.trim() !== ''
  /** 翌日までにする時刻の時の「翌日 02:00 まで」（［登録］で2日の予定にする。入れた時から出す） */
  const timeHint = useMemo(() => {
    const r = editTimes(form, {})
    return r.ok ? r.hint : null
  }, [form])

  /** 閉じてよい（登録した・捨てると決めた。「戻る」を止めない） */
  const leaving = useRef(false)
  /** 確かめを出している間（同じ確かめを重ねて出さない。close = ［×］など、back = 「戻る」・別の小さな画面に替える） */
  const asking = useRef<'close' | 'back' | null>(null)

  const onDates = (patch: DatePatch) => {
    const r = editDates(current.current, patch)
    if (!r.ok) {
      setDateError(r.message)
      return
    }
    setDateError(null)
    update(r.when)
  }

  const onTimes = (patch: TimePatch) => {
    const r = editTimes(current.current, patch)
    if (!r.ok) {
      notifyError(r.message)
      return
    }
    setDateError(null)
    // 翌日までにする時刻は、打った値のまま持つ（［登録］で2日の予定にする）。ほかの決まり（00:00 → 24:00・終了 = 開始で空に・
    // 開始を空にすると終了も消す）はすぐ当てる
    update(r.hint ? patch : r.when)
  }

  /** ［登録］・Ctrl/⌘+Enter。件名が空の間は何もしない */
  const submit = () => {
    const f = current.current
    if (f.title.trim() === '') return
    const r = editTimes(f, {})
    if (!r.ok) {
      notifyError(r.message)
      return
    }
    const w = r.when
    const id = attempt(() =>
      actions.addItem({
        origin: 'calendar',
        title: f.title,
        kind: f.kind,
        start: w.start,
        due: w.due,
        startTime: w.startTime,
        endTime: w.endTime,
        label: f.label,
        requester: f.requester,
        locked: f.locked,
        listed: f.listed,
        memo: f.memo,
      }),
    )
    if (id === undefined) return
    const added = getData().items[id]
    if (added) recordStep(undoText.registered(added.title), [itemChange(id, null, added)])
    leaving.current = true
    useCalendarUi.getState().flashTarget(flashKey.item(id))
    onClose()
  }

  /** ［やめる］・［×］・Esc・背景: 書きかけなら確かめてから閉じる */
  const requestClose = () => {
    if (asking.current) return
    if (!hasDraftText(current.current)) {
      leaving.current = true
      onClose()
      return
    }
    asking.current = 'close'
    void confirmDiscard().then((discard) => {
      asking.current = null
      if (!discard) return
      leaving.current = true
      onClose()
    })
  }

  // 「戻る」と、この画面を別の小さな画面に替える時（複製のお知らせの［開く］。common/sheets.ts の open は置き換える）: 書きかけの間は
  // 止めて確かめる（［捨てる］で戻る・替える、［戻る］・Esc なら開いたまま）。小さな画面を閉じる・ほかの行き先へ移るのは止めない
  const shouldBlock = useCallback<BlockerFunction>(
    ({ historyAction, nextLocation }) =>
      (historyAction === 'POP' || sheetOf(nextLocation.state) !== null) && !leaving.current && hasDraftText(current.current),
    [],
  )
  const blocker = useBlocker(shouldBlock)
  // iPhone・iPad の端からのフリックで閉じる直前（アプリの履歴が呼ぶ）: 書きかけでも止めずに捨てる（■27。確かめのダイアログが出ている時の
  // フリックは、アプリの履歴が先にその確かめだけを閉じるので、ここへは来ない）
  useEffect(
    () =>
      setHistoryHandler('flickDiscard', () => {
        leaving.current = true
      }),
    [],
  )
  useEffect(() => {
    if (blocker.state !== 'blocked') return
    if (asking.current === 'back') return
    // ［×］などの確かめを出している間に来た移る動き（複製のお知らせの［開く］で詳細へ）は、止めるだけ（確かめはそのまま）。確かめを
    // 出している間の「戻る」（OS の戻る・端からのフリック）は、ふつうはここへ来ない: アプリの履歴が先にその確かめだけを閉じる（［戻る］
    // と同じ。シートは開いたまま。src/history/appHistory.ts の consumePop・3.1 の「先に片付ける物」）
    if (asking.current === 'close') {
      blocker.reset()
      return
    }
    asking.current = 'back'
    void confirmDiscard().then((discard) => {
      asking.current = null
      if (discard) {
        leaving.current = true
        blocker.proceed()
      } else blocker.reset()
    })
  }, [blocker])

  return (
    <ItemSheet
      title="予定を登録"
      kind={form.kind}
      label={form.label}
      onClose={requestClose}
      initialFocus={`[data-testid="${testIds.itemTitle}"]`}
      footer={
        <>
          <span className="it-hint hide-mobile hint-keyboard">{submitShortcutLabel()} でも登録</span>
          <button type="button" className="btn" onClick={requestClose} data-testid={testIds.itemCancel}>
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
          onChange={update}
          onDates={onDates}
          onTimes={onTimes}
          dateError={dateError}
          timeHint={timeHint}
        />
      </div>
    </ItemSheet>
  )
}
