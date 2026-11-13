// カレンダーの画面での OS の「戻る」（Android の戻るボタン・戻る身振り、PC のブラウザの戻る）で、アプリを閉じるかを聞く
// （docs/SPEC.md の 3.1。22. の段階2の終わりの確かめの「画面の外からのフリックの決め」と ■22）。
// 「Diary Studio を閉じますか？」［キャンセル］［閉じる］。保存はいつも自動なので、データの保存の注意は出さない。同期していない変更がある
// 時だけ、端末に保存してあって次に開いた時に送ることを1行で添える。［閉じる］で、書きかけを端末に保存してからアプリの履歴の前へ戻る
// （src/history/appHistory.ts の leave。閉じられなかった時はお知らせで言う）。聞いている間にもう一度「戻る」が来たら、聞くのをやめる
// （Android の戻るでダイアログを閉じるのと同じ）。ほかのダイアログが開いている時の「戻る」も、聞かずにそのダイアログを閉じる
// （consumeBackPress。どの画面でも、iPhone の端からのフリックでも同じ。掴んでいる間（掴んでから離すまで）の「戻る」は何もしない）。
// 確かめのフォーカスは［キャンセル］に置き、題の列の［×］も「キャンセル」と読む（［閉じる］が2つにならないように。開発）
import { leaveApp, type LeaveResult } from '../../history/appHistory'
import { saveBeforeLeave } from '../../store/lifecycle'
import { notify, notifyError, useCalendarUi } from '../../store/uiStore'
import { useSync } from '../../sync/controller'
import { cancelAllDialogs, confirmDialog, hasOpenDialog } from '../../ui/dialogs'

/** 閉じるかの確かめの題 */
export const CLOSE_TITLE = 'Diary Studio を閉じますか？'

/** 確かめのボタンの data-testid */
export const CLOSE_TEST_IDS = { close: 'app-close', cancel: 'app-close-cancel' } as const

/** 同期していない変更がある時に添える1行（無ければ undefined） */
export function unsyncedLine(pending: number): string | undefined {
  if (pending <= 0) return undefined
  return `同期していない変更（${pending}件）は、この端末に保存してあり、次に開いた時に送ります。`
}

/** 閉じられなかった時のお知らせ（離れた時は出さない） */
export function leaveNotice(result: LeaveResult): string | null {
  switch (result) {
    case 'left':
      return null
    case 'armed':
      return 'もう一度［戻る］を押すと閉じます'
    case 'stayed':
      return 'この画面からは閉じられませんでした。ブラウザのタブ・ウインドウを閉じてください'
  }
}

let asking = false

/**
 * 「戻る」「進む」（iPhone の端からのフリックも）が来た時に、画面を動かす前に片付ける（src/history/appHistory.ts の consumePop）:
 * 確かめのダイアログが開いていれば、それだけを閉じる（キャンセル。その下の詳細の画面などは閉じない）。掴んでいる間（掴んでから
 * 離すまで。WeekDnd の dragging）は何もしない。離した後の、浮いたカードが元の所へ戻る動きの間（dnd-kit の掴んだ印
 * data-dnd-dragging はまだ残る。pageTurnDom の dragActive）は、もう掴んでいないので、ふつうに扱う（3.1）。片付けた時 true
 */
export function consumeBackPress(): boolean {
  if (hasOpenDialog()) {
    cancelAllDialogs()
    return true
  }
  return useCalendarUi.getState().dragging
}

/** OS の「戻る」でアプリを閉じるかを聞く（src/App.tsx がアプリの履歴に置く） */
export async function askToCloseApp(): Promise<void> {
  if (asking || hasOpenDialog()) {
    cancelAllDialogs()
    return
  }
  asking = true
  let close: boolean
  try {
    close = await confirmDialog({
      title: CLOSE_TITLE,
      message: unsyncedLine(useSync.getState().status?.pending ?? 0),
      confirmLabel: '閉じる',
      cancelLabel: 'キャンセル',
      testIds: { confirm: CLOSE_TEST_IDS.close, cancel: CLOSE_TEST_IDS.cancel },
      safeDefault: true,
      // モードを替えた直後の「戻る」で、替えた描画が後から終わっても閉じない（この確かめの間は画面は替わらない）
      keepOnNavigate: true,
    })
  } finally {
    asking = false
  }
  if (!close) return
  if (!(await saveBeforeLeave())) {
    notifyError('この端末に保存できなかったため、閉じるのをやめました。少し待ってからもう一度試してください。')
    return
  }
  const notice = leaveNotice(await leaveApp())
  if (notice) notify(notice)
}
