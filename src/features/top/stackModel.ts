// S・M で「開いているリスト」を決める（docs/SPEC.md の 3.1・D1・■34）: 端からのフリック（iPhone・iPad。左右どちらでも）・OS の［戻る］
// （Android・PC）で畳むリスト。S・M だけで、S の全面の MIM でない時に、見ている所（切り替えの列で選ばれた物。3.5）が開いている
// リストの時だけそのリスト。L（iPad の横向きも）・カレンダーを見ている・そのリストを畳んでいる時は null（今までどおりモードを回す・
// 閉じるか聞く）。画面に頼らない純粋な決まり（*Model.ts。src/features/calendar/purity.test.ts）。
// 契約の形だけ（S3-STUB）: 今はいつも null（中身は段階3の WP6 が入れる）。使わない引数は void で読む（名前を契約のまま残すため）
import type { ListKey, PaneKey, WidthClass } from '../calendar/common/types'

export type { PaneKey }

/** 畳むリスト（無ければ null） */
export function listToClose(s: {
  width: WidthClass
  fullMim: boolean
  shown: PaneKey
  collapsed: Readonly<Record<ListKey, boolean>>
}): ListKey | null {
  void s
  return null
}
