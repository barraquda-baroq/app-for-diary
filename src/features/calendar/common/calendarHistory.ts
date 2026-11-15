// アプリの履歴（src/history/appHistory.ts・singleEntryHistory.ts）に渡す、行き先の画面の種類（docs/SPEC.md の 3.1）。トップの画面の
// 行き先（トップ #/ と4つのモード・#/mim）は、小さな画面の印（履歴の state.sheet。sheets.ts）を先に見る: 登録の画面の印（Favorite List
// の［予定にする］も）は登録、ほかの印（詳細・Task List の「タスク」・Routine List と Favorite List の［詳しく］）は詳細。印が無ければ、
// カレンダーの行き先はカレンダー、#/mim は「ほかの画面」。ほか（設定・ログイン・見つかりません）は印があっても「ほかの画面」
// （小さな画面を開くのはトップの画面だけなので、設定・ログインに印は来ない。D51）。
// L・M で MIM を開いている時にリストの［詳しく］を開くと #/mim の上に詳細を積み、［予定にする］の登録は端からのフリックで
// 書きかけを捨てて閉じる（■27）
import type { ScreenKind } from '../../../history/popRules'
import { isCalendarPath, isMimPath } from '../../../routes'
import { sheetOf } from './sheets'

export function screenOf(location: { pathname: string; state: unknown }): ScreenKind {
  const calendar = isCalendarPath(location.pathname)
  // 行き先の無い物（履歴の物が state だけを置き換えた時など）はほかの画面（今までと同じ）
  if (!calendar && !(typeof location.pathname === 'string' && isMimPath(location.pathname))) return 'other'
  const sheet = sheetOf(location.state)
  if (sheet) return sheet.kind === 'register' ? 'register' : 'detail'
  return calendar ? 'calendar' : 'other'
}
