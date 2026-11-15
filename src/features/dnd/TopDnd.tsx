// トップの画面のドラッグの入れ物（docs/SPEC.md の 7.11。D52）: ウィークリーの予定・Task List の行・リストの並べ替えを、1つの
// DragDropProvider で扱う（L の WideTop と S・M の StackedTop を両方包むので、幅が替わっても同じ物が残る）。掴み方（マウスは 5px 動かす・
// 指は 0.4秒 8px の中で押し続ける）と見た目（落とす動きを付けない）はウィークリーのドラッグと同じ。
// 契約の形だけ（S3-STUB）: 今は中身をそのまま出すだけ（ドラッグの入れ物はまだウィークリーの WeekDnd の中。中身は段階3の WP5 が入れる）
import type { ReactNode } from 'react'

export function TopDnd({ children }: { children: ReactNode }) {
  return <>{children}</>
}
