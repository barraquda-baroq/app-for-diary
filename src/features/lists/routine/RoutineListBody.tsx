// Routine List の中身（docs/SPEC.md の 14.）: 2段の入力欄（上の段に［日｜週｜月｜四半期｜年］と［指定］、下の段に字の欄と［足す］。D3・■35）、
// 種類ごとの5つのかたまり（見出し・'済み数/全部'・畳む・開く・空のかたまりの＋）、行、かたまりごとの「済み n件」。
// 見出しと畳む・開くの枠は common の ListSection（トップの画面が置く）。
// 契約の形だけ（S3-STUB）: 今は何も出さない（どの画面もまだ置かない。中身は段階3の WP3 が入れる）
import type { ListBodyProps } from '../types'

export function RoutineListBody(props: ListBodyProps) {
  void props
  return null
}
