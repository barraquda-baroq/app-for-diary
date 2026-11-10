// トップ画面（段階0の土台の仮の物。ビルドを通すための空の形）。
// 中身（カレンダーの操作の列・右の列の3つのリスト・スマホの積み方と切り替えの列。docs/SPEC.md の 3.）は画面の枠の担当が作る
import { AppHeader } from '../../ui/Layout'

export function TopPage() {
  return (
    <>
      <AppHeader />
      <main className="page" data-testid="top-page">
        <p className="muted">トップ画面</p>
      </main>
    </>
  )
}
