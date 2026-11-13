// カレンダーの画面での OS の「戻る」（Android の戻るボタン・戻る身振り、PC のブラウザの戻る）で、アプリを閉じる（docs/SPEC.md の 3.1。
// 22. の段階2の終わりの確かめの「画面の外からのフリックの決め」と ■22・■25）。閉じ方は端末と表示の形で決める（src/ui/device.ts）:
// - Android のブラウザのタブ・PC（■22）: 「Diary Studio を閉じますか？」［キャンセル］［閉じる］。保存はいつも自動なので、データの保存の
//   注意は出さない。同期していない変更がある時だけ、端末に保存してあって次に開いた時に送ることを1行で添える。［閉じる］で、書きかけを
//   端末に保存してからアプリの履歴の前へ戻る（src/history/appHistory.ts の leave。閉じられなかった時はお知らせで言う）。聞いている間に
//   もう一度「戻る」が来たら、聞くのをやめる（Android の戻るでダイアログを閉じるのと同じ）
// - ホーム画面から開いた Android のアプリ（■25。作者「こっちで」）: 聞かない。書きかけを端末に保存してから、もう一度［戻る］で閉じる所に
//   し（appHistory の armExit）、「もう一度［戻る］を押すと閉じます」を出す（同期していない変更がある時は、同じ1行を添える）。出ている間
//   （EXIT_ARMED_MS）のもう一度の［戻る］で閉じる。消えた・押した・長押しした時は元の所へ戻り、次の［戻る］でまた出す
// ほかのダイアログが開いている時の「戻る」は、聞かずにそのダイアログを閉じる（consumeBackPress。どの画面でも、iPhone の端からのフリック
// でも同じ。掴んでいる間（掴んでから離すまで）の「戻る」は何もしない）。
// 確かめのフォーカスは［キャンセル］に置き、題の列の［×］も「キャンセル」と読む（［閉じる］が2つにならないように。開発）
import { armExitApp, leaveApp, type LeaveResult } from '../../history/appHistory'
import { saveBeforeLeave } from '../../store/lifecycle'
import { notify, notifyError, useCalendarUi, useToasts } from '../../store/uiStore'
import { useSync } from '../../sync/controller'
import { cancelAllDialogs, confirmDialog, hasOpenDialog } from '../../ui/dialogs'

/** 閉じるかの確かめの題 */
export const CLOSE_TITLE = 'Diary Studio を閉じますか？'

/** 確かめのボタンの data-testid */
export const CLOSE_TEST_IDS = { close: 'app-close', cancel: 'app-close-cancel' } as const

/** もう一度［戻る］で閉じる所にした時のお知らせ */
export const ARMED_NOTICE = 'もう一度［戻る］を押すと閉じます'

/**
 * ホーム画面から開いた Android のアプリで、1回目の［戻る］の後に、もう一度［戻る］で閉じる所にしておく長さ（ミリ秒。お知らせを出して
 * いる長さと同じ。Android のアプリによくある 2〜3秒のうち、同期していない変更の1行も読めるように 3秒。開発。3.1）
 */
export const EXIT_ARMED_MS = 3000

/** 端末に保存できなかった時のお知らせ（閉じない・もう一度［戻る］で閉じる所にしない） */
const SAVE_FAILED = 'この端末に保存できなかったため、閉じるのをやめました。少し待ってからもう一度試してください。'

/** 同期していない変更がある時に添える1行（無ければ undefined） */
export function unsyncedLine(pending: number): string | undefined {
  if (pending <= 0) return undefined
  return `同期していない変更（${pending}件）は、この端末に保存してあり、次に開いた時に送ります。`
}

/** もう一度［戻る］で閉じる所にした時のお知らせの文（同期していない変更がある時は、その1行を次の行に添える） */
export function armedNotice(pending: number): string {
  const line = unsyncedLine(pending)
  return line ? `${ARMED_NOTICE}\n${line}` : ARMED_NOTICE
}

/** 閉じられなかった時のお知らせ（離れた時は出さない） */
export function leaveNotice(result: LeaveResult): string | null {
  switch (result) {
    case 'left':
      return null
    case 'armed':
      return ARMED_NOTICE
    case 'stayed':
      return 'この画面からは閉じられませんでした。ブラウザのタブ・ウインドウを閉じてください'
  }
}

let asking = false
let arming = false

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

/** Android のブラウザのタブ・PC の OS の「戻る」でアプリを閉じるかを聞く（src/App.tsx がアプリの履歴に置く） */
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
    notifyError(SAVE_FAILED)
    return
  }
  const notice = leaveNotice(await leaveApp())
  if (notice) notify(notice)
}

/**
 * ホーム画面から開いた Android のアプリのカレンダーでの「戻る」（■25。src/App.tsx がアプリの履歴に置く）: 聞かずに、書きかけを端末に
 * 保存してから、もう一度［戻る］で閉じる所にし、「もう一度［戻る］を押すと閉じます」を EXIT_ARMED_MS だけ出す。その所が終わったら
 * （時間が過ぎた・押した・長押しした）お知らせも消す。保存できなかった時は、その所にせずにお知らせで言う。保存している間に来た「戻る」は
 * 何もしない。保存している間に押した・キーを打った時は、その所にせず、お知らせも出さない（armExitApp が false）
 */
export async function armExitOnBack(): Promise<void> {
  if (arming) return
  arming = true
  try {
    if (!(await saveBeforeLeave())) {
      notifyError(SAVE_FAILED)
      return
    }
    let toast: number | null = null
    let ended = false
    const armed = await armExitApp(EXIT_ARMED_MS, () => {
      ended = true
      if (toast !== null) useToasts.getState().dismiss(toast)
    })
    if (!armed || ended) return
    toast = notify(armedNotice(useSync.getState().status?.pending ?? 0), undefined, EXIT_ARMED_MS)
  } finally {
    arming = false
  }
}
