// イヤー（docs/SPEC.md の 8.。領域が 870px 以上は月ごとの行、それより狭いと小さな月）。中身（WP12）ができるまでの仮の画面。
// 受け取る物（ViewProps）は最後の形
import { testIds } from '../common/testIds'
import type { ViewProps } from '../common/types'

export function YearView(_props: ViewProps) {
  return (
    <div className="empty cal-empty" data-testid={testIds.view('year')}>
      イヤー（年）の画面は段階2で作ります
    </div>
  )
}
