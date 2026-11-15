// リストから開く小さな画面を出す所（docs/SPEC.md の 3.1・3.6・3.8・12.2・12.3。D31・D43・D51）。履歴の state.sheet（calendar/common/sheets.ts）
// のうち、リストから開いた物（isListSheet）を読む:
// - detail の from 'task': Task List の［詳しく］の「タスク」の詳細（src/features/item/DetailSheet。L は右の列の上のパネル）
// - routine・favorite: Routine List・Favorite List の［詳しく］のパネル（routine/RoutinePanel・favorite/FavoritePanel）
// - register の from 'favorite': Favorite List の［予定にする］の登録の画面（src/features/item/RegisterSheet。L も真ん中の小さな画面）
// トップの画面が、どの幅でも・MIM を開いている時（#/mim）も置く（L・M は MIM の横・下にリストが出ているので、そこから開ける）。
// カレンダーから開いた登録・詳細は calendar/common/SheetHost が出す（こちらでは出さない）。
// 読み込み直した後に残っていた印（このページで開いた物でない）は: 登録の画面は開き直さずに1つ戻って閉じる（書きかけは残らないので）、
// 「タスク」の詳細とルーチン・やりたいことのパネルは、端末の中のデータを読み終えてから、記録があれば同じ形と題で開き直し（このページの印に
// 替える。D31）、無ければ1つ戻って閉じる。開いている間に記録が無くなった（ほかの端末で消した）パネルも閉じる（詳細は自分で閉じる）。
// 幅の区分が替わった時に L のパネルと S・M のシートを替えるのは、出す側（Modal の placement）が描くたびに決める（閉じない。FRAME-106）
import { useLayoutEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import type { AppData } from '../../domain/types'
import { useApp } from '../../store/appStore'
import { isListSheet, openedOnThisPage, PAGE_ID, sheetOf, useItemSheets, type SheetHistoryState } from '../calendar/common/sheets'
import type { SheetState } from '../calendar/common/types'
import { DetailSheet } from '../item/DetailSheet'
import { RegisterSheet } from '../item/RegisterSheet'
import { FavoritePanel } from './favorite/FavoritePanel'
import { RoutinePanel } from './routine/RoutinePanel'

/** 印の記録がデータにあるか（登録の画面は記録を持たないので false） */
function recordExists(data: AppData, sheet: SheetState | null): boolean {
  if (!sheet) return false
  switch (sheet.kind) {
    case 'detail':
      return Boolean(data.items[sheet.id])
    case 'routine':
      return Boolean(data.routines[sheet.id])
    case 'favorite':
      return Boolean(data.favorites[sheet.id])
    default:
      return false
  }
}

export function ListSheetHost() {
  const location = useLocation()
  const navigate = useNavigate()
  const { closeSheet } = useItemSheets()
  const marked = sheetOf(location.state)
  const sheet = marked && isListSheet(marked) ? marked : null
  const fresh = openedOnThisPage(location.state)
  const ready = useApp((s) => s.status === 'ready')
  const exists = useApp((s) => recordExists(s.data, sheet))
  // 決めてよいか: 登録の画面はすぐ、記録を読む物は端末の中のデータを読み終えてから
  const decided = sheet !== null && (sheet.kind === 'register' || ready)
  const panel = sheet?.kind === 'routine' || sheet?.kind === 'favorite'

  useLayoutEffect(() => {
    if (!sheet || !decided) return
    if (!fresh) {
      if (sheet.kind !== 'register' && exists) {
        const state: SheetHistoryState = { ...(location.state as SheetHistoryState), sheetPage: PAGE_ID }
        void navigate(location.pathname, { replace: true, state })
        return
      }
      // 印は、いつも同じ行き先の印の無い履歴の上に積んであるので、1つ戻ればその画面（2回呼ばれても1つだけ戻る）
      closeSheet()
      return
    }
    // 開いている間に記録が無くなったパネル（「タスク」の詳細は DetailSheet が自分で閉じる）
    if (panel && !exists) closeSheet()
  }, [fresh, decided, exists, location.key])

  if (!sheet) return null
  // 読み込み直す前の印は、記録があると分かってから出す（印を替えるまでの間に一瞬出さない）
  if (!fresh && !(decided && sheet.kind !== 'register' && exists)) return null
  switch (sheet.kind) {
    case 'register':
      return <RegisterSheet key={`register:${location.key}`} init={sheet.init} onClose={closeSheet} from="favorite" />
    case 'detail':
      return <DetailSheet key={`task:${sheet.id}`} id={sheet.id} onClose={closeSheet} from="task" />
    case 'routine':
      return exists ? <RoutinePanel key={`routine:${sheet.id}`} id={sheet.id} onClose={closeSheet} /> : null
    case 'favorite':
      return exists ? <FavoritePanel key={`favorite:${sheet.id}`} id={sheet.id} onClose={closeSheet} /> : null
  }
}
