// 3つのリスト（Routine List・Task List・Favorite List。docs/SPEC.md の 3.6・13.〜15.）の部品どうしの約束の型。
// トップの画面（src/features/top/TopPage.tsx）が見出しと畳む・開くの枠（common の ListSection）の中に各リストの中身（*ListBody）を置き、
// リストから開く［詳しく］のパネル（RoutinePanel・FavoritePanel）は ListSheetHost が出す
import type { ID } from '../../domain/types'
import type { ListKey } from '../../store/uiStore'
import type { WidthClass } from '../../ui/hooks'

/** 各リストの中身（入力欄・行・「済み n件」）が受け取る物 */
export interface ListBodyProps {
  /** 幅の区分（L は右の列の行・M と S は積んだ所の行。3.4・3.5・13.3） */
  width: WidthClass
}

/** ルーチン・やりたいことの［詳しく］のパネルが受け取る物（L は右の列の上のパネル、S・M は下からのシート。3.6・3.8） */
export interface ListPanelProps {
  /** ルーチン・やりたいことの id（中身はデータから読む） */
  id: ID
  /** ［×］・Esc・外を押す・［削除］の後に呼ぶ（履歴を1つ戻す） */
  onClose: () => void
}

/** 3つのリストのまだ済んでいない数（見出しと切り替えの列に出す。畳んでいるリストも数える。3.5・3.6） */
export type ListCounts = Record<ListKey, number>
