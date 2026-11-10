// 画面を閉じる・裏に回る・再読み込みする・アプリを更新する時の保存処理。NS の src/store/lifecycle.ts をそのまま写した。
import { flushNow, writeRecoveryJournal } from './appStore'
import { flushAllDrafts } from './draftRegistry'

/**
 * 入力欄の下書きをすべてストアへ反映し、まだ保存できていない変更を同期的に控えてから保存を始める（保存できたら true）。
 * pagehide / visibilitychange(hidden) / アプリ更新の前に呼ぶ。
 */
export function saveBeforeLeave(): Promise<boolean> {
  flushAllDrafts()
  writeRecoveryJournal()
  return flushNow()
}

let installed = false

export function installLeaveHandlers(): void {
  if (installed) return
  installed = true
  window.addEventListener('pagehide', () => void saveBeforeLeave())
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void saveBeforeLeave()
  })
}
