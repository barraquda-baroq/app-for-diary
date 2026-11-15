// Favorite List の中身（docs/SPEC.md の 15.）: 入力欄（自動で伸びる欄と［足す］）、行（1行目を太く・リンク・3行を超えたら「続き」・
// 足した日）、「済み n件」と［済みを片付ける］。見出しと畳む・開くの枠は common の ListSection（トップの画面が置く）。
// 契約の形と土台の入力欄だけ（S3-STUB）: 今は入力欄（自動で伸びる欄と［足す］。書きかけは diary-studio:draft:favorite に控える。
// 指の端末の Enter は改行）だけを出し、PC の Enter・［足す］では何も足さない（字は欄に残る）。行・足す処理は段階3の WP4 が入れる
import { ListInput } from '../common/ListInput'
import { useListInput } from '../common/useListInput'
import type { ListBodyProps } from '../types'

export function FavoriteListBody(props: ListBodyProps) {
  void props
  const input = useListInput({ list: 'favorite', onAdd: () => false })
  return <ListInput input={input} />
}
