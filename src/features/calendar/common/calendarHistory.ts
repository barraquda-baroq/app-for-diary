// アプリの履歴（src/history/appHistory.ts）に渡す、行き先の画面の種類（docs/SPEC.md の 3.1）: カレンダーの行き先（トップ #/ と4つの
// モード）は、登録・詳細の画面の印（履歴の state.sheet。sheets.ts）があれば登録・詳細、無ければカレンダー。ほか（MIM・設定・ログイン・
// 見つかりません）は「ほかの画面」
import type { ScreenKind } from '../../../history/popRules'
import { isCalendarPath } from '../../../routes'
import { sheetOf } from './sheets'

export function screenOf(location: { pathname: string; state: unknown }): ScreenKind {
  if (!isCalendarPath(location.pathname)) return 'other'
  const sheet = sheetOf(location.state)
  if (!sheet) return 'calendar'
  return sheet.kind === 'register' ? 'register' : 'detail'
}
