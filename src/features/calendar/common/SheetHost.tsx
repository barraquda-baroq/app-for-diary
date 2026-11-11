// 登録・詳細の小さな画面を出す所（docs/SPEC.md の 3.1・3.8・12.2・12.3。D03）。履歴の state.sheet（common/sheets.ts）を読み、
// 登録の画面（src/features/item/RegisterSheet）か詳細の画面（DetailSheet）を出す。「戻る」で state.sheet が外れると消える。
// 読み込み直した後に残っていた印（このページで開いた物でない）は: 登録の画面は開き直さずに印を外す（書きかけは残らないので）、
// 詳細の画面は、端末の中のデータを読み終えてから、予定があれば開き直し（このページの印に替える）、無ければ印を外す。
// トップの画面（TopPage）がカレンダーを出している間だけ置く（幅の区分が替わってカレンダーが作り直されても閉じない）
import { useLayoutEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useApp } from '../../../store/appStore'
import { DetailSheet } from '../../item/DetailSheet'
import { RegisterSheet } from '../../item/RegisterSheet'
import { openedOnThisPage, PAGE_ID, sheetOf, useItemSheets, type SheetHistoryState } from './sheets'

export function SheetHost() {
  const location = useLocation()
  const navigate = useNavigate()
  const { closeSheet } = useItemSheets()
  const sheet = sheetOf(location.state)
  const fresh = openedOnThisPage(location.state)
  const ready = useApp((s) => s.status === 'ready')
  const exists = useApp((s) => (sheet?.kind === 'detail' ? Boolean(s.data.items[sheet.id]) : false))
  // 読み込み直す前に開いていた印: 登録は外す、詳細はデータを読み終えて予定があれば開き直す
  const decided = sheet !== null && (sheet.kind === 'register' || ready)

  useLayoutEffect(() => {
    if (!sheet || fresh || !decided) return
    const rest = { ...(location.state as SheetHistoryState) }
    if (sheet.kind === 'detail' && exists) {
      void navigate(location.pathname, { replace: true, state: { ...rest, sheetPage: PAGE_ID } })
      return
    }
    delete rest.sheet
    delete rest.sheetPage
    void navigate(location.pathname, { replace: true, state: rest })
  }, [fresh, decided, exists, location.key])

  if (!sheet) return null
  // 読み込み直す前の印は、詳細で予定があると分かってから出す（印を外すまでの間に一瞬出さない）
  if (!fresh && !(decided && sheet.kind === 'detail' && exists)) return null
  if (sheet.kind === 'register') return <RegisterSheet key={`register:${location.key}`} init={sheet.init} onClose={closeSheet} />
  return <DetailSheet key={`detail:${sheet.id}`} id={sheet.id} onClose={closeSheet} />
}
