// ルーチンの［詳しく］のパネル（docs/SPEC.md の 3.6・14.2）: 件名・種類・［指定］・戻る日の行・［削除］と、段階5の提案の置き場。
// 地は --surface、題の左に RepeatIcon（D53）。L は右の列の上のパネル、S・M は下からのシート（common の ListSheet）。履歴の
// state.sheet の routine（src/features/calendar/common/types.ts の SheetState）を ListSheetHost が読んで出す。
// 契約の形だけ（S3-STUB）: 今は何も出さない（どこからもまだ開かない。中身は段階3の WP3 が入れる）
import type { ListPanelProps } from '../types'

export function RoutinePanel(props: ListPanelProps) {
  void props
  return null
}
