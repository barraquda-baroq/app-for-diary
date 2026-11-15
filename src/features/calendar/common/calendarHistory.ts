// アプリの履歴（src/history/appHistory.ts・singleEntryHistory.ts）に渡す、行き先の画面の種類（docs/SPEC.md の 3.1）。トップの画面の
// 行き先は、小さな画面の印（履歴の state.sheet。sheets.ts）のうち、その行き先で出している物を先に見る: 登録の画面の印（Favorite List の
// ［予定にする］も）は登録、ほかの印（詳細・Task List の「タスク」・Routine List と Favorite List の［詳しく］）は詳細。
// - カレンダーの行き先（トップ #/ と4つのモード）: どの印も読む（カレンダーから開いた物は SheetHost、リストから開いた物は
//   ListSheetHost が出す）。印が無ければカレンダー
// - #/mim: リストから開いた印だけを読む（MIM を開いている間も ListSheetHost が出す。L・M で MIM の横のリストから開いた［詳しく］は
//   #/mim の上に積んだ詳細、［予定にする］の登録は端からのフリックで書きかけを捨てて閉じる ■27）。カレンダーから開いた印（SheetHost は
//   MIM を開いている間は置かないので見えない）と印が無い時は、今までどおり「ほかの画面」
// - ほか（設定・ログイン・見つかりません）は印があっても「ほかの画面」（小さな画面を開くのはトップの画面だけなので、設定・ログインに
//   印は来ない。開発）
import type { ScreenKind } from '../../../history/popRules'
import { isCalendarPath, isMimPath } from '../../../routes'
import { isListSheet, sheetOf } from './sheets'

export function screenOf(location: { pathname: string; state: unknown }): ScreenKind {
  const calendar = isCalendarPath(location.pathname)
  // 行き先の無い物（履歴の物が state だけを置き換えた時など）はほかの画面（今までと同じ）
  if (!calendar && !(typeof location.pathname === 'string' && isMimPath(location.pathname))) return 'other'
  const sheet = sheetOf(location.state)
  if (sheet && (calendar || isListSheet(sheet))) return sheet.kind === 'register' ? 'register' : 'detail'
  return calendar ? 'calendar' : 'other'
}
