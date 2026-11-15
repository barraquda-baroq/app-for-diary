// Task List の中身（docs/SPEC.md の 13.）: 入力欄（件名と［開始日］［締め切り日］［依頼者］・［足す］）、行（L は6つの列・M と S は2行）、
// 「済み n件」。見出しと畳む・開くの枠は common の ListSection（トップの画面が置く）。
// 契約の形だけ（S3-STUB）: 今は何も出さない（どの画面もまだ置かない。中身は段階3の WP2 が入れる）
import type { ListBodyProps } from '../types'

export function TaskListBody(props: ListBodyProps) {
  void props
  return null
}
