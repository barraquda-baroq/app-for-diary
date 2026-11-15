// Task List の中身（docs/SPEC.md の 13.）: 入力欄（件名と［開始日］［締め切り日］［依頼者］・［足す］）、行（L は6つの列・M と S は2行）、
// 「済み n件」。見出しと畳む・開くの枠は common の ListSection（トップの画面が置く）。
// 契約の形と土台の入力欄だけ（S3-STUB）: 今は入力欄（自動で伸びる1行の欄と［足す］。書きかけは diary-studio:draft:task に控える）
// だけを出し、Enter・［足す］では何も足さない（字は欄に残る）。チップ・行・足す処理は段階3の WP2 が入れる
import { ListInput } from '../common/ListInput'
import { useListInput } from '../common/useListInput'
import type { ListBodyProps } from '../types'

export function TaskListBody(props: ListBodyProps) {
  void props
  const input = useListInput({ list: 'task', onAdd: () => false })
  return <ListInput input={input} />
}
