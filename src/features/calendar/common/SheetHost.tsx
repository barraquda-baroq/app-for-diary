// 登録・詳細の小さな画面を出す所（docs/SPEC.md の 3.1・3.8・12.2・12.3。D03）。履歴の state.sheet（common/sheets.ts）を読み、
// 登録の画面（src/features/item/RegisterSheet）か詳細の画面（DetailSheet）を出す。「戻る」で state.sheet が外れると消える。
// 読み込み直した後に残っていた印（このページで開いた物でない）は: 登録の画面は開き直さずに閉じる（書きかけは残らないので）、
// 詳細の画面は、端末の中のデータを読み終えてから、予定があれば開き直し（このページの印に替える）、無ければ閉じる。閉じるのは
// ［×］と同じく履歴を1つ戻す（印を外して置き換えると、同じカレンダーの履歴が2つ並び、「戻る」を1回押しても何も変わらない。3.1）。
// トップの画面（TopPage）がカレンダーを出している間だけ置く（幅の区分が替わってカレンダーが作り直されても閉じない）。
// リストから開いた物（Task List の「タスク」の詳細・Routine List と Favorite List の［詳しく］・Favorite List の［予定にする］の登録。
// sheets.ts の isListSheet）は出さず、読み込み直した後の印も決めない（src/features/lists/ListSheetHost.tsx が受け持つ）
import { useLayoutEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useApp } from '../../../store/appStore'
import { DetailSheet } from '../../item/DetailSheet'
import { RegisterSheet } from '../../item/RegisterSheet'
import { isListSheet, openedOnThisPage, PAGE_ID, sheetOf, useItemSheets, type SheetHistoryState } from './sheets'

export function SheetHost() {
  const location = useLocation()
  const navigate = useNavigate()
  const { closeSheet } = useItemSheets()
  const marked = sheetOf(location.state)
  // カレンダーから開いた登録・詳細だけ（リストから開いた物は ListSheetHost）
  const sheet = marked && !isListSheet(marked) && (marked.kind === 'register' || marked.kind === 'detail') ? marked : null
  const fresh = openedOnThisPage(location.state)
  const ready = useApp((s) => s.status === 'ready')
  const exists = useApp((s) => (sheet?.kind === 'detail' ? Boolean(s.data.items[sheet.id]) : false))
  // 読み込み直す前に開いていた印: 登録は閉じる、詳細はデータを読み終えて予定があれば開き直す（無ければ閉じる）
  const decided = sheet !== null && (sheet.kind === 'register' || ready)

  useLayoutEffect(() => {
    if (!sheet || fresh || !decided) return
    if (sheet.kind === 'detail' && exists) {
      const state: SheetHistoryState = { ...(location.state as SheetHistoryState), sheetPage: PAGE_ID }
      void navigate(location.pathname, { replace: true, state })
      return
    }
    // 小さな画面の印は、いつも同じ行き先の印の無い履歴の上に積んであるので、1つ戻ればその画面（2回呼ばれても1つだけ戻る）
    closeSheet()
  }, [fresh, decided, exists, location.key])

  if (!sheet) return null
  // 読み込み直す前の印は、詳細で予定があると分かってから出す（印を外すまでの間に一瞬出さない）
  if (!fresh && !(decided && sheet.kind === 'detail' && exists)) return null
  if (sheet.kind === 'register') return <RegisterSheet key={`register:${location.key}`} init={sheet.init} onClose={closeSheet} />
  return <DetailSheet key={`detail:${sheet.id}`} id={sheet.id} onClose={closeSheet} />
}
